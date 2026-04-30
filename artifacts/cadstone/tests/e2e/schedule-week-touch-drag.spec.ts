import { expect, test, type Locator, type Page } from "@playwright/test"
import { CESAR, authHeaders, loginViaApi } from "./helpers/auth"
import {
  createTestJob,
  deleteJob,
  deleteScheduleItem,
  requireAnyClient,
} from "./helpers/api"
import { CESAR_STATE } from "./helpers/storage"

// Touch long-press drag for hourly blocks: simulate a phone user
// holding the block for ~400ms before dragging it from Monday to
// Wednesday. Uses real CDP `Input.dispatchTouchEvent` calls so
// browser-level `touch-action` handling is exercised end-to-end.

test.use({ storageState: CESAR_STATE, hasTouch: true })

const DAY_MS = 24 * 60 * 60 * 1000
const isoDate = (d: Date) => d.toISOString().slice(0, 10)

function mondayOf(d: Date): Date {
  const copy = new Date(d.getTime())
  const offset = (copy.getDay() + 6) % 7
  copy.setDate(copy.getDate() - offset)
  copy.setHours(0, 0, 0, 0)
  return copy
}

async function columnCenter(page: Page, dayKey: string) {
  const handle = page.locator(`[data-week-day-column="${dayKey}"]`).first()
  await expect(handle).toBeVisible({ timeout: 10_000 })
  const box = await handle.boundingBox()
  if (!box) {
    throw new Error(`Column ${dayKey} has no bounding box`)
  }
  return {
    centerX: box.x + box.width / 2,
    top: box.y,
    height: box.height,
    locator: handle,
  }
}

async function findBlockInColumn(
  page: Page,
  dayKey: string,
  title: string,
): Promise<Locator> {
  const block = page
    .locator(`[data-week-day-column="${dayKey}"]`)
    .getByRole("button", { name: new RegExp(title) })
    .first()
  await expect(block).toBeVisible({ timeout: 10_000 })
  return block
}

// Helpers around the CDP `Input.dispatchTouchEvent` so we drive real
// touch events, which the browser routes through both the touch event
// pipeline (where `touch-action` is honored) and the pointer event
// pipeline (where our drag handlers live).
async function setSchedulePage(page: Page, dayKey: string) {
  await page.getByTestId("calendar-period-select").click()
  await page.getByRole("option", { name: /^week$/i }).click()
  await page.evaluate((dateStr) => {
    const input = document.querySelector<HTMLInputElement>('input[type="date"]')
    if (!input) {
      throw new Error("calendar date input not found")
    }
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set
    setter?.call(input, dateStr)
    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.dispatchEvent(new Event("change", { bubbles: true }))
  }, dayKey)
}

test.describe("schedule week-view touch long-press drag", () => {
  let token = ""
  let jobId: string | null = null
  let itemId: string | null = null
  let mondayKey = ""
  let wednesdayKey = ""
  const title = `E2E touch-drag ${Date.now()}`

  test.beforeAll(async ({ request }) => {
    token = (await loginViaApi(request, CESAR)).accessToken
    const clientId = await requireAnyClient(request, token)

    jobId = await createTestJob(request, token, {
      title: `Schedule touch-drag job ${Date.now()}`,
      clientId,
    })

    // Next-week Monday so we don't collide with workday exceptions on today's week.
    const baseMonday = mondayOf(new Date(Date.now() + 7 * DAY_MS))
    mondayKey = isoDate(baseMonday)
    wednesdayKey = isoDate(new Date(baseMonday.getTime() + 2 * DAY_MS))

    const createRes = await request.post(`/api/jobs/${jobId}/schedule`, {
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      data: {
        title,
        startDate: mondayKey,
        endDate: mondayKey,
        isHourly: true,
        startTime: "09:00",
        endTime: "10:00",
      },
    })
    expect(
      createRes.ok(),
      `schedule create failed: ${createRes.status()} ${await createRes.text()}`,
    ).toBeTruthy()
    const createBody = await createRes.json()
    itemId = createBody.item?.id ?? createBody.id ?? null
    expect(itemId).toBeTruthy()
  })

  test.afterAll(async ({ request }) => {
    if (itemId) await deleteScheduleItem(request, token, itemId)
    if (jobId) await deleteJob(request, token, jobId)
  })

  test("long-press then drags a block from Monday to Wednesday and to a later time on touch", async ({
    page,
    context,
    request,
  }) => {
    test.skip(!jobId || !itemId, "Setup did not produce a job/item")

    await page.goto(`/jobs/${jobId}/schedule`)
    await setSchedulePage(page, mondayKey)

    await expect(
      page.locator(`[data-week-day-column="${mondayKey}"]`),
    ).toBeVisible({ timeout: 10_000 })
    await expect(
      page.locator(`[data-week-day-column="${wednesdayKey}"]`),
    ).toBeVisible()

    const block = await findBlockInColumn(page, mondayKey, title)
    await block.scrollIntoViewIfNeeded()
    const blockBox = await block.boundingBox()
    if (!blockBox) throw new Error("Block has no bounding box")

    const wednesday = await columnCenter(page, wednesdayKey)

    // Find the scrollable container so we can confirm the touchmove
    // suppressor stops the page from scrolling while the drag is armed.
    const scrollerHandle = await block.evaluateHandle((el) => {
      let node: HTMLElement | null = el as HTMLElement
      while (node) {
        const style = window.getComputedStyle(node)
        const overflowY = style.overflowY
        if (
          (overflowY === "auto" || overflowY === "scroll") &&
          node.scrollHeight > node.clientHeight
        ) {
          return node
        }
        node = node.parentElement
      }
      return document.scrollingElement as HTMLElement
    })
    const initialScrollTop: number = await scrollerHandle.evaluate(
      (el: HTMLElement) => el.scrollTop,
    )

    const startX = Math.round(blockBox.x + blockBox.width / 2)
    const startY = Math.round(blockBox.y + blockBox.height / 2)
    const dropX = Math.round(wednesday.centerX)
    // Drop two hours later in the day. The week view uses ~48 px per
    // hour, so 96 px down moves a 9-10 AM block to 11-noon.
    const HOUR_PIXELS = 48
    const dropY = startY + 2 * HOUR_PIXELS

    const cdp = await context.newCDPSession(page)

    const putWaiter = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/schedule-items/${itemId}`) &&
        response.request().method() === "PUT" &&
        response.ok(),
      { timeout: 10_000 },
    )

    // 1) touchStart, then hold still through the 400ms long-press
    //    threshold. Real CDP touch input lets the browser exercise its
    //    own touch-action / scroll heuristics — they should not steal
    //    a stationary press.
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: startX, y: startY, id: 0 }],
    })
    await page.waitForTimeout(550)

    // 2) Slide diagonally to a later time on Wednesday in several
    //    steps so the browser would normally scroll vertically — the
    //    armed touchmove suppressor must keep the page still.
    const STEPS = 6
    for (let i = 1; i <= STEPS; i += 1) {
      const x = Math.round(startX + ((dropX - startX) * i) / STEPS)
      const y = Math.round(startY + ((dropY - startY) * i) / STEPS)
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y, id: 0 }],
      })
      await page.waitForTimeout(20)
    }

    await expect(
      page.locator(
        `[data-week-day-column="${wednesdayKey}"][data-drop-target="true"]`,
      ),
    ).toBeVisible({ timeout: 5_000 })
    await expect(
      page.locator(`[data-week-day-column="${mondayKey}"]`),
    ).not.toHaveAttribute("data-drop-target", "true")

    const midDragScrollTop: number = await scrollerHandle.evaluate(
      (el: HTMLElement) => el.scrollTop,
    )
    expect(
      midDragScrollTop,
      `page scrolled while drag was armed (was ${initialScrollTop}, now ${midDragScrollTop})`,
    ).toBe(initialScrollTop)

    // 3) Release.
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    })

    const putRes = await putWaiter
    const putBody = await putRes.json().catch(() => null)
    const fetched = await request.get(`/api/schedule-items/${itemId}`, {
      headers: authHeaders(token),
    })
    expect(fetched.ok()).toBeTruthy()
    const fetchedBody = await fetched.json()
    const fetchedItem = fetchedBody.item ?? fetchedBody
    expect(fetchedItem.startDate, JSON.stringify(putBody)).toBe(wednesdayKey)
    expect(fetchedItem.isHourly).toBeTruthy()
    // Time should have shifted to a later hour. The exact value
    // depends on the snap grid — we just assert it's no longer 09:00.
    expect(fetchedItem.startTime).not.toMatch(/^09:00/)

    await expect(
      page.locator('[data-week-day-column][data-drop-target="true"]'),
    ).toHaveCount(0)
  })

  test("a quick tap (no long-press) opens the block editor", async ({
    page,
  }) => {
    test.skip(!jobId || !itemId, "Setup did not produce a job/item")

    await page.goto(`/jobs/${jobId}/schedule`)
    await setSchedulePage(page, mondayKey)

    // The first test moved the block to Wednesday.
    const block = await findBlockInColumn(page, wednesdayKey, title)
    await block.scrollIntoViewIfNeeded()
    const blockBox = await block.boundingBox()
    if (!blockBox) throw new Error("Block has no bounding box")

    const startX = blockBox.x + blockBox.width / 2
    const startY = blockBox.y + blockBox.height / 2

    // page.touchscreen.tap is a real touch tap; the click that fires
    // after must still open the editor since the long-press timer
    // never armed.
    await page.touchscreen.tap(startX, startY)

    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 })
  })

  test("a swipe starting on a block (no long-press) still scrolls the page", async ({
    page,
    context,
  }) => {
    test.skip(!jobId || !itemId, "Setup did not produce a job/item")

    await page.goto(`/jobs/${jobId}/schedule`)
    await setSchedulePage(page, mondayKey)

    const block = await findBlockInColumn(page, wednesdayKey, title)
    await block.scrollIntoViewIfNeeded()
    const blockBox = await block.boundingBox()
    if (!blockBox) throw new Error("Block has no bounding box")

    // Find the closest scrollable ancestor so we can measure scroll
    // movement regardless of which container actually owns the scroll.
    const scrollerHandle = await block.evaluateHandle((el) => {
      let node: HTMLElement | null = el as HTMLElement
      while (node) {
        const style = window.getComputedStyle(node)
        const overflowY = style.overflowY
        if (
          (overflowY === "auto" || overflowY === "scroll") &&
          node.scrollHeight > node.clientHeight
        ) {
          return node
        }
        node = node.parentElement
      }
      return document.scrollingElement as HTMLElement
    })

    const initialScrollTop: number = await scrollerHandle.evaluate(
      (el: HTMLElement) => el.scrollTop,
    )

    const cdp = await context.newCDPSession(page)
    const startX = Math.round(blockBox.x + blockBox.width / 2)
    const startY = Math.round(blockBox.y + blockBox.height / 2)

    // Quick swipe: touchStart, then move >10px immediately (well
    // under the 400ms long-press threshold). The browser should treat
    // this as a scroll gesture and the long-press should never arm,
    // so no PUT request should be sent and the editor must stay closed.
    let putRequestObserved = false
    const putListener = (response: import("@playwright/test").Response) => {
      if (
        response.url().includes(`/api/schedule-items/${itemId}`) &&
        response.request().method() === "PUT"
      ) {
        putRequestObserved = true
      }
    }
    page.on("response", putListener)

    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: startX, y: startY, id: 0 }],
    })
    // Several intermediate moves so the browser's scroll heuristic
    // fires and updates the scroll position.
    for (let i = 1; i <= 6; i += 1) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: startX, y: startY - i * 30, id: 0 }],
      })
      await page.waitForTimeout(20)
    }
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    })

    await page.waitForTimeout(300)
    page.off("response", putListener)

    const finalScrollTop: number = await scrollerHandle.evaluate(
      (el: HTMLElement) => el.scrollTop,
    )

    expect(
      finalScrollTop,
      `expected page to scroll, but stayed at ${finalScrollTop}`,
    ).toBeGreaterThan(initialScrollTop)
    expect(putRequestObserved, "no schedule PUT should fire on a swipe").toBe(
      false,
    )
    await expect(page.getByRole("dialog")).toHaveCount(0)
  })
})

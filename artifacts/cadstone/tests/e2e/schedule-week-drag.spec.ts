import { expect, test, type Locator, type Page } from "@playwright/test"
import { CESAR, authHeaders, loginViaApi } from "./helpers/auth"
import {
  createTestJob,
  deleteJob,
  deleteScheduleItem,
  requireAnyClient,
} from "./helpers/api"
import { CESAR_STATE } from "./helpers/storage"

test.use({ storageState: CESAR_STATE })

// Week-view cross-day drag for hourly blocks: drag from Monday's column
// to Wednesday's, assert the drop highlight, and confirm the move
// persists through the API and a page reload.

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

test.describe("schedule week-view cross-day drag", () => {
  let token = ""
  let jobId: string | null = null
  let itemId: string | null = null
  let mondayKey = ""
  let wednesdayKey = ""
  const title = `E2E week-drag ${Date.now()}`

  test.beforeAll(async ({ request }) => {
    token = (await loginViaApi(request, CESAR)).accessToken
    const clientId = await requireAnyClient(request, token)

    jobId = await createTestJob(request, token, {
      title: `Schedule week-drag job ${Date.now()}`,
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

  test("drags an hourly block from Monday to Wednesday and persists", async ({
    page,
    request,
  }) => {
    test.skip(!jobId || !itemId, "Setup did not produce a job/item")

    await page.goto(`/jobs/${jobId}/schedule`)

    await page.getByTestId("calendar-period-select").click()
    await page.getByRole("option", { name: /^week$/i }).click()

    // Drive the hidden date input directly so the test doesn't depend on chevron math.
    await page.evaluate((dateStr) => {
      const input = document.querySelector<HTMLInputElement>(
        'input[type="date"]',
      )
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
    }, mondayKey)

    await expect(
      page.locator(`[data-week-day-column="${mondayKey}"]`),
    ).toBeVisible({ timeout: 10_000 })
    await expect(
      page.locator(`[data-week-day-column="${wednesdayKey}"]`),
    ).toBeVisible()

    const block = await findBlockInColumn(page, mondayKey, title)
    const blockBox = await block.boundingBox()
    if (!blockBox) throw new Error("Block has no bounding box")

    const wednesday = await columnCenter(page, wednesdayKey)

    const startX = blockBox.x + blockBox.width / 2
    const startY = blockBox.y + blockBox.height / 2
    const dropY = startY

    const putWaiter = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/schedule-items/${itemId}`) &&
        response.request().method() === "PUT" &&
        response.ok(),
      { timeout: 10_000 },
    )

    await page.mouse.move(startX, startY)
    await page.mouse.down()
    // Nudge past the 5px arming threshold, then walk to Wednesday.
    await page.mouse.move(startX + 4, startY + 4, { steps: 4 })
    await page.mouse.move(wednesday.centerX, dropY, { steps: 12 })

    await expect(
      page.locator(`[data-week-day-column="${wednesdayKey}"][data-drop-target="true"]`),
    ).toBeVisible({ timeout: 5_000 })
    await expect(
      page.locator(`[data-week-day-column="${mondayKey}"]`),
    ).not.toHaveAttribute("data-drop-target", "true")

    await page.mouse.up()

    const putRes = await putWaiter
    const putBody = await putRes.json().catch(() => null)
    // API check avoids relying on DOM round-trip timing.
    const fetched = await request.get(`/api/schedule-items/${itemId}`, {
      headers: authHeaders(token),
    })
    expect(fetched.ok()).toBeTruthy()
    const fetchedBody = await fetched.json()
    const fetchedItem = fetchedBody.item ?? fetchedBody
    expect(fetchedItem.startDate, JSON.stringify(putBody)).toBe(wednesdayKey)
    expect(fetchedItem.isHourly).toBeTruthy()
    expect(fetchedItem.startTime).toMatch(/^09:00/)

    await expect(
      page.locator('[data-week-day-column][data-drop-target="true"]'),
    ).toHaveCount(0)

    await page.reload()
    await page.getByTestId("calendar-period-select").click()
    await page.getByRole("option", { name: /^week$/i }).click()
    await page.evaluate((dateStr) => {
      const input = document.querySelector<HTMLInputElement>(
        'input[type="date"]',
      )
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
    }, mondayKey)

    await findBlockInColumn(page, wednesdayKey, title)
    await expect(
      page
        .locator(`[data-week-day-column="${mondayKey}"]`)
        .getByRole("button", { name: new RegExp(title) }),
    ).toHaveCount(0)
  })
})

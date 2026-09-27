import { expect, test } from "@playwright/test";
import { CESAR_STATE } from "./helpers/storage";

const conversation = {
  id: "test-chat",
  userId: "test-user",
  title: "TEST project review",
  pinned: false,
  lastMessageAt: "2026-09-27T10:00:00Z",
  createdAt: "2026-09-27T10:00:00Z",
  updatedAt: "2026-09-27T10:00:00Z",
};
const response =
  "## Project summary\n\n| Project | Status | Contract | Collected | Balance | Next visit |\n| --- | --- | ---: | ---: | ---: | --- |\n| TEST Stone Residence | Fabrication | $84,500 | $42,250 | $42,250 | October 2 |\n| TEST Construction Plaza | Installing | $125,000 | $100,000 | $25,000 | October 5 |\n\n### Next steps\n\n1. Confirm the installation date.\n2. Review **open balances**.\n\n![External image](https://tracking.invalid/pixel.png)\n<script>alert('unsafe')</script>";
const message = {
  id: "test-message",
  conversationId: conversation.id,
  role: "assistant",
  content: response,
  toolCalls: null,
  citations: null,
  inputTokens: 100,
  outputTokens: 100,
  stoppedReason: null,
  createdAt: conversation.createdAt,
};

test.describe("assistant and account security", () => {
  test.use({ storageState: CESAR_STATE });

  for (const width of [1440, 390, 320]) {
    test(`assistant has readable tables and bounded controls at ${width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.route("**/api/agent/access**", (route) =>
        route.fulfill({ json: { canUseAssistant: true } }),
      );
      await page.route("**/api/agent/usage", (route) =>
        route.fulfill({
          json: {
            yearMonth: "2026-09",
            inputTokens: 100,
            outputTokens: 100,
            totalTokens: 200,
            requests: 1,
            cap: 100000,
            remaining: 99800,
            exceeded: false,
          },
        }),
      );
      await page.route("**/api/agent/conversations", (route) =>
        route.fulfill({ json: { conversations: [conversation] } }),
      );
      await page.route(
        "**/api/agent/conversations/test-chat/messages",
        async (route) => {
          if (route.request().method() === "GET")
            return route.fulfill({ json: { messages: [message] } });
          // A delayed test response lets the real AbortController path run.
          await new Promise((resolve) => setTimeout(resolve, 1500));
          await route.abort().catch(() => undefined);
        },
      );
      await page.goto("/dashboard");
      await page
        .getByRole("button", { name: "Open assistant", exact: true })
        .click();
      const panel = page.getByRole("dialog");
      await expect(
        panel.getByRole("heading", { name: "Project summary", exact: true }),
      ).toBeVisible();
      await expect(
        panel.getByRole("columnheader", { name: "Contract", exact: true }),
      ).toBeVisible();
      await expect(panel.getByRole("table").locator("tbody tr")).toHaveCount(2);
      await expect(panel.locator(".assistant-markdown ol li")).toHaveCount(2);
      await expect(
        panel.locator(".assistant-markdown img, .assistant-markdown script"),
      ).toHaveCount(0);
      const tableRegion = panel.getByRole("region", { name: "Response table" });
      await tableRegion.focus();
      await expect(tableRegion).toBeFocused();
      const composer = panel.getByRole("textbox", {
        name: "Message the assistant",
      });
      await expect(composer).toBeEnabled();
      const bounds = await panel.boundingBox();
      expect(bounds!.width).toBeLessThanOrEqual(width + 0.5);
      if (width > 760) {
        expect(bounds!.width).toBeGreaterThanOrEqual(750);
        await panel.getByRole("button", { name: "Expand assistant" }).click();
        await expect
          .poll(async () => (await panel.boundingBox())!.width)
          .toBeGreaterThan(1400);
        await panel.getByRole("button", { name: "Restore panel" }).click();
        await expect.poll(async () => (await panel.boundingBox())!.width).toBeLessThanOrEqual(761);
      } else {
        expect(
          await tableRegion.evaluate((el) => el.scrollWidth > el.clientWidth),
        ).toBe(true);
      }
      expect(
        await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      ).toBe(true);
      const composerBounds = await composer.boundingBox();
      expect(composerBounds!.y + composerBounds!.height).toBeLessThanOrEqual(
        900,
      );
      await page.screenshot({
        path: testInfo.outputPath(`assistant-${width}.png`),
        fullPage: true,
      });
      await composer.fill("TEST review");
      await panel.getByRole("button", { name: "Send", exact: true }).click();
      await panel.getByRole("button", { name: "Stop response" }).click();
      await expect(composer).toBeEnabled();
      await expect(
        panel.getByText("Response stopped: aborted").last(),
      ).toBeVisible();
      await panel.getByRole("button", { name: "Close", exact: true }).click();
      await expect(panel).not.toBeVisible();
    });
  }

  test("account security setup submits, shows recovery codes once, and returns to settings", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    let enrolled = false;
    await page.route("**/api/auth/security", (route) =>
      route.fulfill({
        json: {
          email: "test-security@example.test",
          emailVerified: true,
          mfaEnabled: enrolled,
          mfaRequired: false,
          recoveryCodesRemaining: enrolled ? 10 : 0,
        },
      }),
    );
    await page.route("**/api/auth/security/setup", async (route) => {
      expect(route.request().postDataJSON().password).toBe(
        "TestCurrentPassword!2026",
      );
      await route.fulfill({
        json: {
          setupRequired: true,
          challengeToken: "test-challenge-not-production",
        },
      });
    });
    await page.route("**/api/auth/security/enroll", (route) =>
      route.fulfill({
        json: {
          secret: "JBSWY3DPEHPK3PXP",
          uri: "otpauth://totp/SlabPlan:TEST?secret=JBSWY3DPEHPK3PXP&issuer=SlabPlan",
          expiresAt: "2099-01-01T00:00:00Z",
        },
      }),
    );
    await page.route("**/api/auth/security/confirm", async (route) => {
      expect(route.request().postDataJSON().code).toBe("123456");
      const session = await page.request.post("/api/auth/refresh", {
        headers: { "X-Requested-With": "XMLHttpRequest" },
      });
      expect(session.ok()).toBe(true);
      enrolled = true;
      await route.fulfill({
        json: {
          ...(await session.json()),
          recoveryCodes: Array.from(
            { length: 10 },
            (_, i) => `testcode-${i}-not-a-real-recovery-code`,
          ),
        },
      });
    });
    await page.goto("/settings/security");
    await page
      .getByLabel("Current password", { exact: true })
      .fill("TestCurrentPassword!2026");
    await page.getByRole("button", { name: "Set up authenticator" }).click();
    await expect(page).toHaveURL(/\/account-verification$/);
    await expect(
      page.getByRole("heading", { name: "Secure your account" }),
    ).toBeVisible();
    await page.getByLabel("Authenticator code", { exact: true }).fill("123456");
    await page
      .getByRole("button", { name: "Enable two-step verification" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Keep your recovery codes" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Continue", exact: true }),
    ).toBeDisabled();
    expect(
      await page.evaluate(() => JSON.stringify(localStorage)),
    ).not.toContain("test-challenge");
    expect(
      await page.evaluate(() => JSON.stringify(localStorage)),
    ).not.toContain("testcode-");
    await page.screenshot({
      path: testInfo.outputPath("recovery-mobile.png"),
      fullPage: true,
    });
    await page
      .getByRole("checkbox", {
        name: "I have stored my recovery codes securely",
      })
      .check();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page).toHaveURL(/\/settings\/security$/);
    await expect(
      page.getByText("Authenticator enabled", { exact: true }),
    ).toBeVisible();
  });

  test("email verification clears its fragment and requires an explicit confirmation", async ({
    page,
  }) => {
    let calls = 0;
    await page.route("**/api/auth/verify-email", async (route) => {
      calls++;
      expect(route.request().postDataJSON().token).toBe("a".repeat(64));
      await route.fulfill({ json: { success: true } });
    });
    await page.goto(`/verify-email#token=${"a".repeat(64)}`);
    await expect(page).toHaveURL(/\/verify-email$/);
    expect(calls).toBe(0);
    await page
      .getByRole("button", { name: "Verify email", exact: true })
      .click();
    await expect.poll(() => calls).toBe(1);
    await expect(
      page.getByText("Email verified", { exact: true }),
    ).toBeVisible();
  });
});

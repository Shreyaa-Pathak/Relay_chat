import { expect, test } from "@playwright/test";
import { newUser, send } from "./helpers";
import AxeBuilder from "@axe-core/playwright";

test("mobile: channel drawer and full-screen thread with back button", async ({ browser }) => {
  const ada = await newUser(browser, "Ada", { viewport: { width: 412, height: 839 }, isMobile: true, hasTouch: true });
  const { page } = ada;
  // Sidebar is a drawer on small screens.
  await expect(page.getByRole("link", { name: "design", exact: true })).not.toBeInViewport();
  await page.getByRole("button", { name: "Open channel list" }).click();
  await expect(page.getByRole("link", { name: "design", exact: true })).toBeInViewport();
  await page.getByRole("link", { name: "design", exact: true }).click();
  await expect(page.getByRole("heading", { name: /design/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "design", exact: true })).not.toBeInViewport();

  const parent = `Mobile parent ${Date.now()}`;
  await send(page, parent);
  await expect(page.getByText("Sent").last()).toBeVisible();
  await page.getByRole("article").filter({ hasText: parent }).getByRole("button", { name: "Reply in thread" }).click();
  const thread = page.getByRole("complementary", { name: /Thread in #design/ });
  await expect(thread).toBeInViewport();
  await send(page, "reply from my phone", "Reply in thread");
  await expect(thread.getByText("reply from my phone")).toBeVisible();
  await thread.getByRole("button", { name: "Back to channel" }).click();
  await expect(thread).toHaveCount(0);
  await expect(page.getByRole("button", { name: "1 reply" })).toBeVisible();
});

test("mobile: owner invitation and channel dialogs fit and remain accessible", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 412, height: 839 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill("superadmin@relay.test");
  await page.getByLabel("Password", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: /general/ })).toBeVisible();
  await page.getByRole("button", { name: "Open channel list" }).click();
  await page.getByRole("button", { name: "Create channel", exact: true }).click();
  const create = page.getByRole("dialog", { name: "Create a channel" });
  await expect(create).toBeInViewport();
  await expect(create.getByRole("button", { name: "Create channel", exact: true })).toBeInViewport();
  await create.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Admin tools" }).click();
  await page.getByRole("button", { name: "Invite people", exact: true }).click();
  const invite = page.getByRole("dialog", { name: "Invite people" });
  await invite.getByLabel("Email address").fill(`mobile-${Date.now()}@example.com`);
  await invite.getByRole("button", { name: "Create invitation", exact: true }).click();
  await expect(invite.locator("#invite-share-link")).toBeVisible();
  expect(await invite.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  const scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations.filter((v) => v.impact === "critical" || v.impact === "serious").map((v) => v.id)).toEqual([]);
  await page.screenshot({ path: "test-results/release-mobile-invitation.png" });
  await context.close();
});

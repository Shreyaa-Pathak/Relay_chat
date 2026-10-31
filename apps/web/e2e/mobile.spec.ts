import { expect, test } from "@playwright/test";
import { newUser, send } from "./helpers";

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

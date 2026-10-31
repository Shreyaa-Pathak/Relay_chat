import { test } from "@playwright/test";
import { newUser, send } from "./helpers";

// Not an assertion test: captures screens for visual review. Run with SCREENSHOTS=1.
test.skip(!process.env.SCREENSHOTS, "set SCREENSHOTS=1 to capture review screenshots");

test("capture desktop and mobile screens", async ({ browser }) => {
  const ada = await newUser(browser, "Ada Lovelace", { viewport: { width: 1280, height: 760 } });
  const bo = await newUser(browser, "Bo Chen", { viewport: { width: 412, height: 860 }, isMobile: true, hasTouch: true });
  await ada.page.getByRole("link", { name: "deploys", exact: true }).click();
  await bo.page.goto("/c/deploys");
  await send(ada.page, "Deploy 418 is rolling out to production now.");
  await send(bo.page, "Watching the dashboards. Latency looks flat so far.");
  await send(ada.page, "Nice. Migrations ran in 1.2 s, no locks.");
  await bo.page.getByRole("article").filter({ hasText: "Migrations ran" }).getByRole("button", { name: "Reply in thread" }).click();
  await send(bo.page, "Shipping the rollback notes too.", "Reply in thread");
  await bo.page.getByRole("button", { name: "Back to channel" }).click();
  await bo.page.getByPlaceholder(/Message #/).pressSequentially("one sec", { delay: 30 });
  await ada.page.waitForTimeout(400);
  await ada.page.screenshot({ path: "test-results/review-desktop.png" });
  await ada.page.getByRole("button", { name: /reply/ }).first().click();
  await ada.page.waitForTimeout(400);
  await ada.page.screenshot({ path: "test-results/review-desktop-thread.png" });
  await bo.page.screenshot({ path: "test-results/review-mobile.png" });
  await bo.page.getByRole("button", { name: "Open channel list" }).click();
  await bo.page.waitForTimeout(300);
  await bo.page.screenshot({ path: "test-results/review-mobile-drawer.png" });
  const anon = await (await browser.newContext({ viewport: { width: 1280, height: 760 } })).newPage();
  await anon.goto("/login");
  await anon.screenshot({ path: "test-results/review-login.png" });
});

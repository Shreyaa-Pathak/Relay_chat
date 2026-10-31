import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { newUser, send } from "./helpers";

test("two people chat in real time, with optimistic send and delivery state", async ({ browser }) => {
  const ada = await newUser(browser, "Ada");
  const bo = await newUser(browser, "Bo");

  const text = `Deploy 42 is out ${Date.now()}`;
  await send(ada.page, text);
  // Optimistic render on the sender, then the delivered state.
  const mine = ada.page.getByRole("log").getByText(text);
  await expect(mine).toBeVisible();
  await expect(ada.page.getByText("Sent").last()).toBeVisible();
  // Real-time delivery to the other browser, without a reload.
  await expect(bo.page.getByRole("log").getByText(text)).toBeVisible();

  // Both appear in the online count (derived from shared presence, not hard-coded).
  await expect(ada.page.getByRole("button", { name: /\d+ online/ })).toContainText(/[2-9]\d* online|\d{2,} online/);
});

test("threads keep replies out of the channel and show a reply count", async ({ browser }) => {
  const ada = await newUser(browser, "Ada");
  const bo = await newUser(browser, "Bo");
  const parent = `Thread parent ${Date.now()}`;
  await send(ada.page, parent);
  await expect(bo.page.getByRole("log").getByText(parent)).toBeVisible();

  const row = bo.page.getByRole("article").filter({ hasText: parent });
  await row.hover();
  await row.getByRole("button", { name: "Reply in thread" }).click();
  const thread = bo.page.getByRole("complementary", { name: /Thread in #general/ });
  await expect(thread).toBeVisible();
  const reply = `A reply ${Date.now()}`;
  await send(bo.page, reply, "Reply in thread");
  await expect(thread.getByText(reply)).toBeVisible();

  // The reply is not in the main channel log for either user; the parent shows the count.
  await expect(bo.page.getByRole("log", { name: /Messages in #general/ }).getByText(reply)).toHaveCount(0);
  await expect(ada.page.getByRole("article").filter({ hasText: parent }).getByRole("button", { name: "1 reply" })).toBeVisible();
  await expect(ada.page.getByRole("log", { name: /Messages in #general/ }).getByText(reply)).toHaveCount(0);
});

test("typing indicator appears for others and expires", async ({ browser }) => {
  const ada = await newUser(browser, "Ada");
  const bo = await newUser(browser, "Bo");
  await ada.page.getByPlaceholder(/Message #general/).pressSequentially("hel", { delay: 50 });
  await expect(bo.page.getByText("Ada is typing…")).toBeVisible();
  await expect(bo.page.getByText("Ada is typing…")).toBeHidden({ timeout: 8000 });
});

test("messages sent while offline are kept and delivered after reconnecting", async ({ browser }) => {
  const ada = await newUser(browser, "Ada");
  const bo = await newUser(browser, "Bo");
  await ada.context.setOffline(true);
  await expect(ada.page.getByRole("status").filter({ hasText: /offline|Reconnecting/ }).first()).toBeVisible({ timeout: 15_000 });
  const text = `Queued while offline ${Date.now()}`;
  await send(ada.page, text);
  await expect(ada.page.getByRole("log").getByText(text)).toBeVisible();
  await expect(ada.page.getByText("Sending…")).toBeVisible();
  await ada.context.setOffline(false);
  await expect(bo.page.getByRole("log").getByText(text)).toBeVisible({ timeout: 20_000 });
  await expect(ada.page.getByText("Sending…")).toHaveCount(0);
});

test("history survives a reload and sign-out requires confirmation", async ({ browser }) => {
  const ada = await newUser(browser, "Ada");
  const text = `Persistent ${Date.now()}`;
  await send(ada.page, text);
  await expect(ada.page.getByText("Sent").last()).toBeVisible();
  await ada.page.reload();
  await expect(ada.page.getByRole("log").getByText(text)).toBeVisible();

  await ada.page.getByRole("button", { name: "Sign out" }).click();
  const dialog = ada.page.getByRole("dialog", { name: "Sign out of Relay?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Sign out" }).click();
  await expect(ada.page).toHaveURL(/\/login$/);
  await ada.page.goto("/c/general");
  await expect(ada.page).toHaveURL(/\/login$/);
});

test("leaving and rejoining a channel", async ({ browser }) => {
  const ada = await newUser(browser, "Ada");
  await ada.page.getByRole("link", { name: "random", exact: true }).click();
  await ada.page.getByRole("button", { name: "Leave #random" }).click();
  await ada.page.getByRole("dialog").getByRole("button", { name: "Leave channel" }).click();
  await expect(ada.page.getByRole("link", { name: "random", exact: true })).toHaveCount(0);
  await ada.page.getByRole("button", { name: "Browse channels" }).click();
  await ada.page.getByRole("dialog").getByRole("listitem").filter({ hasText: "#random" }).getByRole("button", { name: "Join" }).click();
  await expect(ada.page.getByRole("heading", { name: /random/ })).toBeVisible();
});

test("login page and chat screen have no serious accessibility violations", async ({ browser }) => {
  const anonCtx = await browser.newContext();
  const anon = await anonCtx.newPage();
  await anon.goto("/login");
  const loginScan = await new AxeBuilder({ page: anon }).analyze();
  expect(loginScan.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);

  const ada = await newUser(browser, "Ada");
  await send(ada.page, "accessibility check");
  await expect(ada.page.getByText("Sent").last()).toBeVisible();
  const chatScan = await new AxeBuilder({ page: ada.page }).analyze();
  expect(chatScan.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
});

test("wrong password shows a clear error", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("nobody@example.com");
  await page.getByLabel("Password").fill("not the password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toHaveText("Email or password is incorrect");
});

test("reload restores the session when only the access cookie has expired", async ({ browser }) => {
  const user = await newUser(browser, "Session restore");
  const text = `Session continuity ${Date.now()}`;
  await send(user.page, text);
  await expect(user.page.getByText("Sent").last()).toBeVisible();
  await user.context.clearCookies({ name: "relay_at" });
  await user.page.reload();
  await expect(user.page.getByRole("log").getByText(text)).toBeVisible();
  await expect(user.page).toHaveURL(/\/c\/relay\/general$/);
  await user.context.close();
});

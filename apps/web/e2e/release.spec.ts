import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { send } from "./helpers";

test("private invitation survives signup and cannot be reused", async ({ browser, baseURL }) => {
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await owner.goto("/login");
  await owner.getByLabel("Email").fill("superadmin@relay.test");
  await owner.getByLabel("Password", { exact: true }).fill("correct horse battery");
  await owner.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(owner.getByRole("heading", { name: /general/ })).toBeVisible();
  const created = await owner.request.post("/api/v1/superadmin/communities", {
    headers: { origin: baseURL!, "x-relay-csrf": "1" },
    data: { name: "Release vault", slug: "release-vault", isPrivate: true, ownerEmail: "superadmin@relay.test" },
  });
  expect(created.status()).toBe(201);
  const community = await created.json();
  await owner.reload();
  await owner.getByLabel("Community", { exact: true }).selectOption(community.id);
  await expect(owner).toHaveURL(/\/c\/release-vault\/general$/);
  await owner.getByRole("button", { name: "Admin tools" }).click();
  await owner.getByRole("button", { name: "Invite people", exact: true }).click();
  const dialog = owner.getByRole("dialog", { name: "Invite people" });
  const email = `invited-${Date.now()}@example.com`;
  await dialog.getByLabel("Email address").fill(email);
  await dialog.getByRole("button", { name: "Create invitation", exact: true }).click();
  const link = dialog.locator("#invite-share-link");
  await expect(link).toBeVisible();
  const invitationUrl = await link.inputValue();
  expect(new URL(invitationUrl).hash).toMatch(/^#[a-f0-9]{64}$/);
  const scan = await new AxeBuilder({ page: owner }).analyze();
  expect(scan.violations.filter((v) => v.impact === "critical" || v.impact === "serious").map((v) => v.id)).toEqual([]);
  await owner.screenshot({ path: "test-results/release-invitation.png" });
  await dialog.getByRole("button", { name: "Close", exact: true }).click();

  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await guest.goto(invitationUrl);
  await expect(guest).toHaveURL(/\/login$/);
  await guest.getByRole("link", { name: "Create an account" }).click();
  await guest.getByLabel("Display name").fill("Invited guest");
  await guest.getByLabel("Email", { exact: true }).fill(email);
  await guest.getByLabel("Password", { exact: true }).fill("correct horse battery");
  await guest.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(guest.getByRole("heading", { name: "Join a community" })).toBeVisible();
  await guest.getByRole("button", { name: "Accept invitation", exact: true }).click();
  await expect(guest).toHaveURL(/\/c\/release-vault\/general$/);
  const text = `Invited conversation ${Date.now()}`;
  await send(owner, text);
  await expect(guest.getByRole("log").getByText(text)).toBeVisible();
  await guest.goto(invitationUrl);
  await guest.getByRole("button", { name: "Accept invitation", exact: true }).click();
  await expect(guest.getByRole("alert")).toContainText("already used");
  await ownerContext.close();
  await guestContext.close();
});

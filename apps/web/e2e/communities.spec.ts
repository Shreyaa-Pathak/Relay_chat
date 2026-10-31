import { expect, test } from "@playwright/test";
import { newUser, send } from "./helpers";

test("superadmin creates a community and its owner manages private channel access", async ({ browser }) => {
  const owner = await newUser(browser, "Community owner");
  const member = await newUser(browser, "Community member");
  const rootContext = await browser.newContext();
  const root = await rootContext.newPage();
  await root.goto("/login");
  await root.getByLabel("Email").fill("superadmin@relay.test");
  await root.getByLabel("Password", { exact: true }).fill("correct horse battery");
  await root.getByRole("button", { name: "Sign in", exact: true }).click();
  await root.getByRole("button", { name: "Admin tools" }).click();
  await root.getByRole("button", { name: "Manage communities" }).click();
  const management = root.getByRole("dialog", { name: "Manage communities", exact: true });
  await management.getByLabel("Business / community name").fill("Studio community");
  await management.getByLabel("Slug", { exact: true }).fill("studio");
  await management.getByLabel("Description", { exact: true }).fill("The studio community");
  await management.getByLabel("Owner email", { exact: true }).fill(owner.email);
  await management.getByRole("button", { name: "Create community", exact: true }).click();
  await expect(management.getByRole("status")).toHaveText("Community created with a general channel.");
  await root.screenshot({ path: "test-results/community-management.png" });
  await management.getByRole("button", { name: "Close", exact: true }).click();

  await owner.page.reload();
  const switcher = owner.page.getByLabel("Community", { exact: true });
  await expect(switcher.getByRole("option", { name: "Studio community (owner)" })).toHaveCount(1);
  const communityId = await switcher.getByRole("option", { name: "Studio community (owner)" }).getAttribute("value");
  await switcher.selectOption(communityId!);
  await expect(owner.page).toHaveURL(/\/c\/studio\/general$/);
  await expect(owner.page.getByRole("button", { name: "Manage communities" })).toHaveCount(0);

  await member.page.getByRole("button", { name: "Discover communities" }).click();
  const discover = member.page.getByRole("dialog", { name: "Discover communities" });
  await discover.getByRole("listitem").filter({ hasText: "Studio community" }).getByRole("button", { name: "Join", exact: true }).click();
  await expect(member.page).toHaveURL(/\/c\/studio\/general$/);
  await member.page.goto(`/c/${communityId}/general`);
  await expect(member.page).toHaveURL(/\/c\/studio\/general$/);
  await expect(member.page.getByRole("button", { name: "Create channel", exact: true })).toHaveCount(0);

  await owner.page.getByRole("button", { name: "Create channel", exact: true }).click();
  const create = owner.page.getByRole("dialog", { name: "Create a channel" });
  await create.getByLabel("Channel name").fill("Staff");
  await create.getByLabel("Channel slug").fill("staff");
  await create.getByRole("checkbox", { name: /Private channel/ }).check();
  await create.getByRole("button", { name: "Create channel", exact: true }).click();
  await expect(owner.page.getByRole("heading", { name: /Staff/ })).toBeVisible();
  await expect(member.page.getByRole("link", { name: "Staff", exact: true })).toHaveCount(0);

  await owner.page.getByRole("button", { name: "Admin tools" }).click();
  await owner.page.getByRole("button", { name: "Members and channels", exact: true }).click();
  const members = owner.page.getByRole("dialog", { name: "Members and channels" });
  await members.getByRole("region", { name: "Manage channels" }).getByRole("listitem").filter({ hasText: "#Staff" }).getByRole("button", { name: "Access", exact: true }).click();
  await members.getByRole("listitem").filter({ hasText: "Community member" }).filter({ has: owner.page.getByRole("button", { name: "Add", exact: true }) }).getByRole("button", { name: "Add", exact: true }).click();
  await expect(members.getByRole("status")).toHaveText("Channel access updated.");
  await owner.page.screenshot({ path: "test-results/private-channel-access.png" });
  await members.getByRole("button", { name: "Close", exact: true }).click();
  await expect(member.page.getByRole("link", { name: "Staff", exact: true })).toBeVisible();
  await member.page.getByRole("link", { name: "Staff", exact: true }).click();
  const text = `Private conversation ${Date.now()}`;
  await send(owner.page, text);
  await expect(member.page.getByRole("log").getByText(text)).toBeVisible();
  await rootContext.close();
  await owner.context.close();
  await member.context.close();
});

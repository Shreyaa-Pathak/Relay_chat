import { expect, type Browser, type Page } from "@playwright/test";

let n = 0;
export async function newUser(browser: Browser, name: string, contextOpts: Parameters<Browser["newContext"]>[0] = {}) {
  const context = await browser.newContext(contextOpts);
  const page = await context.newPage();
  const email = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}-${n++}@example.com`;
  await page.goto("/register");
  await page.getByLabel("Display name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/c\/relay\/general$/);
  await expect(page.getByRole("heading", { name: /general/ })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Connected" }).first()).toBeAttached();
  return { context, page, email };
}

export async function send(page: Page, text: string, placeholder: string | RegExp = /Message #/) {
  const box = page.getByPlaceholder(placeholder);
  await box.fill(text);
  await box.press("Enter");
}

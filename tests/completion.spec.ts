import { test, expect, type BrowserContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import sharp from "sharp";
import pg from "pg";
import { readFile } from "node:fs/promises";
const origin = "http://localhost:3018";
async function login(c: BrowserContext, role: string) {
  const r = await c.request.post("/api/auth/rehearsal", {
    headers: { Origin: origin },
    data: { role },
  });
  expect(r.ok()).toBeTruthy();
  return r.json();
}
test("new management and profile surfaces reflow in English and Malayalam with accessible controls", async ({
  browser,
}) => {
  const c = await browser.newContext({
    baseURL: origin,
    viewport: { width: 360, height: 800 },
  });
  const f = await login(c, "admin");
  const page = await c.newPage();
  for (const view of [
    "staff",
    "display",
    "branding",
    "operations",
    "profile",
  ]) {
    await page.goto(`/auctions/${f.auctionId}/${view}`);
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator(".connection")).toContainText("synchronized");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      view,
    ).toBeTruthy();
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze()
      ).violations,
      view,
    ).toEqual([]);
    await page.screenshot({
      path: `artifacts/${view}-360.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "മലയാളം", exact: true }).click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      view + " Malayalam",
    ).toBeTruthy();
    await page.getByRole("button", { name: "English", exact: true }).click();
  }
  await page.setViewportSize({ width: 844, height: 390 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() => document.activeElement !== document.body),
  ).toBeTruthy();
  await c.close();
});
test("private projection rotates and loses access immediately after revocation", async ({
  browser,
}) => {
  const c = await browser.newContext({ baseURL: origin });
  const f = await login(c, "admin");
  const created = await c.request.post(`/api/auctions/${f.auctionId}/display`, {
    headers: { Origin: origin },
    data: {},
  });
  expect(created.ok()).toBeTruthy();
  const token = (await created.json()).token;
  const publicContext = await browser.newContext({
    baseURL: origin,
    viewport: { width: 1920, height: 1080 },
  });
  const page = await publicContext.newPage();
  await page.goto(`/display/${token}`);
  await expect(page.getByRole("heading", { name: "All teams" })).toBeVisible();
  const revoked = await c.request.post(
    `/api/auctions/${f.auctionId}/display/revoke`,
    { headers: { Origin: origin }, data: {} },
  );
  expect(revoked.ok()).toBeTruthy();
  await expect(
    page.getByText(
      "Display access is unavailable or expired. Ask the organizer for a new link.",
    ),
  ).toBeVisible({ timeout: 7000 });
  await Promise.all([c.close(), publicContext.close()]);
});
test("a player saves a photo profile, reuses it, registers, and withdraws before bidding", async ({
  browser,
}) => {
  const c = await browser.newContext({
    baseURL: origin,
    viewport: { width: 390, height: 844 },
  });
  const f = await login(c, "managerA");
  const auctions = await (await c.request.get("/api/auctions")).json();
  const other = auctions.find((a: any) => a.id !== f.auctionId);
  const page = await c.newPage();
  await page.goto(`/auctions/${other.id}/profile`);
  await page.getByLabel("Full name", { exact: true }).fill("Mobile Profile");
  await page.getByLabel("Date of birth", { exact: true }).fill("1991-04-05");
  await page.getByLabel("Phone number", { exact: true }).fill("555-0199");
  await page.getByLabel("Location", { exact: true }).fill("Kochi");
  await page.getByLabel("Batting style", { exact: true }).fill("Right hand");
  await page.getByLabel("Bowling style", { exact: true }).fill("None");
  const photo = await sharp({
    create: { width: 128, height: 128, channels: 3, background: "#0759d3" },
  })
    .png()
    .toBuffer();
  await page.getByLabel("Player photo", { exact: true }).setInputFiles({
    name: "profile.png",
    mimeType: "image/png",
    buffer: photo,
  });
  await page
    .getByRole("button", { name: "Save reusable profile", exact: true })
    .click();
  await expect(page.getByText("Profile saved.", { exact: true })).toBeVisible();
  await page.goto(`/auctions/${other.id}/register`);
  await expect(page.getByLabel("Full name", { exact: true })).toHaveValue(
    "Mobile Profile",
  );
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Submit for approval", exact: true })
    .click();
  await expect(
    page.getByText("Submitted. Your club will review your application.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.goto(`/auctions/${other.id}/profile`);
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Withdraw from this auction", exact: true })
    .click();
  await expect
    .poll(async () => {
      const result = await c.request.get(
        `/api/auctions/${other.id}/my-registration`,
      );
      return (await result.json()).players[0]?.status;
    })
    .toBe("WITHDRAWN");
  await c.close();
});
test("platform catalog and manual requests have a usable mobile console", async ({
  browser,
}) => {
  process.loadEnvFile(".env");
  const f = JSON.parse(await readFile("artifacts/rehearsal.json", "utf8"));
  const owner = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await owner.connect();
  await owner.query(
    "INSERT INTO platform_operators(user_id) VALUES($1) ON CONFLICT DO NOTHING",
    [f.admin],
  );
  await owner.end();
  const c = await browser.newContext({
    baseURL: origin,
    viewport: { width: 360, height: 800 },
  });
  await login(c, "admin");
  const page = await c.newPage();
  await page.goto(`/auctions/${f.auction}/platform`);
  await expect(
    page.getByRole("heading", { name: "Platform console", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Product code", { exact: true }).fill("MOBILE_TEST");
  await page.getByLabel("Auction credits", { exact: true }).fill("2");
  await page
    .getByLabel("Price in minor currency units (paise for INR)", {
      exact: true,
    })
    .fill("10000");
  await page.getByRole("button", { name: "Save product", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Save product", exact: true }),
  ).toBeEnabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({ path: "artifacts/platform-360.png", fullPage: true });
  await c.close();
});

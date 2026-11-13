import { test, expect, type BrowserContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const origin = "http://localhost:3018";
async function login(context: BrowserContext, role: string) {
  const r = await context.request.post("/api/auth/rehearsal", {
    data: { role },
    headers: { Origin: origin },
  });
  expect(r.ok()).toBeTruthy();
  return r.json();
}
async function command(
  context: BrowserContext,
  id: string,
  type: string,
  extra: any = {},
) {
  const r = await context.request.post(`/api/auctions/${id}/commands`, {
    data: { commandId: crypto.randomUUID(), type, ...extra },
    headers: { Origin: origin },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  return r.json();
}
test("two managers share committed bids, offline bidding blocks, settlement reaches projection and layouts stay accessible", async ({
  browser,
}) => {
  const admin = await browser.newContext({ baseURL: origin });
  const f = await login(admin, "admin");
  let snapshot = await (
    await admin.request.get(`/api/auctions/${f.auctionId}/snapshot`)
  ).json();
  if (snapshot.status === "REGISTRATION_OPEN") {
    await command(admin, f.auctionId, "LOCK");
    await command(admin, f.auctionId, "START");
  }
  snapshot = await (
    await admin.request.get(`/api/auctions/${f.auctionId}/snapshot`)
  ).json();
  let lot = snapshot.lots.find((l: any) =>
    ["PREVIEW", "OPEN", "CLOSED"].includes(l.status),
  );
  if (!lot) {
    const registration = snapshot.players.find(
      (p: any) => !snapshot.lots.some((l: any) => l.registrationId === p.id),
    );
    const picked = await command(admin, f.auctionId, "SELECT", {
      registrationId: registration.id,
    });
    lot = { id: picked.lotId, version: 1, status: "PREVIEW" };
  }
  if (lot.status === "PREVIEW")
    await command(admin, f.auctionId, "OPEN", {
      lotId: lot.id,
      expectedVersion: lot.version,
    });
  const a = await browser.newContext({
    baseURL: origin,
    viewport: { width: 390, height: 844 },
  });
  const b = await browser.newContext({
    baseURL: origin,
    viewport: { width: 375, height: 812 },
  });
  await login(a, "managerA");
  await login(b, "managerB");
  const pa = await a.newPage(),
    pb = await b.newPage();
  await Promise.all([
    pa.goto(`/auctions/${f.auctionId}/live`),
    pb.goto(`/auctions/${f.auctionId}/live`),
  ]);
  await expect(
    pa.getByRole("button", { name: /Bid 300 points/ }),
  ).toBeEnabled();
  await pa.getByRole("button", { name: /Bid 300 points/ }).click();
  await expect(
    pa.getByRole("button", { name: "✓ You are leading" }),
  ).toBeDisabled();
  await expect(
    pb.getByRole("button", { name: /Bid 400 points/ }),
  ).toBeEnabled();
  await a.setOffline(true);
  await expect(pa.getByRole("button", { name: /Reconnecting/ })).toBeDisabled({
    timeout: 30000,
  });
  await a.setOffline(false);
  await expect(
    pa.getByRole("button", { name: "✓ You are leading" }),
  ).toBeDisabled({ timeout: 20000 });
  const latest = await (
    await admin.request.get(`/api/auctions/${f.auctionId}/snapshot`)
  ).json();
  lot = latest.lots.find((l: any) => l.id === lot.id);
  await command(admin, f.auctionId, "CLOSE", {
    lotId: lot.id,
    expectedVersion: lot.version,
  });
  await command(admin, f.auctionId, "SELL", {
    lotId: lot.id,
    expectedVersion: lot.version + 1,
  });
  await expect(
    pa.getByRole("button", { name: "Bidding closed" }),
  ).toBeDisabled();
  for (const width of [320, 360, 375, 390, 768, 1440, 1920]) {
    await pa.setViewportSize({ width, height: width >= 1440 ? 1080 : 844 });
    expect(
      await pa.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `overflow at ${width}`,
    ).toBeTruthy();
    await pa.screenshot({
      path: `artifacts/live-${width}.png`,
      fullPage: true,
    });
  }
  const accessibility = await new AxeBuilder({ page: pa })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await pa.getByRole("button", { name: "മലയാളം" }).click();
  await expect(
    pa.getByRole("heading", { name: "തത്സമയ ലേലം", exact: true }),
  ).toBeVisible();
  await pa.setViewportSize({ width: 360, height: 800 });
  expect(
    await pa.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await pa.screenshot({
    path: "artifacts/live-malayalam-360.png",
    fullPage: true,
  });
  expect(
    (
      await new AxeBuilder({ page: pa })
        .withTags(["wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  const display = await admin.newPage();
  await display.goto(`/display/${f.auctionId}`);
  await expect(display.getByText("Sold", { exact: true })).toBeVisible();
  const publicData = await (
    await display.request.get(`/api/auctions/${f.auctionId}/public`)
  ).text();
  expect(publicData).not.toContain("555-0100");
  expect(publicData).not.toContain("@");
  await display.setViewportSize({ width: 1920, height: 1080 });
  await display.screenshot({
    path: "artifacts/projection-1920.png",
    fullPage: true,
  });
  await Promise.all([a.close(), b.close(), admin.close()]);
});
test("organizer mobile navigation, forms, reports and keyboard focus", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: origin,
    viewport: { width: 360, height: 800 },
  });
  const f = await login(context, "admin");
  const page = await context.newPage();
  for (const view of [
    "overview",
    "players",
    "squad",
    "setup",
    "approvals",
    "billing",
    "reports",
    "register",
  ]) {
    await page.goto(`/auctions/${f.auctionId}/${view}`);
    await expect(page.locator("h1")).toBeVisible();
    await expect(
      page.getByText("Connected · synchronized", { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      view,
    ).toBeTruthy();
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(axe.violations, view).toEqual([]);
    await page.screenshot({
      path: `artifacts/${view}-360.png`,
      fullPage: true,
    });
  }
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() => document.activeElement !== document.body),
  ).toBeTruthy();
  await context.close();
});
test("uncertain bid retains its command ID and needs a deliberate synchronized retry", async ({
  browser,
}) => {
  const admin = await browser.newContext({ baseURL: origin });
  const f = await login(admin, "admin");
  const snap = await (
    await admin.request.get(`/api/auctions/${f.auctionId}/snapshot`)
  ).json();
  const registration = snap.players.find(
    (p: any) => !snap.lots.some((l: any) => l.registrationId === p.id),
  );
  const selected = await command(admin, f.auctionId, "SELECT", {
    registrationId: registration.id,
  });
  await command(admin, f.auctionId, "OPEN", {
    lotId: selected.lotId,
    expectedVersion: 1,
  });
  const context = await browser.newContext({
    baseURL: origin,
    serviceWorkers: "block",
    viewport: { width: 390, height: 844 },
  });
  await login(context, "managerA");
  const page = await context.newPage();
  await page.goto(`/auctions/${f.auctionId}/live`);
  const bid = page.getByRole("button", { name: /Bid 300 points/ });
  await expect(bid).toBeEnabled();
  let originalId = "";
  await page.route(
    "**/api/auctions/*/commands",
    (route) => {
      originalId = route.request().postDataJSON().commandId;
      return route.abort("failed");
    },
    { times: 1 },
  );
  await bid.click();
  const check = page.getByRole("button", {
    name: "Check bid result",
    exact: true,
  });
  await expect(check).toBeEnabled();
  await context.setOffline(true);
  await expect(check).toBeDisabled();
  await context.setOffline(false);
  await expect(check).toBeEnabled();
  const before = await (
    await admin.request.get(`/api/auctions/${f.auctionId}/snapshot`)
  ).json();
  expect(
    before.lots.find((l: any) => l.id === selected.lotId).amount,
  ).toBeNull();
  const response = page.waitForResponse(
    (r) => r.url().includes("/commands") && r.request().method() === "POST",
  );
  await check.click();
  expect((await (await response).json()).commandId).toBe(originalId);
  await expect(
    page.getByRole("button", { name: "✓ You are leading" }),
  ).toBeDisabled();
  await Promise.all([context.close(), admin.close()]);
});
test("bid rate limits distinguish managers sharing a venue connection", async ({
  browser,
}) => {
  const a = await browser.newContext({ baseURL: origin }),
    b = await browser.newContext({ baseURL: origin });
  const f = await login(a, "managerA");
  await login(b, "managerB");
  let last = 0;
  for (let i = 0; i < 105; i++) {
    const r = await a.request.post(`/api/auctions/${f.auctionId}/commands`, {
      data: {},
      headers: { Origin: origin },
    });
    last = r.status();
  }
  expect(last).toBe(429);
  const other = await b.request.post(`/api/auctions/${f.auctionId}/commands`, {
    data: {},
    headers: { Origin: origin },
  });
  expect(other.status()).not.toBe(429);
  await Promise.all([a.close(), b.close()]);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { sanitizeImage } from "../src/storage.ts";
import { verifyWebhook } from "../src/commerce.ts";
test("image extension or MIME cannot turn executable content into an image", async () => {
  await assert.rejects(
    sanitizeImage(Buffer.from("<script>alert(1)</script>")),
    /INVALID_IMAGE/,
  );
  await assert.rejects(
    sanitizeImage(Buffer.alloc(5 * 1024 * 1024 + 1)),
    /IMAGE_TOO_LARGE/,
  );
});
test("signed payment webhook requires exact raw body and configured secret", () => {
  const body = Buffer.from('{"event":"payment.captured"}');
  const signature = createHmac("sha256", "test-secret")
    .update(body)
    .digest("hex");
  assert.doesNotThrow(() => verifyWebhook(body, signature, "test-secret"));
  assert.throws(
    () => verifyWebhook(Buffer.from("{}"), signature, "test-secret"),
    /INVALID_SIGNATURE/,
  );
  assert.throws(
    () => verifyWebhook(body, "bad", "test-secret"),
    /INVALID_SIGNATURE/,
  );
  assert.throws(
    () => verifyWebhook(body, signature, ""),
    /PAYMENTS_NOT_CONFIGURED/,
  );
});
test("OIDC start uses nonce and PKCE; callback rejects altered state before network exchange", async () => {
  const { beginLogin, finishLogin } = await import("../src/auth.ts");
  process.env.AUTH_COOKIE_SECRET = "fixture-secret-32-characters-long-enough";
  process.env.OIDC_AUTHORIZATION_URL =
    "https://identity.example.invalid/authorize";
  process.env.OIDC_CLIENT_ID = "fixture-client";
  process.env.WEB_ORIGIN = "http://localhost:3018";
  const flow = beginLogin("/auctions/fixture/register");
  const u = new URL(flow.url);
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.ok(u.searchParams.get("nonce"));
  assert.equal(u.searchParams.get("response_type"), "code");
  await assert.rejects(
    finishLogin("code", "wrong-state", flow.cookie),
    /INVALID_LOGIN/,
  );
  await assert.rejects(
    finishLogin(
      "code",
      u.searchParams.get("state")!,
      flow.cookie.replace("msn_oauth=", "msn_oauth=altered"),
    ),
    /INVALID_LOGIN/,
  );
  const { pool } = await import("../../../packages/database/src/db.ts");
  await pool.end();
});
test("privileged-session MFA recognizes verified provider claims only", async () => {
  const { verifiedMFA } = await import("../src/auth.ts");
  assert.equal(verifiedMFA({ amr: ["pwd"] }), false);
  assert.equal(verifiedMFA({ amr: ["pwd", "mfa"] }), true);
  assert.equal(verifiedMFA({ mfa: true }), false);
});

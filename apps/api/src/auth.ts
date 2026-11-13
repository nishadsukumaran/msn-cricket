import {
  createHash,
  randomBytes,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { pool, transaction } from "../../../packages/database/src/db.ts";
export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export async function actorFor(cookie: string | undefined) {
  const token = cookie
    ?.split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith("msn_session="))
    ?.slice(12);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw Error("UNAUTHENTICATED");
  const result = await pool.query("SELECT session_actor($1) actor", [
    hashToken(token),
  ]);
  const actor = result.rows[0]?.actor;
  if (!actor) throw Error("UNAUTHENTICATED");
  if (process.env.NODE_ENV === "production") {
    const context = (
      await pool.query("SELECT session_context($1) data", [hashToken(token)])
    ).rows[0].data;
    if (context?.privileged && !context.mfa) throw Error("MFA_REQUIRED");
  }
  return actor as string;
}
export function verifiedMFA(payload: any) {
  const values = (process.env.OIDC_MFA_ACR_VALUES ?? "")
    .split(",")
    .filter(Boolean);
  return (
    (Array.isArray(payload.amr) && payload.amr.includes("mfa")) ||
    (typeof payload.acr === "string" && values.includes(payload.acr))
  );
}
export async function exchangeIdentity(token: string, nonce?: string) {
  const { OIDC_ISSUER, OIDC_AUDIENCE, OIDC_JWKS_URL } = process.env;
  if (!OIDC_ISSUER || !OIDC_AUDIENCE || !OIDC_JWKS_URL)
    throw Error("IDENTITY_NOT_CONFIGURED");
  const { payload } = await jwtVerify(
    token,
    createRemoteJWKSet(new URL(OIDC_JWKS_URL)),
    {
      issuer: OIDC_ISSUER,
      audience: OIDC_AUDIENCE,
      algorithms: ["RS256", "ES256"],
    },
  );
  if (nonce && payload.nonce !== nonce) throw Error("INVALID_LOGIN");
  if (
    !payload.sub ||
    payload.email_verified !== true ||
    typeof payload.email !== "string"
  )
    throw Error("VERIFIED_EMAIL_REQUIRED");
  const result = await pool.query("SELECT identity_user($1,$2) actor", [
    OIDC_ISSUER + "|" + payload.sub,
    payload.email,
  ]);
  const actor = result.rows[0].actor;
  const session = randomBytes(32).toString("hex");
  await transaction(actor, async (db) => {
    await db.query("SELECT save_verified_session($1,$2,$3)", [
      hashToken(session),
      actor,
      verifiedMFA(payload),
    ]);
  });
  return session;
}
export function sessionCookie(token: string) {
  return `msn_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}

function oauthSecret() {
  const secret = process.env.AUTH_COOKIE_SECRET;
  if (!secret || secret.length < 32) throw Error("IDENTITY_NOT_CONFIGURED");
  return secret;
}
const cookieValue = (cookies: string | undefined, name: string) =>
  cookies
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(name + "="))
    ?.slice(name.length + 1);
export function beginLogin(next?: string) {
  const { OIDC_AUTHORIZATION_URL, OIDC_CLIENT_ID, WEB_ORIGIN } = process.env;
  if (!OIDC_AUTHORIZATION_URL || !OIDC_CLIENT_ID || !WEB_ORIGIN)
    throw Error("IDENTITY_NOT_CONFIGURED");
  const state = randomBytes(24).toString("hex"),
    nonce = randomBytes(24).toString("hex"),
    verifier = randomBytes(48).toString("base64url");
  const envelope = Buffer.from(
    JSON.stringify({
      state,
      nonce,
      verifier,
      created: Date.now(),
      next: next?.startsWith("/auctions/") ? next : "/",
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", oauthSecret())
    .update(envelope)
    .digest("hex");
  const url = new URL(OIDC_AUTHORIZATION_URL);
  url.search = new URLSearchParams({
    client_id: OIDC_CLIENT_ID,
    redirect_uri: WEB_ORIGIN + "/api/auth/callback",
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  if (process.env.OIDC_MFA_ACR_VALUES)
    url.searchParams.set(
      "acr_values",
      process.env.OIDC_MFA_ACR_VALUES.replaceAll(",", " "),
    );
  return {
    url: url.toString(),
    cookie: `msn_oauth=${envelope}.${signature}; HttpOnly; SameSite=Lax; Path=/api/auth; Max-Age=600${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
  };
}
export async function finishLogin(
  code: string,
  state: string,
  cookies: string | undefined,
) {
  const cookie = cookieValue(cookies, "msn_oauth");
  if (!cookie) throw Error("INVALID_LOGIN");
  const [envelope, sig] = cookie.split(".");
  const signature = createHmac("sha256", oauthSecret())
    .update(envelope)
    .digest("hex");
  if (
    !sig ||
    sig.length !== signature.length ||
    !timingSafeEqual(Buffer.from(sig), Buffer.from(signature))
  )
    throw Error("INVALID_LOGIN");
  const context = JSON.parse(Buffer.from(envelope, "base64url").toString());
  if (state !== context.state || Date.now() - context.created > 600000)
    throw Error("INVALID_LOGIN");
  if (
    !process.env.OIDC_TOKEN_URL ||
    !process.env.OIDC_CLIENT_ID ||
    !process.env.WEB_ORIGIN
  )
    throw Error("IDENTITY_NOT_CONFIGURED");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: process.env.WEB_ORIGIN + "/api/auth/callback",
    client_id: process.env.OIDC_CLIENT_ID,
    code_verifier: context.verifier,
  });
  if (process.env.OIDC_CLIENT_SECRET)
    body.set("client_secret", process.env.OIDC_CLIENT_SECRET);
  const response = await fetch(process.env.OIDC_TOKEN_URL, {
    method: "POST",
    body,
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw Error("INVALID_LOGIN");
  const result: any = await response.json();
  if (typeof result.id_token !== "string") throw Error("INVALID_LOGIN");
  return {
    session: await exchangeIdentity(result.id_token, context.nonce),
    next: context.next,
  };
}

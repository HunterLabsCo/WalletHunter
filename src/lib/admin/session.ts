/**
 * Admin session management — completely separate from regular user auth.
 *
 * Uses HMAC-SHA256 signed tokens stored in HTTP-only cookies.
 * Built on Web Crypto API so it works in both Node and Edge runtimes
 * (the middleware needs to verify cookies in the Edge runtime).
 */

const COOKIE_NAME = "wh_admin_session";
const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8 hours

export interface AdminSessionPayload {
  adminId: string;
  username: string;
  role: "owner" | "admin";
  exp: number; // unix seconds
}

function getSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.ADMIN_SECRET;
  if (!secret) {
    throw new Error("NEXTAUTH_SECRET (or ADMIN_SECRET) is required for admin sessions");
  }
  return secret;
}

function base64UrlEncode(bytes: Uint8Array | string): string {
  const data =
    typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let bin = "";
  for (let i = 0; i < data.length; i++) bin += String.fromCharCode(data[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): Uint8Array {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  const bin = atob(str.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function sign(data: string, secret: string): Promise<string> {
  const key = await importKey(secret);
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(data)
  );
  return base64UrlEncode(new Uint8Array(sig));
}

async function verifySignature(
  data: string,
  signature: string,
  secret: string
): Promise<boolean> {
  const key = await importKey(secret);
  const sigBytes = base64UrlDecode(signature);
  return crypto.subtle.verify(
    "HMAC",
    key,
    sigBytes as BufferSource,
    new TextEncoder().encode(data)
  );
}

export async function createAdminToken(
  adminId: string,
  username: string,
  role: "owner" | "admin"
): Promise<string> {
  const payload: AdminSessionPayload = {
    adminId,
    username,
    role,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const signature = await sign(payloadB64, getSecret());
  return `${payloadB64}.${signature}`;
}

export async function verifyAdminToken(
  token: string | undefined | null
): Promise<AdminSessionPayload | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [payloadB64, signature] = parts;
  let secret: string;
  try {
    secret = getSecret();
  } catch {
    return null;
  }

  const valid = await verifySignature(payloadB64, signature, secret);
  if (!valid) return null;

  try {
    const payloadJson = new TextDecoder().decode(base64UrlDecode(payloadB64));
    const payload = JSON.parse(payloadJson) as AdminSessionPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export const ADMIN_COOKIE_NAME = COOKIE_NAME;
export const ADMIN_COOKIE_MAX_AGE = SESSION_TTL_SECONDS;

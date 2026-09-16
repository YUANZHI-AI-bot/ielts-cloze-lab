const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MAX_STATE_BYTES = 1024 * 1024;
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 365;

function b64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromB64url(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function randomId(prefix = "") {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return `${prefix}${b64url(bytes)}`;
}

function json(body, status = 200, origin = null) {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  };
  if (origin === "https://yuanzhi-ai-bot.github.io") {
    headers["access-control-allow-origin"] = origin;
    headers.vary = "Origin";
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function error(message, status, origin) {
  return json({ error: message }, status, origin);
}

async function bodyOf(request, origin) {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    return error("请求格式不正确。", 400, origin);
  }
}

function validPassphrase(value) {
  return typeof value === "string" && value.length >= 10 && value.length <= 128;
}

function validState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    return encoder.encode(JSON.stringify(value)).byteLength <= MAX_STATE_BYTES;
  } catch {
    return false;
  }
}

async function passwordHash(passphrase, salt) {
  const material = await crypto.subtle.importKey("raw", encoder.encode(passphrase), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: fromB64url(salt), iterations: 100000 }, material, 256);
  return b64url(new Uint8Array(bits));
}

function same(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function signingKey(env) {
  return crypto.subtle.importKey("raw", encoder.encode(env.SYNC_TOKEN_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function tokenFor(id, env) {
  const payload = b64url(encoder.encode(JSON.stringify({ id, exp: Date.now() + TOKEN_TTL_MS })));
  const signature = b64url(new Uint8Array(await crypto.subtle.sign("HMAC", await signingKey(env), encoder.encode(payload))));
  return `${payload}.${signature}`;
}

async function authenticatedId(request, env) {
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  try {
    const valid = await crypto.subtle.verify("HMAC", await signingKey(env), fromB64url(signature), encoder.encode(payload));
    if (!valid) return null;
    const parsed = JSON.parse(decoder.decode(fromB64url(payload)));
    return typeof parsed.id === "string" && typeof parsed.exp === "number" && parsed.exp > Date.now() ? parsed.id : null;
  } catch {
    return null;
  }
}

async function api(request, env) {
  const origin = request.headers.get("origin");
  const url = new URL(request.url);
  if (request.method === "OPTIONS") {
    if (origin === "https://yuanzhi-ai-bot.github.io") {
      return new Response(null, { status: 204, headers: { "access-control-allow-origin": origin, "access-control-allow-methods": "GET, POST, PUT, OPTIONS", "access-control-allow-headers": "authorization, content-type", vary: "Origin" } });
    }
    return new Response(null, { status: 204 });
  }

  if (url.pathname === "/api/v1/register" && request.method === "POST") {
    const body = await bodyOf(request, origin);
    if (body instanceof Response) return body;
    if (!validPassphrase(body.passphrase)) return error("同步口令需为 10–128 个字符。", 400, origin);
    if (!validState(body.state)) return error("词库数据无效或过大。", 400, origin);
    const id = randomId("vault_");
    const salt = randomId();
    const hash = await passwordHash(body.passphrase, salt);
    const now = Date.now();
    await env.DB.prepare("INSERT INTO sync_vaults (id, password_hash, salt, state_json, revision, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)")
      .bind(id, hash, salt, JSON.stringify(body.state), now, now).run();
    return json({ vaultId: id, token: await tokenFor(id, env), state: body.state, revision: 1 }, 201, origin);
  }

  if (url.pathname === "/api/v1/login" && request.method === "POST") {
    const body = await bodyOf(request, origin);
    if (body instanceof Response) return body;
    if (typeof body.vaultId !== "string" || !validPassphrase(body.passphrase)) return error("同步 ID 或口令不正确。", 400, origin);
    const row = await env.DB.prepare("SELECT password_hash, salt, state_json, revision, updated_at FROM sync_vaults WHERE id = ?").bind(body.vaultId).first();
    if (!row || !same(await passwordHash(body.passphrase, row.salt), row.password_hash)) return error("同步 ID 或口令不正确。", 401, origin);
    return json({ vaultId: body.vaultId, token: await tokenFor(body.vaultId, env), state: JSON.parse(row.state_json), revision: row.revision, updatedAt: row.updated_at }, 200, origin);
  }

  const id = await authenticatedId(request, env);
  if (!id) return error("同步会话已失效，请重新连接词库。", 401, origin);

  if (url.pathname === "/api/v1/state" && request.method === "GET") {
    const row = await env.DB.prepare("SELECT state_json, revision, updated_at FROM sync_vaults WHERE id = ?").bind(id).first();
    if (!row) return error("未找到云端词库。", 404, origin);
    return json({ state: JSON.parse(row.state_json), revision: row.revision, updatedAt: row.updated_at }, 200, origin);
  }

  if (url.pathname === "/api/v1/state" && request.method === "PUT") {
    const body = await bodyOf(request, origin);
    if (body instanceof Response) return body;
    if (!validState(body.state)) return error("词库数据无效或过大。", 400, origin);
    const now = Date.now();
    const result = await env.DB.prepare("UPDATE sync_vaults SET state_json = ?, revision = revision + 1, updated_at = ? WHERE id = ?")
      .bind(JSON.stringify(body.state), now, id).run();
    if (!result.meta.changes) return error("未找到云端词库。", 404, origin);
    const row = await env.DB.prepare("SELECT revision FROM sync_vaults WHERE id = ?").bind(id).first();
    return json({ revision: row.revision, updatedAt: now }, 200, origin);
  }

  return error("找不到该同步接口。", 404, origin);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await api(request, env);
      } catch (cause) {
        console.error("Cloud sync API error", cause);
        return error("云端同步暂时不可用，请保留本地内容后稍后重试。", 503, request.headers.get("origin"));
      }
    }
    if (env.ASSETS) {
      const localAsset = await env.ASSETS.fetch(request);
      if (localAsset.status !== 404) return localAsset;
    }
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
    const path = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
    if (path.includes("..")) return new Response("Not found", { status: 404 });
    const asset = new URL(`https://yuanzhi-ai-bot.github.io/ielts-cloze-lab/${path}`);
    asset.search = url.search;
    return fetch(new Request(asset, request));
  },
};

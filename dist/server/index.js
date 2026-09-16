const encoder = new TextEncoder();
const MAX_STATE_BYTES = 1024 * 1024;

function json(body, status = 200, origin = null) {
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
  if (origin === "https://yuanzhi-ai-bot.github.io") {
    headers["access-control-allow-origin"] = origin;
    headers.vary = "Origin";
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function error(message, status, origin) { return json({ error: message }, status, origin); }

async function bodyOf(request, origin) {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body;
  } catch { return error("请求格式不正确。", 400, origin); }
}

function validState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  try { return encoder.encode(JSON.stringify(value)).byteLength <= MAX_STATE_BYTES; }
  catch { return false; }
}

function mergeStates(stored, incoming) {
  if (!stored) return incoming;
  const preferIncoming = Number(incoming.updatedAt || 0) >= Number(stored.updatedAt || 0);
  const storedCards = Array.isArray(stored.cards) ? stored.cards : [];
  const incomingCards = Array.isArray(incoming.cards) ? incoming.cards : [];
  const cards = new Map();
  [...storedCards, ...incomingCards].forEach((card, index) => {
    const key = String(card.id || card.word || "").trim().toLowerCase();
    if (!key) return;
    const old = cards.get(key);
    const isIncoming = index >= storedCards.length;
    if (!old || Number(card.updatedAt || 0) > Number(old.updatedAt || 0) || (Number(card.updatedAt || 0) === Number(old.updatedAt || 0) && isIncoming === preferIncoming)) cards.set(key, card);
  });
  const newest = preferIncoming ? incoming : stored;
  return Object.assign({}, stored, incoming, newest, { cards: [...cards.values()], updatedAt: Date.now() });
}

async function api(request, env) {
  const origin = request.headers.get("origin");
  const url = new URL(request.url);
  if (request.method === "OPTIONS") {
    if (origin === "https://yuanzhi-ai-bot.github.io") return new Response(null, { status: 204, headers: { "access-control-allow-origin": origin, "access-control-allow-methods": "GET, PUT, OPTIONS", "access-control-allow-headers": "content-type", vary: "Origin" } });
    return new Response(null, { status: 204 });
  }
  if (url.pathname !== "/api/v1/public-state") return error("找不到该同步接口。", 404, origin);

  if (request.method === "GET") {
    const row = await env.DB.prepare("SELECT state_json, revision, updated_at FROM public_shared_deck WHERE id = 1").first();
    return json(row ? { state: JSON.parse(row.state_json), revision: row.revision, updatedAt: row.updated_at } : { state: null, revision: 0, updatedAt: null }, 200, origin);
  }

  if (request.method === "PUT") {
    const body = await bodyOf(request, origin);
    if (body instanceof Response) return body;
    if (!validState(body.state)) return error("词库数据无效或过大。", 400, origin);
    const current = await env.DB.prepare("SELECT state_json, revision FROM public_shared_deck WHERE id = 1").first();
    const state = mergeStates(current ? JSON.parse(current.state_json) : null, body.state);
    const now = Date.now();
    if (current) await env.DB.prepare("UPDATE public_shared_deck SET state_json = ?, revision = revision + 1, updated_at = ? WHERE id = 1").bind(JSON.stringify(state), now).run();
    else await env.DB.prepare("INSERT INTO public_shared_deck (id, state_json, revision, updated_at) VALUES (1, ?, 1, ?)").bind(JSON.stringify(state), now).run();
    const row = await env.DB.prepare("SELECT revision FROM public_shared_deck WHERE id = 1").first();
    return json({ state, revision: row.revision, updatedAt: now }, 200, origin);
  }
  return error("不支持此请求方式。", 405, origin);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try { return await api(request, env); }
      catch (cause) {
        console.error("Public deck sync error", cause);
        return error("公开词库暂时不可用，请稍后重试。", 503, request.headers.get("origin"));
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
    asset.searchParams.set("__shared_build", "1");
    return fetch(new Request(asset, request));
  },
};

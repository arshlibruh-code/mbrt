// Theo's brain: the shared one on our server, or the visitor's own. Their own key goes straight from this browser
// to the provider (each one allows it), never through our server; it stays in this browser until "forget".
import { chatMessages } from "../eval/tools.js";
import { openaiBody, openaiCalls, openaiUsage, anthropicBody, anthropicCalls, anthropicUsage } from "./llm.js";

// prefix -> provider, checked in order (sk- last: it is the start of three others)
const PROVIDERS = {
  anthropic: { name: "Anthropic", prefix: "sk-ant-", base: "https://api.anthropic.com/v1", like: [/haiku/, /sonnet/] },
  openrouter: { name: "OpenRouter", prefix: "sk-or-", base: "https://openrouter.ai/api/v1", like: [/^openai\/gpt-oss-120b$/, /gpt-oss/] },
  groq: { name: "Groq", prefix: "gsk_", base: "https://api.groq.com/openai/v1", like: [/gpt-oss-120b/, /gpt-oss/, /llama/] },
  gemini: { name: "Gemini", prefix: "AIza", base: "https://generativelanguage.googleapis.com/v1beta/openai", like: [/flash-lite$/, /flash-lite/, /flash$/, /flash/], parallel: false },
  nvidia: { name: "NVIDIA", prefix: "nvapi-", browser: false },
  openai: { name: "OpenAI", prefix: "sk-", base: "https://api.openai.com/v1", like: [/^gpt-[\d.]+-mini$/, /mini$/, /mini/, /nano/] },
};
export const nameOf = (id) => PROVIDERS[id]?.name ?? id;
export const detect = (key) => Object.entries(PROVIDERS).find(([, p]) => key.startsWith(p.prefix))?.[0] ?? null;

const STORE = "mbrt:brain";
let state = (() => {
  try { return JSON.parse(localStorage.getItem(STORE)) ?? {}; } catch { return {}; }
})();
state.use ??= "shared";
const persist = () => {
  try { localStorage.setItem(STORE, JSON.stringify(state)); } catch {}
};
export const get = () => state;
export function set(patch) {
  state = { ...state, ...patch };
  persist();
}

const headers = (provider, key) =>
  provider === "anthropic"
    ? { "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true", "content-type": "application/json" }
    : { authorization: `Bearer ${key}`, "content-type": "application/json", ...(provider === "openrouter" && { "x-title": "mbrt" }) };

const fail = (msg, kind, extra = {}) => Object.assign(new Error(msg), { kind, ...extra });
async function reply(res, who) {
  const body = await res.json().catch(() => ({}));
  if (res.ok) return body;
  const said = body.error?.message ?? body.error ?? body.message ?? "";
  if (res.status === 401 || res.status === 403 || (res.status === 400 && /api key/i.test(said))) throw fail(`${who} refused the key${said ? `: ${said}` : ""}`, "key", { who });
  if (res.status === 402) throw fail(`${who}: out of credits`, "credits", { who });
  if (res.status === 429) throw fail(`${who} rate limit`, "limit", { retryAfter: Math.ceil(Number(res.headers.get("retry-after")) || 20) });
  throw fail(`${who} ${res.status}: ${said || "no details"}`, res.status >= 500 ? "network" : "model");
}
const send = (url, init) =>
  fetch(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) })
    .catch((err) => { throw err.name === "AbortError" ? err : fail(err.message, "network"); });

// a key's models, cheapest first where the provider says the price; `pick` is the one we would choose
export async function models(provider, key) {
  const p = PROVIDERS[provider];
  if (p.browser === false) throw fail(`${p.name} keys can't be used from a browser (their API does not allow it)`, "key");
  // OpenRouter's model list is public, so the key is checked on its own first
  if (provider === "openrouter") await reply(await send(`${p.base}/key`, { headers: headers(provider, key) }), p.name);
  const body = await reply(await send(`${p.base}/models`, { headers: headers(provider, key) }), p.name);
  let list = (body.data ?? []).map((m) => ({ id: m.id.replace(/^models\//, ""), price: Number(m.pricing?.prompt ?? NaN), tools: m.supported_parameters }));
  if (provider === "openrouter") list = list.filter((m) => m.tools?.includes("tools")).sort((a, b) => a.price - b.price);
  if (provider === "openai") list = list.filter((m) => /^(gpt|o\d)/.test(m.id) && !/audio|realtime|image|tts|transcribe|search|embedding/.test(m.id));
  if (provider === "gemini") list = list.filter((m) => /gemini/.test(m.id) && !/embedding|image|tts|live/.test(m.id));
  const ids = list.map((m) => m.id);
  const pick = p.like.map((re) => ids.find((id) => re.test(id))).find(Boolean) ?? ids[0];
  return { list, pick };
}

// ---- OpenRouter sign-in: PKCE in the browser, the callback lands back on this page with ?code=
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export async function openrouterSignIn() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  sessionStorage.setItem("mbrt:or-verifier", verifier);
  const back = location.origin + location.pathname;
  location.href = `https://openrouter.ai/auth?callback_url=${encodeURIComponent(back)}&code_challenge=${challenge}&code_challenge_method=S256`;
}
// call once on load; returns a status line when a sign-in just came back
export async function finishSignIn() {
  const q = new URLSearchParams(location.search);
  const clean = (...names) => {
    names.forEach((n) => q.delete(n));
    history.replaceState(null, "", location.pathname + (q.size ? `?${q}` : "") + location.hash);
  };
  if (q.has("chatgpt")) {
    const msg = q.get("chatgpt");
    clean("chatgpt");
    if (msg !== "ok") return { ok: false, text: `ChatGPT sign-in: ${msg}` };
    set({ use: "chatgpt" });
    return { ok: true, text: "signed in with ChatGPT" };
  }
  const verifier = sessionStorage.getItem("mbrt:or-verifier");
  if (!q.has("code") || !verifier) return null;
  sessionStorage.removeItem("mbrt:or-verifier");
  const code = q.get("code");
  clean("code");
  const res = await send("https://openrouter.ai/api/v1/auth/keys", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }),
  });
  const { key } = await reply(res, "OpenRouter");
  set({ use: "openrouter", openrouter: { key, model: "openai/gpt-oss-120b" } });
  return { ok: true, text: "signed in with OpenRouter" };
}

// ---- ChatGPT: only on your own machine; the dev server holds the tokens (api/chatgpt.js)
export const chatgptHere = import.meta.env.DEV && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
export const chatgptStatus = () => fetch("/api/chatgpt/status").then((r) => r.json()).catch(() => ({ signedIn: false }));
export const chatgptSignIn = () => (location.href = `/api/chatgpt/login?back=${encodeURIComponent(location.origin + location.pathname)}`);
export const chatgptSignOut = () => fetch("/api/chatgpt/logout");
export async function chatgptModels() {
  const body = await reply(await fetch("/api/chatgpt/models"), "ChatGPT");
  // luna is the light tier: a map call needs no more, and it spends the least of the plan's allowance
  return { list: body.models, pick: [/luna/, /mini/].map((re) => body.models.find((m) => re.test(m.id))).find(Boolean)?.id ?? body.models[0]?.id };
}

// ---- usage: a tally per brain for this browser session, and what OpenRouter says the account has spent

const brainId = () => (state.use === "key" ? `key:${state.key?.provider}` : state.use);
let tallies = (() => {
  try { return JSON.parse(sessionStorage.getItem("mbrt:tally")) ?? {}; } catch { return {}; }
})();
const listeners = new Set();
export const onTally = (fn) => (listeners.add(fn), fn(tally()));
export const tally = () => tallies[brainId()] ?? { requests: 0, in: 0, out: 0, cost: null };
function count(usage) {
  const t = tally();
  tallies[brainId()] = { requests: t.requests + 1, in: t.in + (usage?.in ?? 0), out: t.out + (usage?.out ?? 0), cost: usage?.cost != null ? (t.cost ?? 0) + usage.cost : t.cost };
  try { sessionStorage.setItem("mbrt:tally", JSON.stringify(tallies)); } catch {}
  listeners.forEach((fn) => fn(tally()));
}
export const tokens = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);
export const usd = (n) => `$${n < 0.01 ? n.toFixed(5) : n.toFixed(2)}`;
export const usageText = (u) => (u ? `${u.in.toLocaleString("en-IN")} in · ${u.out.toLocaleString("en-IN")} out${u.cost != null ? ` · ${usd(u.cost)}` : ""}` : "");

// OpenRouter's own numbers for the key: spent today, all time, and what is left under its limit
export async function openrouterSpend(key) {
  const { data } = await reply(await send("https://openrouter.ai/api/v1/key", { headers: headers("openrouter", key) }), "OpenRouter");
  return { today: data.usage_daily, total: data.usage, left: data.limit_remaining };
}

// who is answering, for the feed
export function label() {
  const short = (m) => (m ?? "").split("/").pop();
  if (state.use === "openrouter") return `Theo · your OpenRouter · ${short(state.openrouter?.model)}`;
  if (state.use === "key") return `Theo · your ${PROVIDERS[state.key?.provider]?.name} key · ${short(state.key?.model)}`;
  if (state.use === "chatgpt") return `Theo · your ChatGPT · ${short(state.chatgpt?.model)}`;
  return "Theo";
}

// one request to whichever brain is chosen -> {calls, model, ms}
export async function ask({ message, history, context, signal }) {
  const t0 = Date.now();
  if (state.use === "chatgpt") {
    const res = await send("/api/chatgpt/chat", { method: "POST", headers: { "content-type": "application/json" }, signal,
      body: JSON.stringify({ message, history, context, model: state.chatgpt?.model }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw fail(body.error, body.kind ?? "network", { retryAfter: body.retryAfter, who: "ChatGPT" });
    count(body.usage);
    return { ...body, by: "ChatGPT" };
  }
  const own = state.use === "openrouter" ? { provider: "openrouter", ...state.openrouter } : state.use === "key" ? state.key : null;
  if (!own?.key) {
    const res = await send("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, signal, body: JSON.stringify({ message, history, context }) });
    const body = await res.json().catch(() => ({ error: `server ${res.status}` }));
    if (!res.ok) throw fail(body.error, body.kind ?? (res.status >= 500 ? "network" : "model"), { retryAfter: body.retryAfter });
    count(body.usage);
    return { ...body, by: "Groq" };
  }
  const p = PROVIDERS[own.provider];
  const messages = chatMessages({ message, history, context });
  const anthropic = own.provider === "anthropic";
  const body = await reply(await send(anthropic ? `${p.base}/messages` : `${p.base}/chat/completions`, {
    method: "POST", headers: headers(own.provider, own.key), signal,
    body: JSON.stringify(anthropic ? anthropicBody(own.model, messages) : openaiBody(own.model, messages, { parallel: p.parallel !== false })),
  }), p.name);
  const usage = anthropic ? anthropicUsage(body) : openaiUsage(body);
  count(usage);
  return { calls: anthropic ? anthropicCalls(body) : openaiCalls(body), usage, model: own.model, ms: Date.now() - t0, by: p.name };
}

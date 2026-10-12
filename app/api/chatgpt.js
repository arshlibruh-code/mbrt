// Sign in with ChatGPT, for local runs only (Vite dev middleware). OpenAI's flow wants a loopback listener on
// 127.0.0.1 and credentials in a private file, so this lives in Node, never in the browser or the deployed site.
// Docs: developers.openai.com/siwc/token-sharing-open-source (sign-in, models-and-inference, profiles-and-sessions).
import { createServer } from "node:http";
import { createHash, createPublicKey, randomBytes, randomUUID, verify } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { chatMessages } from "../../eval/tools.js";
import { responsesBody, responsesCalls } from "../llm.js";

const AUTH = "https://auth.openai.com";
const API = "https://api.openai.com/v1";
const PORT = 1455, CALLBACK = `http://127.0.0.1:${PORT}/auth/callback`;
const PLAN_SCOPE = "chatgpt.tokens.use.direct";
const DIR = join(homedir(), ".mbrt"), FILE = join(DIR, "chatgpt.json");

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const load = () => readFile(FILE, "utf8").then(JSON.parse).catch(() => ({}));
async function save(data) {
  await mkdir(DIR, { recursive: true, mode: 0o700 });
  const tmp = `${FILE}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  await rename(tmp, FILE); // atomic, so a crash never leaves half a token
}
const json = (res, status, body) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
};

async function tokenRequest(fields) {
  const res = await fetch(`${AUTH}/api/accounts/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ resource: API, ...fields }),
    signal: AbortSignal.timeout(20000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`token ${res.status}: ${body.error ?? ""} ${body.error_description ?? ""}`.trim());
  return body;
}

// the ID token's signature, issuer, audience, expiry and nonce, against OpenAI's published keys
async function checkIdToken(idToken, clientId, nonce) {
  const [h, p, sig] = idToken.split(".");
  const head = JSON.parse(Buffer.from(h, "base64url")), claims = JSON.parse(Buffer.from(p, "base64url"));
  const conf = await (await fetch(`${AUTH}/.well-known/openid-configuration`)).json();
  const { keys } = await (await fetch(conf.jwks_uri)).json();
  const jwk = keys.find((k) => k.kid === head.kid);
  if (!jwk || head.alg !== "RS256") throw new Error("id token: unknown signing key");
  if (!verify("RSA-SHA256", Buffer.from(`${h}.${p}`), createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(sig, "base64url")))
    throw new Error("id token: bad signature");
  const aud = [].concat(claims.aud);
  if (claims.iss !== conf.issuer || !aud.includes(clientId) || claims.exp * 1000 < Date.now() || claims.nonce !== nonce)
    throw new Error("id token: issuer, audience, expiry or nonce did not match");
  return claims;
}

const keep = (t, saved) => ({
  ...saved,
  access_token: t.access_token,
  refresh_token: t.refresh_token ?? saved.refresh_token,
  expires_at: Date.now() + (t.expires_in ?? 3600) * 1000,
  scope: t.scope ?? saved.scope,
  saved_at: Date.now(),
});

// one refresh at a time: the refresh token rotates, so two at once would burn it
let refreshing = null;
async function accessToken() {
  const saved = await load();
  if (!saved.access_token) throw Object.assign(new Error("not signed in to ChatGPT"), { kind: "key" });
  if (saved.expires_at - Date.now() > 60000) return saved.access_token;
  refreshing ??= tokenRequest({ grant_type: "refresh_token", client_id: saved.client_id, refresh_token: saved.refresh_token })
    .then(async (t) => (await save(keep(t, saved)), t.access_token))
    .finally(() => (refreshing = null));
  return refreshing;
}

let listener = null;
// GET /api/chatgpt/login?back=<page>: start the loopback listener, then send the browser to OpenAI
async function login(req, res) {
  const back = new URL(req.url, "http://x").searchParams.get("back") ?? "/";
  if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(back)) return json(res, 400, { error: "back must be a local page" });
  const saved = await load();
  const host = saved.host_id ?? `urn:uuid:${randomUUID()}`;
  if (!saved.host_id) await save({ ...saved, host_id: host });
  const state = b64url(randomBytes(24)), nonce = b64url(randomBytes(24)), verifier = b64url(randomBytes(48));
  const clientId = saved.client_id ?? "dynamic_agent_client";
  const q = new URLSearchParams({
    client_id: clientId,
    ext_agent_host_id: host,
    response_type: "code",
    redirect_uri: CALLBACK,
    scope: `openid profile email offline_access resource.invoke ${PLAN_SCOPE}`,
    resource: API,
    state, nonce,
    code_challenge_method: "S256",
    code_challenge: b64url(createHash("sha256").update(verifier).digest()),
    ...(saved.client_id ? (saved.id_token ? { id_token_hint: saved.id_token } : {}) : { agent_name_hint: "mbrt" }),
  });
  listener?.close();
  listener = createServer(async (cb, out) => {
    const u = new URL(cb.url, CALLBACK);
    if (u.pathname !== "/auth/callback") return (out.statusCode = 404), out.end();
    const finish = (msg) => {
      out.statusCode = 302;
      out.setHeader("location", `${back}${back.includes("?") ? "&" : "?"}chatgpt=${encodeURIComponent(msg)}`);
      out.end();
      listener?.close();
      listener = null;
    };
    try {
      if (u.searchParams.get("state") !== state) return finish("state did not match, try again");
      if (u.searchParams.get("error")) return finish(u.searchParams.get("error") === "access_denied" ? "cancelled" : u.searchParams.get("error"));
      const issued = u.searchParams.get("client_id");
      if (saved.client_id && issued && issued !== saved.client_id) return finish("a different app registration came back, sign in again");
      const id = saved.client_id ?? issued;
      if (!id) return finish("registration did not finish, try again");
      const t = await tokenRequest({ grant_type: "authorization_code", client_id: id, code: u.searchParams.get("code"), code_verifier: verifier, redirect_uri: CALLBACK });
      if (!String(t.scope ?? "").split(" ").includes(PLAN_SCOPE)) return finish("plan usage was not granted");
      const claims = await checkIdToken(t.id_token, id, nonce);
      await save(keep(t, { host_id: host, client_id: id, id_token: t.id_token, email: claims.email ?? "" }));
      finish("ok");
    } catch (err) {
      finish(err.message);
    }
  });
  listener.on("error", (err) => json(res, 500, { error: `can't listen on 127.0.0.1:${PORT}: ${err.message}` }));
  listener.listen(PORT, "127.0.0.1", () => {
    res.statusCode = 302;
    res.setHeader("location", `${AUTH}/api/accounts/authorize?${q}`);
    res.end();
  });
}

async function models(res) {
  const r = await fetch(`${API}/models`, { headers: { authorization: `Bearer ${await accessToken()}` } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) return json(res, r.status, { error: body.error?.message ?? `models ${r.status}` });
  json(res, 200, { models: (body.data ?? body.models ?? []).filter((m) => m.visibility === "list").map((m) => ({ id: m.slug ?? m.id, name: m.display_name ?? m.slug ?? m.id })) });
}

async function chat(req, res) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const { message, history, context, model } = JSON.parse(Buffer.concat(chunks) || "{}");
  const t0 = Date.now();
  const r = await fetch(`${API}/responses`, {
    method: "POST",
    headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" },
    body: JSON.stringify(responsesBody(model, chatMessages({ message, history, context }))),
    signal: AbortSignal.timeout(60000),
  });
  const text = await r.text();
  if (r.status === 429) return json(res, 429, { error: "ChatGPT plan limit reached", kind: "limit", retryAfter: Math.ceil(Number(r.headers.get("retry-after")) || 60) });
  if (r.status === 401 || r.status === 403) return json(res, r.status, { error: "ChatGPT refused the sign-in, sign in again", kind: "key" });
  if (!r.ok) return json(res, 502, { error: `ChatGPT ${r.status}: ${text.slice(0, 300)}`, kind: "network" });
  json(res, 200, { ...responsesCalls(text), model, ms: Date.now() - t0 });
}

// mounted at /api/chatgpt by vite.config.js
export async function handleChatgpt(req, res) {
  const path = new URL(req.url, "http://x").pathname;
  try {
    if (path === "/login") return await login(req, res);
    if (path === "/status") {
      const s = await load();
      return json(res, 200, { signedIn: !!s.access_token, email: s.email ?? "" });
    }
    if (path === "/logout") {
      const { host_id, client_id } = await load(); // the host and its registration persist; only the tokens go
      return await save({ host_id, client_id }), json(res, 200, { ok: true });
    }
    if (path === "/models") return await models(res);
    if (path === "/chat" && req.method === "POST") return await chat(req, res);
    json(res, 404, { error: "unknown" });
  } catch (err) {
    json(res, 500, { error: err.message, kind: err.kind ?? "model" });
  }
}

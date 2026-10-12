// POST {message, history, context} -> {calls: [{tool, args}]}. Runs server-side (Vite middleware locally, Pages Function
// when deployed) so GROQ_API_KEY never reaches the browser. The model only picks the call.
import { TOOLS, MAX_CALLS, chatMessages } from "../../eval/tools.js";
import { openaiBody, openaiCalls, openaiUsage } from "../llm.js";

const MODEL = "openai/gpt-oss-120b";
const NAMES = new Set(TOOLS.map((t) => t.name));
const text = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");

// history and context come from the browser, so keep only the expected shape and cap every size
function cleanHistory(h) {
  if (!Array.isArray(h)) return [];
  return h.slice(-3).flatMap((turn) => {
    const calls = (Array.isArray(turn?.calls) ? turn.calls : []).slice(0, MAX_CALLS)
      .filter((c) => NAMES.has(c?.tool) && c.args && typeof c.args === "object" && JSON.stringify(c.args).length <= 2000)
      .map((c) => ({ tool: c.tool, args: c.args, result: text(c.result, 300) }));
    const user = text(turn?.user, 500);
    return user && calls.length ? [{ user, calls }] : [];
  });
}
const cleanContext = (c = {}) => ({
  near: text(c.near, 120),
  zoom: Number.isFinite(c.zoom) ? Math.round(c.zoom * 10) / 10 : null,
  selected: text(c.selected, 120),
  me: c.me === true,
});

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export async function handleChat(request, env) {
  if (!env.GROQ_API_KEY) return json(500, { error: "GROQ_API_KEY is not set on the server", kind: "config" });
  const body0 = await request.json().catch(() => ({}));
  const message = body0?.message;
  if (typeof message !== "string" || !message.trim() || message.length > 500) return json(400, { error: "message must be 1 to 500 characters" });
  const t0 = Date.now();
  let res;
  try {
    res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${env.GROQ_API_KEY}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(20000),
      body: JSON.stringify(openaiBody(MODEL, chatMessages({ message, history: cleanHistory(body0.history), context: cleanContext(body0.context) }))),
    });
  } catch (err) {
    return json(504, { error: `Groq did not answer: ${err.message}`, kind: "network" });
  }
  const body = await res.json().catch(() => null);
  if (res.status === 429) {
    const retryAfter = Math.ceil(Number(res.headers.get("retry-after")) || 20);
    return json(429, { error: `Groq free tier limit reached, try again in ${retryAfter} s`, kind: "limit", retryAfter });
  }
  if (!res.ok) return json(502, { error: `Groq ${res.status}: ${body?.error?.message ?? "no details"}`, kind: "network" });
  try {
    return json(200, { calls: openaiCalls(body), usage: openaiUsage(body), model: MODEL, ms: Date.now() - t0 });
  } catch (err) {
    return json(502, { error: err.message, kind: "model" });
  }
}

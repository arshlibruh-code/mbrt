// POST {message} -> {call: {tool, args}}. Runs server-side (Vite middleware locally, Pages Function
// when deployed) so GROQ_API_KEY never reaches the browser. The model only picks the call.
import { TOOLS, SYSTEM } from "../../eval/tools.js";

const MODEL = "openai/gpt-oss-120b";
const tools = TOOLS.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }));
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export async function handleChat(request, env) {
  if (!env.GROQ_API_KEY) return json(500, { error: "GROQ_API_KEY is not set on the server" });
  const message = await request.json().then((b) => b.message, () => null);
  if (typeof message !== "string" || !message.trim() || message.length > 500) return json(400, { error: "message must be 1 to 500 characters" });
  const t0 = Date.now();
  let res;
  try {
    res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${env.GROQ_API_KEY}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(20000),
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        tool_choice: "required",
        parallel_tool_calls: false,
        tools,
        messages: [{ role: "system", content: SYSTEM }, { role: "user", content: message }],
      }),
    });
  } catch (err) {
    return json(504, { error: `Groq did not answer: ${err.message}` });
  }
  const body = await res.json().catch(() => null);
  if (res.status === 429) return json(429, { error: `Groq free tier limit reached, try again in ${res.headers.get("retry-after") ?? "a few"} s` });
  if (!res.ok) return json(502, { error: `Groq ${res.status}: ${body?.error?.message ?? "no details"}` });
  const fn = body.choices?.[0]?.message?.tool_calls?.[0]?.function;
  if (!fn) return json(502, { error: "the model answered without picking a tool" });
  let args;
  try { args = JSON.parse(fn.arguments); } catch { return json(502, { error: "the model sent malformed arguments" }); }
  return json(200, { call: { tool: fn.name, args }, model: MODEL, ms: Date.now() - t0 });
}

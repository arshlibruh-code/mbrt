// The tool schema in each provider's dialect, and their answers back to [{tool, args}]. No browser or Node APIs here:
// the shared server (api/chat.js), the dev ChatGPT relay (api/chatgpt.js) and the browser (brain.js) all use it.
import { TOOLS, MAX_CALLS } from "../eval/tools.js";

const modelError = (msg) => Object.assign(new Error(msg), { kind: "model" });
const parseArgs = (s) => {
  try { return typeof s === "string" ? JSON.parse(s) : s; }
  catch { throw modelError("the model sent malformed arguments"); }
};
const done = (calls) => {
  if (!calls.length) throw modelError("the model answered without picking a tool");
  return calls.slice(0, MAX_CALLS);
};

// OpenAI chat completions: Groq, OpenRouter, OpenAI, Gemini's OpenAI endpoint
const openaiTools = TOOLS.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }));
export const openaiBody = (model, messages, { parallel = true } = {}) => ({
  model, temperature: 0, tool_choice: "required", tools: openaiTools, messages, ...(parallel && { parallel_tool_calls: true }),
});
export const openaiCalls = (body) =>
  done((body?.choices?.[0]?.message?.tool_calls ?? []).map((tc) => ({ tool: tc.function.name, args: parseArgs(tc.function.arguments) })));

// Anthropic messages: system on top, tool calls as tool_use blocks, results as tool_result blocks in a user turn
export function anthropicBody(model, messages) {
  const out = [];
  const push = (role, block) => {
    const last = out.at(-1);
    if (last?.role === role) last.content.push(block);
    else out.push({ role, content: [block] });
  };
  for (const m of messages.slice(1)) {
    if (m.role === "user") push("user", { type: "text", text: m.content });
    else if (m.role === "assistant") for (const tc of m.tool_calls) push("assistant", { type: "tool_use", id: tc.id, name: tc.function.name, input: JSON.parse(tc.function.arguments) });
    else if (m.role === "tool") push("user", { type: "tool_result", tool_use_id: m.tool_call_id, content: m.content });
  }
  return {
    model, max_tokens: 1024, temperature: 0, system: messages[0].content, messages: out,
    tools: TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema })), tool_choice: { type: "any" },
  };
}
export const anthropicCalls = (body) => done((body?.content ?? []).filter((c) => c.type === "tool_use").map((c) => ({ tool: c.name, args: c.input })));

// OpenAI Responses for a ChatGPT sign-in: no system items and no temperature, function tools grouped in a namespace,
// streaming only. Earlier turns go in as plain text, since this route keeps no conversation state.
export function responsesBody(model, messages) {
  const input = [];
  for (const m of messages.slice(1)) {
    if (m.role === "user") input.push({ role: "user", content: m.content });
    else if (m.role === "assistant") input.push({ role: "assistant", content: m.tool_calls.map((tc) => `called ${tc.function.name} ${tc.function.arguments}`).join("\n") });
    else if (m.role === "tool") input.push({ role: "assistant", content: `result: ${m.content}` });
  }
  return {
    model, store: false, stream: true, instructions: messages[0].content, input, tool_choice: "required", parallel_tool_calls: true,
    tools: [{ type: "namespace", name: "mbrt", description: "Map tools", tools: TOOLS.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.input_schema })) }],
  };
}
// a server-sent event stream, read whole: the finished response carries every function call
export function responsesCalls(sse) {
  let final = null;
  for (const line of sse.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const ev = (() => { try { return JSON.parse(line.slice(5)); } catch { return null; } })();
    if (ev?.type === "response.failed" || ev?.type === "error") throw modelError(ev.response?.error?.message ?? ev.message ?? "the response failed");
    if (ev?.type === "response.completed") final = ev.response;
  }
  if (!final) throw modelError("the stream ended before the response completed");
  return done(final.output.filter((o) => o.type === "function_call").map((o) => ({ tool: o.name, args: parseArgs(o.arguments) })));
}

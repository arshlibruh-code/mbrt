// Score a model on the golden set.
//   node run.js --dry                       check golden + scorer, no API call
//   node run.js --compare                   table of every result CSV, grouped by model and prompt version
//   node run.js --model claude-haiku-5-5    Anthropic (ANTHROPIC_API_KEY)
//   node run.js --model groq:openai/gpt-oss-120b --runs 1 --concurrency 1   Groq free (GROQ_API_KEY)
//   node run.js --model codex --runs 1      ChatGPT plan through the logged-in Codex CLI, no key
//   node run.js --model zen:gpt-5.4-nano    OpenCode Zen API with your OpenCode login (paid models only: bills your balance)
//   node run.js --model opencode:big-pickle OpenCode's free models, through the opencode CLI (prompt mode, no native tool calls)
// golden rows may carry "alt": other answers that also count as right
// Flags: --runs N  --effort low|medium|high  --only g08,g17  --concurrency N

import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import { TOOLS, SYSTEM, chatMessages } from "./tools.js";

// for adapters that take one prompt string: earlier turns written out as text
const withHistory = (prompt, history = []) =>
  history.length
    ? `${history.map((t) => `Earlier the user said: "${t.user}". You called ${t.calls.map((c) => `${c.tool} ${JSON.stringify(c.args)} (result: ${c.result})`).join(", ")}.`).join("\n")}\nNow the user says: ${prompt}`
    : prompt;
import { score } from "./score.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const flag = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? dflt : process.argv[i + 1] ?? true;
};
const DRY = process.argv.includes("--dry");
const MODEL = flag("model", "claude-haiku-5-5");
const RUNS = Number(flag("runs", 3));
const EFFORT = flag("effort", "low");
const CONC = Number(flag("concurrency", 4));
const ONLY = flag("only", null)?.split(",");
// any change to the system prompt or tool schema gets a new version; results only compare within one
const PROMPT_V = crypto.createHash("sha256").update(SYSTEM + JSON.stringify(TOOLS)).digest("hex").slice(0, 8);

// $ per million tokens, input / output
const PRICE = { "claude-haiku-5-5": [0.10, 0.50] };

const ajv = new Ajv({ strict: false });
const validators = Object.fromEntries(TOOLS.map((t) => [t.name, ajv.compile(t.input_schema)]));
const valid = (call) => !!validators[call?.tool]?.(call.args);

let golden = JSON.parse(fs.readFileSync(path.join(here, "golden.json"), "utf8"));
if (ONLY) golden = golden.filter((g) => ONLY.includes(g.id));

// ---- adapters: (prompt) -> { call: {tool, args} | null, inTok, outTok, raw }

async function anthropicAdapter() {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();
  return async (prompt, history) => {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      thinking: { type: "disabled" },
      output_config: { effort: EFFORT },
      tools: TOOLS.map((t) => ({ ...t, strict: true })),
      messages: [{ role: "user", content: withHistory(prompt, history) }],
    });
    const use = res.content.find((b) => b.type === "tool_use");
    const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join(" ");
    return {
      call: use ? { tool: use.name, args: use.input } : null,
      inTok: res.usage.input_tokens,
      outTok: res.usage.output_tokens,
      raw: use ? "" : `${res.stop_reason}: ${text}`,
    };
  };
}

// OpenAI chat format: Groq (free tier ~30 RPM and 8K TPM, so 429s are expected: wait and retry) and OpenCode Zen
// (the key OpenCode saved at login, read from its own file, so it never sits in the repo or the shell)
function groqAdapter(model) {
  if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY is not set");
  return openaiAdapter("https://api.groq.com/openai/v1/chat/completions", process.env.GROQ_API_KEY, model, 30000);
}
function zenAdapter(model) {
  const auth = path.join(os.homedir(), ".local/share/opencode/auth.json");
  const key = JSON.parse(fs.readFileSync(auth, "utf8")).opencode?.key;
  if (!key) throw new Error(`no OpenCode key in ${auth}, run: opencode auth login`);
  return openaiAdapter("https://opencode.ai/zen/v1/chat/completions", key, model, 90000);
}
async function openaiAdapter(url, key, model, timeout) {
  const tools = TOOLS.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }));
  return async (prompt, history) => {
    for (let attempt = 0; ; attempt++) {
      const t0 = Date.now();
      let res;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
          signal: AbortSignal.timeout(timeout),
          body: JSON.stringify({
            model,
            temperature: 0,
            tool_choice: "required",
            parallel_tool_calls: false,
            tools,
            messages: chatMessages({ message: prompt, history }), // the exact shape the app server sends
          }),
        });
      } catch (err) {
        return { call: null, inTok: 0, outTok: 0, ms: Date.now() - t0, raw: `error: ${err.name} ${err.message}` };
      }
      if (res.status === 429 && attempt < 8) {
        const wait = Number(res.headers.get("retry-after") ?? 10);
        await new Promise((r) => setTimeout(r, (wait + 1) * 1000));
        continue;
      }
      const ms = Date.now() - t0; // model time only, rate-limit waits excluded
      const body = await res.json().catch(() => ({ error: { message: "not JSON" } }));
      if (!res.ok) return { call: null, inTok: 0, outTok: 0, ms, raw: `error: ${res.status} ${body.error?.message ?? ""}` };
      const msg = body.choices[0].message, calls = msg.tool_calls ?? [], fn = calls[0]?.function;
      let args = null, raw = fn ? "" : `no tool call: ${msg.content ?? ""}`;
      if (fn) try { args = JSON.parse(fn.arguments); } catch { raw = `bad JSON args: ${fn.arguments}`; }
      if (calls.length > 1) raw = `${calls.length} tool calls, scored the first`;
      return {
        call: fn ? { tool: fn.name, args } : null,
        inTok: body.usage?.prompt_tokens ?? 0,
        outTok: body.usage?.completion_tokens ?? 0,
        ms,
        raw,
      };
    }
  };
}

// ChatGPT plan via `codex exec --output-schema`. Structured outputs want a root object with every key
// required, so the call is wrapped as {call: anyOf[...]} and optional map fields become nullable.
function codexSchema() {
  const variants = TOOLS.map((t) => {
    const props = {}, sch = t.input_schema;
    for (const [k, v] of Object.entries(sch.properties))
      props[k] = sch.required.includes(k) ? v : { ...v, type: [v.type, "null"], ...(v.enum && { enum: [...v.enum, null] }) };
    return {
      type: "object",
      properties: { tool: { type: "string", enum: [t.name] }, args: { type: "object", properties: props, required: Object.keys(props), additionalProperties: false } },
      required: ["tool", "args"],
      additionalProperties: false,
    };
  });
  return { type: "object", properties: { call: { anyOf: variants } }, required: ["call"], additionalProperties: false };
}

async function codexAdapter(model) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mbrt-codex-"));
  const schemaFile = path.join(dir, "schema.json");
  fs.writeFileSync(schemaFile, JSON.stringify(codexSchema()));
  let n = 0;
  return (prompt, history) => new Promise((resolve) => {
    const out = path.join(dir, `out-${n++}.json`);
    const argv = ["exec", "--ephemeral", "--skip-git-repo-check", "-s", "read-only", "-C", dir,
      "-c", `model_reasoning_effort="${EFFORT}"`, "--output-schema", schemaFile, "-o", out];
    if (model) argv.push("-m", model);
    argv.push(`${SYSTEM}\nDo not run any commands or read files. Pick the tool call for this message:\n\n${withHistory(prompt, history)}`);
    const child = execFile("codex", argv, { timeout: 180000 }, (err, _stdout, stderr) => {
      let call = null, raw = "";
      try {
        call = JSON.parse(fs.readFileSync(out, "utf8")).call;
        for (const k of Object.keys(call.args)) if (call.args[k] === null) delete call.args[k];
      } catch {
        raw = `error: ${err?.message ?? ""} ${String(stderr).slice(-300)}`;
      }
      resolve({ call, inTok: 0, outTok: 0, raw });
    });
    child.stdin.end(); // codex exec waits on an open stdin otherwise
  });
}

// OpenCode's free models only answer inside OpenCode, so they run through `opencode run` like Codex above: the tool
// schema goes in the prompt and the answer is one JSON object. Its read-only plan agent, in an empty folder.
async function opencodeAdapter(model) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mbrt-opencode-"));
  const spec = TOOLS.map((t) => ({ name: t.name, description: t.description, parameters: t.input_schema }));
  return (prompt, history) => new Promise((resolve) => {
    const t0 = Date.now();
    const text = `${SYSTEM}\nDo not use any of your own tools and do not read files. Answer with one JSON object and nothing else: {"tool": <name>, "args": {...}}, args matching that tool's parameters.\nTools: ${JSON.stringify(spec)}\n\n${withHistory(prompt, history)}`;
    execFile("opencode", ["run", "--pure", "--agent", "plan", "-m", `opencode/${model}`, "--format", "json", text], { cwd: dir, timeout: 180000, maxBuffer: 1 << 24 }, (err, stdout, stderr) => {
      const events = stdout.split("\n").flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
      const said = events.filter((e) => e.type === "text").map((e) => e.part.text).join("");
      const tokens = events.find((e) => e.type === "step_finish")?.part.tokens ?? {};
      let call = null, raw = "";
      try {
        call = JSON.parse(said.slice(said.indexOf("{"), said.lastIndexOf("}") + 1));
        if (typeof call?.tool !== "string") throw new Error("no tool");
      } catch {
        call = null;
        raw = `no JSON call: ${said.slice(0, 200) || err?.message || String(stderr).slice(-200)}`;
      }
      resolve({ call, inTok: tokens.input ?? 0, outTok: tokens.output ?? 0, ms: Date.now() - t0, raw });
    }).stdin.end();
  });
}

function pickAdapter() {
  if (MODEL.startsWith("groq:")) return groqAdapter(MODEL.slice(5));
  if (MODEL.startsWith("zen:")) return zenAdapter(MODEL.slice(4));
  if (MODEL.startsWith("opencode:")) return opencodeAdapter(MODEL.slice(9));
  if (MODEL === "codex" || MODEL.startsWith("codex:")) return codexAdapter(MODEL.slice(6) || null);
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
  return anthropicAdapter();
}

// ---- dry run: golden must satisfy its own schema and score 100%, mutations must fail

const PLACE_KEYS = ["places", "waypoints", "vertices", "centers", "center", "place"];

function dry() {
  let fails = 0;
  const say = (msg) => (fails++, console.log("FAIL", msg));
  for (const g of golden) {
    for (const a of g.alt ?? []) if (!valid(a)) say(`${g.id} alt is not schema-valid`);
    if (!valid(g.expect)) say(`${g.id} expect is not schema-valid: ${ajv.errorsText(validators[g.expect.tool]?.errors)}`);
    if (!score(g.expect, g.expect, g.match).ok) say(`${g.id} does not match itself`);
    const other = TOOLS.find((t) => t.name !== g.expect.tool).name;
    if (score({ ...g.expect, tool: other }, g.expect, g.match).ok) say(`${g.id} passes with the wrong tool`);
    const nums = JSON.parse(JSON.stringify(g.expect), (k, v) => (typeof v === "number" ? v * 2 + 1 : v));
    if (JSON.stringify(nums) !== JSON.stringify(g.expect) && score(nums, g.expect, g.match).ok) say(`${g.id} passes with wrong numbers`);
    const swapped = { ...g.expect, args: { ...g.expect.args } };
    for (const k of PLACE_KEYS) if (k in swapped.args) swapped.args[k] = Array.isArray(swapped.args[k]) ? swapped.args[k].map(() => "Timbuktu") : "Timbuktu";
    if (PLACE_KEYS.some((k) => k in g.expect.args) && !g.match && score(swapped, g.expect).ok) say(`${g.id} passes with wrong places`);
  }
  console.log(`${golden.length} rows, ${fails} failures, prompt ${PROMPT_V}`);
  process.exit(fails ? 1 : 0);
}

// ---- real run

const pct = (n, d) => (d ? ((100 * n) / d).toFixed(1) + "%" : "n/a");
const q = (xs, p) => xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))];
const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

async function run() {
  let ask;
  try {
    ask = await pickAdapter();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  const jobs = golden.flatMap((g) => Array.from({ length: RUNS }, (_, run) => ({ g, run })));
  const rows = [];
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const { g, run } = jobs[next++];
      const t0 = Date.now();
      let r;
      try {
        r = await ask(g.prompt, g.history);
      } catch (err) {
        r = { call: null, inTok: 0, outTok: 0, raw: `error: ${err.status ?? ""} ${err.message}` };
      }
      const s = [g.expect, ...(g.alt ?? [])].map((e) => score(r.call, e, g.match)).find((x) => x.ok) ?? score(r.call, g.expect, g.match);
      rows.push({ id: g.id, run, ms: Date.now() - t0, valid: valid(r.call), ...s, ...r }); // adapters may report their own ms
      process.stdout.write(s.ok ? "." : "x");
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  console.log();

  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "");
  fs.mkdirSync(path.join(here, "results"), { recursive: true });
  const file = path.join(here, "results", `${MODEL.replace(/[^a-z0-9.-]+/gi, "_")}-${EFFORT}-${PROMPT_V}-${stamp}.csv`);
  const head = ["model", "prompt_v", "id", "run", "ok", "tool_ok", "valid", "ms", "in_tok", "out_tok", "tool", "args", "why", "raw"];
  rows.sort((a, b) => a.id.localeCompare(b.id) || a.run - b.run);
  fs.writeFileSync(file, [head.join(","), ...rows.map((r) =>
    [MODEL, PROMPT_V, r.id, r.run, r.ok, r.toolOk, r.valid, r.ms, r.inTok, r.outTok, r.call?.tool, JSON.stringify(r.call?.args ?? null), r.why, r.raw].map(csvCell).join(",")
  )].join("\n") + "\n");

  const n = rows.length, neg = rows.filter((r) => r.id.startsWith("n"));
  const inTok = rows.reduce((s, r) => s + r.inTok, 0), outTok = rows.reduce((s, r) => s + r.outTok, 0);
  const [pi, po] = PRICE[MODEL] ?? [NaN, NaN];
  const cost = (inTok * pi + outTok * po) / 1e6;
  const ms = rows.map((r) => r.ms);
  console.log(`model        ${MODEL} (effort ${EFFORT}, prompt ${PROMPT_V}), ${golden.length} prompts x ${RUNS} runs`);
  console.log(`schema-valid ${pct(rows.filter((r) => r.valid).length, n)}`);
  console.log(`tool right   ${pct(rows.filter((r) => r.toolOk).length, n)}`);
  console.log(`args right   ${pct(rows.filter((r) => r.ok).length, n)}`);
  console.log(`negatives    ${pct(neg.filter((r) => r.ok).length, neg.length)}`);
  console.log(`latency      p50 ${q(ms, 0.5)} ms, p95 ${q(ms, 0.95)} ms`);
  console.log(`tokens       ${inTok} in, ${outTok} out, ${Number.isNaN(cost) ? "cost n/a" : `$${cost.toFixed(4)} total, $${(cost / n).toFixed(6)} per request`}`);
  const misses = rows.filter((r) => !r.ok);
  if (misses.length) {
    console.log("misses:");
    for (const r of misses) console.log(`  ${r.id}#${r.run} ${r.why} -> ${r.call ? `${r.call.tool} ${JSON.stringify(r.call.args)}` : r.raw}`);
  }
  console.log(`csv          ${path.relative(process.cwd(), file)}`);
}

// ---- compare: every CSV in results/, one row per model + prompt version

function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") row.push(cell), (cell = "");
    else if (c === "\n") row.push(cell), rows.push(row), (row = []), (cell = "");
    else cell += c;
  }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

function compare() {
  const dir = path.join(here, "results");
  const groups = new Map();
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".csv")))
    for (const r of parseCsv(fs.readFileSync(path.join(dir, f), "utf8"))) {
      const key = `${r.model}|${r.prompt_v ?? "unversioned"}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
  const lines = [...groups].map(([key, rs]) => {
    const [model, v] = key.split("|"), neg = rs.filter((r) => r.id.startsWith("n"));
    const ms = rs.map((r) => Number(r.ms));
    return {
      model, v, prompts: new Set(rs.map((r) => r.id)).size, rows: rs.length,
      args: pct(rs.filter((r) => r.ok === "true").length, rs.length),
      neg: pct(neg.filter((r) => r.ok === "true").length, neg.length),
      p50: `${q(ms, 0.5)} ms`,
      misses: rs.filter((r) => r.ok !== "true").map((r) => r.id).join(" "),
    };
  }).sort((a, b) => (b.v === PROMPT_V) - (a.v === PROMPT_V) || a.model.localeCompare(b.model));
  const cols = ["model", "v", "prompts", "rows", "args", "neg", "p50", "misses"];
  const width = Object.fromEntries(cols.map((c) => [c, Math.max(c.length, ...lines.map((l) => String(l[c]).length))]));
  const fmt = (l) => cols.map((c) => String(l[c]).padEnd(width[c])).join("  ");
  console.log(`current prompt ${PROMPT_V}; only rows with the same v are comparable\n`);
  console.log(fmt(Object.fromEntries(cols.map((c) => [c, c]))));
  for (const l of lines) console.log(fmt(l));
}

if (process.argv.includes("--compare")) compare();
else DRY ? dry() : run();

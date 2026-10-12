// Score a model on the golden set.
//   node run.js --dry                       check golden + scorer, no API call
//   node run.js --model claude-haiku-5-5    3 runs per prompt, CSV in results/
// Flags: --runs N  --effort low|medium|high  --only g08,g17  --concurrency N

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import { TOOLS, SYSTEM } from "./tools.js";
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
  return async (prompt) => {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      thinking: { type: "disabled" },
      output_config: { effort: EFFORT },
      tools: TOOLS.map((t) => ({ ...t, strict: true })),
      messages: [{ role: "user", content: prompt }],
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

// ---- dry run: golden must satisfy its own schema and score 100%, mutations must fail

const PLACE_KEYS = ["places", "waypoints", "vertices", "centers", "center", "place"];

function dry() {
  let fails = 0;
  const say = (msg) => (fails++, console.log("FAIL", msg));
  for (const g of golden) {
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
  console.log(`${golden.length} rows, ${fails} failures`);
  process.exit(fails ? 1 : 0);
}

// ---- real run

const pct = (n, d) => (d ? ((100 * n) / d).toFixed(1) + "%" : "n/a");
const q = (xs, p) => xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))];
const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

async function run() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set");
    process.exit(1);
  }
  const ask = await anthropicAdapter();
  const jobs = golden.flatMap((g) => Array.from({ length: RUNS }, (_, run) => ({ g, run })));
  const rows = [];
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const { g, run } = jobs[next++];
      const t0 = Date.now();
      let r;
      try {
        r = await ask(g.prompt);
      } catch (err) {
        r = { call: null, inTok: 0, outTok: 0, raw: `error: ${err.status ?? ""} ${err.message}` };
      }
      const s = score(r.call, g.expect, g.match);
      rows.push({ id: g.id, run, ms: Date.now() - t0, valid: valid(r.call), ...s, ...r });
      process.stdout.write(s.ok ? "." : "x");
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  console.log();

  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "");
  fs.mkdirSync(path.join(here, "results"), { recursive: true });
  const file = path.join(here, "results", `${MODEL}-${EFFORT}-${stamp}.csv`);
  const head = ["model", "id", "run", "ok", "tool_ok", "valid", "ms", "in_tok", "out_tok", "tool", "args", "why", "raw"];
  rows.sort((a, b) => a.id.localeCompare(b.id) || a.run - b.run);
  fs.writeFileSync(file, [head.join(","), ...rows.map((r) =>
    [MODEL, r.id, r.run, r.ok, r.toolOk, r.valid, r.ms, r.inTok, r.outTok, r.call?.tool, JSON.stringify(r.call?.args ?? null), r.why, r.raw].map(csvCell).join(",")
  )].join("\n") + "\n");

  const n = rows.length, neg = rows.filter((r) => r.id.startsWith("n"));
  const inTok = rows.reduce((s, r) => s + r.inTok, 0), outTok = rows.reduce((s, r) => s + r.outTok, 0);
  const [pi, po] = PRICE[MODEL] ?? [NaN, NaN];
  const cost = (inTok * pi + outTok * po) / 1e6;
  const ms = rows.map((r) => r.ms);
  console.log(`model        ${MODEL} (effort ${EFFORT}), ${golden.length} prompts x ${RUNS} runs`);
  console.log(`schema-valid ${pct(rows.filter((r) => r.valid).length, n)}`);
  console.log(`tool right   ${pct(rows.filter((r) => r.toolOk).length, n)}`);
  console.log(`args right   ${pct(rows.filter((r) => r.ok).length, n)}`);
  console.log(`negatives    ${pct(neg.filter((r) => r.ok).length, neg.length)}`);
  console.log(`latency      p50 ${q(ms, 0.5)} ms, p95 ${q(ms, 0.95)} ms`);
  console.log(`tokens       ${inTok} in, ${outTok} out, $${cost.toFixed(4)} total, $${(cost / n).toFixed(6)} per request`);
  const misses = rows.filter((r) => !r.ok);
  if (misses.length) {
    console.log("misses:");
    for (const r of misses) console.log(`  ${r.id}#${r.run} ${r.why} -> ${r.call ? `${r.call.tool} ${JSON.stringify(r.call.args)}` : r.raw}`);
  }
  console.log(`csv          ${path.relative(process.cwd(), file)}`);
}

DRY ? dry() : run();

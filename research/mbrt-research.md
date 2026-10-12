# Zero-bill chat map playground: research (2026-10-11)

Brief: a public, static-hosted (GitHub Pages / Cloudflare Pages) map playground. The LLM only picks one of ~6 tools (route, isochrone, buffer, polygon, elevation profile, geocode/zoom) and emits JSON matching a schema. Turf and routing APIs do all the geometry. Hard requirement: the owner can never be billed, even if a post goes viral.

Method: every claim below was read on a primary page (provider docs, pricing pages, model cards, repo source, raw API output) or measured with curl from this Mac on 2026-10-11. Anything not confirmed on a primary page is tagged [unverified]. Derived numbers (request budgets, download times) were computed with python, assumptions stated. A missing feature is written as "not found", not "no".

---

## A. In-browser inference (visitor's GPU, no server, no key)

### A1. Runtimes

| Runtime | Version (checked) | Tool calling | Schema-constrained JSON | Source |
|---|---|---|---|---|
| WebLLM (MLC) | npm `@mlc-ai/web-llm` 0.2.86, released 2026-10-11 (adds Gemma 4 E2B) | `tools` / `tool_choice` only for 5 Hermes models (Hermes-2-Pro-Llama-3-8B x2, Hermes-2-Pro-Mistral-7B, Hermes-3-Llama-3.1-8B x2). README calls it "preliminary support" | Yes, for any model: `response_format: {type: "json_object", schema: "<json schema string>"}`, plus `type: "grammar"` (EBNF) and `type: "structural_tag"`. Backed by `@mlc-ai/web-xgrammar` 0.1.27 | `src/config.ts` `functionCallingModelIds` and `src/openai_api_protocols/chat_completion.ts` in https://github.com/mlc-ai/web-llm ; package.json; `gh api repos/mlc-ai/web-llm/releases` |
| XGrammar (engine under WebLLM) | main | n/a | JSON-schema converter source handles `anyOf`, `oneOf`, `allOf`, `$ref`, `enum`, `const` | https://github.com/mlc-ai/xgrammar/blob/main/cpp/json_schema_converter.cc (grepped). Whether the web 0.1.27 build matches main: [unverified] |
| transformers.js (HF) | `@huggingface/transformers` 4.3.1 (2026-10-07) | Via chat templates (model-dependent); no runtime-level tool parser found | New: `@huggingface/transformers-structured-output` 4.3.1 (npm, modified 2026-10-06), labelled "Experimental". `StructuredOutputProcessor` constrains generation to JSON schema / JSON object / regex. Supports `const`, `enum`, `allOf/anyOf/oneOf/not`, local `$ref`, `$defs`. Rejects `pattern` and `format`. Batch size 1 only | https://github.com/huggingface/transformers.js/blob/main/packages/transformers-structured-output/README.md |
| ONNX Runtime Web (WebGPU EP) | docs page | n/a (low-level) | not found (no built-in constrained decoding) | https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html (note: this page still says Safari WebGPU is "Technology Preview" only, which is stale vs caniuse) |
| Chrome Prompt API (Gemini Nano, built-in) | Chrome 138+ | not found on page | Yes, `responseConstraint` JSON Schema (and regex) | https://developer.chrome.com/docs/ai/prompt-api . Desktop only: "Chrome for Android and iOS are not yet supported"; needs 22 GB free disk, GPU >4 GB VRAM or 16 GB RAM + 4 cores. Unusable as the primary for a public viral page |

Key design consequence: in WebLLM, do NOT use the `tools` field (Hermes 7B/8B only). Use `response_format.schema` with a single discriminated-union schema (`{"tool": enum, "args": anyOf[...]}`). Then every output is schema-valid by construction; accuracy is the only open question. Caveat from WebLLM source: "you **must** also instruct the model to produce JSON following the schema ... Without this, the model may generate an unending stream of whitespace."

### A2. Small models available in-browser, with sizes

Download size = sum of the Hugging Face repo files (WebLLM) or of the `onnx/` files with that quant suffix (transformers.js), via the HF API on 2026-10-11. VRAM = `vram_required_MB` in WebLLM `src/config.ts`.

| Model | Runtime / build | Download | VRAM (WebLLM) | Tool-use evidence (model card) |
|---|---|---|---|---|
| Qwen3-0.6B | WebLLM q4f16_1 | 352 MB | 1403 MB | none read |
| Qwen3.5-0.8B | WebLLM q4f16_1 | 447 MB | 1629 MB | BFCL-V4 25.3, TAU2 11.6 (https://huggingface.co/Qwen/Qwen3.5-2B) |
| Qwen3-1.7B | WebLLM q4f16_1 | 984 MB | 2037 MB | BFCLv3 46.30 (quoted in LFM2.5 card, https://huggingface.co/LiquidAI/LFM2.5-1.2B-Instruct) |
| Qwen3.5-2B | WebLLM q4f16_1 | 1083 MB | 2245 MB | BFCL-V4 43.6, TAU2 48.8; "non-thinking mode by default"; card warns 2B "more prone to thinking loops"; Apache-2.0 (https://huggingface.co/Qwen/Qwen3.5-2B) |
| Qwen3.5-4B | WebLLM q4f16_1 | 2390 MB | 3868 MB | BFCL-V4 50.3, TAU2 79.9 (https://huggingface.co/Qwen/Qwen3.5-4B) |
| Qwen3-4B | WebLLM q4f16_1 | 2279 MB | 3432 MB | none read |
| Llama-3.2-1B-Instruct | WebLLM q4f16_1 | 705 MB | 879 MB | BFCLv3 21.44 (LFM2.5 card) |
| Llama-3.2-3B-Instruct / Hermes-3-Llama-3.2-3B | WebLLM q4f16_1 | 1817 MB | 2264 MB | Hermes-3-3B not in WebLLM's `functionCallingModelIds` |
| Phi-4-mini-instruct | WebLLM q4f16_1 | 2180 MB | 3438 MB | none read |
| Gemma 4 E2B-it | WebLLM q4f16_1 (new in 0.2.86) | 2831 MB | 3387 MB | none read |
| SmolLM2-1.7B-Instruct | WebLLM q4f16_1 | 966 MB | 1774 MB | none read |
| Ministral-3-3B-Instruct-2512 | WebLLM q4f16_1 | 1946 MB | 2864 MB | Mistral docs list Ministral 3 3B as function-calling capable (https://docs.mistral.ai/capabilities/function_calling/) |
| FunctionGemma 270M | transformers.js, `onnx-community/functiongemma-270m-it-ONNX` q4f16 | 426 MB | n/a | BFCL Simple 61.6, Multiple 63.5, Relevance 61.1, Irrelevance 73.7 (0-shot). Card: "intended to be fine-tuned for your specific function-calling task"; Mobile Actions 58% base vs 85% fine-tuned. Gemma licence (https://huggingface.co/google/functiongemma-270m-it) |
| LFM2.5-1.2B-Instruct | transformers.js, `LiquidAI/LFM2.5-1.2B-Instruct-ONNX` q4f16 | 760 MB (card says Q4 ~1.2 GB) | n/a | BFCLv3 49.12 vs Granite 4.0-1B 52.43, Qwen3-1.7B 46.30. Card: Q8 "not supported on WebGPU". Licence "lfm1.0" |
| Qwen3.5-0.8B / 2B | transformers.js ONNX q4f16 | 647 MB / 1582 MB (folder may include vision parts) | n/a | as above |
| granite-4.0-1b | transformers.js `onnx-community/granite-4.0-1b-ONNX-web` q4f16 | 1247 MB | n/a | BFCLv3 52.43 (LFM2.5 card) |

Read: no sub-4B model has a published tool-use score that suggests it will be reliable zero-shot on open prompts. Our task is far narrower (6 tools, short args), so a golden set (section D) is the only honest arbiter. FunctionGemma is the interesting wildcard: 270M, built for exactly this, but explicitly meant to be fine-tuned first.

### A3. WebGPU availability (caniuse raw data, https://github.com/Fyrd/caniuse/blob/main/features-json/webgpu.json and https://caniuse.com/webgpu)

| Browser | Status |
|---|---|
| Chrome / Edge desktop | Yes since 113 (Linux "depends on hardware and drivers") |
| Chrome Android | Yes (154) |
| Safari iOS / iPadOS | Yes since 26.0 (WebKit: WebGPU "is now shipping in Safari 26 ... for macOS, iOS, iPadOS, and visionOS", https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/) |
| Safari macOS | Partial: "only being enabled by default on macOS 26 Tahoe or later" |
| Firefox desktop | Partial: "Only enabled by default on Windows as well as macOS 26 Tahoe or later on Apple Silicon" |
| Firefox Android | Flag only |
| Global coverage | 87.82% (caniuse page) |

iPhone reality: WebLLM issue #753 (https://github.com/mlc-ai/web-llm/issues/753): on iOS 26 Safari, SmolLM2-135M ran, but Qwen2.5-3B-Instruct q4f16 made Safari kill the tab right after download. A WebLLM collaborator suspects Apple limits WebContent processes to ~1.5 GB RAM, "though I couldn't find any official documentation about this" [unverified limit]. Practical read: on iPhone, only sub-1 GB models are plausible, and even that is not proven here.

### A4. First-load reality

Computed download time (python, size x 8 / bandwidth, ignoring overhead):

| Model | Size | 10 Mbps | 25 Mbps | 50 Mbps | 100 Mbps |
|---|---|---|---|---|---|
| Qwen3-0.6B (WebLLM) | 352 MB | 282 s | 113 s | 56 s | 28 s |
| Qwen3.5-0.8B (WebLLM) | 447 MB | 358 s | 143 s | 72 s | 36 s |
| LFM2.5-1.2B q4f16 (ONNX) | 760 MB | 608 s | 243 s | 122 s | 61 s |
| Qwen3-1.7B (WebLLM) | 984 MB | 787 s | 315 s | 157 s | 79 s |
| Qwen3.5-2B (WebLLM) | 1083 MB | 866 s | 347 s | 173 s | 87 s |
| Llama-3.2-3B (WebLLM) | 1817 MB | 1454 s | 581 s | 291 s | 145 s |
| Qwen3-4B (WebLLM) | 2279 MB | 1823 s | 729 s | 365 s | 182 s |

Plus shader compile and weight upload on top [no primary timing found]. WebLLM docs: first run "can take a significant amount of time ... without previous caching" (https://webllm.mlc.ai/docs/user/basic_usage.html). WebLLM paper: "up to 80% native performance on the same device" (https://arxiv.org/abs/2412.15803). Weights are fetched from huggingface.co and the model library from raw.githubusercontent.com (`modelLibURLPrefix` in config.ts), so the owner pays no bandwidth.

---

## B. Free hosted APIs behind a tiny proxy

Budget column assumes 1,200 input + 120 output tokens per tool-pick request (system prompt + 6 tool schemas + user message, short JSON out). Computed with python.

| Provider | Free limits (primary page) | Can a bill arrive? | Tool calling / JSON schema | Budget at 1.2K/120 tok | Public-app terms | Verdict |
|---|---|---|---|---|---|---|
| **Cloudflare Workers AI** (Workers Free plan) | "10,000 Neurons per day at no charge"; resets 00:00 UTC (05:30 IST). Default 300 RPM for non-paid models (https://developers.cloudflare.com/workers-ai/platform/pricing/ , https://developers.cloudflare.com/workers-ai/platform/limits/) | **No on Workers Free.** Pricing table for Free: "N/A - Upgrade to Workers Paid"; "If you exceed any one of the above limits, further operations will fail with an error." Charges ($0.011 / 1,000 neurons) apply only "On Workers Paid". Workers Free itself: 100,000 requests/day, then "Error 1027" (https://developers.cloudflare.com/workers/platform/limits/) | Function calling "Yes" on model pages for granite-4.0-h-micro, qwen3-30b-a3b-fp8, gemma-4-26b-a4b-it, glm-4.7-flash, gpt-oss-20b, llama-3.3-70b. `response_format` param present on those pages but fields undocumented. JSON-mode page: Workers AI "can't guarantee" schema compliance; returns "JSON Mode couldn't be met" error; no streaming in JSON mode (https://developers.cloudflare.com/workers-ai/features/json-mode/) | granite-4.0-h-micro ~3,258/day; qwen3-30b-a3b ~1,086/day (more if it emits thinking tokens, fewer real); glm-4.7-flash ~911; gemma-4-26b-a4b ~705; gpt-oss-20b ~398; llama-3.3-70b ~176 | No key leaves the Worker (AI binding). Turnstile free with "Unlimited challenges" (https://developers.cloudflare.com/turnstile/plans/) | **Best hosted option.** Hard stop, no card, same platform as Pages |
| **Groq** Free plan | Table under the default "Free Plan Limits" tab: gpt-oss-20b / gpt-oss-120b / qwen/qwen3.8-27b: 30 RPM, 1K RPD, 8K TPM, 200K TPD. The prose on the same page says the table shows "base limits for the Developer plan", so it is ambiguous (https://console.groq.com/docs/rate-limits) | Over limit: "429 Too Many Requests". Card for Free: billing FAQ says upgrading needs "a valid payment method", implying Free does not (https://console.groq.com/docs/billing-faqs) [card-free inferred] | All Groq models support tool use. Strict `json_schema` (constrained decoding) on gpt-oss-20b, gpt-oss-120b, qwen3.8-27b; but "Streaming and tool use are not currently supported with Structured Outputs"; strict needs every property in `required` and `additionalProperties: false` (https://console.groq.com/docs/structured-outputs , https://console.groq.com/docs/tool-use) | TPM caps it at ~6 req/min; TPD caps it at ~151 req/day | Public-app restrictions: not reviewed [unverified] | Fast, strict schema, but ~150 requests/day is tiny |
| **Google Gemini API** free tier | Numbers are no longer printed on the docs page; it points to AI Studio (https://ai.google.dev/gemini-api/docs/rate-limits). Free tier "Free of charge" listed for Gemini 3.8 Flash, 3.6 Flash, 3.5/3.1 Flash-Lite, 2.5 Flash/Pro, Gemma 4 (https://ai.google.dev/gemini-api/docs/pricing). Exact RPM/RPD [unverified] | "AI Studio usage remains free of charge unless users link a paid API key"; charges come only from linking billing (https://ai.google.dev/gemini-api/docs/billing). Risk: a project accidentally linked to billing is postpay | Structured output with `anyOf`, `enum`, `$ref` examples; "Not all JSON Schema features are supported" (https://ai.google.dev/gemini-api/docs/structured-output) | [unverified] | Free tier content "used to improve our products", human reviewers may read it; "You may use only Paid Services when making API Clients available to users in the European Economic Area" (UK/Switzerland coverage [unverified]); must be 18+, and not for apps "likely to be accessed by individuals under the age of 18" (https://ai.google.dev/gemini-api/terms) | Strong model, but a worldwide public page breaks the EEA clause unless you geo-block EEA (UK/CH [unverified]) in the Worker |
| **OpenRouter** `:free` models | <10 credits purchased ever: 20 RPM, **50 requests/day**; >=10 credits: 20 RPM, 1,000/day (https://openrouter.ai/docs/api/reference/limits) | Prepaid credits ("Credits are simply deposits", https://openrouter.ai/docs/faq). Negative balance gives 402 even on free models | 15 free models on 2026-10-11 via `/api/v1/models`; with `tools` + `structured_outputs`: liquid/lfm-2.5-2.6b:free, nvidia/nemotron-3-super-120b-a12b:free, apodex-1.1-mini:free, dots-3-note-preview:free; tools only: gemma-4-26b-a4b-it:free, gemma-4-31b-it:free, nemotron variants, others | 50/day without paying | Free-model training/logging: "separate settings for paid and free models" (https://openrouter.ai/docs/guides/privacy/logging); specifics not found | 50/day is a toy; 1,000/day needs a one-time $10 top-up (not zero-cost) |
| **Cerebras** | Free Trial: gpt-oss-120b and qwen-3.8-27b: 5 RPM, 1M TPD | Free trial now **requires a verified payment method**; "Playground and API access remain inactive until you do" (https://inference-docs.cerebras.ai/support/rate-limits) | not checked | ~757/day by TPD, 5 RPM | n/a | Card on file: disqualified for "no bill ever" comfort |
| **Mistral** (Free mode, ex "Experiment") | "API access is enabled by default with no credit card required" (https://docs.mistral.ai/getting-started/quickstarts/studio/activate-and-generate-api-key). "Free mode (the default) has the lowest limits, intended for evaluation and prototyping" (https://help.mistral.ai/en/articles/698531). Numbers not published on primary pages; third-party 1 RPS / 500K TPM / 1B tok/month [unverified] | No card | Function calling on Ministral 3 3B/8B/14B, Small 3.2, etc. (https://docs.mistral.ai/capabilities/function_calling/) | [unverified] | "evaluation and prototyping" intent; free data used for training per third-party summaries [unverified] | Plausible backup, limits opaque |
| **GitHub Models** | "As of July 30, 2026, GitHub Models has been fully retired" (https://docs.github.com/en/github-models/use-github-models/prototyping-with-ai-models) | n/a | n/a | n/a | n/a | Gone |
| **Hugging Face Inference Providers** | Free users: "None" monthly credits (https://huggingface.co/docs/inference-providers/pricing) | Needs purchased credits | n/a | 0 | n/a | Not free |
| **Cohere** trial key | Chat 20 req/min; "limited to 1,000 API calls a month"; trial keys are "evaluation keys" (https://docs.cohere.com/docs/rate-limits) | No card for trial [unverified] | not checked | ~33/day | evaluation only | Toy |

Proxy notes: a Cloudflare Worker on Free holds the key or binding; Rate Limiting binding exists (period 10 or 60 s, eventually consistent, per-location; Free-plan availability not stated on the page, https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) [Free availability unverified]. Turnstile (free, unlimited challenges) gates the chat endpoint against bots.

---

## C. Free map backends (no Mapbox)

CORS: measured with `curl -H "Origin: https://example.github.io"` on 2026-10-11. All returned `access-control-allow-origin: *` except ORS without key (401).

| Need | Service | Free terms (primary) | Browser-callable? | Viral risk | Source |
|---|---|---|---|---|---|
| Tiles | **OpenFreeMap** | "no limits on the number of map views or requests", "no registration, no user database, no API keys, and no cookies", commercial use "Yes", attribution required. Funded by donations. Styles: Positron, Bright, Liberty, Dark, Fiord, 3D | Yes (CORS *) | Low per their own statement; single donation-funded operator | https://openfreemap.org/ |
| Tiles | **Protomaps PMTiles** self-hosted | Planet ~120 GB; use `pmtiles extract` for a region; daily builds: "hotlinking to these downloads are discouraged". ODbL produced work | Yes, from your own host | None if the extract lives on your host | https://docs.protomaps.com/basemaps/downloads |
| Tiles host | GitHub Pages | 1 GB site, soft 100 GB/month bandwidth, "we may not be able to serve your site" if exceeded; not for commercial SaaS. Range requests work (measured `HTTP/2 206`, `accept-ranges: bytes` on two github.io hosts). Protomaps: "If your PMTiles file fits, it's an easy way to host" | n/a | 100 GB soft cap: heavy tile traffic could trip it (degradation, not a bill) | https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits , https://docs.protomaps.com/pmtiles/cloud-storage |
| Tiles host | Cloudflare Pages | "maximum file size for a single Cloudflare Pages site asset is 25 MiB"; 20,000 files; bandwidth limits not stated | n/a | 25 MiB caps a PMTiles file to a small city extract | https://developers.cloudflare.com/pages/platform/limits/ |
| Tiles host | Cloudflare R2 | 10 GB-month, 1M Class A, 10M Class B free; free egress; overage billed | n/a | **Billable beyond free tier**; avoid for a no-bill guarantee | https://developers.cloudflare.com/r2/pricing/ |
| Tiles | MapTiler Free | 5k map sessions, 100k API requests/month; "service will pause until the next month"; "No credit card needed"; "testing, PoC, prototyping, personal, or non-commercial use" | Key in browser | Pauses fast when viral (no bill) | https://www.maptiler.com/cloud/pricing/ |
| Tiles/geo/routing | Esri ArcGIS Location Platform | 2M basemap tiles, 20K geocodes, 20K routes, 5K service areas, 50K elevation points free, "then $0.15 per 1,000 tiles" etc. Stop-vs-charge not stated | Key in browser | **Overage is priced**: bill risk | https://location.arcgis.com/pricing/ |
| Geocode | **Nominatim** (OSMF) | "an absolute maximum of 1 request per second"; identify app via Referer/UA; "Results must be cached on your side"; autocomplete "must not" be implemented client-side; "Apps must make sure that they can switch the service at our request at any time"; access may be withdrawn | Yes (CORS *) | High: 1 req/s is per application, viral traffic breaches it | https://operations.osmfoundation.org/policies/nominatim/ |
| Geocode | **Photon** (komoot) | "please be fair - extensive usage will be throttled"; no availability guarantee | Yes (CORS *) | Medium: throttling, no hard number | https://photon.komoot.io/ |
| Route | OSRM demo (router.project-osrm.org) | "Do not exceed 1 request per second"; "restricted to reasonable, non-commercial use-cases"; car, foot, bike | Yes (CORS *) | High | https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server |
| Route / isochrone / height | **FOSSGIS Valhalla** (valhalla1.openstreetmap.de) and OSRM (routing.openstreetmap.de, car/bike/foot) | Routing servers: "Maximum one request per second". "Websites with high traffic volumes are generally not permitted to use our services." Commercial only if not "a substantial part of an online offering". Operator email must be visible on the site. Services may be discontinued or permission revoked "at any time without giving reasons" | Yes (CORS * on /route, /isochrone, /height) | High: explicitly bars high-traffic sites | https://www.fossgis.de/arbeitsgruppen/osm-server/nutzungsbedingungen/ (rendered past its Anubis gate), https://routing.openstreetmap.de/about.html |
| Route / isochrone / elevation / geocode | **openrouteservice** (HeiGIT) Standard, 0 EUR | Daily/per-minute: Directions 2000/40, Isochrones 500/20, Matrix 500/40, Elevation 2000/40, Geocoding 3000/100, POIs 500/60. Collaborative plan (5x) for non-profit/academic orgs | Needs key (401 without); proxy it through the Worker | Medium: hard daily caps, no bill | https://account.heigit.org/info/plans (JS page, rendered headless) |
| Route / isochrone | GraphHopper Free | 500 credits/day; "The Free Plan is for non-commercial use only"; "No credit card required" | Needs key | Medium | https://www.graphhopper.com/pricing/ |
| Elevation | **AWS Terrain Tiles** (Mapzen/Tilezen, `s3://elevation-tiles-prod`) | Public bucket, "access requires no AWS account" per registry summary; attribution to USGS/NOAA etc. Cost to requester not stated | Yes (CORS *, measured on a terrarium PNG) | Low; decode terrarium RGB client-side, sample along the line | https://registry.opendata.aws/terrain-tiles/ , https://github.com/tilezen/joerd/blob/master/docs/attribution.md |
| Elevation | Open-Meteo Elevation | Copernicus GLO-90 (90 m); up to 100 coords/request; free non-commercial "Less than 10'000 API calls per day, 5'000 per hour and 600 per minute"; ads or subscriptions = commercial | Yes (CORS *) | Medium: shared daily cap | https://open-meteo.com/en/docs/elevation-api , https://open-meteo.com/en/terms |
| Elevation | OpenTopoData public | "Max 100 locations per request", "Max 1 call per second", "Max 1000 calls per day" | [CORS not measured] | High | https://www.opentopodata.org/ |
| Buffer, polygon, area | Turf.js in browser | no backend | n/a | None | n/a |

Takeaway for C: tiles (OpenFreeMap or own PMTiles), buffer/polygon (Turf) and elevation (AWS terrain tiles decoded in-browser) survive virality at zero cost. **Geocoding, routing and isochrones are the weak link**: every free public instance is either 1 req/s, explicitly anti-high-traffic, or daily-capped. None of them can bill you; they throttle, block, or revoke.

---

## D. Recommendation

### Invariants (what must never break)
1. No component sits on a plan that can bill: Workers **Free** (never subscribe to Workers Paid on that account), no R2, no Esri, no Gemini billing link, no Cerebras card.
2. Every quota exhaustion surfaces as a visible state in the UI, never a silent provider swap.
3. The LLM only emits `{tool, args}` validated with ajv against the same schema; geometry is deterministic. The tool forms work with no LLM at all (manual mode), so the page is never dead.

### Stack

| Layer | Primary | Explicit alternative (user-chosen) |
|---|---|---|
| Brain | **"Shared cloud" mode**: Cloudflare Worker (Free) + Workers AI binding. Candidates for the golden set: `gemma-4-26b-a4b-it` (~705 req/day), `qwen3-30b-a3b-fp8` (~1,086/day, watch thinking tokens), `granite-4.0-h-micro` (~3,258/day). Turnstile on the endpoint, per-IP throttle, live "N of ~X shared requests left today, resets 05:30 IST" meter | **"On-device" mode**: WebLLM 0.2.86, `response_format: {type:"json_object", schema}` (XGrammar-constrained). Shortlist: Qwen3.5-2B (1.08 GB), Qwen3-1.7B (0.98 GB), Qwen3.5-0.8B (0.45 GB, phones). Offered as a button: "Run on your device: one-time ~1 GB download, then free and unlimited" |
| Tiles | OpenFreeMap Liberty/Positron | Self-hosted Bengaluru PMTiles extract on GitHub Pages (range requests verified) |
| Geocode | Photon, submit-only (no autocomplete), cached in localStorage | Nominatim (1 req/s, cached) as a user toggle |
| Route / isochrone | FOSSGIS Valhalla (/route, /isochrone), client throttled to 1 req/s, with the required OSM + fixthemap attribution and an operator email on the page | openrouteservice via the same Worker (key server-side; 2000 routes, 500 isochrones/day) as a toggle when Valhalla refuses |
| Elevation profile | AWS terrarium tiles decoded in-browser (no quota) | Valhalla /height or Open-Meteo |
| Buffer / polygon | Turf | n/a |

Why this shape: hosted is the only path that works instantly on an iPhone and for a scroll-by visitor, and Workers AI Free is the only hosted option found with a documented hard stop, no card, and no third-party key in the browser. But it dies at roughly 400 to 3,000 requests a day depending on model, which a viral post exhausts in an hour. On-device is the only brain with no ceiling at all, but costs the visitor a ~0.5 to 1 GB download and is shaky on iPhone (#753 tab kills above ~1.5 GB [unverified limit]). So both are offered as an explicit choice, with the UI recommending one by capability detection (`navigator.gpu`, `adapter.limits`, device memory) rather than switching silently.

Honest trade-offs:
- Gemini free is likely the strongest free model, but its terms forbid serving EEA users from unpaid services and require 18+ audiences; usable only with geo-blocking EEA in the Worker (UK/CH [unverified]) and accepting that prompts are used for training.
- Groq has strict schema decoding but ~150 requests/day at this prompt size (8K TPM, 200K TPD), and Structured Outputs cannot be combined with tool use or streaming.
- Viral traffic will hit FOSSGIS/OSM services' "no high-traffic sites" rule before it hits any LLM limit. If a post takes off, the routing toggle to ORS (daily-capped, keyed) or a "routing busy" state is the honest answer; a self-hosted Valhalla would need a server, which breaks the zero-cost premise.
- Workers AI JSON mode is best-effort ("can't guarantee"), so the cloud path needs ajv validation plus one retry; WebLLM's grammar path is valid by construction.

### Evaluating models objectively: golden prompt set

Build `golden.jsonl`, 80 to 120 rows, each `{id, prompt, expect: {tool, args}, tolerance}`:
- Per tool, about 12 prompts: plain, paraphrased, terse ("10 min walk from Cubbon Park"), Hinglish/Kannada-English mixes, unit variants (km vs m vs minutes), and implicit context ("now make it 2 km").
- 10 to 15 negatives: chit-chat, unsupported ops ("weather"), ambiguous ("route" with no endpoints) where the correct output is a `clarify` / `none` tool.
- Tolerances: numbers within an epsilon after unit normalisation; place strings compared after lowercase/strip, or by geocoding both and checking within 500 m; enum values exact.

Metrics per model (3 runs, temperature 0, same system prompt and schema):
| Metric | Definition |
|---|---|
| Schema-valid rate | ajv pass / total (expect 100% on WebLLM/Groq-strict; the real number matters on Workers AI) |
| Tool-name accuracy | correct `tool` / total, plus a confusion matrix across the 6 tools + none |
| Parameter accuracy | exact-match of the full `args` object, and per-field accuracy |
| Negative handling | share of negatives that correctly return none/clarify |
| Latency | p50/p95 end-to-end; for on-device also time-to-ready (download + init, cold and warm cache) and tokens/s |
| Cost to quota | neurons per request on Workers AI (from usage), to convert accuracy into requests/day |

Harness: one node script hits the Worker (cloud models) and a small headless page runs WebLLM/transformers.js models and posts results back; write one CSV row per (model, prompt, run). Pick the cloud default by "parameter accuracy at >= ~700 req/day budget" and the on-device default by "parameter accuracy per MB downloaded". Re-run whenever WebLLM adds a model or Workers AI changes pricing.

---

## Not verified / gaps
- Gemini free-tier numeric limits (docs defer to AI Studio).
- Mistral free numeric limits and training-data clause (primary pages give no numbers).
- Groq table's plan attribution (tab says Free, prose says Developer).
- Whether the Workers Rate Limiting binding is on Workers Free.
- The ~1.5 GB iOS WebContent memory ceiling (issue comment, no Apple doc).
- Whether web-xgrammar 0.1.27 (the build WebLLM ships) matches xgrammar main's `anyOf`/`oneOf` handling.
- Real on-device tokens/s and init time on target phones: no primary benchmark found; measure in the harness.

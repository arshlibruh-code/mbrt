<img src="app/public/mbrt-banner.svg" alt="mbrt" width="600">

# mbrt

Chat to a map. Type "30 min drive from Koramangala" and get the reachable area drawn.

## How it works

A small model, Theo, reads the message and picks one of 12 tools as JSON (`{tool: "isochrone", args: {center: "Koramangala", unit: "minutes", values: [30]}}`). It never produces coordinates. Plain code does the rest: Photon finds the places, OSRM routes, Valhalla draws reach and heights, Turf draws buffers and polygons, Nominatim gives boundaries.

A new area pings out from its center when the camera lands, then rests with its number on the map. Every tool also has a form, so the map works with no model at all. The feed reads like a chat: your message, one line from Theo ("Mapped a 30 min drive from Koramangala · 2.1 s"), the result. ▸ unfolds every step: the model, its tokens, what the geocoder found, the exact call. "copy conversation" copies the whole session as text.

| tool | does |
|---|---|
| markers | pins on places, or "top 5 in Jaipur" |
| route | road route through waypoints, with distance and time |
| line | straight lines between places |
| buffer | radius around each center |
| isochrone | area reachable in N minutes or km, drawn as four bands; a chip lifts it into 3D |
| polygon | area between places |
| elevation_profile | height chart along a route or a selected line |
| boundary | official outline of a state, district or city |
| map | style, zoom, center, 3D terrain, clear, locate |
| inside | what an area holds: places of a kind, a summary, green cover, roads, terrain, flooding to a level, 3D buildings, notable places, earthquakes |
| plan | several steps from one message, run one by one |
| reply | asks back when something is missing |

## The panel

⚙ on the chat bar (or `/`) opens a sheet docked left, and the map slides over to stay in view.

| tab | holds |
|---|---|
| TOOL | the 8 tools as icons (keys `1` to `8`), places you can pick on the map, ghost pins while you edit, a Run button that reads out the call |
| LAYERS | every result on the map: hide, edit and run again, delete, export GeoJSON |
| BRAIN | which model answers, and on whose account |
| MAP | basemap, 3D terrain, go to coordinates, my location |

## Brains

The chip under the chat input says who answers (`◆ SHARED · GPT-OSS-120B`); click it to switch.

| brain | how | pays |
|---|---|---|
| Shared | our Groq key, server-side | free, one shared limit |
| OpenRouter | sign in (PKCE), any model with tool calls | your OpenRouter credits; the BRAIN tab shows spend and what is left |
| Your key | paste a Groq, Anthropic, OpenAI, Gemini or OpenRouter key; the provider is detected and checked | your account; the key stays in your browser and goes straight to the provider |
| ChatGPT | sign in with ChatGPT, **only when you run mbrt yourself** (OpenAI's flow needs a loopback on your machine; tokens sit in `~/.mbrt/`) | your plan's allowance |

Tokens per answer, a tally for the session, and OpenRouter's dollars are shown where they apply.

## Run

```
cd app && npm i
export GROQ_API_KEY=...   # free at console.groq.com, stays server-side; it powers the shared brain
npm run dev
```

## Eval

`eval/` scores any model on 74 prompts: 50 real ones, 5 that should get a clarifying reply, 6 follow-ups that lean on earlier turns, 3 that need a plan, 10 that look inside an area.

```
cd eval && npm i
node run.js --dry                                                    # check the golden set and scorer
node run.js --model opencode:mimo-v2.6-flash-free --concurrency 3    # OpenCode's free models, through the opencode CLI
node run.js --model groq:openai/gpt-oss-120b --runs 1 --concurrency 1
node run.js --compare                                                # every result, by model and prompt version
```

Adapters: `opencode:<model>` (free, uses your OpenCode login; the tools go in the prompt), `zen:<model>` (OpenCode's paid API), `groq:<model>`, `codex[:model]` (your ChatGPT plan through the Codex CLI), and Anthropic by model name.

Shipped: `gpt-oss-120b` on Groq, 96.9% (62/64), about 0.8 s per message.
Free check on OpenCode: `mimo-v2.6-flash-free` 97.7% on the current prompt (214 of 219 answers over 3 runs of the 74 prompts; 3 more were lost to the OpenCode CLI's own database lock, not the model), about 7 s per message (OpenCode wraps every call in its own agent prompt).

## Stack

MapLibre, OpenFreeMap, Photon, OSRM and Valhalla (FOSSGIS), Nominatim, Overpass, Wikipedia, USGS, Turf, AWS terrain tiles, Esri imagery. No Mapbox. Our key never reaches the browser; yours never reaches our server.

## Parked

- Deploy to Pages: auto-deploy or by hand, a separate Groq account for the public site, a contact email (FOSSGIS asks for one), the absolute og:image URL.
- Pick a direction in the style lab (`app/lab.html`: reticle, surveyor, phosphor) and port its tokens into the map.
- Colour roles on the map and in LAYERS (cyan for the latest result, white for older ones), from the lab.
- Isochrone fills with shader work: 4 distinct options on one page to compare.
- "inside" in the TOOL tab (chat only for now).
- Re-run Groq on all 74 rows once its free daily limit resets (it shares the key with the shared brain, so run it when nobody is using the app). Overpass's public servers are often busy; places and green cover fail when all of them are.

Map data © OpenStreetMap contributors.

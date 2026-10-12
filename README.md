<img src="app/public/mbrt-banner.png" alt="mbrt" width="600">

# mbrt

Chat to a map. Type "30 min drive from Koramangala" and get the reachable area drawn.

## How it works

A small model reads the message and picks one of 10 tools as JSON (`{tool: "isochrone", args: {center: "Koramangala", unit: "minutes", values: [30]}}`). It never produces coordinates. Plain code does the rest: Photon finds the places, Valhalla routes, Turf draws buffers and polygons, Nominatim gives boundaries.

Every tool also has a form, so the map works with no model at all, and every step (what the model chose, what the geocoder found, what failed) is shown in the panel.

| tool | does |
|---|---|
| markers | pins on places, or "top 5 in Jaipur" |
| route | road route through waypoints, with distance and time |
| line | straight lines between places |
| buffer | radius around each center |
| isochrone | area reachable in N minutes or km |
| polygon | area between places |
| elevation_profile | height chart along a route or a selected line |
| boundary | official outline of a state, district or city |
| map | style, zoom, center, 3D terrain, clear, locate |
| reply | asks back when something is missing |

## Run

```
cd app && npm i
export GROQ_API_KEY=...   # free at console.groq.com, stays server-side
npm run dev
```

## Eval

`eval/` scores any model on 55 prompts (50 real ones plus 5 that should get a clarifying reply).

```
cd eval && npm i
node run.js --dry                                                    # check the golden set and scorer
node run.js --model groq:openai/gpt-oss-120b --runs 1 --concurrency 1
node run.js --compare                                                # every result, by model and prompt version
```

Current pick: `gpt-oss-120b` on Groq, 98.2% (54/55), about 0.8 s per message.

## Stack

MapLibre, OpenFreeMap, Photon, Valhalla (FOSSGIS), Nominatim, Turf, AWS terrain tiles, Esri imagery. No Mapbox, no keys in the browser.

Map data © OpenStreetMap contributors.

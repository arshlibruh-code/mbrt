# mbrt style lab

Open http://localhost:5173/lab.html on the existing Vite server. This entry is absent from the default production build.

One frozen Bengaluru scene, three token files, synced cameras, selection, hover and elevation cursors. OFFLINE uses a blank globe without remote styles, tiles or glyphs. The font, geometry, heights and service responses are local. SAT, DARK and MAP need network tiles.

The fixture contains the OSRM MG Road to Nandi Hill drive, 200 Valhalla heights, Hebbal's real 10/20/30 minute contours, a 5 km Cubbon Park buffer, a three-vertex city triangle, Yelahanka taluku's administrative boundary, a straight MG Road to Palace line, a Bengaluru to London great-circle arc and five numbered stops. Clusters expand on click. Numbers, arrival replay and the future-tool samples share state across the panels.

## Port the winner

Use `look/<winner>.js` and `draw.js`. The renderer owns its DOM skin and elevation chart skin, so `lab.css` is only the lab shell. The app already provides Quantico and MapLibre's stylesheet.

```js
import look from './lab/look/reticle.js';
import { createRenderer, createElevationChart } from './lab/draw.js';

const renderer = createRenderer({
  map, tokens: look, features: featureCollection, elevation,
  onSelect: id => renderer.setState({ selected: id }),
  onHover: id => renderer.setState({ hovered: id }),
  onCursor: ratio => renderer.setCursor(ratio),
});
renderer.setState({ numbers: true });
renderer.replay();
```

Features keep `properties.kind` and `properties.label`. IDs use `feature.id`, then `properties.fid`, then an assigned ID. Missing line lengths and area measurements are computed locally. `status` defaults to `older`; use `latest`, `waiting` or `error` for the semantic roles. `variant: 'arc'` distinguishes the great-circle sample. Optional `view: 'CITY' | 'WORLD'` filters the lab presets; the renderer defaults to all features.

`elevation` is optional. Its `routeId` and `samples: [{ coordinate, km, meters }]` feed grade segments and the chart. `createElevationChart(host, look, samples, onCursor)` returns `setCursor(ratio)`. Call both chart and renderer cursor methods to link them.

`basemaps.js` copies the current app's basemaps and skies. Share those constants with main.js when porting. No existing app file was changed here.

## Fixture and checks

`node app/lab/generate-fixture.mjs` refuses to overwrite the frozen fixture. Responses are cached in `sources/` by exact URL and request body. Fresh requests run sequentially with at least 1.1 seconds between request starts. Photon candidates must match the requested place identity; Nominatim must return an administrative polygon smaller than a district.

OSRM road distance is 62.5897 km. Valhalla's sampled path is 60.151 km. Each readout preserves its source measurement; route ticks scale to OSRM chainage. Duration is an estimate without live traffic. Elevation, gain and grade are sampled terrain, not a road survey.

Future slots are illustrative. Heatmap observations and 650 m extrusion heights are fabricated samples. B is an offset trace of A, not a second service route. The time slider reveals real contours in 10 minute steps. Measure uses the fixture's geodesic line length.

`node app/lab/check.mjs` uses the already installed global Playwright in headless mode, blocks external requests and checks the fixture, renderer state, camera sync, linked cursor, arrival, contours, sample layers, globe preset, style reconstruction and mobile width. It saves screenshots and a check receipt to `~/Desktop/screenshots/`. Set `PLAYWRIGHT_MODULE` to an importable module URL or `LAB_SCREENSHOTS` to override the output folder.

Quantico is bundled under the SIL Open Font License in `QUANTICO-LICENSE.txt`. No dependency was added.

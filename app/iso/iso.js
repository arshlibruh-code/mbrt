// One frozen 30 min drive from Koramangala, drawn four ways side by side. Every panel runs on the same clock
// (5 drive minutes per second), so the terrain rises, the ping travels, the colour spreads and the cars move
// in step: one physical logic, four looks. Dev only, for choosing; nothing here ships in the app.
import * as maplibregl from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "maplibre-gl/dist/maplibre-gl.css";
import { bbox, union, featureCollection, lineString, destination, lineIntersect, polygonToLine, distance, point } from "@turf/turf";
import fixture from "./fixture.json";

maplibregl.setWorkerUrl(workerUrl);
const $ = (id) => document.getElementById(id);
const STYLE = "https://tiles.openfreemap.org/styles/dark";
const { step: STEP, max: MAX, bands, routes, place } = fixture;
const SPEED = 5; // drive minutes per real second
const HOLD = 10; // minutes the full reach rests before the ping goes again
const LIFT = 60; // terrain metres per minute of time left
const FONT = ["Noto Sans Regular"];

// one ramp for every look: near is bright, the 30 min edge is deep
const RAMP = (v) => ["interpolate", ["linear"], v, 0, "#F1F2F3", 7.5, "#7fd3ff", 17.5, "#089bdf", 30, "#0f3a5f"];
const clamp01 = (x) => ["min", 1, ["max", 0, x]];
const easeOut = (p) => ["-", 1, ["^", ["-", 1, p], 3]];

const contour = (m) => union(featureCollection(bands.features.filter((f) => f.properties.minutes <= m)));
const edges = featureCollection([10, 20, 30].map((m) => ({ ...contour(m), properties: { label: m === MAX ? `${m} min` : `${m}` } })));
// the edges are too jagged for text along a line, so each number sits where a ray due west of the center
// leaves its contour
const ray = lineString([place.center, destination(place.center, 40, -90).geometry.coordinates]);
const marks = featureCollection(edges.features.map((e) => {
  const hits = lineIntersect(ray, polygonToLine(e)).features;
  const far = hits.reduce((a, b) => (distance(place.center, b) > distance(place.center, a) ? b : a), hits[0]);
  return point(far.geometry.coordinates, e.properties);
}));
const centerPt = { type: "Feature", geometry: { type: "Point", coordinates: place.center }, properties: { label: place.name.toUpperCase() } };
const routeLines = featureCollection(routes.map((r) => lineString(r.coords)));

$("facts").textContent = `${place.name.toUpperCase()} · 30 MIN DRIVE · ${bands.features.length} BANDS, ${STEP} MIN APART · ${fixture.areaKm2} KM² · ${routes.length} ROUTES · VALHALLA, FROZEN ${fixture.generatedAt.slice(0, 10)}`;

const LOOKS = [
  {
    name: "TIME AS TERRAIN",
    note: `Height is time left: Koramangala is the summit, each step down is ${STEP} more minutes, ${(MAX * LIFT / 1000).toFixed(1)} km of lift in all.`,
    pitch: 58,
    bearing: -20,
    layers: (m) => {
      m.addLayer({ id: "terrain", type: "fill-extrusion", source: "bands", paint: { "fill-extrusion-color": RAMP(["get", "from"]), "fill-extrusion-opacity": 0.9, "fill-extrusion-height": 0 } });
    },
    // each band rises as the clock reaches it, then holds
    reveal: (m, r) => m.setPaintProperty("terrain", "fill-extrusion-height", ["*", LIFT, ["-", MAX, ["get", "from"]], easeOut(clamp01(["/", ["-", r, ["get", "from"]], STEP * 1.6]))]),
  },
  {
    name: "SONAR PING",
    note: "A front leaves the center and lights each band as the clock reaches it, then fades: the brightest ring is where you are at that minute.",
    layers: (m) => {
      m.addLayer({ id: "ping-fill", type: "fill", source: "bands", paint: { "fill-color": RAMP(["get", "from"]), "fill-opacity": 0.03 } });
      m.addLayer({ id: "ping-line", type: "line", source: "bands", paint: { "line-color": "#7fd3ff", "line-opacity": 0.1, "line-width": 0.6 } });
    },
    loop: (m, f) => {
      const since = ["-", f, ["get", "from"]]; // minutes since the front reached this band
      const glow = ["^", ["e"], ["/", ["-", 0, since], 3.5]];
      m.setPaintProperty("ping-fill", "fill-opacity", ["case", ["<", since, 0], 0.03, ["+", 0.04, ["*", 0.55, glow]]]);
      m.setPaintProperty("ping-line", "line-opacity", ["case", ["<", since, 0], 0.1, ["+", 0.12, ["*", 0.88, glow]]]);
      m.setPaintProperty("ping-line", "line-width", ["case", ["<", since, 0], 0.6, ["+", 0.6, ["*", 2, glow]]]);
    },
  },
  {
    name: "TIME GRADIENT",
    note: "Colour is minutes: white is a short hop, deep blue is the 30 min edge. Three contours carry their numbers.",
    layers: (m) => {
      m.addLayer({ id: "grad", type: "fill", source: "bands", paint: { "fill-color": RAMP(["get", "from"]), "fill-opacity": 0 } });
      m.addLayer({ id: "edge-line", type: "line", source: "edges", paint: { "line-color": "#F1F2F3", "line-opacity": 0, "line-width": 0.8 } });
      m.addSource("marks", { type: "geojson", data: marks });
      m.addLayer({ id: "edge-label", type: "symbol", source: "marks", layout: { "text-field": ["get", "label"], "text-font": FONT, "text-size": 11, "text-anchor": "bottom", "text-offset": [0, -0.5], "text-letter-spacing": 0.08, "text-allow-overlap": true }, paint: { "text-color": "#F1F2F3", "text-halo-color": "#0b0e12", "text-halo-width": 1.4, "text-opacity": 0 } });
      m.addLayer({ id: "edge-tick", type: "circle", source: "marks", paint: { "circle-radius": 2.5, "circle-color": "#F1F2F3", "circle-opacity": 0 } });
    },
    reveal: (m, r) => {
      const p = clamp01(["/", ["-", r, ["get", "from"]], STEP]);
      m.setPaintProperty("grad", "fill-opacity", ["*", ["interpolate", ["linear"], ["get", "from"], 0, 0.62, 30, 0.3], p]);
      const done = r >= MAX ? 1 : 0;
      m.setPaintProperty("edge-line", "line-opacity", 0.55 * done);
      m.setPaintProperty("edge-label", "text-opacity", done);
      m.setPaintProperty("edge-tick", "circle-opacity", done);
    },
  },
  {
    name: "FLOW PARTICLES",
    note: `Cars leave Koramangala on ${routes.length} real Valhalla routes to the edge, at its road speeds: they bunch on the arterials and slow where the roads do.`,
    layers: (m) => {
      m.addSource("roads", { type: "geojson", data: routeLines });
      m.addLayer({ id: "roads", type: "line", source: "roads", paint: { "line-color": "#7fd3ff", "line-opacity": 0.1, "line-width": 1 } });
      m.addLayer({ id: "flow-edge", type: "line", source: "edges", filter: ["==", ["get", "label"], `${MAX} min`], paint: { "line-color": "#7fd3ff", "line-opacity": 0.3, "line-width": 0.8, "line-dasharray": [2, 3] } });
      m.addSource("cars", { type: "geojson", data: featureCollection([]) });
      m.addLayer({ id: "cars", type: "circle", source: "cars", paint: { "circle-radius": 2.2, "circle-color": RAMP(["get", "e"]), "circle-opacity": ["get", "a"], "circle-blur": 0.3 } });
    },
    tick: (m, t) => m.getSource("cars")?.setData(cars(t)),
  },
];

// where every car is at drive minute t: one leaves each route every EMIT minutes, phase-shifted per route by
// its index so the fleet is a steady stream, not a pulse
const EMIT = 2;
function cars(t) {
  const out = [];
  routes.forEach((r, i) => {
    const T = r.t.at(-1), off = ((i * 7) % 20) / 10;
    for (let k = Math.floor((t - T - off) / EMIT); k <= Math.floor((t - off) / EMIT); k++) {
      const e = t - off - k * EMIT;
      if (e < 0 || e > T || k < 0) continue;
      let lo = 0, hi = r.t.length - 1; // last vertex at or before e
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (r.t[mid] <= e) lo = mid; else hi = mid; }
      const span = r.t[hi] - r.t[lo], f = span ? (e - r.t[lo]) / span : 0;
      const [a, b] = [r.coords[lo], r.coords[hi]];
      out.push({ type: "Feature", geometry: { type: "Point", coordinates: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f] }, properties: { e, a: Math.min(1, (T - e) / 1.5) * 0.95 } });
    }
  });
  return { type: "FeatureCollection", features: out };
}

const bounds = bbox(bands);
const panels = LOOKS.map((look, i) => {
  const el = document.createElement("section");
  el.className = "panel";
  el.innerHTML = `<div class="map"></div><div class="tag"><b><i>${i + 1}</i>${look.name}</b><p>${look.note}</p></div>`;
  $("panels").append(el);
  const map = new maplibregl.Map({ container: el.querySelector(".map"), style: STYLE, bounds, fitBoundsOptions: { padding: 30 }, pitch: look.pitch ?? 0, bearing: look.bearing ?? 0, attributionControl: false, maxPitch: 75 });
  map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: "Valhalla (FOSSGIS) · © OpenStreetMap" }), "bottom-right");
  const panel = { map, look, ready: false };
  map.on("load", () => {
    map.addSource("bands", { type: "geojson", data: bands });
    map.addSource("edges", { type: "geojson", data: edges });
    look.layers(map);
    map.addSource("center", { type: "geojson", data: centerPt });
    map.addLayer({ id: "center", type: "circle", source: "center", paint: { "circle-radius": 4, "circle-color": "#F1F2F3", "circle-stroke-color": "#0b0e12", "circle-stroke-width": 1.5 } });
    map.addLayer({ id: "center-label", type: "symbol", source: "center", layout: { "text-field": ["get", "label"], "text-font": FONT, "text-size": 10, "text-offset": [0, 1.2], "text-anchor": "top", "text-letter-spacing": 0.12 }, paint: { "text-color": "#F1F2F3", "text-halo-color": "#0b0e12", "text-halo-width": 1.4 } });
    panel.ready = true;
  });
  return panel;
});

// cameras: drag any map and the others follow its center and zoom; each keeps its own tilt
let syncing = false;
for (const p of panels) {
  p.map.on("move", (e) => {
    if (syncing || !e.originalEvent) return;
    syncing = true;
    for (const q of panels) if (q !== p) q.map.jumpTo({ center: p.map.getCenter(), zoom: p.map.getZoom() });
    syncing = false;
  });
}

// the clock: t is drive minutes since replay; reveal runs once, the ping loops every MAX + HOLD minutes
let t = 0, playing = true, last = performance.now(), shown = -1;
function frame(now) {
  if (playing) t += ((now - last) / 1000) * SPEED;
  last = now;
  const r = Math.min(t, MAX + STEP * 2), ping = t % (MAX + HOLD);
  for (const p of panels) {
    if (!p.ready) continue;
    if (p.look.reveal && (r !== shown || p.fresh !== false)) p.look.reveal(p.map, r);
    p.look.loop?.(p.map, ping);
    p.look.tick?.(p.map, t);
    p.fresh = false;
  }
  shown = r;
  $("clock").textContent = `T+ ${(ping <= MAX ? ping : MAX).toFixed(1).padStart(4, " ")} MIN`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

const replay = () => { t = 0; shown = -1; };
const pause = () => { playing = !playing; $("pause").textContent = playing ? "PAUSE" : "PLAY"; };
$("replay").addEventListener("click", replay);
$("pause").addEventListener("click", pause);
addEventListener("keydown", (e) => {
  if (e.target.closest("input, textarea")) return;
  if (e.key === " ") e.preventDefault(), pause();
  if (e.key === "r") replay();
});

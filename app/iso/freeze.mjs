// Freeze one real isochrone so the comparison page never waits on a public server:
// Photon finds Koramangala, Valhalla draws 12 contours (2.5 min apart, 4 per request), then drives from the
// center to 40 points on the 30 min edge for the flow look (same engine, so the cars keep time with the bands).
// Run once: node app/iso/freeze.mjs
import * as turf from "@turf/turf";
import { writeFile } from "node:fs/promises";

// Valhalla's encoded polyline, 6 decimals
function decode(str) {
  const out = [];
  let i = 0, lat = 0, lon = 0;
  const next = () => {
    let r = 0, shift = 0, b;
    do { b = str.charCodeAt(i++) - 63; r |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    return r & 1 ? ~(r >> 1) : r >> 1;
  };
  while (i < str.length) { lat += next(); lon += next(); out.push([lon / 1e6, lat / 1e6]); }
  return out;
}

const OUT = new URL("./fixture.json", import.meta.url);
const UA = { "user-agent": "mbrt-iso-compare/1.0 (github.com/arshlibruh-code/mbrt)" };
let last = 0;
async function get(url, body) {
  await new Promise((r) => setTimeout(r, Math.max(0, last + 1100 - Date.now()))); // FOSSGIS: 1 per second
  last = Date.now();
  const res = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: { ...UA, ...(body ? { "content-type": "application/json" } : {}) },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

const place = (await get("https://photon.komoot.io/api/?q=Koramangala%20Bengaluru&limit=1")).features[0];
const center = place.geometry.coordinates;
console.log("center", place.properties.name, center);

const STEP = 2.5, MAX = 30;
const minutes = Array.from({ length: MAX / STEP }, (_, i) => (i + 1) * STEP);
const contours = [];
for (let i = 0; i < minutes.length; i += 4) {
  const body = await get("https://valhalla1.openstreetmap.de/isochrone", {
    locations: [{ lon: center[0], lat: center[1] }],
    costing: "auto",
    contours: minutes.slice(i, i + 4).map((time) => ({ time })),
    polygons: true,
  });
  contours.push(...body.features.map((f) => ({ ...f, properties: { minutes: f.properties.contour } })));
  console.log("valhalla", minutes.slice(i, i + 4).join(", "));
}
contours.sort((a, b) => a.properties.minutes - b.properties.minutes);

// bands: each contour minus the one inside it, so a band is only the ground first reached in that step
const bands = contours.map((c, i) => {
  const ring = i === 0 ? c : turf.difference(turf.featureCollection([c, contours[i - 1]]));
  return { type: "Feature", geometry: ring?.geometry ?? c.geometry, properties: { minutes: c.properties.minutes, from: i ? contours[i - 1].properties.minutes : 0 } };
});

// the outer edge, sampled evenly, as destinations for real drives
const outer = contours.at(-1);
const biggest = outer.geometry.type === "Polygon" ? outer.geometry.coordinates : outer.geometry.coordinates.reduce((a, b) => (turf.area(turf.polygon(b)) > turf.area(turf.polygon(a)) ? b : a));
const edge = turf.lineString(biggest[0]);
const len = turf.length(edge);
const N = 40;
const routes = [];
for (let i = 0; i < N; i++) {
  const to = turf.along(edge, (len * i) / N).geometry.coordinates;
  try {
    const r = await get("https://valhalla1.openstreetmap.de/route", {
      locations: [{ lon: center[0], lat: center[1] }, { lon: to[0], lat: to[1] }],
      costing: "auto",
    });
    const coords = decode(r.trip.legs[0].shape);
    // Valhalla times each maneuver; inside one, time is spread by distance
    const t = new Array(coords.length).fill(0);
    for (const m of r.trip.legs[0].maneuvers) {
      const a = m.begin_shape_index, b = m.end_shape_index;
      const d = [0];
      for (let k = a + 1; k <= b; k++) d.push(d.at(-1) + turf.distance(coords[k - 1], coords[k]));
      for (let k = a + 1; k <= b; k++) t[k] = t[a] + (m.time / 60) * (d.at(-1) ? d[k - a] / d.at(-1) : 1);
    }
    routes.push({ coords: coords.map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)]), t: t.map((v) => +v.toFixed(2)) });
    console.log("route", i + 1, "/", N, t.at(-1).toFixed(1), "min");
  } catch (e) {
    console.log("route", i + 1, "skipped:", e.message);
  }
}

const area = turf.area(outer) / 1e6;
await writeFile(OUT, JSON.stringify({
  generatedAt: new Date().toISOString(),
  sources: "Photon, Valhalla (FOSSGIS); © OpenStreetMap",
  place: { name: place.properties.name, center },
  step: STEP,
  max: MAX,
  areaKm2: +area.toFixed(1),
  bands: { type: "FeatureCollection", features: bands },
  routes,
}) + "\n");
console.log("wrote", OUT.pathname, bands.length, "bands,", routes.length, "routes,", area.toFixed(1), "km²");

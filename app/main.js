import * as maplibregl from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "maplibre-gl/dist/maplibre-gl.css";
import { bbox } from "@turf/turf";
import Ajv from "ajv";
import { TOOLS } from "../eval/tools.js";
import golden from "../eval/golden.json";
import { execute } from "./execute.js";

maplibregl.setWorkerUrl(workerUrl);

const GLYPHS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";
const STYLES = {
  dark: "https://tiles.openfreemap.org/styles/dark",
  street: "https://tiles.openfreemap.org/styles/liberty",
  satellite: {
    version: 8,
    glyphs: GLYPHS,
    sources: {
      sat: {
        type: "raster",
        tileSize: 256,
        tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
        attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
      },
    },
    layers: [{ id: "sat", type: "raster", source: "sat" }],
  },
};
const DEM = {
  type: "raster-dem",
  tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
  encoding: "terrarium",
  tileSize: 256,
  maxzoom: 15,
  attribution: "Terrain: Mapzen/Tilezen",
};

const $ = (id) => document.getElementById(id);
const map = new maplibregl.Map({
  container: "map",
  style: STYLES.dark,
  center: [78.9, 22.5],
  zoom: 4,
  attributionControl: false,
});
// top-left, because the chat bar covers the bottom edge
map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: "Search: Photon by komoot · Routing: Valhalla by FOSSGIS · Boundaries: Nominatim" }), "top-left");
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");

// ---- drawn features: one GeoJSON source, styled by `kind`

let drawn = [], nextFid = 1, selectedFid = 0, terrainOn = false;
const AREAS = ["buffer", "isochrone", "polygon", "boundary"];
const LINES = ["route", "line"];

function addLayers() {
  map.addSource("drawn", { type: "geojson", data: { type: "FeatureCollection", features: drawn } });
  const isKind = (kinds) => ["in", ["get", "kind"], ["literal", kinds]];
  const sel = ["==", ["get", "fid"], ["literal", selectedFid]];
  map.addLayer({ id: "area-fill", type: "fill", source: "drawn", filter: isKind(AREAS),
    paint: { "fill-color": "#BEC2C7", "fill-opacity": ["match", ["get", "kind"], "isochrone", 0.14, "boundary", 0.06, 0.1] } });
  map.addLayer({ id: "area-edge", type: "line", source: "drawn", filter: isKind(AREAS),
    paint: { "line-color": "#E1E2E4", "line-width": 1.2, "line-opacity": 0.8 } });
  map.addLayer({ id: "line-casing", type: "line", source: "drawn", filter: isKind(LINES),
    layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#121518", "line-width": 6, "line-opacity": 0.7 } });
  map.addLayer({ id: "lines", type: "line", source: "drawn", filter: isKind(["route"]),
    layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#F1F2F3", "line-width": 3 } });
  map.addLayer({ id: "straight", type: "line", source: "drawn", filter: isKind(["line"]),
    paint: { "line-color": "#F1F2F3", "line-width": 2.5, "line-dasharray": [2, 1.5] } });
  map.addLayer({ id: "selected-line", type: "line", source: "drawn", filter: ["all", ["!=", ["geometry-type"], "Point"], sel],
    paint: { "line-color": "#26A0D6", "line-width": 4 } });
  map.addLayer({ id: "points", type: "circle", source: "drawn", filter: ["==", ["geometry-type"], "Point"],
    paint: { "circle-radius": 5, "circle-color": "#F1F2F3", "circle-stroke-color": "#121518", "circle-stroke-width": 2 } });
  map.addLayer({ id: "selected-point", type: "circle", source: "drawn", filter: ["all", ["==", ["geometry-type"], "Point"], sel],
    paint: { "circle-radius": 8, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#26A0D6", "circle-stroke-width": 2.5 } });
  const text = { "text-field": ["get", "label"], "text-font": ["Noto Sans Regular"], "text-size": 12 };
  const halo = { "text-color": "#E1E2E4", "text-halo-color": "#121518", "text-halo-width": 1.5 };
  map.addLayer({ id: "point-labels", type: "symbol", source: "drawn", filter: ["==", ["geometry-type"], "Point"],
    layout: { ...text, "text-offset": [0, -0.9], "text-anchor": "bottom" }, paint: halo });
  map.addLayer({ id: "line-labels", type: "symbol", source: "drawn", filter: isKind(LINES),
    layout: { ...text, "symbol-placement": "line-center" }, paint: halo });
  if (terrainOn) setTerrain(true);
}
map.on("style.load", addLayers);

const refresh = () => {
  map.getSource("drawn")?.setData({ type: "FeatureCollection", features: drawn });
  for (const id of ["selected-line", "selected-point"]) {
    if (!map.getLayer(id)) continue;
    const geom = id === "selected-point" ? ["==", ["geometry-type"], "Point"] : ["!=", ["geometry-type"], "Point"];
    map.setFilter(id, ["all", geom, ["==", ["get", "fid"], ["literal", selectedFid]]]);
  }
};

function setTerrain(on) {
  terrainOn = on;
  if (on) {
    if (!map.getSource("dem")) map.addSource("dem", DEM);
    map.setTerrain({ source: "dem", exaggeration: 1.5 });
    if (map.getPitch() < 30) map.easeTo({ pitch: 60, duration: 900 });
  } else {
    map.setTerrain(null);
    map.easeTo({ pitch: 0, duration: 900 });
  }
}

const CLEAR = { markers: ["marker"], routes: ["route"], lines: ["line"], buffers: ["buffer"], isochrones: ["isochrone"], polygons: ["polygon", "boundary"] };

async function mapAction(a) {
  switch (a.action) {
    case "style":
      if (!a.style) throw new Error("map style: pick street, satellite or dark");
      map.setStyle(STYLES[a.style], { diff: false });
      log("ok", "map", `style ${a.style}`);
      return [];
    case "zoom":
      if (a.zoom == null) throw new Error("map zoom: give a level");
      map.easeTo({ zoom: a.zoom, duration: 800 });
      log("ok", "map", `zoom ${a.zoom}`);
      return [];
    case "center":
      if (a.lat == null || a.lon == null) throw new Error("map center: give lat and lon");
      map.flyTo({ center: [a.lon, a.lat], zoom: Math.max(map.getZoom(), 10) });
      log("ok", "map", `center ${a.lat}, ${a.lon}`);
      return [];
    case "terrain":
      setTerrain(!terrainOn);
      log("ok", "map", `3D terrain ${terrainOn ? "on" : "off"}`);
      return [];
    case "clear": {
      const kinds = !a.clear || a.clear === "all" ? null : CLEAR[a.clear];
      const before = drawn.length;
      drawn = kinds ? drawn.filter((f) => !kinds.includes(f.properties.kind)) : [];
      log("ok", "map", `cleared ${before - drawn.length} features`);
      refresh();
      return [];
    }
    case "locate":
      return execute({ tool: "markers", args: { places: ["@me"] } }, baseCtx);
  }
}

// ---- selection: click a drawn feature, then use "@selected" in a field

map.on("click", (e) => {
  const hit = map.queryRenderedFeatures(e.point, { layers: ["points", "lines", "straight", "area-fill"] })[0];
  selectedFid = hit?.properties.fid ?? 0;
  refresh();
  if (hit) log("ok", "selected", `${hit.properties.kind}: ${hit.properties.label} (use @selected)`);
});
for (const id of ["points", "lines", "straight", "area-fill"]) {
  map.on("mouseenter", id, () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", id, () => (map.getCanvas().style.cursor = ""));
}

// ---- log and chart

function log(status, source, text) {
  const li = document.createElement("li");
  li.className = status;
  li.innerHTML = `<b></b><span></span>`;
  li.querySelector("b").textContent = source;
  li.querySelector("span").textContent = text;
  $("log").append(li);
}

function chart(profile) {
  const pts = profile.filter(([, h]) => h != null);
  const km = pts.at(-1)[0], hs = pts.map((p) => p[1]);
  const lo = Math.min(...hs), hi = Math.max(...hs);
  let gain = 0;
  for (let i = 1; i < hs.length; i++) gain += Math.max(0, hs[i] - hs[i - 1]);
  const W = 300, H = 90, x = (d) => (d / km) * W, y = (h) => H - 4 - ((h - lo) / (hi - lo || 1)) * (H - 8);
  const line = pts.map(([d, h]) => `${x(d).toFixed(1)},${y(h).toFixed(1)}`).join(" ");
  $("chart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><polygon points="0,${H} ${line} ${W},${H}" /><polyline points="${line}" /></svg>
    <dl><dt>length</dt><dd>${km.toFixed(1)} km</dd><dt>low</dt><dd>${lo} m</dd><dt>high</dt><dd>${hi} m</dd><dt>climb</dt><dd>${Math.round(gain)} m</dd></dl>`;
  $("chart").hidden = false;
}

const baseCtx = { log, chart, mapAction, selected: () => drawn.find((f) => f.properties.fid === selectedFid) };

// ---- the form is generated from the same tool schema the model will fill

const ajv = new Ajv({ strict: false, allErrors: true });
const validate = Object.fromEntries(TOOLS.map((t) => [t.name, ajv.compile(t.input_schema)]));
const EXAMPLE = { map: { action: "style", style: "satellite" } };
for (const g of golden) EXAMPLE[g.expect.tool] ??= g.expect.args;

const kindOf = (s) => (s.type === "array" ? `array:${s.items.type}` : s.enum ? "enum" : s.type);

function renderFields(values) {
  const t = TOOLS.find((t) => t.name === $("tool").value);
  $("desc").textContent = t.description;
  const ex = values ?? EXAMPLE[t.name] ?? {};
  $("fields").replaceChildren(...Object.entries(t.input_schema.properties).map(([key, s]) => {
    const req = t.input_schema.required.includes(key);
    const label = document.createElement("label");
    label.innerHTML = `<span>${key}${req ? "" : " <i>optional</i>"}</span>`;
    let input;
    const v = ex[key];
    switch (kindOf(s)) {
      case "array:string":
        input = document.createElement("textarea");
        input.rows = Math.max(2, (v?.length ?? 0) + 1);
        input.placeholder = "one place per line";
        input.value = v?.join("\n") ?? "";
        break;
      case "enum":
        input = document.createElement("select");
        input.innerHTML = (req ? "" : `<option value=""></option>`) + s.enum.map((o) => `<option>${o}</option>`).join("");
        input.value = v ?? (req ? s.enum[0] : "");
        break;
      default:
        input = document.createElement("input");
        if (s.type === "number") Object.assign(input, { type: "number", step: "any" });
        if (kindOf(s) === "array:number") input.placeholder = "10, 20, 30";
        input.value = Array.isArray(v) ? v.join(", ") : v ?? "";
    }
    input.name = key;
    label.append(input);
    return label;
  }));
}

function readArgs(t) {
  const args = {};
  for (const [key, s] of Object.entries(t.input_schema.properties)) {
    const raw = $("fields").elements[key].value.trim();
    if (raw === "") continue;
    const k = kindOf(s);
    args[key] = k === "array:string" ? raw.split("\n").map((x) => x.trim()).filter(Boolean)
      : k === "array:number" ? raw.split(/[,\s]+/).filter(Boolean).map(Number)
      : s.type === "number" ? Number(raw) : raw;
  }
  return args;
}

const resetOutput = () => {
  $("log").replaceChildren();
  $("chart").hidden = true;
  $("call").textContent = "";
};

function run(e) {
  e.preventDefault();
  const t = TOOLS.find((t) => t.name === $("tool").value);
  resetOutput();
  runCall({ tool: t.name, args: readArgs(t) });
}

// the model only names the call; the server holds the Groq key (app/api/chat.js).
// A new message cancels the one in flight, and anything the old one still produces is dropped.
let inflight = null;
const thinking = (on) => {
  $("msg").classList.toggle("thinking", on);
  $("msg").closest(".field").classList.toggle("thinking", on);
  $("msg").placeholder = on ? "Thinking..." : "Ask the map anything";
  if (!on) $("cancel-notice").classList.remove("visible");
};
$("msg").addEventListener("input", () => $("cancel-notice").classList.toggle("visible", !!inflight && $("msg").value !== ""));

async function ask(e) {
  e.preventDefault();
  const message = $("msg").value.trim();
  if (!message) return;
  inflight?.abort();
  const ctrl = (inflight = new AbortController());
  const stale = () => ctrl !== inflight;
  $("msg").value = "";
  $("cancel-notice").classList.remove("visible");
  thinking(true);
  resetOutput();
  log("ok", "you", message);
  try {
    const res = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message }), signal: ctrl.signal });
    const body = await res.json().catch(() => ({ error: `server ${res.status}` }));
    if (stale()) return;
    if (!res.ok) throw new Error(body.error);
    log("ok", "Groq", `${body.model} chose ${body.call.tool} in ${body.ms} ms`);
    $("tool").value = body.call.tool; // mirror into the form, so the call can be edited and rerun by hand
    renderFields(body.call.args);
    await runCall(body.call, stale);
  } catch (err) {
    if (!stale()) log("bad", "error", err.message);
  } finally {
    if (!stale()) {
      inflight = null;
      thinking(false);
    }
  }
}

async function runCall(call, stale = () => false) {
  const ctx = { ...baseCtx, log: (...a) => stale() || log(...a), chart: (p) => stale() || chart(p) };
  $("call").textContent = JSON.stringify(call);
  if (!validate[call.tool]?.(call.args)) {
    log("bad", "schema", validate[call.tool] ? ajv.errorsText(validate[call.tool].errors, { dataVar: "args" }) : `unknown tool ${call.tool}`);
    return;
  }
  $("run").disabled = true;
  const t0 = performance.now();
  try {
    const feats = await execute(call, ctx);
    if (stale()) return;
    for (const f of feats) f.properties.fid = nextFid++;
    drawn.push(...feats);
    refresh();
    if (feats.length) {
      const [w, s, e2, n] = bbox({ type: "FeatureCollection", features: feats });
      if (w === e2 && s === n) map.flyTo({ center: [w, s], zoom: Math.max(map.getZoom(), 12) });
      else map.fitBounds([w, s, e2, n], { padding: { top: 60, left: 60, right: 60, bottom: $("chat").offsetHeight + 40 }, maxZoom: 14 });
    }
    log("ok", "done", `${feats.length} features in ${Math.round(performance.now() - t0)} ms`);
  } catch (err) {
    log("bad", "error", err.message);
  } finally {
    $("run").disabled = false;
  }
}

$("tool").innerHTML = TOOLS.map((t) => `<option>${t.name}</option>`).join("");
$("tool").value = "isochrone";
$("tool").addEventListener("change", () => renderFields());
$("form").addEventListener("submit", run);
$("chat").addEventListener("submit", ask);
$("clear").addEventListener("click", () => {
  drawn = [];
  selectedFid = 0;
  refresh();
  resetOutput();
});
renderFields();

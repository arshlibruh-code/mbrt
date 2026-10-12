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
        maxzoom: 18, // past this many places have no imagery; stretching the last real tile beats placeholder tiles
        attribution: "© Esri, Vantor, Earthstar Geographics",
      },
      // borders and place names drawn over the imagery
      labels: {
        type: "raster",
        tileSize: 256,
        tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"],
        maxzoom: 18,
      },
    },
    layers: [{ id: "sat", type: "raster", source: "sat" }, { id: "sat-labels", type: "raster", source: "labels" }],
  },
  // the open option: Sentinel-2 at 10 m (sharp to about city level) with EOX's OpenStreetMap labels
  s2: {
    version: 8,
    glyphs: GLYPHS,
    sources: {
      s2: {
        type: "raster",
        tileSize: 256,
        maxzoom: 15,
        tiles: ["https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg"],
        attribution: '<a href="https://cloudless.eox.at" target="_blank" rel="noopener">EOxCloudless</a> by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2024)',
      },
      overlay: {
        type: "raster",
        tileSize: 256,
        maxzoom: 14,
        tiles: ["https://tiles.maps.eox.at/wmts/1.0.0/overlay_bright_3857/default/g/{z}/{y}/{x}.png"],
        attribution: "labels © EOX",
      },
    },
    layers: [{ id: "s2", type: "raster", source: "s2" }, { id: "s2-labels", type: "raster", source: "overlay" }],
  },
};
// atmosphere, from the portfolio globe: a halo that fades out as you zoom in
const SKY = {
  "sky-color": "#88C6FC", "sky-horizon-blend": 0.8, "horizon-color": "#ffffff", "horizon-fog-blend": 0.8,
  "fog-color": "#88C6FC", "fog-ground-blend": 0.5, "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 1, 1, 12, 0],
};
const SKY_DARK = { ...SKY, "sky-color": "#0d1b2a", "horizon-color": "#3a5068", "fog-color": "#0d1b2a" };
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
  style: STYLES.satellite,
  center: [78.9, 20],
  zoom: 2.2,
  attributionControl: false,
});
// credits as one line of small text above the bar; the basemap's own credit is added by MapLibre per style
map.addControl(new maplibregl.AttributionControl({ compact: false, customAttribution: '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a> · Photon · FOSSGIS · Nominatim' }), "bottom-right");
new ResizeObserver(() => {
  document.documentElement.style.setProperty("--bar-h", `${$("chat").offsetHeight}px`);
  map.setPadding({ top: 0, left: 0, right: 0, bottom: $("chat").offsetHeight }); // center the globe in the space above the bar
}).observe($("chat"));

// ---- tools overlay

const setTools = (open) => {
  document.body.classList.toggle("tools-open", open);
  $("tools-toggle").setAttribute("aria-pressed", open);
};
$("tools-toggle").addEventListener("click", () => setTools(!document.body.classList.contains("tools-open")));
const syncFeed = () => document.body.classList.toggle("has-feed", $("log").children.length > 0);

// ---- tab: title says what is happening, the orb favicon brightens while thinking

const orb = (core, glow) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><radialGradient id="g"><stop offset="0" stop-color="${core}"/><stop offset=".5" stop-color="#089bdf" stop-opacity="${glow}"/><stop offset="1" stop-color="#089bdf" stop-opacity="0"/></radialGradient></defs><rect width="32" height="32" fill="#0b0d10"/><circle cx="16" cy="16" r="15" fill="url(#g)"/></svg>`)}`;
const ORB_DIM = orb("#4fb8ea", 0.55), ORB_BRIGHT = orb("#c9ecff", 0.95);
$("favicon").href = ORB_DIM;
let pulse = null;
function tabState(state, text = "") {
  clearInterval(pulse);
  $("favicon").href = ORB_DIM;
  if (state === "thinking") {
    document.title = "Thinking… · mbrt";
    let on = false;
    pulse = setInterval(() => ($("favicon").href = (on = !on) ? ORB_BRIGHT : ORB_DIM), 600);
  } else document.title = text ? `${state === "error" ? "! " : ""}${text} · mbrt` : "mbrt · chat to a map";
}
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");

// one button that cycles the basemap; it shows the current one
const BASEMAPS = ["satellite", "s2", "dark", "street"], SHORT = { satellite: "SAT", s2: "S2", dark: "DARK", street: "MAP" };
const nextBasemap = (name) => BASEMAPS[(BASEMAPS.indexOf(name) + 1) % BASEMAPS.length];
let basemap = "satellite";
function setBasemap(name) {
  basemap = name;
  map.setStyle(STYLES[name], { diff: false });
  const b = document.querySelector(".basemap-btn");
  if (b) (b.textContent = SHORT[name]), (b.title = `basemap: ${name}, click for ${nextBasemap(name)}`);
}
map.addControl({
  onAdd() {
    const div = document.createElement("div");
    div.className = "maplibregl-ctrl maplibregl-ctrl-group";
    div.innerHTML = `<button type="button" class="basemap-btn" title="basemap: satellite, click for s2">SAT</button>`;
    div.firstChild.addEventListener("click", () => setBasemap(nextBasemap(basemap)));
    return div;
  },
  onRemove() {},
}, "top-right");
map.addControl(new maplibregl.ScaleControl({ unit: "metric", maxWidth: 110 }), "bottom-left");
const syncScale = () => document.body.classList.toggle("globe-view", map.getZoom() < 5);
map.on("zoom", syncScale);
syncScale();

// ---- idle spin: on load and after 20 s untouched the globe turns east; any touch or typing stops it.
// Speed is in degrees per second (same on any refresh rate) and eases in; it only turns the zoomed-out globe.
const SPIN_DEG_S = 3, IDLE_MS = 20000;
let spinning = false, spinSpeed = 0, lastFrame = 0, idleTimer = 0;
function spinFrame(t) {
  if (!spinning) return;
  const dt = lastFrame ? Math.min((t - lastFrame) / 1000, 0.1) : 0;
  lastFrame = t;
  spinSpeed += (SPIN_DEG_S - spinSpeed) * Math.min(1, dt * 0.8);
  if (map.getZoom() < 5 && !map.isMoving()) {
    const c = map.getCenter();
    map.setCenter([c.lng + spinSpeed * dt, c.lat]);
  }
  requestAnimationFrame(spinFrame);
}
function startSpin() {
  if (spinning) return;
  spinning = true;
  spinSpeed = 0;
  lastFrame = 0;
  requestAnimationFrame(spinFrame);
}
function stopSpin() {
  spinning = false;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(startSpin, IDLE_MS);
}
for (const ev of ["mousedown", "touchstart", "wheel", "dragstart"]) map.on(ev, stopSpin);
map.once("load", startSpin);

// the compass only matters once the map is turned or tilted
const syncCompass = () => document.body.classList.toggle("turned", Math.abs(map.getBearing()) > 0.5 || map.getPitch() > 0.5);
map.on("rotate", syncCompass);
map.on("pitch", syncCompass);

// ---- drawn features: one GeoJSON source, styled by `kind`

let drawn = [], nextFid = 1, selectedFid = 0, terrainOn = false;
const AREAS = ["buffer", "isochrone", "polygon", "boundary"];
const LINES = ["route", "line"];

function addLayers() {
  map.setProjection({ type: "globe" }); // a sphere when zoomed out; MapLibre flattens it as you zoom in
  map.setSky(basemap === "dark" ? SKY_DARK : SKY);
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
      setBasemap(a.style);
      result(`${a.style} map`);
      return [];
    case "zoom":
      if (a.zoom == null) throw new Error("map zoom: give a level");
      map.easeTo({ zoom: a.zoom, duration: 800 });
      result(`zoom ${a.zoom}`);
      return [];
    case "center":
      if (a.lat == null || a.lon == null) throw new Error("map center: give lat and lon");
      map.flyTo({ center: [a.lon, a.lat], zoom: Math.max(map.getZoom(), 10) });
      result(`centered on ${a.lat}, ${a.lon}`);
      return [];
    case "terrain":
      setTerrain(!terrainOn);
      result(`3D terrain ${terrainOn ? "on" : "off"}`);
      return [];
    case "clear": {
      const kinds = !a.clear || a.clear === "all" ? null : CLEAR[a.clear];
      const before = drawn.length;
      drawn = kinds ? drawn.filter((f) => !kinds.includes(f.properties.kind)) : [];
      result(`cleared ${before - drawn.length} features`);
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
  if (hit) log("ok", "selected", `${hit.properties.kind}: ${hit.properties.label} (use @selected)`), settleSoon();
});
for (const id of ["points", "lines", "straight", "area-fill"]) {
  map.on("mouseenter", id, () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", id, () => (map.getCanvas().style.cursor = ""));
}

// ---- the feed: your message, the pick in plain words, the steps, one result line

function line(cls, label, text, raw) {
  const li = document.createElement("li");
  li.className = cls;
  const b = document.createElement("b"), span = document.createElement("span");
  b.textContent = label;
  span.textContent = text;
  if (raw && raw !== text) {
    const small = document.createElement("small");
    small.textContent = raw;
    span.append(small);
  }
  li.append(b, span);
  $("log").append(li);
  span.scrollIntoView({ block: "nearest" });
  syncFeed();
  return li;
}
const log = (status, source, text, raw) => line(`step ${status}`, source, text, raw);
const headline = (text) => line("head", "", text);
function result(text, status = "ok") {
  line(`result ${status}`, "", text);
  settleSoon();
}

const nice = (p) => (p === "@me" ? "your location" : p === "@selected" ? "the selected feature" : p);
const trip = (xs) => xs.map(nice).join(" → ");
function describe({ tool, args: a }) {
  try {
    switch (tool) {
      case "markers": return `markers · ${a.places.map(nice).join(", ")}`;
      case "route": return `route · ${a.profile} · ${trip(a.waypoints)}`;
      case "line": return `straight line · ${trip(a.places)}`;
      case "buffer": return `buffer · ${a.radius_km.join(" / ")} km · ${a.centers.map(nice).join(", ")}`;
      case "isochrone": return `isochrone · ${a.values.join(" / ")} ${a.unit === "km" ? "km" : "min"} ${a.profile} · ${nice(a.center)}`;
      case "polygon": return `polygon · ${a.vertices.map(nice).join(", ")}`;
      case "elevation_profile": return `elevation · ${trip(a.waypoints)}`;
      case "boundary": return `boundary · ${a.place}`;
      case "map": return `map · ${[a.action, a.style, a.zoom, a.clear, a.lat != null ? `${a.lat}, ${a.lon}` : null].filter((x) => x != null).join(" ")}`;
      case "reply": return `reply · ${a.kind}`;
    }
  } catch {}
  return tool;
}
// the pick in words; clicking it unfolds the exact JSON
function pick(source, call, ms) {
  const li = line("pick", source, `${describe(call)}${ms ? `   ${ms} ms` : ""}`);
  const json = line("json", "", JSON.stringify(call));
  li.addEventListener("click", () => json.classList.toggle("open"));
}

// once a run ends, the steps fade after 8 s and your message plus the result stay; hover brings them back
let settleTimer = 0;
function settleSoon() {
  clearTimeout(settleTimer);
  document.body.classList.remove("settled");
  settleTimer = setTimeout(() => document.body.classList.add("settled"), 8000);
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

const baseCtx = { log, chart, result, mapAction, selected: () => drawn.find((f) => f.properties.fid === selectedFid) };

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
  clearTimeout(settleTimer);
  document.body.classList.remove("settled");
  $("log").replaceChildren();
  $("chart").hidden = true;
  syncFeed();
};

function run(e) {
  e.preventDefault();
  const t = TOOLS.find((t) => t.name === $("tool").value);
  resetOutput();
  setTools(false); // the overlay sits on the map
  const call = { tool: t.name, args: readArgs(t) };
  pick("form", call);
  runCall(call);
}

// the model only names the call; the server holds the Groq key (app/api/chat.js).
// A new message cancels the one in flight, and anything the old one still produces is dropped.
let inflight = null;
const thinking = (on) => {
  if (on) tabState("thinking");
  $("msg").classList.toggle("thinking", on);
  $("msg").closest(".field").classList.toggle("thinking", on);
  $("msg").placeholder = on ? "Thinking..." : "Ask the map anything";
  if (!on) $("cancel-notice").classList.remove("visible");
};
$("msg").addEventListener("input", () => $("cancel-notice").classList.toggle("visible", !!inflight && $("msg").value !== ""));
$("msg").addEventListener("focus", stopSpin);

async function ask(e) {
  e.preventDefault();
  const message = $("msg").value.trim();
  if (!message) return;
  inflight?.abort();
  const ctrl = (inflight = new AbortController());
  const stale = () => ctrl !== inflight;
  let failed = false;
  $("msg").value = "";
  $("cancel-notice").classList.remove("visible");
  thinking(true);
  resetOutput();
  headline(message);
  try {
    const res = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message }), signal: ctrl.signal });
    const body = await res.json().catch(() => ({ error: `server ${res.status}` }));
    if (stale()) return;
    if (!res.ok) throw new Error(body.error);
    pick("Groq", body.call, body.ms);
    $("tool").value = body.call.tool; // mirror into the form, so the call can be edited and rerun by hand
    renderFields(body.call.args);
    failed = !(await runCall(body.call, stale));
  } catch (err) {
    if (!stale()) log("bad", "error", err.message), settleSoon(), (failed = true);
  } finally {
    if (!stale()) {
      inflight = null;
      thinking(false);
      tabState(failed ? "error" : "done", message);
    }
  }
}

async function runCall(call, stale = () => false) {
  const ctx = { ...baseCtx, log: (...a) => stale() || log(...a), chart: (p) => stale() || chart(p), result: (...a) => stale() || result(...a) };
  if (!validate[call.tool]?.(call.args)) {
    ctx.log("bad", "schema", "The model's call does not fit the tool", validate[call.tool] ? ajv.errorsText(validate[call.tool].errors, { dataVar: "args" }) : `unknown tool ${call.tool}`);
    settleSoon();
    return false;
  }
  $("run").disabled = true;
  stopSpin();
  try {
    const feats = await execute(call, ctx);
    if (stale()) return false;
    for (const f of feats) f.properties.fid = nextFid++;
    drawn.push(...feats);
    refresh();
    if (feats.length) {
      const [w, s, e2, n] = bbox({ type: "FeatureCollection", features: feats });
      const flight = { curve: 1.6, speed: 1.1, maxDuration: 6000 }; // a far jump pulls out to the globe and arcs across
      if (w === e2 && s === n) map.flyTo({ center: [w, s], zoom: Math.max(map.getZoom(), 12), ...flight });
      else map.fitBounds([w, s, e2, n], { padding: 60, maxZoom: 14, ...flight });
    }
    return true;
  } catch (err) {
    ctx.log("bad", "error", err.message, err.raw);
    settleSoon();
    return false;
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

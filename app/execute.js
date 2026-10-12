// Turn one {tool, args} call into geometry. Every place name goes through the geocoder; nothing here
// trusts coordinates from a model. Each step reports to `log`, so failures show up instead of vanishing.
import * as turf from "@turf/turf";

const PHOTON = "https://photon.komoot.io/api/";
const VALHALLA = "https://valhalla1.openstreetmap.de"; // isochrones and heights
const OSRM = "https://routing.openstreetmap.de"; // routes: no length cap, unlike Valhalla's 1,500 km
const OSRM_PROFILE = { driving: "car", walking: "foot", cycling: "bike" };
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const COSTING = { driving: "auto", walking: "pedestrian", cycling: "bicycle" };

// FOSSGIS Valhalla and Nominatim allow 1 request per second; Photon asks to be fair
const gaps = { [VALHALLA]: 1100, [OSRM]: 1100, [NOMINATIM]: 1100, [PHOTON]: 300 };

// what a person should read first; the server's own words travel along as `raw`
const HUMAN = [
  [/max distance/i, "Too far for this service", "route"],
  [/NoRoute|Unable to find a route|No path could be found/i, "No road connects these places", "route"],
  [/No suitable edges|Cannot find a path|NoSegment/i, "No road near this place", "route"],
  [/\b429\b|Too Many Requests/i, "Rate limited, wait a moment and retry", "network"],
  [/TimeoutError|aborted|Failed to fetch|NetworkError/i, "The service did not answer", "network"],
  [/ 50[0234]\b/, "The service is having trouble, try again in a moment", "network"],
];
export function humanError(raw) {
  const hit = HUMAN.find(([re]) => re.test(raw));
  const err = new Error(hit?.[1] ?? raw);
  err.raw = raw;
  err.kind = hit?.[2] ?? "route";
  return err;
}
const lastCall = {};
async function politeFetch(base, url, init) {
  const wait = (lastCall[base] ?? 0) + gaps[base] - Date.now();
  lastCall[base] = Date.now() + Math.max(wait, 0);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  let res;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(30000) });
  } catch (e) {
    throw humanError(`${new URL(base).host}: ${e.name} ${e.message}`);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || (base === OSRM && body?.code !== "Ok"))
    throw humanError(`${new URL(base).host} ${res.status} ${body?.error ?? body?.message ?? body?.code ?? ""}`.trim());
  return body;
}
const valhalla = (path, body) =>
  politeFetch(VALHALLA, `${VALHALLA}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

function cached(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function store(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

// set once the user shares their location, so the model can be told "@me" works
export let knownMe = null;

// the place under the map's center, for the model's context; cached on a ~5 km grid
export async function placeNear([lon, lat]) {
  const key = `near:${lat.toFixed(2)},${lon.toFixed(2)}`;
  let hit = cached(key);
  if (!hit) {
    const body = await politeFetch(PHOTON, `https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}&limit=1`);
    const p = body?.features?.[0]?.properties;
    hit = p ? [p.name, p.city ?? p.county, p.state, p.country].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(", ") : "";
    store(key, hit);
  }
  return hit;
}

// name -> { coord: [lon, lat], label }
async function geocode(name, ctx) {
  if (name === "@me") {
    const pos = await new Promise((ok, fail) => navigator.geolocation.getCurrentPosition(ok, fail, { timeout: 15000 }))
      .catch((e) => { throw new Error(`location: ${e.message}`); });
    const coord = [pos.coords.longitude, pos.coords.latitude];
    knownMe = coord;
    ctx.log("ok", "location", `@me → ${fmt(coord)}`);
    return { coord, label: "you" };
  }
  if (name === "@selected") {
    const f = ctx.selected();
    if (!f) throw new Error("@selected: nothing is selected, click a feature on the map first");
    const coord = f.geometry.type === "Point" ? f.geometry.coordinates : turf.centroid(f).geometry.coordinates;
    return { coord, label: f.properties.label };
  }
  const hit = await lookup(name);
  if (!hit) throw Object.assign(new Error(`Photon: no match for "${name}"`), { kind: "nomatch", place: name });
  ctx.log("ok", "Photon", `${name} → ${hit.found} (${fmt(hit.coord)})`);
  return { coord: hit.coord, label: name.split(",")[0] };
}

// a place name -> { coord, found } or null, cached; the tools form uses it to check names as you type them
export async function lookup(name) {
  const key = `geo:${name.toLowerCase()}`;
  let hit = cached(key);
  if (!hit) {
    const body = await politeFetch(PHOTON, `${PHOTON}?q=${encodeURIComponent(name)}&limit=1`);
    const f = body?.features?.[0];
    if (!f) return null;
    const p = f.properties;
    hit = { coord: f.geometry.coordinates, found: [p.name, p.city ?? p.county, p.state, p.country].filter(Boolean).join(", ") };
    store(key, hit);
  }
  return hit;
}

const fmt = ([lon, lat]) => `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
const geocodeAll = async (names, ctx) => {
  const out = [];
  for (const n of names) out.push(await geocode(n, ctx)); // sequential: keeps Photon polite and the log ordered
  return out;
};

async function routeLine(names, profile, ctx) {
  const pts = await geocodeAll(names, ctx);
  const path = pts.map((p) => p.coord.join(",")).join(";");
  const p = OSRM_PROFILE[profile] ?? "car";
  const body = await politeFetch(OSRM, `${OSRM}/routed-${p}/route/v1/driving/${path}?overview=full&geometries=geojson`);
  const r = body.routes[0];
  const km = r.distance / 1000, min = r.duration / 60;
  ctx.log("ok", "OSRM", `${profile} route ${km.toFixed(1)} km, ${duration(min)}`);
  return { pts, line: turf.lineString(r.geometry.coordinates), km, min };
}

export function duration(min) {
  const m = Math.round(min), h = Math.floor(m / 60);
  return h === 0 ? `${m} min` : m % 60 === 0 ? `${h} h` : `${h} h ${m % 60} min`;
}
const km1 = (n) => n.toLocaleString("en-IN", { maximumFractionDigits: n < 100 ? 1 : 0 });

const feature = (geom, kind, label, extra = {}) => ({ ...geom, properties: { ...geom.properties, kind, label, ...extra } });

export async function execute(call, ctx) {
  const a = call.args;
  switch (call.tool) {
    case "markers": {
      const pts = await geocodeAll(a.places, ctx);
      ctx.result(pts.length === 1 ? pts[0].label : `${pts.length} places`);
      return pts.map((p, i) => feature(turf.point(p.coord), "marker", `${i + 1}. ${p.label}`));
    }
    case "route": {
      const r = await routeLine(a.waypoints, a.profile, ctx);
      ctx.result(`${km1(r.km)} km · ${duration(r.min)}`);
      return [
        feature(r.line, "route", `${km1(r.km)} km · ${duration(r.min)}`),
        ...r.pts.map((p, i) => feature(turf.point(p.coord), "marker", `${i + 1}. ${p.label}`)),
      ];
    }
    case "line": {
      const pts = await geocodeAll(a.places, ctx);
      const km = turf.length(turf.lineString(pts.map((p) => p.coord)));
      // great-circle arcs: the true shortest path, which curves on the globe
      const arcs = pts.slice(1).flatMap((p, i) => {
        const g = turf.greatCircle(pts[i].coord, p.coord, { npoints: 96 }).geometry;
        return g.type === "LineString" ? [g.coordinates] : g.coordinates;
      });
      ctx.log("ok", "Turf", `great-circle line ${km.toFixed(1)} km`);
      ctx.result(`${km1(km)} km as the crow flies`);
      return [feature(turf.multiLineString(arcs), "line", `${km1(km)} km`), ...pts.map((p, i) => feature(turf.point(p.coord), "marker", `${i + 1}. ${p.label}`))];
    }
    case "buffer": {
      const pts = await geocodeAll(a.centers, ctx);
      if (a.radius_km.length !== 1 && a.radius_km.length !== pts.length) throw new Error("buffer: give one radius, or one per center");
      ctx.result(pts.length === 1 ? `${a.radius_km[0]} km around ${pts[0].label}` : `${pts.length} buffers`);
      return pts.flatMap((p, i) => {
        const r = a.radius_km.length === 1 ? a.radius_km[0] : a.radius_km[i];
        ctx.log("ok", "Turf", `${r} km buffer around ${p.label}`);
        return [feature(turf.circle(p.coord, r, { steps: 96, units: "kilometers" }), "buffer", `${r} km`), feature(turf.point(p.coord), "marker", p.label)];
      });
    }
    case "isochrone": {
      const [p] = await geocodeAll([a.center], ctx);
      const key = a.unit === "km" ? "distance" : "time";
      const body = await valhalla("isochrone", {
        locations: [{ lon: p.coord[0], lat: p.coord[1] }],
        costing: COSTING[a.profile] ?? "auto",
        contours: [...a.values].sort((x, y) => x - y).map((v) => ({ [key]: v })),
        polygons: true,
      });
      ctx.log("ok", "Valhalla", `isochrone ${a.values.join(", ")} ${a.unit} ${a.profile}`);
      const outer = body.features.reduce((m, f) => Math.max(m, turf.area(f) / 1e6), 0);
      ctx.result(`${km1(outer)} km² reachable in ${Math.max(...a.values)} ${a.unit === "km" ? "km" : "min"}`);
      return [
        ...body.features.map((f) => feature({ type: "Feature", geometry: f.geometry, properties: {} }, "isochrone", `${f.properties.contour} ${a.unit}`)),
        feature(turf.point(p.coord), "marker", p.label),
      ];
    }
    case "polygon": {
      const pts = await geocodeAll(a.vertices, ctx);
      const ring = pts.map((p) => p.coord);
      const poly = turf.polygon([[...ring, ring[0]]]);
      const km2 = turf.area(poly) / 1e6;
      ctx.log("ok", "Turf", `polygon ${km2.toFixed(0)} km²`);
      ctx.result(`${km1(km2)} km²`);
      return [feature(poly, "polygon", `${km2.toFixed(0)} km²`), ...pts.map((p, i) => feature(turf.point(p.coord), "marker", `${i + 1}. ${p.label}`))];
    }
    case "elevation_profile": {
      let line;
      if (a.waypoints.length === 1 && a.waypoints[0] === "@selected") {
        const f = ctx.selected();
        if (!/LineString/.test(f?.geometry.type ?? "")) throw new Error("@selected: select a route or line first");
        line = f.geometry.type === "LineString" ? f : turf.lineString(f.geometry.coordinates.flat());
      } else {
        if (a.waypoints.length < 2) throw new Error("elevation: needs two places or a selected line");
        line = (await routeLine(a.waypoints, a.profile, ctx)).line;
      }
      const km = turf.length(line), n = 200;
      const shape = Array.from({ length: n }, (_, i) => turf.along(line, (km * i) / (n - 1)).geometry.coordinates);
      const body = await valhalla("height", { shape: shape.map(([lon, lat]) => ({ lon, lat })), range: true });
      const profile = body.range_height.map(([d, h]) => [d / 1000, h]);
      const hs = profile.map((p) => p[1]).filter((h) => h != null);
      ctx.log("ok", "Valhalla", `heights at ${n} points, ${Math.min(...hs)} to ${Math.max(...hs)} m`);
      let climb = 0;
      for (let i = 1; i < hs.length; i++) climb += Math.max(0, hs[i] - hs[i - 1]);
      ctx.result(`${km1(Math.round(climb))} m climb · high point ${km1(Math.max(...hs))} m`);
      ctx.chart(profile);
      return [feature(line, "route", `${km.toFixed(1)} km profile`)];
    }
    case "boundary": {
      const key = `bnd:${a.place.toLowerCase()}`;
      let f = cached(key);
      if (!f) {
        const body = await politeFetch(NOMINATIM, `${NOMINATIM}?q=${encodeURIComponent(a.place)}&format=geojson&polygon_geojson=1&polygon_threshold=0.002&limit=1`);
        f = body?.features?.[0];
        if (!f || !/Polygon/.test(f.geometry.type)) throw new Error(`Nominatim: no boundary for "${a.place}"`);
        store(key, f);
      }
      ctx.log("ok", "Nominatim", `${f.properties.display_name} (${f.properties.addresstype})`);
      ctx.result(`${a.place} · ${km1(turf.area(f) / 1e6)} km²`);
      return [feature({ type: "Feature", geometry: f.geometry, properties: {} }, "boundary", a.place)];
    }
    case "map":
      return ctx.mapAction(a);
    case "reply":
      ctx.result(a.text, a.kind === "chat" ? "ok" : "warn");
      if (a.suggestions?.length) ctx.suggest(a.suggestions);
      return [];
  }
  throw new Error(`unknown tool ${call.tool}`);
}

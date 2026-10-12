// Turn one {tool, args} call into geometry. Every place name goes through the geocoder; nothing here
// trusts coordinates from a model. Each step reports to `log`, so failures show up instead of vanishing.
import * as turf from "@turf/turf";

const PHOTON = "https://photon.komoot.io/api/";
const VALHALLA = "https://valhalla1.openstreetmap.de";
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const COSTING = { driving: "auto", walking: "pedestrian", cycling: "bicycle" };

// FOSSGIS Valhalla and Nominatim allow 1 request per second; Photon asks to be fair
const gaps = { [VALHALLA]: 1100, [NOMINATIM]: 1100, [PHOTON]: 300 };
const lastCall = {};
async function politeFetch(base, url, init) {
  const wait = (lastCall[base] ?? 0) + gaps[base] - Date.now();
  lastCall[base] = Date.now() + Math.max(wait, 0);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(30000) });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${new URL(base).host} ${res.status} ${body?.error ?? body?.message ?? ""}`.trim());
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

// name -> { coord: [lon, lat], label }
async function geocode(name, ctx) {
  if (name === "@me") {
    const pos = await new Promise((ok, fail) => navigator.geolocation.getCurrentPosition(ok, fail, { timeout: 15000 }))
      .catch((e) => { throw new Error(`location: ${e.message}`); });
    const coord = [pos.coords.longitude, pos.coords.latitude];
    ctx.log("ok", "location", `@me → ${fmt(coord)}`);
    return { coord, label: "you" };
  }
  if (name === "@selected") {
    const f = ctx.selected();
    if (!f) throw new Error("@selected: nothing is selected, click a feature on the map first");
    const coord = f.geometry.type === "Point" ? f.geometry.coordinates : turf.centroid(f).geometry.coordinates;
    return { coord, label: f.properties.label };
  }
  const key = `geo:${name.toLowerCase()}`;
  let hit = cached(key);
  if (!hit) {
    const body = await politeFetch(PHOTON, `${PHOTON}?q=${encodeURIComponent(name)}&limit=1`);
    const f = body?.features?.[0];
    if (!f) throw new Error(`Photon: no match for "${name}"`);
    const p = f.properties;
    hit = { coord: f.geometry.coordinates, found: [p.name, p.city ?? p.county, p.state, p.country].filter(Boolean).join(", ") };
    store(key, hit);
  }
  ctx.log("ok", "Photon", `${name} → ${hit.found} (${fmt(hit.coord)})`);
  return { coord: hit.coord, label: name.split(",")[0] };
}

const fmt = ([lon, lat]) => `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
const geocodeAll = async (names, ctx) => {
  const out = [];
  for (const n of names) out.push(await geocode(n, ctx)); // sequential: keeps Photon polite and the log ordered
  return out;
};

// Valhalla encodes shapes as polyline with 6 decimals
function decode6(str) {
  const out = [];
  let i = 0, lat = 0, lon = 0;
  while (i < str.length) {
    for (const axis of [0, 1]) {
      let shift = 0, result = 0, b;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      axis ? (lon += d) : (lat += d);
    }
    out.push([lon / 1e6, lat / 1e6]);
  }
  return out;
}

async function routeLine(names, profile, ctx) {
  const pts = await geocodeAll(names, ctx);
  const body = await valhalla("route", {
    locations: pts.map((p) => ({ lon: p.coord[0], lat: p.coord[1] })),
    costing: COSTING[profile] ?? "auto",
    units: "kilometers",
  });
  const coords = body.trip.legs.flatMap((l) => decode6(l.shape));
  const { length, time } = body.trip.summary;
  ctx.log("ok", "Valhalla", `${profile} route ${length.toFixed(1)} km, ${Math.round(time / 60)} min`);
  return { pts, line: turf.lineString(coords), km: length, min: time / 60 };
}

const feature = (geom, kind, label, extra = {}) => ({ ...geom, properties: { ...geom.properties, kind, label, ...extra } });

export async function execute(call, ctx) {
  const a = call.args;
  switch (call.tool) {
    case "markers": {
      const pts = await geocodeAll(a.places, ctx);
      return pts.map((p, i) => feature(turf.point(p.coord), "marker", `${i + 1}. ${p.label}`));
    }
    case "route": {
      const r = await routeLine(a.waypoints, a.profile, ctx);
      return [
        feature(r.line, "route", `${r.km.toFixed(1)} km · ${Math.round(r.min)} min`),
        ...r.pts.map((p, i) => feature(turf.point(p.coord), "marker", `${i + 1}. ${p.label}`)),
      ];
    }
    case "line": {
      const pts = await geocodeAll(a.places, ctx);
      const line = turf.lineString(pts.map((p) => p.coord));
      const km = turf.length(line);
      ctx.log("ok", "Turf", `straight line ${km.toFixed(1)} km`);
      return [feature(line, "line", `${km.toFixed(1)} km`), ...pts.map((p, i) => feature(turf.point(p.coord), "marker", `${i + 1}. ${p.label}`))];
    }
    case "buffer": {
      const pts = await geocodeAll(a.centers, ctx);
      if (a.radius_km.length !== 1 && a.radius_km.length !== pts.length) throw new Error("buffer: give one radius, or one per center");
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
      return [feature(poly, "polygon", `${km2.toFixed(0)} km²`), ...pts.map((p, i) => feature(turf.point(p.coord), "marker", `${i + 1}. ${p.label}`))];
    }
    case "elevation_profile": {
      let line;
      if (a.waypoints.length === 1 && a.waypoints[0] === "@selected") {
        const f = ctx.selected();
        if (f?.geometry.type !== "LineString") throw new Error("@selected: select a route or line first");
        line = f;
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
      return [feature({ type: "Feature", geometry: f.geometry, properties: {} }, "boundary", a.place)];
    }
    case "map":
      return ctx.mapAction(a);
    case "reply":
      ctx.log(a.kind === "chat" ? "ok" : "warn", "reply", `${a.kind}: ${a.text}`);
      return [];
  }
  throw new Error(`unknown tool ${call.tool}`);
}

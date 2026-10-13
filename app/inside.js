// What is inside an area already on the map: places of one kind, a summary, green cover, roads, terrain,
// flooding, 3D buildings, notable places, earthquakes. Everything is fetched by bounding box or polygon and then
// kept only if it really lies inside the shape.
import * as turf from "@turf/turf";
import { politeFetch, valhalla, feature, km1, boundaryOf } from "./execute.js";

// OpenStreetMap's query service. The public servers are often busy, so each is tried in turn; the Swiss one only
// holds Switzerland, so it is asked only about areas there.
const OVERPASS = [
  { url: "https://overpass-api.de/api/interpreter" },
  { url: "https://overpass.kumi.systems/api/interpreter" },
  { url: "https://maps.mail.ru/osm/tools/overpass/api/interpreter" },
  { url: "https://overpass.osm.ch/api/interpreter", covers: [5.9, 45.8, 10.5, 47.9] },
];
async function overpass(query, area, ctx) {
  const [w, s, e, n] = turf.bbox(area);
  const tried = [];
  for (const ep of OVERPASS) {
    if (ep.covers && !(w >= ep.covers[0] && s >= ep.covers[1] && e <= ep.covers[2] && n <= ep.covers[3])) continue;
    const host = new URL(ep.url).host;
    try {
      const body = await politeFetch(ep.url, ep.url, { method: "POST", body: new URLSearchParams({ data: `[out:json][timeout:18];${query}` }), signal: AbortSignal.timeout(20000) });
      ctx.log("ok", "Overpass", `answered by ${host}`);
      return body;
    } catch (err) {
      tried.push(`${host}: ${err.raw ?? err.message}`);
    }
  }
  throw Object.assign(new Error("OpenStreetMap's query service is busy, try again in a minute"), { kind: "network", raw: tried.join(" · ") });
}

// the area to look in: the latest drawn, the selected one, or a named region (drawn too, so you see it)
async function areaOf(name, ctx) {
  if (name === "@selected" || name === "@last") {
    const f = name === "@selected" ? ctx.selected() : ctx.latestArea();
    if (!f || !/Polygon/.test(f.geometry.type)) throw new Error(name === "@selected" ? "select an area first: a circle, a reach area, a polygon or a boundary" : "draw an area first: a circle, a reach area, a polygon or a boundary");
    return { area: f, drawn: [] };
  }
  const f = await boundaryOf(name, ctx);
  const outline = feature({ type: "Feature", geometry: f.geometry, properties: {} }, "boundary", name);
  return { area: outline, drawn: [outline] };
}

// Overpass takes one ring: the biggest polygon's outer edge, simplified to at most ~150 points
function polyString(area) {
  const polys = area.geometry.type === "Polygon" ? [area.geometry.coordinates] : area.geometry.coordinates;
  const ring = polys.map((p) => p[0]).sort((a, b) => turf.area(turf.polygon([b])) - turf.area(turf.polygon([a])))[0];
  let simple = ring, tol = 0.0001;
  while (simple.length > 150) simple = turf.simplify(turf.polygon([ring]), { tolerance: (tol *= 2) }).geometry.coordinates[0];
  return simple.map(([lon, lat]) => `${lat.toFixed(5)} ${lon.toFixed(5)}`).join(" ");
}
const within = (pt, area) => turf.booleanPointInPolygon(pt, area);

// a word -> OpenStreetMap tags; the first match wins
const KINDS = [
  [/caf|coffee/, '["amenity"="cafe"]', "cafés"],
  [/restaurant|food|eat|dine/, '["amenity"~"^(restaurant|fast_food|food_court)$"]', "places to eat"],
  [/\bbar|pub|drink/, '["amenity"~"^(bar|pub|biergarten)$"]', "bars"],
  [/college|universit/, '["amenity"~"^(college|university)$"]', "colleges"],
  [/school/, '["amenity"="school"]', "schools"],
  [/hospital|clinic|doctor/, '["amenity"~"^(hospital|clinic|doctors)$"]', "hospitals and clinics"],
  [/pharm|chemist|medical/, '["amenity"="pharmacy"]', "pharmacies"],
  [/bank|atm/, '["amenity"~"^(bank|atm)$"]', "banks and ATMs"],
  [/playground/, '["leisure"="playground"]', "playgrounds"],
  [/parking|car park/, '["amenity"="parking"]', "car parks"],
  [/park|garden/, '["leisure"~"^(park|garden)$"]', "parks"],
  [/fuel|petrol|gas station/, '["amenity"="fuel"]', "fuel stations"],
  [/charg|\bev\b/, '["amenity"="charging_station"]', "EV chargers"],
  [/toilet|restroom|washroom/, '["amenity"="toilets"]', "toilets"],
  [/bus/, '["highway"="bus_stop"]', "bus stops"],
  [/metro|subway|train|station|rail/, '["railway"~"^(station|halt)$"]', "stations"],
  [/museum/, '["tourism"="museum"]', "museums"],
  [/hotel|hostel|stay/, '["tourism"~"^(hotel|hostel|guest_house)$"]', "places to stay"],
  [/supermarket|grocer|convenience/, '["shop"~"^(supermarket|convenience|greengrocer)$"]', "food shops"],
  [/shop|store|mall/, '["shop"]', "shops"],
  [/gym|fitness/, '["leisure"="fitness_centre"]', "gyms"],
  [/librar/, '["amenity"="library"]', "libraries"],
  [/cinema|movie|theatre/, '["amenity"~"^(cinema|theatre)$"]', "cinemas and theatres"],
  [/temple|church|mosque|gurudwara|worship/, '["amenity"="place_of_worship"]', "places of worship"],
  [/police/, '["amenity"="police"]', "police stations"],
  [/tree/, '["natural"="tree"]', "trees"],
  [/bench/, '["amenity"="bench"]', "benches"],
  [/bike|bicycle|cycle/, '["amenity"~"^(bicycle_parking|bicycle_rental)$"]', "bike parking and rental"],
];
const SUMMARY = ["shop", "eat", "cafe", "school", "hospital", "pharmacy", "bus", "station", "park", "worship"];

async function places(area, kind, ctx) {
  const hit = KINDS.find(([re]) => re.test((kind ?? "").toLowerCase()));
  if (!hit) throw Object.assign(new Error(`I can't look for "${kind}" yet`), { kind: "model" });
  const [, tags, label] = hit;
  const body = await overpass(`nwr${tags}(poly:"${polyString(area)}");out center 500;`, area, ctx);
  const pts = body.elements
    .map((el) => ({ el, c: el.center ? [el.center.lon, el.center.lat] : [el.lon, el.lat] }))
    .filter(({ c }) => c[0] != null && within(turf.point(c), area));
  ctx.log("ok", "Overpass", `${pts.length} ${label}${body.elements.length >= 500 ? " (first 500)" : ""}`);
  ctx.result(`${pts.length}${body.elements.length >= 500 ? "+" : ""} ${label} inside`);
  return pts.map(({ el, c }) => feature(turf.point(c), "poi", el.tags?.name ?? ""));
}

async function summary(area, ctx) {
  const rows = SUMMARY.map((w) => KINDS.find(([re]) => re.test(w)));
  const poly = polyString(area);
  const body = await overpass(rows.map(([, tags]) => `nwr${tags}(poly:"${poly}");out count;`).join(""), area, ctx);
  const counts = body.elements.map((el, i) => [rows[i][2], Number(el.tags?.total ?? 0)]).sort((a, b) => b[1] - a[1]);
  ctx.stats(counts.map(([k, n]) => [k, n.toLocaleString("en-IN")]));
  ctx.result(counts.filter(([, n]) => n).slice(0, 3).map(([k, n]) => `${n.toLocaleString("en-IN")} ${k}`).join(" · ") || "nothing mapped inside");
  return [];
}

// polygons from Overpass ways (and the closed outer rings of relations)
function polygonsOf(elements) {
  const rings = [];
  for (const el of elements) {
    const parts = el.type === "way" ? [el.geometry] : (el.members ?? []).filter((m) => m.role === "outer").map((m) => m.geometry);
    for (const g of parts) {
      if (!g || g.length < 4) continue;
      const ring = g.map((p) => [p.lon, p.lat]);
      if (ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]) rings.push(turf.polygon([ring]));
    }
  }
  return rings;
}

async function green(area, ctx) {
  const poly = polyString(area);
  const sel = ['["leisure"~"^(park|garden|nature_reserve)$"]', '["landuse"~"^(forest|grass|meadow|recreation_ground|village_green)$"]', '["natural"~"^(wood|scrub|grassland|heath)$"]'];
  const body = await overpass(`(${sel.map((t) => `way${t}(poly:"${poly}");relation${t}(poly:"${poly}");`).join("")});out geom;`, area, ctx);
  const polys = polygonsOf(body.elements).slice(0, 3000);
  const clipped = polys.map((p) => turf.intersect(turf.featureCollection([p, area]))).filter(Boolean);
  const merged = clipped.length > 1 ? turf.union(turf.featureCollection(clipped)) : clipped[0];
  const share = merged ? turf.area(merged) / turf.area(area) : 0;
  ctx.log("ok", "Turf", `${polys.length} green shapes, ${km1(turf.area(merged ?? turf.point([0, 0])) / 1e6)} km² inside`);
  ctx.result(`about ${Math.round(share * 100)}% green`);
  return merged ? [feature(merged, "green", `${Math.round(share * 100)}% green`)] : [];
}

const ROADS = [["main roads", /^(motorway|trunk|primary|secondary|tertiary)(_link)?$/], ["streets", /^(residential|unclassified|living_street|service)$/],
  ["footpaths", /^(footway|path|pedestrian|steps|track)$/], ["cycle lanes", /^cycleway$/]];
async function roads(area, ctx) {
  const body = await overpass(`way["highway"](poly:"${polyString(area)}");out geom;`, area, ctx);
  const km = Object.fromEntries(ROADS.map(([k]) => [k, 0]));
  for (const el of body.elements) {
    const kind = ROADS.find(([, re]) => re.test(el.tags?.highway ?? ""))?.[0];
    if (!kind || !el.geometry) continue;
    // a segment counts when its midpoint is inside
    for (let i = 1; i < el.geometry.length; i++) {
      const a = [el.geometry[i - 1].lon, el.geometry[i - 1].lat], b = [el.geometry[i].lon, el.geometry[i].lat];
      if (within(turf.point([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]), area)) km[kind] += turf.distance(a, b);
    }
  }
  ctx.stats(Object.entries(km).map(([k, v]) => [k, `${km1(v)} km`]));
  ctx.result(Object.entries(km).filter(([, v]) => v > 0.05).map(([k, v]) => `${km1(v)} km of ${k}`).join(" · ") || "no roads mapped inside");
  return [];
}

// heights on a grid of about n cells inside the area (Valhalla, from the same terrain data as the 3D view)
async function heights(area, n) {
  const side = Math.sqrt(turf.area(area) / n) / 1000;
  const cells = turf.squareGrid(turf.bbox(area), side, { units: "kilometers", mask: area }).features;
  const pts = cells.map((c) => turf.centroid(c).geometry.coordinates);
  const hs = [];
  for (let i = 0; i < pts.length; i += 500) {
    const body = await valhalla("height", { shape: pts.slice(i, i + 500).map(([lon, lat]) => ({ lon, lat })) });
    hs.push(...body.height);
  }
  return cells.map((c, i) => ({ cell: c, h: hs[i] })).filter((x) => x.h != null);
}

async function terrain(area, ctx) {
  const grid = await heights(area, 400);
  if (!grid.length) throw new Error("no heights for this area");
  const hs = grid.map((g) => g.h), lo = Math.min(...hs), hi = Math.max(...hs), mean = hs.reduce((a, b) => a + b, 0) / hs.length;
  ctx.log("ok", "Valhalla", `heights at ${hs.length} points`);
  ctx.stats([["lowest", `${km1(lo)} m`], ["highest", `${km1(hi)} m`], ["average", `${km1(Math.round(mean))} m`], ["rise", `${km1(hi - lo)} m`]]);
  ctx.result(`${km1(lo)} to ${km1(hi)} m, ${km1(hi - lo)} m of rise`);
  return [];
}

async function flood(area, level, ctx) {
  const grid = await heights(area, 900);
  const wet = grid.filter((g) => g.h <= level);
  const share = grid.length ? wet.length / grid.length : 0;
  ctx.log("ok", "Valhalla", `heights at ${grid.length} cells, ${wet.length} at or below ${level} m`);
  ctx.result(`${Math.round(share * 100)}% of it lies at or below ${level} m`);
  if (!wet.length) return [];
  const water = wet.length > 1 ? turf.union(turf.featureCollection(wet.map((g) => g.cell))) : wet[0].cell;
  return [feature(water, "flood", `below ${level} m`)];
}

async function wiki(area, ctx) {
  const [lon, lat] = turf.centroid(area).geometry.coordinates;
  const [w, s, e, n] = turf.bbox(area);
  const radius = Math.min(10000, Math.ceil(turf.distance([lon, lat], [e, n]) * 1000));
  const url = `https://en.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=${lat}|${lon}&gsradius=${radius}&gslimit=200&format=json&origin=*`;
  const body = await politeFetch("https://en.wikipedia.org", url);
  const hits = (body.query?.geosearch ?? []).filter((g) => within(turf.point([g.lon, g.lat]), area));
  ctx.log("ok", "Wikipedia", `${hits.length} articles inside${radius === 10000 && turf.distance([w, s], [e, n]) > 20 ? " (the middle 10 km only)" : ""}`);
  ctx.result(`${hits.length} notable places`);
  return hits.map((g) => feature(turf.point([g.lon, g.lat]), "poi", g.title, { url: `https://en.wikipedia.org/?curid=${g.pageid}` }));
}

async function quakes(area, since, ctx) {
  const [w, s, e, n] = turf.bbox(area);
  const from = since ?? 2000;
  const url = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${from}-01-01&minmagnitude=2.5&minlatitude=${s}&maxlatitude=${n}&minlongitude=${w}&maxlongitude=${e}&orderby=magnitude&limit=500`;
  const body = await politeFetch("https://earthquake.usgs.gov", url);
  const hits = body.features.filter((q) => within(turf.point(q.geometry.coordinates.slice(0, 2)), area));
  ctx.log("ok", "USGS", `${hits.length} of magnitude 2.5 or more since ${from}`);
  const top = hits[0];
  ctx.result(hits.length ? `${hits.length} earthquakes since ${from}, strongest M${top.properties.mag} in ${new Date(top.properties.time).getFullYear()}` : `no earthquakes of M2.5 or more since ${from}`);
  return hits.map((q) => feature(turf.point(q.geometry.coordinates.slice(0, 2)), "quake", `M${q.properties.mag} · ${new Date(q.properties.time).getFullYear()}`, { mag: q.properties.mag }));
}

export async function inside(a, ctx) {
  const { area, drawn } = await areaOf(a.area, ctx);
  const found = await {
    places: () => places(area, a.kind, ctx),
    summary: () => summary(area, ctx),
    green: () => green(area, ctx),
    roads: () => roads(area, ctx),
    terrain: () => terrain(area, ctx),
    flood: () => flood(area, a.level_m ?? 2, ctx),
    buildings: () => ctx.buildings(area, ctx),
    wiki: () => wiki(area, ctx),
    quakes: () => quakes(area, a.since, ctx),
  }[a.what]?.();
  if (!found) throw Object.assign(new Error(`inside: unknown "${a.what}"`), { kind: "model" });
  return [...drawn, ...found];
}

// How results look, beyond the plain style in main.js. A new area arrives with a ping that runs out from its
// center; an isochrone rests as a gradient of its contours; places, lengths and areas carry their names and
// numbers as small chips in the app's own type, which step aside when they collide or slip behind the chat. On a tap,
// an isochrone lifts into terrain (height is time left) or fills with traffic (cars on real Valhalla drives at
// road speed). One clock drives all of it, from the iso.html comparison page.
import { featureCollection, difference, area as turfArea, bbox, lineString, lineIntersect, polygonToLine, distance, pointOnFeature, centroid, along, length as lineLength, booleanPointInPolygon } from "@turf/turf";
import { Marker } from "maplibre-gl";
import { valhalla } from "./execute.js";

const AREAS = ["buffer", "isochrone", "polygon", "boundary"];
const COSTING = { driving: "auto", walking: "pedestrian", cycling: "bicycle" };
const RAMP = (v) => ["interpolate", ["linear"], v, 0, "#F1F2F3", 0.35, "#7fd3ff", 1, "#089bdf"];
const clamp01 = (x) => ["min", 1, ["max", 0, x]];
const easeOut = (p) => ["-", 1, ["^", ["-", 1, p], 3]];
const FRAC = ["coalesce", ["get", "frac"], 1]; // where a contour sits between the center (0) and the edge (1)
const ISO = ["==", ["get", "kind"], "isochrone"];
const SPEED = 5; // traffic: drive minutes per real second
const EMIT = 1; // traffic: a car leaves each route every this many minutes
const ROUTES = 10; // traffic: drives fetched, about one a second from the free server

// the resting look of every area; during a ping, the arriving run shows each contour as the front passes it
export function fillPaint(ping) {
  const base = ["match", ["get", "kind"], "isochrone", 0.18, "boundary", 0.08, 0.16];
  return {
    "fill-color": ["case", ISO, RAMP(FRAC), "#BEC2C7"],
    "fill-opacity": ping ? ["case", ["==", ["get", "run"], ping.run], ["*", base, clamp01(["/", ["-", ping.f, FRAC], 0.15])], base] : base,
  };
}
export function edgePaint(ping) {
  const color = ["case", ISO, RAMP(FRAC), "#E1E2E4"];
  const width = ["case", ISO, 1.2, 1.8];
  if (!ping) return { "line-color": color, "line-width": width, "line-opacity": 0.9 };
  const mine = ["==", ["get", "run"], ping.run], since = ["-", ping.f, FRAC];
  const glow = ["^", ["e"], ["/", ["-", 0, ["max", 0, since]], 0.12]];
  return {
    "line-color": color,
    "line-width": ["case", mine, ["+", width, ["*", 2.5, glow]], width],
    "line-opacity": ["case", mine, ["case", ["<", since, 0], 0, ["min", 1, ["+", 0.9, ["*", 0.1, glow]]]], 0.9],
  };
}

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

const contours = (feats) => feats.filter((f) => f.properties.kind === "isochrone").sort((a, b) => a.properties.frac - b.properties.frac);
const centerOf = (feats) => feats.find((f) => f.properties.kind === "marker")?.geometry.coordinates;
const outerRing = (f) => (f.geometry.type === "Polygon" ? f.geometry.coordinates[0] : f.geometry.coordinates.reduce((a, b) => (b[0].length > a[0].length ? b : a))[0]);

export function createLooks(map) {
  let ping = null, lift = null, traffic = null, ticks = featureCollection([]), raf = 0;
  const spots = new Map(); // fid -> where its chip sits, worked out once
  const chips = new Map(); // key -> { marker, el, prio, run }

  function layers() {
    map.addSource("ticks", { type: "geojson", data: ticks });
    map.addLayer({ id: "mark-tick", type: "circle", source: "ticks", paint: { "circle-radius": 2.5, "circle-color": "#F1F2F3", "circle-stroke-color": "#121518", "circle-stroke-width": 1 } }, "points");
    map.addSource("lift", { type: "geojson", data: lift?.data ?? featureCollection([]) });
    map.addLayer({ id: "lift", type: "fill-extrusion", source: "lift", paint: { "fill-extrusion-color": RAMP(["get", "from"]), "fill-extrusion-opacity": 0.92, "fill-extrusion-height": ["get", "h"] } }, "points");
    map.addSource("roads", { type: "geojson", data: featureCollection([]) });
    map.addLayer({ id: "roads", type: "line", source: "roads", paint: { "line-color": "#7fd3ff", "line-opacity": 0.18, "line-width": 1 } }, "points");
    map.addSource("cars", { type: "geojson", data: featureCollection([]) });
    map.addLayer({ id: "cars", type: "circle", source: "cars", paint: { "circle-radius": 2.4, "circle-color": RAMP(["get", "e"]), "circle-opacity": ["get", "a"], "circle-blur": 0.3 } }, "points");
    if (traffic) map.getSource("roads").setData(featureCollection(traffic.routes.map((r) => lineString(r.coords))));
    if (ping || lift || traffic) wake();
  }

  // where a feature's chip goes. Isochrones and buffers: where a ray due west of the center leaves the edge, so
  // contours line up as a scale. Polygons and boundaries: the middle. Lines: halfway along.
  function spot(f, visible) {
    const { kind, fid, run, label } = f.properties;
    if (spots.has(fid)) return spots.get(fid);
    let at, text = label, cls = "pin", prio = 0, tick = false;
    if (kind === "marker") at = f.geometry.coordinates;
    else if (kind === "route" || kind === "line") {
      const parts = f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.coordinates;
      const part = lineString(parts.reduce((a, b) => (b.length > a.length ? b : a)));
      at = along(part, lineLength(part) / 2).geometry.coordinates;
      cls = "len";
      prio = 2;
    } else if (kind === "polygon" || kind === "boundary") {
      const c = centroid(f);
      at = (booleanPointInPolygon(c, f) ? c : pointOnFeature(f)).geometry.coordinates;
      text = `${(turfArea(f) / 1e6).toLocaleString("en-IN", { maximumFractionDigits: 0 })} km²`;
      cls = "big";
      prio = 1;
    } else if (kind === "isochrone" || kind === "buffer") {
      const c = (kind === "isochrone" && centerOf(visible.filter((g) => g.properties.run === run))) || centroid(f).geometry.coordinates;
      const hits = lineIntersect(lineString([c, [bbox(f)[0] - 1, c[1]]]), polygonToLine(f)).features;
      at = (hits.reduce((a, b) => (distance(c, b) > distance(c, a) ? b : a), hits[0]) ?? pointOnFeature(f)).geometry.coordinates;
      cls = "scale";
      prio = 3 + (1 - (f.properties.frac ?? 1)); // the outer edge wins a collision
      tick = true;
    } else return null;
    const s = { at, text, cls, prio, tick, run };
    spots.set(fid, s);
    return s;
  }

  function sync(visible) {
    const runs = new Set(visible.map((f) => f.properties.run));
    if (lift && !runs.has(lift.run)) setLift(null);
    if (traffic && !runs.has(traffic.run)) setTraffic(null);
    const keep = new Set(), tickPts = [];
    for (const f of visible) {
      const s = spot(f, visible);
      if (!s) continue;
      const key = f.properties.fid;
      keep.add(key);
      if (s.tick) tickPts.push({ type: "Feature", geometry: { type: "Point", coordinates: s.at }, properties: { run: s.run } });
      if (chips.has(key)) continue;
      const el = document.createElement("div");
      el.className = `map-chip ${s.cls}`;
      const n = s.cls === "pin" && /^(\d+)\. (.*)$/.exec(s.text); // an order ("1. Hebbal") becomes a quiet index cell
      if (n) el.innerHTML = "<i></i><span></span>", (el.firstChild.textContent = n[1]), (el.lastChild.textContent = n[2]);
      else el.textContent = s.text;
      const anchor = s.cls === "big" || s.cls === "len" ? "center" : "bottom";
      const marker = new Marker({ element: el, anchor, offset: anchor === "bottom" ? [0, s.cls === "pin" ? -9 : -5] : [0, 0] }).setLngLat(s.at).addTo(map);
      chips.set(key, { marker, el, prio: s.prio, run: s.run, anchor });
    }
    for (const [key, c] of chips) if (!keep.has(key)) c.marker.remove(), chips.delete(key);
    ticks = featureCollection(tickPts);
    map.getSource("ticks")?.setData(ticks);
    layout();
  }

  // chips in priority order; one that would overlap a placed chip, the feed or the chat bar fades out
  function layout() {
    const feed = document.body.classList.contains("has-feed") ? document.getElementById("feed")?.getBoundingClientRect() : null;
    const barTop = innerHeight - (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--bar-h")) || 0);
    const box = map.getContainer().getBoundingClientRect();
    const placed = [];
    for (const c of [...chips.values()].sort((a, b) => a.prio - b.prio)) {
      const p = map.project(c.marker.getLngLat()), w = c.el.offsetWidth, h = c.el.offsetHeight, { x: ox, y: oy } = c.marker.getOffset();
      const x = box.left + p.x + ox - w / 2, y = box.top + p.y + oy - (c.anchor === "bottom" ? h : h / 2);
      const r = { l: x - 2, t: y - 2, r: x + w + 2, b: y + h + 2 };
      const hit = (q) => q && r.l < q.right && r.r > q.left && r.t < q.bottom && r.b > q.top;
      const off = (ping && ping.run === c.run) || r.b > barTop || hit(feed) || placed.some((q) => hit({ left: q.l, right: q.r, top: q.t, bottom: q.b }));
      c.el.classList.toggle("off", off);
      if (!off) placed.push(r);
    }
  }
  // a label that cannot be placed must never stop the map from moving
  const safeLayout = () => { try { layout(); } catch (err) { console.warn("chips:", err); } };
  map.on("move", safeLayout);
  addEventListener("resize", safeLayout);

  // a new area: hidden until the camera lands, then a front runs from its center to its edge
  function arrive(run, feats) {
    if (!feats.some((f) => AREAS.includes(f.properties.kind))) return;
    ping = { run, f: -1, t0: 0, ms: feats.some((f) => f.properties.kind === "isochrone") ? 1600 : 350 };
    paintPing();
    const go = () => ping?.run === run && ((ping.t0 = performance.now()), wake());
    setTimeout(() => (map.isMoving() ? map.once("moveend", go) : go()), 60);
  }
  function paintPing() {
    if (!map.getLayer("area-fill")) return;
    for (const [k, v] of Object.entries(fillPaint(ping))) map.setPaintProperty("area-fill", k, v);
    for (const [k, v] of Object.entries(edgePaint(ping))) map.setPaintProperty("area-edge", k, v);
    map.getLayer("mark-tick") && map.setFilter("mark-tick", ping ? ["!=", ["get", "run"], ping.run] : null);
    layout();
  }

  // 3D: each band rises to the time left at its inner edge; the summit is the start. One run at a time.
  function setLift(run, feats, btn) {
    if (lift?.btn) lift.btn.textContent = "3D";
    if (run == null || lift?.run === run) {
      lift = null;
      map.getSource("lift")?.setData(featureCollection([]));
      return;
    }
    const cs = contours(feats);
    const H = 0.15 * Math.sqrt(turfArea(cs.at(-1))); // a summit in proportion to the reach
    const data = featureCollection(cs.map((c, i) => {
      const from = i ? cs[i - 1].properties.frac : 0;
      const g = i ? difference(featureCollection([c, cs[i - 1]])) : c;
      return g && { type: "Feature", geometry: g.geometry, properties: { from, h: H * (1 - from) } };
    }).filter(Boolean));
    lift = { run, data, t0: performance.now(), btn };
    if (btn) btn.textContent = "flat";
    map.getSource("lift")?.setData(data);
    if (map.getPitch() < 30) map.easeTo({ pitch: 55, duration: 900 });
    wake();
  }

  // traffic: drives from the start to points around the edge, fetched one by one; cars flow as each arrives
  async function setTraffic(run, feats, call, btn) {
    if (traffic?.btn) traffic.btn.textContent = "traffic";
    if (run == null || traffic?.run === run) {
      traffic = null;
      map.getSource("roads")?.setData(featureCollection([]));
      map.getSource("cars")?.setData(featureCollection([]));
      return;
    }
    const me = (traffic = { run, routes: [], t0: performance.now(), btn });
    wake();
    const center = centerOf(feats), edge = lineString(outerRing(contours(feats).at(-1))), len = lineLength(edge);
    for (let i = 0; i < ROUTES && traffic === me; i++) {
      if (btn) btn.textContent = `traffic ${i}/${ROUTES}`;
      const to = along(edge, (len * i) / ROUTES).geometry.coordinates;
      try {
        const r = await valhalla("route", { locations: [{ lon: center[0], lat: center[1] }, { lon: to[0], lat: to[1] }], costing: COSTING[call.args.profile] ?? "auto" });
        const coords = decode(r.trip.legs[0].shape), t = new Array(coords.length).fill(0);
        // Valhalla times each maneuver; inside one, time is spread by distance
        for (const m of r.trip.legs[0].maneuvers) {
          const a = m.begin_shape_index, b = m.end_shape_index, d = [0];
          for (let k = a + 1; k <= b; k++) d.push(d.at(-1) + distance(coords[k - 1], coords[k]));
          for (let k = a + 1; k <= b; k++) t[k] = t[a] + (m.time / 60) * (d.at(-1) ? d[k - a] / d.at(-1) : 1);
        }
        if (traffic !== me) return;
        me.routes.push({ coords, t, born: (performance.now() - me.t0) / 1000 * SPEED });
        map.getSource("roads")?.setData(featureCollection(me.routes.map((x) => lineString(x.coords))));
      } catch {} // a drive the server refused is just one fewer stream
    }
    if (traffic === me && btn) btn.textContent = "stop traffic";
  }
  function cars(now) {
    const out = [], t = ((now - traffic.t0) / 1000) * SPEED;
    traffic.routes.forEach((r, i) => {
      const T = r.t.at(-1), off = r.born + ((i * 7) % 10) / 10 * EMIT;
      for (let k = Math.max(0, Math.floor((t - T - off) / EMIT)); k <= Math.floor((t - off) / EMIT); k++) {
        const e = t - off - k * EMIT;
        if (e < 0 || e > T) continue;
        let lo = 0, hi = r.t.length - 1; // last vertex at or before e
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (r.t[mid] <= e) lo = mid; else hi = mid; }
        const span = r.t[hi] - r.t[lo], f = span ? (e - r.t[lo]) / span : 0, [a, b] = [r.coords[lo], r.coords[hi]];
        out.push({ type: "Feature", geometry: { type: "Point", coordinates: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f] }, properties: { e: e / T, a: Math.min(1, (T - e) / 1.5) * 0.95 } });
      }
    });
    return featureCollection(out);
  }

  const wake = () => (raf ||= requestAnimationFrame(tick));
  function tick(now) {
    raf = 0;
    let more = false;
    if (ping && ping.t0) {
      ping.f = (now - ping.t0) / ping.ms;
      if (ping.f > 1.6) (ping = null), paintPing();
      else paintPing(), (more = true);
    }
    if (lift) {
      const g = ((now - lift.t0) / 1200) * 1.35; // the rise, band by band from the summit out
      map.getLayer("lift") && map.setPaintProperty("lift", "fill-extrusion-height", ["*", ["get", "h"], easeOut(clamp01(["/", ["-", g, ["get", "from"]], 0.35]))]);
      if (g < 1.35) more = true;
    }
    if (traffic) map.getSource("cars")?.setData(cars(now)), (more = true);
    if (more) wake();
  }

  return { layers, sync, arrive, lift: setLift, traffic: setTraffic };
}

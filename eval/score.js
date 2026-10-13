// Compare a model's {tool, args} to the golden expectation. Returns { ok, why }.
// Place strings are matched loosely (core name, known spellings), numbers within 1%.

const SPELLINGS = {
  bangalore: "bengaluru", mysore: "mysuru", gurgaon: "gurugram", belgaum: "belagavi", hubballi: "hubli",
  pondicherry: "puducherry", pondy: "puducherry", mamallapuram: "mahabalipuram", kodagu: "coorg",
  "chhatrapati sambhajinagar": "aurangabad", cochin: "kochi", "lal bagh": "lalbagh", "new delhi": "delhi",
  bombay: "mumbai", madras: "chennai", "nyc": "new york",
};
const SAME = [
  ["kempegowda international airport", "bengaluru airport", "kempegowda airport", "blr airport"],
  ["rajiv gandhi international airport", "hyderabad airport", "rgia", "hyd airport"],
];

function variants(s) {
  s = s.toLowerCase().trim();
  const out = [];
  const paren = s.match(/\(([^)]*)\)/);
  if (paren) out.push(paren[1]);
  out.push(s.replace(/\([^)]*\)/g, "").split(",")[0]);
  return out.map((v) => {
    v = v.replace(/[^a-z0-9@ ]+/g, " ").replace(/\s+/g, " ").trim();
    v = SPELLINGS[v] ?? v;
    for (const g of SAME) if (g.includes(v)) v = g[0];
    return v.split(" ").filter((t) => t && t !== "the").map((t) => SPELLINGS[t] ?? t);
  });
}

export function samePlace(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.startsWith("@") || b.startsWith("@")) return a.trim() === b.trim();
  for (const ta of variants(a)) for (const tb of variants(b)) {
    if (!ta.length || !tb.length) continue;
    const [s, l] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
    if (s.every((t) => l.includes(t))) return true;
  }
  return false;
}

const stem = (s) => s.toLowerCase().normalize("NFD").replace(/[^a-z ]/g, "").trim().replace(/s$/, "").replace(/e$/, "");
const sameNum = (a, b) => typeof a === "number" && Math.abs(a - b) <= Math.max(0.01 * Math.abs(b), 1e-9);

function sameSet(a, b, eq) {
  if (!Array.isArray(a) || a.length !== b.length) return false;
  const left = [...a];
  return b.every((x) => {
    const i = left.findIndex((y) => eq(y, x));
    return i >= 0 && left.splice(i, 1);
  });
}
const sameSeq = (a, b, eq) => Array.isArray(a) && a.length === b.length && b.every((x, i) => eq(a[i], x));
// travel order: endpoints fixed, vias in any order (users list vias loosely)
const sameTrip = (a, b) =>
  Array.isArray(a) && a.length === b.length &&
  samePlace(a[0], b[0]) && samePlace(a.at(-1), b.at(-1)) && sameSet(a.slice(1, -1), b.slice(1, -1), samePlace);

const FIELDS = {
  markers: { places: (a, b) => sameSet(a, b, samePlace) },
  route: { waypoints: sameTrip, profile: (a, b) => a === b },
  line: { places: (a, b) => sameSeq(a, b, samePlace) },
  polygon: { vertices: (a, b) => sameSet(a, b, samePlace) },
  isochrone: {
    center: samePlace, profile: (a, b) => a === b, unit: (a, b) => a === b,
    values: (a, b) => sameSet(a, b, sameNum),
  },
  elevation_profile: { waypoints: sameTrip, profile: (a, b) => a === b },
  boundary: { place: samePlace },
  // only what the expectation names is checked; kind matches on its stem ("cafe", "cafes", "Cafés")
  inside: {
    area: samePlace, what: (a, b) => a === b,
    kind: (a, b) => b == null || (typeof a === "string" && stem(a) === stem(b)),
    level_m: (a, b) => b == null || sameNum(a, b), since: (a, b) => b == null || sameNum(a, b),
  },
  reply: {},
  plan: { steps: (a, b) => Array.isArray(a) && a.length === b.length },
};

function bufferPairs(args) {
  const { centers, radius_km: r } = args;
  if (!Array.isArray(centers) || !Array.isArray(r)) return null;
  if (r.length === 1) return centers.map((c) => [c, r[0]]);
  return r.length === centers.length ? centers.map((c, i) => [c, r[i]]) : null;
}

export function score(got, expect, match = {}) {
  if (!got || got.tool !== expect.tool) return { ok: false, toolOk: false, why: `tool ${got?.tool ?? "none"}` };
  const a = got.args ?? {}, e = expect.args;
  const bad = [];
  if (expect.tool === "buffer") {
    const pa = bufferPairs(a), pe = bufferPairs(e);
    if (!pa || !sameSet(pa, pe, (x, y) => samePlace(x[0], y[0]) && sameNum(x[1], y[1]))) bad.push("centers/radius_km");
  } else if (expect.tool === "map") {
    for (const k of Object.keys(e))
      if (typeof e[k] === "number" ? !sameNum(a[k], e[k]) : a[k] !== e[k]) bad.push(k);
  } else {
    for (const [k, eq] of Object.entries(FIELDS[expect.tool])) {
      if (match[k] === "ignore") continue;
      const ok = match[k] === "count" ? Array.isArray(a[k]) && a[k].length === e[k].length : eq(a[k], e[k]);
      if (!ok) bad.push(k);
    }
  }
  return { ok: !bad.length, toolOk: true, why: bad.join(" ") };
}

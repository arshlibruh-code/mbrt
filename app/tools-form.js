// The tools overlay: the same tools Theo calls, as a form in plain words. It reads and writes exactly
// the schema's arguments, so a call Theo made can be mirrored in, edited and run again by hand.

const I = (d) => `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

const TILES = [
  ["markers", "Pins", "Drop pins on places", I('<path d="M8 14.5s4.8-4.1 4.8-8A4.8 4.8 0 0 0 3.2 6.5c0 3.9 4.8 8 4.8 8z"/><circle cx="8" cy="6.4" r="1.6"/>')],
  ["route", "Route", "Road or path route through stops", I('<circle cx="3" cy="13" r="1.4"/><circle cx="13" cy="3" r="1.4"/><path d="M4.3 12.4c3.2-.6 1.8-4.6 4.2-5.2 1.6-.4 2.4-1.6 3.4-3"/>')],
  ["line", "Line", "Straight lines between places, as the crow flies", I('<circle cx="3" cy="13" r="1.4"/><circle cx="13" cy="3" r="1.4"/><path d="M4 12 12 4" stroke-dasharray="1.6 1.8"/>')],
  ["buffer", "Radius", "A circle of a set radius around places", I('<circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r=".9" fill="currentColor"/><path d="M8 8h6"/>')],
  ["isochrone", "Reach", "How far you get in a time or a distance", I('<path d="M8 1.8c3.6 0 6.3 2.4 6 5.6-.3 3.6-3.2 6.8-6.4 6.8S1.8 11.6 2 8.2C2.3 4.6 4.5 1.8 8 1.8z"/><path d="M8 5.2c1.7 0 3 1.1 2.8 2.7-.2 1.7-1.5 3-3 3S5 9.8 5.1 8.2C5.3 6.5 6.3 5.2 8 5.2z"/>')],
  ["polygon", "Area", "A filled shape between places", I('<path d="M3 12.5 5.5 3 13 5.5 11.5 13z"/>')],
  ["elevation_profile", "Elevation", "Height chart along a route", I('<path d="M1.5 13 5.2 6.5l2.6 3.6 3-6 3.7 8.9z"/>')],
  ["boundary", "Boundary", "The official outline of a country, state or city", I('<path d="M3 4.5 7 2.5l6 2-1 7-5 2.5-4.5-3z" stroke-dasharray="2 1.6"/>')],
  ["map", "Map", "Basemap, zoom, coordinates, 3D terrain, clear", I('<path d="M8 2.5 14 5.5 8 8.5 2 5.5z"/><path d="M2 8.5l6 3 6-3"/><path d="M2 11.5l6 3 6-3"/>')],
];

const PROFILES = [
  ["driving", "drive", I('<path d="M2.5 10.8V8.2L4 4.8h8l1.5 3.4v2.6z"/><circle cx="5" cy="11.3" r="1.3"/><circle cx="11" cy="11.3" r="1.3"/>')],
  ["walking", "walk", I('<circle cx="9" cy="2.8" r="1.3"/><path d="M8.3 5.4 6.6 9.2l2.4 1.6-1.2 4.2M8.3 5.4l2.8 2.4M6.6 8 4.4 9.3M9 10.8l2.2 4.2"/>')],
  ["cycling", "cycle", I('<circle cx="3.8" cy="11" r="2.6"/><circle cx="12.2" cy="11" r="2.6"/><path d="M3.8 11 6.6 6h4.2l1.4 5M6.6 6l2.8 5"/>')],
];

const MAP_ACTIONS = [["style", "basemap"], ["zoom", "zoom to level"], ["center", "go to coordinates"], ["terrain", "3D terrain on / off"], ["clear", "clear drawings"], ["locate", "my location"]];
const CLEAR = ["all", "markers", "routes", "lines", "buffers", "isochrones", "polygons"];

// what each tool asks for, in words; keys are the schema's
const FORMS = {
  markers: [{ key: "places", ui: "stops", label: "places", one: "place", min: 1 }],
  route: [{ key: "waypoints", ui: "stops", label: "stops", one: "stop", min: 2 }, { key: "profile", ui: "profile" }],
  line: [{ key: "places", ui: "stops", label: "points", one: "point", min: 2 }],
  buffer: [{ key: "centers", ui: "stops", label: "around", one: "place", min: 1 }, { key: "radius_km", ui: "numbers", label: "radius", suffix: "km", hint: "one value, or one per place" }],
  isochrone: [{ key: "center", ui: "place", label: "from" }, { ui: "reach" }, { key: "profile", ui: "profile" }],
  polygon: [{ key: "vertices", ui: "stops", label: "corners", one: "corner", min: 3 }],
  elevation_profile: [{ key: "waypoints", ui: "stops", label: "along", one: "stop", min: 1, hint: 'two places, or "@selected" for a line you picked' }, { key: "profile", ui: "profile" }],
  boundary: [{ key: "place", ui: "place", label: "region" }],
  map: [{ ui: "mapaction" }],
};

const DEFAULTS = {
  markers: { places: ["Machu Picchu"] },
  route: { waypoints: ["Paris", "Lyon"], profile: "driving" },
  line: { places: ["London", "New York"] },
  buffer: { centers: ["Central Park, New York"], radius_km: [3] },
  isochrone: { center: "Shibuya, Tokyo", unit: "minutes", values: [30], profile: "driving" },
  polygon: { vertices: ["Rome", "Florence", "Venice"] },
  elevation_profile: { waypoints: ["Chamonix", "Zermatt"], profile: "driving" },
  boundary: { place: "Iceland" },
  map: { action: "style", style: "satellite" },
};

const el = (tag, cls, html = "") => Object.assign(document.createElement(tag), { className: cls, innerHTML: html });
const numbers = (s) => s.split(/[,\s]+/).filter(Boolean).map(Number).filter(Number.isFinite);

export function createToolsForm(root, { lookup }) {
  let tool = "isochrone";
  const tiles = root.querySelector("#tiles"), desc = root.querySelector("#desc"), fields = root.querySelector("#fields");

  tiles.append(...TILES.map(([name, label, , icon]) => {
    const b = el("button", "tile", `${icon}<span>${label}</span>`);
    b.type = "button";
    b.dataset.tool = name;
    b.addEventListener("click", () => api.set(name));
    return b;
  }));

  // a place name checked against the geocoder as you leave the field
  function checked(input) {
    const status = el("small", "found");
    const check = async () => {
      const v = input.value.trim();
      status.className = "found";
      if (!v) return (status.textContent = "");
      if (v.startsWith("@")) return (status.textContent = v === "@me" ? "your location" : "the selected feature");
      status.textContent = "checking…";
      const hit = await lookup(v).catch(() => null);
      if (input.value.trim() !== v) return;
      status.textContent = hit ? `✓ ${hit.found}` : "✗ not found";
      status.classList.add(hit ? "ok" : "bad");
    };
    input.addEventListener("change", check);
    if (input.value) check();
    return status;
  }

  const head = (text, hint) => el("div", "flabel", `<span>${text}</span>${hint ? `<i>${hint}</i>` : ""}`);

  function stops(spec, vals = []) {
    const box = el("div", "field stops");
    box.dataset.key = spec.key;
    const list = el("div", "list");
    let dragged = null;
    const add = (v = "") => {
      const row = el("div", "stop", `<span class="grip" title="drag to reorder">⋮⋮</span><input placeholder="${spec.one}"><button type="button" class="x" title="remove">×</button>`);
      const input = row.querySelector("input");
      input.value = v;
      row.append(checked(input));
      row.draggable = true;
      row.addEventListener("dragstart", () => (dragged = row));
      row.addEventListener("dragover", (e) => {
        e.preventDefault();
        if (!dragged || dragged === row) return;
        const after = e.offsetY > row.offsetHeight / 2;
        list.insertBefore(dragged, after ? row.nextSibling : row);
      });
      row.querySelector(".x").addEventListener("click", () => list.children.length > spec.min && row.remove());
      list.append(row);
      return input;
    };
    for (let i = 0; i < Math.max(vals.length, spec.min); i++) add(vals[i] ?? "");
    const more = el("button", "more", `+ add ${spec.one}`);
    more.type = "button";
    more.addEventListener("click", () => add().focus());
    box.append(head(spec.label, spec.hint), list, more);
    return box;
  }

  function place(spec, v = "") {
    const box = el("div", "field place");
    box.dataset.key = spec.key;
    const input = el("input", "");
    input.value = v;
    box.append(head(spec.label), input, checked(input));
    return box;
  }

  function nums(spec, v = []) {
    const box = el("div", "field nums", `<div class="unitrow"><input><b>${spec.suffix}</b></div>`);
    box.dataset.key = spec.key;
    box.querySelector("input").value = v.join(", ");
    box.prepend(head(spec.label, spec.hint));
    return box;
  }

  function reach(args) {
    const box = el("div", "field reach", `<div class="unitrow"><input><select><option value="minutes">min</option><option value="km">km</option></select></div>`);
    box.querySelector("input").value = (args.values ?? []).join(", ");
    box.querySelector("select").value = args.unit ?? "minutes";
    box.prepend(head("reach", "one value, or several for rings: 10, 20, 30"));
    return box;
  }

  function segmented(cls, options, value) {
    const box = el("div", `seg ${cls}`);
    box.dataset.value = value;
    for (const [v, label, icon = ""] of options) {
      const b = el("button", "", `${icon}<span>${label}</span>`);
      b.type = "button";
      b.setAttribute("aria-pressed", v === value);
      b.addEventListener("click", () => {
        box.dataset.value = v;
        for (const o of box.children) o.setAttribute("aria-pressed", o === b);
        box.dispatchEvent(new Event("change"));
      });
      box.append(b);
    }
    return box;
  }

  function profile(spec, v = "driving") {
    const box = el("div", "field profile");
    box.dataset.key = "profile";
    box.append(head("by"), segmented("", PROFILES, v));
    return box;
  }

  function mapaction(args) {
    const box = el("div", "field mapaction");
    const sel = el("select", "", MAP_ACTIONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join(""));
    sel.value = args.action ?? "style";
    const sub = el("div", "sub");
    const draw = () => {
      sub.replaceChildren();
      const a = sel.value;
      if (a === "style") sub.append(segmented("style", [["satellite", "satellite"], ["dark", "dark"], ["street", "street"]], args.style ?? "satellite"));
      if (a === "zoom") sub.append(el("div", "unitrow", `<input type="number" step="any" class="zoom" value="${args.zoom ?? 10}"><b>level</b>`));
      if (a === "center") sub.append(el("div", "unitrow", `<input type="number" step="any" class="lat" placeholder="lat" value="${args.lat ?? ""}"><input type="number" step="any" class="lon" placeholder="lon" value="${args.lon ?? ""}">`));
      if (a === "clear") sub.append(el("select", "clear", CLEAR.map((c) => `<option>${c}</option>`).join("")));
      if (a === "clear" && args.clear) sub.querySelector(".clear").value = args.clear;
    };
    sel.addEventListener("change", draw);
    draw();
    box.append(head("do"), sel, sub);
    return box;
  }

  function render(args) {
    desc.textContent = TILES.find((t) => t[0] === tool)[2];
    for (const b of tiles.children) b.setAttribute("aria-pressed", b.dataset.tool === tool);
    fields.replaceChildren(...FORMS[tool].map((spec) => {
      if (spec.ui === "stops") return stops(spec, args[spec.key]);
      if (spec.ui === "place") return place(spec, args[spec.key]);
      if (spec.ui === "numbers") return nums(spec, args[spec.key]);
      if (spec.ui === "reach") return reach(args);
      if (spec.ui === "profile") return profile(spec, args.profile);
      return mapaction(args);
    }));
  }

  const api = {
    get tool() { return tool; },
    // show a tool; with args it mirrors a call, without it starts from an example
    set(name, args) {
      tool = FORMS[name] ? name : "isochrone";
      render(args ?? DEFAULTS[tool]);
    },
    read() {
      const args = {};
      for (const box of fields.children) {
        const key = box.dataset.key;
        if (box.classList.contains("stops")) args[key] = [...box.querySelectorAll(".stop input")].map((i) => i.value.trim()).filter(Boolean);
        else if (box.classList.contains("place")) { const v = box.querySelector("input").value.trim(); if (v) args[key] = v; }
        else if (box.classList.contains("nums")) args[key] = numbers(box.querySelector("input").value);
        else if (box.classList.contains("reach")) {
          args.values = numbers(box.querySelector("input").value);
          args.unit = box.querySelector("select").value;
        } else if (box.classList.contains("profile")) args.profile = box.querySelector(".seg").dataset.value;
        else if (box.classList.contains("mapaction")) {
          args.action = box.querySelector("select").value;
          const s = box.querySelector(".sub");
          if (args.action === "style") args.style = s.querySelector(".seg").dataset.value;
          if (args.action === "zoom") args.zoom = Number(s.querySelector(".zoom").value);
          if (args.action === "center") (args.lat = Number(s.querySelector(".lat").value)), (args.lon = Number(s.querySelector(".lon").value));
          if (args.action === "clear") args.clear = s.querySelector(".clear").value;
        }
      }
      return { tool, args };
    },
  };
  return api;
}

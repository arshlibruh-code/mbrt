// The TOOL tab: the same tools Theo calls, as a form in plain words. It reads and writes exactly the schema's
// arguments, so a call Theo made can be mirrored in, edited and run again by hand. Places can be picked on the map,
// found places show as ghost pins (onGhosts), and the Run button reads out the call it will make.

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
];
export const TOOL_ICONS = Object.fromEntries(TILES.map(([name, , , icon]) => [name, icon]));
const AIM = I('<circle cx="8" cy="8" r="4.2"/><path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3"/>');

const PROFILES = [
  ["driving", "drive", I('<path d="M2.5 10.8V8.2L4 4.8h8l1.5 3.4v2.6z"/><circle cx="5" cy="11.3" r="1.3"/><circle cx="11" cy="11.3" r="1.3"/>')],
  ["walking", "walk", I('<circle cx="9" cy="2.8" r="1.3"/><path d="M8.3 5.4 6.6 9.2l2.4 1.6-1.2 4.2M8.3 5.4l2.8 2.4M6.6 8 4.4 9.3M9 10.8l2.2 4.2"/>')],
  ["cycling", "cycle", I('<circle cx="3.8" cy="11" r="2.6"/><circle cx="12.2" cy="11" r="2.6"/><path d="M3.8 11 6.6 6h4.2l1.4 5M6.6 6l2.8 5"/>')],
];


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
};

const el = (tag, cls, html = "") => Object.assign(document.createElement(tag), { className: cls, innerHTML: html });
const numbers = (s) => s.split(/[,\s]+/).filter(Boolean).map(Number).filter(Number.isFinite);

export function createToolsForm(root, { lookup, describe, pickOnMap, onGhosts }) {
  let tool = "isochrone", from = "", touched = false;
  const tiles = root.querySelector("#tiles"), desc = root.querySelector("#desc"), fields = root.querySelector("#fields"), run = root.querySelector("#run");

  tiles.append(...TILES.map(([name, label, , icon], i) => {
    const b = el("button", "tile", icon);
    b.type = "button";
    b.dataset.tool = name;
    b.title = `${label}  (${i + 1})`;
    b.setAttribute("aria-label", label);
    b.addEventListener("click", () => api.set(name));
    return b;
  }));

  // the Run button says the call it will make; a call mirrored from Theo reads "run again" until you edit it
  function syncRun() {
    const call = api.read();
    run.textContent = `${from && !touched ? "Run again" : "Run"} · ${describe(call).replace(/^[^·]+· /, "")}`;
    const [, label, words] = TILES.find((t) => t[0] === tool);
    desc.innerHTML = `<b>${label}</b> ${words.toLowerCase()}${from ? `<em>${touched ? "edited from" : "from"} ${from}</em>` : ""}`;
  }
  const changed = () => ((touched = true), syncRun());
  fields.addEventListener("input", changed);
  fields.addEventListener("change", changed);

  // found places show on the map as ghost pins while you edit
  const found = new Map();
  const ghosts = () => onGhosts([...found].filter(([input]) => input.isConnected).map(([, c]) => c));

  // a place name checked against the geocoder as you leave the field
  function checked(input) {
    const status = el("small", "found");
    const check = async () => {
      const v = input.value.trim();
      status.className = "found";
      found.delete(input);
      ghosts();
      if (!v) return (status.textContent = "");
      if (v.startsWith("@")) return (status.textContent = v === "@me" ? "your location" : "the selected feature");
      status.textContent = "checking…";
      const hit = await lookup(v).catch(() => null);
      if (input.value.trim() !== v) return;
      status.textContent = hit ? `✓ ${hit.found}` : "✗ not found";
      status.classList.add(hit ? "ok" : "bad");
      if (hit) found.set(input, hit.coord), ghosts();
    };
    input.addEventListener("change", check);
    if (input.value) check();
    return status;
  }
  // the crosshair beside a place: the next click on the map fills it with the place there
  function aim(input) {
    const b = el("button", "aim", AIM);
    b.type = "button";
    b.title = "pick on the map";
    b.addEventListener("click", async () => {
      b.setAttribute("aria-pressed", true);
      const name = await pickOnMap().catch(() => "");
      b.setAttribute("aria-pressed", false);
      if (!name) return;
      input.value = name;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    return b;
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
      input.after(aim(input));
      row.append(checked(input));
      row.draggable = true;
      row.addEventListener("dragstart", () => (dragged = row));
      row.addEventListener("dragover", (e) => {
        e.preventDefault();
        if (!dragged || dragged === row) return;
        const after = e.offsetY > row.offsetHeight / 2;
        list.insertBefore(dragged, after ? row.nextSibling : row);
      });
      row.addEventListener("dragend", changed);
      row.querySelector(".x").addEventListener("click", () => list.children.length > spec.min && (row.remove(), ghosts(), changed()));
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
    const row = el("div", "unitrow");
    row.append(input, aim(input));
    box.append(head(spec.label), row, checked(input));
    return box;
  }

  // numbers as chips: type and press enter, space or comma; backspace on an empty field takes the last one back
  function numChips(values, suffix, sorted = false) {
    const box = el("div", "numchips");
    const input = Object.assign(el("input", "nadd"), { placeholder: "+ add", inputMode: "decimal" });
    const add = (n) => {
      const c = el("button", "nchip", `${n}<i>×</i>`);
      c.type = "button";
      c.dataset.v = n;
      c.title = "remove";
      c.addEventListener("click", () => (c.remove(), changed()));
      const after = sorted && [...box.querySelectorAll(".nchip")].find((o) => Number(o.dataset.v) > n);
      box.insertBefore(c, after || input);
    };
    const commit = () => {
      if (!input.value.trim()) return;
      numbers(input.value).forEach(add);
      input.value = "";
      changed();
    };
    input.addEventListener("keydown", (e) => {
      if (["Enter", ",", " "].includes(e.key)) e.preventDefault(), commit();
      else if (e.key === "Backspace" && !input.value) [...box.querySelectorAll(".nchip")].at(-1)?.remove(), changed();
    });
    input.addEventListener("blur", commit);
    box.append(input, el("b", "", suffix));
    values.forEach(add);
    return box;
  }
  const chipValues = (box) => [...box.querySelectorAll(".nchip")].map((c) => Number(c.dataset.v)).concat(numbers(box.querySelector(".nadd").value));

  function nums(spec, v = []) {
    const box = el("div", "field nums");
    box.dataset.key = spec.key;
    box.append(head(spec.label, spec.hint), numChips(v, spec.suffix));
    return box;
  }

  function reach(args) {
    const box = el("div", "field reach");
    const unit = segmented("unit", [["minutes", "min"], ["km", "km"]], args.unit ?? "minutes");
    const row = el("div", "unitrow");
    row.append(numChips(args.values ?? [], "", true), unit);
    box.append(head("reach", "several values draw rings"), row);
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
        box.dispatchEvent(new Event("change", { bubbles: true }));
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

  function render(args) {
    found.clear();
    for (const b of tiles.children) b.setAttribute("aria-pressed", b.dataset.tool === tool);
    fields.replaceChildren(...FORMS[tool].map((spec) => {
      if (spec.ui === "stops") return stops(spec, args[spec.key]);
      if (spec.ui === "place") return place(spec, args[spec.key]);
      if (spec.ui === "numbers") return nums(spec, args[spec.key]);
      if (spec.ui === "reach") return reach(args);
      return profile(spec, args.profile);
    }));
    ghosts();
    syncRun();
  }

  const api = {
    get tool() { return tool; },
    // show a tool; with args it mirrors a call (`by` says whose, e.g. Theo), without it starts from an example
    set(name, args, by = "") {
      if (!FORMS[name]) return;
      tool = name;
      from = args ? by : "";
      touched = false;
      render(args ?? DEFAULTS[tool]);
    },
    pick: (i) => TILES[i] && api.set(TILES[i][0]),
    clearGhosts: () => onGhosts([]),
    showGhosts: ghosts,
    read() {
      const args = {};
      for (const box of fields.children) {
        const key = box.dataset.key;
        if (box.classList.contains("stops")) args[key] = [...box.querySelectorAll(".stop input")].map((i) => i.value.trim()).filter(Boolean);
        else if (box.classList.contains("place")) { const v = box.querySelector("input").value.trim(); if (v) args[key] = v; }
        else if (box.classList.contains("nums")) args[key] = chipValues(box);
        else if (box.classList.contains("reach")) {
          args.values = chipValues(box);
          args.unit = box.querySelector(".seg.unit").dataset.value;
        } else if (box.classList.contains("profile")) args.profile = box.querySelector(".seg").dataset.value;
      }
      return { tool, args };
    },
  };
  return api;
}

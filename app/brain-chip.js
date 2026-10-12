// The brain chip under the chat input: who answers, at a glance. Click for a small menu to switch brain or model;
// hover for this session's usage. Keys and sign-ins stay in the panel's BRAIN tab ("manage").
import * as brain from "./brain.js";

const el = (tag, cls, html = "") => Object.assign(document.createElement(tag), { className: cls, innerHTML: html });
const price = (m) => (Number.isFinite(m.price) ? (m.price === 0 ? " · free" : ` · $${(m.price * 1e6).toFixed(2)}/M`) : "");
const ROWS = [["shared", "Shared"], ["openrouter", "OpenRouter"], ["key", "Your key"], ["chatgpt", "ChatGPT"]];

export function createBrainChip(chip, pop, { manage, changed }) {
  let chatgptIn = false, flashTimer = 0;
  const lists = {}; // model lists, fetched once per brain when the menu first needs them

  function sync() {
    if (flashTimer) return;
    const [who, model] = brain.short();
    chip.querySelector("span").textContent = `${who} · ${model}`;
    chip.classList.toggle("own", brain.get().use !== "shared");
    const t = brain.tally();
    chip.title = `this session: ${t.requests} request${t.requests === 1 ? "" : "s"} · ${brain.tokens(t.in + t.out)} tokens${t.cost != null ? ` · ${brain.usd(t.cost)}` : ""}`;
  }
  brain.onTally(sync);

  // a short message in the chip itself, then back to the brain: cyan for a sign-in, red for a failed one
  function flash(text, ok) {
    clearTimeout(flashTimer);
    chip.querySelector("span").textContent = text;
    chip.classList.remove("flash-ok", "flash-bad");
    void chip.offsetWidth;
    chip.classList.add(ok ? "flash-ok" : "flash-bad");
    flashTimer = setTimeout(() => ((flashTimer = 0), chip.classList.remove("flash-ok", "flash-bad"), sync()), ok ? 2400 : 5000);
  }

  const ready = (v, st) => v === "shared" || (v === "openrouter" && st.openrouter?.key) || (v === "key" && st.key?.key) || (v === "chatgpt" && chatgptIn);
  const modelsFor = async (v, st) => {
    if (v === "openrouter") return (lists.openrouter ??= (await brain.models("openrouter", st.openrouter.key)).list);
    if (v === "key") return (lists[`key:${st.key.key.slice(-6)}`] ??= (await brain.models(st.key.provider, st.key.key)).list);
    if (v === "chatgpt") return (lists.chatgpt ??= (await brain.chatgptModels()).list);
    return [];
  };
  const setModel = (v, model) => {
    const st = brain.get();
    if (v === "openrouter") brain.set({ openrouter: { ...st.openrouter, model } });
    if (v === "key") brain.set({ key: { ...st.key, model } });
    if (v === "chatgpt") brain.set({ chatgpt: { model } });
    sync();
    changed();
  };

  async function render() {
    const st = brain.get();
    pop.replaceChildren(...ROWS.map(([v, name]) => {
      const row = el("button", `pop-row${st.use === v ? " on" : ""}`, `<span>${name}</span><i>${st.use === v ? "✓" : ready(v, st) ? "" : v === "chatgpt" && !brain.chatgptHere ? "local only" : "set up →"}</i>`);
      row.type = "button";
      row.addEventListener("click", () => {
        if (!ready(v, st)) return close(), manage(v);
        brain.set({ use: v });
        sync();
        changed();
        if (v === "shared") close(); // nothing more to choose; the others stay open on their model list
        else render();
      });
      return row;
    }));
    if (st.use !== "shared") {
      const sel = el("select", "pop-model", `<option>loading models...</option>`);
      pop.append(sel);
      modelsFor(st.use, st).then((list) => {
        const cur = brain.short()[2];
        sel.replaceChildren(...list.map((m) => Object.assign(document.createElement("option"), { value: m.id, textContent: (m.name ?? m.id) + price(m), selected: m.id === cur })));
      }).catch((err) => (sel.innerHTML = `<option>${err.message}</option>`));
      sel.addEventListener("change", () => setModel(st.use, sel.value));
    }
    const more = el("button", "pop-manage", "manage keys and sign-ins");
    more.type = "button";
    more.addEventListener("click", () => (close(), manage(st.use)));
    pop.append(more);
  }

  const close = () => ((pop.hidden = true), chip.setAttribute("aria-expanded", false));
  chip.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!pop.hidden) return close();
    if (brain.chatgptHere) chatgptIn = (await brain.chatgptStatus()).signedIn;
    pop.hidden = false;
    chip.setAttribute("aria-expanded", true);
    render();
  });
  pop.addEventListener("click", (e) => e.stopPropagation());
  addEventListener("click", close);
  addEventListener("keydown", (e) => e.key === "Escape" && close());

  sync();
  return { sync, flash };
}

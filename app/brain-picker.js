// The BRAIN tab of the panel: which model answers, and whose account pays for it. onChange fires when the brain or model changes.
import * as brain from "./brain.js";

const el = (tag, cls, html = "") => Object.assign(document.createElement(tag), { className: cls, innerHTML: html });
const TABS = [["shared", "shared"], ["openrouter", "openrouter"], ["key", "your key"], ["chatgpt", "chatgpt"]];
const price = (m) => (Number.isFinite(m.price) ? (m.price === 0 ? "  free" : `  $${(m.price * 1e6).toFixed(2)}/M`) : "");

export function createBrainPicker(root, { onChange }) {
  let open = brain.get().use;
  root.innerHTML = `<div class="seg"></div><div class="brain-pane"></div><div class="tally"></div>`;
  const seg = root.querySelector(".seg"), pane = root.querySelector(".brain-pane"), tallyEl = root.querySelector(".tally");
  // this session's use of the brain in use, updated after every answer
  const showTally = (t = brain.tally()) =>
    (tallyEl.innerHTML = `<span>this session</span><b>${t.requests}</b> request${t.requests === 1 ? "" : "s"} · <b>${brain.tokens(t.in + t.out)}</b> tokens${t.cost != null ? ` · <b>${brain.usd(t.cost)}</b>` : ""}`);
  brain.onTally(showTally);
  const spend = async (key) => {
    const line = note("checking spend...");
    brain.openrouterSpend(key).then((s) => {
      line.innerHTML = `account: <b>${brain.usd(s.today)}</b> today · <b>${brain.usd(s.total)}</b> all time · ${s.left == null ? "no limit on this key" : `<b>${brain.usd(s.left)}</b> left`}`;
    }).catch((err) => (line.textContent = `spend unavailable: ${err.message}`));
    return line;
  };

  const sync = () => {
    onChange();
    showTally();
    for (const b of seg.children) b.setAttribute("aria-pressed", b.dataset.value === open);
  };
  const use = (v) => (brain.set({ use: v }), sync());
  seg.append(...TABS.map(([v, text]) => {
    const b = el("button", "", text);
    b.type = "button";
    b.dataset.value = v;
    b.addEventListener("click", () => ((open = v), render()));
    return b;
  }));

  const note = (text, cls = "") => el("small", `found ${cls}`, text);
  const button = (text, fn) => Object.assign(el("button", "brain-btn", text), { type: "button", onclick: fn });
  // a model list, the chosen one selected; changing it saves straight away
  function chooser(list, value, save) {
    const s = el("select", "");
    s.append(...list.map((m) => Object.assign(document.createElement("option"), { value: m.id, textContent: (m.name ?? m.id) + price(m), selected: m.id === value })));
    s.addEventListener("change", () => save(s.value));
    return s;
  }

  async function render() {
    pane.replaceChildren();
    const st = brain.get();
    if (open === "shared") {
      use("shared");
      pane.append(note("Free, on our Groq. Everyone shares one limit, so Theo may ask you to wait."));
      return sync();
    }
    if (open === "openrouter") {
      if (!st.openrouter?.key) {
        pane.append(button("Sign in with OpenRouter", brain.openrouterSignIn), note("One click. Any model, billed to your OpenRouter account."));
        return sync();
      }
      use("openrouter");
      const status = note("checking your models...");
      pane.append(status);
      try {
        const { list } = await brain.models("openrouter", st.openrouter.key);
        status.replaceWith(chooser(list, st.openrouter.model, (model) => (brain.set({ openrouter: { ...brain.get().openrouter, model } }), sync())),
          note(`✓ signed in, ${list.length} models that can call tools, cheapest first`, "ok"), await spend(st.openrouter.key));
      } catch (err) {
        status.textContent = `✗ ${err.message}`;
        status.className = "found bad";
      }
      pane.append(button("sign out", () => (brain.set({ use: "shared", openrouter: null }), (open = "shared"), render())));
      return sync();
    }
    if (open === "key") {
      const input = Object.assign(el("input", ""), { type: "password", placeholder: "paste an API key", value: st.key?.key ?? "", spellcheck: false });
      const status = note(st.key?.key ? "" : "Groq, Anthropic, OpenAI, Gemini or OpenRouter. It stays in this browser.");
      const slot = el("div", "");
      pane.append(input, status, slot);
      const check = async () => {
        const key = input.value.trim(), provider = brain.detect(key);
        slot.replaceChildren();
        if (!key) return;
        if (!provider) return (status.textContent = "✗ not a key I recognise"), (status.className = "found bad");
        status.textContent = "checking...";
        status.className = "found";
        try {
          const { list, pick } = await brain.models(provider, key);
          const model = brain.get().key?.key === key ? brain.get().key.model : pick;
          brain.set({ key: { provider, key, model } });
          use("key");
          status.textContent = `✓ ${brain.nameOf(provider)} key works, ${list.length} models`;
          status.className = "found ok";
          slot.append(chooser(list, model, (m) => (brain.set({ key: { ...brain.get().key, model: m } }), sync())),
            provider === "openrouter" ? await spend(key) : note(`${brain.nameOf(provider)} doesn't share spend with browser apps; tokens are counted below, money is on your ${brain.nameOf(provider)} dashboard.`),
            button("forget key", () => (brain.set({ use: "shared", key: null }), (open = "shared"), render())));
        } catch (err) {
          status.textContent = `✗ ${err.message}`;
          status.className = "found bad";
        }
      };
      input.addEventListener("change", check);
      input.addEventListener("paste", () => setTimeout(check));
      if (st.key?.key) check();
      return sync();
    }
    if (open === "chatgpt") {
      if (!brain.chatgptHere) {
        pane.append(note("Only when you run mbrt on your own machine for now. The hosted site needs OpenAI's approval first."));
        return sync();
      }
      const s = await brain.chatgptStatus();
      if (!s.signedIn) {
        pane.append(button("Sign in with ChatGPT", brain.chatgptSignIn), note("Uses your ChatGPT plan's allowance. The sign-in stays on this machine."));
        return sync();
      }
      try {
        const { list, pick } = await brain.chatgptModels();
        const model = brain.get().chatgpt?.model ?? pick;
        brain.set({ chatgpt: { model } });
        use("chatgpt");
        pane.append(chooser(list, model, (m) => (brain.set({ chatgpt: { model: m } }), sync())), note(`✓ signed in${s.email ? ` as ${s.email}` : ""}`, "ok"),
          note(`This spends your plan's allowance, not money. OpenAI doesn't tell apps how much is left, so check your limits in <a href="https://chatgpt.com" target="_blank" rel="noopener">ChatGPT's settings</a>. The light tier (luna) spends the least.`));
      } catch (err) {
        pane.append(note(`✗ ${err.message}`, "bad"));
      }
      pane.append(button("sign out", async () => (await brain.chatgptSignOut(), brain.set({ use: "shared" }), (open = "shared"), render())));
      return sync();
    }
  }

  render();
  return { refresh: () => ((open = brain.get().use), render()), show: (v) => ((open = v), render()) };
}

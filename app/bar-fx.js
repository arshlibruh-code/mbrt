// Shader layer behind the chat bar: contours in a glass slab, driven by one state machine.
// States: idle, typing, thinking, done, error. Each drives a uniform that eases toward its target,
// so every change is a physical blend, never a cut. It draws every frame only while something moves,
// drops to ~5 fps when idle (MapLibre shares the GPU), stops when the tab is hidden, and shows a
// still frame under prefers-reduced-motion.

const COMMON = `#version 300 es
precision highp float;
uniform vec2 u_res;
uniform float u_time, u_flow, u_think, u_done, u_err, u_type, u_focus, u_caret, u_ring, u_collapse;
uniform vec3 u_keys[16]; // x in 0..1 across the bar, unused, time of the key
out vec4 o;
const vec3 CYAN = vec3(0.031, 0.608, 0.875);
const vec3 RED = vec3(0.72, 0.34, 0.29);
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
float aspect() { return u_res.x / u_res.y; }
vec2 keyPos(vec3 k) { return vec2((k.x - 0.5) * aspect(), 0.0); }
float edgeFade(vec2 uv) { return smoothstep(0.0, 0.12, uv.x) * smoothstep(1.0, 0.88, uv.x); }
`;

// contour lines inside a glass slab: the terrain isolines carry the meaning (thinking grows an isochrone),
// the rim light along the top edge carries the state (it brightens at the caret, a bead runs along it while thinking)
const FRAG = `
void main() {
  vec2 uv = gl_FragCoord.xy / u_res, p = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  float fade = edgeFade(uv);

  // contours: terrain height, with mass where keys were pressed
  // error: a fault through the center; the two sides slip past each other, then heal
  float seamX = (noise(vec2(p.y * 9.0, 4.0)) - 0.5) * 0.03;
  float side = sign(p.x - seamX);
  vec2 pc = p + vec2(0.0, side * u_err * 0.07);
  float h = fbm(pc * 1.5 + vec2(u_flow * 0.05, u_flow * 0.02));
  for (int i = 0; i < 16; i++) {
    float age = u_time - u_keys[i].z;
    if (u_keys[i].z <= 0.0 || age < 0.0 || age > 5.0) continue;
    vec2 dc = pc - keyPos(u_keys[i]);
    h += 0.45 * exp(-dot(dc, dc) * 16.0) * exp(-age * 0.8);
  }
  // rings grow while thinking; on a failure they fall back into the center and fade
  float iso = (length(pc * vec2(1.0, 1.7)) + (h - 0.5) * 0.4) * 5.0 - u_ring;
  float ringW = max(u_think, u_collapse);
  float f = mix(h * 8.0, iso, ringW);
  float line = 1.0 - min(abs(fract(f - 0.5) - 0.5) / fwidth(f), 1.0);
  float major = 1.0 - min(abs(fract(f / 5.0 - 0.5) - 0.5) / fwidth(f / 5.0), 1.0);
  float front = ringW * exp(-pow(fract(iso) - 0.98, 2.0) * 400.0);
  float seam = u_err * exp(-abs(p.x - seamX) * u_res.y / 1.5) * smoothstep(0.5, 0.1, abs(p.y));
  float text = 1.0 - 0.45 * exp(-p.y * p.y * 50.0) * exp(-p.x * p.x * 1.4); // calmer behind the words
  float aLine = ((line * 0.55 + major * 0.45) * (0.06 + 0.05 * u_focus + 0.26 * u_think + 0.16 * u_collapse + 0.34 * u_done + 0.06 * u_err) + front * 0.3 * (1.0 - u_err * 0.5)) * text * fade + seam * 0.45;
  // status colour lives in the rim only; the contours stay neutral on error
  vec3 lineCol = mix(vec3(0.92, 0.94, 0.96), CYAN, clamp(max(u_think, u_collapse * 0.6) * 0.9 + u_done * 0.5, 0.0, 1.0) * (1.0 - u_err * 0.7));

  // glass: a fresnel-like rim on the top edge, light spilling a little into the slab
  float dTop = u_res.y - gl_FragCoord.y;
  float rim = exp(-dTop / 1.4) * 0.55 + exp(-dTop / 16.0) * 0.08 + exp(-gl_FragCoord.y / 24.0) * 0.04;
  float cx = (uv.x - u_caret) * aspect();
  rim += u_type * exp(-cx * cx * 30.0) * (exp(-dTop / 2.5) * 1.3 + exp(-dTop / 26.0) * 0.18);
  float bead = 0.0;
  for (int i = 0; i < 10; i++) {
    float bx = 0.5 + 0.46 * sin((u_time - float(i) * 0.035) * 1.25);
    float dx = (uv.x - bx) * aspect();
    bead += exp(-float(i) * 0.42) * exp(-dx * dx * 140.0);
  }
  rim += u_think * bead * (exp(-dTop / 2.2) * 1.4 + exp(-dTop / 34.0) * 0.22);
  rim += u_done * (exp(-dTop / 4.0) * 0.9 + exp(-dTop / 40.0) * 0.12);
  // error: the rim's light drains from both ends toward the center and holds there as a slow red ember
  float ember = exp(-pow((uv.x - 0.5) * aspect(), 2.0) * 0.35);
  rim *= mix(1.0, ember * (0.85 + 0.15 * sin(u_time * 3.0)) * 1.5, u_err);
  float aRim = clamp(rim, 0.0, 1.0) * (0.75 + 0.25 * fade);
  vec3 rimCol = mix(mix(vec3(0.95, 0.97, 1.0), CYAN, clamp(u_think * bead * 0.8 + u_done * 0.4, 0.0, 1.0)), RED, u_err);

  // rim over lines, premultiplied
  vec4 ln = vec4(lineCol * aLine, aLine), rm = vec4(rimCol * aRim, aRim);
  o = rm + ln * (1.0 - rm.a);
}`;

const VERT = `#version 300 es
in vec2 pos;
void main() { gl_Position = vec4(pos, 0.0, 1.0); }`;

export function createBarFx(canvas, host) {
  const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, alpha: true, antialias: false });
  if (!gl) return { state() {}, key() {}, focus() {} };

  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const program = (frag) => {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, frag));
    gl.bindAttribLocation(p, 0, "pos");
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    for (let i = 0; i < gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i++) {
      const name = gl.getActiveUniform(p, i).name.replace("[0]", "");
      u[name] = gl.getUniformLocation(p, name);
    }
    return { p, u };
  };
  const { p: prog, u } = program(COMMON + FRAG);

  // one triangle that covers the screen
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  // ---- state: targets, eased values, keystrokes

  const target = { think: 0, done: 0, err: 0, focus: 0, collapse: 0 };
  const val = { think: 0, done: 0, err: 0, focus: 0, type: 0, collapse: 0 };
  let ring = 0; // isochrone ring phase: grows while thinking, runs backwards when a request fails
  const keys = new Float32Array(16 * 3);
  let keyIdx = 0, caret = 0.5, flow = 0, last = performance.now(), t0 = last, timer = 0, raf = 0;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    const w = Math.max(1, Math.round(host.clientWidth * dpr)), h = Math.max(1, Math.round(host.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }
  new ResizeObserver(() => (resize(), wake())).observe(host);

  const settled = () => Object.keys(target).every((k) => Math.abs(val[k] - target[k]) < 0.002) && val.type < 0.002;
  const recentKeys = (t) => { for (let i = 0; i < 16; i++) if (keys[i * 3 + 2] > 0 && t - keys[i * 3 + 2] < 5) return true; return false; };

  function frame() {
    raf = 0;
    const now = performance.now(), dt = Math.min((now - last) / 1000, 0.1), t = (now - t0) / 1000;
    last = now;
    // springs toward the targets; done and error decay back to idle on their own
    const ease = (k, rate) => (val[k] += (target[k] - val[k]) * Math.min(1, dt * rate));
    ease("think", 5);
    ease("done", 6);
    ease("err", 7);
    ease("focus", 4);
    ease("collapse", 3);
    ring += dt * (0.9 * val.think - 3.2 * val.collapse);
    val.type *= Math.exp(-dt * 2.2);
    flow += dt * (1 - 0.85 * val.done); // terrain flow slows as a result lands

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(prog);
    gl.uniform2f(u.u_res, canvas.width, canvas.height);
    gl.uniform1f(u.u_time, t);
    gl.uniform1f(u.u_flow, flow);
    gl.uniform1f(u.u_think, val.think);
    gl.uniform1f(u.u_done, val.done);
    gl.uniform1f(u.u_err, val.err);
    gl.uniform1f(u.u_type, val.type);
    gl.uniform1f(u.u_focus, val.focus);
    gl.uniform1f(u.u_caret, caret);
    gl.uniform1f(u.u_ring, ring);
    gl.uniform1f(u.u_collapse, val.collapse);
    gl.uniform3fv(u.u_keys, keys);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    schedule(t);
  }

  function schedule(t) {
    clearTimeout(timer);
    if (document.hidden || reduced) return;
    const busy = target.think > 0 || target.done > 0 || target.err > 0 || !settled() || recentKeys(t);
    if (busy) raf = requestAnimationFrame(frame);
    else timer = setTimeout(() => (raf = requestAnimationFrame(frame)), 200); // idle drift at ~5 fps
  }
  function wake() {
    clearTimeout(timer);
    if (!raf) raf = requestAnimationFrame(frame);
  }
  document.addEventListener("visibilitychange", () => !document.hidden && wake());

  let back = 0;
  const api = {
    // idle | typing | thinking | done | error; done and error fall back to idle by themselves
    state(s) {
      clearTimeout(back);
      target.think = s === "thinking" ? 1 : 0;
      target.done = s === "done" ? 1 : 0;
      target.err = s === "error" ? 1 : 0;
      target.collapse = s === "error" && val.think > 0.3 ? 1 : 0; // only a failure mid-thought has rings to pull back
      if (s === "typing") target.focus = 1;
      if (s === "done" || s === "error") back = setTimeout(() => api.state("idle"), s === "done" ? 1600 : 2200);
      wake();
    },
    focus(on) {
      target.focus = on ? 1 : 0;
      wake();
    },
    // a keystroke at x (0..1 across the bar)
    key(x) {
      caret = x;
      const t = (performance.now() - t0) / 1000;
      keys.set([x, 0, t], keyIdx * 3);
      keyIdx = (keyIdx + 1) % 16;
      val.type = Math.min(1, val.type + 0.35);
      wake();
    },
  };
  resize();
  wake();
  return api;
}

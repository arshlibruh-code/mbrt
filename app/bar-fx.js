// Shader layer behind the chat bar: contours over ink, driven by one state machine.
// States: idle, typing, thinking, done, error. Each drives a uniform that eases toward its target,
// so every change is a physical blend, never a cut. It draws every frame only while something moves,
// drops to ~5 fps when idle (MapLibre shares the GPU), stops when the tab is hidden, and shows a
// still frame under prefers-reduced-motion.

const COMMON = `#version 300 es
precision highp float;
uniform vec2 u_res;
uniform float u_time, u_flow, u_think, u_done, u_err, u_type, u_focus, u_caret;
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

// contour lines over ink: the terrain isolines carry the meaning (thinking grows an isochrone),
// the smoke underneath carries the feel (puffs from keystrokes, a vortex while thinking)
const FRAG = `
void main() {
  vec2 uv = gl_FragCoord.xy / u_res, p = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  float fade = edgeFade(uv);

  // ink: domain-warped smoke, pulled into a vortex around the center while thinking
  vec2 ps = p;
  ps.y *= 1.0 + u_done * 1.5; // settles flat when a result lands
  float r = length(ps);
  float ang = u_think * 0.9 / (r + 0.18) * u_time * 0.35;
  vec2 c = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * ps;
  vec2 q = c * 1.9 + vec2(0.0, -u_flow * 0.14);
  vec2 w = vec2(fbm(q + vec2(1.7, 9.2) + u_flow * 0.05), fbm(q + vec2(8.3, 2.8) - u_flow * 0.04));
  float smoke = smoothstep(0.42, 0.86, fbm(q + w * 1.7 * (1.0 + u_err * 2.5))) * mix(smoothstep(1.05, 0.1, uv.y), 1.0, u_think);

  // contours: terrain height, with mass where keys were pressed
  vec2 pc = p;
  pc.x += u_err * 0.035 * sin(pc.y * 70.0 + u_time * 45.0); // shear on error
  float h = fbm(pc * 1.5 + vec2(u_flow * 0.05, u_flow * 0.02));
  for (int i = 0; i < 16; i++) {
    float age = u_time - u_keys[i].z;
    if (u_keys[i].z <= 0.0 || age < 0.0 || age > 5.0) continue;
    vec2 kp = keyPos(u_keys[i]);
    vec2 dc = pc - kp;
    h += 0.45 * exp(-dot(dc, dc) * 16.0) * exp(-age * 0.8);
    vec2 pos = kp + vec2(0.0, -0.3 + age * 0.13);
    float s = 0.05 + age * 0.06;
    vec2 dd = p - pos;
    smoke += 0.9 * exp(-dot(dd, dd) / (s * s)) * exp(-age * 0.75) * (0.55 + 0.45 * fbm(p * 9.0 + age));
  }
  float iso = (length(pc * vec2(1.0, 1.7)) + (h - 0.5) * 0.4 + (w.x - 0.5) * 0.12 * u_think) * 5.0 - u_flow * 0.9;
  float f = mix(h * 8.0, iso, u_think);
  float line = 1.0 - min(abs(fract(f - 0.5) - 0.5) / fwidth(f), 1.0);
  float major = 1.0 - min(abs(fract(f / 5.0 - 0.5) - 0.5) / fwidth(f / 5.0), 1.0);
  float front = u_think * exp(-pow(fract(iso) - 0.98, 2.0) * 400.0);

  // keep the band behind the text calmer so the words stay readable
  float text = 1.0 - 0.6 * exp(-p.y * p.y * 50.0) * exp(-p.x * p.x * 1.4);
  float core = u_think * exp(-r * r * 16.0) * (0.75 + 0.25 * sin(u_time * 2.2));
  float aInk = clamp(smoke * (0.12 + 0.16 * u_focus + 0.28 * u_think) * (1.0 - u_done * 0.6) * text + core * 0.35, 0.0, 1.0);
  float aLine = (line * 0.55 + major * 0.45) * (0.13 + 0.1 * u_focus + 0.45 * u_think + 0.6 * u_done + 0.25 * u_err) + front * 0.5;

  vec3 inkCol = mix(vec3(0.86, 0.9, 0.95), CYAN, clamp(u_think * 0.5 + core * 1.5, 0.0, 1.0));
  vec3 lineCol = mix(vec3(0.92, 0.94, 0.96), CYAN, clamp(u_think * 0.9 + u_done * 0.5, 0.0, 1.0));
  inkCol = mix(inkCol, RED, u_err);
  lineCol = mix(lineCol, RED, u_err);
  // lines over smoke, premultiplied
  vec4 ink = vec4(inkCol * aInk, aInk), ln = vec4(lineCol * aLine, aLine);
  o = (ln + ink * (1.0 - ln.a)) * fade;
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

  const target = { think: 0, done: 0, err: 0, focus: 0 };
  const val = { think: 0, done: 0, err: 0, focus: 0, type: 0 };
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

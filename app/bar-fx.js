// Shader layer behind the chat bar: five variants, one state machine.
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

const VARIANTS = [
  {
    name: "contours",
    // terrain isolines; keystrokes add mass; thinking grows isochrone rings from the center
    frag: `
void main() {
  vec2 uv = gl_FragCoord.xy / u_res, p = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  p.x += u_err * 0.035 * sin(p.y * 70.0 + u_time * 45.0);
  float h = fbm(p * 1.5 + vec2(u_flow * 0.05, u_flow * 0.02));
  for (int i = 0; i < 16; i++) {
    float age = u_time - u_keys[i].z;
    if (u_keys[i].z <= 0.0 || age < 0.0 || age > 5.0) continue;
    vec2 d = p - keyPos(u_keys[i]);
    h += 0.45 * exp(-dot(d, d) * 16.0) * exp(-age * 0.8);
  }
  float r = length(p * vec2(1.0, 1.7)) + (h - 0.5) * 0.4;
  float iso = r * 5.0 - u_flow * 0.9;
  float f = mix(h * 8.0, iso, u_think);
  float g = abs(fract(f - 0.5) - 0.5) / fwidth(f);
  float line = 1.0 - min(g, 1.0);
  float major = 1.0 - min(abs(fract(f / 5.0 - 0.5) - 0.5) / fwidth(f / 5.0), 1.0);
  float front = u_think * exp(-pow(fract(iso) - 0.98, 2.0) * 400.0);
  float a = (line * 0.55 + major * 0.45) * (0.10 + 0.08 * u_focus + 0.45 * u_think + 0.6 * u_done) + front * 0.5;
  vec3 col = mix(vec3(0.9, 0.93, 0.95), CYAN, clamp(u_think * 0.9 + u_done * 0.5, 0.0, 1.0));
  col = mix(col, RED, u_err);
  a *= edgeFade(uv);
  o = vec4(col * a, a);
}`,
  },
  {
    name: "ink",
    // smoke rising through water; keys release puffs at the caret; thinking pulls it into a vortex
    frag: `
void main() {
  vec2 uv = gl_FragCoord.xy / u_res, p = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  p.y *= 1.0 + u_done * 1.5;
  float r = length(p);
  float ang = u_think * 0.9 / (r + 0.18) * u_time * 0.35;
  vec2 c = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * p;
  vec2 q = c * 1.9 + vec2(0.0, -u_flow * 0.14);
  vec2 w = vec2(fbm(q + vec2(1.7, 9.2) + u_flow * 0.05), fbm(q + vec2(8.3, 2.8) - u_flow * 0.04));
  float d = fbm(q + w * 1.7 * (1.0 + u_err * 2.5));
  d = smoothstep(0.42, 0.86, d) * mix(smoothstep(1.05, 0.1, uv.y), 1.0, u_think);
  for (int i = 0; i < 16; i++) {
    float age = u_time - u_keys[i].z;
    if (u_keys[i].z <= 0.0 || age < 0.0 || age > 5.0) continue;
    vec2 pos = keyPos(u_keys[i]) + vec2(0.0, -0.3 + age * 0.13);
    float s = 0.05 + age * 0.06;
    vec2 dd = p - pos;
    d += 0.9 * exp(-dot(dd, dd) / (s * s)) * exp(-age * 0.75) * (0.55 + 0.45 * fbm(p * 9.0 + age));
  }
  float core = u_think * exp(-r * r * 16.0) * (0.75 + 0.25 * sin(u_time * 2.2));
  float a = clamp(d * (0.14 + 0.2 * u_focus + 0.35 * u_think) * (1.0 - u_done * 0.6) + core * 0.65, 0.0, 1.0);
  vec3 col = mix(vec3(0.86, 0.9, 0.95), CYAN, clamp(u_think * 0.55 + core * 1.5, 0.0, 1.0));
  col = mix(col, RED, u_err);
  a *= edgeFade(uv);
  o = vec4(col * a, a);
}`,
  },
  {
    name: "glass",
    // a thick glass slab: a fresnel-like rim along the top edge; thinking runs a bead of light along it
    frag: `
void main() {
  vec2 uv = gl_FragCoord.xy / u_res, p = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  float dTop = u_res.y - gl_FragCoord.y;
  float rim = exp(-dTop / 1.4) * 0.55 + exp(-dTop / 16.0) * 0.08 + exp(-gl_FragCoord.y / 24.0) * 0.04;
  rim += (fbm(p * 5.0 + u_time * 0.04) - 0.5) * 0.04;
  float cx = (uv.x - u_caret) * aspect();
  rim += u_type * exp(-cx * cx * 30.0) * (exp(-dTop / 2.5) * 1.3 + exp(-dTop / 26.0) * 0.18);
  float bead = 0.0;
  for (int i = 0; i < 10; i++) {
    float bt = u_time - float(i) * 0.035;
    float bx = 0.5 + 0.46 * sin(bt * 1.25);
    float dx = (uv.x - bx) * aspect();
    bead += exp(-float(i) * 0.42) * exp(-dx * dx * 140.0);
  }
  rim += u_think * bead * (exp(-dTop / 2.2) * 1.4 + exp(-dTop / 34.0) * 0.22);
  rim += u_done * (exp(-dTop / 4.0) * 0.9 + exp(-dTop / 40.0) * 0.12);
  rim *= 1.0 - u_err * 0.75 * step(0.55, hash(vec2(floor(u_time * 22.0), 3.0)));
  vec3 col = mix(vec3(0.95, 0.97, 1.0), CYAN, clamp(u_think * bead * 0.8 + u_done * 0.4, 0.0, 1.0));
  col = mix(col, RED, u_err);
  float a = clamp(rim, 0.0, 1.0) * (0.75 + 0.25 * edgeFade(uv));
  o = vec4(col * a, a);
}`,
  },
  {
    name: "radar",
    // a scope rising from the bottom center; keys become blips; thinking sweeps with phosphor decay
    frag: `
const float PI = 3.14159265;
void main() {
  vec2 uv = gl_FragCoord.xy / u_res, p = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  vec2 c = p - vec2(0.0, -0.55);
  float r = length(c), ang = atan(c.x, c.y);
  float rings = 1.0 - min(abs(fract(r * 3.0 - 0.5) - 0.5) / fwidth(r * 3.0), 1.0);
  float spokes = 1.0 - min(abs(fract(ang / (PI / 8.0) - 0.5) - 0.5) / fwidth(ang / (PI / 8.0)), 1.0);
  float sweepA = mod(u_time * 1.7, 2.0 * PI) - PI;
  float lag = mod(sweepA - ang, 2.0 * PI);
  float trail = u_think * exp(-lag * 2.6) * smoothstep(1.6, 0.2, r);
  float blips = 0.0;
  for (int i = 0; i < 16; i++) {
    float age = u_time - u_keys[i].z;
    if (u_keys[i].z <= 0.0 || age < 0.0 || age > 8.0) continue;
    vec2 bp = vec2(keyPos(u_keys[i]).x, -0.05 + 0.35 * hash(vec2(u_keys[i].z, 1.0)));
    vec2 bc = bp - vec2(0.0, -0.55);
    float hit = exp(-mod(sweepA - atan(bc.x, bc.y), 2.0 * PI) * 1.5);
    float d = length(p - bp);
    blips += exp(-d * d * 2200.0) * exp(-age * 0.35) * (0.45 + u_think * hit * 1.4);
  }
  float lock = u_done * (1.0 - min(abs(r - 0.42) / fwidth(r) * 0.5, 1.0)) * (0.6 + 0.4 * sin(u_time * 8.0));
  float stat = u_err * hash(gl_FragCoord.xy + floor(u_time * 30.0)) * 0.35;
  float a = (rings * 0.07 + spokes * 0.025) * (1.0 + u_focus + u_think * 2.0) + trail * 0.5 + blips + lock + stat;
  a = clamp(a, 0.0, 1.0) * edgeFade(uv);
  vec3 col = mix(CYAN, vec3(0.9, 0.97, 1.0), clamp(blips + lock, 0.0, 1.0));
  col = mix(col, RED, u_err);
  o = vec4(col * a, a);
}`,
  },
  {
    name: "growth",
    // Gray-Scott reaction-diffusion: typing seeds it, thinking grows coral from the center
    frag: `
uniform sampler2D u_sim;
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 s = texture(u_sim, uv).rg;
  vec2 e = 1.0 / vec2(textureSize(u_sim, 0));
  float b = s.g, gx = texture(u_sim, uv + vec2(e.x, 0.0)).g - texture(u_sim, uv - vec2(e.x, 0.0)).g;
  float body = smoothstep(0.12, 0.38, b);
  float edge = clamp(abs(gx) * 6.0, 0.0, 1.0);
  float a = (body * 0.22 + edge * 0.55) * (0.5 + 0.5 * u_focus + 0.6 * u_think + 0.8 * u_done);
  vec3 col = mix(vec3(0.85, 0.92, 0.96), CYAN, clamp(edge + u_think * 0.4, 0.0, 1.0));
  col = mix(col, RED, u_err);
  a = clamp(a, 0.0, 1.0) * edgeFade(uv);
  o = vec4(col * a, a);
}`,
  },
];

// one Gray-Scott step; A in red, B in green
const SIM = `#version 300 es
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_simres;
uniform float u_feed, u_kill, u_time, u_think;
uniform vec3 u_keys[16];
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / u_simres, e = 1.0 / u_simres;
  vec2 s = texture(u_prev, uv).rg;
  vec2 lap = -s
    + 0.2 * (texture(u_prev, uv + vec2(e.x, 0)).rg + texture(u_prev, uv - vec2(e.x, 0)).rg + texture(u_prev, uv + vec2(0, e.y)).rg + texture(u_prev, uv - vec2(0, e.y)).rg)
    + 0.05 * (texture(u_prev, uv + e).rg + texture(u_prev, uv - e).rg + texture(u_prev, uv + vec2(e.x, -e.y)).rg + texture(u_prev, uv + vec2(-e.x, e.y)).rg);
  float a = s.r, b = s.g, abb = a * b * b;
  a += 1.0 * lap.r - abb + u_feed * (1.0 - a);
  b += 0.5 * lap.g + abb - (u_kill + u_feed) * b;
  vec2 px = gl_FragCoord.xy;
  for (int i = 0; i < 16; i++) {
    float age = u_time - u_keys[i].z;
    if (u_keys[i].z <= 0.0 || age < 0.0 || age > 0.25) continue;
    if (length(px - vec2(u_keys[i].x * u_simres.x, u_simres.y * 0.5)) < 3.5) b = 1.0;
  }
  if (u_think > 0.5 && length(px - u_simres * 0.5) < 2.5) b = 1.0;
  o = vec4(clamp(a, 0.0, 1.0), clamp(b, 0.0, 1.0), 0.0, 1.0);
}`;

const VERT = `#version 300 es
in vec2 pos;
void main() { gl_Position = vec4(pos, 0.0, 1.0); }`;

export function createBarFx(canvas, host) {
  const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, alpha: true, antialias: false });
  const noop = { setVariant() {}, state() {}, key() {}, focus() {}, variant: 0, names: [] };
  if (!gl) return noop;
  const floatOk = !!gl.getExtension("EXT_color_buffer_float");

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
  const progs = VARIANTS.map((v) => program(COMMON + v.frag));
  const sim = program(SIM);

  // one triangle that covers the screen
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  // reaction-diffusion ping-pong at half resolution
  let simTex = [], simFb = [], simW = 0, simH = 0, simRead = 0;
  function makeSim(w, h) {
    simW = w;
    simH = h;
    simTex.forEach((t) => gl.deleteTexture(t));
    simFb.forEach((f) => gl.deleteFramebuffer(f));
    simTex = [0, 1].map(() => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    });
    simFb = simTex.map((t) => {
      const f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      gl.clearColor(1, 0, 0, 1); // all A, no B
      gl.clear(gl.COLOR_BUFFER_BIT);
      return f;
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // ---- state: targets, eased values, keystrokes

  const target = { think: 0, done: 0, err: 0, focus: 0 };
  const val = { think: 0, done: 0, err: 0, focus: 0, type: 0 };
  const keys = new Float32Array(16 * 3);
  let keyIdx = 0, caret = 0.5, flow = 0, last = performance.now(), t0 = last, variant = 0, timer = 0, raf = 0;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    const w = Math.max(1, Math.round(host.clientWidth * dpr)), h = Math.max(1, Math.round(host.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      if (floatOk) makeSim(Math.max(1, w >> 1), Math.max(1, h >> 1));
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
    if (variant === 4) {
      if (!floatOk) return;
      const steps = val.err > 0.3 ? 6 : val.think > 0.2 ? 10 : val.type > 0.05 || recentKeys(t) ? 6 : 0;
      gl.useProgram(sim.p);
      gl.uniform2f(sim.u.u_simres, simW, simH);
      gl.uniform1f(sim.u.u_feed, 0.0545);
      gl.uniform1f(sim.u.u_kill, val.err > 0.3 ? 0.075 : 0.062);
      gl.uniform1f(sim.u.u_time, t);
      gl.uniform1f(sim.u.u_think, val.think);
      gl.uniform3fv(sim.u.u_keys, keys);
      gl.viewport(0, 0, simW, simH);
      for (let i = 0; i < steps; i++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, simFb[1 - simRead]);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, simTex[simRead]);
        gl.uniform1i(sim.u.u_prev, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        simRead = 1 - simRead;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
    const { p, u } = progs[variant];
    gl.useProgram(p);
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
    if (u.u_sim) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, simTex[simRead]);
      gl.uniform1i(u.u_sim, 0);
    }
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
    names: VARIANTS.map((v) => v.name),
    variant,
    setVariant(i) {
      variant = api.variant = Math.max(0, Math.min(VARIANTS.length - 1, i));
      if (variant === 4 && floatOk) makeSim(simW || 1, simH || 1);
      wake();
    },
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
    floatOk,
  };
  resize();
  wake();
  return api;
}

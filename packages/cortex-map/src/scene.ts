// Scene furniture — the "war-table" look. Faithful port of the original Cortex
// map's builders; the only structural change is that dome curvature (domeY) is
// passed in rather than imported, so the whole scene follows the user's theme.
// three.js is typed loosely — these only ever run client-side inside the WebGL
// effect, and the lib ships its own runtime types.
/* eslint-disable @typescript-eslint/no-explicit-any */

export type DomeYFn = (planarRadius: number) => number;

// ── raycast exclusion (THE mouse-move perf fix) ──────────────────────────────
// 3d-force-graph's hover detection raycasts the WHOLE scene recursively on every
// frame the pointer is over the canvas. All the decorative furniture — above all
// the sea (a 128×128 ≈ 32k-triangle plane with frustumCulled:false) — would be
// brute-force ray-vs-triangle tested each frame: pure CPU, and exactly the
// 150→20fps cliff on mouse-move. Stubbing `raycast` to a noop drops these objects
// out of the raycaster entirely, leaving only the node spheres hittable.
const NO_RAYCAST = () => {};
export function disableRaycast(obj: any): any {
  if (!obj) return obj;
  obj.raycast = NO_RAYCAST;
  const kids = obj.children;
  if (kids) for (let i = 0; i < kids.length; i++) disableRaycast(kids[i]);
  return obj;
}

/** Lerp two #rrggbb colours. Used to fade a flashing node back to its base. */
export function hexLerp(from: string, to: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  if (!/^#[0-9a-f]{6}$/i.test(from) || !/^#[0-9a-f]{6}$/i.test(to)) return to;
  const a = p(from), b = p(to);
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** The holo-table surface: a flat disc under the graph with a radial core glow
 *  and a faint polar grid (concentric circles + radial spokes), fading to
 *  transparent at the rim so there's no hard edge in the void. */
export function makeGroundPlane(THREE: any, radius: number, domeY: DomeYFn): any {
  const S = 1024;
  const c = S / 2;
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const ctx = cv.getContext("2d")!;

  // radial base wash — subtle blue, brighter toward the core, gone by the rim
  const g = ctx.createRadialGradient(c, c, 0, c, c, c);
  g.addColorStop(0, "rgba(34,58,92,0.55)");
  g.addColorStop(0.35, "rgba(16,30,52,0.4)");
  g.addColorStop(0.75, "rgba(7,14,28,0.22)");
  g.addColorStop(1, "rgba(4,6,13,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(c, c, c, 0, Math.PI * 2);
  ctx.fill();

  // polar grid, clipped to the disc so spokes don't spill past the rim
  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, c * 0.98, 0, Math.PI * 2);
  ctx.clip();
  ctx.strokeStyle = "rgba(96,150,210,0.10)";
  ctx.lineWidth = 1.4;
  for (let i = 1; i <= 6; i++) {
    ctx.beginPath();
    ctx.arc(c, c, (c * 0.98 * i) / 6, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.lineTo(c + Math.cos(a) * c, c + Math.sin(a) * c);
    ctx.stroke();
  }
  ctx.restore();

  const tex = new THREE.CanvasTexture(cv);
  tex.minFilter = THREE.LinearFilter;
  // a finely-subdivided ring (not a flat circle) so the dome curve is smooth
  const geo = new THREE.RingGeometry(2, radius, 128, 48);
  geo.rotateX(-Math.PI / 2); // lie on the XZ plane, facing up
  // displace each vertex down onto the dome surface
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, domeY(Math.hypot(x, z)));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = -1.5; // just under the nodes/pillar bases
  return mesh;
}

/* Cached soft radial-glow texture — point sprite for glows, dust, and stars. */
let _glowTex: any = null;
export function glowTexture(THREE: any): any {
  if (_glowTex) return _glowTex;
  const size = 128;
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const ctx = cv.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, "rgba(255,255,255,0.65)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  _glowTex = new THREE.CanvasTexture(cv);
  return _glowTex;
}

/** Procedural night-lights: a few thousand tiny additive points scattered across
 *  the dome — warm/cool, lightly clustered into "settlements" — that read as a
 *  living surface (no asset, fits the abstract-mind concept). */
export function makeNightLights(THREE: any, radius: number, domeY: DomeYFn): any {
  const N = 2600;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const warm = [1.0, 0.78, 0.46];
  const cool = [0.5, 0.74, 1.0];
  // a handful of clumping centres so the field isn't uniform noise
  const hubs: [number, number][] = [];
  for (let i = 0; i < 14; i++) {
    const hr = radius * Math.sqrt(Math.random()) * 0.9;
    const ha = Math.random() * Math.PI * 2;
    hubs.push([Math.cos(ha) * hr, Math.sin(ha) * hr]);
  }
  for (let i = 0; i < N; i++) {
    let x: number, z: number;
    if (Math.random() < 0.45) {
      const h = hubs[(Math.random() * hubs.length) | 0];
      const rr = Math.random() * Math.random() * 75;
      const aa = Math.random() * Math.PI * 2;
      x = h[0] + Math.cos(aa) * rr;
      z = h[1] + Math.sin(aa) * rr;
    } else {
      const rr = radius * Math.sqrt(Math.random()) * 0.97;
      const aa = Math.random() * Math.PI * 2;
      x = Math.cos(aa) * rr;
      z = Math.sin(aa) * rr;
    }
    pos[i * 3] = x;
    pos[i * 3 + 1] = domeY(Math.hypot(x, z)) + 0.6; // just above the surface
    pos[i * 3 + 2] = z;
    const base = Math.random() < 0.62 ? warm : cool; // skew warm
    const b = 0.32 + Math.random() * 0.6;
    col[i * 3] = base[0] * b;
    col[i * 3 + 1] = base[1] * b;
    col[i * 3 + 2] = base[2] * b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    size: 7,
    map: glowTexture(THREE),
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  return new THREE.Points(geo, mat);
}

/** Per-node additive glow halo — makes every node read as a light point and
 *  catch the bloom, instead of a matte sphere. Tinted by cluster colour. */
export function makeNodeGlow(THREE: any, scale: number, color: string): any {
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(THREE),
    color: new THREE.Color(color),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0.85,
  }));
  spr.scale.set(scale, scale, 1);
  return spr;
}

/** Faint drifting dust volume above the disc — slow ambient motion that
 *  separates "living world" from "dashboard" without moving any actual nodes. */
export function makeDust(THREE: any, radius: number): any {
  const N = 700;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const rr = radius * (0.25 + Math.random() * 0.95);
    const aa = Math.random() * Math.PI * 2;
    pos[i * 3] = Math.cos(aa) * rr;
    pos[i * 3 + 1] = 15 + Math.random() * 280; // floating above the surface
    pos[i * 3 + 2] = Math.sin(aa) * rr;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    size: 4,
    map: glowTexture(THREE),
    color: new THREE.Color("#9fc0ee"),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
    opacity: 0.35,
  });
  return new THREE.Points(geo, mat);
}

/** Deep-space starfield — faint points on a large enclosing sphere so the black
 *  void reads as depth, not emptiness. fog:false so they survive the depth haze
 *  (a fogged star is an invisible star). A spread of sizes + a warm/cool tint mix
 *  keeps it from looking like uniform noise. Rotated very slowly in the loop. */
export function makeStarfield(THREE: any, count: number, radius: number): any {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const warm = [1.0, 0.86, 0.66];
  const cool = [0.66, 0.8, 1.0];
  for (let i = 0; i < count; i++) {
    // even-ish spherical scatter (reject the poles a touch so it isn't banded)
    const u = Math.random() * 2 - 1;
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    const rr = radius * (0.82 + Math.random() * 0.18);
    pos[i * 3] = Math.cos(a) * r * rr;
    pos[i * 3 + 1] = u * rr * 0.7 + 200; // squash vertically + lift, so most sit high
    pos[i * 3 + 2] = Math.sin(a) * r * rr;
    const base = Math.random() < 0.5 ? warm : cool;
    const b = 0.4 + Math.random() * 0.6;
    col[i * 3] = base[0] * b;
    col[i * 3 + 1] = base[1] * b;
    col[i * 3 + 2] = base[2] * b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    size: 2.2,
    map: glowTexture(THREE),
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: false, // star-like: constant screen size regardless of depth
    opacity: 0.85,
    fog: false,
  });
  return new THREE.Points(geo, mat);
}

/** Soft nebula clouds drifting in the void — a handful of big, very faint additive
 *  sprites tinted toward the cluster palette, so the empty space carries colour and
 *  depth without competing with the constellations. Returns a Group (slow-rotated
 *  in the loop). fog:false so distant clouds don't wash out to nothing. */
export function makeNebula(THREE: any, tints: string[]): any {
  const group = new THREE.Group();
  const N = 7;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + i * 0.9;
    const rr = 1150 + (i % 3) * 360;
    const tint = tints.length ? tints[i % tints.length] : "#6688cc";
    const spr = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture(THREE),
        color: new THREE.Color(tint),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0.05 + (i % 2) * 0.02, // 0.05–0.07 — barely-there colour wash
        fog: false,
      }),
    );
    const scale = 900 + (i % 4) * 280;
    spr.position.set(Math.cos(a) * rr, 120 + ((i * 137) % 360), Math.sin(a) * rr);
    spr.scale.set(scale, scale, 1);
    group.add(spr);
  }
  return group;
}

// ── the animated sea ─────────────────────────────────────────────────────────
// A TRANSPARENT water layer under the disc, rendered as white wave OUTLINES
// (foam contour lines), confined to the disc footprint. Dense, multi-directional
// waves interfere and "crash" where crests cross.
export const SEA_SRC_COUNT = 8;   // max simultaneous ripple sources fed to the shader
export const SEA_RIPPLE_TTL = 6;  // seconds a ripple lives (travel out + fade)
const SEA_OFFSET = 6;      // how far the sheet sits below the disc surface
const SEA_AMP = 4;         // geometric wave relief (subtle — the look is in the foam)
const SEA_LINES = 16.0;    // dense, fine foam filaments (real-ocean look)
const SEA_LINE_W = 0.06;   // thin foam lines
const SEA_FOAM = 0.6;      // whitecap foam brightness over the water body
const SEA_BODY_ALPHA = 0.5; // dark-navy water-body opacity over the void

// Shared GLSL: the wave height field. Dense multi-directional sines — several
// travel in OPPOSING directions / opposite time signs, so crests cross and
// interfere ("crash"). Used by BOTH the vertex shader (geometric relief) and the
// fragment shader (the foam outlines), so the lines trace the surface exactly.
const SEA_WAVE_GLSL = /* glsl */ `
  float seaWaves(vec2 p, float t) {
    p += 34.0 * vec2(
      sin(dot(p, vec2( 0.011,  0.023)) + t * 0.50),
      sin(dot(p, vec2(-0.019,  0.013)) - t * 0.43)
    );
    p += 13.0 * vec2(
      sin(dot(p, vec2( 0.041, -0.017)) - t * 0.70),
      sin(dot(p, vec2( 0.029,  0.037)) + t * 0.62)
    );
    float h = 0.0;
    h += (1.0 - abs(sin(dot(p, vec2( 1.00,  0.20)) * 0.060 + t * 1.8))) * 1.00;
    h += (1.0 - abs(sin(dot(p, vec2(-0.30,  1.00)) * 0.085 - t * 2.1))) * 0.70;
    h += (1.0 - abs(sin(dot(p, vec2( 0.70, -0.70)) * 0.120 + t * 2.6))) * 0.50;
    h += (1.0 - abs(sin(dot(p, vec2(-0.90, -0.40)) * 0.160 - t * 2.3))) * 0.35;
    h += (1.0 - abs(sin(dot(p, vec2( 0.20,  0.96)) * 0.220 + t * 3.0))) * 0.22;
    h += (1.0 - abs(sin(dot(p, vec2( 0.55,  0.83)) * 0.340 - t * 3.4))) * 0.14;
    h += (1.0 - abs(sin(dot(p, vec2(-0.62,  0.78)) * 0.470 + t * 3.9))) * 0.09;
    return (h / 3.00) * 2.0 - 1.0;
  }

  // Activity ripples: each source (xy = position, z = strength, w = spawn time)
  // emits a ring expanding at fixed speed, decaying with age + distance from the
  // wavefront. Summed, overlapping rings interfere — the sum IS the collision.
  uniform vec4 uSources[8];
  uniform float uRippleAmp;
  float seaSources(vec2 p, float t) {
    float h = 0.0;
    for (int i = 0; i < 8; i++) {
      vec4 s = uSources[i];
      if (s.z <= 0.001) continue;
      float age = t - s.w;
      if (age < 0.0) continue;
      float d = length(p - s.xy);
      float front = age * 130.0;
      float env = exp(-abs(d - front) * 0.018)
                * exp(-age * 0.45) * s.z;
      h += sin((d - front) * 0.06) * env;
    }
    return h * uRippleAmp;
  }

  float seaField(vec2 p, float t) {
    return seaWaves(p, t) + seaSources(p, t);
  }
`;

/** Transparent animated sea — hugs just under the disc, shows white foam contour
 *  lines of the height field. Everything runs on the GPU off a single uTime
 *  uniform — animating is a uniform bump + a draw, no per-vertex CPU work. */
export function makeSea(THREE: any, radius: number, domeRadius: number): any {
  const seg = 128; // enough subdivision for a smooth domed sheet
  const geo = new THREE.PlaneGeometry(radius * 2, radius * 2, seg, seg);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending, // a real dark-navy water body, not a glow
    uniforms: {
      uTime: { value: 0 },
      uAmp: { value: SEA_AMP },
      uRadius: { value: radius },
      uDomeR: { value: domeRadius }, // curve the sheet to match the disc dome
      uLines: { value: SEA_LINES },
      uLineW: { value: SEA_LINE_W },
      uIntensity: { value: SEA_FOAM },
      uBodyAlpha: { value: SEA_BODY_ALPHA },
      uRippleAmp: { value: 1.4 }, // height weight of activity ripples vs ambient swell
      uSources: { value: Array.from({ length: SEA_SRC_COUNT }, () => new THREE.Vector4(0, 0, 0, 0)) },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uAmp;
      uniform float uDomeR;
      varying vec2 vP;
      ${SEA_WAVE_GLSL}
      void main() {
        vec3 pos = position;
        vP = pos.xy;
        float r = min(length(pos.xy), uDomeR);
        float dome = sqrt(max(0.0, uDomeR * uDomeR - r * r)) - uDomeR;
        pos.z = dome + seaField(pos.xy, uTime) * uAmp;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uRadius;
      uniform float uLines;
      uniform float uLineW;
      uniform float uIntensity;
      uniform float uBodyAlpha;
      varying vec2 vP;
      ${SEA_WAVE_GLSL}
      void main() {
        float a = seaField(vP, uTime) * 0.5 + 0.5;
        float f = a * uLines;
        float dl = abs(fract(f - 0.5) - 0.5);
        float lines = smoothstep(uLineW, 0.0, dl);
        float crestBias = smoothstep(0.45, 0.96, a);
        float foam = lines * crestBias;
        vec3 deep = vec3(0.015, 0.05, 0.11);
        vec3 shallow = vec3(0.04, 0.12, 0.22);
        vec3 water = mix(deep, shallow, a);
        vec3 foamCol = vec3(0.60, 0.82, 1.0);
        vec3 col = mix(water, foamCol, clamp(foam, 0.0, 1.0));
        float ang = atan(vP.y, vP.x);
        float wobble = 1.0 + 0.18 * sin(ang * 3.0 + uTime * 0.22)
                           + 0.10 * sin(ang * 7.0 - uTime * 0.35)
                           + 0.06 * sin(ang * 13.0 + uTime * 0.50);
        float edge = 1.0 - smoothstep(uRadius * 0.45 * wobble, uRadius * 0.98 * wobble, length(vP));
        float alpha = (uBodyAlpha + foam * uIntensity) * edge;
        if (alpha < 0.003) discard;
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;            // lie flat on the XZ plane
  mesh.position.y = -1.5 - SEA_OFFSET;       // just under the disc surface
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  return mesh;
}

/** Additive radial-gradient sprite — the sun-core glow at the disc centre. */
export function makeGlowSprite(THREE: any, scale: number): any {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 256;
  const ctx = cv.getContext("2d")!;
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, "rgba(255,242,205,1)");
  g.addColorStop(0.22, "rgba(255,221,150,0.7)");
  g.addColorStop(0.55, "rgba(255,184,96,0.2)");
  g.addColorStop(1, "rgba(255,160,70,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(cv);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  spr.scale.set(scale, scale, 1);
  return spr;
}

/** The holo-disc's outer RIM: concentric instrument-style rings + a bezel of
 *  ticks hugging the disc's edge, all SEATED ON THE DOME so they read as the
 *  disc's own glowing rim. Gold palette + orbiting signal dots. Returns a Group
 *  with an `update(delta)` (slow spin + dot orbits). Never hit-tested. */
export function createOuterDisk(THREE: any, radius: number, domeY: DomeYFn): any {
  const group = new THREE.Group();
  const TAU = Math.PI * 2;
  const RIM = 0xf2d680;   // the bright defined rim line (gold)
  const RING = 0xc7a455;  // faint concentric guide rings (muted darker gold)
  const TICK = 0xe0c06a;  // bezel ticks (mid gold)

  // A dome-seated ring: constant planar radius → constant dome height.
  const ringLoop = (rr: number, color: number, opacity: number) => {
    const y = domeY(rr);
    const pts: any[] = [];
    for (let s = 0; s <= 240; s++) {
      const a = (s / 240) * TAU;
      pts.push(new THREE.Vector3(Math.cos(a) * rr, y, Math.sin(a) * rr));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    return new THREE.LineLoop(geo, new THREE.LineBasicMaterial({
      color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
  };
  const dottedLoop = (rr: number, color: number, opacity: number, count: number) => {
    const y = domeY(rr);
    const pos = new Float32Array(count * 3);
    for (let s = 0; s < count; s++) {
      const a = (s / count) * TAU;
      pos[s * 3] = Math.cos(a) * rr; pos[s * 3 + 1] = y; pos[s * 3 + 2] = Math.sin(a) * rr;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return new THREE.Points(geo, new THREE.PointsMaterial({
      color, size: 2, sizeAttenuation: false, transparent: true, opacity,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
  };

  // 1. RIM RINGS — fine guides inside the edge, a dotted detail ring, the bright
  //    rim line AT the disc edge, and a faint outer containment ring.
  group.add(ringLoop(radius * 0.90, RING, 0.10));
  group.add(ringLoop(radius * 0.94, RING, 0.13));
  group.add(dottedLoop(radius * 0.97, RIM, 0.45, 260));
  group.add(ringLoop(radius * 1.00, RIM, 0.4));
  group.add(ringLoop(radius * 1.035, RING, 0.16));

  // 2. BEZEL TICKS — short radial ticks around the rim; every 5th a longer major.
  {
    const TICKS = 120;
    const segs: any[] = [];
    for (let i = 0; i < TICKS; i++) {
      const a = (i / TICKS) * TAU;
      const r0 = radius * 1.005;
      const r1 = radius * (i % 5 === 0 ? 1.045 : 1.025);
      segs.push(new THREE.Vector3(Math.cos(a) * r0, domeY(r0), Math.sin(a) * r0));
      segs.push(new THREE.Vector3(Math.cos(a) * r1, domeY(r1), Math.sin(a) * r1));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(segs);
    group.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      color: TICK, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending,
    })));
  }

  // 3. SIGNAL DOTS — brighter points orbiting along the rim rings.
  const ringRadii = [0.90, 0.94, 0.97, 1.00].map((f) => radius * f);
  const DOTS = 18;
  const dotPos = new Float32Array(DOTS * 3);
  const dots: { r: number; y: number; a: number; speed: number }[] = [];
  for (let i = 0; i < DOTS; i++) {
    const rr = ringRadii[i % ringRadii.length];
    const y = domeY(rr);
    const a = (i / DOTS) * TAU + i * 0.7;
    const speed = 0.02 + ((i % 7) / 6) * 0.06; // 0.02 … 0.08 rad/s, varied per dot
    dots.push({ r: rr, y, a, speed });
    dotPos[i * 3] = Math.cos(a) * rr; dotPos[i * 3 + 1] = y; dotPos[i * 3 + 2] = Math.sin(a) * rr;
  }
  const dotGeo = new THREE.BufferGeometry();
  dotGeo.setAttribute("position", new THREE.BufferAttribute(dotPos, 3));
  const cv = document.createElement("canvas");
  cv.width = cv.height = 64;
  const ctx = cv.getContext("2d")!;
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.4, "rgba(245,214,128,0.6)");
  grad.addColorStop(1, "rgba(220,180,90,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  group.add(new THREE.Points(dotGeo, new THREE.PointsMaterial({
    map: new THREE.CanvasTexture(cv), size: 4, sizeAttenuation: false, transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9,
  })));

  // animation — gentle spin + per-dot orbit along its ring (stays on the dome).
  group.update = (delta: number) => {
    group.rotation.y += 0.008 * delta;
    const arr = dotGeo.attributes.position.array as Float32Array;
    for (let i = 0; i < DOTS; i++) {
      const d = dots[i];
      d.a += d.speed * delta;
      arr[i * 3] = Math.cos(d.a) * d.r; arr[i * 3 + 1] = d.y; arr[i * 3 + 2] = Math.sin(d.a) * d.r;
    }
    dotGeo.attributes.position.needsUpdate = true;
  };

  return group;
}

/* Shared vertical alpha-gradient for light-pillars (bright near the base, fading
 * up). One texture, tinted per node via the material colour. Cached across nodes. */
let _beamTex: any = null;
export function beamTexture(THREE: any): any {
  if (_beamTex) return _beamTex;
  const cv = document.createElement("canvas");
  cv.width = 8;
  cv.height = 128;
  const ctx = cv.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 128, 0, 0); // bottom → top
  g.addColorStop(0.0, "rgba(255,255,255,0)");    // soft fade right at the base
  g.addColorStop(0.12, "rgba(255,255,255,0.9)"); // brightest just above the node
  g.addColorStop(0.5, "rgba(255,255,255,0.32)");
  g.addColorStop(1.0, "rgba(255,255,255,0)");    // fade out at the tip
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 8, 128);
  _beamTex = new THREE.CanvasTexture(cv);
  return _beamTex;
}

/** A vertical light-beam rising from a node on the plane. Truly world-vertical
 *  (a thin additive cylinder), so it stands up off the disc at any camera angle. */
export function makePillar(THREE: any, height: number, radius: number, color: string): any {
  const geo = new THREE.CylinderGeometry(radius, radius, height, 7, 1, true);
  const mat = new THREE.MeshBasicMaterial({
    map: beamTexture(THREE),
    color: new THREE.Color(color),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    opacity: 0.9,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = height / 2; // base sits on the plane at the node
  return mesh;
}

/** Node ring disk — a HUD-style disk on the surface under a node, tinted by its
 *  cluster colour, so the node reads as ANCHORED to the map: a soft core, a solid
 *  inner ring, plus — at higher `detail` — a dashed mid ring, a ticked outer ring,
 *  and 3 slowly-orbiting dots. Animates off the shared ring clock; `rate` (driven
 *  by connection count) sets spin/pulse. */
export function makeNodeRing(THREE: any, color: string, radius: number, detail: number, rate: number, clock: any): any {
  const geo = new THREE.PlaneGeometry(radius * 2, radius * 2, 1, 1);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: clock, // shared {value} object — one write per frame drives every ring
      uColor: { value: new THREE.Color(color) },
      uDetail: { value: detail },
      uRate: { value: rate },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uDetail;
      uniform float uRate;
      varying vec2 vUv;
      #define TAU 6.28318530718
      float band(float d, float r, float w) { return smoothstep(w, 0.0, abs(d - r)); }
      void main() {
        vec2 q = vUv - 0.5;
        float d = length(q) * 2.0;
        float ang = atan(q.y, q.x);
        float spin = uTime * uRate * 0.15;
        float c = 0.0;
        c += pow(clamp(1.0 - d * 3.2, 0.0, 1.0), 2.0) * 0.55;
        c += band(d, 0.30, 0.02) * 0.8;
        c *= 0.7 + 0.3 * (0.5 + 0.5 * sin(uTime * uRate));
        float dash = step(0.4, fract((ang / TAU) * 64.0 + spin));
        c += uDetail * band(d, 0.60, 0.022) * (0.30 + dash * 0.55);
        float ticks = smoothstep(0.86, 1.0, sin(ang * 30.0 - spin * 1.7));
        c += uDetail * band(d, 0.90, 0.014) * (0.22 + ticks * 0.6);
        float dots = 0.0;
        for (int i = 0; i < 3; i++) {
          float a0 = spin * 2.0 + float(i) * 2.0944;
          float da = atan(sin(ang - a0), cos(ang - a0));
          dots += exp(-da * da * 70.0);
        }
        c += uDetail * dots * band(d, 0.60, 0.05) * 0.9;
        float a = clamp(c, 0.0, 1.0);
        if (a < 0.004) discard;
        gl_FragColor = vec4(uColor, a);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2; // lie flat on the surface
  mesh.position.y = -1.3;         // just above the ground plane
  mesh.renderOrder = -1;
  return mesh;
}

/** Speculative "future branch": a thin arced tube from a selected node toward a
 *  node it COULD connect to (a 2nd-degree neighbour). It grows in from the node
 *  outward and flows with dashes, reading as a tentative, not-yet-real link. */
export function makeFuturesBranch(THREE: any, p0: any, p2: any, color: string, clock: any, born: number, delay: number): any {
  const mid = p0.clone().add(p2).multiplyScalar(0.5);
  mid.y += p0.distanceTo(p2) * 0.22 + 30; // lift the arc off the plane
  const curve = new THREE.QuadraticBezierCurve3(p0, mid, p2);
  const geo = new THREE.TubeGeometry(curve, 36, 1.1, 5, false);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uClock: clock, // shared {value} — bumped once per frame by the ambient loop
      uBorn: { value: born },
      uDelay: { value: delay },
      uColor: { value: new THREE.Color(color) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv; // TubeGeometry: uv.x runs 0→1 along the tube length
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uClock;
      uniform float uBorn;
      uniform float uDelay;
      uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        float prog = clamp((uClock - uBorn - uDelay) * 0.8, 0.0, 1.0);
        if (vUv.x > prog) discard;
        float dash = step(0.55, fract(vUv.x * 16.0 - uClock * 1.1));
        float tip = smoothstep(prog - 0.18, prog, vUv.x);
        float a = 0.14 + dash * 0.26 + tip * 0.5;
        if (a < 0.02) discard;
        gl_FragColor = vec4(uColor, a * 0.85);
      }
    `,
  });
  return new THREE.Mesh(geo, mat);
}

/** Camera-facing text label for a cluster rim. */
export function makeTextSprite(THREE: any, text: string, color: string): any {
  const fontPx = 44;
  const font = `600 ${fontPx}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
  const cv = document.createElement("canvas");
  let ctx = cv.getContext("2d")!;
  ctx.font = font;
  const pad = 16;
  cv.width = Math.ceil(ctx.measureText(text).width) + pad * 2;
  cv.height = fontPx + pad * 2;
  ctx = cv.getContext("2d")!; // resizing the canvas resets its state
  ctx.font = font;
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 14;
  ctx.globalAlpha = 0.92;
  ctx.fillText(text, pad, cv.height / 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.minFilter = THREE.LinearFilter;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.72 }));
  const worldPerPx = 0.52;
  spr.scale.set(cv.width * worldPerPx, cv.height * worldPerPx, 1);
  return spr;
}

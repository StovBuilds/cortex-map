// VR for the three.js page (WebXR): the same scene, shrunk to a table top in
// front of you. Point a controller at a shape (its ray glows on it), pull the
// trigger to pick it. Squeeze a grip and move: you carry the world. Squeeze
// both and pull apart / twist: it grows and turns, like two-hand pinch.
//
// No headset here? `?xr=emulate` loads IWER (Meta's WebXR emulator) and fakes
// a Quest 3, which is how the e2e drives it.

import * as THREE from "three";

export interface XRMount {
  /** Enter / leave VR. */
  enter(): Promise<void>;
  exit(): Promise<void>;
  /** The emulated device, with ?xr=emulate. */
  device: unknown;
  supported: () => boolean;
}

export async function mountXR(o: {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Everything that should become the table top (shapes, grid). */
  world: THREE.Group;
  shapes: THREE.Mesh[];
  onPick: (m: THREE.Mesh | null) => void;
  onHover: (m: THREE.Mesh | null) => void;
  /** Called every frame (desktop and VR): the page's own animation. */
  frame: () => void;
}): Promise<XRMount> {
  let device: unknown = null;
  if (new URLSearchParams(location.search).get("xr") === "emulate") {
    const { XRDevice, metaQuest3 } = await import("iwer");
    const d = new XRDevice(metaQuest3);
    d.installRuntime({ forceInstall: true });
    d.position.set(0, 1.6, 0);
    device = d;
  }
  const { renderer, scene, world } = o;
  renderer.xr.enabled = true;
  let supported = false;
  try { supported = !!(await navigator.xr?.isSessionSupported("immersive-vr")); } catch { /* no WebXR */ }

  // the table top: the scene is ~1200 units across; in VR that's 1.2 m, at waist height, a step in front
  const TABLE = { scale: 0.001, pos: new THREE.Vector3(0, 0.9, -0.75) };
  const desk = { scale: world.scale.clone(), pos: world.position.clone(), quat: world.quaternion.clone() };

  // controllers: a ray each
  const hands = [0, 1].map((i) => {
    const c = renderer.xr.getController(i);
    const ray = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]), new THREE.LineBasicMaterial({ color: "#7fd6ff", transparent: true, opacity: 0.8 }));
    ray.scale.z = 2;
    c.add(ray);
    scene.add(c);
    return { c, ray, squeezing: false, hit: null as THREE.Mesh | null };
  });
  const caster = new THREE.Raycaster();
  const aim = (h: (typeof hands)[number]) => {
    const m = new THREE.Matrix4().extractRotation(h.c.matrixWorld);
    caster.ray.origin.setFromMatrixPosition(h.c.matrixWorld);
    caster.ray.direction.set(0, 0, -1).applyMatrix4(m);
    const hit = caster.intersectObjects(o.shapes)[0];
    h.hit = (hit?.object as THREE.Mesh | undefined) ?? null;
    h.ray.scale.z = hit ? hit.distance : 2;
    (h.ray.material as THREE.LineBasicMaterial).color.set(hit ? "#ffc062" : "#7fd6ff");
  };

  // grabbing the world: one grip carries it, two scale and turn it
  let grab: { mode: 1 | 2; start: THREE.Matrix4; ctrl: THREE.Matrix4; d0: number; a0: number; mid0: THREE.Vector3; scale0: number; quat0: THREE.Quaternion; pos0: THREE.Vector3 } | null = null;
  const beginGrab = () => {
    const sq = hands.filter((h) => h.squeezing);
    if (!sq.length) { grab = null; return; }
    world.updateMatrix();
    if (sq.length === 1) {
      grab = { mode: 1, start: world.matrix.clone(), ctrl: sq[0].c.matrixWorld.clone(), d0: 0, a0: 0, mid0: new THREE.Vector3(), scale0: world.scale.x, quat0: world.quaternion.clone(), pos0: world.position.clone() };
    } else {
      const [a, b] = sq.map((h) => new THREE.Vector3().setFromMatrixPosition(h.c.matrixWorld));
      grab = { mode: 2, start: world.matrix.clone(), ctrl: new THREE.Matrix4(), d0: a.distanceTo(b), a0: Math.atan2(b.x - a.x, b.z - a.z), mid0: a.clone().add(b).multiplyScalar(0.5), scale0: world.scale.x, quat0: world.quaternion.clone(), pos0: world.position.clone() };
    }
  };
  const moveGrab = () => {
    if (!grab) return;
    const sq = hands.filter((h) => h.squeezing);
    if (grab.mode === 1 && sq.length === 1) {
      // world = controller now · controller then⁻¹ · world then
      const m = sq[0].c.matrixWorld.clone().multiply(grab.ctrl.clone().invert()).multiply(grab.start);
      m.decompose(world.position, world.quaternion, world.scale);
    } else if (grab.mode === 2 && sq.length === 2) {
      const [a, b] = sq.map((h) => new THREE.Vector3().setFromMatrixPosition(h.c.matrixWorld));
      const k = Math.max(0.2, Math.min(8, a.distanceTo(b) / (grab.d0 || 1)));
      const yaw = Math.atan2(b.x - a.x, b.z - a.z) - grab.a0;
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      // scale and turn about the hands' midpoint, and follow it
      const off = grab.pos0.clone().sub(grab.mid0).multiplyScalar(k).applyQuaternion(q);
      world.position.copy(mid).add(off);
      world.quaternion.copy(q).multiply(grab.quat0);
      world.scale.setScalar(grab.scale0 * k);
    }
  };

  hands.forEach((h) => {
    h.c.addEventListener("selectstart", () => { aim(h); o.onPick(h.hit); });
    h.c.addEventListener("squeezestart", () => { h.squeezing = true; beginGrab(); });
    h.c.addEventListener("squeezeend", () => { h.squeezing = false; beginGrab(); });
  });

  let hovered: THREE.Mesh | null = null;
  renderer.setAnimationLoop(() => {
    o.frame();
    if (renderer.xr.isPresenting) {
      for (const h of hands) aim(h);
      const now = hands.find((h) => h.hit)?.hit ?? null;
      if (now !== hovered) { hovered = now; o.onHover(now); }
      moveGrab();
    }
    renderer.render(scene, o.camera);
  });

  renderer.xr.addEventListener("sessionstart", () => {
    world.scale.setScalar(TABLE.scale);
    world.position.copy(TABLE.pos);
    world.quaternion.identity();
  });
  renderer.xr.addEventListener("sessionend", () => {
    world.scale.copy(desk.scale);
    world.position.copy(desk.pos);
    world.quaternion.copy(desk.quat);
    grab = null;
    hands.forEach((h) => { h.squeezing = false; });
  });

  return {
    device,
    supported: () => supported,
    async enter() {
      if (!supported || renderer.xr.isPresenting) return;
      const session = await navigator.xr!.requestSession("immersive-vr", { optionalFeatures: ["local-floor", "hand-tracking"] });
      renderer.xr.setReferenceSpaceType("local-floor");
      await renderer.xr.setSession(session);
    },
    async exit() { await renderer.xr.getSession()?.end(); },
  };
}

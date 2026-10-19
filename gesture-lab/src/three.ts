// A plain three.js scene (no cortex-map) driven by the orbit-camera adapter.
import * as THREE from "three";
import { cameraStats, createOrbitAdapter, pickStep } from "cortex-gesture";
import { mountShell } from "./shell";

const root = document.getElementById("root")!;
root.innerHTML = `<div class="page-title"><b>THREE.JS</b> · a bare scene: the orbit-camera adapter on its own</div>
  <div class="three-surface"></div><div class="three-label">Pinch a shape to pick it. <span data-ref="pick"></span></div>`;
const surface = root.querySelector<HTMLElement>(".three-surface")!;
const pickLabel = root.querySelector<HTMLElement>("[data-ref=pick]")!;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
surface.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color("#04060d");
scene.fog = new THREE.Fog("#04060d", 400, 1400);
const camera = new THREE.PerspectiveCamera(50, 1, 1, 4000);
const HOME = { pos: new THREE.Vector3(0, 260, 520), target: new THREE.Vector3(0, 0, 0) };
camera.position.copy(HOME.pos);
const target = HOME.target.clone();
camera.lookAt(target);

scene.add(new THREE.HemisphereLight("#9cc8ff", "#10131c", 1.2));
const sun = new THREE.DirectionalLight("#ffffff", 1.6);
sun.position.set(200, 400, 150);
scene.add(sun);
const world = new THREE.Group();
scene.add(world);
const grid = new THREE.GridHelper(1200, 40, "#2a4a6a", "#13243a");
world.add(grid);

const shapes: THREE.Mesh[] = [];
const geos = [new THREE.TorusKnotGeometry(22, 7, 96, 12), new THREE.IcosahedronGeometry(28, 0), new THREE.BoxGeometry(40, 40, 40), new THREE.ConeGeometry(26, 56, 6)];
const names = ["knot", "ico", "cube", "cone"];
for (let i = 0; i < 24; i++) {
  const a = (i / 24) * Math.PI * 2, rad = 120 + (i % 3) * 110;
  const m = new THREE.Mesh(geos[i % 4], new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(i / 24, 0.65, 0.55), roughness: 0.35, metalness: 0.2 }));
  m.position.set(Math.cos(a) * rad, 40, Math.sin(a) * rad);
  m.name = `${names[i % 4]} ${i + 1}`;
  world.add(m);
  shapes.push(m);
}

const ray = new THREE.Raycaster();
const pick = (px: { x: number; y: number } | null) => {
  if (!px) return null;
  const r = surface.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2((px.x / r.width) * 2 - 1, -(px.y / r.height) * 2 + 1), camera);
  return (ray.intersectObjects(shapes)[0]?.object as THREE.Mesh | undefined) ?? null;
};
let hovered: THREE.Mesh | null = null;
let picked: THREE.Mesh | null = null;
const glow = (m: THREE.Mesh | null, v: number) => { if (m) (m.material as THREE.MeshStandardMaterial).emissive.setScalar(v); };
const refreshGlow = () => { shapes.forEach((s) => glow(s, s === picked ? 0.55 : s === hovered ? 0.25 : 0)); };

let resetting = 0;
const resize = () => {
  const r = surface.getBoundingClientRect();
  renderer.setSize(r.width, r.height);
  camera.aspect = r.width / r.height;
  camera.updateProjectionMatrix();
};
window.addEventListener("resize", resize);
resize();
const frame = () => {
  shapes.forEach((s, i) => { s.rotation.y += 0.004 + i * 0.0002; });
  if (resetting) {
    camera.position.lerp(HOME.pos, 0.12);
    target.lerp(HOME.target, 0.12);
    camera.lookAt(target);
    if (camera.position.distanceTo(HOME.pos) < 0.5) resetting = 0;
  }
};
renderer.setAnimationLoop(() => {
  frame();
  renderer.render(scene, camera);
});

// pick a shape and swing the view to centre it, keeping the camera's offset
function centreOn(m: THREE.Mesh) {
  picked = m;
  pickLabel.innerHTML = `Picked <b>${m.name}</b>.`;
  const off = camera.position.clone().sub(target);
  target.copy(m.position);
  camera.position.copy(m.position).add(off);
  camera.lookAt(target);
  refreshGlow();
}

const shell = mountShell({
  page: "three",
  surface,
  findTarget: () => {
    const v = shapes[6].position.clone().project(camera);
    return { x: (v.x + 1) / 2, y: (1 - v.y) / 2 };
  },
  makeAdapter: (s) => createOrbitAdapter({
    getView: () => ({ camera, target, element: surface }),
    panGain: s.panGain,
    zoomGain: s.zoomGain,
    momentum: s.momentum ? {} : false,
    onHover: (_at, px) => { hovered = pick(px); refreshGlow(); return hovered ? { id: hovered.uuid, label: hovered.name } : null; },
    // d-pad: hop to the shape that lies most nearly that way on screen
    onStep: (dir) => {
      const r = surface.getBoundingClientRect();
      const scr = (m: THREE.Mesh) => { const v = m.position.clone().project(camera); return { x: ((v.x + 1) / 2) * r.width, y: ((1 - v.y) / 2) * r.height, behind: v.z > 1 }; };
      const from = picked ? scr(picked) : { x: r.width / 2, y: r.height / 2 };
      const to = pickStep(from, dir, shapes.filter((m) => m !== picked).map((m) => ({ id: m.uuid, ...scr(m) })).filter((c) => !c.behind));
      const m = shapes.find((x) => x.uuid === to);
      if (m) centreOn(m);
    },
    onSelect: (_at, px) => {
      picked = pick(px);
      pickLabel.innerHTML = picked ? `Picked <b>${picked.name}</b>.` : "";
      refreshGlow();
    },
    onReset: () => { resetting = 1; picked = null; pickLabel.innerHTML = ""; refreshGlow(); },
  }),
});
(window as unknown as Record<string, unknown>).__lab = { shell, camera, target, shapes, world, renderer, cameraStats, picked: () => picked?.name ?? null, hovered: () => hovered?.name ?? null };

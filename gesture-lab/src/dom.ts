import { createDomAdapter } from "cortex-gesture";
import { mountShell } from "./shell";

const root = document.getElementById("root")!;
root.innerHTML = `<div class="page-title"><b>BOARD</b> · plain DOM, no three.js: the same gestures on a CSS transform</div>
  <div class="board-surface"><div class="board"></div></div>`;
const surface = root.querySelector<HTMLElement>(".board-surface")!;
const board = root.querySelector<HTMLElement>(".board")!;
const words = ["Tide", "Ember", "Moss", "Signal", "Quarry", "Halo", "Drift", "Copper", "Lumen", "Grain", "Vapor", "Atlas",
  "Fern", "Static", "Basalt", "Orbit", "Saffron", "Dune", "Cinder", "Glass", "Marrow", "Pylon", "Linen", "Echo"];
board.innerHTML = words.map((w, i) => {
  const h = (i * 47) % 360;
  return `<div class="card" data-gesture-item style="--sw: linear-gradient(135deg, hsl(${h} 70% 45%), hsl(${(h + 60) % 360} 70% 25%))"><span>${w}</span></div>`;
}).join("");
board.addEventListener("click", (e) => {
  const c = (e.target as HTMLElement).closest(".card");
  if (c) c.toggleAttribute("data-picked");
});

const shell = mountShell({
  page: "board",
  surface,
  findTarget: () => {
    const r = surface.getBoundingClientRect();
    const c = board.children[8].getBoundingClientRect();
    return { x: (c.left + c.width / 2 - r.left) / r.width, y: (c.top + c.height / 2 - r.top) / r.height };
  },
  makeAdapter: (s) => createDomAdapter({ target: board, surface, momentum: s.momentum ? {} : false }),
});
(window as unknown as Record<string, unknown>).__lab = { shell };

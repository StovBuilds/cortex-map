// Plain-DOM adapter: drives a CSS transform on one element (pan / zoom /
// rotate), hovers and clicks whatever is under the cursor. Proves the events
// aren't cortex-map-specific: point it at an image, a board of cards, a map.

import type { GestureAdapter, GestureEvent, Point } from "../types";
import { Momentum, cancelFrame, nextFrame, type MomentumOptions } from "../momentum";
import { pointInPolygon } from "../geometry";

export interface DomAdapterOptions {
  /** The element to transform. */
  target: HTMLElement;
  /** The element whose box defines surface coords (usually the target's parent). */
  surface: HTMLElement;
  /** CSS selector for things that can be hovered / clicked. */
  itemSelector?: string;
  minScale?: number;
  maxScale?: number;
  /** Attribute toggled on the hovered item (style it in CSS). */
  hoverAttr?: string;
  /** Flick to glide / spin. false turns it off. */
  momentum?: Partial<MomentumOptions> | false;
}

export function createDomAdapter(o: DomAdapterOptions): GestureAdapter {
  let tx = 0, ty = 0, scale = 1, rot = 0, tilt = 0;
  // head window mode: the board turns a little against the eye, like a picture behind glass
  let look = { x: 0, y: 0 };
  const momentum = o.momentum === false ? null : new Momentum(o.momentum || {});
  let glideRaf = 0;
  const stopGlide = () => { momentum?.stop(); if (glideRaf) cancelFrame(glideRaf); glideRaf = 0; };
  let hovered: Element | null = null;
  const ids = new WeakMap<Element, string>();
  let nextId = 0;
  const attr = o.hoverAttr ?? "data-gesture-hover";
  const apply = () => {
    o.target.style.transformOrigin = "50% 50%";
    // tilt (head / gamepad pitch) lays the board back like a table top
    const win = look.x || look.y ? ` rotateY(${(-look.x * 0.22).toFixed(4)}rad) rotateX(${(look.y * 0.18).toFixed(4)}rad)` : "";
    o.target.style.transform = `translate(${tx}px, ${ty}px) perspective(1400px)${win} rotateX(${tilt}rad) rotate(${rot}rad) scale(${scale})`;
  };
  const client = (p: Point) => {
    const r = o.surface.getBoundingClientRect();
    return { x: r.left + p.x * r.width, y: r.top + p.y * r.height };
  };
  const itemAt = (p: Point) => {
    const c = client(p);
    // the overlay canvas is pointer-events:none, so this sees through it
    const el = document.elementFromPoint(c.x, c.y);
    return el?.closest(o.itemSelector ?? "[data-gesture-item]") ?? null;
  };
  // zoom / rotate about a point (the hands' midpoint), not the element centre
  let pivot: Point = { x: 0.5, y: 0.5 };
  const spin = (at: Point, sc: number, rotate: number, dx: number, dy: number) => {
    pivot = at;
    const r = o.surface.getBoundingClientRect();
    const box = o.target.getBoundingClientRect();
    const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
    const m = client(at);
    const k = Math.min(o.maxScale ?? 6, Math.max(o.minScale ?? 0.2, scale * sc)) / scale;
    const vx = cx - m.x, vy = cy - m.y;
    const c = Math.cos(rotate), s = Math.sin(rotate);
    const nx = (vx * c - vy * s) * k, ny = (vx * s + vy * c) * k;
    tx += nx - vx + dx * r.width;
    ty += ny - vy + dy * r.height;
    scale *= k;
    rot += rotate;
    apply();
  };
  const glide = () => {
    glideRaf = 0;
    const m = momentum?.step(performance.now());
    if (!m) return;
    spin(pivot, Math.exp(m.zoom), m.rotate, m.dx, m.dy);
    glideRaf = nextFrame(glide);
  };
  const setHover = (el: Element | null) => {
    if (el === hovered) return;
    hovered?.removeAttribute(attr);
    hovered = el;
    hovered?.setAttribute(attr, "");
  };

  return {
    handle(e: GestureEvent) {
      const r = o.surface.getBoundingClientRect();
      switch (e.type) {
        case "hover": setHover(e.at ? itemAt(e.at) : null); return;
        case "press": stopGlide(); return;
        case "panstart": case "twostart": stopGlide(); return;
        case "panend": case "twoend":
          if (momentum?.release(performance.now()) && !glideRaf) glideRaf = nextFrame(glide);
          return;
        case "dialstart": stopGlide(); return;
        // a zoom knob: clockwise = in, about the middle
        case "dial": spin({ x: 0.5, y: 0.5 }, Math.exp(e.delta * 0.8), 0, 0, 0); return;
        case "view": look = { x: e.x, y: e.y }; apply(); return;
        case "drawend": {
          // a loop clicks everything inside it
          if (!e.closed) return;
          const sr = o.surface.getBoundingClientRect();
          o.target.querySelectorAll<HTMLElement>(o.itemSelector ?? "[data-gesture-item]").forEach((el) => {
            const b = el.getBoundingClientRect();
            if (pointInPolygon({ x: (b.left + b.width / 2 - sr.left) / sr.width, y: (b.top + b.height / 2 - sr.top) / sr.height }, e.path)) el.click();
          });
          return;
        }
        case "select": {
          stopGlide();
          const el = itemAt(e.at);
          if (el) (el as HTMLElement).click();
          return;
        }
        case "pan":
          momentum?.sample(performance.now(), { dx: e.dx, dy: e.dy });
          tx += e.dx * r.width; ty += e.dy * r.height; apply(); return;
        case "transform":
          momentum?.sample(performance.now(), { dx: e.dx, dy: e.dy, rotate: e.rotate, zoom: Math.log(e.scale || 1) });
          spin(e.at, e.scale, e.rotate, e.dx, e.dy);
          return;
        case "orbit":
          stopGlide();
          tx += e.dx * r.width; ty += e.dy * r.height;
          rot += e.yaw;
          tilt = Math.max(0, Math.min(1.1, tilt + e.pitch));
          scale = Math.min(o.maxScale ?? 6, Math.max(o.minScale ?? 0.2, scale * Math.exp(e.zoom)));
          apply();
          return;
        case "reset":
          stopGlide();
          tx = 0; ty = 0; scale = 1; rot = 0; tilt = 0;
          o.target.style.transition = "transform 0.5s cubic-bezier(.2,.8,.2,1)";
          apply();
          window.setTimeout(() => { o.target.style.transition = ""; }, 520);
          return;
      }
    },
    detach() { stopGlide(); setHover(null); if (look.x || look.y) { look = { x: 0, y: 0 }; apply(); } },
    target: () => {
      if (!hovered) return null;
      if (!ids.has(hovered)) ids.set(hovered, `item-${nextId++}`);
      return { id: ids.get(hovered)!, label: hovered.textContent?.trim().slice(0, 40) || undefined };
    },
  };
}

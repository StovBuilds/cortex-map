// Floating cards pulled out of a map: pick a node up (pinch held still, then
// drag) and it comes away as a card that follows your hand; let go and it
// stays pinned there, over everything. The mouse can move or close cards too.
// Plain DOM, no framework; style hooks are the .cg-card classes.

export interface CardContent { title: string; subtitle?: string; body?: string; color?: string }

export interface LiftedCard {
  /** Follow the hand (client px). */
  move(x: number, y: number): void;
  /** Let go: pin it where it is. */
  drop(): void;
  /** Never mind: it goes back. */
  cancel(): void;
}

const CSS = `
.cg-pinboard { position: fixed; inset: 0; pointer-events: none; z-index: 2147482990; }
.cg-card { position: absolute; width: 230px; pointer-events: auto; background: rgba(6,12,24,.92); color: #e6eefc;
  border: 1px solid rgba(150,210,255,.35); border-radius: 10px; padding: 10px 12px 11px; font: 12px/1.45 ui-sans-serif, system-ui, sans-serif;
  box-shadow: 0 10px 30px rgba(0,0,0,.45), 0 0 0 1px rgba(0,0,0,.2); transform: translate(-50%, -50%); cursor: grab; user-select: none; }
.cg-card.cg-lifted { transform: translate(-50%, -50%) scale(1.06) rotate(-1.5deg); box-shadow: 0 22px 50px rgba(0,0,0,.55), 0 0 24px rgba(127,214,255,.25); transition: none; }
.cg-card.cg-landing { transition: transform .18s ease-out, box-shadow .18s ease-out; }
.cg-card h4 { margin: 0 22px 2px 0; font-size: 13px; font-weight: 650; }
.cg-card .cg-sub { display: flex; gap: 6px; align-items: center; color: #9fb3cf; font-size: 11px; margin-bottom: 4px; }
.cg-card .cg-dot { width: 8px; height: 8px; border-radius: 50%; }
.cg-card p { margin: 0; color: #c9d6ea; max-height: 7.5em; overflow: hidden; }
.cg-card button { position: absolute; top: 6px; right: 6px; width: 24px; height: 24px; border: 0; border-radius: 6px; background: transparent; color: #9fb3cf; font-size: 16px; cursor: pointer; }
.cg-card button:hover, .cg-card button:focus-visible { background: rgba(150,210,255,.15); color: #fff; }
`;

export class Pinboard {
  readonly el: HTMLDivElement;
  constructor(root: HTMLElement = document.body) {
    if (!document.getElementById("cg-pinboard-css")) {
      const st = document.createElement("style");
      st.id = "cg-pinboard-css";
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    this.el = document.createElement("div");
    this.el.className = "cg-pinboard";
    root.appendChild(this.el);
  }

  /** Cards pinned now. */
  get cards(): HTMLElement[] { return Array.from(this.el.querySelectorAll<HTMLElement>(".cg-card:not(.cg-lifted)")); }

  /** Start carrying a new card from client point (x, y). */
  lift(c: CardContent, x: number, y: number): LiftedCard {
    const card = document.createElement("div");
    card.className = "cg-card cg-lifted";
    card.setAttribute("role", "note");
    const esc = (v: string) => v.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]!));
    card.innerHTML = `<h4>${esc(c.title)}</h4>${c.subtitle ? `<div class="cg-sub">${c.color ? `<span class="cg-dot" style="background:${esc(c.color)}"></span>` : ""}${esc(c.subtitle)}</div>` : ""}${c.body ? `<p>${esc(c.body)}</p>` : ""}<button type="button" aria-label="Close card" data-pin-close>×</button>`;
    const place = (px: number, py: number) => {
      const m = 20;
      card.style.left = `${Math.max(115 + m, Math.min(window.innerWidth - 115 - m, px))}px`;
      card.style.top = `${Math.max(60 + m, Math.min(window.innerHeight - 60 - m, py))}px`;
    };
    place(x, y);
    this.el.appendChild(card);
    card.querySelector("button")!.addEventListener("click", (e) => { e.stopPropagation(); card.remove(); });
    // the mouse can move pinned cards too
    card.addEventListener("pointerdown", (e) => {
      if ((e.target as HTMLElement).closest("button")) return;
      const ox = e.clientX - card.offsetLeft, oy = e.clientY - card.offsetTop;
      card.setPointerCapture(e.pointerId);
      const mv = (ev: PointerEvent) => place(ev.clientX - ox, ev.clientY - oy);
      const up = () => { card.removeEventListener("pointermove", mv); card.removeEventListener("pointerup", up); };
      card.addEventListener("pointermove", mv);
      card.addEventListener("pointerup", up);
    });
    let done = false;
    return {
      move: (px, py) => { if (!done) place(px, py); },
      drop: () => {
        if (done) return;
        done = true;
        card.classList.add("cg-landing");
        card.classList.remove("cg-lifted");
        window.setTimeout(() => card.classList.remove("cg-landing"), 200);
      },
      cancel: () => { if (!done) { done = true; card.remove(); } },
    };
  }

  /** If a card's close button is at this client point, press it. True = handled. */
  pressAt(x: number, y: number): boolean {
    const el = document.elementFromPoint(x, y);
    const btn = el?.closest<HTMLElement>(".cg-card [data-pin-close]");
    if (btn) { btn.click(); return true; }
    return false;
  }

  clear() { this.el.replaceChildren(); }
  dispose() { this.el.remove(); }
}

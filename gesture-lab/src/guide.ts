// First-run guide: three steps (point, pinch, open palm), each ticked off when
// it sees you do it, then it gets out of the way. Shows itself the first time
// Hands goes on; "Show me the basics" brings it back.

import type { GestureController, GestureEvent } from "cortex-gesture";

const KEY = "gesture-lab:guided";
/** Pointing this long anywhere counts, even with nothing under the cursor. */
const POINT_MS = 2500;

export interface GuideUI {
  show(): void;
  hide(): void;
  /** Steps done so far, 0 … 3. */
  step(): number;
  visible(): boolean;
  /** Has it been seen through (or skipped) in this browser? */
  done(): boolean;
}

export function mountGuide(o: { controller: GestureController; access: () => boolean; say: (s: string) => void }): GuideUI {
  const el = document.createElement("section");
  el.className = "gl-guide";
  el.hidden = true;
  el.setAttribute("aria-label", "Getting started");
  el.setAttribute("aria-live", "polite");
  document.body.appendChild(el);

  let step = 0;
  let pointing = 0, lastT = 0;
  let closeTimer = 0;
  const steps = () => [
    { title: "Point at something", how: "Hold a hand up, palm to the camera, and point. The ring follows your finger." },
    o.access()
      ? { title: "Point and hold still to select", how: "Rest the ring on something: it fills, then it's picked." }
      : { title: "Pinch to select", how: "Point at something, then touch thumb and finger together and let go." },
    { title: "Open palm, hold still", how: "Show a flat hand for a second: the view goes back to the start." },
  ];

  const render = () => {
    const s = steps();
    const finished = step >= s.length;
    el.innerHTML = `<header><b>${finished ? "You've got the basics" : `Getting started · ${step + 1} of ${s.length}`}</b>
        <button class="gl-x" data-guide="skip" aria-label="${finished ? "Close" : "Skip the guide"}">×</button></header>
      <ol>${s.map((x, i) => `<li class="${i < step ? "gl-done" : i === step ? "gl-now" : ""}"><span>${i < step ? "✓" : i + 1}</span><div><b>${x.title}</b>${i === step ? `<small>${x.how}</small>` : ""}</div></li>`).join("")}</ol>
      <p class="gl-tip">${finished ? "Press <kbd>?</kbd> (or say “help”) any time to see every move." : "Press <kbd>?</kbd> for every move."}</p>`;
  };

  const advance = () => {
    step++;
    render();
    if (step >= steps().length) {
      o.say("Guide: done. Press ? any time for every move.");
      try { localStorage.setItem(KEY, "1"); } catch { /* private mode */ }
      closeTimer = window.setTimeout(() => ui.hide(), 4000);
    }
  };

  o.controller.on((events: GestureEvent[], state) => {
    if (el.hidden || step >= 3) return;
    const t = performance.now();
    const dt = lastT ? Math.min(100, t - lastT) : 0;
    lastT = t;
    if (step === 0) {
      const onSomething = events.some((e) => e.type === "hover" && e.at) && !!o.controller.feedback.target;
      pointing = state.hands.length ? pointing + dt : 0;
      if (onSomething || pointing > POINT_MS) advance();
    } else if (step === 1) {
      if (events.some((e) => e.type === "select" && e.at.x >= 0)) advance();
    } else if (step === 2) {
      if (events.some((e) => e.type === "reset")) advance();
    }
  });

  el.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("[data-guide=skip]")) {
      try { localStorage.setItem(KEY, "1"); } catch { /* private mode */ }
      ui.hide();
    }
  });

  const ui: GuideUI = {
    show() { clearTimeout(closeTimer); step = 0; pointing = 0; lastT = 0; render(); el.hidden = false; },
    hide() { clearTimeout(closeTimer); el.hidden = true; },
    step: () => step,
    visible: () => !el.hidden,
    done: () => { try { return localStorage.getItem(KEY) === "1"; } catch { return true; } },
  };
  return ui;
}

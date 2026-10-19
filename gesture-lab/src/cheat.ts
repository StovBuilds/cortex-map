// The cheat card: every move for what's switched on (hands, head, controller,
// your own gestures) on one card. Press ? or click the ? in the panel.
// Esc or ? again closes it.
//
// It reads the moves straight out of the panel's sheets, so there is one list
// of moves to keep up to date, not two.

export interface CheatUI { open(): void; close(): void; toggle(): void; isOpen(): boolean }

const INPUTS = [
  { key: "hands", label: "Hands" },
  { key: "head", label: "Head" },
  { key: "pad", label: "Controller" },
] as const;

export function mountCheat(o: {
  panel: HTMLElement;
  /** Which inputs are on right now. */
  on: () => Record<(typeof INPUTS)[number]["key"], boolean>;
  /** The user's own hand shapes and what each does. */
  custom: () => [string, string][];
}): CheatUI {
  const el = document.createElement("div");
  el.className = "gl-cheat";
  el.hidden = true;
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-label", "Every move");
  el.tabIndex = -1;
  document.body.appendChild(el);
  let back: HTMLElement | null = null;

  const render = () => {
    const on = o.on();
    const any = INPUTS.some((i) => on[i.key]);
    const shown = any ? INPUTS.filter((i) => on[i.key]) : INPUTS;
    const cols = shown.map((i) => {
      const list = o.panel.querySelector(`[data-sheet=${i.key}] .gl-moves`)?.innerHTML ?? "";
      return `<section><h3>${i.label}${on[i.key] ? ' <small class="gl-on-tag">on</small>' : ""}</h3><ul class="gl-moves">${list}</ul></section>`;
    });
    const custom = o.custom();
    if (custom.length && (!any || on.hands)) cols.push(`<section><h3>Your gestures</h3><ul class="gl-moves">${custom.map(([n, a]) => `<li><b>${esc(n)}</b> ${esc(a)}</li>`).join("")}</ul></section>`);
    const off = INPUTS.filter((i) => !on[i.key]).map((i) => i.label);
    el.innerHTML = `<div class="gl-cheat-card">
      <header><b>Every move</b><button class="gl-x" data-cheat="close" aria-label="Close">×</button></header>
      <p class="gl-tip">${any ? `Showing what's on.${off.length ? ` Off: ${off.join(", ")}.` : ""}` : "Nothing's switched on yet, so here's everything. Turn an input on in the panel."}</p>
      <div class="gl-cheat-cols">${cols.join("")}</div>
      <p class="gl-tip"><kbd>?</kbd> or <kbd>Esc</kbd> closes this · say “help” to open it</p>
    </div>`;
  };

  const ui: CheatUI = {
    open() { back = document.activeElement as HTMLElement | null; render(); el.hidden = false; el.focus(); },
    close() { if (el.hidden) return; el.hidden = true; back?.focus?.(); },
    toggle() { if (el.hidden) ui.open(); else ui.close(); },
    isOpen: () => !el.hidden,
  };
  el.addEventListener("click", (e) => {
    // the close button, or a click on the backdrop outside the card
    if ((e.target as HTMLElement).closest("[data-cheat=close]") || e.target === el) ui.close();
  });
  window.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest("input, textarea, select, [contenteditable]")) return;
    if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); ui.toggle(); }
    else if (e.key === "Escape" && !el.hidden) { e.preventDefault(); ui.close(); }
  });
  return ui;
}

const esc = (s: string) => s.replace(/[<&>"]/g, (c) => ({ "<": "&lt;", "&": "&amp;", ">": "&gt;", '"': "&quot;" })[c]!);

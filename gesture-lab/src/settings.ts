// Feel knobs, tweakable from the panel and remembered per browser.

export interface Settings {
  smoothing: number;   // One Euro minCutoff (Hz): lower = steadier
  response: number;    // One Euro beta: higher = less lag on fast moves
  pinch: number;       // pinchOn threshold; pinchOff = +0.15
  panGain: number;
  zoomGain: number;
  preview: boolean;
  headSpeed: number;   // multiplies head steering rates
  invertYaw: boolean;
  invertPitch: boolean;
  padSpeed: number;
  invertY: boolean;
  sound: boolean;
  momentum: boolean;   // flick to glide / spin
  headMode: "steer" | "window";
  dwell: boolean;      // head: look at a node to select it
  dwellMs: number;
  /** Accessibility mode: point and hold to select, steadier cursor, bigger targets and cursor, no glide, reads out what it's on. */
  access: boolean;
  /** …and speak it aloud too (not just to a screen reader). */
  speak: boolean;
  /** Panel preset: everything shown, a simple panel (basics only, no glide), or easy access. */
  preset: "everything" | "simple" | "access";
}

export const DEFAULTS: Settings = { smoothing: 1.1, response: 9, pinch: 0.3, panGain: 1, zoomGain: 1.4, preview: true,
  headSpeed: 1, invertYaw: false, invertPitch: false, padSpeed: 1, invertY: false,
  sound: true, momentum: true, headMode: "steer", dwell: true, dwellMs: 1000,
  access: false, speak: false, preset: "everything" };
const KEY = "gesture-lab:settings";

export function loadSettings(): Settings {
  try {
    const s = JSON.parse(window.localStorage.getItem(KEY) ?? "null");
    return { ...DEFAULTS, ...(s && typeof s === "object" ? s : {}) };
  } catch { return { ...DEFAULTS }; }
}

export function saveSettings(s: Settings) {
  try { window.localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ }
}

export const PRESETS: { id: Settings["preset"]; label: string; hint: string; set: Partial<Settings> }[] = [
  { id: "simple", label: "Simple", hint: "The basics only: point, pinch, drag, reset. No glide.", set: { momentum: false, access: false } },
  { id: "everything", label: "Everything", hint: "Every move and every panel.", set: { momentum: true, access: false } },
  { id: "access", label: "Easy access", hint: "Point and hold to click, a steadier, bigger cursor, read-outs, no glide.", set: { access: true } },
];

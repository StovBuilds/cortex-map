// Spoken text → a command. Pure: the speech-to-text happens elsewhere (on the
// device, or a provider you bring a key for); this just reads what was said.
//
//   "fly to <name>", "go to …", "show me …", "find …", "take me to …"
//   "connect <a> and <b>", "how is <a> connected to <b>", "path from <a> to <b>"
//   "spread <cluster>", "open up <cluster>", "pull apart …"
//   "pin <name>", "pull out …"
//   "select" / "pick this" / "that one", "clear", "reset" / "home" / "start again"
//   "zoom in" / "closer", "zoom out" / "back", "turn left / right", "look up / down", "stop"
//   "help" / "what can I say" / "show the moves": the app shows its cheat card

export type VoiceCommand =
  | { kind: "fly"; name: string }
  | { kind: "path"; from: string; to: string }
  | { kind: "spread"; name: string }
  | { kind: "pin"; name: string }
  | { kind: "select" }
  | { kind: "clear" }
  | { kind: "reset" }
  | { kind: "zoom"; dir: 1 | -1 }
  | { kind: "turn"; dir: 1 | -1 }
  | { kind: "tilt"; dir: 1 | -1 }
  | { kind: "stop" }
  | { kind: "help" };

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
// filler a speech model adds or people say
const stripFiller = (s: string) => s.replace(/^(?:(?:ok|okay|hey|um|uh|so|please|can you|could you|now|and|then|right)\s+)+/, "").replace(/\s+(?:please|now|thanks|thank you)$/, "").trim();
const name = (s: string) => s.replace(/^(?:the|a|an|my)\s+/, "").replace(/\s+(?:node|one|cluster|group)$/, "").trim();

export function parseCommand(text: string): VoiceCommand | null {
  const t = stripFiller(norm(text));
  if (!t) return null;
  let m: RegExpMatchArray | null;
  if (/^(?:help|help me|what can i (?:say|do)|what do i (?:say|do)|(?:show|open)(?: me)? (?:the )?(?:help|moves|gestures|commands|cheat ?sheet|cheat card))$/.test(t)) return { kind: "help" };
  if ((m = t.match(/^(?:how (?:is|are|does) (.+?) (?:connected|linked|connect|link) (?:to|with) (.+)|(?:connect|link|join) (.+?) (?:and|to|with) (.+)|(?:path|route|way) (?:from|between) (.+?) (?:to|and) (.+))$/))) {
    const [a, b] = [m[1] ?? m[3] ?? m[5], m[2] ?? m[4] ?? m[6]];
    return { kind: "path", from: name(a), to: name(b) };
  }
  if ((m = t.match(/^(?:spread|open up|expand|pull apart|explode)(?: out)? (.+)$/))) return { kind: "spread", name: name(m[1]) };
  if ((m = t.match(/^(?:pin|pull out|take out|lift out|card for|grab) (.+)$/))) {
    const n = name(m[1]);
    if (n !== "this" && n !== "that") return { kind: "pin", name: n };
  }
  // speech models often hear "fly to" as "flight" / "fly" / "fight to"
  if ((m = t.match(/^(?:fly|go|jump|zoom|move|head) (?:over |across )?(?:to|into|in to) (.+)$|^(?:show me|show|find|take me to|where is|wheres|focus on|look at) (.+)$|^(?:flight|flights|fly|fight|flied)(?: to| too| two)? (.+)$/))) {
    const n = name(m[1] ?? m[2] ?? m[3]);
    if (n && !/^(in|out|left|right|up|down|this|that|it)$/.test(n)) return { kind: "fly", name: n };
  }
  if (/^(?:reset|home|go home|start again|start over|back to (?:the )?start|reset (?:the )?view)$/.test(t)) return { kind: "reset" };
  if (/^(?:clear|deselect|clear (?:the )?selection|never ?mind|cancel)$/.test(t)) return { kind: "clear" };
  if (/^(?:select|pick|choose)(?: (?:this|that|it))?(?: one)?$|^(?:this|that) one$/.test(t)) return { kind: "select" };
  if (/^(?:zoom in|closer|come closer|get closer|in)$/.test(t)) return { kind: "zoom", dir: 1 };
  if (/^(?:zoom out|further|further out|back|back out|out)$/.test(t)) return { kind: "zoom", dir: -1 };
  if ((m = t.match(/^(?:turn|rotate|spin|look) (left|right)$/))) return { kind: "turn", dir: m[1] === "right" ? 1 : -1 };
  if ((m = t.match(/^(?:look|tilt|go|fly) (up|down|over the top|under(?:neath)?)$/))) return { kind: "tilt", dir: m[1] === "up" || m[1] === "over the top" ? 1 : -1 };
  if (/^(?:stop|freeze|hold it|wait)$/.test(t)) return { kind: "stop" };
  return null;
}

/** Edit distance, for fuzzy name matching. */
function lev(a: string, b: string): number {
  const v = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = v[0]; v[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = v[j];
      v[j] = Math.min(v[j] + 1, v[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return v[b.length];
}

/** How alike a spoken name and a label are, 0..1: whole-string closeness and word overlap, whichever is better. */
export function nameScore(spoken: string, label: string): number {
  const a = norm(spoken), b = norm(label);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const whole = 1 - lev(a, b) / Math.max(a.length, b.length);
  const wa = a.split(" "), wb = b.split(" ");
  // each spoken word against its best label word (speech models garble single words)
  const words = wa.reduce((s, w) => s + Math.max(...wb.map((x) => 1 - lev(w, x) / Math.max(w.length, x.length))), 0) / Math.max(wa.length, wb.length);
  const contains = b.includes(a) || a.includes(b) ? 0.9 : 0;
  return Math.max(whole, words, contains);
}

/** The best-matching candidate for a spoken name, or null if nothing is close enough. */
export function bestMatch<T>(spoken: string, items: T[], label: (t: T) => string, min = 0.62): { item: T; score: number } | null {
  let best: { item: T; score: number } | null = null;
  for (const it of items) {
    const s = nameScore(spoken, label(it));
    if (s >= min && (!best || s > best.score)) best = { item: it, score: s };
  }
  return best;
}

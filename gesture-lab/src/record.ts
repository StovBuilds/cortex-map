// Record & replay: the landmark streams from whichever inputs are on (never
// the video), replayed through the same controllers. Save as a small JSON
// file, load one back.

import { Recorder, parseRecording, replay, type GamepadController, type GestureController, type HeadController, type Recording } from "cortex-gesture";

export interface RecordUI {
  recorder: Recorder;
  last: () => Recording | null;
  load: (r: Recording) => void;
  replay: (speed?: number) => Promise<void>;
}

export function mountRecord(o: {
  sheet: HTMLElement;
  page: string;
  controller: GestureController;
  head: HeadController;
  pad: GamepadController;
  say: (s: string) => void;
}): RecordUI {
  const recorder = new Recorder();
  let last: Recording | null = null;
  let playing: AbortController | null = null;
  let timer = 0;

  o.sheet.innerHTML = `<summary>Record &amp; replay</summary>
    <p class="gl-tip">Records what the trackers read (hand points, head angles, controller sticks) from whichever inputs are on. No video, no sound. Replay it to watch a session again, or save it to share.</p>
    <div class="gl-row gl-recrow">
      <button class="gl-btn gl-small" data-rec="rec">● Record</button>
      <button class="gl-btn gl-small" data-rec="play" disabled>▶ Replay</button>
      <button class="gl-btn gl-small" data-rec="save" disabled>Save</button>
      <button class="gl-btn gl-small" data-rec="load">Load</button>
      <input type="file" accept="application/json,.json" data-rec="file" hidden>
    </div>
    <p class="gl-tip" data-ref="rec-info" aria-live="polite">Nothing recorded yet.</p>`;
  const $ = <T extends HTMLElement>(s: string) => o.sheet.querySelector(s) as T;
  const recBtn = $<HTMLButtonElement>("[data-rec=rec]");
  const playBtn = $<HTMLButtonElement>("[data-rec=play]");
  const saveBtn = $<HTMLButtonElement>("[data-rec=save]");
  const info = $<HTMLElement>("[data-ref=rec-info]");

  const describe = (r: Recording) => {
    const parts = [r.hands && "hands", r.head && "head", r.pad && "controller"].filter(Boolean).join(" + ");
    const kb = Math.round(JSON.stringify(r).length / 1024);
    return `${(r.ms / 1000).toFixed(1)} s of ${parts || "nothing"} · about ${kb} KB${r.where && r.where !== o.page ? ` · recorded on ${r.where}` : ""}`;
  };
  const sync = () => {
    recBtn.textContent = recorder.recording ? "■ Stop" : "● Record";
    recBtn.classList.toggle("gl-on", recorder.recording);
    playBtn.textContent = playing ? "■ Stop" : "▶ Replay";
    playBtn.disabled = !last || recorder.recording;
    saveBtn.disabled = !last || recorder.recording;
    recBtn.disabled = !!playing;
  };
  const set = (r: Recording) => { last = r; info.textContent = describe(r); sync(); };

  const ui: RecordUI = {
    recorder,
    last: () => last,
    load: set,
    async replay(speed = 1) {
      if (!last || playing) return;
      // live inputs would talk over the replay
      const live = [o.controller.running && "hands", o.head.running && "head", o.pad.running && "the controller"].filter(Boolean);
      if (live.length) { o.say(`Replay: switch ${live.join(" and ")} off first.`); return; }
      playing = new AbortController();
      sync();
      o.say(`Replaying ${describe(last)}`);
      await replay(last, { hands: (f) => o.controller.feed(f), head: (f) => o.head.feed(f), pad: (f) => o.pad.feed(f) }, {
        signal: playing.signal, speed,
        onProgress: (k) => { playBtn.textContent = `■ Stop ${Math.round(k * 100)}%`; },
      });
      playing = null;
      sync();
      o.say("Replay finished.");
    },
  };

  o.sheet.addEventListener("click", (e) => {
    const k = (e.target as HTMLElement).closest<HTMLElement>("[data-rec]")?.dataset.rec;
    if (k === "rec") {
      if (recorder.recording) {
        window.clearInterval(timer);
        const r = recorder.stop();
        if (r && (r.hands || r.head || r.pad)) { set(r); o.say(`Recorded ${describe(r)}`); }
        else { o.say("Nothing came in: turn on hands, head or a controller, then record."); sync(); }
        return;
      }
      const on = { hands: o.controller.running, head: o.head.running, pad: o.pad.running };
      if (!on.hands && !on.head && !on.pad) { o.say("Record: turn on hands, head or a controller first."); return; }
      recorder.start({ hands: on.hands ? o.controller : undefined, head: on.head ? o.head : undefined, pad: on.pad ? o.pad : undefined }, o.page);
      timer = window.setInterval(() => { info.textContent = `Recording… ${(recorder.elapsed / 1000).toFixed(0)} s`; }, 500);
      info.textContent = "Recording…";
      sync();
    } else if (k === "play") {
      if (playing) playing.abort(); else void ui.replay();
    } else if (k === "load") {
      $<HTMLInputElement>("[data-rec=file]").click();
    } else if (k === "save" && last) {
      const url = URL.createObjectURL(new Blob([JSON.stringify(last)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `gestures-${o.page}-${last.recordedAt.slice(0, 19).replace(/[:T]/g, "-")}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  });
  $<HTMLInputElement>("[data-rec=file]").addEventListener("change", async (e) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = "";
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) { o.say("Load: that file is too big for a recording."); return; }
    try { set(parseRecording(JSON.parse(await f.text()))); o.say(`Loaded ${describe(last!)}`); }
    catch (err) { o.say(`Load: ${err instanceof Error ? err.message : "couldn't read that file"}.`); }
  });
  sync();
  return ui;
}

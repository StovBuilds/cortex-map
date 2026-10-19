// Child servers for the e2e scripts (vite preview, wrangler dev), each in its
// own process group so the whole tree (npx → sh → node) goes down together,
// and torn down however this script ends: normally, on a failed check, a
// thrown error, Ctrl-C, or a parent's timeout (SIGTERM). Only a SIGKILL can
// still leave one behind.
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const groups = new Set();
const killGroup = (pid) => { try { process.kill(-pid, "SIGTERM"); } catch { /* gone */ } };
const stopAll = () => { for (const pid of groups) killGroup(pid); groups.clear(); };

process.on("exit", stopAll); // runs after uncaught errors too
for (const [sig, code] of [["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]]) process.on(sig, () => { stopAll(); process.exit(code); });

/** Start a command in its own process group; returns stop(). */
export function spawnGroup(cmd, args, opts = {}) {
  const child = spawn(cmd, args, { stdio: "ignore", ...opts, detached: true });
  groups.add(child.pid);
  child.on("exit", () => groups.delete(child.pid));
  return { child, stop: () => { groups.delete(child.pid); killGroup(child.pid); } };
}

/** `vite preview` of the built lab on `port`, once it answers. */
export async function preview(port) {
  const s = spawnGroup("npx", ["vite", "preview", "--port", String(port), "--strictPort"], { cwd: new URL("..", import.meta.url).pathname });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 50; i++) { try { await fetch(base); break; } catch { await sleep(200); } }
  return { base, stop: s.stop };
}

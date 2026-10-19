// Runs every ghost.e2e.mjs block in its own process against one preview
// server. A block whose Chromium dies (not a failed check: the browser itself)
// gets one retry; on a small box SwiftShader can run out of room over a long
// session, which used to take the whole suite down near the end.
import { spawnSync } from "node:child_process";
import { preview } from "./serve.mjs";

const dir = new URL("..", import.meta.url).pathname;
const script = new URL("./ghost.e2e.mjs", import.meta.url).pathname;
const PORT = 4900 + (process.pid % 600); // its own port: a stray server left on a fixed one would be silently reused
const server = await preview(PORT); // torn down on any exit (serve.mjs)
const base = server.base;

const names = spawnSync(process.execPath, [script, "--list"], { encoding: "utf8" }).stdout.trim().split("\n");
const want = process.argv[2]?.split(",");
const results = [];
for (const name of names) {
  if (want && !want.includes(name)) continue;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = spawnSync(process.execPath, [script, "--only", name], { cwd: dir, env: { ...process.env, LAB_BASE: base }, encoding: "utf8", timeout: 600000 });
    const out = (r.stdout ?? "") + (r.stderr ?? "");
    const crashed = r.status !== 0 && !/^FAIL /m.test(out);
    process.stdout.write(out.split("\n").filter((l) => /^(PASS|FAIL) /.test(l)).map((l) => l + "\n").join(""));
    if (crashed && attempt === 1) { console.log(`…  ${name}: browser died (${(out.match(/\w+Error: [^\n]*/) ?? [`exit ${r.status}`])[0]}), retrying once`); continue; }
    if (crashed) console.log(`FAIL  ${name}: crashed twice\n${out.slice(-1500)}`);
    results.push({ name, ok: r.status === 0 });
    break;
  }
}
server.stop();
const bad = results.filter((r) => !r.ok);
console.log(bad.length ? `\n${bad.length} block(s) FAILED: ${bad.map((b) => b.name).join(", ")}` : `\nall ${results.length} blocks passed`);
process.exit(bad.length ? 1 : 0);

/**
 * Dev-only preview: renders the Client half against a scripted fake Host, so the pet can be
 * developed and screenshotted without installing anything into DSH.
 *
 *   node tools/preview.mjs 18999
 *   open http://127.0.0.1:18999/?mode=idle|busy|tool|done|error
 */
import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const PORT = Number(process.argv[2] || 18999);
const ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

const PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>dsh-pet-bellylaugh preview</title>
<style>
  html, body { margin: 0; height: 100%; }
  body { background: #1b1c1f; color: #d7d8db; font: 14px/1.5 system-ui, "Segoe UI", "Microsoft YaHei", sans-serif;
         display: flex; flex-direction: column; }
  header { padding: 10px 18px; border-bottom: 1px solid #2c2e33; color: #8b8d93; font-size: 12px; }
  main { flex: 1; display: flex; justify-content: center; }
  .col { width: min(760px, 100%); display: flex; flex-direction: column; }
  .feed { flex: 1; padding: 24px; }
  .msg { background: #26282d; border-radius: 10px; padding: 10px 14px; margin-bottom: 10px; max-width: 70%; }
  .composer { margin: 0 16px 14px; border: 1px solid #34373d; border-radius: 14px; background: #232529;
              padding: 12px 14px; display: flex; align-items: center; gap: 10px; color: #6f7176; }
  .send { margin-left: auto; width: 30px; height: 30px; border-radius: 50%; background: #3b6cf6; }
</style>
</head>
<body>
<header>dsh-pet-bellylaugh · fake-Host preview (<span id="mode">idle</span>)</header>
<main>
  <div class="col">
    <div class="feed">
      <div class="msg">帮我开发一个 DSH 桌宠插件，在 Web 界面右下角显示一个小宠物。</div>
      <div class="msg">它会根据当前 Agent 的工作状态做出不同动作。</div>
    </div>
    <div class="composer"><span>给 DSH 发送消息…</span><span class="send"></span></div>
  </div>
</main>
<script>
  document.getElementById("mode").textContent = new URLSearchParams(location.search).get("mode") || "idle";
  window.__ModuleLoader__ = {
    load: function (definition) {
      var mod = definition.factory(function () { throw new Error("require is unused"); });
      mod.apply({
        effect: function (run) {
          window.__petDispose = run();
          return function () {};
        },
      });
    },
  };
</script>
<script src="/client.js"></script>
</body>
</html>`;

let polls = 0;
let currentMode = "idle";

function json(res, value) {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "content-length": body.length });
  res.end(body);
}

function stateFor(mode) {
  polls += 1;
  const base = {
    running: 0,
    busy: false,
    toolSeq: 0,
    lastTool: "",
    toolAgeMs: null,
    doneSeq: 0,
    doneAgeMs: null,
    errorSeq: 0,
    errorAgeMs: null,
    laugh: null,
    pet: { id: "bellylaugh", name: "奶龙", columns: 8, rows: 9, v: 1 },
    clientMountedAt: null,
    clientInfo: null,
    updatedAt: Date.now(),
  };
  if (mode === "busy") return { ...base, busy: true, running: 1, toolSeq: 3, lastTool: "grep", toolAgeMs: 900 };
  if (mode === "tool") return { ...base, busy: true, running: 1, toolSeq: polls > 1 ? 4 : 3, lastTool: "grep", toolAgeMs: 120 };
  if (mode === "done") return { ...base, doneSeq: polls > 1 ? 1 : 0, doneAgeMs: polls > 1 ? 200 : null };
  if (mode === "error") return { ...base, errorSeq: polls > 1 ? 1 : 0, errorAgeMs: polls > 1 ? 200 : null };
  if (mode === "standalone") {
    // A live heartbeat from the standalone WPF pet: the in-page pet must step aside.
    return { ...base, standaloneAt: Date.now() };
  }
  if (mode === "v2") {
    // An 8x11 pack: proves the grid comes from the Host, not from a constant.
    return { ...base, pet: { id: "gugu", name: "咕咕嘎嘎", columns: 8, rows: 11, v: 2 } };
  }
  return base;
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    const p = url.pathname;

    if (p === "/") {
      polls = 0;
      currentMode = url.searchParams.get("mode") || "idle";
      const body = Buffer.from(PAGE, "utf8");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-length": body.length });
      res.end(body);
      return;
    }

    if (p === "/client.js") {
      const body = await readFile(path.join(ROOT, "lib", "client.js"));
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "content-length": body.length });
      res.end(body);
      return;
    }

    if (p === "/pet-bellylaugh/report") {
      json(res, { ok: true });
      return;
    }

    if (p === "/pet-bellylaugh/state") {
      json(res, stateFor(currentMode));
      return;
    }

    if (p === "/pet-bellylaugh/audio" || p === "/pet-bellylaugh/sheet" || p.startsWith("/pet-bellylaugh/assets/")) {
      const name = p === "/pet-bellylaugh/audio" ? "laugh.mp3" : p === "/pet-bellylaugh/sheet" ? "spritesheet.webp" : p.slice("/pet-bellylaugh/assets/".length);
      try {
        const body = await readFile(path.join(ROOT, "assets", name));
        const type = name.endsWith(".webp") ? "image/webp" : "audio/mpeg";
        res.writeHead(200, { "content-type": type, "content-length": body.length });
        res.end(body);
      } catch {
        res.writeHead(404).end();
      }
      return;
    }

    res.writeHead(404, { "content-type": "text/plain" }).end("not found");
  })
  .listen(PORT, "127.0.0.1", () => {
    console.log(`preview: http://127.0.0.1:${PORT}/?mode=idle|busy|tool|done|error`);
  });

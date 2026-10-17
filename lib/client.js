/**
 * dsh-pet-bellylaugh — Client half.
 *
 * Renders the ported Codex `bellylaugh` (奶龙) sprite sheet as a bottom-right desktop pet
 * and drives its frame animation from the Host activity snapshot.
 *
 * This module is loaded through the harness module loader (`__ModuleLoader__.load`), so it
 * ships pre-wrapped, imports nothing, and only touches `document` / `fetch` / `Audio`.
 */
window.__ModuleLoader__.load({
  id: "dsh-pet-bellylaugh",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    //#region constants
    const ROUTE = "/pet-bellylaugh";
    const SPRITE_URL = ROUTE + "/assets/spritesheet.webp";

    const LAUGH_URL = ROUTE + "/assets/laugh.mp3";

    const POLL_MS = 500;
    const LAUGH_MS = 4200;
    const BUBBLE_MS = 2600;
    const MUTE_KEY = "dsh-pet-bellylaugh:muted";
    const POS_KEY = "dsh-pet-bellylaugh:pos";
    const HIDDEN_KEY = "dsh-pet-bellylaugh:hidden";
    const VOLUME = 0.85;
    const LAUGH_TEXT = "哈哈哈哈哈哈哈哈";
    const DEFAULT_PET_NAME = "奶龙";

    /**
     * The sheet is a grid of 192x208 cells; the Host reports how many columns/rows the active
     * pet actually has, so 8x9 and 8x11 Codex packs both render without squashing.
     * Rows 0..8 carry, in order:
     * idle, run-right, run-left, laugh A, laugh B, laugh C, idle B, belly-pat, wave.
     */
    const ANIMS = {
      idle: { row: 0, frames: 6, fps: 5.5 },
      runR: { row: 1, frames: 8, fps: 13 },
      runL: { row: 2, frames: 8, fps: 13 },
      laughA: { row: 3, frames: 4, fps: 9 },
      laughB: { row: 4, frames: 5, fps: 9 },
      laughC: { row: 5, frames: 8, fps: 9 },
      idleB: { row: 6, frames: 6, fps: 5.5 },
      pat: { row: 7, frames: 6, fps: 7 },
      wave: { row: 8, frames: 6, fps: 9 },
    };

    const CSS = `
.dsh-pet {
  --dsh-pet-fw: 156px;
  --dsh-pet-fh: 169px;
  --dsh-pet-cols: 8;
  --dsh-pet-rows: 9;
  position: fixed;
  right: 18px;
  bottom: 10px;
  z-index: 8000;
  width: var(--dsh-pet-fw);
  height: var(--dsh-pet-fh);
  pointer-events: none;
  opacity: 0;
  transform: translateY(14px) scale(.94);
  transition: opacity .32s ease, transform .4s cubic-bezier(.2,.9,.3,1.3);
  filter: drop-shadow(0 7px 12px rgba(0, 0, 0, .22));
}
.dsh-pet[data-show="1"] { opacity: 1; transform: none; }
.dsh-pet__body {
  width: 100%;
  height: 100%;
  transform-origin: 50% 94%;
  animation: dsh-pet-breathe 3.8s ease-in-out infinite;
}
.dsh-pet[data-shake="1"] .dsh-pet__body { animation: dsh-pet-shake .55s ease-in-out; }
.dsh-pet__sprite {
  width: var(--dsh-pet-fw);
  height: var(--dsh-pet-fh);
  background-image: url("${SPRITE_URL}");
  background-repeat: no-repeat;
  background-position: 0 0;
  background-size: calc(var(--dsh-pet-fw) * var(--dsh-pet-cols)) calc(var(--dsh-pet-fh) * var(--dsh-pet-rows));
  pointer-events: auto;
  cursor: grab;
  outline: none;
  touch-action: none;
  -webkit-user-select: none;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}
.dsh-pet[data-dragging="1"] .dsh-pet__sprite { cursor: grabbing; }
.dsh-pet[data-dragging="1"] .dsh-pet__body { animation-play-state: paused; }
.dsh-pet[data-dragging="1"] { transition: none; }
.dsh-pet__bubble {
  position: absolute;
  right: 2px;
  bottom: calc(100% - 12px);
  padding: 5px 11px;
  border-radius: 13px;
  background: #fff7e2;
  color: #5a3f0f;
  font: 600 12px/1.45 system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  white-space: nowrap;
  box-shadow: 0 5px 16px rgba(0, 0, 0, .16);
  opacity: 0;
  transform: translateY(7px) scale(.9);
  transform-origin: 90% 100%;
  transition: opacity .2s ease, transform .22s cubic-bezier(.2,.9,.3,1.4);
  pointer-events: none;
}
.dsh-pet__bubble[data-show="1"] { opacity: 1; transform: none; }
.dsh-pet__bubble::after {
  content: "";
  position: absolute;
  right: 24px;
  bottom: -4px;
  width: 9px;
  height: 9px;
  border-radius: 2px;
  background: inherit;
  transform: rotate(45deg);
}
.dsh-pet__mute,
.dsh-pet__hide {
  position: absolute;
  /* Clear of the speech bubble, whose tail sits over the top 12px of the pet box. */
  top: 14px;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, .9);
  color: #4b3a14;
  font: 400 11px/22px system-ui, sans-serif;
  text-align: center;
  cursor: pointer;
  opacity: 0;
  transform: scale(.78);
  transition: opacity .18s ease, transform .18s ease;
  pointer-events: auto;
  box-shadow: 0 2px 8px rgba(0, 0, 0, .2);
}
.dsh-pet__mute { right: -2px; }
/* Same livery as the restore chip, so the pair reads as "the same button toggled". */
.dsh-pet__hide {
  right: 24px;
  box-sizing: border-box;
  border: 1.5px solid rgba(92, 62, 12, .5);
  background: #ffd75e;
  color: #5a3f0f;
  font: 700 12px/19px system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
}
.dsh-pet:hover .dsh-pet__mute,
.dsh-pet:hover .dsh-pet__hide,
.dsh-pet__mute:focus-visible,
.dsh-pet__hide:focus-visible { opacity: 1; transform: none; }
.dsh-pet[data-hidden="1"] { display: none; }
.dsh-pet-handle {
  position: fixed;
  z-index: 8000;
  box-sizing: border-box;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 1.5px solid rgba(92, 62, 12, .55);
  background: #ffd75e;
  color: #5a3f0f;
  font: 700 13px/23px system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  text-align: center;
  box-shadow: 0 2px 10px rgba(0, 0, 0, .28);
  cursor: pointer;
  opacity: 0;
  display: none;
  pointer-events: auto;
  transition: transform .16s ease, box-shadow .16s ease;
  -webkit-tap-highlight-color: transparent;
}
.dsh-pet-handle[data-show="1"] {
  display: block;
  /* The pulse only hints at the spot; the chip must stay visible once it finishes. */
  opacity: 1;
  animation: dsh-pet-attention 1.6s ease-in-out 3;
}
.dsh-pet-handle:hover,
.dsh-pet-handle:focus-visible {
  transform: scale(1.18);
  box-shadow: 0 3px 14px rgba(0, 0, 0, .34);
  outline: 2px solid rgba(92, 62, 12, .35);
  outline-offset: 2px;
}
@keyframes dsh-pet-attention {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: .5; transform: scale(.88); }
}
@keyframes dsh-pet-breathe {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  50% { transform: translateY(-3px) rotate(-.6deg); }
}
@keyframes dsh-pet-shake {
  0%, 100% { transform: translateX(0) rotate(0deg); }
  15% { transform: translateX(-6px) rotate(-3deg); }
  35% { transform: translateX(6px) rotate(3deg); }
  55% { transform: translateX(-4px) rotate(-2deg); }
  75% { transform: translateX(4px) rotate(2deg); }
}
@media (prefers-reduced-motion: reduce) {
  .dsh-pet { transition: opacity .2s ease; }
  .dsh-pet__body { animation: none; }
}
`;
    //#endregion

    //#region storage
    function readMuted() {
      try {
        return window.localStorage.getItem(MUTE_KEY) === "1";
      } catch {
        return false;
      }
    }

    function writeMuted(value) {
      try {
        window.localStorage.setItem(MUTE_KEY, value ? "1" : "0");
      } catch {
        /* private mode: mute simply does not persist */
      }
    }

    /**
     * The pet is dragged with the pointer and remembers where it was put, expressed as the
     * distance to the bottom-right corner so it survives window resizes sensibly.
     */
    const DEFAULT_POS = { right: 18, bottom: 10 };
    const EDGE_INSET = 4;

    function readPos() {
      try {
        const raw = window.localStorage.getItem(POS_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed.right !== "number" || typeof parsed.bottom !== "number") return null;
        return { right: parsed.right, bottom: parsed.bottom };
      } catch {
        return null;
      }
    }

    function writePos(pos) {
      try {
        window.localStorage.setItem(POS_KEY, JSON.stringify(pos));
      } catch {
        /* ignore */
      }
    }

    function readHidden() {
      try {
        return window.localStorage.getItem(HIDDEN_KEY) === "1";
      } catch {
        return false;
      }
    }

    function writeHidden(value) {
      try {
        window.localStorage.setItem(HIDDEN_KEY, value ? "1" : "0");
      } catch {
        /* ignore */
      }
    }
    //#endregion

    function mount() {
      // One pet per document, even across hot reloads of this module.
      document.querySelectorAll("[data-dsh-pet]").forEach((node) => node.remove());
      document.querySelectorAll("[data-dsh-pet-style]").forEach((node) => node.remove());

      const style = document.createElement("style");
      style.setAttribute("data-dsh-pet-style", "");
      style.textContent = CSS;
      document.head.appendChild(style);

      const root = document.createElement("div");
      root.className = "dsh-pet";
      root.setAttribute("data-dsh-pet", "");
      root.setAttribute("data-show", "0");
      root.setAttribute("aria-hidden", "true");

      const body = document.createElement("div");
      body.className = "dsh-pet__body";

      const sprite = document.createElement("div");
      sprite.className = "dsh-pet__sprite";
      sprite.setAttribute("role", "img");
      sprite.setAttribute("aria-label", DEFAULT_PET_NAME + "桌宠");
      sprite.title = DEFAULT_PET_NAME + " · 待命中";

      const bubble = document.createElement("div");
      bubble.className = "dsh-pet__bubble";
      bubble.setAttribute("role", "status");

      const mute = document.createElement("button");
      mute.type = "button";
      mute.className = "dsh-pet__mute";
      mute.title = "开关大笑音效";

      const hide = document.createElement("button");
      hide.type = "button";
      hide.className = "dsh-pet__hide";

      // The way back once the pet is gone: a small translucent dot at the same spot.
      const handle = document.createElement("div");
      handle.className = "dsh-pet-handle";
      handle.setAttribute("role", "button");
      handle.title = DEFAULT_PET_NAME + " · 点我恢复";
      handle.tabIndex = 0;
      handle.setAttribute("aria-label", DEFAULT_PET_NAME + "桌宠已隐藏，点此恢复");

      body.appendChild(sprite);
      root.appendChild(body);
      root.appendChild(bubble);
      root.appendChild(mute);
      root.appendChild(hide);
      document.body.appendChild(root);
      document.body.appendChild(handle);

      const frame = requestAnimationFrame(() => root.setAttribute("data-show", "1"));

      //#region state
      const status = { busy: false, tool: "" };
      const seen = { done: null, tool: null, error: null };

      let muted = readMuted();
      let hidden = readHidden();
      let audio = null;
      let laughUrl = LAUGH_URL;
      let petName = DEFAULT_PET_NAME;
      let sheetVersion = null;
      let sheetColumns = 8;
      let sheetRows = 9;
      let fadeTimer = 0;
      let bubbleTimer = 0;
      let shakeTimer = 0;
      let pollTimer = 0;
      let pollInFlight = false;
      let disposed = false;
      //#endregion

      //#region mute
      function syncMute() {
        mute.textContent = muted ? "🔇" : "🔊";
        mute.setAttribute("aria-pressed", muted ? "true" : "false");
        mute.setAttribute("aria-label", muted ? "开启大笑音效" : "关闭大笑音效");
      }

      mute.addEventListener("click", (event) => {
        event.stopPropagation();
        muted = !muted;
        writeMuted(muted);
        syncMute();
        if (muted && audio) {
          audio.pause();
          audio.currentTime = 0;
          audio.volume = VOLUME;
        }
        showBubble(muted ? "已静音" : "已开启声音", 1200);
      });

      syncMute();
      //#endregion

      //#region hide / restore
      /**
       * The two badges split the pet's name: the hide button wears the last character
       * (奶龙 → 龙) and the restore chip wears the first (奶龙 → 奶), so they read as one
       * toggle and stay legible on both light and dark themes.
       */
      function syncBadges() {
        const characters = Array.from(petName).filter((character) => character.trim() !== "");
        const first = characters[0] || "宠";
        const last = characters[characters.length - 1] || first;
        handle.textContent = first;
        handle.title = petName + " · 点我恢复";
        handle.setAttribute("aria-label", petName + "桌宠已隐藏，点此恢复");
        hide.textContent = last;
        hide.title = "隐藏桌宠（右下角 " + first + " 可恢复）";
        hide.setAttribute("aria-label", "隐藏" + petName);
      }

      function syncHidden() {
        root.setAttribute("data-hidden", hidden ? "1" : "0");
        handle.setAttribute("data-show", hidden ? "1" : "0");
        syncBadges();
        if (hidden) bubble.setAttribute("data-show", "0");
      }

      function setHidden(value) {
        if (hidden === value) {
          syncHidden();
          return;
        }
        hidden = value;
        writeHidden(hidden);
        syncHidden();

        if (hidden) {
          // Silent while gone: a laugh out of nowhere would be confusing.
          window.clearTimeout(fadeTimer);
          if (audio) {
            audio.pause();
            audio.currentTime = 0;
            audio.volume = VOLUME;
          }
        } else {
          // Catch up quietly instead of replaying everything that happened offline.
          seen.done = null;
          seen.tool = null;
          seen.error = null;
          void poll();
        }
      }

      hide.addEventListener("click", (event) => {
        event.stopPropagation();
        setHidden(true);
      });

      handle.addEventListener("click", () => setHidden(false));
      handle.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setHidden(false);
        }
      });

      syncHidden();
      //#endregion

      //#region audio
      function fadeOutAudio() {
        if (!audio || audio.paused) return;
        audio.volume = Math.max(0, audio.volume - 0.12);
        if (audio.volume <= 0.02) {
          audio.pause();
          audio.currentTime = 0;
          audio.volume = VOLUME;
          return;
        }
        window.setTimeout(fadeOutAudio, 70);
      }

      function playLaugh() {
        if (muted) return;
        try {
          if (!audio) {
            audio = new Audio(laughUrl);
            audio.preload = "auto";
            audio.volume = VOLUME;
            audio.addEventListener("ended", () => {
              audio.volume = VOLUME;
            });
          }
          audio.pause();
          audio.currentTime = 0;
          audio.volume = VOLUME;
          const played = audio.play();
          if (played && typeof played.catch === "function") played.catch(() => {});
          window.clearTimeout(fadeTimer);
          fadeTimer = window.setTimeout(fadeOutAudio, LAUGH_MS);
        } catch {
          /* autoplay policy or a decode failure must not surface as an error */
        }
      }

      /**
       * The laugh is whichever file currently wins the Host's scan. Its version rides on the
       * URL, so dropping a new sound into `assets/` swaps it live instead of after a restart.
       */
      function resolveLaugh(snapshot) {
        const info = snapshot && snapshot.laugh;
        const next = info && typeof info.file === "string"
          ? ROUTE + "/audio?v=" + encodeURIComponent(String(info.v)) + "&f=" + encodeURIComponent(info.file)
          : LAUGH_URL;
        if (next === laughUrl) return;
        laughUrl = next;
        if (audio) {
          audio.pause();
          audio.removeAttribute("src");
          audio = null;
        }
      }

      /**
       * Same deal for the sprite sheet: the active pet (idle name + grid shape) comes from the
       * Host, so replacing `assets/spritesheet.webp` or dropping `assets/pets/<name>/` swaps the
       * whole pet without touching this file.
       */
      function applyPet(info) {
        if (!info || typeof info !== "object") return;

        if (typeof info.name === "string" && info.name.trim() !== "") {
          petName = info.name.trim();
          root.setAttribute("data-pet", petName);
          sprite.setAttribute("aria-label", petName + "桌宠");
          syncBadges();
        }

        const columns = Number(info.columns);
        const rows = Number(info.rows);
        if (Number.isFinite(columns) && columns > 0 && Number.isFinite(rows) && rows > 0) {
          if (columns !== sheetColumns || rows !== sheetRows) {
            sheetColumns = columns;
            sheetRows = rows;
            root.style.setProperty("--dsh-pet-cols", String(columns));
            root.style.setProperty("--dsh-pet-rows", String(rows));
            painted = "";
          }
        }

        const version = info.v === undefined || info.v === null ? null : String(info.v);
        if (version !== null && version !== sheetVersion) {
          sheetVersion = version;
          sprite.style.backgroundImage = 'url("' + ROUTE + "/sheet?v=" + encodeURIComponent(version) + '")';
          painted = "";
        }
      }
      //#endregion

      //#region beacon
      /**
       * The Host exposes this boot in `/pet-bellylaugh/state`, so "the pet is really on
       * screen" is observable from outside the browser instead of taken on faith.
       */
      function report(extra) {
        try {
          const payload = {
            version: 1,
            path: window.location.pathname,
            dpr: window.devicePixelRatio || 1,
            audio: typeof Audio === "function",
            at: Date.now(),
          };
          if (extra) {
            for (const key in extra) payload[key] = extra[key];
          }
          fetch(ROUTE + "/report", {
            method: "POST",
            cache: "no-store",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          }).catch(function () {});
        } catch {
          /* the beacon is diagnostic only */
        }
      }

      function probeSprite() {
        try {
          const probe = new Image();
          probe.onload = function () {
            report({ sprite: "ok", spriteSize: probe.naturalWidth + "x" + probe.naturalHeight });
          };
          probe.onerror = function () {
            report({ sprite: "failed" });
          };
          probe.src = SPRITE_URL;
        } catch {
          /* ignore */
        }
      }
      //#endregion

      //#region bubble
      function showBubble(text, ms) {
        bubble.textContent = text;
        bubble.setAttribute("data-show", "1");
        window.clearTimeout(bubbleTimer);
        bubbleTimer = window.setTimeout(() => bubble.setAttribute("data-show", "0"), ms || BUBBLE_MS);
      }
      //#endregion

      //#region animation engine
      const queue = []; // [{ name, loops }]
      const anim = { name: "", frame: 0, acc: 0 };
      let painted = "";
      let lastTick = 0;
      let rafId = 0;

      function baseAnim() {
        return status.busy ? "pat" : "idle";
      }

      function leadName() {
        return queue.length > 0 ? queue[0].name : baseAnim();
      }

      function enqueue(entries, replace) {
        if (replace) queue.length = 0;
        for (const entry of entries) {
          if (queue.length < 4) queue.push({ name: entry.name, loops: entry.loops });
        }
      }

      function paint(spec, frame) {
        const key = spec.row + ":" + frame;
        if (key === painted) return;
        painted = key;
        sprite.style.backgroundPosition =
          "calc(var(--dsh-pet-fw) * " + -frame + ") calc(var(--dsh-pet-fh) * " + -spec.row + ")";
      }

      function tick(now) {
        if (disposed) return;
        const delta = lastTick === 0 ? 16 : Math.min(now - lastTick, 250);
        lastTick = now;

        const name = leadName();
        if (name !== anim.name) {
          anim.name = name;
          anim.frame = 0;
          anim.acc = 0;
        }

        const spec = ANIMS[name] || ANIMS.idle;
        anim.acc += delta;
        const step = 1000 / spec.fps;
        let wraps = 0;
        while (anim.acc >= step) {
          anim.acc -= step;
          anim.frame += 1;
          if (anim.frame >= spec.frames) {
            anim.frame = 0;
            wraps += 1;
          }
        }

        if (wraps > 0 && queue.length > 0) {
          const head = queue[0];
          if (head.loops !== Infinity) {
            head.loops -= wraps;
            if (head.loops <= 0) queue.shift();
          }
        }

        paint(spec, anim.frame);
        rafId = window.requestAnimationFrame(tick);
      }
      //#endregion

      //#region reactions
      function reactDone() {
        enqueue([{ name: "laughC", loops: 3 }, { name: "wave", loops: 1 }], true);
        showBubble(LAUGH_TEXT, BUBBLE_MS + 900);
        sprite.title = petName + " · 任务完成，笑到打滚";
        playLaugh();
      }

      function reactTool(name) {
        // A finished Tool call reads as a short dash; a long Agent turn keeps `pat`.
        enqueue([{ name: Math.random() < 0.5 ? "runR" : "runL", loops: 2 }], false);
        if (name) sprite.title = petName + " · 刚跑完 " + name;
      }

      function reactError() {
        enqueue([{ name: "idleB", loops: 2 }], true);
        root.setAttribute("data-shake", "1");
        window.clearTimeout(shakeTimer);
        shakeTimer = window.setTimeout(() => root.removeAttribute("data-shake"), 600);
        showBubble("哎呀，好像出错了", 2200);
        sprite.title = petName + " · 出错了";
      }
      //#endregion

      //#region polling
      function ingest(snapshot) {
        status.busy = !!snapshot.busy;
        status.tool = typeof snapshot.lastTool === "string" ? snapshot.lastTool : "";
        resolveLaugh(snapshot);
        applyPet(snapshot.pet);

        const doneSeq = Number(snapshot.doneSeq) || 0;
        const toolSeq = Number(snapshot.toolSeq) || 0;
        const errorSeq = Number(snapshot.errorSeq) || 0;

        if (seen.done === null) {
          // First contact: adopt the Host counters instead of replaying old events.
          seen.done = doneSeq;
          seen.tool = toolSeq;
          seen.error = errorSeq;
          return;
        }

        if (errorSeq > seen.error) {
          seen.error = errorSeq;
          reactError();
        } else if (doneSeq > seen.done) {
          seen.done = doneSeq;
          reactDone();
        } else if (toolSeq > seen.tool) {
          seen.tool = toolSeq;
          reactTool(status.tool);
        } else if (queue.length === 0 && !root.hasAttribute("data-shake")) {
          sprite.title = status.busy ? petName + " · 正在忙…" : petName + " · 发呆中";
        }
        seen.tool = Math.max(seen.tool, toolSeq);
        seen.done = Math.max(seen.done, doneSeq);
        seen.error = Math.max(seen.error, errorSeq);
      }

      async function poll() {
        if (disposed || pollInFlight || hidden) return;
        if (document.visibilityState === "hidden") return;
        pollInFlight = true;
        try {
          const response = await fetch(ROUTE + "/state", {
            cache: "no-store",
            credentials: "same-origin",
            headers: { accept: "application/json" },
          });
          if (!response.ok) return;
          ingest(await response.json());
        } catch {
          /* the Host may be restarting; the next tick retries */
        } finally {
          pollInFlight = false;
        }
      }
      //#endregion

      //#region interactions
      let position = readPos() || { ...DEFAULT_POS };
      let drag = null;

      function applyPosition(next) {
        position = next;
        root.style.right = next.right + "px";
        root.style.bottom = next.bottom + "px";
        handle.style.right = Math.max(0, next.right) + "px";
        handle.style.bottom = Math.max(0, next.bottom) + "px";
      }

      function clampPosition(next) {
        const width = root.offsetWidth || 156;
        const height = root.offsetHeight || 169;
        const maxRight = Math.max(EDGE_INSET, window.innerWidth - width - EDGE_INSET);
        const maxBottom = Math.max(EDGE_INSET, window.innerHeight - height - EDGE_INSET);
        return {
          right: Math.min(Math.max(next.right, EDGE_INSET), maxRight),
          bottom: Math.min(Math.max(next.bottom, EDGE_INSET), maxBottom),
        };
      }

      applyPosition(clampPosition(position));

      function wave(greeting) {
        enqueue([{ name: "wave", loops: 1 }], false);
        showBubble(greeting, 1600);
      }

      sprite.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        drag = {
          id: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          right: position.right,
          bottom: position.bottom,
          moved: false,
        };
        try {
          sprite.setPointerCapture(event.pointerId);
        } catch {
          /* capture is best-effort */
        }
      });

      sprite.addEventListener("pointermove", (event) => {
        if (!drag || event.pointerId !== drag.id) return;
        const dx = event.clientX - drag.startX;
        const dy = event.clientY - drag.startY;
        if (!drag.moved) {
          if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
          drag.moved = true;
          root.setAttribute("data-dragging", "1");
        }
        applyPosition(clampPosition({ right: drag.right - dx, bottom: drag.bottom - dy }));
      });

      function endDrag(event) {
        if (!drag) return;
        const moved = drag.moved;
        const id = drag.id;
        drag = null;
        root.removeAttribute("data-dragging");
        try {
          sprite.releasePointerCapture(id);
        } catch {
          /* already released */
        }
        if (event && event.pointerId !== id) return;
        if (moved) {
          writePos(position);
          sprite.title = petName + " · 放这儿了";
        } else if (event && event.shiftKey) {
          // Shift + click auditions the current laugh sound without waiting for a task.
          reactDone();
        } else {
          wave(status.busy ? "忙着呢，别戳我～" : "嗨～");
        }
      }

      sprite.addEventListener("pointerup", endDrag);
      sprite.addEventListener("pointercancel", endDrag);

      // Right-click puts it back in the corner.
      sprite.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        applyPosition(clampPosition({ ...DEFAULT_POS }));
        writePos(position);
        wave("回到角落啦");
      });

      const onResize = () => applyPosition(clampPosition(position));
      window.addEventListener("resize", onResize);

      const onVisibility = () => {
        if (document.visibilityState === "visible") {
          lastTick = 0;
          void poll();
        }
      };
      document.addEventListener("visibilitychange", onVisibility);
      //#endregion

      void poll();
      pollTimer = window.setInterval(poll, POLL_MS);
      rafId = window.requestAnimationFrame(tick);
      window.setTimeout(() => showBubble(petName + "来了～", 2000), 420);
      report({ mounted: true });
      probeSprite();

      return () => {
        disposed = true;
        window.cancelAnimationFrame(frame);
        window.cancelAnimationFrame(rafId);
        window.clearInterval(pollTimer);
        window.clearTimeout(fadeTimer);
        window.clearTimeout(bubbleTimer);
        window.clearTimeout(shakeTimer);
        document.removeEventListener("visibilitychange", onVisibility);
        window.removeEventListener("resize", onResize);
        if (audio) {
          audio.pause();
          audio.removeAttribute("src");
          audio = null;
        }
        root.remove();
        handle.remove();
        style.remove();
      };
    }

    function apply(ctx) {
      ctx.effect(() => {
        if (document.body) return mount();
        // The shell owns `document.body`; this only covers an unusually early load.
        let dispose = () => {};
        const onReady = () => {
          dispose = mount();
        };
        document.addEventListener("DOMContentLoaded", onReady, { once: true });
        return () => {
          document.removeEventListener("DOMContentLoaded", onReady);
          dispose();
        };
      }, "dsh-pet-bellylaugh: bottom-right desktop pet");
    }

    exports.apply = apply;
    return module.exports;
  },
});

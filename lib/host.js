/**
 * dsh-pet-bellylaugh — Host half.
 *
 * Owns three things:
 *  1. a live "agent activity" snapshot derived from Host events,
 *  2. the HTTP surface the Client half reads it from, including the packaged artwork, and
 *  3. a mount beacon the Client half posts back, so `/state` proves the pet really booted.
 *
 * The Client half never talks RPC: it polls `/pet-bellylaugh/state`, which keeps the package
 * free of any dependency on the Client↔Host transport contract.
 *
 * Swapping media is a filesystem operation, not a code change: drop a file into `assets/`,
 * and the newest `laugh.*` becomes the laugh. `/state.laugh` carries its version so the
 * browser busts its own cache without any restart.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROUTE = "/pet-bellylaugh";
const BODY_LIMIT = 8192;
const ASSET_ROOT = fileURLToPath(new URL("../assets/", import.meta.url));

/** Formats Chromium can actually decode, mapped to the media type they are served as. */
const MEDIA_TYPES = {
  ".webp": "image/webp",
  ".png": "image/png",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".opus": "audio/ogg",
  ".flac": "audio/flac",
  ".webm": "audio/webm",
};

const AUDIO_EXTENSIONS = new Set([".mp3", ".m4a", ".aac", ".wav", ".ogg", ".oga", ".opus", ".flac", ".webm"]);
const MEDIA_SCAN_TTL_MS = 1500;

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

/**
 * Discover the packaged media. The newest `laugh.<ext>` wins, so replacing the sound is
 * "drop the file in and refresh"; anything else audio-ish is the fallback.
 */
function createMediaLibrary() {
  let snapshot = null;
  let scannedAt = 0;
  const bytes = new Map();

  async function scan() {
    const now = Date.now();
    if (snapshot !== null && now - scannedAt < MEDIA_SCAN_TTL_MS) return snapshot;

    let entries = [];
    try {
      entries = await readdir(ASSET_ROOT, { withFileTypes: true });
    } catch {
      entries = [];
    }

    const audio = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const extension = path.extname(entry.name).toLowerCase();
      if (!AUDIO_EXTENSIONS.has(extension)) continue;
      let info;
      try {
        info = await stat(path.join(ASSET_ROOT, entry.name));
      } catch {
        continue;
      }
      audio.push({
        name: entry.name,
        extension,
        mtime: Math.round(info.mtimeMs),
        size: info.size,
        preferred: /^laugh\./i.test(entry.name),
      });
    }

    audio.sort((left, right) => right.mtime - left.mtime);
    const pick = audio.find((entry) => entry.preferred) || audio[0] || null;
    snapshot = { pick };
    scannedAt = now;
    return snapshot;
  }

  /** Read one allowlisted asset by plain file name, cached against its own mtime. */
  async function readAsset(name) {
    const extension = path.extname(name).toLowerCase();
    const type = MEDIA_TYPES[extension];
    if (!type) return null;
    if (name.length > 200 || name.includes("/") || name.includes("\\") || name === "." || name === "..") return null;

    let info;
    try {
      info = await stat(path.join(ASSET_ROOT, name));
    } catch {
      return null;
    }
    if (!info.isFile()) return null;

    const key = name + ":" + info.size + ":" + info.mtimeMs;
    const cached = bytes.get(key);
    if (cached) return { bytes: cached, type, mtime: Math.round(info.mtimeMs), size: info.size };

    let body;
    try {
      body = await readFile(path.join(ASSET_ROOT, name));
    } catch {
      return null;
    }
    for (const existing of bytes.keys()) {
      if (existing.startsWith(name + ":")) bytes.delete(existing);
    }
    bytes.set(key, body);
    return { bytes: body, type, mtime: Math.round(info.mtimeMs), size: body.length };
  }

  return { scan, readAsset };
}


function createActivity() {
  /** Live agents that are currently `running`. */
  const running = new Set();
  /** A turn started and has not been celebrated yet. */
  let turnPending = false;
  /** The pending turn ended in an error, so it is reported instead of a laugh. */
  let turnFailed = false;

  /** Timestamps are stored raw and converted to ages at snapshot time. */
  const stamps = {
    toolAt: null,
    doneAt: null,
    errorAt: null,
  };
  const counters = { toolSeq: 0, doneSeq: 0, errorSeq: 0 };
  let lastTool = "";
  const client = { mountedAt: null, info: null };

  return {
    running,
    snapshot(now = Date.now()) {
      return {
        busy: running.size > 0,
        running: running.size,
        toolSeq: counters.toolSeq,
        lastTool,
        toolAgeMs: stamps.toolAt === null ? null : now - stamps.toolAt,
        doneSeq: counters.doneSeq,
        doneAgeMs: stamps.doneAt === null ? null : now - stamps.doneAt,
        errorSeq: counters.errorSeq,
        errorAgeMs: stamps.errorAt === null ? null : now - stamps.errorAt,
        clientMountedAt: client.mountedAt,
        clientInfo: client.info,
        updatedAt: now,
      };
    },
    startTurn() {
      turnPending = true;
      turnFailed = false;
    },
    failTurn() {
      turnFailed = true;
    },
    /** Returns "done" | "error" | null for the turn that just ended, claiming it once. */
    endTurn() {
      if (!turnPending) return null;
      turnPending = false;
      const verdict = turnFailed ? "error" : "done";
      turnFailed = false;
      return verdict;
    },
    recordTool(name, now = Date.now()) {
      counters.toolSeq += 1;
      lastTool = typeof name === "string" ? name : "";
      stamps.toolAt = now;
    },
    recordVerdict(verdict, now = Date.now()) {
      if (verdict === "done") {
        counters.doneSeq += 1;
        stamps.doneAt = now;
      } else if (verdict === "error") {
        counters.errorSeq += 1;
        stamps.errorAt = now;
      }
    },
    recordClient(info, now = Date.now()) {
      client.mountedAt = now;
      client.info = info && typeof info === "object" ? info : null;
    },
  };
}

function readBody(req) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        chunks.length = 0;
        resolve("");
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(""));
  });
}

function createHandler(activity, media) {
  function sendJson(res, status, value) {
    const body = Buffer.from(JSON.stringify(value), "utf8");
    res.writeHead(status, { ...JSON_HEADERS, "Content-Length": body.length });
    res.end(body);
  }

  /** One immutable-shaped media response: ETag revalidation keeps swaps cheap. */
  function sendMedia(req, res, method, asset) {
    const etag = `"${asset.size}-${asset.mtime}"`;
    const headers = {
      "Content-Type": asset.type,
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Content-Length": asset.bytes.length,
      ETag: etag,
    };
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, headers);
      res.end();
      return;
    }
    res.writeHead(200, headers);
    res.end(method === "HEAD" ? undefined : asset.bytes);
  }

  function notFound(res) {
    res.writeHead(404, { "Content-Length": 0 });
    res.end();
  }

  return async function handler(req, res) {
    const method = req.method ?? "GET";
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;

    if (!pathname.startsWith(`${ROUTE}/`)) {
      notFound(res);
      return;
    }

    const rest = pathname.slice(ROUTE.length + 1);

    // Client mount beacon: proves the browser bundle executed and mounted.
    if (rest === "report") {
      if (method !== "POST") {
        res.writeHead(405, { Allow: "POST", ...JSON_HEADERS, "Content-Length": 0 });
        res.end();
        return;
      }
      const raw = await readBody(req);
      let info = null;
      try {
        info = raw ? JSON.parse(raw) : null;
      } catch {
        info = null;
      }
      activity.recordClient(info);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method !== "GET" && method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD", ...JSON_HEADERS, "Content-Length": 0 });
      res.end();
      return;
    }

    if (rest === "state") {
      const found = await media.scan();
      const laugh = found.pick === null
        ? null
        : { file: found.pick.name, v: found.pick.mtime, size: found.pick.size };
      const body = Buffer.from(JSON.stringify({ ...activity.snapshot(), laugh }), "utf8");
      res.writeHead(200, { ...JSON_HEADERS, "Content-Length": body.length });
      res.end(method === "HEAD" ? undefined : body);
      return;
    }

    // The current laugh, whatever file currently wins the scan.
    if (rest === "audio") {
      const found = await media.scan();
      if (found.pick === null) {
        notFound(res);
        return;
      }
      const asset = await media.readAsset(found.pick.name);
      if (asset === null) {
        notFound(res);
        return;
      }
      sendMedia(req, res, method, asset);
      return;
    }

    if (rest.startsWith("assets/")) {
      const name = rest.slice("assets/".length);
      const asset = await media.readAsset(name);
      if (asset === null) {
        notFound(res);
        return;
      }
      sendMedia(req, res, method, asset);
      return;
    }

    notFound(res);
  };
}

export function apply(ctx) {
  const activity = createActivity();
  const media = createMediaLibrary();

  // `agent/status` is the single source of truth for "is an Agent working".
  // Scope-filtered dispatch: a root listener sees every Agent, so a nested subagent keeps
  // the pet busy without each of its turns counting as a finished task.
  ctx.on("agent/status", (payload) => {
    try {
      const id = payload?.agent?.id;
      if (!id) return;
      if (payload.status === "running") {
        activity.running.add(id);
        activity.startTurn();
        return;
      }
      activity.running.delete(id);
      if (activity.running.size === 0) {
        const verdict = activity.endTurn();
        if (verdict) activity.recordVerdict(verdict);
      }
    } catch {
      /* a pet must never break an Agent turn */
    }
  });

  ctx.on("agent/disposed", (payload) => {
    try {
      const id = payload?.agent?.id;
      if (id) activity.running.delete(id);
    } catch {
      /* ignore */
    }
  });

  ctx.on("agent/error", () => {
    try {
      activity.failTurn();
    } catch {
      /* ignore */
    }
  });

  // Emit-only observation of finished Tool calls: no waterfall, no dispatch risk.
  ctx.on("tools/result", (exec) => {
    try {
      activity.recordTool(exec?.name);
    } catch {
      /* ignore */
    }
  });

  ctx.inject(["webServer"], (webCtx) => {
    const server = webCtx.get("webServer");
    if (!server) return;
    webCtx.effect(
      () => server.register({ kind: "prefix", path: ROUTE, handler: createHandler(activity, media) }),
      "dsh-pet-bellylaugh: pet routes",
    );
  });
}

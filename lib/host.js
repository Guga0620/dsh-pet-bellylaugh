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
const PETS_ROOT = fileURLToPath(new URL("../assets/pets/", import.meta.url));

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
const SHEET_EXTENSIONS = new Set([".webp", ".png", ".avif"]);
const MEDIA_SCAN_TTL_MS = 1500;

/** Codex pets are always laid out on this cell grid; the sheet size decides the row count. */
const CELL_WIDTH = 192;
const CELL_HEIGHT = 208;
const DEFAULT_COLUMNS = 8;
const DEFAULT_ROWS = 9;

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

/** Read width/height straight out of the header bytes — no image library, no pixels decoded. */
function imageSize(buffer) {
  if (buffer.length >= 30 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    const fourcc = buffer.toString("ascii", 12, 16);
    if (fourcc === "VP8X") {
      return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
    }
    if (fourcc === "VP8L") {
      if (buffer[20] !== 0x2f) return null;
      const b0 = buffer[21];
      const b1 = buffer[22];
      const b2 = buffer[23];
      const b3 = buffer[24];
      return {
        width: 1 + (b0 | ((b1 & 0x3f) << 8)),
        height: 1 + (((b1 & 0xc0) >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10)),
      };
    }
    if (fourcc === "VP8 ") {
      if (buffer[23] !== 0x9d || buffer[24] !== 0x01 || buffer[25] !== 0x2a) return null;
      return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
    }
    return null;
  }
  if (buffer.length >= 24 && buffer.readUInt32BE(0) === 0x89504e47) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  return null;
}

/** Best-effort pet metadata: a sibling `pet.json` (as Codex ships it) or the folder name. */
async function readPetMeta(directory, fallbackName) {
  try {
    const raw = await readFile(path.join(directory, "pet.json"), "utf8");
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
    const name = typeof parsed.displayName === "string" && parsed.displayName.trim() !== "" ? parsed.displayName.trim() : fallbackName;
    return { name, id: typeof parsed.id === "string" ? parsed.id : fallbackName };
  } catch {
    return { name: fallbackName, id: fallbackName };
  }
}


/**
 * Discover the packaged media. The newest `laugh.<ext>` wins, so replacing the sound is
 * "drop the file in and refresh"; anything else audio-ish is the fallback.
 */
function createMediaLibrary() {
  let snapshot = null;
  let scannedAt = 0;
  let sheetSnapshot = null;
  let sheetScannedAt = 0;
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

  /**
   * Resolve the active sprite sheet. A pet dropped under `assets/pets/<name>/` (newest wins)
   * overrides the legacy flat `assets/spritesheet.webp`, and the grid is derived from the
   * real image size so 8x9 and 8x11 Codex packs both work untouched.
   */
  async function sheet() {
    const now = Date.now();
    if (sheetSnapshot !== null && now - sheetScannedAt < MEDIA_SCAN_TTL_MS) return sheetSnapshot;

    const candidates = [];
    let petsDir = [];
    try {
      petsDir = await readdir(PETS_ROOT, { withFileTypes: true });
    } catch {
      petsDir = [];
    }

    for (const entry of petsDir) {
      if (!entry.isDirectory()) continue;
      for (const extension of SHEET_EXTENSIONS) {
        const file = path.join(PETS_ROOT, entry.name, "spritesheet" + extension);
        let info;
        try {
          info = await stat(file);
        } catch {
          continue;
        }
        candidates.push({ file, directory: path.join(PETS_ROOT, entry.name), id: entry.name, mtime: info.mtimeMs });
      }
    }

    // An explicit pet folder always beats the flat sheet; a plain Windows copy keeps the
    // source mtime, so "newest file wins" alone would not be predictable here.
    candidates.sort((left, right) => right.mtime - left.mtime);
    let chosen = candidates[0] ?? null;

    if (chosen === null) {
      try {
        const flat = await stat(path.join(ASSET_ROOT, "spritesheet.webp"));
        chosen = { file: path.join(ASSET_ROOT, "spritesheet.webp"), directory: ASSET_ROOT, id: "bellylaugh", mtime: flat.mtimeMs };
      } catch {
        chosen = null;
      }
    }
    if (chosen === null) {
      sheetSnapshot = { pet: null };
      sheetScannedAt = now;
      return sheetSnapshot;
    }

    let body;
    try {
      body = await readFile(chosen.file);
    } catch {
      sheetSnapshot = { pet: null };
      sheetScannedAt = now;
      return sheetSnapshot;
    }

    const size = imageSize(body);
    const columns = size && size.width % CELL_WIDTH === 0 ? size.width / CELL_WIDTH : DEFAULT_COLUMNS;
    const rows = size && size.height % CELL_HEIGHT === 0 ? size.height / CELL_HEIGHT : DEFAULT_ROWS;
    const meta = await readPetMeta(chosen.directory, chosen.id);
    const extension = path.extname(chosen.file).toLowerCase();

    sheetSnapshot = {
      pet: {
        id: meta.id,
        name: meta.name,
        columns,
        rows,
        width: size?.width ?? null,
        height: size?.height ?? null,
        v: Math.round(chosen.mtime),
        size: body.length,
        type: MEDIA_TYPES[extension] ?? "application/octet-stream",
        bytes: body,
      },
    };
    sheetScannedAt = now;
    return sheetSnapshot;
  }

  return { scan, readAsset, sheet };
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
  /** Last heartbeat from the standalone (WPF) pet, so the in-page one can step aside. */
  let standaloneAt = null;

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
        standaloneAt,
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
    recordStandalone(now = Date.now()) {
      standaloneAt = now;
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

    // Standalone (WPF) pet heartbeat: while it beats, the in-page pet stands down so the
    // user never sees two 奶龙s at once.
    if (rest === "standalone") {
      if (method !== "POST") {
        res.writeHead(405, { Allow: "POST", ...JSON_HEADERS, "Content-Length": 0 });
        res.end();
        return;
      }
      activity.recordStandalone();
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
      const sheetFound = await media.sheet();
      const laugh = found.pick === null
        ? null
        : { file: found.pick.name, v: found.pick.mtime, size: found.pick.size };
      const pet = sheetFound.pet === null
        ? null
        : {
            id: sheetFound.pet.id,
            name: sheetFound.pet.name,
            columns: sheetFound.pet.columns,
            rows: sheetFound.pet.rows,
            v: sheetFound.pet.v,
            size: sheetFound.pet.size,
          };
      const body = Buffer.from(JSON.stringify({ ...activity.snapshot(), laugh, pet }), "utf8");
      res.writeHead(200, { ...JSON_HEADERS, "Content-Length": body.length });
      res.end(method === "HEAD" ? undefined : body);
      return;
    }

    // The active sprite sheet, whichever pet currently wins the scan.
    if (rest === "sheet") {
      const found = await media.sheet();
      if (found.pet === null) {
        notFound(res);
        return;
      }
      sendMedia(req, res, method, found.pet);
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

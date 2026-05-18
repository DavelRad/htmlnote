import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, extname, resolve, sep } from "node:path";
import type { Annotation, Session, SessionSummary } from "../shared/types.js";
import { CSRF_HEADER } from "../shared/constants.js";
import { injectBridge } from "./inject.js";
import {
  deleteSession as deleteSessionFile,
  hashFor,
  listSessions,
  loadSession,
  saveSession,
} from "./storage.js";
import { toJSON, toMarkdown } from "./export.js";

// SPA inlined at bundle time via esbuild's `--loader:.html=text`. Lets the
// CLI ship as a single binary (Bun compile) without a sidecar dist/ui/
// directory at runtime.
import uiHtml from "../../dist/ui/index.html";

/** 1 MiB — caps body size on POST handlers to prevent local-process OOM. */
const MAX_BODY_BYTES = 1024 * 1024;

/** Limit /asset/ to known asset extensions. A malicious browser tab can't read
 *  responses cross-origin, but probing 404-vs-200 via <img onerror> can still
 *  reveal arbitrary filenames. The allowlist removes that leak. */
const ASSET_EXTENSIONS = new Set([
  ".css", ".js", ".mjs", ".json", ".html",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".avif",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".mp3", ".mp4", ".webm", ".ogg", ".wav",
]);

// ─── Annotation shape validation (unchanged across versions) ─────────────

function isRectShape(r: unknown): boolean {
  if (!r || typeof r !== "object") return false;
  const o = r as Record<string, unknown>;
  return (
    Number.isFinite(o.x) &&
    Number.isFinite(o.y) &&
    Number.isFinite(o.w) &&
    Number.isFinite(o.h)
  );
}

function isElementTargetShape(t: Record<string, unknown>): boolean {
  if (typeof t.selector !== "string" || t.selector.length > 4_000) return false;
  if (typeof t.tag !== "string" || t.tag.length > 64) return false;
  if (t.id !== undefined && (typeof t.id !== "string" || t.id.length > 256)) return false;
  if (t.classes !== undefined && (typeof t.classes !== "string" || t.classes.length > 1024)) return false;
  if (t.textContent !== undefined && (typeof t.textContent !== "string" || t.textContent.length > 2_000)) return false;
  if (t.outerHTMLSnippet !== undefined && (typeof t.outerHTMLSnippet !== "string" || t.outerHTMLSnippet.length > 10_000)) return false;
  return isRectShape(t.rect);
}

function isTextTargetShape(t: Record<string, unknown>): boolean {
  if (typeof t.selector !== "string" || t.selector.length > 4_000) return false;
  if (typeof t.quotedText !== "string" || t.quotedText.length > 2_000) return false;
  if (typeof t.charOffset !== "number" || !Number.isFinite(t.charOffset)) return false;
  if (!Array.isArray(t.rects) || t.rects.length === 0 || t.rects.length > 200) return false;
  for (const r of t.rects) if (!isRectShape(r)) return false;
  return isRectShape(t.primaryRect);
}

function renumber(s: Session): void {
  s.annotations.forEach((a, i) => {
    a.number = i + 1;
  });
}

function isAnnotationShape(x: unknown): x is Annotation {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== "string" || o.id.length === 0 || o.id.length > 64) return false;
  if (typeof o.comment !== "string" || o.comment.length > 50_000) return false;
  if (typeof o.number !== "number" || !Number.isFinite(o.number)) return false;
  if (typeof o.createdAt !== "number" || typeof o.updatedAt !== "number") return false;
  if (o.target === null) return true;
  if (typeof o.target !== "object" || Array.isArray(o.target)) return false;
  const t = o.target as Record<string, unknown>;
  if (t.kind === "element") return isElementTargetShape(t);
  if (t.kind === "text") return isTextTargetShape(t);
  return false;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

// ─── Daemon state (v0.2.0 — non-blocking model) ──────────────────────────
//
// turnWrites: session ids the agent has touched during the current turn.
// PostToolUse adds to it on every Write/Edit/MultiEdit of an HTML file.
// Stop hook reads it to decide whether to pop a browser tab.
// UserPromptSubmit clears it (turn boundary).
//
// That's the entire loop state. No long-polls, no suppression, no
// pendingApply, no watchdogs — the hook never waits for a human.

type SessionRecord = {
  session: Session;
  filePath: string;
  /** Lazily populated on first GET /target/:id. Invalidated on every
   *  re-register (a fresh hook means the file content changed). */
  cachedHtml: string | null;
  /** Resolved sibling-dir for /asset path-traversal sandboxing. Null when
   *  the file doesn't exist on disk anymore. */
  assetRootReal: string | null;
};

export type DaemonHandle = {
  port: number;
  url: string;
  registerSession: (filePath: string) => Promise<{ id: string; url: string }>;
  close: () => Promise<void>;
};

export async function startServer(): Promise<DaemonHandle> {
  const sessions = new Map<string, SessionRecord>();
  const turnWrites = new Set<string>();
  let port = 0;
  let allowedHosts = new Set<string>();

  // Hydrate from disk so the sidebar shows archived reviews from earlier
  // sessions of the daemon.
  for (const s of listSessions()) {
    sessions.set(s.id, await buildRecord(s, s.source.path));
  }

  async function buildRecord(
    session: Session,
    filePath: string,
  ): Promise<SessionRecord> {
    let assetRootReal: string | null = null;
    try {
      assetRootReal = await realpath(dirname(filePath));
    } catch {
      /* file may not exist — fine for archived sessions */
    }
    return {
      session,
      filePath,
      cachedHtml: null,
      assetRootReal,
    };
  }

  async function ensureHtml(rec: SessionRecord): Promise<string> {
    if (rec.cachedHtml !== null) return rec.cachedHtml;
    try {
      const raw = await readFile(rec.filePath, "utf8");
      rec.cachedHtml = injectBridge(raw, rec.session.id);
    } catch {
      rec.cachedHtml = `<!doctype html><html><head><meta charset="utf-8"></head><body style="font: 14px/1.5 system-ui; color: #666; padding: 32px">The file <code>${escapeHtml(rec.filePath)}</code> no longer exists on disk.</body></html>`;
    }
    return rec.cachedHtml;
  }

  function summarize(): SessionSummary[] {
    const out: SessionSummary[] = [];
    for (const [id, rec] of sessions) {
      out.push({
        id,
        title: rec.session.title,
        filePath: rec.filePath,
        fileExists: existsSync(rec.filePath),
        annotationCount: rec.session.annotations.length,
        createdAt: rec.session.createdAt,
        inCurrentTurn: turnWrites.has(id),
      });
    }
    // Current-turn entries first (visually most relevant), then by recency.
    out.sort((a, b) => {
      if (a.inCurrentTurn !== b.inCurrentTurn) return a.inCurrentTurn ? -1 : 1;
      return b.createdAt - a.createdAt;
    });
    return out;
  }

  async function registerSession(
    filePath: string,
  ): Promise<{ id: string; url: string }> {
    const abs = resolve(filePath);
    const id = hashFor(abs);
    let rec = sessions.get(id);
    if (!rec) {
      const existing = loadSession(id);
      const session: Session = existing ?? {
        id,
        source: { kind: "file", path: abs },
        title: basename(abs),
        createdAt: Date.now(),
        annotations: [],
      };
      saveSession(session);
      rec = await buildRecord(session, abs);
      sessions.set(id, rec);
    } else {
      // Re-registering an existing session means the file content
      // changed — invalidate the cached injected HTML so the iframe
      // sees the new content on next /target/:id fetch.
      rec.cachedHtml = null;
    }
    return { id, url: `http://localhost:${port}/#/s/${id}` };
  }

  // ─── HTTP server ──────────────────────────────────────────────────────

  const server = createServer(async (req, res) => {
    try {
      await handle(req, res);
    } catch (e) {
      process.stderr.write(
        `[htmlnote] handler error: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`,
      );
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "text/plain" });
      }
      res.end("internal error");
    }
  });

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const hostHeader = req.headers.host ?? "";
    if (!allowedHosts.has(hostHeader)) {
      return send(res, 403, "text/plain", "forbidden host");
    }

    if (req.method && req.method !== "GET" && req.method !== "HEAD") {
      if (req.headers[CSRF_HEADER] !== "1") {
        return send(res, 403, "text/plain", "missing csrf header");
      }
    }

    const url = new URL(req.url ?? "/", "http://localhost");
    const p = url.pathname;

    if (p === "/api/ping" && req.method === "GET") {
      return sendJSON(res, { ok: true, version: "daemon" });
    }
    if (p === "/api/heartbeat" && req.method === "GET") {
      return sendJSON(res, { ok: true });
    }
    if (p === "/api/active" && req.method === "GET") {
      return sendJSON(res, { ok: true });
    }

    if (p === "/" || p === "/index.html") {
      res.setHeader("X-Frame-Options", "DENY");
      res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
      return send(res, 200, "text/html; charset=utf-8", uiHtml);
    }

    if (p === "/api/sessions" && req.method === "GET") {
      return sendJSON(res, { sessions: summarize() });
    }

    if (p === "/api/sessions" && req.method === "POST") {
      const body = await readBody(req);
      if (body === null) return send(res, 413, "text/plain", "body too large");
      let parsed: { filePath?: unknown };
      try {
        parsed = JSON.parse(body) as { filePath?: unknown };
      } catch {
        return send(res, 400, "text/plain", "bad json");
      }
      if (typeof parsed.filePath !== "string" || parsed.filePath.length > 4096) {
        return send(res, 400, "text/plain", "bad filePath");
      }
      const info = await registerSession(parsed.filePath);
      return sendJSON(res, info);
    }

    // Turn write tracking — PostToolUse adds, Stop reads, UserPromptSubmit
    // clears. The whole loop state.
    if (p === "/api/turn" && req.method === "GET") {
      const list = Array.from(turnWrites)
        .filter((id) => sessions.has(id))
        .map((id) => ({ id, url: `http://localhost:${port}/#/s/${id}` }));
      return sendJSON(res, { sessions: list });
    }
    if (p === "/api/turn/record" && req.method === "POST") {
      const body = await readBody(req);
      if (body === null) return send(res, 413, "text/plain", "body too large");
      let parsed: { sessionId?: unknown };
      try {
        parsed = JSON.parse(body) as { sessionId?: unknown };
      } catch {
        return send(res, 400, "text/plain", "bad json");
      }
      if (typeof parsed.sessionId !== "string" || parsed.sessionId.length > 64) {
        return send(res, 400, "text/plain", "bad sessionId");
      }
      turnWrites.add(parsed.sessionId);
      return sendJSON(res, { ok: true });
    }
    if (p === "/api/turn/reset" && req.method === "POST") {
      turnWrites.clear();
      return sendJSON(res, { ok: true });
    }

    // ─── Per-session routes ────────────────────────────────────────────

    const targetMatch = p.match(/^\/target\/([a-zA-Z0-9_-]{1,64})$/);
    if (targetMatch && req.method === "GET") {
      const rec = sessions.get(targetMatch[1]);
      if (!rec) return send(res, 404, "text/plain", "session not found");
      res.setHeader("X-Frame-Options", "SAMEORIGIN");
      return send(res, 200, "text/html; charset=utf-8", await ensureHtml(rec));
    }

    const assetMatch = p.match(/^\/asset\/([a-zA-Z0-9_-]{1,64})\/(.+)$/);
    if (assetMatch && req.method === "GET") {
      const rec = sessions.get(assetMatch[1]);
      if (!rec || !rec.assetRootReal) {
        return send(res, 404, "text/plain", "not found");
      }
      return serveAsset(req, res, rec.assetRootReal, assetMatch[2]);
    }

    const getMatch = p.match(/^\/api\/sessions\/([a-zA-Z0-9_-]{1,64})$/);
    if (getMatch && req.method === "GET") {
      const rec = sessions.get(getMatch[1]);
      if (!rec) return send(res, 404, "text/plain", "session not found");
      return sendJSON(res, rec.session);
    }

    // POST /api/sessions/:id/annotations — add (always allowed; no
    // "active session" gating now that nothing's blocking).
    const annPost = p.match(/^\/api\/sessions\/([a-zA-Z0-9_-]{1,64})\/annotations$/);
    if (annPost && req.method === "POST") {
      const rec = sessions.get(annPost[1]);
      if (!rec) return send(res, 404, "text/plain", "session not found");
      const body = await readBody(req);
      if (body === null) return send(res, 413, "text/plain", "body too large");
      let parsed: unknown;
      try { parsed = JSON.parse(body); } catch { return send(res, 400, "text/plain", "bad json"); }
      if (!isAnnotationShape(parsed)) {
        return send(res, 400, "text/plain", "bad annotation shape");
      }
      const ann = parsed as Annotation;
      const existing = rec.session.annotations.findIndex((a) => a.id === ann.id);
      if (existing >= 0) rec.session.annotations[existing] = ann;
      else rec.session.annotations.push(ann);
      renumber(rec.session);
      saveSession(rec.session);
      return sendJSON(res, rec.session);
    }

    const annDel = p.match(/^\/api\/sessions\/([a-zA-Z0-9_-]{1,64})\/annotations\/(.+)$/);
    if (annDel && req.method === "DELETE") {
      const rec = sessions.get(annDel[1]);
      if (!rec) return send(res, 404, "text/plain", "session not found");
      const annId = decodeURIComponent(annDel[2]);
      if (!annId || annId.length > 64) return send(res, 400, "text/plain", "bad id");
      rec.session.annotations = rec.session.annotations.filter((a) => a.id !== annId);
      renumber(rec.session);
      saveSession(rec.session);
      return sendJSON(res, rec.session);
    }

    const annClear = p.match(/^\/api\/sessions\/([a-zA-Z0-9_-]{1,64})\/annotations$/);
    if (annClear && req.method === "DELETE") {
      const rec = sessions.get(annClear[1]);
      if (!rec) return send(res, 404, "text/plain", "session not found");
      rec.session.annotations = [];
      saveSession(rec.session);
      return sendJSON(res, rec.session);
    }

    const sessDel = p.match(/^\/api\/sessions\/([a-zA-Z0-9_-]{1,64})$/);
    if (sessDel && req.method === "DELETE") {
      const id = sessDel[1];
      const rec = sessions.get(id);
      if (!rec) return send(res, 404, "text/plain", "session not found");
      deleteSessionFile(id);
      sessions.delete(id);
      turnWrites.delete(id);
      return sendJSON(res, { ok: true });
    }

    // Export helpers for shell-pipeline consumers and the SPA's Copy button
    // (the SPA prefers building markdown client-side from the session it
    // already has, but the endpoint stays useful for curl / curl-via-pipe).
    const expMd = p.match(/^\/api\/sessions\/([a-zA-Z0-9_-]{1,64})\/export\.md$/);
    if (expMd && req.method === "GET") {
      const rec = sessions.get(expMd[1]);
      if (!rec) return send(res, 404, "text/plain", "session not found");
      return send(res, 200, "text/markdown; charset=utf-8", toMarkdown(rec.session));
    }
    const expJson = p.match(/^\/api\/sessions\/([a-zA-Z0-9_-]{1,64})\/export\.json$/);
    if (expJson && req.method === "GET") {
      const rec = sessions.get(expJson[1]);
      if (!rec) return send(res, 404, "text/plain", "session not found");
      return send(res, 200, "application/json", toJSON(rec.session));
    }

    return send(res, 404, "text/plain", "not found");
  }

  return new Promise<DaemonHandle>((resolveFn) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      port = typeof addr === "object" && addr ? addr.port : 0;
      allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

      resolveFn({
        port,
        url: `http://localhost:${port}`,
        registerSession,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

// ─── Asset serving (unchanged; lifted from v0.1.5) ───────────────────────

async function serveAsset(
  req: IncomingMessage,
  res: ServerResponse,
  assetRootReal: string,
  rel: string,
): Promise<void> {
  const decoded = decodeURIComponent(rel);
  const ext = extname(decoded).toLowerCase();
  if (!ASSET_EXTENSIONS.has(ext)) {
    return send(res, 404, "text/plain", "not found");
  }
  const lexical = resolve(assetRootReal, decoded);
  let realPath: string;
  try {
    realPath = await realpath(lexical);
  } catch {
    return send(res, 404, "text/plain", "not found");
  }
  if (
    realPath !== assetRootReal &&
    !realPath.startsWith(assetRootReal + sep)
  ) {
    return send(res, 403, "text/plain", "forbidden");
  }
  try {
    const s = await stat(realPath);
    if (!s.isFile()) return send(res, 404, "text/plain", "not found");
    const data = await readFile(realPath);
    const origin = req.headers.origin;
    const port = (req.socket.localPort ?? 0);
    if (
      origin === "null" ||
      origin === `http://127.0.0.1:${port}` ||
      origin === `http://localhost:${port}`
    ) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    return sendBuf(res, 200, MIME[ext] ?? "application/octet-stream", data);
  } catch {
    return send(res, 404, "text/plain", "not found");
  }
}

// ─── Low-level response helpers ──────────────────────────────────────────

function send(
  res: ServerResponse,
  status: number,
  type: string,
  body: string,
) {
  res.writeHead(status, { "content-type": type });
  res.end(body);
}

function sendBuf(
  res: ServerResponse,
  status: number,
  type: string,
  body: Buffer,
) {
  res.writeHead(status, { "content-type": type });
  res.end(body);
}

function sendJSON(res: ServerResponse, body: unknown) {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((res, rej) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let resolved = false;
    const settle = (v: string | null) => {
      if (resolved) return;
      resolved = true;
      res(v);
    };
    req.on("data", (c: Buffer) => {
      if (resolved) return;
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        settle(null);
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => settle(Buffer.concat(chunks).toString("utf8")));
    req.on("error", rej);
  });
}

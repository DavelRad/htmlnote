import { createHash } from "node:crypto";
import { homedir } from "node:os";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { Session } from "../shared/types.js";

export const ROOT = join(homedir(), ".htmlnote");
export const SESSIONS_DIR = join(ROOT, "sessions");
export const DAEMON_FILE = join(ROOT, "daemon.json");

let dirReady = false;
function ensureDir(): void {
  if (dirReady) return;
  try {
    mkdirSync(SESSIONS_DIR, { recursive: true });
    dirReady = true;
  } catch (e) {
    // Surface a clear error rather than crashing deep in the call stack.
    throw new Error(
      `[htmlnote] cannot create state dir ${SESSIONS_DIR}: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }
}

export function hashFor(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 12);
}

export function sessionPath(id: string): string {
  return join(SESSIONS_DIR, `${id}.json`);
}

function isSessionShape(x: unknown): x is Session {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.title === "string" &&
    typeof o.createdAt === "number" &&
    Array.isArray(o.annotations) &&
    typeof o.source === "object" &&
    o.source !== null
  );
}

/**
 * Load a previously-saved session. Returns null if the file is missing,
 * unparseable, or doesn't match the expected shape — corrupt files
 * shouldn't poison a fresh session.
 */
export function loadSession(id: string): Session | null {
  ensureDir();
  const p = sessionPath(id);
  if (!existsSync(p)) return null;
  try {
    const parsed = JSON.parse(readFileSync(p, "utf8"));
    if (!isSessionShape(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSession(s: Session): void {
  ensureDir();
  // Write to a temp file then rename so a crash mid-write doesn't leave a
  // truncated JSON behind. renameSync is atomic on the same filesystem.
  const final = sessionPath(s.id);
  const tmp = `${final}.tmp`;
  writeFileSync(tmp, JSON.stringify(s, null, 2));
  renameSync(tmp, final);
}

/**
 * Enumerate every persisted session. Quietly skips files that don't parse
 * or don't match the Session shape — corrupt/unrelated files in
 * `~/.htmlnote/sessions/` shouldn't crash the daemon.
 */
export function listSessions(): Session[] {
  ensureDir();
  let entries: string[];
  try {
    entries = readdirSync(SESSIONS_DIR);
  } catch {
    return [];
  }
  const out: Session[] = [];
  for (const name of entries) {
    if (!name.endsWith(".json") || name.endsWith(".tmp")) continue;
    const id = name.slice(0, -5);
    const s = loadSession(id);
    if (s) out.push(s);
  }
  return out;
}

export function deleteSession(id: string): boolean {
  const p = sessionPath(id);
  try {
    unlinkSync(p);
    return true;
  } catch {
    return false;
  }
}

export type DaemonHandle = {
  pid: number;
  port: number;
  version: string;
  startedAt: number;
};

export function readDaemonHandle(): DaemonHandle | null {
  if (!existsSync(DAEMON_FILE)) return null;
  try {
    const raw = JSON.parse(readFileSync(DAEMON_FILE, "utf8"));
    if (
      typeof raw?.pid === "number" &&
      typeof raw?.port === "number" &&
      typeof raw?.version === "string" &&
      typeof raw?.startedAt === "number"
    ) {
      return raw as DaemonHandle;
    }
  } catch {
    /* corrupt → treat as missing */
  }
  return null;
}

export function writeDaemonHandle(handle: DaemonHandle): void {
  ensureDir();
  const tmp = `${DAEMON_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(handle));
  renameSync(tmp, DAEMON_FILE);
}

export function clearDaemonHandle(): void {
  try {
    unlinkSync(DAEMON_FILE);
  } catch {
    /* already gone */
  }
}

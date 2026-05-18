import { spawn } from "node:child_process";
import { readDaemonHandle, type DaemonHandle } from "./storage.js";
import { CSRF_HEADER } from "../shared/constants.js";

const SPAWN_READY_TIMEOUT_MS = 5_000;
const SPAWN_POLL_INTERVAL_MS = 100;

/** Best-effort liveness check. False on ECONNREFUSED, timeouts, 5xx, etc. */
export async function pingDaemon(port: number): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1000);
    const r = await fetch(`http://127.0.0.1:${port}/api/ping`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Find or spawn a daemon. If the discovery file points to a live process,
 * return it. Otherwise launch a detached child running `--daemon`, poll
 * until it answers /api/ping, then return its handle.
 */
export async function ensureDaemon(): Promise<DaemonHandle> {
  const existing = readDaemonHandle();
  if (existing && (await pingDaemon(existing.port))) {
    return existing;
  }

  const isNodeScript = process.argv[1]?.endsWith(".mjs") ?? false;
  const cmd = process.execPath;
  const args = isNodeScript ? [process.argv[1]!, "--daemon"] : ["--daemon"];

  const child = spawn(cmd, args, {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();

  const deadline = Date.now() + SPAWN_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, SPAWN_POLL_INTERVAL_MS));
    const handle = readDaemonHandle();
    if (handle && (await pingDaemon(handle.port))) {
      return handle;
    }
  }
  throw new Error(
    `[htmlnote] daemon failed to start within ${SPAWN_READY_TIMEOUT_MS}ms`,
  );
}

const MUTATION_HEADERS = {
  "content-type": "application/json",
  [CSRF_HEADER]: "1",
};

/** POST /api/sessions — daemon creates or reuses a session for the given
 *  file path. Returns id + the SPA URL to point the browser at. */
export async function registerSession(
  handle: DaemonHandle,
  filePath: string,
): Promise<{ id: string; url: string }> {
  const r = await fetch(`http://127.0.0.1:${handle.port}/api/sessions`, {
    method: "POST",
    headers: MUTATION_HEADERS,
    body: JSON.stringify({ filePath }),
  });
  if (!r.ok) {
    throw new Error(`registerSession failed: HTTP ${r.status}`);
  }
  return (await r.json()) as { id: string; url: string };
}

/** POST /api/turn/record — tells the daemon that this session was
 *  written during the current turn. The Stop hook reads this set later
 *  to decide whether to pop a browser tab. */
export async function turnRecord(
  handle: DaemonHandle,
  sessionId: string,
): Promise<void> {
  await fetch(`http://127.0.0.1:${handle.port}/api/turn/record`, {
    method: "POST",
    headers: MUTATION_HEADERS,
    body: JSON.stringify({ sessionId }),
  }).catch(() => {});
}

/** GET /api/turn — returns the set of sessionIds written this turn. */
export async function turnSnapshot(
  handle: DaemonHandle,
): Promise<{ sessions: { id: string; url: string }[] }> {
  const r = await fetch(`http://127.0.0.1:${handle.port}/api/turn`);
  if (!r.ok) throw new Error(`turnSnapshot failed: HTTP ${r.status}`);
  return (await r.json()) as { sessions: { id: string; url: string }[] };
}

/** POST /api/turn/reset — clears the turn write set (turn boundary). */
export async function turnReset(handle: DaemonHandle): Promise<void> {
  await fetch(`http://127.0.0.1:${handle.port}/api/turn/reset`, {
    method: "POST",
    headers: MUTATION_HEADERS,
  }).catch(() => {});
}

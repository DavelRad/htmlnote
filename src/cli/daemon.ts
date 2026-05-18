import { startServer } from "./server.js";
import {
  clearDaemonHandle,
  readDaemonHandle,
  writeDaemonHandle,
} from "./storage.js";
import { VERSION } from "./version.js";
import { pingDaemon } from "./daemon-client.js";

/**
 * Entry point for `htmlnote --daemon`. Starts the long-lived multi-session
 * server. Manages the discovery file at ~/.htmlnote/daemon.json so client
 * processes (hooks, standalone invocations) can find us.
 *
 * Stays running indefinitely — no auto-shutdown. The user kills it with
 * `htmlnote --stop` or by signal. SIGTERM/SIGINT clean up the discovery
 * file so the next hook spawns a fresh daemon instead of finding a dead pid.
 */
export async function runDaemon(): Promise<void> {
  // If another daemon is already up, bail out cleanly. The first hook to
  // race-spawn us wins; subsequent spawners discover the live one and exit.
  const existing = readDaemonHandle();
  if (existing && (await pingDaemon(existing.port))) {
    process.stderr.write(
      `[htmlnote] daemon already running (pid ${existing.pid}, port ${existing.port})\n`,
    );
    return;
  }

  const server = await startServer();

  writeDaemonHandle({
    pid: process.pid,
    port: server.port,
    version: VERSION,
    startedAt: Date.now(),
  });

  process.stderr.write(
    `[htmlnote] daemon listening on ${server.url} (pid ${process.pid})\n`,
  );

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals | "exit") => async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stderr.write(`[htmlnote] daemon shutting down (${signal})\n`);
    clearDaemonHandle();
    try {
      await server.close();
    } catch {
      /* best-effort */
    }
    if (signal !== "exit") process.exit(0);
  };

  process.on("SIGTERM", shutdown("SIGTERM"));
  process.on("SIGINT", shutdown("SIGINT"));
  process.on("SIGHUP", shutdown("SIGHUP"));
  // exit fires for unhandled rejections too — last chance to clean the
  // discovery file so a future hook isn't fooled.
  process.on("exit", () => clearDaemonHandle());

  // Keep the event loop alive. Without an explicit reference the
  // server.listen() keeps it open, but be defensive.
  setInterval(() => {}, 1 << 30).unref();
}

/** Send SIGTERM to a running daemon (called from `htmlnote --stop`). */
export async function stopDaemon(): Promise<void> {
  const handle = readDaemonHandle();
  if (!handle) {
    process.stderr.write("[htmlnote] no daemon running\n");
    return;
  }
  // Verify the pid is actually our daemon before killing — daemon.json
  // could be stale (crash) and another process recycled the pid.
  if (!(await pingDaemon(handle.port))) {
    clearDaemonHandle();
    process.stderr.write("[htmlnote] daemon was already dead; cleared stale handle\n");
    return;
  }
  try {
    process.kill(handle.pid, "SIGTERM");
    process.stderr.write(`[htmlnote] sent SIGTERM to daemon (pid ${handle.pid})\n`);
  } catch (e) {
    process.stderr.write(
      `[htmlnote] couldn't signal daemon: ${e instanceof Error ? e.message : String(e)}\n`,
    );
  }
}

import open from "open";
import { basename } from "node:path";
import { existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { buildHookResponse, parseHookInput, readStdin } from "./hook.js";
import { runDaemon, stopDaemon } from "./daemon.js";
import {
  ensureDaemon,
  pingDaemon,
  registerSession,
  turnRecord,
  turnReset,
  turnSnapshot,
} from "./daemon-client.js";
import { readDaemonHandle } from "./storage.js";
import { runUpdate } from "./update.js";
import { maybeNotifyUpdate } from "./version-check.js";
import { VERSION } from "./version.js";

type Args = {
  file: string | null;
  hook: boolean;
  stopHook: boolean;
  userPromptTick: boolean;
  help: boolean;
  version: boolean;
  update: boolean;
  daemon: boolean;
  stop: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    file: null,
    hook: false,
    stopHook: false,
    userPromptTick: false,
    help: false,
    version: false,
    update: false,
    daemon: false,
    stop: false,
  };
  for (const a of argv) {
    if (a === "--hook") args.hook = true;
    else if (a === "--stop-hook") args.stopHook = true;
    else if (a === "--user-prompt-tick") args.userPromptTick = true;
    else if (a === "-h" || a === "--help") args.help = true;
    else if (a === "-v" || a === "--version") args.version = true;
    else if (a === "--update") args.update = true;
    else if (a === "--daemon") args.daemon = true;
    else if (a === "--stop") args.stop = true;
    else if (!a.startsWith("--") && !args.file) args.file = a;
  }
  return args;
}

const HELP = `htmlnote — annotate AI-generated HTML in the browser

USAGE
  htmlnote <file.html>              open a file for review in browser
  htmlnote --hook                   Claude Code PostToolUse hook (reads stdin)
  htmlnote --stop-hook              Claude Code Stop hook
  htmlnote --user-prompt-tick       Claude Code UserPromptSubmit hook
  htmlnote --daemon                 start the long-lived multi-session server
  htmlnote --stop                   send SIGTERM to the running daemon
  htmlnote --update                 self-update to the latest release
  htmlnote -v, --version            print version
  htmlnote -h, --help               this message

KEYBOARD (in app)
  E                toggle annotate mode
  Click            drop a pin
  Drag             highlight text and annotate it
  N                add a general note (no element)
  J / K            walk annotations
  Esc              cancel composer / exit mode
  ⌘+K              command palette
  ?                shortcuts
`;

function writeStdoutAndExit(payload: string, code: number): void {
  const exit = () => process.exit(code);
  if (payload) process.stdout.write(payload, exit);
  else process.stdout.end(exit);
}

/**
 * PostToolUse hook on Write/Edit/MultiEdit. Non-blocking in v0.2.0:
 * register the session with the daemon, mark the file as written this
 * turn, exit. The browser tab gets opened by the Stop hook later, after
 * Claude finishes its response — so users don't get a popup PER edit.
 */
async function runHook(): Promise<void> {
  const raw = await readStdin();
  const { filePath, skip } = parseHookInput(raw);
  if (skip || !filePath) {
    return writeStdoutAndExit(buildHookResponse(null), 0);
  }
  const abs = resolvePath(filePath);
  if (!existsSync(abs)) {
    return writeStdoutAndExit(buildHookResponse(null), 0);
  }

  try {
    const handle = await ensureDaemon();
    const info = await registerSession(handle, abs);
    await turnRecord(handle, info.id);
    process.stderr.write(
      `[htmlnote] recorded ${basename(abs)} — review at end of turn\n`,
    );
  } catch (e) {
    // Best-effort: if daemon can't be reached, just exit silently so we
    // don't block Claude. The user loses a review for this turn but
    // everything else keeps working.
    process.stderr.write(
      `[htmlnote] hook bypassed: ${e instanceof Error ? e.message : String(e)}\n`,
    );
  }
  return writeStdoutAndExit(buildHookResponse(null), 0);
}

/**
 * Stop hook fires when Claude finishes responding. If any HTML was
 * written this turn, open the daemon URL in the browser so the user
 * can review the final post-edit state. Exits immediately — does NOT
 * wait for the user. The browser tab persists as long as the user wants
 * to look at it.
 */
async function runStopHook(): Promise<void> {
  await readStdin().catch(() => "");

  // Don't spawn a daemon just for Stop. If nothing's running, no
  // turn-write state exists, nothing to review.
  const existing = readDaemonHandle();
  if (!existing || !(await pingDaemon(existing.port))) {
    return writeStdoutAndExit("{}", 0);
  }

  let snap;
  try {
    snap = await turnSnapshot(existing);
  } catch {
    return writeStdoutAndExit("{}", 0);
  }
  if (snap.sessions.length === 0) {
    return writeStdoutAndExit("{}", 0);
  }

  // Open the first session that was touched. The SPA's sidebar shows
  // all of them, so the user can navigate between them if more than
  // one was written.
  const first = snap.sessions[0];
  process.stderr.write(
    `[htmlnote] opening review for ${snap.sessions.length} file(s) at ${first.url}\n`,
  );
  try {
    await open(first.url);
  } catch {
    /* user can navigate manually */
  }
  return writeStdoutAndExit("{}", 0);
}

/**
 * UserPromptSubmit hook fires on every user message. Marks the turn
 * boundary by clearing the daemon's set of files written-this-turn.
 * Doesn't spawn a daemon if none is running — nothing to clear.
 */
async function runUserPromptTick(): Promise<void> {
  await readStdin().catch(() => "");
  const existing = readDaemonHandle();
  if (existing && (await pingDaemon(existing.port))) {
    await turnReset(existing).catch(() => {});
  }
  return writeStdoutAndExit("{}", 0);
}

/**
 * Standalone CLI: `htmlnote sample.html` — open the file in the browser
 * for review. Returns immediately; the user clicks Copy in the SPA when
 * they're ready. No more --json stdout dump (use /api/sessions/:id/export.md
 * with curl if you need a shell pipeline).
 */
async function runStandalone(args: Args): Promise<void> {
  if (!args.file) {
    process.stderr.write(HELP);
    process.exit(1);
  }
  const abs = resolvePath(args.file);
  if (!existsSync(abs)) {
    process.stderr.write(`[htmlnote] file not found or unreadable: ${args.file}\n`);
    process.exit(1);
  }
  const handle = await ensureDaemon();
  const info = await registerSession(handle, abs);
  process.stderr.write(`[htmlnote] reviewing ${basename(abs)} at ${info.url}\n`);
  try {
    await open(info.url);
  } catch {
    /* user can open manually */
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }
  if (args.version) {
    process.stdout.write(`htmlnote ${VERSION}\n`);
    return;
  }
  if (args.update) {
    return runUpdate();
  }
  if (args.stop) {
    return stopDaemon();
  }
  if (args.daemon) {
    return runDaemon();
  }
  if (args.stopHook) {
    return runStopHook();
  }
  if (args.userPromptTick) {
    return runUserPromptTick();
  }
  // Cheap synchronous cache read + fire-and-forget network refresh.
  maybeNotifyUpdate();
  if (args.hook) return runHook();
  return runStandalone(args);
}

process.on("unhandledRejection", (err) => {
  process.stderr.write(
    `[htmlnote] unhandled rejection: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  process.stderr.write(`[htmlnote] uncaught: ${err.message}\n`);
  process.exit(1);
});

main().catch((e) => {
  process.stderr.write(
    `[htmlnote] ${e instanceof Error ? e.message : String(e)}\n`,
  );
  process.exit(1);
});

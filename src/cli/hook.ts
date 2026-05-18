import { extname } from "node:path";

export type ClaudeHookInput = {
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: { file_path?: string; [k: string]: unknown };
  tool_response?: { success?: boolean; [k: string]: unknown };
  cwd?: string;
};

/**
 * Read all of stdin or give up after `timeoutMs`. The timeout exists because
 * the Claude Code PostToolUse hook has a multi-day timeout — if stdin opens
 * but the parent never writes (e.g., died mid-spawn), we'd hang for days.
 * 5 seconds is plenty for the harness to write a small JSON event.
 */
export async function readStdin(timeoutMs = 5000): Promise<string> {
  return new Promise((res) => {
    if (process.stdin.isTTY) return res("");
    let data = "";
    let resolved = false;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      res(data);
    };
    const timer = setTimeout(() => {
      if (!resolved) {
        process.stderr.write(`[htmlnote] stdin timeout after ${timeoutMs}ms\n`);
        finish();
      }
    }, timeoutMs);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", finish);
    process.stdin.on("error", finish);
  });
}

export function parseHookInput(raw: string): {
  filePath: string | null;
  skip: boolean;
} {
  if (!raw.trim()) return { filePath: null, skip: true };
  try {
    const obj = JSON.parse(raw) as ClaudeHookInput;
    // If the tool itself failed (permission denied, etc.), don't pop a review
    // window for a file Claude never actually wrote.
    if (obj.tool_response && obj.tool_response.success === false) {
      return { filePath: null, skip: true };
    }
    const file = obj.tool_input?.file_path ?? null;
    if (!file) return { filePath: null, skip: true };
    const ext = extname(file).toLowerCase();
    if (ext !== ".html" && ext !== ".htm") {
      return { filePath: file, skip: true };
    }
    return { filePath: file, skip: false };
  } catch {
    return { filePath: null, skip: true };
  }
}

/** Wrap feedback in Claude Code's PostToolUse additionalContext envelope. */
export function buildHookResponse(feedback: string | null): string {
  if (feedback === null) return JSON.stringify({});
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: feedback,
    },
  });
}

import { createHash } from "node:crypto";
import { chmod, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fetchLatestVersion, compareVersions } from "./version-check.js";
import { REPO, VERSION } from "./version.js";

type Target = `${"darwin" | "linux"}-${"x64" | "arm64"}`;

function detectTarget(): Target | null {
  let os: "darwin" | "linux" | null = null;
  if (process.platform === "darwin") os = "darwin";
  else if (process.platform === "linux") os = "linux";
  if (!os) return null;

  let arch: "x64" | "arm64" | null = null;
  if (process.arch === "x64") arch = "x64";
  else if (process.arch === "arm64") arch = "arm64";
  if (!arch) return null;

  return `${os}-${arch}`;
}

/**
 * Sanity-check that we look like an installed bun-compiled binary, not
 * `node bin/htmlnote.mjs` from a dev checkout. Replacing the user's `node`
 * executable would be… bad. The compiled binary's argv[0] / execPath ends
 * in "htmlnote"; the dev path ends in "node".
 */
function looksLikeInstalledBinary(execPath: string): boolean {
  const name = basename(execPath).toLowerCase();
  return name === "htmlnote" || name === "htmlnote.exe";
}

async function fetchBinaryBytes(url: string): Promise<Buffer> {
  const r = await fetch(url, { redirect: "follow" });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
  return Buffer.from(await r.arrayBuffer());
}

async function fetchText(url: string): Promise<string> {
  const r = await fetch(url, { redirect: "follow" });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
  return r.text();
}

function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Self-update: download the latest release binary and atomic-rename it
 * over the running executable. Unix lets a running process keep executing
 * even after its inode is unlinked, so the rename is safe — the next
 * invocation picks up the new binary.
 */
export async function runUpdate(): Promise<void> {
  const log = (msg: string) => process.stderr.write(`[htmlnote] ${msg}\n`);

  const target = detectTarget();
  if (!target) {
    log(
      `unsupported platform (${process.platform}/${process.arch}) — re-run install.sh manually`,
    );
    process.exit(1);
  }

  const execPath = process.execPath;
  if (!looksLikeInstalledBinary(execPath)) {
    log(`not running as the installed binary (execPath: ${execPath})`);
    log(`update via: curl -fsSL https://raw.githubusercontent.com/${REPO}/main/install.sh | bash`);
    process.exit(1);
  }

  log("checking latest release");
  const latest = await fetchLatestVersion();
  if (!latest) {
    log("couldn't resolve latest release — try again later");
    process.exit(1);
  }

  if (compareVersions(latest, VERSION) <= 0) {
    log(`already on the latest version (v${VERSION})`);
    return;
  }

  log(`updating v${VERSION} → ${latest}`);
  const binUrl = `https://github.com/${REPO}/releases/download/${latest}/htmlnote-${target}`;
  const sumUrl = `${binUrl}.sha256`;

  let binBuf: Buffer;
  let sumText: string;
  try {
    [binBuf, sumText] = await Promise.all([
      fetchBinaryBytes(binUrl),
      fetchText(sumUrl),
    ]);
  } catch (e) {
    log(`download failed: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  // sha256 file format: "<hash>  <filename>\n" — take the first whitespace token.
  const expected = sumText.trim().split(/\s+/)[0]?.toLowerCase();
  const actual = sha256Hex(binBuf);
  if (!expected || expected !== actual) {
    log(`checksum mismatch — refusing to install (expected ${expected}, got ${actual})`);
    process.exit(1);
  }
  log("checksum verified");

  // Write tmp into the SAME directory so the final rename is on one
  // filesystem (rename across filesystems falls back to copy and isn't
  // atomic). pid in the name avoids collision if two updates raced.
  const tmpPath = join(dirname(execPath), `.htmlnote.update.${process.pid}`);
  try {
    await writeFile(tmpPath, binBuf);
    await chmod(tmpPath, 0o755);
    await rename(tmpPath, execPath);
  } catch (e) {
    await unlink(tmpPath).catch(() => {});
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("EACCES") || msg.includes("EPERM")) {
      log(`permission denied writing ${execPath}`);
      log("you may have installed with sudo — re-run install.sh with sudo");
    } else {
      log(`install failed: ${msg}`);
    }
    process.exit(1);
  }

  log(`updated to ${latest}`);
}

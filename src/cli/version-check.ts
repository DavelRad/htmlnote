import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./storage.js";
import { REPO, VERSION } from "./version.js";

const CACHE_FILE = join(ROOT, "version-check.json");

/** 24h — strikes a balance between catching releases promptly and not
 *  pinging GitHub on every hook fire (which could exhaust the 60/hr
 *  unauthenticated rate limit for users on busy projects). */
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

type CheckCache = {
  lastChecked: number;
  latest: string;
};

function readCacheSync(): CheckCache | null {
  if (!existsSync(CACHE_FILE)) return null;
  try {
    const parsed = JSON.parse(readFileSync(CACHE_FILE, "utf8"));
    if (
      typeof parsed?.lastChecked === "number" &&
      typeof parsed?.latest === "string" &&
      parsed.lastChecked <= Date.now() // reject future timestamps from clock jumps
    ) {
      return parsed as CheckCache;
    }
  } catch {
    /* corrupt → refresh */
  }
  return null;
}

function writeCacheSync(cache: CheckCache): void {
  try {
    mkdirSync(ROOT, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(cache));
  } catch {
    /* cache miss next run is fine — never let this break the hook */
  }
}

/**
 * Compare two version strings like "v0.1.0", "0.1.10", "1.2".
 * Returns negative if a < b, zero if equal, positive if a > b.
 * Pre-release suffixes (-beta etc.) are stripped — we treat
 * v0.1.0-beta and v0.1.0 as equal rather than partially ordering them.
 */
export function compareVersions(a: string, b: string): number {
  const norm = (s: string) =>
    s.replace(/^v/, "").split("-")[0].split(".").map((p) => parseInt(p, 10) || 0);
  const pa = norm(a);
  const pb = norm(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Hits the GitHub releases API. Returns null on any failure (network, rate
 *  limit, malformed payload, etc.) — version checking is best-effort. */
export async function fetchLatestVersion(): Promise<string | null> {
  try {
    const r = await fetch(
      `https://api.github.com/repos/${REPO}/releases/latest`,
      {
        headers: {
          "user-agent": `htmlnote/${VERSION}`,
          accept: "application/vnd.github+json",
        },
      },
    );
    if (!r.ok) return null;
    const data = (await r.json()) as { tag_name?: unknown };
    return typeof data.tag_name === "string" ? data.tag_name : null;
  } catch {
    return null;
  }
}

/**
 * Synchronous cache read + (optionally) fire-and-forget refresh.
 *
 * Prints a stderr line if the cached "latest" is newer than the running
 * version. We deliberately use the *cached* value here — first-run users
 * see no notice until their second invocation, which is fine: the noise
 * cost of a delayed notice is much lower than the latency cost of an
 * awaited network call on every hook fire.
 *
 * Skipped when:
 *   - HTMLNOTE_NO_UPDATE_CHECK=1 is set (for CI, air-gapped users)
 *   - running a "dev" build (no embedded version to compare against)
 */
export function maybeNotifyUpdate(): void {
  if (process.env.HTMLNOTE_NO_UPDATE_CHECK === "1") return;
  if (VERSION === "dev") return;

  const cache = readCacheSync();
  const now = Date.now();

  if (cache?.latest && compareVersions(cache.latest, VERSION) > 0) {
    process.stderr.write(
      `[htmlnote] ${cache.latest} available (you have v${VERSION}) — run: htmlnote --update\n`,
    );
  }

  if (!cache || now - cache.lastChecked > CHECK_INTERVAL_MS) {
    // The hook server keeps the process alive while the user reviews, so
    // this typically resolves before the process exits. If it doesn't,
    // the next run picks up where we left off — cache stays valid.
    fetchLatestVersion()
      .then((latest) => {
        if (latest) writeCacheSync({ lastChecked: now, latest });
      })
      .catch(() => {
        /* network failure is fine — try again tomorrow */
      });
  }
}

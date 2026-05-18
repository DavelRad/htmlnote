import { DATA_ATTR } from "../shared/constants.js";
import { IFRAME_BRIDGE_SCRIPT } from "../iframe-bridge.js";

const SCRIPT_TAG = `<script ${DATA_ATTR}="bridge">${IFRAME_BRIDGE_SCRIPT}</script>`;

// `\b` word boundary stops <head\b> from also matching <header>, <headline>,
// <headquarters>, etc. Same for <base\b> (vs <basement>) and <html\b>.
const RE_HEAD_OPEN = /<head\b[^>]*>/i;
const RE_HEAD_CLOSE = /<\/head>/i;
const RE_HTML_OPEN = /<html\b[^>]*>/i;
const RE_BASE = /<base\b[^>]*>/i;

/**
 * Mutate the user's HTML so the sandboxed iframe can both:
 *   1. Resolve relative URLs against /asset/<sessionId>/* (so sibling
 *      CSS/JS/images load from THIS session's directory only — important
 *      now that the daemon serves multiple sessions on one port),
 *   2. Run our bridge script for hover/click/scroll capture.
 *
 * Bridge script goes at the end of <head>; <base> goes at the start so it
 * affects all subsequent relative URLs in the document. Existing <base> tags
 * in the source are left alone.
 */
export function injectBridge(html: string, sessionId: string): string {
  // sessionId is hashFor(absFilePath) — 12 hex chars, already validated by
  // crypto.createHash output, but defensively constrain just in case.
  const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, "");
  const baseTag = `<base href="/asset/${safeId}/">`;
  const hasBase = RE_BASE.test(html);
  const baseInsert = hasBase ? "" : baseTag;

  let out = html;
  if (baseInsert && RE_HEAD_OPEN.test(out)) {
    out = out.replace(RE_HEAD_OPEN, (m) => `${m}${baseInsert}`);
  }

  if (RE_HEAD_CLOSE.test(out)) {
    return out.replace(RE_HEAD_CLOSE, `${SCRIPT_TAG}</head>`);
  }
  if (RE_HEAD_OPEN.test(out)) {
    return out.replace(RE_HEAD_OPEN, (m) => `${m}${SCRIPT_TAG}`);
  }
  if (RE_HTML_OPEN.test(out)) {
    return out.replace(
      RE_HTML_OPEN,
      (m) => `${m}<head>${baseInsert}${SCRIPT_TAG}</head>`,
    );
  }
  return `<!doctype html><html><head>${baseInsert}${SCRIPT_TAG}</head><body>${out}</body></html>`;
}

// Single source of truth for the three "magic strings" that appear across
// CLI, SPA, and tests. Keeping them centralized so a future rename touches
// exactly one place — and the bridge string body in iframe-bridge.ts has a
// reciprocal comment reminding maintainers to keep its hardcoded copies in
// lockstep (the bridge runs inside the user's iframe with no import system).

/** HTTP header any state-changing request must carry. Cross-origin tabs
 *  can't set custom headers without preflight, which our server doesn't
 *  honor — effectively blocking CSRF. */
export const CSRF_HEADER = "x-htmlnote";

/** Identifying tag on every postMessage payload between bridge ↔ host. */
export const BRIDGE_TAG = "__htmlnote";

/** Data attribute marker on bridge-injected DOM nodes (script tag + outline
 *  elements). Used by `isOwn(el)` inside the bridge to ignore its own DOM. */
export const DATA_ATTR = "data-htmlnote";

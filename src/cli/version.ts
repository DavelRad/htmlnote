/**
 * The version baked in at build time by esbuild --define (see
 * scripts/build-cli.mjs). Falls back to "dev" when running source directly
 * — vitest, tsx, etc. — where the bundle pipeline hasn't run and the
 * global is undefined.
 */
export const VERSION: string =
  typeof __HTMLNOTE_VERSION__ !== "undefined" ? __HTMLNOTE_VERSION__ : "dev";

export const REPO = "DavelRad/htmlnote";

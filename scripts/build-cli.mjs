#!/usr/bin/env node
// Bundle the CLI with esbuild, injecting the package.json version as a
// compile-time constant. Keeping this as a script (not an inline package.json
// command) lets us read the version from the one source of truth — bumping
// version in one place flows into the compiled binary automatically.
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(resolve(here, "..", "package.json"), "utf8"),
);

await build({
  entryPoints: ["src/cli/index.ts"],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  outfile: "dist/cli.mjs",
  packages: "external",
  loader: { ".html": "text" },
  define: {
    __HTMLNOTE_VERSION__: JSON.stringify(pkg.version),
  },
});

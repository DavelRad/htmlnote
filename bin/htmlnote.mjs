#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, "..", "dist", "cli.mjs");

if (!existsSync(cli)) {
  console.error(
    "[htmlnote] dist/cli.mjs not found. Run `npm run build` first.",
  );
  process.exit(1);
}

await import(cli);

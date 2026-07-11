#!/usr/bin/env node
// Builds a standalone wfm binary with `bun build --compile`, embedding the
// package.json version via --define so `wfm --version` is correct in binaries
// (which have no package.json beside them to read at runtime).
// Regenerates src/generated/bundledSkills.ts first so the binary never ships
// stale embedded skill content (standalone binaries don't carry skills/ on
// disk, so `wfm skill list`/`skill install` fall back to that module).
// Pass through bun flags, e.g.:
//   node scripts/build-binary.mjs --target bun-darwin-arm64 --outfile ./dist/wfm-macos-arm64
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8"));

const generateScript = fileURLToPath(new URL("./generate-bundled-skills.mjs", import.meta.url));
const generate = spawnSync("node", [generateScript], { stdio: "inherit" });
if ((generate.status ?? 1) !== 0) {
  process.exit(generate.status ?? 1);
}

const result = spawnSync(
  "bun",
  ["build", "./src/index.ts", "--compile", "--define", `WFM_VERSION="${version}"`, ...process.argv.slice(2)],
  { stdio: "inherit" }
);

process.exit(result.status ?? 1);

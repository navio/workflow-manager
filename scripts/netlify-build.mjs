import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, ".netlify", "deploy");
const docsOutputDir = path.join(repoRoot, "doc", ".vitepress", "dist");
const remoteOutputDir = path.join(repoRoot, "apps", "remote-registry", "dist");
const remoteAppDir = path.join(repoRoot, "apps", "remote-registry");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
    ...options,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function resetOutputDir() {
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
}

function copyBuildOutput(sourceDir) {
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Build output not found: ${sourceDir}`);
  }

  fs.cpSync(sourceDir, outputDir, { recursive: true });
}

function writeRemoteRedirects() {
  fs.writeFileSync(path.join(outputDir, "_redirects"), "/* /index.html 200\n", "utf8");
}

function buildDocsSite() {
  run("bun", ["run", "docs:build"]);
  copyBuildOutput(docsOutputDir);
}

function buildRemoteRegistrySite() {
  run("bun", ["install", "--cwd", remoteAppDir]);
  run("bun", ["run", "remote-registry:build"]);
  copyBuildOutput(remoteOutputDir);
  writeRemoteRedirects();
}

const target = (process.env.NETLIFY_SITE_TARGET ?? "remote-ui").trim().toLowerCase();

resetOutputDir();

if (target === "docs") {
  console.log("[netlify] Building docs site");
  buildDocsSite();
} else if (target === "remote-ui") {
  console.log("[netlify] Building remote registry UI");
  buildRemoteRegistrySite();
} else {
  console.error(`Unsupported NETLIFY_SITE_TARGET: ${target}`);
  console.error("Expected one of: docs, remote-ui");
  process.exit(1);
}

console.log(`[netlify] Publish directory ready at ${outputDir}`);

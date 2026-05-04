import fs from "node:fs";
import path from "node:path";

function resolveGitDir(repoRoot) {
  const gitPath = path.join(repoRoot, ".git");
  if (!fs.existsSync(gitPath)) {
    return null;
  }

  const stat = fs.statSync(gitPath);
  if (stat.isDirectory()) {
    return gitPath;
  }

  const content = fs.readFileSync(gitPath, "utf8").trim();
  const match = /^gitdir:\s*(.+)$/i.exec(content);
  if (!match) {
    return null;
  }

  return path.resolve(repoRoot, match[1]);
}

function installPreCommitHook(gitDir) {
  const hooksDir = path.join(gitDir, "hooks");
  const hookPath = path.join(hooksDir, "pre-commit");
  const hookContent = `#!/bin/sh
set -eu

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"

bun run lint:staged
`;

  fs.mkdirSync(hooksDir, { recursive: true });
  fs.writeFileSync(hookPath, hookContent, "utf8");
  fs.chmodSync(hookPath, 0o755);
  console.log(`[hooks] installed pre-commit hook at ${hookPath}`);
}

const repoRoot = process.cwd();

if (process.env.CI === "true") {
  console.log("[hooks] skipping git hook install in CI");
  process.exit(0);
}

const gitDir = resolveGitDir(repoRoot);
if (!gitDir) {
  console.log("[hooks] no git directory found; skipping hook install");
  process.exit(0);
}

installPreCommitHook(gitDir);

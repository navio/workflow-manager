# Installing the CLI

`wfm` ships as a prebuilt release binary for macOS arm64 and Linux x64, and the installer also creates a `workflow-manager` alias.

When no version is pinned via `WORKFLOW_MANAGER_INSTALL_VERSION`, the installer looks up the currently-published npm version of `@workflow-manager/runner` and downloads the matching GitHub release asset, instead of blindly trusting GitHub's "latest" pointer. This keeps the npm and GitHub-binary install paths in sync. If the npm lookup fails, the installer falls back to GitHub's "latest" release pointer with a warning.

## Install from GitHub Releases

```bash
curl -fsSL https://github.com/navio/workflow-manager/releases/latest/download/workflow-manager-installer.sh | bash
```

The installer downloads the correct release asset for the current machine and installs the binary into `~/.local/bin` by default.
If that directory is not already on `PATH`, the installer updates a supported shell profile automatically and prints the exact reload command to run in the current terminal.

## Choose a custom install directory

```bash
curl -fsSL https://github.com/navio/workflow-manager/releases/latest/download/workflow-manager-installer.sh | WORKFLOW_MANAGER_INSTALL_DIR="$HOME/bin" bash
```

If the target directory is not already on `PATH`, the installer prints the shell path hint you need.

To skip shell profile updates and manage `PATH` yourself:

```bash
curl -fsSL https://github.com/navio/workflow-manager/releases/latest/download/workflow-manager-installer.sh | WORKFLOW_MANAGER_INSTALL_SKIP_SHELL_SETUP=1 bash
```

## Pin a specific release

```bash
curl -fsSL https://github.com/navio/workflow-manager/releases/latest/download/workflow-manager-installer.sh | WORKFLOW_MANAGER_INSTALL_VERSION="v0.2.0" bash
```

## Supported environment overrides

- `WORKFLOW_MANAGER_INSTALL_DIR`: target directory for the installed `wfm` binary
- `WORKFLOW_MANAGER_INSTALL_VERSION`: release tag to download instead of `latest`
- `WORKFLOW_MANAGER_INSTALL_NPM_REGISTRY`: npm registry URL used to look up the currently-published version when no version is pinned (default `https://registry.npmjs.org/@workflow-manager/runner/latest`), overridable for testing or mirrors
- `WORKFLOW_MANAGER_INSTALL_BIN_NAME`: alternate filename for the installed binary
- `WORKFLOW_MANAGER_INSTALL_ALIAS_NAME`: alternate alias name to install alongside the main binary
- `WORKFLOW_MANAGER_INSTALL_OS`: override platform detection for testing
- `WORKFLOW_MANAGER_INSTALL_ARCH`: override architecture detection for testing
- `WORKFLOW_MANAGER_INSTALL_BASE_URL`: alternate asset base URL for local verification
- `WORKFLOW_MANAGER_INSTALL_SKIP_SHELL_SETUP`: set to `1` to disable automatic shell profile updates

## Supported release binaries

- macOS arm64 -> `wfm-macos-arm64`
- Linux x64 -> `wfm-linux-x64`

Windows release binaries are published as `wfm-windows-x64.exe`, but the shell installer is only intended for Unix-like environments.

## Build from source instead

```bash
bun install
bun run build
bun link
wfm --help
workflow-manager --help
```

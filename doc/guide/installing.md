# Installing the CLI

`wfm` ships as a prebuilt release binary for macOS arm64 and Linux x64.

## Install from GitHub Releases

```bash
curl -fsSL https://github.com/navio/workflow-manager/releases/latest/download/workflow-manager-installer.sh | bash
wfm --help
```

The installer downloads the correct release asset for the current machine and installs the binary into `~/.local/bin` by default.

## Choose a custom install directory

```bash
curl -fsSL https://github.com/navio/workflow-manager/releases/latest/download/workflow-manager-installer.sh | WORKFLOW_MANAGER_INSTALL_DIR="$HOME/bin" bash
```

If the target directory is not already on `PATH`, the installer prints the shell path hint you need.

## Pin a specific release

```bash
curl -fsSL https://github.com/navio/workflow-manager/releases/latest/download/workflow-manager-installer.sh | WORKFLOW_MANAGER_INSTALL_VERSION="v0.2.0" bash
```

## Supported environment overrides

- `WORKFLOW_MANAGER_INSTALL_DIR`: target directory for the installed `wfm` binary
- `WORKFLOW_MANAGER_INSTALL_VERSION`: release tag to download instead of `latest`
- `WORKFLOW_MANAGER_INSTALL_BIN_NAME`: alternate filename for the installed binary
- `WORKFLOW_MANAGER_INSTALL_OS`: override platform detection for testing
- `WORKFLOW_MANAGER_INSTALL_ARCH`: override architecture detection for testing
- `WORKFLOW_MANAGER_INSTALL_BASE_URL`: alternate asset base URL for local verification

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
```

#!/bin/sh
set -eu

repo_owner="${WORKFLOW_MANAGER_INSTALL_REPO_OWNER:-navio}"
repo_name="${WORKFLOW_MANAGER_INSTALL_REPO_NAME:-workflow-manager}"
binary_name="${WORKFLOW_MANAGER_INSTALL_BIN_NAME:-wfm}"
install_dir="${WORKFLOW_MANAGER_INSTALL_DIR:-${XDG_BIN_HOME:-$HOME/.local/bin}}"
raw_os="${WORKFLOW_MANAGER_INSTALL_OS:-$(uname -s)}"
raw_arch="${WORKFLOW_MANAGER_INSTALL_ARCH:-$(uname -m)}"

if ! command -v curl >/dev/null 2>&1; then
  printf 'error: curl is required to install wfm\n' >&2
  exit 1
fi

normalize_os() {
  case "$1" in
    Darwin|darwin)
      printf '%s' 'macos'
      ;;
    Linux|linux)
      printf '%s' 'linux'
      ;;
    *)
      return 1
      ;;
  esac
}

normalize_arch() {
  case "$1" in
    arm64|aarch64)
      printf '%s' 'arm64'
      ;;
    x86_64|amd64)
      printf '%s' 'x64'
      ;;
    *)
      return 1
      ;;
  esac
}

if ! os_name="$(normalize_os "$raw_os")"; then
  printf 'error: unsupported operating system: %s\n' "$raw_os" >&2
  exit 1
fi

if ! arch_name="$(normalize_arch "$raw_arch")"; then
  printf 'error: unsupported architecture: %s\n' "$raw_arch" >&2
  exit 1
fi

case "${os_name}-${arch_name}" in
  macos-arm64)
    asset_name='wfm-macos-arm64'
    ;;
  linux-x64)
    asset_name='wfm-linux-x64'
    ;;
  *)
    printf 'error: no prebuilt wfm binary is available for %s-%s\n' "$os_name" "$arch_name" >&2
    exit 1
    ;;
esac

if [ -n "${WORKFLOW_MANAGER_INSTALL_BASE_URL:-}" ]; then
  download_url="${WORKFLOW_MANAGER_INSTALL_BASE_URL%/}/${asset_name}"
else
  version="${WORKFLOW_MANAGER_INSTALL_VERSION:-latest}"
  if [ "$version" = 'latest' ]; then
    download_url="https://github.com/${repo_owner}/${repo_name}/releases/latest/download/${asset_name}"
  else
    download_url="https://github.com/${repo_owner}/${repo_name}/releases/download/${version}/${asset_name}"
  fi
fi

mkdir -p "$install_dir"
install_path="${install_dir%/}/${binary_name}"
tmp_file="$(mktemp "${TMPDIR:-/tmp}/wfm.XXXXXX")"

cleanup() {
  rm -f "$tmp_file"
}

trap cleanup EXIT INT HUP TERM

printf 'Downloading wfm from %s\n' "$download_url"
curl -fsSL --retry 3 --connect-timeout 15 "$download_url" -o "$tmp_file"
chmod 755 "$tmp_file"
mv "$tmp_file" "$install_path"

trap - EXIT INT HUP TERM

printf 'Installed wfm to %s\n' "$install_path"

case ":${PATH}:" in
  *":${install_dir}:"*)
    ;;
  *)
    printf 'Add %s to PATH to run `%s` from any shell.\n' "$install_dir" "$binary_name"
    ;;
esac

printf 'Run `%s --help` to get started.\n' "$binary_name"

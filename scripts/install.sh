#!/bin/sh
set -eu

repo_owner="${WORKFLOW_MANAGER_INSTALL_REPO_OWNER:-navio}"
repo_name="${WORKFLOW_MANAGER_INSTALL_REPO_NAME:-workflow-manager}"
binary_name="${WORKFLOW_MANAGER_INSTALL_BIN_NAME:-wfm}"
alias_name="${WORKFLOW_MANAGER_INSTALL_ALIAS_NAME:-workflow-manager}"
install_dir="${WORKFLOW_MANAGER_INSTALL_DIR:-${XDG_BIN_HOME:-$HOME/.local/bin}}"
raw_os="${WORKFLOW_MANAGER_INSTALL_OS:-$(uname -s)}"
raw_arch="${WORKFLOW_MANAGER_INSTALL_ARCH:-$(uname -m)}"
shell_name="${SHELL##*/}"

profile_file=''
profile_source_command=''
profile_path_line=''
profile_update_status=''

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

configure_shell_profile() {
  case "$shell_name" in
    zsh)
      profile_file="$HOME/.zshrc"
      profile_source_command="source $HOME/.zshrc"
      profile_path_line="export PATH=\"$install_dir:\$PATH\""
      ;;
    bash)
      profile_file="$HOME/.bashrc"
      profile_source_command="source $HOME/.bashrc"
      profile_path_line="export PATH=\"$install_dir:\$PATH\""
      ;;
    fish)
      profile_file="$HOME/.config/fish/config.fish"
      profile_source_command="source $HOME/.config/fish/config.fish"
      profile_path_line="fish_add_path -g \"$install_dir\""
      ;;
    sh|dash|ash|ksh)
      profile_file="$HOME/.profile"
      profile_source_command=". $HOME/.profile"
      profile_path_line="export PATH=\"$install_dir:\$PATH\""
      ;;
    *)
      return 1
      ;;
  esac

  mkdir -p "$(dirname "$profile_file")"

  if [ -f "$profile_file" ] && grep -F "$install_dir" "$profile_file" >/dev/null 2>&1; then
    profile_update_status='existing'
    return 0
  fi

  {
    printf '\n# Added by workflow-manager installer\n'
    printf '%s\n' "$profile_path_line"
  } >> "$profile_file"

  profile_update_status='updated'
  return 0
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
  if [ -n "${WORKFLOW_MANAGER_INSTALL_VERSION:-}" ]; then
    version="$WORKFLOW_MANAGER_INSTALL_VERSION"
  else
    npm_registry_url="${WORKFLOW_MANAGER_INSTALL_NPM_REGISTRY:-https://registry.npmjs.org/@workflow-manager/runner/latest}"
    npm_version=''
    if npm_registry_response="$(curl -fsSL --connect-timeout 15 "$npm_registry_url" 2>/dev/null)"; then
      npm_version="$(printf '%s' "$npm_registry_response" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p' | head -n 1)"
    fi

    if [ -n "$npm_version" ]; then
      version="v${npm_version}"
    else
      printf 'warning: could not resolve latest version from npm; falling back to GitHub latest release\n' >&2
      version='latest'
    fi
  fi

  if [ "$version" = 'latest' ]; then
    download_url="https://github.com/${repo_owner}/${repo_name}/releases/latest/download/${asset_name}"
  else
    download_url="https://github.com/${repo_owner}/${repo_name}/releases/download/${version}/${asset_name}"
  fi
fi

mkdir -p "$install_dir"
install_path="${install_dir%/}/${binary_name}"
alias_path="${install_dir%/}/${alias_name}"
tmp_file="$(mktemp "${TMPDIR:-/tmp}/wfm.XXXXXX")"

cleanup() {
  rm -f "$tmp_file"
}

trap cleanup EXIT INT HUP TERM

printf 'Downloading wfm from %s\n' "$download_url"
curl -fsSL --retry 3 --connect-timeout 15 "$download_url" -o "$tmp_file"
chmod 755 "$tmp_file"
mv "$tmp_file" "$install_path"

if [ "$alias_name" != "$binary_name" ]; then
  rm -f "$alias_path"
  if ! ln -s "$binary_name" "$alias_path" 2>/dev/null; then
    cp "$install_path" "$alias_path"
    chmod 755 "$alias_path"
  fi
fi

trap - EXIT INT HUP TERM

printf 'Installed wfm to %s\n' "$install_path"
if [ "$alias_name" != "$binary_name" ]; then
  printf 'Installed workflow-manager alias to %s\n' "$alias_path"
fi

case ":${PATH}:" in
  *":${install_dir}:"*)
    ;;
  *)
    if [ "${WORKFLOW_MANAGER_INSTALL_SKIP_SHELL_SETUP:-0}" = '1' ]; then
      printf 'Add %s to PATH to run `%s` from any shell.\n' "$install_dir" "$binary_name"
    elif configure_shell_profile; then
      if [ "$profile_update_status" = 'updated' ]; then
        printf 'Added %s to PATH in %s.\n' "$install_dir" "$profile_file"
      else
        printf '%s is already configured in %s.\n' "$install_dir" "$profile_file"
      fi
      printf 'Start a new shell or run `%s` to use `%s` right away.\n' "$profile_source_command" "$binary_name"
    else
      printf 'Add %s to PATH to run `%s` from any shell.\n' "$install_dir" "$binary_name"
    fi
    ;;
esac

if [ "$alias_name" != "$binary_name" ]; then
  printf 'Run `%s --help` or `%s --help` to get started.\n' "$binary_name" "$alias_name"
else
  printf 'Run `%s --help` to get started.\n' "$binary_name"
fi

const AUTH_NEXT_KEY = "wm_auth_next";

export function sanitizeAuthNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/dashboard";
  }

  return value;
}

export function storeAuthNextPath(value: string | null | undefined): void {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.setItem(AUTH_NEXT_KEY, sanitizeAuthNextPath(value));
}

export function consumeAuthNextPath(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  const stored = window.sessionStorage.getItem(AUTH_NEXT_KEY);
  if (!stored) {
    return null;
  }

  window.sessionStorage.removeItem(AUTH_NEXT_KEY);
  return sanitizeAuthNextPath(stored);
}

export const RESERVED_HANDLES = new Set([
  "admin",
  "api",
  "org",
  "team",
  "enterprise",
  "support",
  "help",
  "billing",
  "security",
  "abuse",
  "legal",
  "privacy",
  "status",
  "auth",
  "callback",
  "confirm",
  "onboard",
  "dashboard",
  "settings",
]);

const HANDLE_REGEX = /^[a-z0-9][a-z0-9-]{1,29}$/;

export function normalizeHandleInput(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

export function suggestHandleFromEmail(email: string | null | undefined): string {
  if (!email) {
    return "";
  }

  const localPart = email.split("@")[0] ?? "";
  return normalizeHandleInput(localPart);
}

export function validateHandle(value: string): string | null {
  if (!value) {
    return "Enter a handle.";
  }

  if (value.length < 3) {
    return "Use at least 3 characters.";
  }

  if (value.length > 30) {
    return "Use 30 characters or fewer.";
  }

  if (!HANDLE_REGEX.test(value)) {
    return "Use lowercase letters, numbers, and hyphens only.";
  }

  if (RESERVED_HANDLES.has(value)) {
    return "That handle is reserved.";
  }

  return null;
}

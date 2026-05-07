export function isExistingEmailSignUpResponse(
  errorMessage: string | undefined,
  identities: unknown
): boolean {
  const normalized = errorMessage?.toLowerCase() ?? "";
  if (normalized.includes("already registered")) {
    return true;
  }

  return Array.isArray(identities) && identities.length === 0;
}

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { sanitizeAuthNextPath } from "../auth/auth-next";
import { useAuth } from "../auth/useAuth";
import { normalizeHandleInput, suggestHandleFromDisplayName, suggestHandleFromEmail, validateHandle } from "../lib/handle";
import { useCheckHandleAvailable, useClaimHandle, useProfile } from "../queries/profile";
import { AuthCard } from "../ui/AuthCard";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { StatusBanner } from "../ui/StatusBanner";

function useDebouncedValue(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timeout);
  }, [delayMs, value]);

  return debounced;
}

export function OnboardHandlePage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const nextPath = sanitizeAuthNextPath(searchParams.get("next"));
  const profile = useProfile();
  const claimHandle = useClaimHandle();
  const [handle, setHandle] = useState("");
  const [didPrefill, setDidPrefill] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) {
      void navigate("/auth?mode=signin", { replace: true });
      return;
    }

    if (profile.data?.username) {
      void navigate(nextPath, { replace: true });
      return;
    }

    if (!didPrefill) {
      const suggested =
        suggestHandleFromDisplayName(profile.data?.displayName) ||
        suggestHandleFromEmail(session.user.email);
      if (suggested) {
        setHandle(suggested);
      }
      setDidPrefill(true);
    }
  }, [didPrefill, navigate, nextPath, profile.data?.displayName, profile.data?.username, session]);

  const debouncedHandle = useDebouncedValue(handle, 250);
  const validationError = useMemo(() => validateHandle(handle), [handle]);
  const availability = useCheckHandleAvailable(validationError ? "" : debouncedHandle);

  const isTaken = Boolean(
    !validationError &&
      debouncedHandle &&
      availability.data === false
  );

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (validationError) {
      setError(validationError);
      return;
    }

    if (isTaken) {
      setError("That handle is already taken.");
      return;
    }

    setError(null);

    try {
      await claimHandle.mutateAsync({ username: handle });
      void navigate(nextPath, { replace: true });
    } catch (claimError) {
      setError((claimError as Error).message);
    }
  }

  const availabilityMessage =
    validationError || !debouncedHandle
      ? null
      : availability.isLoading
        ? "Checking availability…"
        : availability.data
          ? `${debouncedHandle} is available.`
          : `${debouncedHandle} is already taken.`;

  return (
    <AuthCard
      title="Claim your handle"
      eyebrow="Onboarding / handle"
      description="Choose your public namespace before you publish workflows."
    >
      <form className="stack" onSubmit={(event) => void onSubmit(event)}>
        <Field
          label="Handle"
          required
          hint="3-30 characters. Lowercase letters, numbers, and hyphens."
          error={validationError ?? undefined}
        >
          <input
            name="handle"
            autoComplete="nickname"
            value={handle}
            onChange={(event) => setHandle(normalizeHandleInput(event.target.value))}
            required
          />
        </Field>

        {availabilityMessage && (
          <p className={isTaken ? "field__error" : "field__hint"} role={isTaken ? "alert" : undefined}>
            {availabilityMessage}
          </p>
        )}

        <Button
          type="submit"
          variant="primary"
          disabled={claimHandle.isPending || Boolean(validationError) || isTaken || availability.isLoading}
        >
          {claimHandle.isPending ? "Saving…" : "Claim handle"}
        </Button>
      </form>

      {profile.isError && <StatusBanner tone="err">{(profile.error as Error).message}</StatusBanner>}
      {error && <StatusBanner tone="err">{error}</StatusBanner>}

      <div className="auth-links">
        <Link to="/auth?mode=signin">Back to sign in</Link>
      </div>
    </AuthCard>
  );
}

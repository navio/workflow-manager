import type { MouseEvent } from "react";
import { Button } from "./Button";

interface OAuthButtonProps {
  disabled?: boolean;
  busy?: boolean;
  onClick: () => Promise<void> | void;
}

function GoogleMark() {
  return (
    <svg className="oauth-mark" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path
        d="M19.6 10.23c0-.68-.06-1.33-.17-1.95H10v3.69h5.39a4.6 4.6 0 0 1-1.99 3.02v2.5h3.22c1.88-1.73 2.98-4.28 2.98-7.26z"
        fill="#4285F4"
      />
      <path
        d="M10 20c2.7 0 4.96-.9 6.62-2.43l-3.22-2.5c-.89.6-2.03.96-3.4.96-2.61 0-4.82-1.76-5.61-4.13H1.07v2.58A10 10 0 0 0 10 20z"
        fill="#34A853"
      />
      <path
        d="M4.39 11.9a5.99 5.99 0 0 1 0-3.8V5.52H1.07a10 10 0 0 0 0 8.96l3.32-2.58z"
        fill="#FBBC04"
      />
      <path
        d="M10 3.97c1.47 0 2.79.5 3.82 1.49l2.87-2.87A9.96 9.96 0 0 0 10 0 10 10 0 0 0 1.07 5.52L4.39 8.1C5.18 5.73 7.39 3.97 10 3.97z"
        fill="#EA4335"
      />
    </svg>
  );
}

export function OAuthButton({ disabled, busy, onClick }: OAuthButtonProps) {
  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    void onClick();
  }

  return (
    <Button
      type="button"
      variant="ghost"
      className="oauth-button"
      disabled={disabled || busy}
      onClick={handleClick}
      leading={<GoogleMark />}
    >
      {busy ? "Connecting…" : "Continue with Google"}
    </Button>
  );
}

import type { ReactNode } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from "lucide-react";

type Tone = "info" | "ok" | "warn" | "err";

interface StatusBannerProps {
  tone?: Tone;
  children: ReactNode;
  icon?: ReactNode;
}

const TONE_ICON: Record<Tone, ReactNode> = {
  info: <Info size={16} strokeWidth={2} aria-hidden="true" />,
  ok: <CheckCircle2 size={16} strokeWidth={2} aria-hidden="true" />,
  warn: <AlertTriangle size={16} strokeWidth={2} aria-hidden="true" />,
  err: <AlertCircle size={16} strokeWidth={2} aria-hidden="true" />,
};

export function StatusBanner({ tone = "info", children, icon }: StatusBannerProps) {
  const role = tone === "err" ? "alert" : undefined;
  const ariaLive = tone === "err" ? undefined : "polite";
  return (
    <div className={`banner banner--${tone}`} role={role} aria-live={ariaLive}>
      <span className="banner__icon">{icon ?? TONE_ICON[tone]}</span>
      <div className="banner__body">{children}</div>
    </div>
  );
}

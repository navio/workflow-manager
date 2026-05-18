import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from "lucide-react";

type Tone = "info" | "ok" | "warn" | "err";

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="eyebrow">{children}</p>;
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={["panel", className].filter(Boolean).join(" ")}>{children}</section>;
}

export function PanelHeader({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={["panel__header", className].filter(Boolean).join(" ")}>{children}</div>;
}

export function StatusBanner({ tone = "info", children }: { tone?: Tone; children: ReactNode }) {
  const icon = tone === "ok" ? <CheckCircle2 size={16} strokeWidth={1.75} aria-hidden="true" /> : tone === "warn" ? <AlertTriangle size={16} strokeWidth={1.75} aria-hidden="true" /> : tone === "err" ? <AlertCircle size={16} strokeWidth={1.75} aria-hidden="true" /> : <Info size={16} strokeWidth={1.75} aria-hidden="true" />;
  return (
    <div className={`banner banner--${tone}`} role={tone === "err" ? "alert" : undefined} aria-live={tone === "err" ? undefined : "polite"}>
      <span className="banner__icon">{icon}</span>
      <div className="banner__body">{children}</div>
    </div>
  );
}

export function Button({ className = "", children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props} className={["button", className].filter(Boolean).join(" ")}>
      {children}
    </button>
  );
}

export function Field({ label, hint, className = "", ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className={["field", className].filter(Boolean).join(" ")}>
      <span className="field__label">{label}</span>
      <input {...props} />
      {hint ? <span className="field__hint">{hint}</span> : null}
    </label>
  );
}

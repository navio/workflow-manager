import type { ReactNode } from "react";

type Tone = "accent" | "muted" | "ok" | "warn" | "err" | "outline";

interface PillProps {
  tone?: Tone;
  children: ReactNode;
  leading?: ReactNode;
}

export function Pill({ tone = "accent", children, leading }: PillProps) {
  const cls = tone === "accent" ? "pill" : `pill pill--${tone}`;
  return (
    <span className={cls}>
      {leading}
      {children}
    </span>
  );
}

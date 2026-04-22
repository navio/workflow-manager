import type { HTMLAttributes, ReactNode } from "react";

interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  tight?: boolean;
  flush?: boolean;
}

export function Panel({ tight, flush, className = "", children, ...rest }: PanelProps) {
  const cls = ["panel", tight && "panel--tight", flush && "panel--flush", className].filter(Boolean).join(" ");
  return (
    <div {...rest} className={cls}>
      {children}
    </div>
  );
}

export function PanelHeader({ children, className = "", ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={["panel-header", className].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
}

interface EyebrowProps {
  children: ReactNode;
}

export function Eyebrow({ children }: EyebrowProps) {
  return <p className="eyebrow">{children}</p>;
}

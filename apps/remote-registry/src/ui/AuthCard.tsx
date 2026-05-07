import type { ReactNode } from "react";
import { Eyebrow } from "./Panel";

interface AuthCardProps {
  title: string;
  eyebrow?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footnote?: ReactNode;
}

export function AuthCard({
  title,
  eyebrow = "Registry access",
  description,
  children,
  footnote,
}: AuthCardProps) {
  return (
    <div className="auth-wrap">
      <section className="auth-card panel stack-lg">
        <div className="stack-sm">
          <Eyebrow>{eyebrow}</Eyebrow>
          <h1 className="auth-card__title">{title}</h1>
          {description && <p className="muted auth-card__description">{description}</p>}
        </div>

        {children}
      </section>

      {footnote && <p className="muted auth-footnote">{footnote}</p>}
    </div>
  );
}

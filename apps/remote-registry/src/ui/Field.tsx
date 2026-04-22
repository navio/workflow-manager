import { useId } from "react";
import type { ReactElement, ReactNode } from "react";

interface FieldProps {
  label: string;
  children: ReactElement<{ id?: string; "aria-describedby"?: string; "aria-invalid"?: boolean }>;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
}

export function Field({ label, children, hint, error, required }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  const control = {
    ...children,
    props: {
      ...children.props,
      id: children.props.id ?? id,
      "aria-describedby": describedBy,
      "aria-invalid": Boolean(error),
    },
  };

  return (
    <div className="field" data-invalid={error ? "true" : undefined}>
      <label className="field__label" htmlFor={children.props.id ?? id}>
        {label}
        {required && <span className="req" aria-hidden="true">*</span>}
      </label>
      {control}
      {hint && !error && (
        <p id={hintId} className="field__hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

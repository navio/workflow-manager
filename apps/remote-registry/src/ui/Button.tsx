import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link, type LinkProps } from "react-router-dom";

type Variant = "primary" | "ghost" | "subtle" | "danger";
type Size = "sm" | "md" | "icon";

function variantClass(variant: Variant): string {
  return `btn btn--${variant}`;
}

function sizeClass(size: Size): string {
  return size === "md" ? "" : `btn--${size}`;
}

interface CommonProps {
  variant?: Variant;
  size?: Size;
  leading?: ReactNode;
  trailing?: ReactNode;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & CommonProps;

export function Button({
  variant = "primary",
  size = "md",
  leading,
  trailing,
  className = "",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      className={[variantClass(variant), sizeClass(size), className].filter(Boolean).join(" ")}
    >
      {leading}
      {children}
      {trailing}
    </button>
  );
}

type LinkButtonProps = LinkProps & CommonProps;

export function LinkButton({
  variant = "primary",
  size = "md",
  leading,
  trailing,
  className = "",
  children,
  ...rest
}: LinkButtonProps) {
  return (
    <Link
      {...rest}
      className={[variantClass(variant), sizeClass(size), className].filter(Boolean).join(" ")}
    >
      {leading}
      {children}
      {trailing}
    </Link>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  children: ReactNode;
  variant?: Variant;
}

export function IconButton({ label, children, variant = "ghost", className = "", ...rest }: IconButtonProps) {
  return (
    <button
      {...rest}
      aria-label={label}
      title={label}
      className={[variantClass(variant), "btn--icon", className].filter(Boolean).join(" ")}
    >
      {children}
    </button>
  );
}

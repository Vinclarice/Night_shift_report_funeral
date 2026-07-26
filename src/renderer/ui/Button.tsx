import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger" | "print";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "primary",
  secondary: "secondary",
  quiet: "quiet",
  danger: "danger",
  print: "print-button",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  icon?: ReactNode;
  /** Shows a spinner in place of the icon and disables the button — for actions with in-flight work. */
  busy?: boolean;
  /** Stretches the button to fill its container (the existing full-width CTA pattern). */
  full?: boolean;
}

/**
 * Thin wrapper around the existing button.primary/secondary/quiet/danger/print-button CSS
 * classes. The point isn't new styling — it's one place that owns "icon + label + busy state"
 * instead of that pattern being retyped at every call site.
 */
export function Button({ variant = "secondary", icon, busy, full, className, children, disabled, type = "button", ...rest }: ButtonProps) {
  const classes = [VARIANT_CLASS[variant], "btn-icon", full && "full", className].filter(Boolean).join(" ");
  return (
    <button type={type} className={classes} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {busy ? <span className="btn-spinner" aria-hidden="true" /> : icon}
      {children}
    </button>
  );
}

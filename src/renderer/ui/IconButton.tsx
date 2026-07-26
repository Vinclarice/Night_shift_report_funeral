import type { ButtonHTMLAttributes, ReactNode } from "react";

type NativeButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label">;

export interface IconButtonProps extends NativeButtonProps {
  icon: ReactNode;
  /** Required, not optional — an icon-only button with no accessible name is a dead end for
   * screen-reader and keyboard users, so the type system won't let this be forgotten. */
  "aria-label": string;
  tone?: "default" | "danger";
}

export function IconButton({ icon, tone = "default", className, ...rest }: IconButtonProps) {
  const classes = ["icon-button", tone === "danger" && "danger-hover", className].filter(Boolean).join(" ");
  return (
    <button type="button" className={classes} {...rest}>
      {icon}
    </button>
  );
}

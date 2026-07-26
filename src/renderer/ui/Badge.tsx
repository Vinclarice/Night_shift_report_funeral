import type { HTMLAttributes } from "react";

export type BadgeTone = "neutral" | "success" | "warning" | "danger";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  /** Leading dot, colored to match the tone via currentColor — used for status indicators. */
  dot?: boolean;
}

/**
 * A single pill component backing every status indicator in the app (save-state, draft/finalized,
 * rush, section entry-counts) instead of four separately hand-tuned pieces of CSS. Tone maps onto
 * the semantic color tokens in styles.css, so retuning a color happens once, not per usage site.
 */
export function Badge({ tone = "neutral", dot, className, children, ...rest }: BadgeProps) {
  const classes = ["badge", `badge-${tone}`, dot && "badge-dot", className].filter(Boolean).join(" ");
  return (
    <span className={classes} {...rest}>
      {children}
    </span>
  );
}

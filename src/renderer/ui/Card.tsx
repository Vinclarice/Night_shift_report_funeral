import type { HTMLAttributes } from "react";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Adds the hover-lift/shadow treatment — for rows in scannable lists, not static containers. */
  hoverable?: boolean;
}

export function Card({ hoverable, className, children, ...rest }: CardProps) {
  const classes = ["card", hoverable && "card-hoverable", className].filter(Boolean).join(" ");
  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
}

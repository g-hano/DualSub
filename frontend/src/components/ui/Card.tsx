import type { HTMLAttributes, ReactNode } from "react";

export default function Card({
  children,
  className = "",
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
}) {
  return (
    <div
      className={`rounded-lg border border-border bg-surface p-5 ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

export function SectionHeading({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <h3
      className={`mb-3 text-sm font-medium text-accent-muted ${className}`}
    >
      {children}
    </h3>
  );
}

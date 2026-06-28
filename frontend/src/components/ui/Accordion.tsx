import { useId, useState, type ReactNode } from "react";
import { IconChevron } from "./Icons";

export default function Accordion({
  title,
  description,
  icon,
  children,
  defaultOpen = false,
  badge,
  variant = "card",
  nested = false,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  badge?: ReactNode;
  variant?: "card" | "ghost";
  nested?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  const shellClass =
    variant === "ghost" && !open
      ? "overflow-hidden rounded-xl border border-transparent bg-transparent"
      : "overflow-hidden rounded-xl border border-border bg-[var(--panel-bg)]";

  return (
    <div className={shellClass}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className={`flex w-full items-center gap-3 px-4 py-3.5 text-left transition ${
          variant === "ghost" && !open ? "hover:bg-zinc-900/40" : "hover:bg-white/[0.02]"
        }`}
      >
        {icon && (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-400">
            {icon}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-sm font-medium text-zinc-100">{title}</span>
            {badge}
          </span>
          {description && (
            <span className="mt-0.5 block text-xs text-zinc-500">{description}</span>
          )}
        </span>
        <IconChevron
          className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      <div className="accordion-content border-t border-zinc-800/80" data-open={open}>
        <div id={panelId} className="accordion-inner">
          <div className={`space-y-4 ${nested ? "px-2 py-2" : "px-4 py-4"}`}>{children}</div>
        </div>
      </div>
    </div>
  );
}

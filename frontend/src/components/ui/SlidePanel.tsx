import type { ReactNode } from "react";
import { IconChevron } from "./Icons";

type SlidePanelProps = {
  open: boolean;
  onToggle: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  /** Inner panel width in px at xl breakpoint */
  width?: number;
  className?: string;
};

export default function SlidePanel({
  open,
  onToggle,
  title,
  description,
  children,
  width = 340,
  className = "",
}: SlidePanelProps) {
  return (
    <div className={`relative hidden shrink-0 xl:block ${className}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={open ? `Hide ${title}` : `Show ${title}`}
        title={open ? `Hide ${title}` : `Show ${title}`}
        className="absolute top-6 z-30 flex h-10 w-7 items-center justify-center rounded-l-lg border border-border bg-[var(--panel-bg)] text-zinc-400 shadow-md transition-all duration-300 ease-in-out hover:bg-zinc-800 hover:text-zinc-200"
        style={{ right: open ? width : 0 }}
      >
        <IconChevron
          className={`h-4 w-4 transition-transform duration-300 ${open ? "rotate-90" : "-rotate-90"}`}
        />
      </button>

      <aside
        className="overflow-hidden border-l border-border bg-[var(--panel-bg)] transition-[width] duration-300 ease-in-out"
        style={{ width: open ? width : 0, borderLeftWidth: open ? undefined : 0 }}
      >
        <div
          className="flex max-h-[calc(100vh-3.5rem)] min-h-0 flex-col overflow-y-auto px-5 py-5"
          style={{ width }}
        >
          <div className="mb-4 shrink-0">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{title}</h2>
            {description && <p className="mt-1 text-sm text-zinc-400">{description}</p>}
          </div>
          {children}
        </div>
      </aside>
    </div>
  );
}

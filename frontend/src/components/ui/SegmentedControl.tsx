import type { ReactNode } from "react";

export default function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  className = "",
  size = "md",
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: ReactNode; icon?: ReactNode }[];
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div
      className={`inline-flex w-full rounded-lg border border-border bg-zinc-950/60 p-1 ${className}`}
      role="group"
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-md font-medium transition-all duration-150 ${
            size === "sm" ? "px-2 py-1.5 text-xs" : "px-3 py-2 text-sm"
          } ${
            value === opt.value
              ? "bg-zinc-800 text-zinc-100 shadow-sm"
              : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          {opt.icon && <span className="shrink-0">{opt.icon}</span>}
          {opt.label}
        </button>
      ))}
    </div>
  );
}

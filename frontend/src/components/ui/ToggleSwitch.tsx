type ToggleSwitchProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  "aria-label"?: string;
  disabled?: boolean;
  className?: string;
};

export default function ToggleSwitch({
  checked,
  onChange,
  "aria-label": ariaLabel,
  disabled = false,
  className = "",
}: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-[31px] w-[51px] shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? "bg-[#34c759]" : "bg-zinc-600"
      } ${className}`}
    >
      <span
        aria-hidden
        className={`pointer-events-none block h-[27px] w-[27px] rounded-full bg-white shadow-[0_2px_4px_rgba(0,0,0,0.28),0_0_1px_rgba(0,0,0,0.12)] transition-transform duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

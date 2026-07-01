import { useTranslation } from "react-i18next";

type Step = "configure" | "processing" | "preview" | "export";

const STEP_IDS: Step[] = ["configure", "processing", "preview", "export"];

function stepIndex(step: Step): number {
  return STEP_IDS.indexOf(step);
}

export default function WorkflowStepper({
  current,
  className = "",
}: {
  current: Step;
  className?: string;
}) {
  const { t } = useTranslation();
  const currentIdx = stepIndex(current);

  return (
    <nav aria-label={t("workflow.ariaLabel")} className={`flex min-w-0 items-center gap-0 ${className}`}>
      {STEP_IDS.map((stepId, i) => {
        const done = i < currentIdx;
        const active = i === currentIdx;
        return (
          <div key={stepId} className="flex flex-1 items-center">
            <div className="flex items-center gap-2.5">
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                  done
                    ? "bg-indigo-500 text-white"
                    : active
                      ? "bg-indigo-500/20 text-indigo-300 ring-2 ring-indigo-500/40"
                      : "bg-zinc-800 text-zinc-500"
                }`}
              >
                {done ? (
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                ) : (
                  i + 1
                )}
              </span>
              <span
                className={`hidden text-sm font-medium sm:block ${
                  active ? "text-zinc-100" : done ? "text-zinc-400" : "text-zinc-600"
                }`}
              >
                {t(`workflow.${stepId}`)}
              </span>
            </div>
            {i < STEP_IDS.length - 1 && (
              <div
                className={`mx-3 h-px flex-1 transition-colors ${
                  i < currentIdx ? "bg-indigo-500/50" : "bg-zinc-800"
                }`}
              />
            )}
          </div>
        );
      })}
    </nav>
  );
}

export type { Step };

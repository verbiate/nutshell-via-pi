import { Check, Loader2 } from "lucide-react";

const STEPS = [
  { id: "hash", label: "Computing hash" },
  { id: "check", label: "Checking library" },
  { id: "convert", label: "Converting" },
  { id: "done", label: "Done" },
];

interface ProcessingIndicatorProps {
  currentStep: number; // 0-3
}

export function ProcessingIndicator({ currentStep }: ProcessingIndicatorProps) {
  return (
    <div className="flex flex-col gap-2">
      {STEPS.map((step, index) => {
        const isCompleted = index < currentStep;
        const isCurrent = index === currentStep;

        return (
          <div key={step.id} className="flex items-center gap-3">
            <div
              className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${
                isCompleted
                  ? "bg-green-600 text-white"
                  : isCurrent
                  ? "bg-slate-900 text-white"
                  : "border border-slate-300 text-transparent"
              }`}
            >
              {isCompleted ? (
                <Check className="h-3 w-3" />
              ) : isCurrent ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : null}
            </div>
            <span
              className={`text-sm ${
                isCurrent
                  ? "font-semibold text-slate-900"
                  : isCompleted
                  ? "text-slate-500"
                  : "text-slate-400"
              }`}
            >
              {step.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

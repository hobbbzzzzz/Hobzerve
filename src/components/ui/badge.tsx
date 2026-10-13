import clsx from "clsx";
import type { ReactNode } from "react";

export type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "lavender" | "teal";

const tones: Record<Tone, string> = {
  neutral: "bg-surface-alt text-ink-soft",
  primary: "bg-[#e9ecff] text-primary-strong",
  success: "bg-[#e3f4ee] text-success",
  warning: "bg-[#fbf0e2] text-warning",
  danger: "bg-[#fbe8ec] text-danger",
  lavender: "bg-[#f0ebff] text-[#5b45c4]",
  teal: "bg-[#e2f5f3] text-[#1d7570]",
};

export function Badge({ tone = "neutral", icon, children, className }: { tone?: Tone; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        tones[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

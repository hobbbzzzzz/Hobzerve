import clsx from "clsx";
import type { ReactNode } from "react";

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-ink-soft">
      <span className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden />
      {label}
    </span>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      {icon && (
        <span className="inline-flex size-12 items-center justify-center rounded-full bg-tint-gradient text-primary-strong" aria-hidden>
          {icon}
        </span>
      )}
      <p className="font-semibold text-ink">{title}</p>
      {children && <div className="max-w-sm text-sm text-ink-soft">{children}</div>}
      {action}
    </div>
  );
}

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-2 flex-1 overflow-hidden rounded-full bg-surface-alt"
        role="progressbar"
        aria-valuenow={v}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? "Progress"}
      >
        <div className="h-full rounded-full bg-primary-gradient transition-[width] duration-200" style={{ width: `${v}%` }} />
      </div>
      <span className="tabular w-10 text-right text-xs font-medium text-ink-soft">{v}%</span>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; icon?: ReactNode }>;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-[14px] border border-line bg-surface p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            "inline-flex h-8 items-center gap-1.5 rounded-[10px] px-3 text-sm font-medium transition-colors",
            value === o.value ? "bg-primary-gradient text-white shadow-[var(--shadow-button)]" : "text-ink-soft hover:text-ink",
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

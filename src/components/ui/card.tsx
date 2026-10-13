import clsx from "clsx";
import type { HTMLAttributes, ReactNode } from "react";

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx("card card-accent", className)} {...rest} />;
}

export function CardHeader({ icon, title, action, subtitle }: { icon?: ReactNode; title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
      <div className="flex min-w-0 items-center gap-3">
        {icon && (
          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-gradient text-white shadow-[var(--shadow-button)]" aria-hidden>
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-ink">{title}</h2>
          {subtitle && <p className="truncate text-sm text-ink-soft">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

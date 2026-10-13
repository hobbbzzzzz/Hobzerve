"use client";

import clsx from "clsx";
import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

const control =
  "rounded-[12px] border border-line bg-surface px-3 text-sm text-ink placeholder:text-ink-soft/70 transition-shadow focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15 disabled:bg-surface-alt disabled:text-ink-soft";

export function Field({ label, hint, error, children, id }: { label: string; hint?: ReactNode; error?: string; children: (id: string) => ReactNode; id?: string }) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={fieldId} className="text-sm font-medium text-ink">
        {label}
      </label>
      {children(fieldId)}
      {hint && !error && <p className="text-xs text-ink-soft">{hint}</p>}
      {error && (
        <p className="text-xs font-medium text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// Controls fill their container unless the caller passes its own width.
const width = (className?: string) => (className && /(^|\s)(w-|min-w-|max-w-)/.test(className) ? undefined : "w-full");
const height = (className?: string) => (className && /(^|\s)h-/.test(className) ? undefined : "h-11");

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={clsx(control, height(className), width(className), className)} {...rest} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={clsx(control, "min-h-24 py-2.5 leading-relaxed", width(className), className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={clsx(control, "pr-8", height(className), width(className), className)} {...rest}>
      {children}
    </select>
  );
}

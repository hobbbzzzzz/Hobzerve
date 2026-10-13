"use client";

import clsx from "clsx";
import { useEffect, useState } from "react";
import { THEME_KEY, type ThemeChoice } from "@/lib/theme";
import { Monitor, Moon, Sun } from "./icons";


function readChoice(): ThemeChoice {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

function applyChoice(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") delete root.dataset.theme;
  else root.dataset.theme = choice;
  try {
    if (choice === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  } catch {
    // Private mode or blocked storage: the choice still applies for this page.
  }
}

const OPTIONS: Array<{ value: ThemeChoice; label: string; icon: typeof Sun }> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

/** Light / Dark / System switch. "System" follows the device setting. */
export function ThemeToggle({ className }: { className?: string }) {
  const [choice, setChoice] = useState<ThemeChoice>("system");
  useEffect(() => setChoice(readChoice()), []);

  return (
    <div role="radiogroup" aria-label="Theme" className={clsx("grid grid-cols-3 gap-1 rounded-[12px] bg-surface-alt p-1", className)}>
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const on = choice === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => {
              applyChoice(value);
              setChoice(value);
            }}
            className={clsx(
              "inline-flex h-8 items-center justify-center gap-1.5 rounded-[9px] text-xs font-medium transition-colors",
              on ? "bg-primary-gradient text-white shadow-[var(--shadow-button)]" : "text-ink-soft hover:text-ink",
            )}
          >
            <Icon size={14} />
            {label}
          </button>
        );
      })}
    </div>
  );
}

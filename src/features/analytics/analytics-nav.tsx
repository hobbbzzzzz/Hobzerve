"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChartPieSlice, FilePdf, Table } from "@/components/icons";

const TABS = [
  { href: "/analytics", label: "Overview", icon: ChartPieSlice },
  { href: "/analytics/reports", label: "Reports", icon: FilePdf },
  { href: "/analytics/records", label: "Records", icon: Table },
] as const;

/** Sub-navigation inside the Analytics tab; keeps the selected employee across sections. */
export function AnalyticsNav() {
  const pathname = usePathname();
  const params = useSearchParams();
  const user = params.get("user");
  return (
    <nav aria-label="Analytics sections" className="inline-flex rounded-[14px] border border-line bg-surface p-1">
      {TABS.map((t) => {
        const active = t.href === "/analytics" ? pathname === "/analytics" : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={user ? `${t.href}?user=${user}` : t.href}
            aria-current={active ? "page" : undefined}
            className={clsx(
              "inline-flex h-9 items-center gap-1.5 rounded-[10px] px-3 text-sm font-medium transition-colors",
              active ? "bg-surface-alt text-primary-strong" : "text-ink-soft hover:text-ink",
            )}
          >
            <t.icon size={16} />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

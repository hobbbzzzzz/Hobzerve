"use client";

import clsx from "clsx";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import logoMark from "@/assets/logo-mark.png";
import { useWorkspace } from "./workspace-provider";
import { useNotificationFeed } from "./notification-feed";
import { SignOutButton } from "./sign-out-button";
import { ThemeToggle } from "./theme-toggle";
import { Bell, CalendarBlank, CaretDown, ChartPieSlice, Clock, Gear, House, ListChecks, UserCircle } from "./icons";

const TABS = [
  { href: "/dashboard", label: "Dashboard", icon: House },
  { href: "/tasks", label: "Tasks", icon: ListChecks },
  { href: "/calendar", label: "Calendar", icon: CalendarBlank },
  { href: "/time", label: "Time", icon: Clock },
  { href: "/analytics", label: "Analytics", icon: ChartPieSlice },
  { href: "/notifications", label: "Notifications", icon: Bell },
] as const;

export function TopNav() {
  const pathname = usePathname();
  const { profile, role, workspace } = useWorkspace();
  const { unread, syncState, lastSyncedAt } = useNotificationFeed();

  return (
    <header className="sticky top-0 z-30 border-b border-line/80 bg-header backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
        <Link href="/dashboard" className="flex shrink-0 items-center gap-2.5" aria-label="Hobzerve home">
          <Image src={logoMark} alt="" className="size-9" priority />
          <span className="hidden text-lg font-semibold tracking-tight sm:inline">Hobzerve</span>
        </Link>

        <nav aria-label="Main" className="hidden flex-1 items-center justify-center gap-1 lg:flex">
          {TABS.map((t) => (
            <NavTab key={t.href} {...t} active={pathname.startsWith(t.href)} badge={t.href === "/notifications" ? unread : 0} />
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3 lg:ml-0">
          <SyncIndicator state={syncState} lastSyncedAt={lastSyncedAt} />
          <UserMenu name={profile.display_name} role={role} workspace={workspace.name} />
        </div>
      </div>
      <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-3 pb-2 lg:hidden">
        {TABS.map((t) => (
          <NavTab key={t.href} {...t} active={pathname.startsWith(t.href)} badge={t.href === "/notifications" ? unread : 0} compact />
        ))}
      </nav>
    </header>
  );
}

function NavTab({
  href,
  label,
  icon: Icon,
  active,
  badge,
  compact,
}: {
  href: string;
  label: string;
  icon: (typeof TABS)[number]["icon"];
  active: boolean;
  badge: number;
  compact?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={clsx(
        "relative inline-flex shrink-0 items-center gap-2 rounded-[12px] px-3 font-medium transition-colors",
        compact ? "h-9 text-[13px]" : "h-10 text-sm",
        active ? "bg-primary-gradient text-white shadow-[var(--shadow-button)]" : "text-ink-soft hover:bg-surface hover:text-ink",
      )}
    >
      <Icon size={18} />
      {label}
      {badge > 0 && (
        <span className="tabular ml-0.5 inline-flex min-w-5 items-center justify-center rounded-full bg-danger px-1.5 text-[11px] font-semibold text-white">
          <span className="sr-only">, </span>
          {badge > 99 ? "99+" : badge}
          <span className="sr-only"> unread</span>
        </span>
      )}
    </Link>
  );
}

function SyncIndicator({ state, lastSyncedAt }: { state: "live" | "connecting" | "offline"; lastSyncedAt: Date | null }) {
  const label =
    state === "live" ? "Live updates on" : state === "connecting" ? "Connecting to live updates" : "Live updates paused — refresh to sync";
  const time = lastSyncedAt?.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Cairo" });
  return (
    <span className="hidden items-center gap-2 text-xs text-ink-soft md:inline-flex" title={label}>
      <span
        className={clsx("size-2 rounded-full", state === "live" ? "bg-success" : state === "connecting" ? "bg-warning" : "bg-danger")}
        aria-hidden
      />
      <span>{state === "live" ? `Synced ${time ?? ""}` : state === "connecting" ? "Connecting…" : "Offline"}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

function UserMenu({ name, role, workspace }: { name: string; role: string; workspace: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-10 items-center gap-2 rounded-[12px] px-2 text-sm font-medium hover:bg-surface"
      >
        <UserCircle size={26} className="text-primary-strong" />
        <span className="hidden max-w-32 truncate sm:inline">{name}</span>
        <CaretDown size={14} className="text-ink-soft" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-2 w-64 rounded-[16px] border border-line bg-surface p-2 shadow-[var(--shadow-lift)]">
          <div className="px-3 py-2">
            <p className="truncate text-sm font-semibold">{name}</p>
            <p className="truncate text-xs text-ink-soft">
              {role === "manager" ? "Manager" : "Employee"} · {workspace}
            </p>
          </div>
          <ThemeToggle className="mx-1 mb-1" />
          <Link
            role="menuitem"
            href="/settings"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 rounded-[10px] px-3 py-2 text-sm hover:bg-surface-alt"
          >
            <Gear size={18} className="text-ink-soft" />
            Settings
          </Link>
          <div role="menuitem" className="rounded-[10px] px-3 py-2 hover:bg-surface-alt">
            <SignOutButton className="flex w-full items-center gap-2 text-sm" />
          </div>
        </div>
      )}
    </div>
  );
}

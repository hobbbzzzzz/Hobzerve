"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { DeviceMobile } from "./icons";

// Chrome / Edge / Android raise `beforeinstallprompt` once the app is installable; we hold it so "Install App" can
// show the browser's own install dialog later. Safari has no such event: iPhone, iPad and Mac users install from the
// Share / File menu, so for them the button explains the steps instead.

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Mounted once in the root layout: registers the service worker and keeps the install prompt. */
export function PwaRegister() {
  useEffect(() => {
    // Not in development: a service worker gets in the way of hot reload.
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Installing still works from the manifest; only the offline page is lost.
      });
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      deferred = e as InstallPromptEvent;
      emit();
    };
    const onInstalled = () => {
      deferred = null;
      emit();
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  return null;
}

type Platform = "prompt" | "ios" | "mac-safari" | null;

function detect(): { standalone: boolean; safari: "ios" | "mac-safari" | null } {
  const ua = navigator.userAgent;
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  const ios = /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
  const macSafari = !ios && ua.includes("Macintosh") && /Safari\//.test(ua) && !/Chrome|Chromium|Edg|Firefox/.test(ua);
  return { standalone, safari: ios ? "ios" : macSafari ? "mac-safari" : null };
}

/** How this browser can install the app right now, or null when it can't (or it's already installed). */
export function useInstall(): { platform: Platform; install: () => Promise<void> } {
  const hasPrompt = useSyncExternalStore(subscribe, () => deferred !== null, () => false);
  const [env, setEnv] = useState<ReturnType<typeof detect> | null>(null);
  useEffect(() => setEnv(detect()), []);
  const platform: Platform = !env || env.standalone ? null : hasPrompt ? "prompt" : env.safari;
  return {
    platform,
    install: async () => {
      if (!deferred) return;
      await deferred.prompt();
      await deferred.userChoice;
      deferred = null;
      emit();
    },
  };
}

/** "Install App" entry for the user menu. Renders nothing where installing isn't possible. */
export function InstallAppButton({ className, onDone }: { className?: string; onDone?: () => void }) {
  const { platform, install } = useInstall();
  const [help, setHelp] = useState(false);
  if (!platform) return null;
  return (
    <>
      <button
        type="button"
        role="menuitem"
        className={className}
        onClick={async () => {
          if (platform === "prompt") {
            await install();
            onDone?.();
          } else setHelp(true);
        }}
      >
        <DeviceMobile size={18} className="text-ink-soft" />
        Install App
      </button>
      <Dialog
        open={help}
        onClose={() => {
          setHelp(false);
          onDone?.();
        }}
        title="Install Hobzerve"
        description="Hobzerve opens in its own window, with its icon on your home screen or Dock."
        footer={
          <Button variant="primary" onClick={() => setHelp(false)}>
            Got It
          </Button>
        }
      >
        {platform === "ios" ? (
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
            <li>Open this page in Safari.</li>
            <li>
              Tap the <span className="font-semibold">Share</span> button (the square with an arrow).
            </li>
            <li>
              Choose <span className="font-semibold">Add to Home Screen</span>, then <span className="font-semibold">Add</span>.
            </li>
          </ol>
        ) : (
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
            <li>
              In Safari&apos;s menu bar choose <span className="font-semibold">File → Add to Dock</span>.
            </li>
            <li>
              Click <span className="font-semibold">Add</span>.
            </li>
          </ol>
        )}
      </Dialog>
    </>
  );
}

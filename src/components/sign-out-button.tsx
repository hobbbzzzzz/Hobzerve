"use client";

import { useRouter } from "next/navigation";
import { getBrowserClient } from "@/lib/supabase/client";
import { SignOut } from "./icons";

export function SignOutButton({ className }: { className?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className={className ?? "inline-flex items-center gap-2 text-sm font-medium text-primary-strong"}
      onClick={async () => {
        await getBrowserClient().auth.signOut();
        router.replace("/login");
        router.refresh();
      }}
    >
      <SignOut size={18} weight="fill" />
      Sign out
    </button>
  );
}

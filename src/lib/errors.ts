import type { PostgrestError } from "@supabase/supabase-js";

/** Turns database/RPC errors into a message a person can act on. RPCs raise readable messages with HZ codes. */
export function friendlyError(error: PostgrestError | Error | null | undefined): string {
  if (!error) return "Something went wrong.";
  const code = "code" in error ? (error as PostgrestError).code : undefined;
  switch (code) {
    case "HZ401":
      return "Your session ended. Sign in again.";
    case "42501":
      return "You don't have permission to do that.";
    case "PGRST301":
      return "Your session expired. Sign in again.";
  }
  if (code?.startsWith("HZ")) return error.message;
  if (error.message?.includes("Failed to fetch")) return "Can't reach the server. Check your connection and try again.";
  return error.message || "Something went wrong.";
}

export function isConflict(error: PostgrestError | null | undefined): boolean {
  return error?.code === "HZ409";
}

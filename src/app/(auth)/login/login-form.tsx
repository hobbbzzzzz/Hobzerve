"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { getBrowserClient } from "@/lib/supabase/client";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const { error } = await getBrowserClient().auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setError(error.message === "Invalid login credentials" ? "Email or password is incorrect." : error.message);
      setPending(false);
      return;
    }
    router.replace(next);
    router.refresh();
  }

  const input =
    "h-11 w-full rounded-[12px] border border-line bg-surface px-3 text-sm focus:border-primary focus:outline-none focus:ring-4 focus:ring-[rgb(102_118_232/0.15)]";

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-sm font-medium">
          Work email
        </label>
        <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={input} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={input}
        />
      </div>
      {error && (
        <p role="alert" className="rounded-[12px] bg-[#fbe8ec] px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending || !email || !password}
        className="mt-1 h-11 rounded-[14px] bg-primary-gradient text-sm font-semibold text-white shadow-[0_6px_18px_rgb(85_102_224/0.28)] disabled:opacity-55"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

import type { Metadata } from "next";
import Image from "next/image";
import logoMark from "@/assets/logo-mark.png";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign In" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Image src={logoMark} alt="" className="size-14" priority />
          <h1 className="text-2xl font-semibold">Sign in to Hobzerve</h1>
          <p className="text-sm text-ink-soft">Accounts are created by your workspace admin.</p>
        </div>
        <div className="card p-6">
          <LoginForm next={safeNext} />
        </div>
      </div>
    </main>
  );
}

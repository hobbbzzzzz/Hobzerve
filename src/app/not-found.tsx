import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="text-sm font-medium text-primary-strong">404</p>
      <h1 className="text-2xl font-semibold">This page doesn&apos;t exist</h1>
      <p className="text-ink-soft">It may have been archived, or the link is wrong.</p>
      <Link href="/dashboard" className="mt-2 font-medium text-primary-strong underline-offset-4 hover:underline">
        Back to dashboard
      </Link>
    </main>
  );
}

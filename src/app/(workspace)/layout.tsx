import { loadSessionContext } from "@/lib/context";
import { WorkspaceProvider } from "@/components/workspace-provider";
import { TopNav } from "@/components/top-nav";
import { SignOutButton } from "@/components/sign-out-button";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const result = await loadSessionContext();

  if (!result.ok) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
        <h1 className="text-xl font-semibold">No Active Workspace</h1>
        <p className="text-sm text-ink-soft">
          {result.email} is signed in but isn&apos;t an active member of any workspace. Ask the workspace admin to add you.
        </p>
        <SignOutButton />
      </main>
    );
  }

  return (
    <WorkspaceProvider ctx={result.ctx}>
      <TopNav />
      <main className="mx-auto w-full max-w-7xl px-4 pb-16 pt-6 sm:px-6">{children}</main>
    </WorkspaceProvider>
  );
}

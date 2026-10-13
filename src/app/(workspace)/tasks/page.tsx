import type { Metadata } from "next";
import { Suspense } from "react";
import { TasksScreen } from "@/features/tasks/tasks-screen";

export const metadata: Metadata = { title: "Tasks" };

export default function Page() {
  return (
    <Suspense>
      <TasksScreen />
    </Suspense>
  );
}

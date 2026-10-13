import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TaskDetailScreen } from "@/features/tasks/task-detail-screen";

export const metadata: Metadata = { title: "Task" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  return <TaskDetailScreen taskId={id} />;
}

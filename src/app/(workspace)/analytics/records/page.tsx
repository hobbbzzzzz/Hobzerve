import type { Metadata } from "next";
import { Suspense } from "react";
import { RecordsScreen } from "@/features/records/records-screen";

export const metadata: Metadata = { title: "Records" };

export default function Page() {
  return (
    <Suspense>
      <RecordsScreen />
    </Suspense>
  );
}

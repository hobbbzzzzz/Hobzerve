import type { Metadata } from "next";
import { Suspense } from "react";
import { TimeScreen } from "@/features/time/time-screen";

export const metadata: Metadata = { title: "Time" };

export default function Page() {
  return (
    <Suspense>
      <TimeScreen />
    </Suspense>
  );
}

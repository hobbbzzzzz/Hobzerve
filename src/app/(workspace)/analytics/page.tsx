import type { Metadata } from "next";
import { Suspense } from "react";
import { AnalyticsScreen } from "@/features/analytics/analytics-screen";

export const metadata: Metadata = { title: "Analytics" };

export default function Page() {
  return (
    <Suspense>
      <AnalyticsScreen />
    </Suspense>
  );
}

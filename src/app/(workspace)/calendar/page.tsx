import type { Metadata } from "next";
import { Suspense } from "react";
import { CalendarScreen } from "@/features/calendar/calendar-screen";

export const metadata: Metadata = { title: "Calendar" };

export default function Page() {
  return (
    <Suspense>
      <CalendarScreen />
    </Suspense>
  );
}

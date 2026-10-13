import { describe, expect, it } from "vitest";
import { addDays, formatDuration, weekStartOf } from "@/lib/dates";

describe("business week helpers (Decision 33)", () => {
  it("finds the Saturday that starts the week", () => {
    expect(weekStartOf("2026-10-12")).toBe("2026-10-10"); // Monday
    expect(weekStartOf("2026-10-10")).toBe("2026-10-10"); // Saturday
    expect(weekStartOf("2026-10-16")).toBe("2026-10-10"); // Friday
    expect(weekStartOf("2026-10-17")).toBe("2026-10-17"); // next Saturday
  });
  it("adds days across month ends", () => {
    expect(addDays("2026-09-30", 2)).toBe("2026-10-02");
  });
  it("formats signed durations", () => {
    expect(formatDuration(7.5 * 3600)).toBe("7h 30m");
    expect(formatDuration(-2 * 3600, { signed: true })).toBe("−2h 00m");
    expect(formatDuration(3 * 3600, { signed: true })).toBe("+3h 00m");
  });
});

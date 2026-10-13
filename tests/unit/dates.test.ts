import { describe, expect, it } from "vitest";
import { cairoLocalToIso, cairoOffsetMinutes, isoToCairoLocal } from "@/lib/dates";

describe("Cairo date helpers (Decision 114)", () => {
  it("converts local Cairo time to UTC in summer (EEST, UTC+3)", () => {
    expect(cairoLocalToIso("2026-10-12", "17:00")).toBe("2026-10-12T14:00:00.000Z");
  });
  it("converts local Cairo time to UTC in winter (EET, UTC+2)", () => {
    expect(cairoLocalToIso("2026-12-01", "09:30")).toBe("2026-12-01T07:30:00.000Z");
  });
  it("round-trips through isoToCairoLocal", () => {
    const iso = cairoLocalToIso("2026-11-05", "23:59");
    expect(isoToCairoLocal(iso)).toEqual({ date: "2026-11-05", time: "23:59" });
  });
  it("reports the DST offset on both sides of a transition", () => {
    expect(cairoOffsetMinutes(new Date("2026-08-01T12:00:00Z"))).toBe(180);
    expect(cairoOffsetMinutes(new Date("2026-12-15T12:00:00Z"))).toBe(120);
  });
});

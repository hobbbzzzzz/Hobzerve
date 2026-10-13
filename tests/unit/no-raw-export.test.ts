import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// A16 / Decision 111: reports download as PDF only; raw records are on-screen only. Guard against a CSV/XLSX export
// creeping into the app or its API routes.
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}

describe("no raw-record export (A16)", () => {
  it("has no CSV or spreadsheet output anywhere in src/", () => {
    const offenders = files(path.resolve(__dirname, "../../src")).filter((f) =>
      /text\/csv|\.csv\b|\.xlsx?\b|spreadsheetml|application\/vnd\.ms-excel/i.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
  it("the only file-producing API route returns application/pdf", () => {
    const base = path.resolve(__dirname, "../../src/app/api");
    const routes = files(base).map((r) => path.relative(base, r)).sort();
    expect(routes).toEqual([path.join("email", "dispatch", "route.ts"), path.join("reports", "[id]", "pdf", "route.ts")]);
    expect(readFileSync(path.join(base, "reports", "[id]", "pdf", "route.ts"), "utf8")).toContain('"content-type": "application/pdf"');
    // The email dispatcher answers with a JSON summary only; it never serves files.
    expect(readFileSync(path.join(base, "email", "dispatch", "route.ts"), "utf8")).not.toMatch(/content-disposition/i);
  });
});

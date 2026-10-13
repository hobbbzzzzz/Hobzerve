import { describe, expect, it } from "vitest";
import { composeEmail } from "@/features/email/compose";

const to = { email: "a@example.com", name: "Abdelwahab Magdy" };
const item = { title: 'Ahmed changed the deadline of "<Spec>"', body: "Client & legal", link: "/tasks/1", at: "2026-10-12T10:00:00Z" };

describe("email composition", () => {
  it("escapes HTML and builds absolute links", () => {
    const m = composeEmail({ kind: "immediate", delivery_ids: ["x"], items: [item], to }, "https://app.example")!;
    expect(m.subject).toBe('Hobzerve: Ahmed changed the deadline of "<Spec>"');
    expect(m.html).toContain("&lt;Spec&gt;");
    expect(m.html).not.toContain("<Spec>");
    expect(m.html).toContain("Client &amp; legal");
    expect(m.text).toContain("https://app.example/tasks/1");
    expect(m.text).toContain("Hi Abdelwahab,");
  });
  it("digest subject counts updates; no recipient → nothing", () => {
    const d = composeEmail({ kind: "digest", delivery_ids: ["x"], items: [item, { ...item, read: false }], to, digest_date: "2026-10-12" }, "https://app.example")!;
    expect(d.subject).toBe("Hobzerve daily digest · Mon 12 Oct · 2 updates");
    expect(d.text).toContain("1 still unread");
    expect(composeEmail({ kind: "digest", delivery_ids: [], items: [], to: null }, "https://app.example")).toBeNull();
  });
});

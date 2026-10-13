import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// A35: no credentials in the repository.
const root = path.resolve(__dirname, "../..");
// Local env files are git-ignored (checked below) and hold real keys by design, so they're not repository content.
const SKIP = new Set(["node_modules", ".next", ".git", "fonts", ".env", ".env.local"]);
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    if (SKIP.has(f)) return [];
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

describe("repository secrets (A35)", () => {
  const all = files(root).filter((f) => !/\.(png|jpg|woff2?|pdf|lock)$/.test(f) && !f.endsWith("package-lock.json"));

  it("contains no JWTs, private keys or Supabase secret keys", () => {
    const hits = all.filter((f) => {
      const s = readFileSync(f, "utf8");
      return /eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}/.test(s) || /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(s) || /sb_secret_[A-Za-z0-9]{10,}/.test(s);
    });
    expect(hits.map((h) => path.relative(root, h))).toEqual([]);
  });

  it(".env.example leaves every secret empty or as a placeholder", () => {
    const env = readFileSync(path.join(root, ".env.example"), "utf8");
    for (const key of ["SMTP_PASS", "EMAIL_DISPATCH_SECRET", "SEED_MANAGER_PASSWORD", "SEED_EMPLOYEE_PASSWORD"]) {
      expect(env).toMatch(new RegExp(`^${key}=$`, "m"));
    }
    expect(env).toMatch(/^SUPABASE_SERVICE_ROLE_KEY=your-service-role-key$/m);
  });

  it("local env files are git-ignored", () => {
    const ignore = readFileSync(path.join(root, ".gitignore"), "utf8");
    expect(ignore).toMatch(/^\.env$/m);
    expect(ignore).toMatch(/^\.env\.local$/m);
  });
});

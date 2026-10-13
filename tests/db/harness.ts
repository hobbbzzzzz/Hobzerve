import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

/**
 * Local Postgres harness for database tests. Applies a Supabase stub plus every migration
 * to a throwaway database and lets tests act as specific authenticated users through RLS.
 * Point TEST_DATABASE_URL at a local, disposable database — never at the Supabase project.
 */
export const DB_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:54329/hobzerve_test";

const root = path.resolve(__dirname, "../..");

export function migrationFiles(): string[] {
  const dir = path.join(root, "supabase/migrations");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => path.join(dir, f));
}

export async function connect(): Promise<Client> {
  const c = new Client({ connectionString: DB_URL });
  await c.connect();
  return c;
}

export async function resetDatabase(admin: Client): Promise<void> {
  await admin.query(`
    drop schema if exists public cascade;
    drop schema if exists app cascade;
    drop schema if exists auth cascade;
    create schema public;
    grant usage on schema public to public;
  `);
  await admin.query(readFileSync(path.join(__dirname, "supabase-stub.sql"), "utf8"));
  for (const file of migrationFiles()) {
    try {
      await admin.query(readFileSync(file, "utf8"));
    } catch (e) {
      throw new Error(`Migration failed: ${path.basename(file)}: ${(e as Error).message}`);
    }
  }
}

export const ids = {
  ws: "11111111-1111-4111-8111-111111111111",
  otherWs: "22222222-2222-4222-8222-222222222222",
  manager: "aaaaaaaa-0000-4000-8000-000000000001",
  employee: "aaaaaaaa-0000-4000-8000-000000000002",
  outsiderManager: "aaaaaaaa-0000-4000-8000-000000000003",
  outsiderEmployee: "aaaaaaaa-0000-4000-8000-000000000004",
  catOps: "33333333-0000-4000-8000-000000000001",
  catTech: "33333333-0000-4000-8000-000000000002",
};

export async function seed(admin: Client): Promise<void> {
  const q = (sql: string, params: unknown[]) => admin.query(sql, params);
  await q(
    `insert into auth.users (id, email) values ($1, 'ahmed.badr@docspert.com'), ($2, 'abdelwahab.magdy@docspert.com'),
       ($3, 'other.manager@example.com'), ($4, 'other.employee@example.com')`,
    [ids.manager, ids.employee, ids.outsiderManager, ids.outsiderEmployee],
  );
  await q(
    `insert into public.profiles (id, email, display_name, job_title) values
       ($1, 'ahmed.badr@docspert.com', 'Ahmed Badr', 'Manager'),
       ($2, 'abdelwahab.magdy@docspert.com', 'Abdelwahab Magdy', 'Product Manager / Business Analyst'),
       ($3, 'other.manager@example.com', 'Other Manager', null),
       ($4, 'other.employee@example.com', 'Other Employee', null)`,
    [ids.manager, ids.employee, ids.outsiderManager, ids.outsiderEmployee],
  );
  await q(`insert into public.workspaces (id, name) values ($1, 'Docspert'), ($2, 'Other Co')`, [ids.ws, ids.otherWs]);
  await q(
    `insert into public.workspace_members (workspace_id, user_id, role, active_from) values
       ($1, $3, 'manager', '2026-01-01'), ($1, $4, 'employee', '2026-01-01'),
       ($2, $5, 'manager', '2026-01-01'), ($2, $6, 'employee', '2026-01-01')`,
    [ids.ws, ids.otherWs, ids.manager, ids.employee, ids.outsiderManager, ids.outsiderEmployee],
  );
  await q(
    `insert into public.categories (id, workspace_id, name, sort_order) values ($1, $3, 'Operations', 1), ($2, $3, 'Tech', 2)`,
    [ids.catOps, ids.catTech, ids.ws],
  );
}

export class DbError extends Error {
  constructor(
    message: string,
    public code: string | undefined,
    public detail?: string,
  ) {
    super(message);
  }
}

export interface Actor {
  rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

/** Runs each call in its own transaction as the `authenticated` role with the given JWT subject. */
export function as(client: Client, userId: string | null): Actor {
  async function run<T>(sql: string, params: unknown[]): Promise<T[]> {
    await client.query("begin");
    try {
      await client.query(userId ? "set local role authenticated" : "set local role anon");
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(userId ? { sub: userId, role: "authenticated" } : { role: "anon" }),
      ]);
      const res = await client.query(sql, params);
      await client.query("commit");
      return res.rows as T[];
    } catch (e) {
      await client.query("rollback");
      const err = e as { message: string; code?: string; detail?: string };
      throw new DbError(err.message, err.code, err.detail);
    }
  }
  return {
    async rpc<T>(fn: string, args: Record<string, unknown> = {}) {
      const keys = Object.keys(args);
      const sql = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as result`;
      const values = keys.map((k) => {
        const v = args[k];
        if (v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) return JSON.stringify(v);
        return v;
      });
      const rows = await run<{ result: T }>(sql, values);
      return rows[0]!.result;
    },
    query: run,
  };
}

/** Expect a promise to reject with a specific SQLSTATE. */
export async function expectCode(p: Promise<unknown>, code: string): Promise<DbError> {
  try {
    await p;
  } catch (e) {
    const err = e as { code?: string; message: string; detail?: string };
    if (err.code === code) return e instanceof DbError ? e : new DbError(err.message, err.code, err.detail);
    throw new Error(`Expected error ${code} but got ${err.code}: ${err.message}`);
  }
  throw new Error(`Expected error ${code} but the call succeeded`);
}

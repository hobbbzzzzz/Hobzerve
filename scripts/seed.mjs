#!/usr/bin/env node
// Seeds the first workspace and the two accounts (Decisions 93, 115). Safe to run more than once.
// Usage: node --env-file=.env.local scripts/seed.mjs
// Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and the SEED_* variables from .env.example.
import { createClient } from "@supabase/supabase-js";

const env = (name, fallback) => {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") {
    console.error(`Missing ${name}. See .env.example.`);
    process.exit(1);
  }
  return v;
};

const url = env("NEXT_PUBLIC_SUPABASE_URL");
const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
const workspaceName = env("SEED_WORKSPACE_NAME", "Docspert");
const people = [
  {
    role: "manager",
    email: env("SEED_MANAGER_EMAIL").toLowerCase(),
    name: env("SEED_MANAGER_NAME"),
    title: process.env.SEED_MANAGER_TITLE || "Manager",
    password: env("SEED_MANAGER_PASSWORD"),
  },
  {
    role: "employee",
    email: env("SEED_EMPLOYEE_EMAIL").toLowerCase(),
    name: env("SEED_EMPLOYEE_NAME"),
    title: process.env.SEED_EMPLOYEE_TITLE || "Employee",
    password: env("SEED_EMPLOYEE_PASSWORD"),
  },
];
const CATEGORIES = ["Operations", "Business Development", "Product Management", "Tech"];

for (const p of people) {
  if (p.password.length < 12) {
    console.error(`Password for ${p.email} must be at least 12 characters.`);
    process.exit(1);
  }
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function findUserByEmail(email) {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function ensureUser(p) {
  const existing = await findUserByEmail(p.email);
  if (existing) {
    console.log(`• ${p.email} already exists — password left unchanged`);
    return existing.id;
  }
  const { data, error } = await admin.auth.admin.createUser({ email: p.email, password: p.password, email_confirm: true });
  if (error) throw error;
  console.log(`• created ${p.email}`);
  return data.user.id;
}

function check(res, what) {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

const ids = {};
for (const p of people) ids[p.role] = await ensureUser(p);

for (const p of people) {
  check(
    await admin.from("profiles").upsert({ id: ids[p.role], email: p.email, display_name: p.name, job_title: p.title }, { onConflict: "id" }),
    `profile ${p.email}`,
  );
}

let workspace = check(await admin.from("workspaces").select("id").eq("name", workspaceName).maybeSingle(), "find workspace");
if (!workspace) {
  workspace = check(await admin.from("workspaces").insert({ name: workspaceName, timezone: "Africa/Cairo" }).select("id").single(), "create workspace");
  console.log(`• created workspace "${workspaceName}"`);
} else {
  console.log(`• workspace "${workspaceName}" already exists`);
}

const activeFrom = process.env.SEED_ACTIVE_FROM || new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
for (const p of people) {
  check(
    await admin
      .from("workspace_members")
      .upsert({ workspace_id: workspace.id, user_id: ids[p.role], role: p.role, active_from: activeFrom }, { onConflict: "workspace_id,user_id", ignoreDuplicates: true }),
    `membership ${p.email}`,
  );
}

const existingCats = check(await admin.from("categories").select("name").eq("workspace_id", workspace.id), "categories");
const have = new Set(existingCats.map((c) => c.name.toLowerCase()));
let order = existingCats.length;
for (const name of CATEGORIES) {
  if (have.has(name.toLowerCase())) continue;
  check(await admin.from("categories").insert({ workspace_id: workspace.id, name, sort_order: ++order }), `category ${name}`);
}

console.log("\nDone. Sign in at /login with the two accounts.");
console.log("Reminder: turn OFF public sign-ups in Supabase → Authentication → Sign In / Providers.");

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";
import { dispatchEmails } from "@/features/email/dispatch";
import type { ClaimedMessage } from "@/features/email/compose";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Sends queued emails (Decision 113). Called every minute by the database (pg_cron + pg_net) when something is
 * pending. Authenticated with the shared dispatch secret, which the database checks again; no service-role key.
 * SMTP: Google Workspace (smtp.gmail.com, port 465) with an app password.
 */
export async function POST(request: Request) {
  const secret = process.env.EMAIL_DISPATCH_SECRET;
  const auth = request.headers.get("authorization") ?? "";
  if (!secret || auth !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_USER || !SMTP_PASS) {
    // Leave deliveries pending rather than burning them as failures while the server isn't configured.
    return NextResponse.json({ error: "SMTP_USER / SMTP_PASS are not set on the server." }, { status: 503 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const db = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const port = Number(process.env.SMTP_PORT || 465);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port,
    secure: port === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  const from = process.env.EMAIL_FROM || `Hobzerve <${SMTP_USER}>`;
  const appUrl = process.env.APP_URL || new URL(request.url).origin;

  try {
    const result = await dispatchEmails({
      appUrl,
      claim: async () => {
        const { data, error } = await db.rpc("email_claim", { p_secret: secret, p_limit: 25 });
        if (error) throw new Error(error.message);
        return (data ?? []) as ClaimedMessage[];
      },
      report: async (results) => {
        const { error } = await db.rpc("email_report", { p_secret: secret, p_results: results });
        if (error) throw new Error(error.message);
      },
      send: async (mail) => {
        const info = await transport.sendMail({ from, ...mail });
        return { messageId: info.messageId };
      },
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Dispatch failed" }, { status: 500 });
  }
}

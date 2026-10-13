// Builds email subjects and bodies (plain text + simple HTML) from claimed deliveries. Pure functions: no I/O.

export interface EmailItem {
  title: string;
  body: string | null;
  link: string | null;
  at: string;
  read?: boolean;
}

export interface ClaimedMessage {
  kind: "immediate" | "report" | "digest";
  delivery_ids: string[];
  items: EmailItem[];
  to: { email: string; name: string } | null;
  digest_date?: string | null;
  report?: Record<string, unknown> | null;
}

export interface ComposedEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const firstName = (name?: string) => (name ?? "").split(" ")[0] || "there";
const abs = (appUrl: string, link: string | null) => (link ? new URL(link, appUrl).toString() : appUrl);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function layout(appUrl: string, heading: string, intro: string, rows: string, footer: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f7f9fe;font-family:Poppins,Arial,Helvetica,sans-serif;color:#182338">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f9fe;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e5eaf4;border-radius:16px">
<tr><td style="padding:24px 24px 8px"><div style="font-size:12px;font-weight:600;letter-spacing:.08em;color:#4d5ccf">HOBZERVE</div>
<h1 style="margin:8px 0 4px;font-size:20px;line-height:1.3">${esc(heading)}</h1>
<p style="margin:0;font-size:14px;color:#5b677a">${esc(intro)}</p></td></tr>
<tr><td style="padding:8px 24px">${rows}</td></tr>
<tr><td style="padding:8px 24px 24px"><a href="${esc(appUrl)}" style="display:inline-block;background:#5566e0;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 16px;border-radius:12px">Open Hobzerve</a>
<p style="margin:16px 0 0;font-size:12px;color:#5b677a">${esc(footer)}</p></td></tr>
</table></td></tr></table></body></html>`;
}

function itemRow(appUrl: string, i: EmailItem): string {
  return `<div style="border-top:1px solid #e5eaf4;padding:12px 0">
<a href="${esc(abs(appUrl, i.link))}" style="color:#182338;font-size:14px;font-weight:600;text-decoration:none">${esc(i.title)}</a>
${i.body ? `<div style="font-size:13px;color:#5b677a;margin-top:2px">“${esc(clip(i.body, 400))}”</div>` : ""}
<div style="font-size:12px;color:#5b677a;margin-top:2px">${esc(timeFmt.format(new Date(i.at)))}${i.read === false ? " · unread" : ""}</div></div>`;
}

const itemText = (appUrl: string, i: EmailItem) =>
  `- ${i.title}${i.body ? `\n  “${clip(i.body, 400)}”` : ""}\n  ${timeFmt.format(new Date(i.at))} · ${abs(appUrl, i.link)}`;

const FOOTER = "You get this because email notifications are on in your Hobzerve settings. Everything here is also in the app's notification center.";

export function composeEmail(m: ClaimedMessage, appUrl: string): ComposedEmail | null {
  if (!m.to?.email) return null;
  const hi = `Hi ${firstName(m.to.name)},`;

  if (m.kind === "immediate") {
    const n = m.items.length;
    const subject = n === 1 ? `Hobzerve: ${clip(m.items[0]!.title, 120)}` : `Hobzerve: ${n} important updates`;
    const intro = n === 1 ? "An important change was made to your work." : `${n} important changes were made to your work.`;
    return {
      to: m.to.email,
      subject,
      text: `${hi}\n\n${intro}\n\n${m.items.map((i) => itemText(appUrl, i)).join("\n\n")}\n\n${FOOTER}\n`,
      html: layout(appUrl, n === 1 ? "Important update" : `${n} important updates`, intro, m.items.map((i) => itemRow(appUrl, i)).join(""), FOOTER),
    };
  }

  if (m.kind === "digest") {
    const n = m.items.length;
    const date = m.digest_date ? dayFmt.format(new Date(`${m.digest_date}T12:00:00Z`)) : "today";
    const unread = m.items.filter((i) => i.read === false).length;
    const intro = `${n} update${n === 1 ? "" : "s"} since your last digest${unread ? `, ${unread} still unread` : ""}.`;
    return {
      to: m.to.email,
      subject: `Hobzerve daily digest · ${date} · ${n} update${n === 1 ? "" : "s"}`,
      text: `${hi}\n\n${intro}\n\n${m.items.map((i) => itemText(appUrl, i)).join("\n\n")}\n\n${FOOTER}\n`,
      html: layout(appUrl, `Your day in Hobzerve · ${date}`, intro, m.items.map((i) => itemRow(appUrl, i)).join(""), FOOTER),
    };
  }

  const title = String(m.report?.title ?? "Report");
  const fp = String(m.report?.source_fingerprint ?? "");
  const intro = `Your automatic report is ready and attached as a PDF.${fp ? ` Fingerprint ${fp.slice(0, 16)}…` : ""}`;
  return {
    to: m.to.email,
    subject: `Hobzerve: ${title}`,
    text: `${hi}\n\n${intro}\n\nOpen it in the app: ${abs(appUrl, "/analytics/reports")}\n\n${FOOTER}\n`,
    html: layout(appUrl, title, intro, m.items.map((i) => itemRow(appUrl, i)).join(""), FOOTER),
  };
}

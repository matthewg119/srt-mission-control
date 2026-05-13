/**
 * Nightly sequence segmenter — classifies contacts into eligibility lists.
 *
 * Runs once per day (4am ET). Produces rows in sequence_eligibility_lists so
 * Matt can review each list in Mission Control and manually enroll contacts in
 * the right sequence with a single click.
 *
 * NO EMAILS ARE SENT HERE. This is a read-only classification pass.
 *
 * Zoho status filtering happens at send-time inside sequence-engine.ts.
 * The segmenter relies on Supabase contact data + portal flags + OneDrive checks.
 */

import { supabaseAdmin } from "@/lib/db";
import { microsoft } from "@/lib/microsoft";
import { slack } from "@/lib/slack-bot";
import { VEKTOR_CHANNELS } from "@/config/vektor";

// ── Paid-ads exclusion ─────────────────────────────────────────────────────
// NOTE: Update this list after running the Q1 SQL and confirming actual values:
//   SELECT source, ad_source, COUNT(*) FROM contacts GROUP BY source, ad_source ORDER BY count DESC;

const PAID_AD_SOURCES = ["meta", "facebook", "instagram"]; // matches contacts.ad_source
const PAID_SOURCE_KEYWORDS = ["db 1.0", "facebook", "meta", "instagram", "fb ads", "ig ads"];

function isPaidAdLead(row: ContactRow): boolean {
  const adSource = (row.ad_source ?? "").toLowerCase();
  if (PAID_AD_SOURCES.some((s) => adSource.includes(s))) return true;
  const source = (row.source ?? "").toLowerCase();
  return PAID_SOURCE_KEYWORDS.some((k) => source.includes(k));
}

// ── Types ──────────────────────────────────────────────────────────────────

interface ContactRow {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
  created_at: string | null;
  updated_at: string | null;
  do_not_contact: boolean;
  source: string | null;
  ad_source: string | null;
  portal_app_completed: boolean;
  portal_statements_uploaded: boolean;
  application_signed_at: string | null;
  statements_uploaded_at: string | null;
  last_portal_login_at: string | null;
  portal_login_count: number;
  zoho_lead_id: string | null;
}

interface EligibleEntry {
  contact_id: string;
  list_name: string;
  reason_snapshot: Record<string, unknown>;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function daysSince(iso: string | null): number {
  if (!iso) return 9999;
  return (Date.now() - new Date(iso).getTime()) / 86_400_000;
}

async function hasStatementsInOneDrive(businessName: string): Promise<boolean> {
  try {
    const items = await microsoft.listFolderChildren(`Bank Statements/${businessName}`);
    return items.some((f) => f.isFile && f.name.toLowerCase().endsWith(".pdf"));
  } catch {
    return false; // folder doesn't exist
  }
}

// ── Main segmenter ─────────────────────────────────────────────────────────

export async function runSegmenter(): Promise<{
  totals: Record<string, number>;
  excluded: number;
  processed: number;
}> {
  const { data: contacts, error } = await supabaseAdmin
    .from("contacts")
    .select(
      "id, email, first_name, last_name, business_name, created_at, updated_at, " +
      "do_not_contact, source, ad_source, portal_app_completed, portal_statements_uploaded, " +
      "application_signed_at, statements_uploaded_at, last_portal_login_at, portal_login_count, " +
      "zoho_lead_id"
    )
    .not("email", "is", null)
    .order("created_at", { ascending: false })
    .limit(2000);

  if (error || !contacts) {
    console.error("[Segmenter] Failed to fetch contacts:", error?.message);
    return { totals: {}, excluded: 0, processed: 0 };
  }

  // Fetch recent call_log entries (last 7 days) for post-call bucket
  const since7d = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data: recentCalls } = await supabaseAdmin
    .from("call_log")
    .select("contact_id, created_at")
    .gte("created_at", since7d);

  const recentCallIds = new Set((recentCalls ?? []).map((c: { contact_id: string }) => c.contact_id));

  // Fetch recent marketing_sends (last 7 days) to exclude contacts with recent email
  const { data: recentSends } = await supabaseAdmin
    .from("marketing_sends")
    .select("contact_id")
    .gte("sent_at", since7d);
  const recentSendIds = new Set((recentSends ?? []).map((s: { contact_id: string }) => s.contact_id));

  // Fetch all active enrollments so we don't add already-enrolled contacts
  const { data: activeEnrollments } = await supabaseAdmin
    .from("sequence_enrollments")
    .select("contact_id")
    .eq("status", "active");
  const enrolledIds = new Set((activeEnrollments ?? []).map((e: { contact_id: string }) => e.contact_id));

  const entries: EligibleEntry[] = [];
  let excluded = 0;
  let processed = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of (contacts as any[]) as ContactRow[]) {
    // ── Exclusions ──────────────────────────────────────────────────────
    if (row.do_not_contact) { excluded++; continue; }
    if (!row.email) { excluded++; continue; }
    if (isPaidAdLead(row)) { excluded++; continue; }
    if (enrolledIds.has(row.id)) { excluded++; continue; } // already in a sequence

    processed++;
    const daysSinceCreated = daysSince(row.created_at);
    const daysSinceUpdated = daysSince(row.updated_at);
    const daysSinceLogin = daysSince(row.last_portal_login_at);
    const hasApp = row.portal_app_completed;
    const hasStatements = row.portal_statements_uploaded;
    const hasCall = recentCallIds.has(row.id);
    const hasRecentEmail = recentSendIds.has(row.id);

    // ── Bucket: eligible_breakup (28+ days no activity, worked before) ──
    if (
      daysSinceUpdated > 28 &&
      (row.portal_login_count > 0 || hasApp) &&
      !hasRecentEmail
    ) {
      entries.push({
        contact_id: row.id,
        list_name: "eligible_breakup",
        reason_snapshot: {
          days_since_updated: Math.floor(daysSinceUpdated),
          portal_login_count: row.portal_login_count,
          has_app: hasApp,
        },
      });
      continue; // breakup = exit; don't add to other buckets
    }

    // ── Bucket: eligible_post_call_followup ──────────────────────────────
    if (hasCall && !hasRecentEmail) {
      entries.push({
        contact_id: row.id,
        list_name: "eligible_post_call_followup",
        reason_snapshot: {
          recent_call: true,
          has_recent_email: hasRecentEmail,
        },
      });
    }

    // ── Bucket: eligible_awaiting_statements ─────────────────────────────
    if (hasApp && !hasStatements) {
      const biz = row.business_name ?? "";
      const inOneDrive = biz ? await hasStatementsInOneDrive(biz) : false;
      if (!inOneDrive) {
        entries.push({
          contact_id: row.id,
          list_name: "eligible_awaiting_statements",
          reason_snapshot: {
            portal_app_completed: true,
            portal_statements_uploaded: false,
            onedrive_checked: !!biz,
            onedrive_has_files: false,
            days_since_signed: Math.floor(daysSince(row.application_signed_at)),
          },
        });
      }
      continue; // has app → only in awaiting_statements, not fu_new
    }

    // ── Bucket: eligible_app_started ────────────────────────────────────
    if (!hasApp && row.portal_login_count > 0 && daysSinceLogin < 14) {
      entries.push({
        contact_id: row.id,
        list_name: "eligible_app_started",
        reason_snapshot: {
          portal_login_count: row.portal_login_count,
          days_since_login: Math.floor(daysSinceLogin),
        },
      });
    }

    // ── Bucket: eligible_fu_new ─────────────────────────────────────────
    if (!hasApp && daysSinceCreated < 30) {
      entries.push({
        contact_id: row.id,
        list_name: "eligible_fu_new",
        reason_snapshot: {
          days_since_created: Math.floor(daysSinceCreated),
          has_login: row.portal_login_count > 0,
        },
      });
    }
  }

  // ── Write eligibility lists (upsert — truncate each list name then insert) ──
  const now = new Date().toISOString();

  // Clear stale rows for each list name we're about to write
  const listNames = [...new Set(entries.map((e) => e.list_name))];
  for (const listName of listNames) {
    await supabaseAdmin
      .from("sequence_eligibility_lists")
      .delete()
      .eq("list_name", listName);
  }

  if (entries.length > 0) {
    const rows = entries.map((e) => ({ ...e, computed_at: now }));
    // Insert in batches of 200
    for (let i = 0; i < rows.length; i += 200) {
      await supabaseAdmin
        .from("sequence_eligibility_lists")
        .insert(rows.slice(i, i + 200));
    }
  }

  // ── Tally per list ────────────────────────────────────────────────────
  const totals: Record<string, number> = {};
  for (const e of entries) {
    totals[e.list_name] = (totals[e.list_name] ?? 0) + 1;
  }

  // ── Post Slack summary ────────────────────────────────────────────────
  const dateStr = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const lines = Object.entries(totals)
    .map(([k, n]) => `• ${n} ${k.replace("eligible_", "").replace(/_/g, " ")}`)
    .join("\n");

  const channel = VEKTOR_CHANNELS.emailDirector || VEKTOR_CHANNELS.main;
  if (channel) {
    await slack.postMessage(
      channel,
      `📋 Nightly segmentation — ${dateStr}\n${lines || "• No eligible contacts found"}\n\nView → https://mission.srtagency.com/dashboard/email-sequences`
    );
  }

  return { totals, excluded, processed };
}

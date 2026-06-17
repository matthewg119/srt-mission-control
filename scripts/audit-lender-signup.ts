// READ-ONLY audit: which active funders are genuinely signed up vs auto-seeded from Sent.
//
// The "Ready to shop" suggester (src/lib/ai-intel/suggest-funders.ts) has no concept of
// "signed up" — it shops any lender with is_active=true and an email/portal path. But many
// of those rows were created by scripts/seed-lenders-from-sent.ts, which marks every domain
// we've ever emailed as is_active:true / recipient_source:'seeded_from_sent'. So "emailed
// once" silently became "active funder" (e.g. Mantis Funding).
//
// This script buckets every active funder by recipient_source and flags the seeded_from_sent
// rows that carry an underwriting_box (those are the ones most likely to actually get
// suggested). It writes NOTHING — it only prints, so you can decide what to deactivate.
//
// Run: bun run scripts/audit-lender-signup.ts

import { supabaseAdmin } from "../src/lib/db";

interface LenderRow {
  id: string;
  name: string;
  tier: number | null;
  tier_label: string | null;
  recipient_source: string | null;
  submission_method: string | null;
  submission_email: string | null;
  to_emails: string[] | null;
  underwriting_box: string | null;
  created_at: string | null;
}

function recipients(l: LenderRow): string {
  const to = (l.to_emails ?? []).filter(Boolean);
  if (to.length > 0) return to.join(", ");
  return l.submission_email || "(none)";
}

function fmtDate(d: string | null): string {
  if (!d) return "        ";
  return d.slice(0, 10);
}

async function main() {
  const { data, error } = await supabaseAdmin
    .from("lenders")
    .select(
      "id, name, tier, tier_label, recipient_source, submission_method, submission_email, to_emails, underwriting_box, created_at",
    )
    .eq("is_active", true)
    .order("name");

  if (error) {
    console.error("[audit] query failed:", error.message);
    process.exit(1);
  }
  const lenders = (data ?? []) as LenderRow[];
  if (lenders.length === 0) {
    console.log("[audit] no active lenders found (check SUPABASE env points at prod).");
    return;
  }

  // Bucket by provenance.
  const buckets = new Map<string, LenderRow[]>();
  for (const l of lenders) {
    const key = l.recipient_source ?? "(null)";
    (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(l);
  }

  // Headline counts.
  console.log(`\n=== Active funders: ${lenders.length} total ===\n`);
  console.log("  source              active  with_uw_box");
  console.log("  ------------------  ------  -----------");
  const order = ["seeded_from_sent", "manual", "(null)"];
  const keys = [...buckets.keys()].sort(
    (a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99),
  );
  for (const k of keys) {
    const rows = buckets.get(k)!;
    const withBox = rows.filter((r) => r.underwriting_box).length;
    console.log(`  ${k.padEnd(18)}  ${String(rows.length).padStart(6)}  ${String(withBox).padStart(11)}`);
  }

  // The suspect set: seeded_from_sent (UW-box rows first — those are the ones that get suggested).
  const suspect = (buckets.get("seeded_from_sent") ?? []).sort(
    (a, b) => Number(!!b.underwriting_box) - Number(!!a.underwriting_box) || a.name.localeCompare(b.name),
  );
  console.log(`\n=== seeded_from_sent — "emailed, not necessarily signed up" (${suspect.length}) ===`);
  console.log("    ⚠ = has UW box → will actually get suggested. Verify these have a real agreement.\n");
  for (const l of suspect) {
    const flag = l.underwriting_box ? "⚠" : " ";
    const tier = l.tier_label || (l.tier != null ? `tier ${l.tier}` : "—");
    console.log(`  ${flag} ${l.name}  [${tier}]  ${fmtDate(l.created_at)}`);
    console.log(`      → ${recipients(l)}`);
  }

  // For completeness, list the null bucket (pre-dates the column — human judgment needed).
  const nullBucket = (buckets.get("(null)") ?? []).sort((a, b) => a.name.localeCompare(b.name));
  if (nullBucket.length) {
    console.log(`\n=== recipient_source = null — pre-dates provenance tracking (${nullBucket.length}) ===\n`);
    for (const l of nullBucket) {
      const flag = l.underwriting_box ? "⚠" : " ";
      const tier = l.tier_label || (l.tier != null ? `tier ${l.tier}` : "—");
      console.log(`  ${flag} ${l.name}  [${tier}]  → ${recipients(l)}`);
    }
  }

  console.log(
    `\n[audit] read-only — nothing changed. Mantis Funding should appear above (seeded/null, not manual).`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[audit] fatal:", e);
    process.exit(1);
  });

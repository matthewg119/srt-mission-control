// One-shot: fix Arsenal rename, merge Immediate Advances, update Elevate, add Logic Advance + True Advance.
// Run with: bun run scripts/fix-lender-data.ts

import { supabaseAdmin } from "../src/lib/db";

async function findId(names: string[]): Promise<string | null> {
  for (const name of names) {
    const { data } = await supabaseAdmin.from("lenders").select("id").ilike("name", name).maybeSingle();
    if (data?.id) return data.id as string;
  }
  return null;
}

async function main() {
  console.log("\n=== Lender Data Fix Script ===\n");

  // ── 1. Merge Arsenal Funding + Immediate Advances → "Arsenal / Immediate Advances" ──
  {
    const arsenalId = await findId(["Arsenal Funding", "Arsenal Business Capital", "Arsenal / Immediate Advances"]);
    const immediateId = await findId(["Immediate Advances"]);

    const merged = {
      name: "Arsenal / Immediate Advances",
      tier: 3,
      tier_label: "Tier C – Flexible",
      is_active: true,
      submission_method: "email" as const,
      submission_email: "subs@immediateadvances.com",
      cc_emails: [] as string[],
      rep_name: "Laveina Lall",
      rep_email: "laveina@immediateadvances.com",
      min_credit_score: 450,
      min_monthly_revenue: 7000,
      min_time_in_business_months: 4,
      max_amount: 250000,
      factor_rate_range: "1.25 - 1.50+",
      positions_funded: "1st thru 4th",
      repayment_frequency: "Daily",
      funding_speed: "24 hrs",
      notes:
        "C-D paper. Quick snap funding for smaller deals. Works deep positions. Arsenal Funding submits via Immediate Advances (subs@immediateadvances.com). Rep: Laveina Lall 347-977-9073. ISO agreement on file. Do NOT BCC on submissions.",
    };

    if (arsenalId) {
      const { error } = await supabaseAdmin.from("lenders").update(merged).eq("id", arsenalId);
      if (error) console.error("  ✗ Arsenal update:", error.message);
      else console.log("  ✓ Updated Arsenal Funding → Arsenal / Immediate Advances");
    } else {
      const { error } = await supabaseAdmin.from("lenders").insert(merged);
      if (error) console.error("  ✗ Arsenal insert:", error.message);
      else console.log("  ✓ Inserted Arsenal / Immediate Advances");
    }

    // Remove the now-duplicate standalone Immediate Advances entry
    if (immediateId) {
      const { error } = await supabaseAdmin.from("lenders").delete().eq("id", immediateId);
      if (error) console.error("  ✗ Could not delete Immediate Advances duplicate:", error.message);
      else console.log("  ✓ Deleted duplicate Immediate Advances entry");
    }
  }

  // ── 2. Update Elevate Funding with confirmed onboarding details ──
  {
    const id = await findId(["Elevate Funding"]);
    const updates = {
      submission_email: "newdeals@elevatefunding.com",
      cc_emails: [] as string[],
      rep_name: "Jess Upshaw",
      rep_email: "jess@elevatefunding.com",
      min_monthly_revenue: 12000,
      max_amount: 60000,
      min_time_in_business_months: 3,
      max_negative_days: 6,
      factor_rate_range: "1.25 - 1.45",
      positions_funded: "1st (small 2nd)",
      repayment_frequency: "Daily",
      funding_speed: "24-48 hrs",
      is_active: true,
      notes:
        "ISO signed 2026-05-01 via OneSpan e-Sign. Submissions to newdeals@elevatefunding.com ONLY (do NOT CC Jess or Ken). Guidelines: $12K–$150K/mo rev, 1st pos only (small 2nd if merchant nets 40% of offer), $60K max initial advance up to 8 months, buy rates 1.25–1.45, max 6 neg days/mo, min 3 mo TIB, no open BK or past MCA default, all 50 states, non-citizens OK with ITIN (1+ yr open + prior year full tax return). 9% prepay discount if paid within 30 days. Jess Upshaw 888-382-3945 ext 141.",
    };

    if (id) {
      const { error } = await supabaseAdmin.from("lenders").update(updates).eq("id", id);
      if (error) console.error("  ✗ Elevate update:", error.message);
      else console.log("  ✓ Updated Elevate Funding");
    } else {
      const { error } = await supabaseAdmin.from("lenders").insert({ name: "Elevate Funding", tier: 3, tier_label: "Tier C – Flexible", ...updates });
      if (error) console.error("  ✗ Elevate insert:", error.message);
      else console.log("  ✓ Inserted Elevate Funding");
    }
  }

  // ── 3. Add Logic Advance Group ──
  {
    const id = await findId(["Logic Advance Group", "Logic Advance"]);
    const data = {
      name: "Logic Advance Group",
      tier: 3,
      tier_label: "Tier C – Flexible",
      is_active: false,
      submission_method: "email" as const,
      submission_email: "Jacob@logicadvancegroup.com",
      cc_emails: [] as string[],
      rep_name: "Jacob Sarvis",
      rep_email: "Jacob@logicadvancegroup.com",
      min_credit_score: 450,
      min_monthly_revenue: 7000,
      min_time_in_business_months: 4,
      max_amount: 250000,
      factor_rate_range: "1.25 - 1.50+",
      positions_funded: "1st thru 4th",
      repayment_frequency: "Daily",
      funding_speed: "24-48 hrs",
      notes:
        "ISO Agreement + Guidelines received 2026-04-27. Pending full onboarding. Jacob Sarvis (Underwriting) 516-863-4685 | Jacob@logicadvancegroup.com.",
    };

    if (id) {
      const { error } = await supabaseAdmin.from("lenders").update(data).eq("id", id);
      if (error) console.error("  ✗ Logic Advance update:", error.message);
      else console.log("  ✓ Updated Logic Advance Group");
    } else {
      const { error } = await supabaseAdmin.from("lenders").insert(data);
      if (error) console.error("  ✗ Logic Advance insert:", error.message);
      else console.log("  ✓ Inserted Logic Advance Group");
    }
  }

  // ── 4. Add True Advance ──
  {
    const id = await findId(["True Advance", "TrueAdvance"]);
    const data = {
      name: "True Advance",
      tier: 3,
      tier_label: "Tier C – Flexible",
      is_active: false,
      submission_method: "portal" as const,
      portal_url: "https://app.trueadvance.biz/iso/jc",
      submission_email: "jc@trueadvance.biz",
      cc_emails: [] as string[],
      rep_name: "John Callandrillo",
      rep_email: "jc@trueadvance.biz",
      min_credit_score: 450,
      min_monthly_revenue: 7000,
      min_time_in_business_months: 4,
      max_amount: 250000,
      factor_rate_range: "1.25 - 1.50+",
      positions_funded: "1st thru 4th",
      repayment_frequency: "Daily/Weekly",
      funding_speed: "24-48 hrs",
      notes:
        "ISO Agreement link received 2026-04-27. Complete sign-up at https://app.trueadvance.biz/iso/jc. John Callandrillo (Funding Manager) 201-970-3750 | jc@trueadvance.biz.",
    };

    if (id) {
      const { error } = await supabaseAdmin.from("lenders").update(data).eq("id", id);
      if (error) console.error("  ✗ True Advance update:", error.message);
      else console.log("  ✓ Updated True Advance");
    } else {
      const { error } = await supabaseAdmin.from("lenders").insert(data);
      if (error) console.error("  ✗ True Advance insert:", error.message);
      else console.log("  ✓ Inserted True Advance");
    }
  }

  // ── Summary ──
  const { data: all } = await supabaseAdmin
    .from("lenders")
    .select("name, tier, is_active, submission_email")
    .order("tier")
    .order("name");

  console.log(`\n=== All lenders in DB (${all?.length ?? 0}) ===`);
  for (const l of all ?? []) {
    const status = l.is_active ? "✅ active" : "⏳ pending";
    console.log(`  [Tier ${l.tier}] ${status}  ${l.name} — ${l.submission_email || "(portal)"}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

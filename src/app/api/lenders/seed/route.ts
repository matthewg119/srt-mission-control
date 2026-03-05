import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";

// All lenders organized by tier
const SEED_LENDERS = [
  // ── Tier 1 — A Paper ─────────────────────────────────────────
  { name: "Wall Street Funding", tier: 1, products: ["Working Capital", "Revenue Based"], notes: "A paper, competitive rates" },
  { name: "Mulligan Funding", tier: 1, products: ["Working Capital", "Term Loan"], notes: "Strong A paper funder since 2008" },
  { name: "Credibly", tier: 1, products: ["Working Capital", "Line of Credit", "Revenue Based"], notes: "Easy docs, fast approval, up to $600K" },
  { name: "OnDeck", tier: 1, products: ["Working Capital", "Term Loan", "Line of Credit"], notes: "Top-tier direct lender, large volume" },
  { name: "Idea Financial", tier: 1, products: ["Line of Credit"], notes: "LOC specialist" },
  { name: "CAN Capital", tier: 1, products: ["Working Capital", "Revenue Based"], notes: "One of the oldest MCA providers, founded 1998" },
  { name: "Kapitus", tier: 1, products: ["Working Capital", "Revenue Based", "Equipment Financing", "SBA Loan", "Line of Credit"], notes: "Has sales team, multiple products since 2006" },
  { name: "Libertas Funding", tier: 1, products: ["Working Capital", "Revenue Based"], notes: "Greenwich CT, A paper MCA/RBF" },
  { name: "Rapid Finance", tier: 1, products: ["Working Capital", "SBA Loan", "Line of Credit", "Equipment Financing", "Invoice Factoring"], notes: "Multi-product since 2005" },
  { name: "Fora Financial", tier: 1, products: ["Working Capital", "Term Loan"], notes: "Up to $1.5M, established 2008, strong reputation" },
  { name: "BlueVine", tier: 1, products: ["Line of Credit"], notes: "LOC specialist, A paper" },
  { name: "Square Capital", tier: 1, products: ["Working Capital", "Revenue Based"], notes: "A-B paper, automated underwriting" },
  { name: "Super G Capital", tier: 1, products: ["Working Capital", "Term Loan"], notes: "A-B paper" },
  { name: "Snap Advances", tier: 1, products: ["Working Capital", "Revenue Based"], notes: "A-C paper, fast turnaround" },
  { name: "Smart Business Funder", tier: 1, products: ["Working Capital", "Revenue Based"], notes: "A-C paper, well-regarded" },
  { name: "Lendr", tier: 1, products: ["Working Capital", "Revenue Based"], notes: "$250K+ advances, customized terms, stricter requirements" },

  // ── Tier 2 — B Paper ──────────────────────────────────────────
  { name: "Vox Funding", tier: 2, products: ["Working Capital", "Revenue Based"], notes: "B paper direct funder" },
  { name: "Forward Financing", tier: 2, products: ["Working Capital", "Revenue Based"], notes: "4.9/5 Trustpilot, world-class support, same-day funding" },
  { name: "Fundworks", tier: 2, products: ["Working Capital", "Revenue Based"], notes: "B paper direct funder" },
  { name: "Hunter Capital", tier: 2, products: ["Working Capital"], notes: "B paper" },
  { name: "Legend Funding", tier: 2, products: ["Working Capital", "Revenue Based"], notes: "B paper" },
  { name: "Newco Capital", tier: 2, products: ["Working Capital", "Revenue Based"], notes: "B paper" },
  { name: "Greenbox Capital", tier: 2, products: ["Working Capital", "Revenue Based"], notes: "B paper" },
  { name: "Expansion Capital", tier: 2, products: ["Working Capital", "Revenue Based"], notes: "B paper" },
  { name: "Reliant Funding", tier: 2, products: ["Working Capital"], notes: "$5K-$400K, same-day possible" },
  { name: "Pearl Capital", tier: 2, products: ["Working Capital", "Revenue Based"], notes: "B-C paper direct funder" },
  { name: "SOS Capital", tier: 2, products: ["Working Capital", "Revenue Based"], notes: "Solid mid-tier" },
  { name: "VitalCap", tier: 2, products: ["Working Capital", "Revenue Based"], notes: "Frequently recommended" },
  { name: "Knight Capital", tier: 2, products: ["Working Capital", "Revenue Based"], notes: "Active direct funder" },
  { name: "Balboa Capital", tier: 2, products: ["Working Capital", "Equipment Financing"], notes: "Equipment + WC" },
  { name: "Cooper Capital", tier: 2, products: ["Working Capital", "Revenue Based"], notes: "B paper specialist" },
  { name: "Unique Funding Solutions", tier: 2, products: ["Working Capital", "Revenue Based"], notes: "UFS, B paper" },
  { name: "Bespoke Capital", tier: 2, products: ["Working Capital", "Revenue Based"], notes: "B paper" },
  { name: "Capybara Capital", tier: 2, products: ["Working Capital", "Revenue Based"], notes: "A- to C+ paper, larger amounts, longer terms" },
  { name: "Strategic Capital", tier: 2, products: ["Working Capital", "Revenue Based"], notes: "A-C paper" },

  // ── Tier 3 — High Risk ────────────────────────────────────────
  { name: "Bitty Advance", tier: 3, products: ["Working Capital", "Revenue Based"], notes: "High risk, smaller advances" },
  { name: "CFG Merchant Solutions", tier: 3, products: ["Working Capital", "Revenue Based"], notes: "High risk direct funder" },
  { name: "Lendio", tier: 3, products: ["Working Capital", "Term Loan", "Line of Credit", "SBA Loan"], notes: "Marketplace, works with lower credit" },
  { name: "Lendini", tier: 3, products: ["Working Capital", "Revenue Based"], notes: "High risk" },
  { name: "Arsenal Business Capital", tier: 3, products: ["Working Capital", "Revenue Based"], notes: "High risk" },
  { name: "Splash Advance", tier: 3, products: ["Working Capital", "Revenue Based"], notes: "A-C paper, high risk tier" },
  { name: "LCF (Light Capital Funding)", tier: 3, products: ["Working Capital", "Revenue Based"], notes: "30-day terms, higher factors" },
  { name: "Everest Business Funding", tier: 3, products: ["Working Capital", "Revenue Based"], notes: "80-100 day terms" },
  { name: "YSC Funding", tier: 3, products: ["Working Capital", "Revenue Based"], notes: "High risk direct" },
  { name: "Mantis Funding", tier: 3, products: ["Working Capital", "Revenue Based"], notes: "High risk" },
  { name: "Diverse Capital", tier: 3, products: ["Working Capital", "Revenue Based"], notes: "High risk" },
  { name: "Thor Capital", tier: 3, products: ["Working Capital", "Revenue Based"], notes: "High risk" },
  { name: "Proventure Capital", tier: 3, products: ["Working Capital", "Revenue Based"], notes: "40 days and under terms" },
  { name: "Lionheart Business Capital", tier: 3, products: ["Working Capital", "Revenue Based"], notes: "40-week max terms" },
  { name: "Arya Funding", tier: 3, products: ["Working Capital", "Revenue Based"], notes: "30-180 day deals" },
];

export async function POST() {
  try {
    // Get existing lender names to avoid duplicates
    const { data: existing } = await supabaseAdmin
      .from("lenders")
      .select("name");
    const existingNames = new Set((existing || []).map((l: { name: string }) => l.name.toLowerCase()));

    const toInsert = SEED_LENDERS
      .filter((l) => !existingNames.has(l.name.toLowerCase()))
      .map((l) => ({
        name: l.name,
        tier: l.tier,
        products: l.products,
        notes: l.notes,
        submission_method: "email" as const,
        is_active: true,
        blocked_industries: [],
      }));

    if (toInsert.length === 0) {
      return NextResponse.json({ message: "All lenders already exist.", added: 0 });
    }

    const { error } = await supabaseAdmin.from("lenders").insert(toInsert);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      message: `Seeded ${toInsert.length} lenders (${SEED_LENDERS.length - toInsert.length} already existed).`,
      added: toInsert.length,
      skipped: SEED_LENDERS.length - toInsert.length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Seed failed" },
      { status: 500 }
    );
  }
}

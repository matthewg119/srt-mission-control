// Dedupe the lenders table: collapse the many duplicate / contact-person rows per
// funder down to ONE canonical row with the verified name + ordered To + CC (from
// our actual sent mail), preserving the underwriting_box and guideline PDF link.
// Duplicates and junk are DEACTIVATED (is_active=false), never deleted — reversible.
//
// Usage:
//   bun run scripts/dedupe-lenders.ts --dry-run
//   bun run scripts/dedupe-lenders.ts            # apply
import { supabaseAdmin } from "../src/lib/db";

const DRY = process.argv.slice(2).some((a) => a === "--dry-run" || a === "--dry");

// Verified canonical funders (name + ordered To + CC) from ~/Desktop/Funder Guidelines scan.
const CANON: Array<{ domain: string; name: string; to: string[]; cc: string[] }> = [
  { domain: "immediateadvances.com", name: "Arsenal Funding", to: ["subs@immediateadvances.com"], cc: [] },
  { domain: "lexiocapital.com", name: "Lexio Capital", to: ["yasmany.soler@lexiocapital.com"], cc: ["submissions@lexiocapital.com", "verification@lexiocapital.com"] },
  { domain: "splashadvance.com", name: "Splash Advance", to: ["teamkr@splashadvance.com"], cc: ["kr@splashadvance.com"] },
  { domain: "cfgms.com", name: "CFG Merchant Solutions", to: ["gggsubmissions@cfgms.com"], cc: ["mrodriquez@cfgms.com"] },
  { domain: "legendfunding.com", name: "Legend Funding", to: ["lmoreno@legendfunding.com"], cc: ["apps@legendfunding.com"] },
  { domain: "voxfunding.com", name: "VOX Funding", to: ["submissions@voxfunding.com"], cc: ["wdorsey@voxfunding.com"] },
  { domain: "elevatefunding.com", name: "Elevate Funding", to: ["newdeals@elevatefunding.com"], cc: [] },
  { domain: "casacapital.org", name: "Casa Capital", to: ["yuri@casacapital.org"], cc: ["submissions@casacapital.org"] },
  { domain: "fundprollc.com", name: "FundPro Underwriting", to: ["newdeals@fundprollc.com"], cc: ["brandon@fundprollc.com"] },
  { domain: "newcocapitalgroup.com", name: "NewCo Capital Group", to: ["submissions@newcocapitalgroup.com"], cc: ["jennie@newcocapitalgroup.com", "rebekah@newcocapitalgroup.com", "sara@newcocapitalgroup.com"] },
  { domain: "huntercaroline.com", name: "Hunter Capital", to: ["submissions@huntercaroline.com"], cc: [] },
  { domain: "funderial.com", name: "Funderial", to: ["subs@funderial.com"], cc: ["colton@funderial.com"] },
  { domain: "trueadvancefunding.com", name: "True Advance", to: ["submissions@trueadvancefunding.com"], cc: ["jc@trueadvance.biz"] },
  { domain: "accordbf.com", name: "Accord Business Funding", to: ["uw4@accordbf.com"], cc: ["idelatorre@accordbf.com", "underwriting@accordbf.com"] },
  { domain: "ontapcap.com", name: "ONTAP Capital", to: ["tai@ontapcap.com", "jason@ontapcap.com"], cc: [] },
  { domain: "velocitycg.com", name: "Velocity Capital Group", to: ["subs@velocitycg.com", "jesse@velocitycg.com"], cc: [] },
  { domain: "xpfunding.com", name: "XP Funding", to: ["iso@xpfunding.com"], cc: [] },
  { domain: "slimbusinessfunding.com", name: "Slim Business Funding", to: ["deals@slimbusinessfunding.com"], cc: ["joseph@slimbusinessfunding.com"] },
  { domain: "acgroupinc.com", name: "Amsterdam Capital Group", to: ["mhench@acgroupinc.com"], cc: ["submissions@acgroupinc.com"] },
  { domain: "radixfinancialgroup.com", name: "Radix Financial Group", to: ["abe@radixfinancialgroup.com"], cc: [] },
  { domain: "newitymarket.com", name: "NEWITY", to: ["partners@newitymarket.com"], cc: [] },
  { domain: "ev-bf.com", name: "EV-BF", to: ["newdeals@ev-bf.com"], cc: [] },
  { domain: "blacktiefunding.com", name: "Blacktie Funding", to: ["ops@blacktiefunding.com"], cc: [] },
];

// Deactivate any active row in these domains (stray/dup/junk) outright.
const DEACTIVATE_DOMAINS = new Set(["arsenalfunding.com", "gmail.com", "gmail.clm"]);

interface Row {
  id: string;
  name: string;
  is_active: boolean;
  tier: number | null;
  submission_email: string | null;
  to_emails: string[] | null;
  cc_emails: string[] | null;
  underwriting_box: string | null;
  guideline_pdf_url: string | null;
  guideline_pdf_name: string | null;
}

const domOf = (e?: string | null) => (e && e.includes("@") ? e.slice(e.lastIndexOf("@") + 1).toLowerCase() : "");
const domainsOf = (r: Row) => new Set([domOf(r.submission_email), ...(r.to_emails ?? []).map(domOf)].filter(Boolean));

async function main() {
  const { data } = await supabaseAdmin
    .from("lenders")
    .select("id, name, is_active, tier, submission_email, to_emails, cc_emails, underwriting_box, guideline_pdf_url, guideline_pdf_name")
    .eq("is_active", true);
  const rows = (data ?? []) as Row[];

  const deactivateIds = new Set<string>();
  const keeps: Array<{ name: string; to: string[]; cc: string[]; box: boolean; pdf: boolean; absorbed: string[] }> = [];

  for (const c of CANON) {
    const group = rows.filter((r) => domainsOf(r).has(c.domain));
    if (group.length === 0) { console.warn(`  (no active row for ${c.domain} / ${c.name})`); continue; }
    const box = group.map((g) => g.underwriting_box).find(Boolean) ?? null;
    const pdfRow = group.find((g) => g.guideline_pdf_url);
    // keeper: prefer the row already named like the canonical, else the one carrying the box, else first
    const keeper =
      group.find((g) => g.name.toLowerCase() === c.name.toLowerCase()) ??
      group.find((g) => g.underwriting_box) ??
      group[0];
    const dupes = group.filter((g) => g.id !== keeper.id);
    dupes.forEach((d) => deactivateIds.add(d.id));
    keeps.push({ name: c.name, to: c.to, cc: c.cc, box: !!box, pdf: !!pdfRow, absorbed: dupes.map((d) => d.name) });

    if (!DRY) {
      await supabaseAdmin.from("lenders").update({
        name: c.name,
        submission_email: c.to[0],
        to_emails: c.to,
        cc_emails: c.cc,
        underwriting_box: box,
        guideline_pdf_url: pdfRow?.guideline_pdf_url ?? null,
        guideline_pdf_name: pdfRow?.guideline_pdf_name ?? null,
        is_active: true,
      }).eq("id", keeper.id);
    }
  }

  // Junk / stray domains
  for (const r of rows) {
    if (deactivateIds.has(r.id)) continue;
    const ds = domainsOf(r);
    if ([...ds].some((d) => DEACTIVATE_DOMAINS.has(d))) deactivateIds.add(r.id);
  }

  if (!DRY && deactivateIds.size) {
    await supabaseAdmin.from("lenders").update({ is_active: false }).in("id", [...deactivateIds]);
  }

  console.log(`\n=== KEEP (one canonical row per funder) ===`);
  for (const k of keeps.sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`✓ ${k.name}`);
    console.log(`    To: ${k.to.join(", ")}${k.cc.length ? `\n    CC: ${k.cc.join(", ")}` : ""}${k.box ? "  [box]" : ""}${k.pdf ? "  [pdf]" : ""}${k.absorbed.length ? `\n    absorbed: ${k.absorbed.join(", ")}` : ""}`);
  }
  console.log(`\n=== DEACTIVATE (${deactivateIds.size} dup/junk rows) ===`);
  console.log(rows.filter((r) => deactivateIds.has(r.id)).map((r) => r.name).sort().join(", ") || "(none)");
  console.log(`\n${DRY ? "DRY-RUN — nothing written." : "APPLIED."} keepers=${keeps.length}, deactivated=${deactivateIds.size}`);
  process.exit(0);
}
main();

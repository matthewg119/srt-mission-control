// One-off: upload the curated funder guideline PDFs from the Desktop scan to
// OneDrive (Lenders/{name}/) and set lenders.guideline_pdf_url / guideline_pdf_name,
// so Vektor can hand over a real link when asked to "pull up the guidelines".
//
// We list the exact (domain, folder, file) tuples by hand rather than crawling, so
// merchant docs that masquerade as guidelines (Casa/NewCo "PLANET JANE" agreements,
// Greenvalueprop invoice, SNV bank statements, Everest fee sheet, Rapid questionnaire)
// are never uploaded. Mirrors src/app/api/lenders/fetch-pdfs/route.ts:60-61.
//
// Usage:
//   bun run scripts/upload-funder-guidelines.ts --dry-run
//   bun run scripts/upload-funder-guidelines.ts            # upload + set columns
//   GUIDELINES_DIR="/custom/path" bun run scripts/upload-funder-guidelines.ts

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { supabaseAdmin } from "../src/lib/db";
import { microsoft } from "../src/lib/microsoft";

const BASE_DIR = process.env.GUIDELINES_DIR || join(homedir(), "Desktop", "Funder Guidelines");
const DRY_RUN = process.argv.slice(2).some((a) => a === "--dry-run" || a === "--dry");

// Curated: only real underwriting/guideline PDFs. domain = the funder's email domain
// (used to match the lenders row); folder/file = location under BASE_DIR.
const GUIDELINES: Array<{ domain: string; folder: string; file: string }> = [
  { domain: "immediateadvances.com", folder: "Arsenal Funding [immediateadvances.com]", file: "Immediate Advances ISO Guidelines[1] (1) (1).pdf" },
  { domain: "cfgms.com", folder: "CFG Merchant Solutions [cfgms.com]", file: "CFGMS ISO Information Packet.pdf" },
  { domain: "funderial.com", folder: "Funderial [funderial.com]", file: "Funderial Guidelines One Pager.pdf" },
  { domain: "ontapcap.com", folder: "ONTAP Capital [ontapcap.com]", file: "ONTAP CAPITAL GUIDELINES.pdf" },
  { domain: "voxfunding.com", folder: "VOX Funding [voxfunding.com]", file: "VOX_Sales One-Pager_Funding Criteria Overview.pdf" },
  { domain: "legendfunding.com", folder: "Lily Moreno [legendfunding.com]", file: "Legend Funding Guidelines 2.16.pdf" },
  { domain: "huntercaroline.com", folder: "Hunter Capital [huntercaroline.com]", file: "Hunter_Caroline_Guidelines_CR 25[56].pdf" },
  { domain: "lexiocapital.com", folder: "Yasmany Soler [lexiocapital.com]", file: "Guidelines.pdf" },
  { domain: "acgroupinc.com", folder: "M Hench [acgroupinc.com]", file: "ACG GUIDELINES 2026.pdf (2).pdf" },
  { domain: "elevatefunding.com", folder: "Jess Upshaw [elevatefunding.com]", file: "Partner Info Sheet - 2026.pdf" },
];

interface LenderRow {
  id: string;
  name: string;
  submission_email: string | null;
  to_emails: string[] | null;
}

function domainOf(email: string | null | undefined): string {
  if (!email) return "";
  const at = email.lastIndexOf("@");
  return at < 0 ? "" : email.slice(at + 1).toLowerCase();
}

function matchLenders(domain: string, lenders: LenderRow[]): LenderRow[] {
  const hits = lenders.filter((l) => {
    if (domainOf(l.submission_email) === domain) return true;
    return (l.to_emails ?? []).some((e) => domainOf(e) === domain);
  });
  if (hits.length > 1) {
    console.warn(`  ⚠️  ${domain}: ${hits.length} duplicate rows (${hits.map((h) => h.name).join(", ")}) — linking all`);
  }
  return hits;
}

async function main() {
  console.log(`[upload-guidelines] base dir: ${BASE_DIR}${DRY_RUN ? "  (dry-run)" : ""}`);

  const { data, error } = await supabaseAdmin
    .from("lenders")
    .select("id, name, submission_email, to_emails");
  if (error || !data) {
    console.error("[upload-guidelines] failed to load lenders:", error?.message);
    process.exit(1);
  }
  const lenders = data as LenderRow[];

  let uploaded = 0;
  let skipped = 0;
  for (const g of GUIDELINES) {
    const path = join(BASE_DIR, g.folder, g.file);
    if (!existsSync(path)) {
      console.warn(`  ✗ ${g.domain}: file not found — ${path}`);
      skipped++;
      continue;
    }
    const matched = matchLenders(g.domain, lenders);
    if (matched.length === 0) {
      console.warn(`  ✗ ${g.domain}: no lender row matched — seed/reconcile the table first`);
      skipped++;
      continue;
    }

    const safeName = g.file.replace(/[/\\?%*:|"<>]/g, "_");
    if (DRY_RUN) {
      console.log(`  • ${matched[0].name} [${g.domain}] ← ${safeName} (links ${matched.length} row(s))`);
      uploaded++;
      continue;
    }

    try {
      const buf = readFileSync(path);
      const { webUrl } = await microsoft.uploadDriveFile(`Lenders/${matched[0].name}`, safeName, buf, "application/pdf");
      const { error: upErr } = await supabaseAdmin
        .from("lenders")
        .update({ guideline_pdf_url: webUrl, guideline_pdf_name: safeName })
        .in("id", matched.map((m) => m.id));
      if (upErr) {
        console.error(`  ✗ ${matched[0].name}: DB update failed — ${upErr.message}`);
        skipped++;
      } else {
        console.log(`  ✓ ${matched[0].name} [${g.domain}] → ${webUrl} (${matched.length} row(s))`);
        uploaded++;
      }
    } catch (e) {
      console.error(`  ✗ ${matched[0].name}: upload failed — ${(e as Error).message}`);
      skipped++;
    }
  }

  console.log(`[upload-guidelines] done — ${uploaded} ${DRY_RUN ? "would upload" : "uploaded"}, ${skipped} skipped.`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error("[upload-guidelines] fatal:", e);
  process.exit(1);
});

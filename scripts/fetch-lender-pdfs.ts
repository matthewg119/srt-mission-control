// Scan Outlook inbox for lender guideline PDFs and upload to OneDrive/Lenders/{LenderName}/.
// Updates guideline_pdf_url + guideline_pdf_name on matching lender rows.
// Run with: bun run scripts/fetch-lender-pdfs.ts

import { supabaseAdmin } from "../src/lib/db";
import { microsoft } from "../src/lib/microsoft";

interface LenderRow {
  id: string;
  name: string;
  submission_email: string | null;
  rep_email: string | null;
}

const GUIDELINE_KEYWORDS = [
  "guideline", "guide", "partner info", "partner sheet", "rate sheet",
  "program", "criteria", "iso", "agreement", "spec", "pricing",
  "requirements", "onboarding", "underwriting", "uw",
];

function isGuidelinePdf(filename: string): boolean {
  const lower = filename.toLowerCase();
  if (!lower.endsWith(".pdf")) return false;
  return GUIDELINE_KEYWORDS.some((kw) => lower.includes(kw));
}

function extractDomain(email: string | null): string | null {
  if (!email) return null;
  const at = email.indexOf("@");
  return at === -1 ? null : email.slice(at + 1).toLowerCase();
}

async function main() {
  console.log("\n=== Fetch Lender PDFs from Outlook ===\n");

  const { data: lenders, error: lErr } = await supabaseAdmin
    .from("lenders")
    .select("id, name, submission_email, rep_email");
  if (lErr || !lenders) { console.error("Failed to load lenders:", lErr?.message); process.exit(1); }

  // Build domain → lender map
  const domainMap = new Map<string, LenderRow>();
  for (const l of lenders as LenderRow[]) {
    for (const email of [l.submission_email, l.rep_email]) {
      const domain = extractDomain(email);
      if (domain) domainMap.set(domain, l);
    }
  }
  console.log(`Loaded ${lenders.length} lenders, ${domainMap.size} known domains.\n`);

  let matched = 0;
  let uploaded = 0;
  let failed = 0;

  // Scan inbox: messages with attachments from last 180 days
  const since = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
  const filter = `hasAttachments eq true and receivedDateTime ge ${since}`;

  console.log("Scanning inbox...");

  for await (const msg of microsoft.listMessages({ filter, top: 200 })) {
    const senderEmail = msg.from?.emailAddress?.address?.toLowerCase() ?? "";
    const senderDomain = extractDomain(senderEmail);
    if (!senderDomain) continue;

    const lender = domainMap.get(senderDomain);
    if (!lender) continue;

    let attachments: Awaited<ReturnType<typeof microsoft.getMessageAttachments>>;
    try {
      attachments = await microsoft.getMessageAttachments(msg.id);
    } catch {
      continue;
    }

    for (const att of attachments) {
      // Accept if name looks like a guideline doc, OR any PDF over 50KB
      if (!att.name?.toLowerCase().endsWith(".pdf")) continue;
      if (!isGuidelinePdf(att.name) && att.size < 50_000) continue;

      matched++;
      const safeFilename = att.name.replace(/[/\\?%*:|"<>]/g, "_");
      const folderPath = `Lenders/${lender.name}`;

      try {
        const content = Buffer.from(att.contentBytes, "base64");
        const { webUrl } = await microsoft.uploadDriveFile(folderPath, safeFilename, content, "application/pdf");

        await supabaseAdmin
          .from("lenders")
          .update({ guideline_pdf_url: webUrl, guideline_pdf_name: safeFilename })
          .eq("id", lender.id);

        console.log(`  ✓ ${lender.name} — "${safeFilename}" → OneDrive`);
        uploaded++;
      } catch (err) {
        console.error(`  ✗ ${lender.name}/${safeFilename}:`, err instanceof Error ? err.message : err);
        failed++;
      }
    }
  }

  console.log(`\nDone: ${matched} PDF candidates, ${uploaded} uploaded, ${failed} failed.`);
}

main().catch((e) => { console.error(e); process.exit(1); });

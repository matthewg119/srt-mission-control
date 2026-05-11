export const dynamic = "force-dynamic";
// Seed a test lead end-to-end to verify Pre-Approved → channel creation flow.
// Creates:
//   1. contact row (business_name = "TEST Pizza Co")
//   2. deal row linked to the contact
//   3. 3 tiny fake PDFs in OneDrive Deals/TEST Pizza Co/Bank Statements/
//   4. Fires handleStageChange("Pre-Approved") which runs onPreApproved()
//
// Idempotent: deletes any existing TEST Pizza Co rows first so you can hit
// this repeatedly. No Zoho writes — this is a pure local seed.
//
// Hit with:  POST /api/admin/seed-test-lead

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { microsoft } from "@/lib/microsoft";
import { handleStageChange } from "@/lib/ai-intel/stage-handler";

export const runtime = "nodejs";
export const maxDuration = 120;

const BUSINESS_NAME = "TEST Pizza Co";
const FOLDER_PATH = `Deals/${BUSINESS_NAME}/Bank Statements`;

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const skipStmts = url.searchParams.get("skip_stmts") === "1";

  // 1. Tear down prior test rows (clean re-run).
  const { data: prior } = await supabaseAdmin
    .from("contacts")
    .select("id")
    .eq("business_name", BUSINESS_NAME);
  if (prior && prior.length > 0) {
    const ids = prior.map((p) => p.id as string);
    await supabaseAdmin.from("deals").delete().in("contact_id", ids);
    await supabaseAdmin.from("contacts").delete().in("id", ids);
  }

  // 2. Create contact.
  const { data: contact, error: contactErr } = await supabaseAdmin
    .from("contacts")
    .insert({
      business_name: BUSINESS_NAME,
      first_name: "Test",
      last_name: "Owner",
      email: "test+pizza@srtagency.com",
    })
    .select("id")
    .single();

  if (contactErr || !contact) {
    return NextResponse.json({ ok: false, step: "contact_insert", error: contactErr?.message }, { status: 500 });
  }

  // 3. Create deal.
  const { data: deal, error: dealErr } = await supabaseAdmin
    .from("deals")
    .insert({
      contact_id: contact.id,
      amount: 50000,
      zoho_stage: "New",
    })
    .select("id")
    .single();

  if (dealErr || !deal) {
    return NextResponse.json({ ok: false, step: "deal_insert", error: dealErr?.message }, { status: 500 });
  }

  // 4. Upload 3 fake PDFs (unless skipped, which lets you test the gate path).
  const uploadResults: Array<{ name: string; ok: boolean; error?: string }> = [];
  if (!skipStmts) {
    for (const monthLabel of ["January-2026", "February-2026", "March-2026"]) {
      const name = `Statement-${monthLabel}.pdf`;
      const buf = makeMinimalPdf(`${BUSINESS_NAME} — ${monthLabel} bank statement (test seed)`);
      try {
        await microsoft.uploadDriveFile(FOLDER_PATH, name, buf, "application/pdf");
        uploadResults.push({ name, ok: true });
      } catch (e) {
        uploadResults.push({ name, ok: false, error: (e as Error).message });
      }
    }
  }

  // 5. Fire the stage handler as if Zoho flipped stage to Pre-Approved.
  await handleStageChange({
    dealId: deal.id as string,
    oldStage: "New",
    newStage: "Pre-Approved",
    source: "manual",
  });

  // 6. Re-read the deal to confirm channel was created (or not, if skip_stmts).
  const { data: finalDeal } = await supabaseAdmin
    .from("deals")
    .select("id, zoho_stage, slack_deal_channel_id, slack_deal_channel_name")
    .eq("id", deal.id)
    .single();

  return NextResponse.json({
    ok: true,
    contact_id: contact.id,
    deal_id: deal.id,
    folder_path: FOLDER_PATH,
    skipped_stmts: skipStmts,
    uploaded: uploadResults,
    final_deal: finalDeal,
    next_steps: finalDeal?.slack_deal_channel_id
      ? `Open Slack channel #${finalDeal.slack_deal_channel_name} to verify the welcome message.`
      : `No channel created — expected if skip_stmts=1 or if bank stmts failed to upload. Check the Slack DM to Matthew for the bank-stmt warning.`,
  });
}

/** Build the smallest possible valid PDF (a "Hello" page). */
function makeMinimalPdf(text: string): Buffer {
  const header = "%PDF-1.4\n";
  const objs: string[] = [];
  const content = `BT /F1 16 Tf 72 700 Td (${text.replace(/[()\\]/g, "")}) Tj ET`;
  objs.push("1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n");
  objs.push("2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n");
  objs.push("3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n");
  objs.push(`4 0 obj << /Length ${content.length} >> stream\n${content}\nendstream endobj\n`);
  objs.push("5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n");
  let pdf = header;
  const offsets: number[] = [];
  for (const obj of objs) {
    offsets.push(pdf.length);
    pdf += obj;
  }
  const xrefPos = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) pdf += `${String(o).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer << /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  return Buffer.from(pdf, "binary");
}

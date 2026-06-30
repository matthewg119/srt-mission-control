export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { microsoft } from "@/lib/microsoft";
import { supabaseAdmin } from "@/lib/db";
import { systemAlert } from "@/lib/notify";
import { slack } from "@/lib/slack-bot";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const contactId = formData.get("contactId") as string | null;
    const businessName = formData.get("businessName") as string | null;
    // "bank_statement" (default) | "application". Application PDFs are NOT run
    // through the bank-statement analyzer (it would try to read an app form as a
    // statement) and post a different #srt-sub card.
    const docType = (formData.get("docType") as string | null) || "bank_statement";
    const isApplication = docType === "application";
    // When set, this upload belongs to a standalone /apply submission. The AI
    // ingest endpoint posts the richer #srt-sub card (with the Check button), so
    // we suppress the default "ready for underwriting" card here to avoid a
    // duplicate post for the same application.
    const applicationId = formData.get("applicationId") as string | null;

    if (!contactId && !businessName) {
      return NextResponse.json(
        { error: "contactId or businessName required" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const files: File[] = [];
    for (const [key, value] of formData.entries()) {
      if (value instanceof File && key === "files") {
        files.push(value);
      }
    }

    if (files.length === 0) {
      return NextResponse.json(
        { error: "No files provided" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // Resolve a canonical business name so every doc for this deal lands under one
    // Deals/<biz> tree (prevents the owner-name vs LLC folder split, and matches
    // the folder the completeness check + package builder key off). Prefer the
    // matched contact's business_name; fall back to the passed name.
    let canonicalBiz = businessName || "Unknown Business";
    if (contactId) {
      try {
        const { data: c } = await supabaseAdmin
          .from("contacts")
          .select("business_name")
          .eq("id", contactId)
          .maybeSingle();
        if (c?.business_name) canonicalBiz = c.business_name as string;
      } catch { /* ignore — fall back to passed name */ }
    }
    const safeBiz = canonicalBiz.replace(/[<>:"/\\|?*]/g, "_");
    const subFolder = isApplication ? "Application" : "Bank Statements";
    const folderPath = `Deals/${safeBiz}/${subFolder}`;

    const results: Array<{ fileName: string; oneDrive?: string; driveItemId?: string; error?: string }> = [];
    // Keep the raw buffers so the application path can attach the PDF to Slack.
    const fileBuffers: Array<{ name: string; buffer: Buffer }> = [];

    let folderCreated = false;
    try {
      await microsoft.createDriveFolder("Deals");
      await microsoft.createDriveFolder(safeBiz, "Deals");
      await microsoft.createDriveFolder(subFolder, `Deals/${safeBiz}`);
      folderCreated = true;
    } catch (err) {
      console.warn("OneDrive folder creation failed:", err instanceof Error ? err.message : err);
    }

    for (const file of files) {
      const result: { fileName: string; oneDrive?: string; driveItemId?: string; error?: string } = {
        fileName: file.name,
      };

      const buffer = Buffer.from(await file.arrayBuffer());
      fileBuffers.push({ name: file.name, buffer });

      if (folderCreated) {
        try {
          const driveResult = await microsoft.uploadDriveFile(
            folderPath,
            file.name,
            buffer,
            file.type || "application/octet-stream"
          );
          result.oneDrive = driveResult.webUrl;
          result.driveItemId = driveResult.id;
        } catch (err) {
          console.error("OneDrive upload failed:", err instanceof Error ? err.message : err);
        }
      }

      results.push(result);
    }

    const fileNames = results.map(r => r.fileName).join(", ");
    const oneDriveLinks = results
      .filter(r => r.oneDrive)
      .map(r => `• ${r.fileName}: ${r.oneDrive}`)
      .join("\n");
    const docLabel = isApplication ? "Application" : "Bank statements";
    const bizDisplay = businessName || "Applicant";

    // Add note to deal_notes
    if (contactId && files.length > 0) {
      const noteBody = `${docLabel} received (${files.length} file${files.length > 1 ? "s" : ""}): ${fileNames}.${oneDriveLinks ? `\n\nOneDrive:\n${oneDriveLinks}` : ""}\n\nReady for underwriting review.`;

      try {
        await supabaseAdmin.from("deal_notes").insert({
          contact_id: contactId,
          body: noteBody,
          author: "System",
        });
      } catch { /* ignore */ }

      systemAlert(
        isApplication ? "Application Received" : "Bank Statements Received",
        `${bizDisplay} uploaded ${files.length} document(s). Ready for review.`,
        "files/upload",
        "info"
      );
    }

    // Surface in #srt-sub right away so underwriting can start without waiting on
    // the analyzer. Statements → a "received" card; a completed application → a
    // "ready for underwriting" card with the lender PDF attached.
    const subChannel = process.env.SLACK_SUB_CHANNEL || "C0AJXH7PTBM";
    if (files.length > 0 && slack.isConfigured() && !(isApplication && applicationId)) {
      try {
        if (isApplication) {
          const headerText =
            `📄 *Application completed — ${bizDisplay}.* Ready for underwriting.` +
            (oneDriveLinks ? `\n\n*OneDrive:*\n${oneDriveLinks}` : "");
          const posted = await slack.postMessage(subChannel, headerText) as { ok?: boolean; ts?: string };
          // Attach the lender (phone-censored) copy if present, else the first PDF.
          const lender = fileBuffers.find((f) => /lender\.pdf$/i.test(f.name)) || fileBuffers[0];
          if (lender) {
            await slack.uploadFilePDF(
              subChannel,
              lender.name,
              lender.buffer,
              (posted?.ok && posted.ts) ? posted.ts : undefined,
            );
          }
        } else {
          const headerText =
            `📑 *Bank statements received — ${bizDisplay}* (${files.length} file${files.length > 1 ? "s" : ""}).` +
            (oneDriveLinks ? `\n\n*OneDrive:*\n${oneDriveLinks}` : "") +
            `\n\n_Analyzing…_`;
          await slack.postMessage(subChannel, headerText);
        }
      } catch (err) {
        console.error("[files/upload] #srt-sub post failed:", err instanceof Error ? err.message : err);
      }
    }

    // Kick off the bank-statement analyzer (digestion pipeline) once files have
    // landed in OneDrive. Non-blocking — never delays the upload response. The
    // analyzer backfills extracted business data onto the contact, posts a
    // completeness check to #srt-sub, and sets bank_statement_analysis_status so the
    // portal processing overlay can poll it. Pass the OneDrive drive item ids so the
    // analyzer can re-download the stored PDFs with an authed Graph call (webUrls
    // aren't directly downloadable). Fires even without a contactId — the analyzer
    // resolves the deal by merchant_name in that case.
    const driveItemIds = results.map((r) => r.driveItemId).filter((id): id is string => Boolean(id));
    if (!isApplication && driveItemIds.length > 0 && (contactId || businessName)) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";
      fetch(`${appUrl}/api/agent/bank-statements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "portal",
          contact_id: contactId || undefined,
          merchant_name: businessName || undefined,
          drive_item_ids: driveItemIds,
        }),
      }).catch((err) =>
        console.error("[files/upload] analyzer trigger failed:", err instanceof Error ? err.message : err)
      );
    }

    return NextResponse.json(
      { success: true, uploaded: results.length, files: results },
      { headers: CORS_HEADERS }
    );
  } catch (error) {
    console.error("File upload error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "File upload failed" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { microsoft } from "@/lib/microsoft";
import { supabaseAdmin } from "@/lib/db";
import { systemAlert } from "@/lib/notify";

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

    const folderName = (businessName || "Unknown Business").replace(/[<>:"/\\|?*]/g, "_");
    const results: Array<{ fileName: string; oneDrive?: string; driveItemId?: string; error?: string }> = [];

    let folderCreated = false;
    try {
      await microsoft.createDriveFolder("Working Files");
      await microsoft.createDriveFolder(folderName, "Working Files");
      folderCreated = true;
    } catch (err) {
      console.warn("OneDrive folder creation failed:", err instanceof Error ? err.message : err);
    }

    for (const file of files) {
      const result: { fileName: string; oneDrive?: string; driveItemId?: string; error?: string } = {
        fileName: file.name,
      };

      const buffer = Buffer.from(await file.arrayBuffer());

      if (folderCreated) {
        try {
          const driveResult = await microsoft.uploadDriveFile(
            `Working Files/${folderName}`,
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

    // Add note to deal_notes
    if (contactId && files.length > 0) {
      const fileNames = results.map(r => r.fileName).join(", ");
      const oneDriveLinks = results
        .filter(r => r.oneDrive)
        .map(r => `• ${r.fileName}: ${r.oneDrive}`)
        .join("\n");
      const noteBody = `Bank statements received (${files.length} file${files.length > 1 ? "s" : ""}): ${fileNames}.${oneDriveLinks ? `\n\nOneDrive:\n${oneDriveLinks}` : ""}\n\nReady for underwriting review.`;

      try {
        await supabaseAdmin.from("deal_notes").insert({
          contact_id: contactId,
          body: noteBody,
          author: "System",
        });
      } catch { /* ignore */ }

      systemAlert(
        "Bank Statements Received",
        `${businessName || "Applicant"} uploaded ${files.length} document(s). Ready for review.`,
        "files/upload",
        "info"
      );
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
    if (driveItemIds.length > 0 && (contactId || businessName)) {
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

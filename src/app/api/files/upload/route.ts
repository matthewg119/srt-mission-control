import { NextRequest, NextResponse } from "next/server";
import { microsoft } from "@/lib/microsoft";
import { ghl } from "@/lib/ghl";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * POST /api/files/upload
 * Receives files + metadata, uploads to OneDrive + GHL contact documents.
 * Body: multipart/form-data with files[] + contactId + businessName
 */
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

    // Get all files from form data
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
    const results: Array<{ fileName: string; oneDrive?: string; ghl?: string; error?: string }> = [];

    // Create OneDrive folder (non-blocking failure)
    let folderCreated = false;
    try {
      await microsoft.createDriveFolder("Working Files");
      await microsoft.createDriveFolder(folderName, "Working Files");
      folderCreated = true;
    } catch (err) {
      console.warn("OneDrive folder creation failed:", err instanceof Error ? err.message : err);
    }

    for (const file of files) {
      const result: { fileName: string; oneDrive?: string; ghl?: string; error?: string } = {
        fileName: file.name,
      };

      const buffer = Buffer.from(await file.arrayBuffer());

      // Upload to OneDrive
      if (folderCreated) {
        try {
          const driveResult = await microsoft.uploadDriveFile(
            `Working Files/${folderName}`,
            file.name,
            buffer,
            file.type || "application/octet-stream"
          );
          result.oneDrive = driveResult.webUrl;
        } catch (err) {
          console.error("OneDrive upload failed:", err instanceof Error ? err.message : err);
          result.error = "OneDrive upload failed";
        }
      }

      // Upload to GHL contact documents
      if (contactId) {
        try {
          await ghl.uploadContactDocument(contactId, buffer, file.name);
          result.ghl = "uploaded";
        } catch (err) {
          console.error("GHL document upload failed:", err instanceof Error ? err.message : err);
          if (!result.error) result.error = "GHL upload failed";
        }
      }

      results.push(result);
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

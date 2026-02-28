import { NextResponse } from "next/server";
import { microsoft } from "@/lib/microsoft";
import { EMAIL_SIGNATURE_HTML } from "@/config/email-signature";

/**
 * POST /api/integrations/microsoft/signature
 * Sets the Outlook signature for the connected Microsoft 365 account.
 */
export async function POST() {
  try {
    await microsoft.setSignature(EMAIL_SIGNATURE_HTML);
    return NextResponse.json({ success: true, message: "Outlook signature set successfully" });
  } catch (error) {
    console.error("Set signature error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to set signature" },
      { status: 500 }
    );
  }
}

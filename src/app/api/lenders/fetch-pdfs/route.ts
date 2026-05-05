import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { microsoft } from "@/lib/microsoft";

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

export async function POST() {
  try {
    const { data: lenders, error: lErr } = await supabaseAdmin
      .from("lenders")
      .select("id, name, submission_email, rep_email");
    if (lErr || !lenders) return NextResponse.json({ error: lErr?.message ?? "DB error" }, { status: 500 });

    const domainMap = new Map<string, { id: string; name: string }>();
    for (const l of lenders as { id: string; name: string; submission_email: string | null; rep_email: string | null }[]) {
      for (const email of [l.submission_email, l.rep_email]) {
        const domain = extractDomain(email);
        if (domain) domainMap.set(domain, { id: l.id, name: l.name });
      }
    }

    const since = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
    const filter = `hasAttachments eq true and receivedDateTime ge ${since}`;

    const results: { lender: string; file: string; status: "uploaded" | "failed" }[] = [];

    for await (const msg of microsoft.listMessages({ filter, top: 200 })) {
      const senderDomain = extractDomain(msg.from?.emailAddress?.address ?? null);
      if (!senderDomain) continue;
      const lender = domainMap.get(senderDomain);
      if (!lender) continue;

      let attachments: Awaited<ReturnType<typeof microsoft.getMessageAttachments>>;
      try { attachments = await microsoft.getMessageAttachments(msg.id); } catch { continue; }

      for (const att of attachments) {
        if (!att.name?.toLowerCase().endsWith(".pdf")) continue;
        if (!isGuidelinePdf(att.name) && att.size < 50_000) continue;

        const safeFilename = att.name.replace(/[/\\?%*:|"<>]/g, "_");
        try {
          const content = Buffer.from(att.contentBytes, "base64");
          const { webUrl } = await microsoft.uploadDriveFile(`Lenders/${lender.name}`, safeFilename, content, "application/pdf");
          await supabaseAdmin.from("lenders").update({ guideline_pdf_url: webUrl, guideline_pdf_name: safeFilename }).eq("id", lender.id);
          results.push({ lender: lender.name, file: safeFilename, status: "uploaded" });
        } catch {
          results.push({ lender: lender.name, file: safeFilename, status: "failed" });
        }
      }
    }

    return NextResponse.json({ ok: true, results });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}

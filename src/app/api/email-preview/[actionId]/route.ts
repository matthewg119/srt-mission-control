import { supabaseAdmin } from "@/lib/db";
import { EMAIL_SIGNATURE_HTML } from "@/config/email-signature";
import type { PendingActionPayload } from "@/lib/ai-intel/types";

export const dynamic = "force-dynamic";

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * GET /api/email-preview/[actionId]
 *
 * Renders a full HTML preview of a pending marketing email — body + SRT signature.
 * Linked from the "👁 Preview" button in #vektor-email-director Slack approval cards.
 *
 * The action UUID is the only access control — it's unguessable.
 */
export async function GET(
  _req: Request,
  { params }: { params: { actionId: string } }
) {
  const { data, error } = await supabaseAdmin
    .from("pending_slack_actions")
    .select("payload, status, created_at")
    .eq("id", params.actionId)
    .maybeSingle();

  if (error || !data) {
    return new Response(
      `<!DOCTYPE html><html><body style="font-family:Arial;padding:40px;color:#ccc;">
        <h2>Not found</h2><p>This email preview link is invalid or expired.</p>
      </body></html>`,
      { headers: { "Content-Type": "text/html; charset=utf-8" }, status: 404 }
    );
  }

  const payload = data.payload as PendingActionPayload;
  const statusLabel = String(data.status ?? "pending");
  const createdAt = data.created_at ? new Date(data.created_at as string).toLocaleString() : "";

  // Replace {magic_link} with a styled placeholder CTA
  const previewBody = (payload.body ?? "").replace(
    /\{magic_link\}/g,
    `<a href="#preview-only" style="display:inline-block;background:#2ee6a8;color:#0d1b2a;padding:10px 24px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:700;letter-spacing:0.5px;">View Your Portal →</a>`
  );

  const statusColor = statusLabel === "pending" ? "#F59E0B" : statusLabel === "approved" ? "#00C9A7" : "#ef4444";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Email Preview: ${escHtml(payload.subject ?? "(no subject)")}</title>
  <style>
    body { margin: 0; background: #f0f4f8; font-family: Arial, Helvetica, sans-serif; }
    .wrap { max-width: 640px; margin: 32px auto; padding: 0 16px 48px; }
    .meta { background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px 20px; margin-bottom: 8px; font-size: 13px; line-height: 1.8; color: #333; }
    .meta strong { color: #111; }
    .status { display: inline-block; padding: 2px 10px; border-radius: 20px; font-size: 11px; font-weight: 700; background: ${statusColor}22; color: ${statusColor}; margin-left: 8px; }
    .preview-banner { background: #1a1a2e; color: rgba(255,255,255,0.5); font-size: 11px; text-align: center; padding: 6px; border-radius: 4px; margin-bottom: 4px; }
    .body-wrap { background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 28px 28px 20px; }
    .divider { border: none; border-top: 1px solid #e8e8e8; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="preview-banner">👁 PREVIEW ONLY — {magic_link} replaced with placeholder button</div>
    <div class="meta">
      <strong>To:</strong> ${escHtml(payload.to ?? "—")}<br>
      <strong>Subject:</strong> ${escHtml(payload.subject ?? "—")}
      <span class="status">${statusLabel}</span><br>
      <strong>Created:</strong> ${createdAt}
    </div>
    <div class="body-wrap">
      ${previewBody}
      <hr class="divider">
      ${EMAIL_SIGNATURE_HTML}
    </div>
  </div>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

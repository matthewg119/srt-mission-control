import { supabaseAdmin } from "@/lib/db";

const PORTAL_ORIGIN = process.env.PORTAL_PUBLIC_URL?.replace(/\/$/, "") || "https://portal.srtagency.com";

export interface MagicLinkResult {
  action_link: string;
  email_otp?: string;
  hashed_token?: string;
  redirect_to: string;
  expires_at: string | null;
}

/**
 * Mints a short-lived Supabase magic link a merchant can click to log into the
 * portal. Expires per Supabase Auth's default (~1 hour). Used by the Email
 * Marketing Director so every drafted email has exactly one working CTA.
 *
 * Do NOT mint magic links at draft time — they expire. Substitute a placeholder
 * like `{magic_link}` in the drafted body, then call this at send time.
 */
export async function generatePortalMagicLink(
  email: string,
  redirectPath: string = "/portal/dashboard"
): Promise<MagicLinkResult> {
  const redirectTo = `${PORTAL_ORIGIN}${redirectPath.startsWith("/") ? redirectPath : `/${redirectPath}`}`;

  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo },
  });

  if (error || !data?.properties?.action_link) {
    throw new Error(`magic_link_failed: ${error?.message ?? "no action_link returned"}`);
  }

  return {
    action_link: data.properties.action_link,
    email_otp: data.properties.email_otp ?? undefined,
    hashed_token: data.properties.hashed_token ?? undefined,
    redirect_to: redirectTo,
    expires_at: null,
  };
}

/**
 * Replaces `{magic_link}` and optional `{magic_link_label}` placeholders in
 * a drafted email body with a freshly-minted magic link URL. Returns the
 * substituted body AND the token (for marketing_sends audit trail).
 */
export async function substituteMagicLinkInBody(
  body: string,
  email: string,
  redirectPath?: string,
  label: string = "Log in to your portal"
): Promise<{ body: string; token: string | null; action_link: string | null }> {
  if (!body.includes("{magic_link}")) {
    return { body, token: null, action_link: null };
  }
  const link = await generatePortalMagicLink(email, redirectPath);
  // Render as an inline anchor for HTML email; plain-text senders get the raw URL.
  const htmlAnchor = `<a href="${link.action_link}" style="color: #2ee6a8; font-weight: 700; text-decoration: underline;">${label}</a>`;
  const substituted = body
    .replace(/\{magic_link_label\}/g, label)
    .replace(/\{magic_link\}/g, htmlAnchor);
  return { body: substituted, token: link.hashed_token ?? link.email_otp ?? null, action_link: link.action_link };
}

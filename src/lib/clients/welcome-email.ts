// The pilot welcome email. Sent within 60 seconds of "Start pilot" (PILOT §16.1).
//
// TRANSPORT. The spec says Resend. This app has no Resend: the key sits unused in
// Vercel, the package is not a dependency, and every email in the codebase goes through
// Microsoft Graph. The build prompt's own constraint is "no new third-party services",
// so this uses Graph from matthew@srtagency.com like everything else.
//
// COPY. §16.1 is reproduced as closely as it can be, with two deviations, both forced:
//
//   1. Em dashes. The source copy has four. src/lib/copy-guard.ts THROWS at module
//      evaluation on any em dash, so shipping them verbatim fails `next build`. They
//      are commas and periods here. The guard() wrapper below is what proves it.
//
//   2. "The last screen books our call." It does not, yet. Booking is section 4 of the
//      build and is blocked on Graph calendar write, which does not exist in
//      src/lib/microsoft.ts. Promising a booking screen that is not there would make
//      the first thing a pilot reads from us untrue, so the line says we will send
//      times instead. Restore the original the day booking ships.
//
// NO PRICE. There is no amount, tier, or "after the pilot" line anywhere in this file,
// and nothing here imports a price constant. PILOT §1.

import { microsoft } from "@/lib/microsoft";
import { SIGNATURE_S_HTML } from "@/config/email-signature";
import { guard } from "@/lib/copy-guard";

export const WELCOME_SUBJECT = guard(
  "welcome subject",
  "Next step: ten minutes, then we book your call"
);

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const INTAKE_LINE = guard(
  "welcome intake line",
  "It's about ten minutes: your business details exactly as they should appear everywhere, " +
    "your treatments, who you most want walking in, and how you currently ask for reviews. " +
    "When you're done we'll send you times for our call."
);

const CALL_LINE = guard(
  "welcome call line",
  "On the call I'll show you exactly where the AI is naming other clinics in your city " +
    "instead of you, then we get set up. About an hour, you drive your own accounts, " +
    "I never touch a password."
);

export interface WelcomeEmailParams {
  to: string;
  firstName?: string | null;
  /** Signed /onboarding URL. Null renders no button rather than a dead link. */
  onboardingUrl: string | null;
}

export async function sendPilotWelcome({
  to,
  firstName,
  onboardingUrl,
}: WelcomeEmailParams): Promise<void> {
  // Same missing-URL rule as the receipt and guide emails: an unsignable link degrades
  // to no CTA block, never to a dead link. Here it matters more than usual, because
  // this email's entire job is to deliver that one link.
  const ctaBlock = onboardingUrl
    ? `
    <p style="margin:0 0 24px">
      <a href="${onboardingUrl}" style="display:inline-block;background:#00C9A7;color:#04252b;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:8px">Start your onboarding</a>
    </p>
    <p style="margin:0 0 24px;font-size:13px;color:#888888">Or paste this into your browser: ${escapeHtml(onboardingUrl)}</p>`
    : "";

  const body = `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#333333">
  <div style="background:#0B1426;padding:28px 24px;text-align:center">
    <span style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:0.5px">SRT Agency</span>
  </div>
  <div style="padding:32px 24px">
    <p style="margin:0 0 16px">${escapeHtml(firstName || "Hi there")}, you're in. Here's the only link you need for now:</p>
    ${ctaBlock}
    <p style="margin:0 0 16px">${INTAKE_LINE}</p>
    <p style="margin:0 0 24px">${CALL_LINE}</p>
    ${SIGNATURE_S_HTML}
  </div>
  <div style="background:#f5f5f5;padding:16px 24px;text-align:center;font-size:12px;color:#888888">
    <p style="margin:0">SRT Agency LLC, Search Retrieval Tactics</p>
    <p style="margin:8px 0 0">Nothing here is medical advice.</p>
  </div>
</div>
  `;

  await microsoft.sendMail({
    to,
    subject: WELCOME_SUBJECT,
    body,
    isHtml: true,
    fromMailbox: process.env.OUTREACH_MAILBOX || "matthew@srtagency.com",
  });
}

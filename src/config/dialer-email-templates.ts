// Full-HTML dialer email templates that are sent VERBATIM — no "Hello {name},"
// greeting and NO signature appended. The SRT Auto-Dialer (v22+) references
// these by key via the `template_key` field on /api/zoho/compose-email-approval.
//
// When a template_key matches one of these, the compose-email-approval route
// builds the approval-card payload with is_html:true and omits signature_name,
// so buildHtmlBody() (src/lib/ai-intel/execute-action.ts) returns the HTML
// untouched. The email is mailed exactly as defined here.
//
// TOKENS: the compose-email-approval route fills two placeholders before send:
//   {{firstName}}  → the lead's Zoho first name (falls back to "there")
//   {{customLine}} → the AI-generated / edited custom line for "scaling-intro"
// Templates without those tokens are unaffected.
//
// The eleven business-funding templates that used to live here (next-steps,
// app-no-statements, statements-no-app, sba, sba-es, sba-equipment,
// equipment-financing, money-business, commercial-construction, heloc, decline)
// went with the funding business. What is left is the AEO set. If the dialer
// still sends a retired template_key, compose-email-approval finds no match and
// falls back to a normal drafted email rather than sending funding copy.

import { SIGNATURE_S_HTML } from "@/config/email-signature";

export interface FullHtmlEmailTemplate {
  subject: string;
  html: string;
}

// Resolve the Outlook "S" signature, preferring a runtime env override.
const SIG_S = process.env.SIGNATURE_S_HTML || SIGNATURE_S_HTML;

// Shared style primitives so every template renders identically to the
// original "Next Steps" design.
const WRAP_OPEN = `<div style="font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;font-size:15px;line-height:1.5;max-width:640px;text-align:left;">`;
// Inline yellow highlight (matches the original drafts' highlighter).
const hl = (inner: string) =>
  `<span style="background:#fff200;padding:2px 4px;line-height:1.8;">${inner}</span>`;
const ulStyle = `style="margin:0 0 20px 0;padding-left:22px;list-style-type:disc;"`;
const liStyle = `style="margin:0 0 6px 0;"`;

export const FULL_HTML_EMAIL_TEMPLATES: Record<string, FullHtmlEmailTemplate> = {
  // ── Nice Speaking With You (AI Visibility permission ask) ───────────────────
  // Captured VERBATIM from the sent message "ChatGPT Visibility report Inquire"
  // via GET /api/debug/capture-signature. Only the <html>/<head>/<body> wrapper
  // was stripped; not one character of the body was retyped or restyled.
  //
  // NO SIG_S here, deliberately. Matthew typed his sign-off into the message
  // itself ("Thanks, / Matthew Garcia / ..."), so it is already inside this HTML.
  // Appending the "S" block would put a SECOND, different signature on an email
  // whose whole point is that it goes out exactly as he sent it. It carries no
  // cid: images either, so nothing here breaks when Graph sends it.
  //
  // No {{firstName}} token on purpose: the email opens "Nice speaking with you,"
  // with no name, and that is how it was written.
  "nice-speaking": {
    subject: "ChatGPT Visibility report Inquire",
    html: `<div class="elementToProof" style="font-family:Aptos,Aptos_EmbeddedFont,Aptos_MSFontService,Calibri,Helvetica,sans-serif; font-size:12pt; color:rgb(0,0,0)">Nice speaking with you,</div><div class="elementToProof" style="font-family:Aptos,Aptos_EmbeddedFont,Aptos_MSFontService,Calibri,Helvetica,sans-serif; font-size:12pt; color:rgb(0,0,0)"><br></div><div class="elementToProof" style="font-family:Aptos,Aptos_EmbeddedFont,Aptos_MSFontService,Calibri,Helvetica,sans-serif; font-size:12pt; color:rgb(0,0,0)">We will get started working on your report shortly.</div><div class="elementToProof" style="font-family:Aptos,Aptos_EmbeddedFont,Aptos_MSFontService,Calibri,Helvetica,sans-serif; font-size:12pt; color:rgb(0,0,0)"><br></div><div class="elementToProof" style="font-family:Aptos,Aptos_EmbeddedFont,Aptos_MSFontService,Calibri,Helvetica,sans-serif; font-size:12pt; color:rgb(0,0,0)">Please reply to this email with a &quot;1&quot; or anything overall,</div><div class="elementToProof" style="font-family:Aptos,Aptos_EmbeddedFont,Aptos_MSFontService,Calibri,Helvetica,sans-serif; font-size:12pt; color:rgb(0,0,0)"><br></div><div class="elementToProof" style="font-family:Aptos,Aptos_EmbeddedFont,Aptos_MSFontService,Calibri,Helvetica,sans-serif; font-size:12pt; color:rgb(0,0,0)">This is for the email to give us permission to send the full AI Visibility report.</div><div id="Signature" class="elementToProof"><div class="elementToProof" style="font-family:Aptos,Aptos_EmbeddedFont,Aptos_MSFontService,Calibri,Helvetica,sans-serif; font-size:12pt; color:rgb(0,0,0)"><br></div><div class="elementToProof" style="font-size:12pt; color:rgb(0,0,0)"><span style="font-family:Aptos,Aptos_EmbeddedFont,Aptos_MSFontService,Calibri,Helvetica,sans-serif; color:rgb(0,36,81)">Thanks,<br>Matthew Garcia<br><b>Search Retrieval Tactics</b><br>AI Visibility Specialist<br>336-833-2303</span><span style="font-family:Aptos,Aptos_EmbeddedFont,Aptos_MSFontService,Calibri,Helvetica,sans-serif"><br></span><span style="font-family:Aptos,sans-serif"><a href="https://www.srtagency.com" title="https://www.srtagency.com">https://www.srtagency.com</a></span><span style="font-family:Aptos,Aptos_EmbeddedFont,Aptos_MSFontService,Calibri,Helvetica,sans-serif"><br></span></div></div>`,
  },

  // ── Original post-call "Next Steps" email (verbatim, no greeting/signature) ──
  // ── About Us ────────────────────────────────────────────────────────────────
  "about-us": {
    subject: "Here's a Little More About Us",
    html: `${WRAP_OPEN}
  <p style="margin:0 0 16px 0;text-align:left;">We would like to share more about who we are and how we operate; we're a little different from what most people expect.</p>
  <p style="margin:0 0 16px 0;text-align:left;">SRT stands for Search Retrieval Tactics. We work on one thing: making sure that when someone asks an AI assistant for a business like yours, it names you.</p>
  <p style="margin:0 0 16px 0;text-align:left;">That is not advertising and it is not SEO. It is building the part of your own site that an assistant can actually read and quote, in your words, and keeping it current as the assistants change.</p>
  <p style="margin:0 0 16px 0;text-align:left;">You'd have someone in your corner ${hl("who understands your full picture")} and builds it around how your customers actually search.</p>
  <p style="margin:0 0 16px 0;text-align:left;"><strong>We build the first section free so you can see it working before you spend anything.</strong></p>
  <p style="margin:0 0 16px 0;text-align:left;">Our primary offices are in Tampa (currently expanding a new location in NC).</p>
  <p style="margin:0 0 16px 0;text-align:left;">At the end of the day, we're looking to build long-term relationships with our clients, not just close a deal and move on.</p>
  <p style="margin:0 0 24px 0;text-align:left;">Best Regards,</p>
</div>
${SIG_S}`,
  },

  // ── Intro, with the AI-drafted custom line ──────────────────────────────────
  // {{customLine}} comes from src/lib/ai-intel/custom-intro-director.ts and is
  // editable in the dialer box before send.
  "scaling-intro": {
    subject: "Getting {{firstName}} found by AI",
    html: `${WRAP_OPEN}
  <p style="margin:0 0 24px 0;text-align:left;font-size:16px;">Hello {{firstName}},</p>
  <p style="margin:0 0 16px 0;text-align:left;">More people are asking an AI assistant for a business like yours than are typing it into a search box. Most sites have nothing on them an assistant can read, so it names somebody else.</p>
  <p style="margin:0 0 16px 0;text-align:left;">We build one section of your own site that an assistant can read and quote: what you do, who you do it for, where, and what it costs.</p>
  <p style="margin:0 0 20px 0;text-align:left;">${hl("The first one is free. No card, nothing to install, and you keep it either way.")}</p>
  <p style="margin:0 0 16px 0;text-align:left;">{{customLine}}</p>
  <p style="margin:0 0 16px 0;text-align:left;">Just reply "yes" and I'll get it started, or call me if you have any questions.</p>
  <p style="margin:0 0 24px 0;text-align:left;">Kind regards,</p>
</div>
${SIG_S}`,
  },

  // ── Not a fit right now ─────────────────────────────────────────────────────
  // {{customLine}} is the reason typed in the dialer box per lead. It renders
  // bold in the sentence.
  "not-a-fit": {
    subject: "Following up on our conversation",
    html: `${WRAP_OPEN}
  <p style="margin:0 0 16px 0;text-align:left;">Hi {{firstName}},</p>
  <p style="margin:0 0 16px 0;text-align:left;">Thank you for taking the time to talk it through with us.</p>
  <p style="margin:0 0 16px 0;text-align:left;">This is not the right fit at the moment, mainly because of <strong>{{customLine}}</strong>.</p>
  <p style="margin:0 0 16px 0;text-align:left;">If that changes, or you want another look down the road, reply to this and we'll pick it back up.</p>
  <p style="margin:0 0 24px 0;text-align:left;">Best regards,</p>
</div>
${SIG_S}`,
  },
};

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
const PORTAL_URL = "https://srtagency.com/capital";
// Inline yellow highlight (matches the original drafts' highlighter).
const hl = (inner: string) =>
  `<span style="background:#fff200;padding:2px 4px;line-height:1.8;">${inner}</span>`;
// Green "Start Now →" button paragraph.
const START_NOW_BTN = `<p style="margin:0 0 28px 0;text-align:left;">
    <a href="${PORTAL_URL}" style="display:inline-block;background:#2ee6a8;color:#0d1b2a;text-decoration:none;font-weight:700;padding:10px 28px;border-radius:6px;">Start Now &#8594;</a>
  </p>`;
const olStyle = `style="margin:0 0 20px 0;padding-left:22px;"`;
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
  "next-steps": {
    subject: "(Next Steps) Business loan Inquire",
    html: `<div style="font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;font-size:15px;line-height:1.5;max-width:640px;text-align:left;">
  <p style="margin:0 0 24px 0;text-align:left;font-size:16px;">Nice speaking with you!</p>
  <p style="margin:0 0 24px 0;text-align:left;">Please complete the following <strong>application &amp; Income Verification</strong>:</p>
  <p style="margin:0 0 16px 0;text-align:left;"><span style="background:#fff200;padding:2px 4px;line-height:1.8;">&rarr; 2-minute <strong>Funding</strong> application</span></p>
  <p style="margin:0 0 28px 0;text-align:left;">
    <a href="https://srtagency.com/capital" style="display:inline-block;background:#2ee6a8;color:#0d1b2a;text-decoration:none;font-weight:700;padding:10px 28px;border-radius:6px;">Start Now &#8594;</a>
  </p>
  <p style="margin:0 0 32px 0;text-align:left;"><span style="background:#fff200;padding:2px 4px;line-height:1.8;">&rarr; Last 3 months of <strong>business bank statements</strong> sent to <a href="mailto:matthew@srtagency.com">matthew@srtagency.com</a></span></p>
  <p style="margin:0 0 24px 0;text-align:left;">Once you send that over to me,<br>I will get you an approval and have you funded in less than 24 hours.</p>
  <p style="margin:0 0 24px 0;text-align:left;">Best regards,</p>
</div>
${SIG_S}`,
  },

  // ── App submitted, awaiting Income Verification (Plaid OR statements) ──
  "app-no-statements": {
    subject: "Business Funding (INCOME VERIFICATION)",
    html: `${WRAP_OPEN}
  <p style="margin:0 0 24px 0;text-align:left;font-size:16px;">Hello {{firstName}}!</p>
  <p style="margin:0 0 16px 0;text-align:left;">We have received your <strong>application &amp; Awaiting on</strong> <span style="color:#c0392b;font-weight:700;">Income Verification</span>:</p>
  <p style="margin:0 0 16px 0;text-align:left;">${hl("&rarr; Connect Through Plaid <strong>(API Encrypted)</strong>")}</p>
  <p style="margin:0 0 28px 0;text-align:left;">
    <a href="https://srtagency.com/fullapp" style="display:inline-block;background:#2ee6a8;color:#0d1b2a;text-decoration:none;font-weight:700;padding:10px 28px;border-radius:6px;">Start Now &#8594;</a>
  </p>
  <p style="margin:0 0 28px 0;text-align:left;">${hl("&rarr; or you can attach to this email the last 3 months of <strong>business bank statements</strong>")}</p>
  <p style="margin:0 0 24px 0;text-align:left;"><a href="mailto:matthew@srtagency.com">matthew@srtagency.com</a></p>
  <p style="margin:0 0 24px 0;text-align:left;">Best regards,</p>
</div>
${SIG_S}`,
  },

  // ── Statements received, application not finished → finish the app ──
  "statements-no-app": {
    subject: "Your bank statements are in — finish your application",
    html: `${WRAP_OPEN}
  <p style="margin:0 0 24px 0;text-align:left;font-size:16px;">Hello {{firstName}}!</p>
  <p style="margin:0 0 16px 0;text-align:left;">We have your <strong>business bank statements</strong>. The last step is your quick ${hl("2-minute funding application")}:</p>
  <p style="margin:0 0 28px 0;text-align:left;">
    <a href="https://srtagency.com/fullapp" style="display:inline-block;background:#2ee6a8;color:#0d1b2a;text-decoration:none;font-weight:700;padding:10px 28px;border-radius:6px;">Finish Application &#8594;</a>
  </p>
  <p style="margin:0 0 24px 0;text-align:left;">Once that's in, I'll get your file underwritten and have you an approval, often within 24 hours.</p>
  <p style="margin:0 0 24px 0;text-align:left;">Any questions, just reply here or reach me at <a href="mailto:matthew@srtagency.com">matthew@srtagency.com</a>.</p>
  <p style="margin:0 0 24px 0;text-align:left;">Best regards,</p>
</div>
${SIG_S}`,
  },

  // ── 1. SBA 7(a) — Documents Needed ──────────────────────────────────────────
  "sba": {
    subject: "Next Steps for Your Business Funding - Documents Needed",
    html: `${WRAP_OPEN}
  <p style="margin:0 0 24px 0;text-align:left;font-size:16px;">Hey {{firstName}},</p>
  <p style="margin:0 0 16px 0;text-align:left;">Appreciate you taking a minute while on the job site.</p>
  <p style="margin:0 0 16px 0;text-align:left;">Based on what you shared, it sounds like your business may be a strong fit for an <strong>SBA 7(a) loan</strong>, which offers significantly better rates and terms than working capital options.</p>
  <p style="margin:0 0 16px 0;text-align:left;">To get your application moving, I need:</p>
  <p style="margin:0 0 12px 0;text-align:left;"><strong>DOCUMENTS NEEDED:</strong> <a href="${PORTAL_URL}">(click here to submit all 4 in our portal)</a></p>
  <ol ${olStyle}>
    <li ${liStyle}>Business funding application</li>
    <li ${liStyle}>Last 2 years of business tax returns (unredacted)</li>
    <li ${liStyle}>Last 3 months of business bank statements</li>
    <li ${liStyle}>Debt schedule (list of all current business loans/obligations, and I can help you build this inside our portal)</li>
  </ol>
  <p style="margin:0 0 16px 0;text-align:left;">If you didn't file for the most recent tax period, please send proof of extension + the prior year's return.</p>
  <p style="margin:0 0 16px 0;text-align:left;">You can reply to this email with the documents attached.</p>
  <p style="margin:0 0 16px 0;text-align:left;">Once I have everything, I'll get your application submitted and keep you posted every step of the way.</p>
  <p style="margin:0 0 16px 0;text-align:left;">The SBA process takes a bit longer than a quick working capital advance, but the terms are worth it: lower rates, longer repayment, and no daily/weekly pulls on your account.</p>
  <p style="margin:0 0 16px 0;text-align:left;">Let me know if you have any questions.</p>
  <p style="margin:0 0 16px 0;text-align:left;">Happy to jump on a quick call after 5 if easier.</p>
  <p style="margin:0 0 24px 0;text-align:left;">Best regards,</p>
</div>
${SIG_S}`,
  },

  // ── 2. Money for the Business (cold opener) ─────────────────────────────────
  "money-business": {
    subject: "Money for the business",
    html: `${WRAP_OPEN}
  <p style="margin:0 0 24px 0;text-align:left;font-size:16px;">Good afternoon,</p>
  <p style="margin:0 0 16px 0;text-align:left;">Are you currently looking to get any type of funding for your business?</p>
  <p style="margin:0 0 16px 0;text-align:left;">We work with SBA, equipment financing, and working capital.</p>
  <p style="margin:0 0 16px 0;text-align:left;">It takes 2 minutes to fill out our online application.</p>
  <p style="margin:0 0 16px 0;text-align:left;">${hl("&rarr; 2-minute application")}</p>
  ${START_NOW_BTN}
  <p style="margin:0 0 24px 0;text-align:left;">Kind regards,</p>
</div>
${SIG_S}`,
  },

  // ── 3. SBA + Equipment Financing ────────────────────────────────────────────
  "sba-equipment": {
    subject: "Business Funding (SBA & Equipment Financing)",
    html: `${WRAP_OPEN}
  <p style="margin:0 0 24px 0;text-align:left;font-size:16px;">Nice speaking with you,</p>
  <p style="margin:0 0 16px 0;text-align:left;">As we discussed, given your strong credit profile and time in business, you're in a great position to explore two solid funding paths:</p>
  <p style="margin:0 0 12px 0;text-align:left;">- <strong>SBA</strong> is best for larger capital needs with longer terms and lower payments. The approval process takes time, which is exactly why we want to get the ball rolling now.</p>
  <p style="margin:0 0 16px 0;text-align:left;">- <strong>Equipment Financing</strong> is a faster, more targeted option for any equipment you're bringing in.</p>
  <p style="margin:0 0 16px 0;text-align:left;">To get started, here's what I'll need from you:</p>
  <p style="margin:0 0 16px 0;text-align:left;">${hl("&rarr; 2-minute application")}</p>
  ${START_NOW_BTN}
  <p style="margin:0 0 8px 0;text-align:left;"><strong>SBA:</strong></p>
  <ul ${ulStyle}>
    <li ${liStyle}>Last 2 years of business tax returns</li>
    <li ${liStyle}>Last 3 months of business bank statements</li>
    <li ${liStyle}>Business debt schedule (if any existing loans)</li>
    <li ${liStyle}>2025 P&amp;L if taxes haven't been filed</li>
  </ul>
  <p style="margin:0 0 8px 0;text-align:left;"><strong>Equipment Financing:</strong></p>
  <ul ${ulStyle}>
    <li ${liStyle}>Invoice or quote for the equipment</li>
    <li ${liStyle}>Last 3 months of business bank statements</li>
  </ul>
  <p style="margin:0 0 16px 0;text-align:left;">Feel free to send these over whenever you're ready, even if it's piece by piece.</p>
  <p style="margin:0 0 24px 0;text-align:left;">Best regards,</p>
</div>
${SIG_S}`,
  },

  // ── Equipment Financing (equipment-only path) ───────────────────────────────
  "equipment-financing": {
    subject: "Business Funding (Equipment Financing)",
    html: `${WRAP_OPEN}
  <p style="margin:0 0 24px 0;text-align:left;font-size:16px;">Hi {{firstName}},</p>
  <p style="margin:0 0 16px 0;text-align:left;">It was a pleasure speaking with you today.</p>
  <p style="margin:0 0 16px 0;text-align:left;">As we discussed, given your credit profile and time in business, you're in a great position to explore a solid funding path:</p>
  <p style="margin:0 0 16px 0;text-align:left;"><strong>- Equipment Financing is ideal (avg 6-12% interest rates).</strong></p>
  <p style="margin:0 0 16px 0;text-align:left;">To get started, here's what I'll need from you:</p>
  <p style="margin:0 0 16px 0;text-align:left;">${hl("&rarr; 2-minute application")}</p>
  ${START_NOW_BTN}
  <p style="margin:0 0 8px 0;text-align:left;"><strong>Equipment Financing:</strong></p>
  <p style="margin:0 0 8px 0;text-align:left;">${hl("- Invoice or quote for the equipment")}</p>
  <p style="margin:0 0 20px 0;text-align:left;">${hl("- Last 3 months of business bank statements")}</p>
  <p style="margin:0 0 16px 0;text-align:left;">Feel free to send these over whenever you're ready, even if it's piece by piece.</p>
  <p style="margin:0 0 16px 0;text-align:left;">The sooner we have the docs, the sooner I can get you real numbers to work with.</p>
  <p style="margin:0 0 16px 0;text-align:left;">Don't hesitate to reach out with any questions in the meantime.</p>
  <p style="margin:0 0 24px 0;text-align:left;">Best regards,</p>
</div>
${SIG_S}`,
  },

  // ── 4. SBA (Español) ────────────────────────────────────────────────────────
  "sba-es": {
    subject: "Opciones de Préstamo SBA (Documentos Requeridos)",
    html: `${WRAP_OPEN}
  <p style="margin:0 0 24px 0;text-align:left;font-size:16px;">Un placer hablar contigo,</p>
  <p style="margin:0 0 16px 0;text-align:left;">Según lo que compartiste, tu negocio podría ser un excelente candidato para un préstamo <strong>SBA 7(a)</strong>, el cual ofrece tasas y condiciones significativamente mejores que las opciones de capital de trabajo.</p>
  <p style="margin:0 0 16px 0;text-align:left;">Para poner en marcha tu solicitud, necesito lo siguiente:</p>
  <p style="margin:0 0 12px 0;text-align:left;"><strong>DOCUMENTOS NECESARIOS:</strong> <a href="${PORTAL_URL}">(haz clic aquí para enviar los 4 en nuestro portal)</a></p>
  <ol ${olStyle}>
    <li ${liStyle}>Declaraciones de impuestos comerciales de los últimos 2 años (sin redactar)</li>
    <li ${liStyle}>Estados de cuenta bancarios de los últimos 3 meses</li>
    <li ${liStyle}>Calendario de deudas (lista de todos los préstamos/obligaciones comerciales actuales, y puedo ayudarte a elaborarlo dentro de nuestro portal)</li>
  </ol>
  <p style="margin:0 0 16px 0;text-align:left;">Si no presentaste tu declaración del período fiscal más reciente, por favor envía el comprobante de prórroga + la declaración del año anterior.</p>
  <p style="margin:0 0 16px 0;text-align:left;">Puedes responder a este correo con los documentos adjuntos.</p>
  <p style="margin:0 0 16px 0;text-align:left;">Una vez que tenga todo, enviaré tu solicitud y te mantendré informado en cada paso del proceso.</p>
  <p style="margin:0 0 16px 0;text-align:left;">El proceso del SBA tarda un poco más que un adelanto rápido de capital de trabajo, pero las condiciones valen la pena: tasas más bajas, plazos más largos y sin retiros diarios/semanales de tu cuenta.</p>
  <p style="margin:0 0 24px 0;text-align:left;">Saludos cordiales,</p>
</div>
${SIG_S}`,
  },

  // ── 5. About Us ─────────────────────────────────────────────────────────────
  "about-us": {
    subject: "Here's a Little More About Us",
    html: `${WRAP_OPEN}
  <p style="margin:0 0 16px 0;text-align:left;">We would like to share more about who we are and how we operate; we're a little different from what most people expect.</p>
  <p style="margin:0 0 16px 0;text-align:left;">We're not a big corporate broker.<br>We work more like a funding consulting partner.<br>That means when you come to us with a goal, whether it's equipment, expansion, cash flow, or anything else.</p>
  <p style="margin:0 0 16px 0;text-align:left;">We go out and find the best rates, the best terms, and the right program for that specific purpose.</p>
  <p style="margin:0 0 16px 0;text-align:left;">You'd have someone in your corner ${hl("who understands your full picture")} and helps you structure it strategically.</p>
  <p style="margin:0 0 16px 0;text-align:left;"><strong>We're also AI-integrated with credit repair options &amp; strategic planning, which helps us move faster and smarter than a traditional brokerage, and position you in better shape for your Long Term plans.</strong></p>
  <p style="margin:0 0 16px 0;text-align:left;">Our primary offices are in Tampa (currently expanding a new location in NC).</p>
  <p style="margin:0 0 16px 0;text-align:left;">At the end of the day, we're looking to build long-term relationships with our clients, not just close a deal and move on.</p>
  <p style="margin:0 0 24px 0;text-align:left;">Best Regards,</p>
</div>
${SIG_S}`,
  },

  // ── 6. Commercial Construction (SBA 504) ────────────────────────────────────
  "commercial-construction": {
    subject: "Commercial Construction Financing (Next Steps)",
    html: `${WRAP_OPEN}
  <p style="margin:0 0 24px 0;text-align:left;font-size:16px;">Nice speaking with you,</p>
  <p style="margin:0 0 16px 0;text-align:left;">Based on what you shared, it sounds like your business may be a strong fit for an <strong>SBA 504 loan</strong>, which offers significantly better rates and terms than working capital options.</p>
  <p style="margin:0 0 16px 0;text-align:left;">To get your application moving, I need:</p>
  <p style="margin:0 0 12px 0;text-align:left;"><strong>DOCUMENTS NEEDED:</strong> <a href="${PORTAL_URL}">(click here to submit all 4 in our portal)</a></p>
  <ol ${olStyle}>
    <li ${liStyle}>Business funding application</li>
    <li ${liStyle}>Last 2 years of business tax returns (unredacted)</li>
    <li ${liStyle}>Last 3 months of business bank statements</li>
    <li ${liStyle}>Debt schedule (list of all current business loans/obligations, and I can help you build this inside our portal)</li>
  </ol>
  <p style="margin:0 0 8px 0;text-align:left;"><strong>Pending docs for bank pre-qualification:</strong></p>
  <ul ${ulStyle}>
    <li ${liStyle}>Deed or title showing land ownership</li>
    <li ${liStyle}>Official building plans</li>
  </ul>
  <p style="margin:0 0 16px 0;text-align:left;">If you didn't file for the most recent tax period, please send proof of extension + the prior year's return.</p>
  <p style="margin:0 0 16px 0;text-align:left;">You can reply to this email with the documents attached.</p>
  <p style="margin:0 0 16px 0;text-align:left;">Once I have everything, I'll get your application submitted and keep you posted every step of the way.</p>
  <p style="margin:0 0 24px 0;text-align:left;">The SBA process takes a bit longer than a quick working capital advance, but the terms are worth it: lower rates, longer repayment, and no daily/weekly pulls on your account.</p>
</div>
${SIG_S}`,
  },

  // ── 7. HELOC — Documents Needed ─────────────────────────────────────────────
  "heloc": {
    subject: "(HELOC) Next Steps for Your Business Funding - Documents Needed",
    html: `${WRAP_OPEN}
  <p style="margin:0 0 24px 0;text-align:left;font-size:16px;">Nice speaking with you.</p>
  <p style="margin:0 0 16px 0;text-align:left;">Based on what you shared, it sounds like a <strong>HELOC (Home Equity Line of Credit)</strong> could be a strong fit, with flexible access to capital using the equity you've already built and much better rates than most business funding options.</p>
  <p style="margin:0 0 12px 0;text-align:left;"><strong>DOCUMENTS NEEDED:</strong> <a href="${PORTAL_URL}">(click here to submit all 4 in our portal)</a></p>
  <ol ${olStyle}>
    <li ${liStyle}>Most recent mortgage statement</li>
    <li ${liStyle}>Last 2 years of tax returns (unredacted)</li>
    <li ${liStyle}>Last 3 months of business bank statements</li>
    <li ${liStyle}>Government-issued ID</li>
  </ol>
  <p style="margin:0 0 8px 0;text-align:left;"><strong>(if available)</strong></p>
  <ul ${ulStyle}>
    <li ${liStyle}>Deed or title showing property ownership</li>
    <li ${liStyle}>Recent property appraisal or tax assessment</li>
  </ul>
  <p style="margin:0 0 16px 0;text-align:left;">You can reply to this email with everything attached.</p>
  <p style="margin:0 0 16px 0;text-align:left;">Once I have the docs, I'll get your application submitted and keep you posted every step of the way.</p>
  <p style="margin:0 0 16px 0;text-align:left;">Happy to jump on a quick call if you have questions.</p>
  <p style="margin:0 0 24px 0;text-align:left;">Talk soon.</p>
</div>
${SIG_S}`,
  },

  // ── 8. Scaling Revenue Together (AI custom intro) ───────────────────────────
  // {{customLine}} is the AI-generated / edited line from the dialer box.
  "scaling-intro": {
    subject: "Scaling Revenue Together (Business Funding)",
    html: `${WRAP_OPEN}
  <p style="margin:0 0 24px 0;text-align:left;font-size:16px;">Hello {{firstName}},</p>
  <p style="margin:0 0 16px 0;text-align:left;">We saw your inquiry come through,</p>
  <p style="margin:0 0 16px 0;text-align:left;">To get you pre-qualified we just need you to complete:</p>
  <p style="margin:0 0 10px 0;text-align:left;">${hl("- Our 2-minute application")}</p>
  <p style="margin:0 0 20px 0;text-align:left;">${hl("- Last 3 months of business bank statements")}</p>
  <p style="margin:0 0 16px 0;text-align:left;">{{customLine}}</p>
  <p style="margin:0 0 16px 0;text-align:left;">Feel free to call me if you have any questions.</p>
  <p style="margin:0 0 24px 0;text-align:left;">Kind regards,</p>
</div>
${SIG_S}`,
  },

  // ── Decline / "Update on Your Funding Application" ───────────────────────────
  // {{customLine}} is the decline reason typed in the dialer box per lead
  // (e.g. "time in business and low cashflow"). It renders bold in the sentence.
  "decline": {
    subject: "Update on Your Funding Application",
    html: `${WRAP_OPEN}
  <p style="margin:0 0 16px 0;text-align:left;">Hi {{firstName}},</p>
  <p style="margin:0 0 16px 0;text-align:left;">Thank you for submitting your application and taking the time to go through our review process.</p>
  <p style="margin:0 0 16px 0;text-align:left;">After reviewing your file, we are unable to move forward at this time due to <strong>{{customLine}}</strong>.</p>
  <p style="margin:0 0 16px 0;text-align:left;">If your situation changes or you'd like to explore options down the road, don't hesitate to reach out,</p>
  <p style="margin:0 0 16px 0;text-align:left;">We're happy to take another look.</p>
  <p style="margin:0 0 24px 0;text-align:left;">Best regards,</p>
</div>
${SIG_S}`,
  },
};

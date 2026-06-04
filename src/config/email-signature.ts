/**
 * Public HTTPS URL for the SRT logo shown in email signatures. Gmail (and most
 * webmail) strip embedded `data:` image URIs, so the logo must be hosted. Served
 * from the Next.js public/ folder (public/srt-logo.png).
 */
export const SRT_LOGO_URL = "https://mission.srtagency.com/srt-logo.png";

/**
 * Default email signature for outgoing emails from Mission Control.
 * Based on the SRT Agency HTML signature template.
 */
export const EMAIL_SIGNATURE_HTML = `
<table cellpadding="0" cellspacing="0" border="0" style="font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #333333;">
  <tr>
    <td style="padding-bottom: 1px;">
      <span style="font-size: 16px; font-weight: 700; color: #e8792b;">Matthew Gabriel</span>
    </td>
  </tr>
  <tr>
    <td style="padding-bottom: 10px;">
      <span style="font-size: 12px; color: #666666;">Senior Capital Specialist</span>
    </td>
  </tr>
  <tr>
    <td style="padding-bottom: 10px;">
      <table cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="vertical-align: middle; padding-right: 8px;">
            <img src="${SRT_LOGO_URL}" width="28" height="30" alt="SRT Agency" style="display: block; border: 0;" />
          </td>
          <td style="vertical-align: middle;">
            <span style="font-size: 14px; font-weight: 700; color: #0d1b2a; line-height: 1;">Scaling Revenue Together</span>
          </td>
        </tr>
      </table>
    </td>
  </tr>
  <tr>
    <td style="padding-bottom: 10px;">
      <span style="font-size: 12px; color: #666666;">T: </span><a href="tel:+17862822937" style="font-size: 12px; color: #333333; text-decoration: none;">(786) 282-2937</a><span style="font-size: 12px; color: #cccccc;"> | </span><span style="font-size: 12px; color: #666666;">F: </span><span style="font-size: 12px; color: #333333;">(252) 556-1444</span>
    </td>
  </tr>
  <tr>
    <td style="padding-bottom: 14px;">
      <table cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="background: #2ee6a8; border-radius: 5px; padding: 10px 24px;">
            <a href="https://srtagency.com/apply" style="color: #0d1b2a; text-decoration: none; font-size: 13px; font-weight: 700; letter-spacing: 1px;">Apply Now &#8594;</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
  <tr>
    <td>
      <p style="font-size: 8px; color: #aaaaaa; line-height: 1.4; margin: 0; max-width: 500px;"><span style="font-weight: 700; color: #888888;">CONFIDENTIALITY NOTICE:</span> This e-mail and any files or previous e-mail messages attached to it, may contain proprietary and confidential information. If you are not an intended recipient, you are hereby notified that any disclosure or use of this information obtained is STRICTLY PROHIBITED. If you have received this email in error, please notify us by replying to the sender of the e-mail and destroy the original transmission and its attachments without reading them or saving them. Thank you.</p>
    </td>
  </tr>
</table>
`.trim();

/**
 * Wraps a plain-text or HTML message body with the email signature.
 * Converts plain text to HTML paragraphs if needed.
 */
export function wrapWithSignature(body: string, isHtml = false): string {
  const htmlBody = isHtml
    ? body
    : body
        .split("\n")
        .map((line) => (line.trim() === "" ? "<br>" : `<p style="margin:0 0 8px 0;">${escapeHtml(line)}</p>`))
        .join("");

  return `${htmlBody}<br><br>${EMAIL_SIGNATURE_HTML}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The Outlook "S" signature (Matthew Garcia / Senior Capital Strategist),
 * captured once from a real OWA-composed message and stored server-side.
 *
 * Microsoft Graph does NOT expose Outlook roaming signatures, so the dialer's
 * signature_name:"S" emails resolve their signature from this constant — see
 * buildHtmlBody() in src/lib/ai-intel/execute-action.ts. An env var
 * SIGNATURE_S_HTML overrides this at runtime if set.
 *
 * The captured HTML referenced the logo via `cid:` (an inline attachment Outlook
 * adds at send time). We send via Graph without that attachment, so the logo is
 * referenced via the hosted SRT_LOGO_URL instead.
 */
export const SIGNATURE_S_HTML = `
<div style="font-family:Arial,Helvetica,sans-serif;">
  <table cellspacing="0" cellpadding="0" border="0" style="text-align:left; color:rgb(51,51,51);">
    <tbody>
      <tr>
        <td style="text-align:left; padding-bottom:1px;">
          <div style="font-family:Arial,Helvetica,sans-serif; font-size:16px; color:rgb(232,121,43);"><span style="font-weight:700;">Matthew Garcia</span></div>
        </td>
      </tr>
      <tr>
        <td style="text-align:left; padding-bottom:10px;">
          <div style="font-family:Arial,Helvetica,sans-serif; font-size:12px; color:rgb(102,102,102);">Senior Capital Strategist</div>
        </td>
      </tr>
      <tr>
        <td style="text-align:left; padding-bottom:10px;">
          <table cellspacing="0" cellpadding="0" border="0" style="text-align:left;">
            <tbody>
              <tr>
                <td style="padding-right:8px; vertical-align:middle;">
                  <img alt="SRT Agency" width="28" height="30" src="${SRT_LOGO_URL}" style="width:28px; height:30px; display:block; border:0;" />
                </td>
                <td style="vertical-align:middle;">
                  <div style="font-family:Arial,Helvetica,sans-serif; font-size:14px; color:rgb(13,27,42);"><span style="line-height:1; font-weight:700;">Scaling Revenue Together</span></div>
                </td>
              </tr>
            </tbody>
          </table>
        </td>
      </tr>
      <tr>
        <td style="text-align:left; padding-bottom:10px;">
          <div style="font-family:Arial,Helvetica,sans-serif; font-size:12px;"><span style="color:rgb(102,102,102);">T: </span><span style="color:rgb(51,51,51);">(786) 282-2937</span><span style="color:rgb(204,204,204);">&nbsp;| </span><span style="color:rgb(102,102,102);">F: </span><span style="color:rgb(51,51,51);">(252) 556-1444</span></div>
        </td>
      </tr>
      <tr>
        <td style="text-align:left; padding-bottom:14px;">
          <table cellspacing="0" cellpadding="0" border="0" style="text-align:left;">
            <tbody>
              <tr>
                <td style="border-radius:5px; background-color:rgb(46,230,168); padding:10px 24px;">
                  <div style="font-family:Arial,Helvetica,sans-serif; font-size:13px; color:rgb(13,27,42);"><span style="letter-spacing:1px; font-weight:700;"><a href="https://srtagency.com/capital" style="color:rgb(13,27,42); text-decoration:none;">Start Now&nbsp;&#8594;</a></span></div>
                </td>
              </tr>
            </tbody>
          </table>
        </td>
      </tr>
    </tbody>
  </table>
  <table cellspacing="0" cellpadding="0" border="0" style="text-align:left; color:rgb(51,51,51);">
    <tbody>
      <tr>
        <td style="text-align:left;">
          <p style="line-height:1.4; margin:0; max-width:500px; font-size:8px; color:rgb(170,170,170); font-family:Arial,Helvetica,sans-serif;"><span style="color:rgb(136,136,136); font-weight:700;">CONFIDENTIALITY NOTICE:</span>&nbsp;This e-mail and any files or previous e-mail messages attached to it, may contain proprietary and confidential information. If you are not an intended recipient, you are hereby notified that any disclosure or use of this information obtained is STRICTLY PROHIBITED. If you have received this email in error, please notify us by replying to the sender of the e-mail and destroy the original transmission and its attachments without reading them or saving them. Thank you.</p>
        </td>
      </tr>
    </tbody>
  </table>
</div>
`.trim();

/**
 * "Submission" signature — used on emails that go out FROM submissions@srtagency.com
 * to funders (the verbatim deal forward and the AI-drafted funder replies).
 *
 * Graph does NOT expose Outlook roaming signatures, so this is resolved as a
 * server-side constant the same way SIGNATURE_S_HTML is. The env var
 * SIGNATURE_SUBMISSION_HTML overrides it at runtime — paste the captured HTML
 * there (or replace the placeholder below) once Matthew sends the model email and
 * we extract it via microsoft.getLatestHtmlBySubject().
 *
 * Until the real signature is captured, this is a minimal SRT Submissions block so
 * funders still get a branded sign-off instead of falling back to the personal sig.
 */
export const SIGNATURE_SUBMISSION_HTML = `
<div style="font-family:Arial,Helvetica,sans-serif;">
  <table cellspacing="0" cellpadding="0" border="0" style="text-align:left; color:rgb(51,51,51);">
    <tbody>
      <tr>
        <td style="text-align:left; padding-bottom:1px;">
          <div style="font-family:Arial,Helvetica,sans-serif; font-size:16px; color:rgb(232,121,43);"><span style="font-weight:700;">SRT Submissions</span></div>
        </td>
      </tr>
      <tr>
        <td style="text-align:left; padding-bottom:10px;">
          <div style="font-family:Arial,Helvetica,sans-serif; font-size:12px; color:rgb(102,102,102);">Submissions Desk · SRT Agency</div>
        </td>
      </tr>
      <tr>
        <td style="text-align:left; padding-bottom:10px;">
          <table cellspacing="0" cellpadding="0" border="0" style="text-align:left;">
            <tbody>
              <tr>
                <td style="padding-right:8px; vertical-align:middle;">
                  <img alt="SRT Agency" width="28" height="30" src="${SRT_LOGO_URL}" style="width:28px; height:30px; display:block; border:0;" />
                </td>
                <td style="vertical-align:middle;">
                  <div style="font-family:Arial,Helvetica,sans-serif; font-size:14px; color:rgb(13,27,42);"><span style="line-height:1; font-weight:700;">Scaling Revenue Together</span></div>
                </td>
              </tr>
            </tbody>
          </table>
        </td>
      </tr>
      <tr>
        <td style="text-align:left; padding-bottom:10px;">
          <div style="font-family:Arial,Helvetica,sans-serif; font-size:12px;"><span style="color:rgb(102,102,102);">E: </span><a href="mailto:submissions@srtagency.com" style="color:rgb(51,51,51); text-decoration:none;">submissions@srtagency.com</a></div>
        </td>
      </tr>
    </tbody>
  </table>
  <table cellspacing="0" cellpadding="0" border="0" style="text-align:left; color:rgb(51,51,51);">
    <tbody>
      <tr>
        <td style="text-align:left;">
          <p style="line-height:1.4; margin:0; max-width:500px; font-size:8px; color:rgb(170,170,170); font-family:Arial,Helvetica,sans-serif;"><span style="color:rgb(136,136,136); font-weight:700;">CONFIDENTIALITY NOTICE:</span>&nbsp;This e-mail and any files or previous e-mail messages attached to it, may contain proprietary and confidential information. If you are not an intended recipient, you are hereby notified that any disclosure or use of this information obtained is STRICTLY PROHIBITED. If you have received this email in error, please notify us by replying to the sender of the e-mail and destroy the original transmission and its attachments without reading them or saving them. Thank you.</p>
        </td>
      </tr>
    </tbody>
  </table>
</div>
`.trim();

/**
 * Resolves the Submissions signature HTML, preferring the runtime env override.
 */
export function resolveSubmissionSignature(): string {
  return process.env.SIGNATURE_SUBMISSION_HTML || SIGNATURE_SUBMISSION_HTML;
}

export interface SignatureParams {
  name: string;
  title: string;
  phone: string;
  fax?: string;
}

/**
 * Generates an HTML email signature for SRT Agency with the given parameters.
 * Uses the same branding as EMAIL_SIGNATURE_HTML (orange name, green CTA, logo).
 */
export function generateSignatureHtml(params: SignatureParams): string {
  const { name, title, phone, fax } = params;
  const phoneLine = fax
    ? `<span style="font-size: 12px; color: #666666;">T: </span><a href="tel:${phone.replace(/\D/g, "")}" style="font-size: 12px; color: #333333; text-decoration: none;">${phone}</a><span style="font-size: 12px; color: #cccccc;"> | </span><span style="font-size: 12px; color: #666666;">F: </span><span style="font-size: 12px; color: #333333;">${fax}</span>`
    : `<span style="font-size: 12px; color: #666666;">T: </span><a href="tel:${phone.replace(/\D/g, "")}" style="font-size: 12px; color: #333333; text-decoration: none;">${phone}</a>`;

  return `<table cellpadding="0" cellspacing="0" border="0" style="font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #333333;">
  <tr>
    <td style="padding-bottom: 1px;">
      <span style="font-size: 16px; font-weight: 700; color: #e8792b;">${escapeHtml(name)}</span>
    </td>
  </tr>
  <tr>
    <td style="padding-bottom: 10px;">
      <span style="font-size: 12px; color: #666666;">${escapeHtml(title)}</span>
    </td>
  </tr>
  <tr>
    <td style="padding-bottom: 10px;">
      <table cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="vertical-align: middle; padding-right: 8px;">
            <img src="${SRT_LOGO_URL}" width="28" height="30" alt="SRT Agency" style="display: block; border: 0;" />
          </td>
          <td style="vertical-align: middle;">
            <span style="font-size: 14px; font-weight: 700; color: #0d1b2a; line-height: 1;">Scaling Revenue Together</span>
          </td>
        </tr>
      </table>
    </td>
  </tr>
  <tr>
    <td style="padding-bottom: 10px;">
      ${phoneLine}
    </td>
  </tr>
  <tr>
    <td style="padding-bottom: 14px;">
      <table cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="background: #2ee6a8; border-radius: 5px; padding: 10px 24px;">
            <a href="https://srtagency.com/apply" style="color: #0d1b2a; text-decoration: none; font-size: 13px; font-weight: 700; letter-spacing: 1px;">Apply Now &#8594;</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
  <tr>
    <td>
      <p style="font-size: 8px; color: #aaaaaa; line-height: 1.4; margin: 0; max-width: 500px;"><span style="font-weight: 700; color: #888888;">CONFIDENTIALITY NOTICE:</span> This e-mail and any files or previous e-mail messages attached to it, may contain proprietary and confidential information. If you are not an intended recipient, you are hereby notified that any disclosure or use of this information obtained is STRICTLY PROHIBITED. If you have received this email in error, please notify us by replying to the sender of the e-mail and destroy the original transmission and its attachments without reading them or saving them. Thank you.</p>
    </td>
  </tr>
</table>`;
}

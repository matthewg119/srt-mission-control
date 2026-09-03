// The two emails a signature sends. Both carry the PDF.
//
// ‼️ TWO SEPARATE CALLS, NOT ONE WITH A CC, AND FOR TWO REASONS. One failing must not cost the
// other, and the two messages want completely different words: one is a receipt for a client,
// the other is an internal handover. A cc would force one body to do both jobs badly.
//
// ‼️ NEITHER THROWS. Each returns a boolean and the Slack card prints which way both went, the
// same convention bookedCard uses over in /chatgpt-ads. A signature that is already committed
// must never be reported as failed because a mail server was slow.
//
// ‼️ NO fromMailbox, WHICH MEANS THIS SENDS AS THE CONNECTED ACCOUNT, matthew@srtagency.com.
// There is no Resend and no third-party email service in this stack, and there is deliberately
// no SMS on this funnel.
//
// ‼️ DO NOT ROUTE THIS THROUGH chooseOutreachMailbox. Those daily caps exist to pace cold
// outreach. A signed contract is transactional and must always send.
//
// One consequence worth knowing about rather than discovering: sent-sweep.ts reads matthew@'s
// Sent Items and will see both of these, enrolling the signer as an outreach_prospects row with
// confirmed = false. Nothing is scheduled or drafted for an unconfirmed prospect, so it is noise
// rather than damage, but it is noise nobody would expect.

import { microsoft } from "@/lib/microsoft";
import { publicUrl } from "./constants";
import type { Onboarding2SigningRow } from "./types";

const FILENAME = "SRT-Onboarding-Agreement.pdf";

function attachment(pdf: Buffer) {
  return [
    {
      name: FILENAME,
      contentType: "application/pdf",
      contentBytes: pdf.toString("base64"),
    },
  ];
}

/** The client's receipt. Plain text, because a contract copy is not a marketing email. */
export async function sendSignerCopy(args: {
  row: Onboarding2SigningRow;
  pdf: Buffer;
  onboardingUrl: string | null;
  documentUrl: string;
}): Promise<boolean> {
  const to = args.row.contact_email || args.row.email;
  if (!to) return false;

  const name = args.row.print_name?.split(" ")[0] || "there";
  const lines = [
    `Hi ${name},`,
    "",
    "Your signed onboarding agreement is attached. It is exactly the document you read, word for word, with your initials and signature on it.",
    "",
    "What happens now:",
    "",
    "1. We start on your AI visibility straight away.",
    "2. We will ask you for access to your Google Business Profile and your website. Section 4 of the agreement lists everything.",
    "3. You owe nothing until ChatGPT has sent you 5 new qualified appointments.",
    "",
  ];

  if (args.onboardingUrl) {
    lines.push(
      "When you have a few minutes, this link picks up where the agreement left off and collects the access details we need. Everything you already typed is filled in:",
      "",
      args.onboardingUrl,
      ""
    );
  }

  lines.push(
    "You can download your copy again here at any time:",
    "",
    args.documentUrl,
    "",
    "Any questions, reply to this email or text me on 336-833-2303.",
    "",
    "Matthew Garcia",
    "SRT Agency LLC",
    publicUrl()
  );

  try {
    await microsoft.sendMail({
      to,
      subject: "Your signed SRT onboarding agreement",
      body: lines.join("\n"),
      isHtml: false,
      attachments: attachment(args.pdf),
    });
    return true;
  } catch (e) {
    console.error("[onboarding2/email] signer copy failed:", (e as Error).message);
    return false;
  }
}

/** The internal handover copy. Same PDF, different job. */
export async function sendSrtCopy(args: {
  row: Onboarding2SigningRow;
  pdf: Buffer;
  clientId: string | null;
  onboardingUrl: string | null;
  provisionError: string | null;
}): Promise<boolean> {
  const to = process.env.ONBOARDING2_INTERNAL_EMAIL || "matthew@srtagency.com";

  const lines = [
    `${args.row.business_legal_name || "A business"} signed the onboarding agreement.`,
    "",
    `Signed by:    ${args.row.print_name || "not given"}${args.row.signer_title ? `, ${args.row.signer_title}` : ""}`,
    `Business:     ${args.row.business_legal_name || "not given"}`,
    `Email:        ${args.row.contact_email || args.row.email || "not given"}`,
    `Phone:        ${args.row.contact_phone_typed || args.row.contact_phone || "not given"}`,
    `Signed at:    ${args.row.signed_at || "not recorded"}`,
    `Template:     ${args.row.template_version}`,
    `Agreement:    ${args.row.agreement_sha256}`,
    `Signing id:   ${args.row.id}`,
    "",
  ];

  if (args.provisionError) {
    lines.push(
      "PROVISIONING DID NOT COMPLETE.",
      args.provisionError,
      "The signature is valid and stored. There is no client row behind it yet.",
      ""
    );
  } else {
    lines.push(`Client id:    ${args.clientId ?? "not created"}`);
    lines.push(`Intake link:  ${args.onboardingUrl ?? "none could be minted"}`);
    lines.push("");
  }

  try {
    await microsoft.sendMail({
      to,
      subject: `Signed: ${args.row.business_legal_name || args.row.email || "onboarding agreement"}`,
      body: lines.join("\n"),
      isHtml: false,
      attachments: attachment(args.pdf),
    });
    return true;
  } catch (e) {
    console.error("[onboarding2/email] internal copy failed:", (e as Error).message);
    return false;
  }
}

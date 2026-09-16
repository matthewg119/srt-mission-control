// The two ways a contract leaves this building, sharing one implementation.
//
// Matthew's ask, 2026-09-16: on the onboarding call he wants either a draft sitting in his own
// inbox to look over and send, or a link the client signs while he is still on the phone. Both
// buttons appear on the `agreement_signed` step card and on the client board, and they both come
// through here so the two surfaces cannot drift into meaning different things.
//
// ‼️ MINTING A LINK FREEZES AN AGREEMENT, SO IT IS THE ONE PLACE OUTSIDE POST /start THAT MAY
// CALL buildSnapshot(). That is a real widening of a rule the codebase has held carefully, and
// the reason it is safe is that the frozen document is pinned to a CLIENT rather than to a
// browser session: the offer comes off clients.offer_key, and the row is created here rather than
// by whoever opens the URL. Nothing downstream re-freezes. /sign/[token] reads the snapshot and
// never builds one, and its header says so.
//
// ‼️ A SECOND LINK SUPERSEDES THE FIRST AND DOES NOT INVALIDATE IT. mintSigningLink() creates a
// NEW row every time it is called, because a corrected company name means a different document
// and the old one must stay readable exactly as it was. What stops two signatures is that each
// link carries its own session token and /sign claims on `signed_at is null` for that row alone.
// If two links are sent and both are signed, that is two executed contracts and somebody has to
// look at it, which is the honest outcome rather than one silently winning.

import { supabaseAdmin } from "@/lib/db";
import { microsoft } from "@/lib/microsoft";
import { buildSnapshot } from "@/lib/onboarding2/snapshot";
import { mintSessionToken } from "@/lib/onboarding2/session";
import { appUrl } from "@/lib/onboarding2/constants";
import { renderAgreementPdf, type SignedRecord } from "@/lib/onboarding2/agreement-pdf";
import { isOfferKey, offerFor, type OfferKey } from "@/config/pitch";

export interface ClientForAgreement {
  id: string;
  legal_name: string | null;
  dba_name: string | null;
  email: string | null;
  phone: string | null;
  domain: string | null;
  offer_key: string | null;
  /**
   * The person who signs, resolved from `contacts` by email.
   *
   * ‼️ IT IS NOT A COLUMN ON `clients` AND THERE IS NO POINT LOOKING FOR ONE. That table carries
   * the BUSINESS: legal_name, dba_name, domain, the address and the market centre. A human being
   * with a first and last name lives in `contacts`, joined on email, which is the same route
   * contactIdFor() in onboarding2/provision.ts takes.
   */
  signerName: string | null;
}

const COLUMNS = "id, legal_name, dba_name, email, phone, domain, offer_key";

export async function loadClientForAgreement(
  clientId: string
): Promise<ClientForAgreement | null> {
  const { data, error } = await supabaseAdmin
    .from("clients")
    .select(COLUMNS)
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw new Error(`[send-agreement] client lookup failed: ${error.message}`);
  if (!data) return null;

  const client = data as Omit<ClientForAgreement, "signerName">;

  // ‼️ A MISSING CONTACT IS NOT A FAILURE. The name is used for the greeting and to seed the
  // initials box, and a contract with no print_name is still a valid contract: the signer types
  // their signature themselves. Throwing here would refuse to send an agreement over a greeting.
  let signerName: string | null = null;
  if (client.email) {
    const { data: contact } = await supabaseAdmin
      .from("contacts")
      .select("first_name, last_name")
      .ilike("email", client.email)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (contact) {
      const parts = [contact.first_name, contact.last_name].filter(Boolean);
      signerName = parts.length ? parts.join(" ") : null;
    }
  }

  return { ...client, signerName };
}

/**
 * Which document this client signs.
 *
 * ‼️ NULL IS REFUSED RATHER THAN DEFAULTED, AND THIS IS THE WHOLE REASON THE COLUMN EXISTS. A
 * client with no offer is one who came through before the split, or one provisioned by hand. In
 * both cases nobody knows what they were sold, and picking a document for them would put a
 * guarantee and a refund in front of somebody who may have been quoted neither. The card says so
 * and asks Matthew to set the offer first.
 */
export function offerOfClient(client: ClientForAgreement): OfferKey | null {
  return isOfferKey(client.offer_key) ? client.offer_key : null;
}

export interface MintResult {
  ok: boolean;
  url: string | null;
  signingId: string | null;
  offer: OfferKey | null;
  templateVersion: string | null;
  error: string | null;
}

/**
 * Create a signing row for this client and return the URL they open.
 *
 * The identity is copied ONTO the row here, which is what lets /sign/[token] show a read-only
 * recap and lets POST /api/onboarding2/sign refuse to take identity from the request body. A
 * signer never types the party they are being bound to.
 */
export async function mintSigningLink(clientId: string): Promise<MintResult> {
  const empty: MintResult = {
    ok: false,
    url: null,
    signingId: null,
    offer: null,
    templateVersion: null,
    error: null,
  };

  const client = await loadClientForAgreement(clientId);
  if (!client) return { ...empty, error: "No client with that id." };

  const offer = offerOfClient(client);
  if (!offer) {
    return {
      ...empty,
      error:
        "This client has no offer recorded, so there is no way to know which agreement they signed up for. Set the offer on the client board first.",
    };
  }

  // ‼️ THE FREE PLAN HAS NOTHING TO SIGN AND SAYS SO RATHER THAN SENDING A BLANK PAGE. Its
  // snapshot is one page of service terms that exists to keep agreement_snapshot honest, and
  // nobody is ever shown it. A button that cheerfully minted a link to it would put a document in
  // front of a client who was told there was no contract.
  if (!offerFor(offer).needsAgreement) {
    return {
      ...empty,
      offer,
      error: `${offerFor(offer).name} has no agreement to sign. Nothing to send.`,
    };
  }

  const snapshot = await buildSnapshot(offer);
  const sessionToken = mintSessionToken();
  const name = client.signerName;

  const { data, error } = await supabaseAdmin
    .from("onboarding2_signings")
    .insert({
      session_token: sessionToken,
      status: "open",
      agreement_snapshot: snapshot,
      template_version: snapshot.version,
      agreement_sha256: snapshot.documentSha256,
      offer_key: offer,
      client_id: client.id,
      email: client.email,
      contact_email: client.email,
      contact_name: name,
      print_name: name,
      business_legal_name: client.legal_name || client.dba_name,
      website: client.domain,
      contact_phone: client.phone,
      contact_phone_typed: client.phone,
      // ‼️ NOT A DEMO. This row is minted by an authenticated operator against a real client, so
      // the host that happens to be serving Mission Control decides nothing. isDemoRequest() is
      // for a public funnel deciding whether a visitor's session is a rehearsal.
      is_demo: false,
    })
    .select("id")
    .maybeSingle();

  if (error || !data) {
    return { ...empty, offer, error: error?.message ?? "Could not create the signing row." };
  }

  return {
    ok: true,
    url: `${appUrl()}/sign/${sessionToken}`,
    signingId: data.id as string,
    offer,
    templateVersion: snapshot.version,
    error: null,
  };
}

export interface DraftResult {
  ok: boolean;
  webLink: string | null;
  offer: OfferKey | null;
  error: string | null;
}

/**
 * Put the agreement in Matthew's own Drafts folder, with the unsigned PDF attached and the
 * signing link in the body.
 *
 * ‼️ A DRAFT AND NOT A SEND, WHICH IS THE HOUSE RULE FOR EVERY OUTBOUND EMAIL IN THIS APP.
 * microsoft.ts's own header on createDraft says "stopping at the draft is the point: every
 * outbound email in this app is reviewed before it sends." A contract is the last thing that
 * should become the exception. The returned webLink opens it in Outlook Web, already addressed.
 *
 * ‼️ IT MINTS A LINK TOO, AND BOTH GO IN. The attachment is what a client forwards to their
 * lawyer; the link is what they sign. Sending the PDF alone would mean a second email later
 * carrying the thing that actually executes, which is the step that gets forgotten.
 */
export async function draftAgreementEmail(clientId: string): Promise<DraftResult> {
  const client = await loadClientForAgreement(clientId);
  if (!client) return { ok: false, webLink: null, offer: null, error: "No client with that id." };
  if (!client.email) {
    return { ok: false, webLink: null, offer: null, error: "This client has no email address." };
  }

  const minted = await mintSigningLink(clientId);
  if (!minted.ok || !minted.url || !minted.offer) {
    return { ok: false, webLink: null, offer: minted.offer, error: minted.error };
  }

  const offer = offerFor(minted.offer);
  const snapshot = await buildSnapshot(minted.offer);
  const firstName = client.signerName?.split(" ")[0] || "there";

  // The unsigned counterpart, the same one scripts/_render-agreement-blank.ts writes. `blank`
  // drops the signature record table and draws ruled lines, so what is attached reads as a
  // document to be signed rather than as a receipt for one that was.
  const blank: SignedRecord = {
    signatureTyped: "",
    printName: "",
    signerTitle: null,
    businessLegalName: client.legal_name || client.dba_name || "",
    address: "",
    contactEmail: client.email,
    contactPhoneTyped: null,
    signedDate: null,
    signedAt: null,
    initials: [],
    documentSha256: snapshot.documentSha256,
    templateVersion: snapshot.version,
    canon: snapshot.canon,
    ipHash: null,
    userAgent: null,
    signingId: minted.signingId ?? "",
  };
  const pdf = renderAgreementPdf(snapshot, blank, { blank: true });

  const body = [
    `<p>Hi ${escapeHtml(firstName)},</p>`,
    `<p>Great speaking with you. Here is the agreement for the ${escapeHtml(offer.name)} plan, exactly as we went through it.</p>`,
    `<p><strong>To sign it, open this link:</strong><br><a href="${minted.url}">${minted.url}</a></p>`,
    `<p>It takes about four minutes. You initial each page as you read it and sign at the end, and your copy is emailed to you the moment you do.</p>`,
    `<p>The same document is attached as a PDF if you would rather read it that way first, or send it to somebody else to look over.</p>`,
    `<p>Any questions at all, just reply to this.</p>`,
    `<p>Matthew Garcia<br>SRT Agency LLC</p>`,
  ].join("\n");

  try {
    const draft = await microsoft.createDraft({
      to: client.email,
      subject: `Your SRT agreement, ${offer.name}`,
      body,
      attachments: [
        {
          name: "SRT-Agreement.pdf",
          contentType: "application/pdf",
          contentBytes: pdf.toString("base64"),
        },
      ],
    });
    return { ok: true, webLink: draft.webLink, offer: minted.offer, error: null };
  } catch (e) {
    return { ok: false, webLink: null, offer: minted.offer, error: (e as Error).message };
  }
}

/**
 * ‼️ THE BODY IS HTML AND THE VALUES ARE A CLIENT'S OWN NAME, SO THEY ARE ESCAPED.
 * Not because a med spa owner is an attacker, but because an apostrophe in a business name is
 * common and an unescaped angle bracket silently eats the rest of the paragraph.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

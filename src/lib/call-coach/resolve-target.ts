// Turning "something on a screen" into a real CRM contact, with an honest confidence.
//
// The whole design here is about ONE failure: identifying the wrong lead. It is not a cosmetic
// error. A wrong identification grounds every live suggestion for the length of the call, and then
// the post-call wrap writes a note about that call onto the wrong company's record, where it
// stays. So there are three layers between a misread and damage, and they are deliberately
// redundant:
//
//   1. Nothing below `strong` auto-commits. Weak and ambiguous return CANDIDATES and the coach
//      shows a confirm strip. One click, and the failure disappears.
//   2. The brief's first line is the WHO line, naming business, person, phone and the record. A
//      misidentification then fails in the first five seconds instead of at minute forty.
//   3. The wrap re-reads the session row rather than re-deriving identity, and reprints that same
//      WHO line above the note. So a wrong note needs two missed confirmations, not one.
//
// Every rung goes through resolveLeadCandidates() in lib/crm.ts. That is the same ladder
// resolveLead() uses, so there is one place where "find the person behind this" is kept correct;
// this file only decides how much to TRUST each answer.

import { resolveLeadCandidates, type LeadRef, type ResolveRung } from "@/lib/crm";
import { companiesConflict } from "@/lib/company-identity";
import { parseRecordUrl, crmRecordUrl, type RecordRef } from "./record-url";
import { readFromUntrustedRegion, type VisionRead } from "./identify-lead";

export type TargetConfidence = "exact" | "strong" | "weak" | "ambiguous" | "none";

export interface CallTarget {
  /** contacts.id. The identity. */
  contactId: string;
  businessName: string | null;
  personName: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  confidence: TargetConfidence;
  source: "tab_url" | "vision_url" | "vision_email" | "vision_phone" | "vision_name" | "dialer" | "manual";
  crmUrl: string;
  /** Legacy. Kept for the extension wire format and for sessions written before the cutover. */
  zohoLeadId: string | null;
}

export interface ResolveResult {
  chosen: CallTarget | null;
  /** Shown as a 1/2/3 confirm strip when nothing auto-commits. */
  candidates: CallTarget[];
  confidence: TargetConfidence;
  /** Human-readable trace. Printed in the coach and stored on the session row. */
  notes: string[];
}

/** Only these two commit without a human tap. */
export function autoCommits(c: TargetConfidence): boolean {
  return c === "exact" || c === "strong";
}

function digits(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "");
}

function fromLeadRef(
  lead: LeadRef,
  confidence: TargetConfidence,
  source: CallTarget["source"]
): CallTarget {
  return {
    contactId: lead.id,
    businessName: lead.businessName,
    personName: [lead.firstName, lead.lastName].filter(Boolean).join(" ") || null,
    email: lead.email,
    phone: lead.phone ?? lead.mobilePhone,
    website: lead.website,
    confidence,
    source,
    crmUrl: crmRecordUrl(lead.id),
    zohoLeadId: lead.zohoLeadId,
  };
}

/** A parsed URL, resolved to a contact. Pure DB work — no CRM API exists to call. */
async function fetchByRef(ref: RecordRef): Promise<LeadRef | null> {
  const { matches } = await resolveLeadCandidates(
    ref.kind === "contact" ? { contactId: ref.contactId } : { zohoLeadId: ref.zohoLeadId }
  );
  return matches[0] ?? null;
}

function refLabel(ref: RecordRef): string {
  return ref.kind === "contact" ? `contact ${ref.contactId}` : `Zoho lead ${ref.zohoLeadId}`;
}

/**
 * Resolve, cheapest and most certain first.
 *
 * The ladder is ordered by how a step can be WRONG, not by how convenient it is:
 *   tab URL      cannot be wrong about which record; Chrome told us.
 *   vision URL   can be wrong by one digit, so the resolved record is cross-checked by name.
 *   email        one hit is near-certain, several means two people share an address.
 *   phone        a shared front-desk line is common, so several hits are genuinely ambiguous.
 *   name         weakest. Only ever `weak`, and never when more than one matches.
 */
export async function resolveCallTarget(args: {
  read: VisionRead | null;
  /** URL of the CRM tab, straight from chrome.tabs.query. Free and authoritative. */
  tabUrl?: string | null;
}): Promise<ResolveResult> {
  const notes: string[] = [];
  const read = args.read;

  // ── 1. The Chrome tab URL. No model involved. ────────────────────────────
  const tabRef = parseRecordUrl(args.tabUrl);
  if (tabRef) {
    const lead = await fetchByRef(tabRef);
    if (lead) {
      notes.push("Record id came from the CRM tab URL, so no guessing was involved.");
      return one(fromLeadRef(lead, "exact", "tab_url"), notes);
    }
    notes.push(`The CRM tab URL pointed at ${refLabel(tabRef)} but no contact matches it.`);
  }

  if (!read) {
    return { chosen: null, candidates: [], confidence: "none", notes: [...notes, "No screenshot was read."] };
  }

  // ── 2. The URL the model read off the address bar. ───────────────────────
  const visionRef: RecordRef | null =
    parseRecordUrl(read.urlText) ??
    (read.zohoRecordId ? { kind: "zohoLead", zohoLeadId: read.zohoRecordId } : null);

  if (visionRef) {
    const lead = await fetchByRef(visionRef);
    if (lead) {
      const target = fromLeadRef(lead, "exact", "vision_url");
      // One transcribed digit wrong lands on a real but different record, and the lookup succeeds.
      // The name check is what catches that. Only fires when both sides carry a name.
      const conflict = companiesConflict(
        { businessName: read.businessName, website: read.website },
        { businessName: target.businessName, website: target.website }
      );
      if (conflict) {
        notes.push(
          `The record id read off the address bar belongs to "${target.businessName}", but the screen says "${read.businessName}". One of the two was misread.`
        );
        return { chosen: null, candidates: [target], confidence: "ambiguous", notes };
      }
      notes.push("Record id read off the address bar and the business name on screen agrees with it.");
      return one(target, notes);
    }
    notes.push(`Read ${refLabel(visionRef)} off the screen but no contact matches it. Probably a misread digit.`);
  }

  // ── 3. Email, then phone, then name. ─────────────────────────────────────
  if (read.email) {
    const hits = await hitsFor({ email: read.email }, "email");
    if (hits.length === 1) {
      notes.push(`Matched on the email address on screen (${read.email}).`);
      return one(fromLeadRef(hits[0], "strong", "vision_email"), notes);
    }
    if (hits.length > 1) {
      notes.push(`${hits.length} contacts share the email ${read.email}.`);
      return many(hits.map((h) => fromLeadRef(h, "ambiguous", "vision_email")), notes);
    }
  }

  if (read.phone && digits(read.phone).length >= 10) {
    const hits = await hitsFor({ phone: read.phone }, "phone");
    if (hits.length === 1) {
      notes.push(`Matched on the phone number on screen (${read.phone}).`);
      return one(fromLeadRef(hits[0], "strong", "vision_phone"), notes);
    }
    if (hits.length > 1) {
      // Genuinely common: a shared front-desk line across two businesses, or one owner running
      // two. companiesConflict exists precisely because this used to collapse them into one.
      notes.push(`${hits.length} contacts share the phone ${read.phone}. That is usually a shared front desk line.`);
      return many(hits.map((h) => fromLeadRef(h, "ambiguous", "vision_phone")), notes);
    }
  }

  if (read.businessName) {
    const byName = await hitsFor({ businessName: read.businessName }, "businessName");

    if (byName.length === 1) {
      const target = fromLeadRef(byName[0], "weak", "vision_name");
      // A name match is the weakest signal there is, and it is exactly where a sidebar read lands.
      if (readFromUntrustedRegion(read)) {
        notes.push(
          `Matched "${read.businessName}" by name, but it was read from ${read.evidence}, which lists OTHER businesses. Confirm before this is used.`
        );
        return { chosen: null, candidates: [target], confidence: "ambiguous", notes };
      }
      notes.push(`Matched "${read.businessName}" by business name only. Confirm it is the right record.`);
      return { chosen: null, candidates: [target], confidence: "weak", notes };
    }
    if (byName.length > 1) {
      notes.push(`${byName.length} contacts match the name "${read.businessName}".`);
      return many(byName.map((h) => fromLeadRef(h, "ambiguous", "vision_name")), notes);
    }
  }

  notes.push(
    read.businessName
      ? `Read "${read.businessName}" off the screen but found nothing matching it in the CRM. It may not be in there yet.`
      : `Could not read a business off the screen (${read.evidence}).`
  );
  return { chosen: null, candidates: [], confidence: "none", notes };
}

/**
 * One rung of the shared ladder, and only that rung.
 *
 * resolveLeadCandidates walks the whole ladder, so asking it for an email and getting back a
 * `businessName` answer is possible in principle. Pinning the rung keeps each step of the
 * confidence table honest about what actually matched.
 */
async function hitsFor(
  input: { email?: string; phone?: string; businessName?: string },
  expected: ResolveRung
): Promise<LeadRef[]> {
  try {
    const { matches, rung } = await resolveLeadCandidates(input);
    return rung === expected ? matches : [];
  } catch (e) {
    console.error("[resolve-target] contact lookup failed:", (e as Error).message);
    return [];
  }
}

function one(target: CallTarget, notes: string[]): ResolveResult {
  return { chosen: target, candidates: [target], confidence: target.confidence, notes };
}

function many(candidates: CallTarget[], notes: string[]): ResolveResult {
  return { chosen: null, candidates, confidence: "ambiguous", notes };
}

/** The line that opens every brief and every wrap card. Its job is to make a wrong lead obvious
 *  in the first five seconds rather than at minute forty. */
export function whoLine(t: CallTarget): string {
  return [t.businessName ?? "unknown business", t.personName, t.phone, t.crmUrl]
    .filter(Boolean)
    .join(" · ");
}

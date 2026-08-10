// Turning "something on a screen" into a real Zoho record, with an honest confidence.
//
// The whole design here is about ONE failure: identifying the wrong lead. It is not a cosmetic
// error. A wrong identification grounds every live suggestion for the length of the call, and then
// the post-call wrap writes a note about that call onto the wrong company's CRM record, where it
// stays. So there are three layers between a misread and damage, and they are deliberately
// redundant:
//
//   1. Nothing below `strong` auto-commits. Weak and ambiguous return CANDIDATES and the coach
//      shows a confirm strip. One click, and the failure disappears.
//   2. The brief's first line is the WHO line, naming business, person, phone and the Zoho id. A
//      misidentification then fails in the first five seconds instead of at minute forty.
//   3. The wrap re-reads the session row rather than re-deriving identity, and reprints that same
//      WHO line above the note. So a wrong Zoho note needs two missed confirmations, not one.

import { searchLeads, getLead, getDeal, type ZohoApiRecord } from "@/lib/zoho";
import { companiesConflict } from "@/lib/company-identity";
import { supabaseAdmin } from "@/lib/db";
import { parseZohoRecordUrl, zohoRecordUrl, type ZohoModule, type ZohoRecordRef } from "./zoho-url";
import { readFromUntrustedRegion, type VisionRead } from "./identify-lead";

export type TargetConfidence = "exact" | "strong" | "weak" | "ambiguous" | "none";

export interface CallTarget {
  module: ZohoModule;
  recordId: string;
  businessName: string | null;
  personName: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  /** Supabase contacts.id, when this record has ever been through a funnel. Often null. */
  contactId: string | null;
  confidence: TargetConfidence;
  source: "tab_url" | "vision_url" | "vision_email" | "vision_phone" | "vision_name" | "dialer" | "manual";
  zohoUrl: string;
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

/**
 * Zoho returns an EMPTY STRING for an unset text field, never null.
 *
 * So `rec.Company ?? rec.Deal_Name` keeps the empty Company and never reaches Deal_Name, and every
 * downstream "did we get a name" check passes on a blank. Anything reading a Zoho field goes
 * through here.
 */
function blank(v: unknown): string | null {
  const t = typeof v === "string" ? v.trim() : "";
  return t.length > 0 ? t : null;
}

function fromRecord(
  ref: ZohoRecordRef,
  rec: ZohoApiRecord,
  confidence: TargetConfidence,
  source: CallTarget["source"]
): CallTarget {
  // A Deal carries Deal_Name / Account_Name where a Lead carries Company, and reading only
  // `Company` off a Deal gives a nameless target. Same shape mismatch resolveRecord handles in
  // smart-followup.ts.
  const business =
    blank(rec.Company) ??
    blank((rec.Account_Name as { name?: string } | undefined)?.name) ??
    blank(rec.Deal_Name) ??
    null;

  return {
    module: ref.module,
    recordId: ref.recordId,
    businessName: business,
    personName: [blank(rec.First_Name), blank(rec.Last_Name)].filter(Boolean).join(" ") || null,
    email: blank(rec.Email),
    phone: blank(rec.Phone) ?? blank(rec.Mobile),
    website: blank(rec.Website),
    contactId: null,
    confidence,
    source,
    zohoUrl: zohoRecordUrl(ref),
  };
}

async function fetchRecord(ref: ZohoRecordRef): Promise<ZohoApiRecord | null> {
  try {
    if (ref.module === "Deals") return await getDeal(ref.recordId);
    return await getLead(ref.recordId);
  } catch (e) {
    console.error(`[resolve-target] could not fetch ${ref.module}/${ref.recordId}:`, (e as Error).message);
    return null;
  }
}

/**
 * Resolve, cheapest and most certain first.
 *
 * The ladder is ordered by how a step can be WRONG, not by how convenient it is:
 *   tab URL      cannot be wrong about which record; Chrome told us.
 *   vision URL   can be wrong by one digit, so the fetched record is cross-checked by name.
 *   email        one hit is near-certain, several means two people share an address.
 *   phone        a shared front-desk line is common, so several hits are genuinely ambiguous.
 *   name         weakest. Only ever `weak`, and never when more than one matches.
 */
export async function resolveCallTarget(args: {
  read: VisionRead | null;
  /** URL of the Zoho tab, straight from chrome.tabs.query. Free and authoritative. */
  tabUrl?: string | null;
}): Promise<ResolveResult> {
  const notes: string[] = [];
  const read = args.read;

  // ── 1. The Chrome tab URL. No model involved. ────────────────────────────
  const tabRef = parseZohoRecordUrl(args.tabUrl);
  if (tabRef) {
    const rec = await fetchRecord(tabRef);
    if (rec) {
      notes.push(`Record id came from the Zoho tab URL, so no guessing was involved.`);
      return one(fromRecord(tabRef, rec, "exact", "tab_url"), notes);
    }
    notes.push(`The Zoho tab URL pointed at ${tabRef.module}/${tabRef.recordId} but that record could not be fetched.`);
  }

  if (!read) {
    return { chosen: null, candidates: [], confidence: "none", notes: [...notes, "No screenshot was read."] };
  }

  // ── 2. The URL the model read off the address bar. ───────────────────────
  const visionRef =
    parseZohoRecordUrl(read.urlText) ??
    (read.zohoRecordId && read.zohoModule ? { module: read.zohoModule, recordId: read.zohoRecordId } : null);

  if (visionRef) {
    const rec = await fetchRecord(visionRef);
    if (rec) {
      const target = fromRecord(visionRef, rec, "exact", "vision_url");
      // One transcribed digit wrong lands on a real but different record, and the fetch succeeds.
      // The name check is what catches that. Only fires when both sides carry a name.
      const conflict = companiesConflict(
        { businessName: read.businessName, website: read.website },
        { businessName: target.businessName, website: target.website }
      );
      if (conflict) {
        notes.push(
          `The record id read off the address bar (${visionRef.recordId}) belongs to "${target.businessName}", but the screen says "${read.businessName}". One of the two was misread.`
        );
        return { chosen: null, candidates: [target], confidence: "ambiguous", notes };
      }
      notes.push("Record id read off the address bar and the business name on screen agrees with it.");
      return one(target, notes);
    }
    notes.push(`Read ${visionRef.module}/${visionRef.recordId} off the screen but Zoho has no such record. Probably a misread digit.`);
  }

  // ── 3. Email, then phone, then name. ─────────────────────────────────────
  if (read.email) {
    const hits = await safeSearch({ email: read.email });
    if (hits.length === 1) {
      notes.push(`Matched on the email address on screen (${read.email}).`);
      return one(toTarget(hits[0], "strong", "vision_email"), notes);
    }
    if (hits.length > 1) {
      notes.push(`${hits.length} Zoho records share the email ${read.email}.`);
      return many(hits.map((h) => toTarget(h, "ambiguous", "vision_email")), notes);
    }
  }

  if (read.phone && digits(read.phone).length >= 10) {
    const hits = await safeSearch({ phone: read.phone });
    if (hits.length === 1) {
      notes.push(`Matched on the phone number on screen (${read.phone}).`);
      return one(toTarget(hits[0], "strong", "vision_phone"), notes);
    }
    if (hits.length > 1) {
      // Genuinely common: a shared front-desk line across two businesses, or one owner running
      // two. companiesConflict exists precisely because this used to collapse them into one.
      notes.push(`${hits.length} Zoho records share the phone ${read.phone}. That is usually a shared front desk line.`);
      return many(hits.map((h) => toTarget(h, "ambiguous", "vision_phone")), notes);
    }
  }

  if (read.businessName) {
    const hits = await safeSearch({ criteria: `(Company:equals:${escapeCriteria(read.businessName)})` });
    const byName = hits.length
      ? hits
      : await safeSearch({ criteria: `(Company:starts_with:${escapeCriteria(read.businessName)})` });

    if (byName.length === 1) {
      const target = toTarget(byName[0], "weak", "vision_name");
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
      notes.push(`${byName.length} Zoho records match the name "${read.businessName}".`);
      return many(byName.slice(0, 3).map((h) => toTarget(h, "ambiguous", "vision_name")), notes);
    }
  }

  notes.push(
    read.businessName
      ? `Read "${read.businessName}" off the screen but found nothing matching it in Zoho. It may not be in the CRM yet.`
      : `Could not read a business off the screen (${read.evidence}).`
  );
  return { chosen: null, candidates: [], confidence: "none", notes };
}

function escapeCriteria(s: string): string {
  // Zoho criteria are parenthesis-delimited, so an unescaped one truncates the query into
  // something that still parses and quietly matches the wrong thing.
  return s.replace(/[()]/g, " ").trim();
}

async function safeSearch(q: { email?: string; phone?: string; criteria?: string }): Promise<ZohoApiRecord[]> {
  try {
    return await searchLeads(q);
  } catch (e) {
    console.error("[resolve-target] Zoho search failed:", (e as Error).message);
    return [];
  }
}

function toTarget(rec: ZohoApiRecord, confidence: TargetConfidence, source: CallTarget["source"]): CallTarget {
  const ref: ZohoRecordRef = { module: "Leads", recordId: String(rec.id ?? "") };
  return fromRecord(ref, rec, confidence, source);
}

function one(target: CallTarget, notes: string[]): ResolveResult {
  return { chosen: target, candidates: [target], confidence: target.confidence, notes };
}

function many(candidates: CallTarget[], notes: string[]): ResolveResult {
  return { chosen: null, candidates, confidence: "ambiguous", notes };
}

/**
 * Attach the Supabase contact, when there is one.
 *
 * `contacts.zoho_lead_id` is the only join key between Zoho and everything this app stores, and it
 * is how the brief later finds the audit report. A cold Zoho lead legitimately has no contact row,
 * so a miss is normal and not worth a note.
 */
export async function attachContactId(target: CallTarget): Promise<CallTarget> {
  try {
    const { data } = await supabaseAdmin
      .from("contacts")
      .select("id")
      .eq("zoho_lead_id", target.recordId)
      .maybeSingle();
    if (data?.id) return { ...target, contactId: data.id as string };
  } catch (e) {
    console.error("[resolve-target] contact lookup failed:", (e as Error).message);
  }
  return target;
}

/** The line that opens every brief and every wrap card. Its job is to make a wrong lead obvious
 *  in the first five seconds rather than at minute forty. */
export function whoLine(t: CallTarget): string {
  return [
    t.businessName ?? "unknown business",
    t.personName,
    t.phone,
    `Zoho ${t.module}/${t.recordId}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

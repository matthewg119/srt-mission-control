// Reading who is on the phone off a screenshot of Matthew's screen.
//
// Doctrine copied from `readIntakeImages` in outreach-intake.ts, because it is the same job with
// higher stakes: TRANSCRIBE, DO NOT INFER. A wrong business name here does not produce one bad
// line, it grounds forty minutes of confident coaching about the wrong company and then writes a
// call note onto a stranger's CRM record.
//
// ‼️ The image is NEVER persisted. Not to Supabase, not to Slack, not to a log line. This is a
// picture of whatever happened to be on his screen, which is his inbox, his CRM and sometimes his
// bank. Log the byte count and the dimensions if you need to debug; the first instinct when this
// misreads something will be "let me save the screenshot to see what the model saw", and that is
// the instinct to resist.

import { callClaudeJSON, camelizeKeys } from "@/lib/claude-calls";

/** Haiku, temperature 0. This is transcription, not judgement, and it sits in front of a live dial. */
const MODEL = "claude-haiku-4-5-20251001" as const;

export interface ScreenImage {
  media_type: string;
  /** base64, no data: prefix. */
  data: string;
}

export interface VisionRead {
  businessName: string | null;
  personName: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  /** The browser address bar, character for character. The single most useful field here. */
  urlText: string | null;
  zohoModule: "Leads" | "Deals" | "Contacts" | "Accounts" | null;
  zohoRecordId: string | null;
  /** How legibly a record was on screen. NOT how confident it is about the business. */
  confidence: number;
  /** Where on screen it read the name from. Used to force a confirm when it says "sidebar". */
  evidence: string;
}

const EMPTY: VisionRead = {
  businessName: null,
  personName: null,
  phone: null,
  email: null,
  website: null,
  urlText: null,
  zohoModule: null,
  zohoRecordId: null,
  confidence: 0,
  evidence: "nothing readable",
};

export async function identifyFromScreenshot(image: ScreenImage): Promise<VisionRead> {
  try {
    const { data } = await callClaudeJSON<VisionRead>({
      model: MODEL,
      system: [
        "You are looking at a screenshot of a salesperson's screen, taken the moment before or during a phone call. Somewhere on it is the CRM record of the person he is calling. Your only job is to read who that is.",
        "",
        "READ, DO NOT INFER:",
        "- Transcribe characters exactly. Email addresses, phone numbers and business names must be copied, never corrected, never completed, never tidied.",
        "- If something is partially covered, cut off, or too small to read, return null for it. A partial phone number is worse than no phone number, because it will be dialed.",
        "- Never guess a person's role, never expand an abbreviation, never fix an apparent typo in a business name. Businesses really are called things like 'Grey Seal Services LLC.'.",
        "",
        "THE ADDRESS BAR IS THE MOST IMPORTANT THING ON SCREEN. If a browser URL is visible, transcribe it into urlText exactly as written, the whole thing including the long number. A Zoho CRM record URL contains the module and an 18 or 19 digit record id, and that id identifies the record with certainty. Copy the digits one at a time.",
        "",
        "‼️ WHICH RECORD. Zoho shows a 'Recently Visited' or 'Recent Items' list in a sidebar, and a list view can show dozens of businesses at once. Those are OTHER companies, not the one he is calling. Take the business from the RECORD HEADER, the page title, or the largest heading of the detail panel. If all you can see is a list or a sidebar, return null for businessName and say so in evidence rather than picking the first row.",
        "",
        "confidence is 0 to 1 and measures LEGIBILITY: how clearly a single CRM record is open and readable on this screen. It is not how sure you are that this is the right business. A crisp full-screen record is 0.9; a record behind a video call window is 0.4; a list view with no record open is 0.1.",
        "evidence is one short phrase naming WHERE you read the business name from: 'record header', 'browser tab title', 'recently visited sidebar', 'list view row'.",
        "",
        "If there is no CRM on screen at all, return nulls, confidence 0, and say what is on screen instead in evidence.",
      ].join("\n"),
      user:
        "Read the CRM record on this screen. Return the business, the person, their contact details, the address bar verbatim, and the Zoho module and record id if the URL shows them.",
      images: [image],
      maxTokens: 700,
      temperature: 0,
      schemaHint:
        '{ "businessName": string|null, "personName": string|null, "phone": string|null, "email": string|null, "website": string|null, "urlText": string|null, "zohoModule": "Leads"|"Deals"|"Contacts"|"Accounts"|null, "zohoRecordId": string|null, "confidence": number, "evidence": string }',
      coerce: camelizeKeys,
      validate: (v: unknown): v is VisionRead => {
        const o = v as VisionRead;
        return !!o && typeof o === "object" && typeof o.confidence === "number";
      },
      describeInvalid: () =>
        "Return the object with every key present, using null for anything not legible, and a numeric confidence between 0 and 1.",
    });

    return {
      ...EMPTY,
      ...data,
      // A model that returns "" for a missing field is common enough to normalise here rather than
      // making every downstream check test for both.
      businessName: blankToNull(data.businessName),
      personName: blankToNull(data.personName),
      phone: blankToNull(data.phone),
      email: blankToNull(data.email),
      website: blankToNull(data.website),
      urlText: blankToNull(data.urlText),
      zohoRecordId: blankToNull(data.zohoRecordId),
      evidence: data.evidence?.trim() || "not stated",
    };
  } catch (e) {
    // Non-fatal. A failed read means the confirm strip, not a dead Scan button, and the URL path
    // may well have already resolved the record without needing this at all.
    console.error("[identify-lead] vision read failed:", (e as Error).message);
    return { ...EMPTY, evidence: `read failed: ${(e as Error).message}` };
  }
}

function blankToNull(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t.length > 0 ? t : null;
}

/** True when the model told us it read the name off a list or the recently-viewed sidebar, which
 *  is the single most likely way to identify the wrong company. Forces a human confirm. */
export function readFromUntrustedRegion(read: VisionRead): boolean {
  return /recent|sidebar|list view|list row|search result/i.test(read.evidence);
}

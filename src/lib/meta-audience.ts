// src/lib/meta-audience.ts
// Meta Marketing API — Customer List custom audience client.
//
// This powers the "SRT - CRM Master Exclusion" audience: every email/phone already
// in Zoho is hashed and pushed here, and the audience is set as an EXCLUSION on each
// acquisition ad set so Meta stops re-serving ads to people already in the CRM.
//
// Separate concern from src/lib/meta-capi.ts (that hits the CAPI /events endpoint with
// the pixel token; this hits the Marketing API /customaudiences + /users endpoints with
// an ads_management system-user token). Hashing rules are the same as meta-capi.ts.

import { createHash } from "crypto";

const API_VERSION = process.env.META_ADS_API_VERSION || "v21.0";
const GRAPH = "https://graph.facebook.com";

// Meta /users hard cap per call.
export const BATCH_SIZE = 10000;

// Multi-key schema we push. Order MUST match the row order built in toAudienceRow().
export const AUDIENCE_SCHEMA = ["EMAIL", "PHONE", "FN", "LN", "ZIP", "CT", "ST"] as const;

// ── Hashing / normalization (mirrors meta-capi.ts) ──

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// Trim + lowercase + SHA-256. Returns "" for empty input (Meta multi-key rows want an
// empty string for a missing field, never a hash of "").
function normText(value: string | undefined | null): string {
  if (!value || !String(value).trim()) return "";
  return sha256(String(value).trim().toLowerCase());
}

function normEmail(value: string | undefined | null): string {
  return normText(value);
}

// Digits only; prepend US country code if 10 digits (E.164 without the +), then hash.
function normPhone(value: string | undefined | null): string {
  if (!value) return "";
  let digits = String(value).replace(/\D/g, "");
  if (digits.length === 10) digits = "1" + digits;
  if (!digits) return "";
  return sha256(digits);
}

// First 5 chars of the zip, hashed.
function normZip(value: string | undefined | null): string {
  if (!value || !String(value).trim()) return "";
  return sha256(String(value).trim().toLowerCase().slice(0, 5));
}

// ── Row builder ──

export interface AudienceSourceRecord {
  Email?: string | null;
  Phone?: string | null;
  Mobile?: string | null;
  First_Name?: string | null;
  Last_Name?: string | null;
  City?: string | null;
  State?: string | null;
  Zip_Code?: string | null;
  [key: string]: unknown;
}

// Build one hashed row from a Zoho record. Returns null if there is no strong identifier
// (no email and no phone) — such a row is useless for matching.
export function toAudienceRow(r: AudienceSourceRecord): string[] | null {
  const email = normEmail(r.Email);
  const phone = normPhone(r.Mobile || r.Phone); // prefer mobile, per the phone-capture rule
  if (!email && !phone) return null;
  return [
    email,
    phone,
    normText(r.First_Name),
    normText(r.Last_Name),
    normZip(r.Zip_Code),
    normText(r.City),
    normText(r.State),
  ];
}

// Stable dedupe key: same person across Leads + Contacts collapses to one row. Idempotent
// either way (re-adding an existing member is a no-op), but keeps reported counts honest.
export function rowKey(row: string[]): string {
  return `${row[0]}|${row[1]}`; // hashed email | hashed phone
}

// ── Config ──

function adsToken(): string {
  const token = process.env.META_ADS_TOKEN;
  if (!token) throw new Error("META_ADS_TOKEN not set (system-user token with ads_management)");
  return token;
}

const TOS_URL = (act: string) =>
  `https://business.facebook.com/ads/manage/customaudiences/tos/?act_${act}`;

// ── Create the audience (one-time) ──

export async function createExclusionAudience(
  name = "SRT - CRM Master Exclusion"
): Promise<{ id: string }> {
  const act = process.env.META_AD_ACCOUNT_ID;
  if (!act) throw new Error("META_AD_ACCOUNT_ID not set (numeric ad account id)");

  const url = `${GRAPH}/${API_VERSION}/act_${act}/customaudiences`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      subtype: "CUSTOM",
      customer_file_source: "USER_PROVIDED_ONLY",
      description:
        "Everyone already in the SRT Zoho CRM (leads + contacts). Set as an EXCLUSION on acquisition ad sets. Synced daily.",
      access_token: adsToken(),
    }),
  });
  const json = (await res.json()) as { id?: string; error?: { message?: string; error_subcode?: number } };

  if (json.error) {
    const msg = json.error.message || JSON.stringify(json.error);
    // Surface the most common setup failure with the exact fix.
    if (/terms/i.test(msg)) {
      throw new Error(`Custom Audience Terms not accepted. Accept them here, then retry: ${TOS_URL(act)}`);
    }
    throw new Error(`Meta audience create failed: ${msg}`);
  }
  if (!json.id) throw new Error("Meta audience create returned no id: " + JSON.stringify(json));
  return { id: json.id };
}

// ── Push members ──

async function pushBatch(rows: string[][]): Promise<{ received: number; invalid: number }> {
  const audienceId = process.env.META_AUDIENCE_ID;
  if (!audienceId) throw new Error("META_AUDIENCE_ID not set (run /api/admin/create-exclusion-audience once)");

  const url = `${GRAPH}/${API_VERSION}/${audienceId}/users`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      payload: { schema: AUDIENCE_SCHEMA, data: rows },
      access_token: adsToken(),
    }),
  });
  const json = (await res.json()) as {
    num_received?: number;
    num_invalid_entries?: number;
    error?: { message?: string };
  };
  if (json.error) throw new Error("Meta push failed: " + (json.error.message || JSON.stringify(json.error)));
  return {
    received: json.num_received ?? rows.length,
    invalid: json.num_invalid_entries ?? 0,
  };
}

// Push every row to the audience in batches of BATCH_SIZE. Because this is an exclusion
// list we only ever add, so the full set can be pushed each run with no diffing.
export async function pushUsersToAudience(rows: string[][]): Promise<{ received: number; invalid: number }> {
  let received = 0;
  let invalid = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const result = await pushBatch(batch);
    received += result.received;
    invalid += result.invalid;
  }
  return { received, invalid };
}

// src/lib/zoho.ts
// Zoho CRM integration with OAuth refresh token flow
// Intentional duplicate — sibling client lives in srt-portal/src/lib/zoho.ts.
// Keep both in sync when touching auth, request wrappers, or field mapping.

import { DEFAULTS } from "@/config/defaults";
import { supabaseAdmin } from "@/lib/db";

const ZOHO_TOKEN_ENDPOINT = "https://accounts.zoho.com/oauth/v2/token";
const ZOHO_API_BASE = "https://www.zohoapis.com/crm/v5";

// In-memory token cache
let tokenCache: {
            accessToken: string;
            expiresAt: number;
} | null = null;

interface ZohoTokenResponse {
            access_token: string;
            expires_in: number;
            token_type: string;
            error?: string;
}

export interface ZohoLeadData {
            firstName?: string;
            lastName?: string;
            businessName?: string;
            legalName?: string;
            dba?: string;
            email?: string;
            phone?: string;
            source?: string;
            Lead_Status?: string;
            // Funding details
  fundingAmount?: string | number;
            monthlyRevenue?: string | number;
            monthlyDeposits?: string | number;
            useOfFunds?: string;
            existingLoans?: string;
            // Business info
  industry?: string;
            ein?: string;
            bizAddress?: string;
            bizCity?: string;
            bizState?: string;
            bizZip?: string;
            timeInBusiness?: string;
            // Owner info
  creditScoreRange?: string;
            ownership?: string;
            dob?: string;
            ssn4?: string;
            ssnFull?: string;
            homeAddress?: string;
            signatureName?: string;
            incDate?: string;
}

export interface ZohoApiRecord {
            First_Name?: string;
            Last_Name?: string;
            Company?: string;
            Email?: string;
            Phone?: string;
            Lead_Source?: string;
            Lead_Status?: string;
            Industry?: string;
            // Business address
  Street?: string;
            City?: string;
            State?: string;
            Zip_Code?: string;
            // Business identifiers
  EIN?: string;
            DBA?: string;
            Time_in_Business?: string;
            // Custom fields
  Funding_Amount_Requested?: string | number;
            Monthly_Deposits?: string | number;
            Monthly_Revenue?: string | number;
            Credit_Score_Range?: string;
            Use_of_Funds?: string;
            Existing_Loans?: string;
            Ownership_Percentage?: string | number;
            SSN_Last_4?: string;
            SSN?: string;
            Date_of_Birth?: string;
            Home_Address?: string;
            Legal_Name?: string;
            Incorporation_Date?: string;
            Signature_Name?: string;
            // Free-form description as backup summary
  Description?: string;
            [key: string]: unknown;
}

interface ZohoSearchCriteria {
            email?: string;
            phone?: string;
            criteria?: string;
}

async function getAccessToken(): Promise<string> {
            if (tokenCache && Date.now() < tokenCache.expiresAt - 5 * 60 * 1000) {
                          return tokenCache.accessToken;
            }

  const clientId = process.env.ZOHO_CLIENT_ID;
            const clientSecret = process.env.ZOHO_CLIENT_SECRET;
            const refreshToken = process.env.ZOHO_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
                throw new Error("Missing Zoho OAuth credentials (ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN)");
  }

  const params = new URLSearchParams({
                grant_type: "refresh_token",
                client_id: clientId,
                client_secret: clientSecret,
                refresh_token: refreshToken,
  });

  const response = await fetch(ZOHO_TOKEN_ENDPOINT, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: params.toString(),
  });

  if (!response.ok) {
                throw new Error(`Zoho token request failed: ${response.status} ${response.statusText}`);
  }

  const data: ZohoTokenResponse = await response.json();

  if (data.error) {
                throw new Error(`Zoho token error: ${data.error}`);
  }

  tokenCache = {
                accessToken: data.access_token,
                expiresAt: Date.now() + data.expires_in * 1000,
  };

  return data.access_token;
}

export async function zohoRequest(
            method: string,
            path: string,
            body?: unknown
          ): Promise<unknown> {
            const accessToken = await getAccessToken();

  const options: RequestInit = {
                method,
                headers: {
                                Authorization: `Zoho-oauthtoken ${accessToken}`,
                                "Content-Type": "application/json",
                },
  };

  if (body) {
                options.body = JSON.stringify(body);
  }

  const response = await fetch(`${ZOHO_API_BASE}${path}`, options);

  if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Zoho API error ${response.status}: ${errorText}`);
  }

  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    console.error("[Zoho] Failed to parse response:", text.slice(0, 200));
    return {};
  }
}

/**
 * Build a Description block from financial and owner details.
 * Used since these fields are not yet custom fields in Zoho.
 */
function buildDescription(leadData: ZohoLeadData): string | undefined {
            const parts: string[] = [];
            if (leadData.fundingAmount) parts.push(`Funding Requested: ${leadData.fundingAmount}`);
            if (leadData.monthlyDeposits) parts.push(`Monthly Deposits: ${leadData.monthlyDeposits}`);
            if (leadData.monthlyRevenue) parts.push(`Monthly Revenue: ${leadData.monthlyRevenue}`);
            if (leadData.creditScoreRange) parts.push(`Credit Score Range: ${leadData.creditScoreRange}`);
            if (leadData.ownership) parts.push(`Ownership %: ${leadData.ownership}`);
            if (leadData.useOfFunds) parts.push(`Use of Funds: ${leadData.useOfFunds}`);
            if (leadData.existingLoans) parts.push(`Existing Loans: ${leadData.existingLoans}`);
            if (leadData.dob) parts.push(`Date of Birth: ${leadData.dob}`);
            return parts.length > 0 ? parts.join(" | ") : undefined;
}

/** Build a full ZohoApiRecord from ZohoLeadData */
function buildRecord(leadData: ZohoLeadData): ZohoApiRecord {
            const record: ZohoApiRecord = {
                          First_Name: leadData.firstName || "",
                          Last_Name: leadData.lastName || leadData.businessName || leadData.legalName || "Unknown",
                          Company: leadData.businessName || leadData.legalName || "",
                          Email: leadData.email || "",
                          Phone: leadData.phone || "",
                          Lead_Source: leadData.source || DEFAULTS.zohoLeadSource,
                          Lead_Status: leadData.Lead_Status || DEFAULTS.zohoLeadStatus,
                          Industry: leadData.industry || "",
            };

  // Business identifiers
  if (leadData.ein) record.EIN = leadData.ein;
            if (leadData.dba) record.DBA = leadData.dba;
            if (leadData.bizAddress) record.Street = leadData.bizAddress;
            if (leadData.bizCity) record.City = leadData.bizCity;
            if (leadData.bizState) record.State = leadData.bizState;
            if (leadData.bizZip) record.Zip_Code = leadData.bizZip;
            if (leadData.timeInBusiness) record.Time_in_Business = leadData.timeInBusiness;

  // Custom fields — direct mapping
  if (leadData.fundingAmount) record.Funding_Amount_Requested = leadData.fundingAmount;
  if (leadData.monthlyDeposits) record.Monthly_Deposits = leadData.monthlyDeposits;
  if (leadData.monthlyRevenue) record.Monthly_Revenue = leadData.monthlyRevenue;
  if (leadData.creditScoreRange) record.Credit_Score_Range = leadData.creditScoreRange;
  if (leadData.useOfFunds) record.Use_of_Funds = leadData.useOfFunds;
  if (leadData.existingLoans) record.Existing_Loans = leadData.existingLoans;
  if (leadData.ownership) record.Ownership_Percentage = leadData.ownership;
  if (leadData.dob) record.Date_of_Birth = leadData.dob;
  if (leadData.ssnFull) record.SSN = leadData.ssnFull;
  if (leadData.ssn4) record.SSN_Last_4 = leadData.ssn4;
  if (leadData.homeAddress) record.Home_Address = leadData.homeAddress;
  if (leadData.legalName) record.Legal_Name = leadData.legalName;
  if (leadData.incDate) record.Incorporation_Date = leadData.incDate;
  if (leadData.signatureName) record.Signature_Name = leadData.signatureName;

  // Keep Description as backup summary
  const desc = buildDescription(leadData);
  if (desc) record.Description = desc;

  return record;
}

export async function createLead(leadData: ZohoLeadData): Promise<string | null> {
            const record = buildRecord(leadData);

  const result = await zohoRequest("POST", "/Leads", { data: [record] }) as {
                data?: Array<{ code: string; details: { id: string }; message: string; status: string }>;
  };

  const created = result.data?.[0];
            if (created?.status === "success") {
                          return created.details.id;
            }

  throw new Error(
                `Failed to create Zoho lead: code=${created?.code} message=${created?.message || "Unknown error"} details=${JSON.stringify(created?.details)}`
              );
}

export async function updateLead(
            zohoLeadId: string,
            updates: Partial<ZohoApiRecord>
          ): Promise<void> {
            const result = await zohoRequest("PUT", `/Leads/${zohoLeadId}`, { data: [{ id: zohoLeadId, ...updates }] }) as {
                          data?: Array<{ code: string; message: string; status: string; details?: unknown }>;
            };
            const updated = result.data?.[0];
            if (updated && updated.status !== "success" && updated.code !== "SUCCESS") {
                          throw new Error(
                            `Zoho updateLead non-success: code=${updated.code} message=${updated.message} details=${JSON.stringify(updated.details ?? {})} payload=${JSON.stringify(updates)}`
                          );
            }
}

/**
 * Add a Note to a Zoho CRM Lead. Used for data we don't trust to the structured
 * custom fields (e.g. funding ranges like "$100K - $250K" that Zoho may reject
 * if the field is typed as Currency).
 */
export interface ZohoNote {
  id: string;
  Note_Title: string | null;
  Note_Content: string | null;
  Created_Time: string | null;
  Modified_Time: string | null;
  Owner?: { name?: string | null; email?: string | null } | null;
}

/**
 * Fetch notes attached to a Zoho Lead, newest first. Lightweight wrapper around
 * GET /Leads/{id}/Notes — returns up to `limit` notes (default 25). Used by the
 * Email Marketing Director to read recent context before drafting follow-ups.
 */
export async function getLeadNotes(
  zohoLeadId: string,
  limit: number = 25
): Promise<ZohoNote[]> {
  if (!zohoLeadId) return [];
  try {
    const perPage = Math.min(limit, 100);
    const result = await zohoRequest(
      "GET",
      `/Leads/${zohoLeadId}/Notes?sort_order=desc&sort_by=Modified_Time&per_page=${perPage}`
    ) as { data?: ZohoNote[] };
    return result.data ?? [];
  } catch (e) {
    console.error("[zoho] getLeadNotes failed:", (e as Error).message);
    return [];
  }
}

export async function addNoteToLead(
            zohoLeadId: string,
            title: string,
            content: string
          ): Promise<void> {
            const result = await zohoRequest("POST", "/Notes", {
                          data: [{
                                          Note_Title: title,
                                          Note_Content: content,
                                          Parent_Id: zohoLeadId,
                                          se_module: "Leads",
                          }],
            }) as { data?: Array<{ code: string; message: string; status: string }> };
            const created = result.data?.[0];
            if (created && created.status !== "success") {
                          throw new Error(`Zoho note non-success: code=${created.code} message=${created.message}`);
            }
}

/** Add a note to any module record (Leads, Deals, Contacts, ...). */
export async function addNoteToRecord(
  module: string,
  recordId: string,
  title: string,
  content: string
): Promise<void> {
  const result = await zohoRequest("POST", "/Notes", {
    data: [{ Note_Title: title, Note_Content: content, Parent_Id: recordId, se_module: module }],
  }) as { data?: Array<{ code: string; message: string; status: string }> };
  const created = result.data?.[0];
  if (created && created.status !== "success") {
    throw new Error(`Zoho note non-success: code=${created.code} message=${created.message}`);
  }
}

/** Find a Deal id by (business) name. Returns the first match or null. */
export async function findDealByName(name: string): Promise<string | null> {
  const q = (name ?? "").trim();
  if (!q) return null;
  try {
    const result = await zohoRequest(
      "GET",
      `/Deals/search?criteria=${encodeURIComponent(`(Deal_Name:starts_with:${q})`)}`
    ) as { data?: ZohoApiRecord[] };
    let hit = result.data?.[0];
    if (!hit) {
      const byWord = await zohoRequest("GET", `/Deals/search?word=${encodeURIComponent(q)}`) as { data?: ZohoApiRecord[] };
      hit = byWord.data?.[0];
    }
    return hit ? String(hit.id) : null;
  } catch (e) {
    console.warn("[zoho] findDealByName failed:", (e as Error).message);
    return null;
  }
}

/**
 * Write a CRM note, surviving lead conversion. Tries the Lead first; if the lead has been
 * converted (Zoho rejects notes on converted leads) or is missing, falls back to the converted
 * Deal matched by business name. Returns where it landed (or null on total failure).
 */
export async function addNoteResilient(opts: {
  zohoLeadId?: string | null;
  businessName?: string | null;
  title: string;
  content: string;
}): Promise<{ ok: boolean; target: string | null }> {
  if (opts.zohoLeadId) {
    try {
      await addNoteToLead(opts.zohoLeadId, opts.title, opts.content);
      return { ok: true, target: `Leads/${opts.zohoLeadId}` };
    } catch (e) {
      const msg = (e as Error).message;
      // Only fall back on conversion/not-found; rethrow nothing — try the Deal next.
      console.warn("[zoho] addNoteToLead failed, trying converted Deal:", msg.slice(0, 120));
    }
  }
  if (opts.businessName) {
    const dealId = await findDealByName(opts.businessName);
    if (dealId) {
      try {
        await addNoteToRecord("Deals", dealId, opts.title, opts.content);
        return { ok: true, target: `Deals/${dealId}` };
      } catch (e) {
        console.warn("[zoho] addNoteToRecord(Deals) failed:", (e as Error).message.slice(0, 120));
      }
    }
  }
  return { ok: false, target: null };
}

export async function getLead(zohoLeadId: string): Promise<ZohoApiRecord> {
            const result = await zohoRequest("GET", `/Leads/${zohoLeadId}`) as {
                          data?: ZohoApiRecord[];
            };
            const lead = result.data?.[0];
            if (!lead) {
                          throw new Error(`Zoho lead not found: ${zohoLeadId}`);
            }
            return lead;
}

/** Fetch a single Deal record by id (Deal_Name, Stage, Amount, Contact_Name lookup, …). */
export async function getDeal(zohoDealId: string): Promise<ZohoApiRecord> {
  const result = (await zohoRequest("GET", `/Deals/${zohoDealId}`)) as {
    data?: ZohoApiRecord[];
  };
  const deal = result.data?.[0];
  if (!deal) {
    throw new Error(`Zoho deal not found: ${zohoDealId}`);
  }
  return deal;
}

export async function searchLeads(
            criteria: ZohoSearchCriteria
          ): Promise<ZohoApiRecord[]> {
            const params = new URLSearchParams();
            if (criteria.criteria) {
                          params.set("criteria", criteria.criteria);
            } else if (criteria.email) {
                          params.set("criteria", `(Email:equals:${criteria.email})`);
            } else if (criteria.phone) {
                          params.set("criteria", `(Phone:equals:${criteria.phone})`);
            } else {
                          return [];
            }

  const result = await zohoRequest("GET", `/Leads/search?${params.toString()}`) as {
                data?: ZohoApiRecord[];
  };
            return result.data || [];
}

/**
 * Attach a PDF file to a Zoho CRM Lead.
 * Uses the Zoho CRM v5 Attachments endpoint with multipart/form-data.
 */
export async function attachPDFToLead(
            zohoLeadId: string,
            fileName: string,
            pdfBuffer: Buffer
          ): Promise<void> {
            const accessToken = await getAccessToken();

  const formData = new FormData();
            // Use Uint8Array to satisfy TypeScript's BlobPart type constraint
  const blob = new Blob([new Uint8Array(pdfBuffer)], { type: "application/pdf" });
            formData.append("file", blob, fileName);

  const response = await fetch(`${ZOHO_API_BASE}/Leads/${zohoLeadId}/Attachments`, {
                method: "POST",
                headers: {
                                Authorization: `Zoho-oauthtoken ${accessToken}`,
                                // Do NOT set Content-Type — fetch sets it with boundary automatically for FormData
                },
                body: formData,
  });

  if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Zoho attachment upload failed: ${response.status}: ${errorText}`);
  }

  const text = await response.text();
  if (!text) return; // Upload succeeded with no body
  let result: { data?: Array<{ code: string; message: string; status: string }> };
  try {
    result = JSON.parse(text);
  } catch {
    console.warn("[Zoho] Attachment response not JSON:", text.slice(0, 200));
    return; // Assume success if HTTP was 200
  }
            const item = result.data?.[0];
            if (item && item.status !== "success") {
                          throw new Error(`Zoho attachment non-success: code=${item.code} message=${item.message}`);
            }
}

/**
 * Convert a Zoho CRM Lead into Account / Contact / Deal in one call.
 * Used at 100% application completion to materialize the deal in Zoho.
 *
 * Returns the IDs of the created records (or null if conversion failed).
 * Errors are logged and re-thrown so callers can catch + system_log them.
 */
export async function convertLeadToDeal(
  zohoLeadId: string,
  deal: {
    dealName: string;
    amount?: number;
    closingDate?: string; // YYYY-MM-DD
    stage?: string;
    pipeline?: string;
  }
): Promise<{ accountId?: string; contactId?: string; dealId?: string } | null> {
  // Default closing date: 30 days from now
  const closingDate = deal.closingDate || (() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  })();

  const dealPayload: Record<string, unknown> = {
    Deal_Name: deal.dealName,
    Closing_Date: closingDate,
    Stage: deal.stage || "Qualification",
  };
  if (deal.amount && deal.amount > 0) dealPayload.Amount = deal.amount;
  if (deal.pipeline) dealPayload.Pipeline = deal.pipeline;

  const result = await zohoRequest("POST", `/Leads/${zohoLeadId}/actions/convert`, {
    data: [{
      overwrite: false,
      notify_lead_owner: false,
      notify_new_entity_owner: false,
      Deals: dealPayload,
    }],
  }) as { data?: Array<{ Accounts?: string; Contacts?: string; Deals?: string; code?: string; message?: string; status?: string }> };

  const item = result.data?.[0];
  if (!item) {
    throw new Error("Zoho convertLead returned no data");
  }
  // A failed conversion returns a status/code/message instead of the IDs
  if (item.status && item.status !== "success") {
    throw new Error(`Zoho convertLead non-success: code=${item.code} message=${item.message}`);
  }
  return {
    accountId: item.Accounts,
    contactId: item.Contacts,
    dealId: item.Deals,
  };
}

/**
 * Upsert records into any Zoho module (Leads or a custom module like `Deal_Submissions`).
 * Matches on one or more unique fields so calling it twice with the same key updates the existing row.
 * Returns the Zoho response `data` array (one entry per record).
 */
export async function upsertRecords(
  moduleName: string,
  records: Array<Record<string, unknown>>,
  duplicateCheckFields: string[]
): Promise<Array<{ code?: string; status?: string; details?: { id?: string } }>> {
  if (records.length === 0) return [];
  const payload = {
    data: records,
    duplicate_check_fields: duplicateCheckFields,
  };
  const res = (await zohoRequest("POST", `/${moduleName}/upsert`, payload)) as {
    data?: Array<{ code?: string; status?: string; details?: { id?: string } }>;
  };
  return res.data ?? [];
}

export async function testConnection(): Promise<boolean> {
            try {
                          await zohoRequest("GET", "/Leads?per_page=1");
                          return true;
            } catch (error) {
                          console.error("Zoho connection test failed:", error);
                          return false;
            }
}

// Mark a lead as Hot Lead when they reply to an SMS. Fire-and-forget safe — never
// throws. Returns `becameHot` = true only on the transition into Hot Lead (was not
// hot before), so the caller can post a one-tap personalized suggestion exactly
// once. Returns false when already hot or on any failure.
export async function markZohoHotLead(
  zohoLeadId: string,
  replyText: string,
  slackChannelId: string | null
): Promise<boolean> {
  let becameHot = false;
  try {
    const { slack } = await import("@/lib/slack-bot");

    // Check if already marked hot lead (avoid duplicate Zoho update, but still post Slack)
    let alreadyHot = false;
    if (slackChannelId) {
      const { data: conv } = await supabaseAdmin
        .from("sms_conversations")
        .select("outcome")
        .eq("slack_channel_id", slackChannelId)
        .maybeSingle();
      alreadyHot = (conv?.outcome as string | null) === "hot_lead";
    }

    if (!alreadyHot) {
      // Update Zoho lead status
      const updateResult = await zohoRequest("PUT", `/Leads/${zohoLeadId}`, {
        data: [{ Lead_Status: "Hot Lead" }],
      }) as { data?: Array<{ code?: string; status?: string }> };

      const updateCode = updateResult.data?.[0]?.code;
      if (updateCode === "INVALID_DATA" || updateCode === "FIELD_NOT_FOUND") {
        console.error(`[markZohoHotLead] invalid picklist value "Hot Lead" for lead ${zohoLeadId}`);
        if (slackChannelId) {
          await slack.postMessage(
            slackChannelId,
            `⚠️ Zoho stage 'Hot Lead' not found in picklist — add it manually.`
          );
        }
        return false;
      }

      // Add note
      try {
        await addNoteToLead(
          zohoLeadId,
          "Hot Lead",
          `Replied to SMS: "${replyText.slice(0, 200)}"`
        );
      } catch (noteErr) {
        console.error("[markZohoHotLead] note failed:", noteErr);
      }

      // Flip outcome on conversation
      if (slackChannelId) {
        await supabaseAdmin
          .from("sms_conversations")
          .update({ outcome: "hot_lead" })
          .eq("slack_channel_id", slackChannelId);
      }

      // Newly transitioned into Hot Lead — caller posts a one-tap personalized card.
      becameHot = true;
    }

    // Post 🔥 notification to Slack channel
    if (slackChannelId) {
      const orgId = process.env.ZOHO_ORG_ID ?? "";
      const zohoUrl = orgId
        ? `https://crm.zoho.com/crm/org${orgId}/tab/Leads/${zohoLeadId}`
        : `https://crm.zoho.com/crm/tab/Leads/${zohoLeadId}`;
      await slack.postMessage(
        slackChannelId,
        `🔥 *HOT LEAD* — replied to text. ${alreadyHot ? "(already marked)" : "Zoho updated to *Hot Lead*."} Call immediately.\n<${zohoUrl}|Open in Zoho>`
      );
    }
  } catch (err) {
    console.error("[markZohoHotLead] unexpected error:", err);
    return false;
  }
  return becameHot;
}

/**
 * Create a Zoho Task associated with a Lead. Used by the iMessage follow-up
 * scheduler so a scheduled reminder is also visible in the CRM. Never throws —
 * returns the new task id, or null + logs on failure.
 */
export async function createZohoTask(opts: {
  leadId: string;
  subject: string;
  dueDate: string;        // YYYY-MM-DD
  description?: string;
  priority?: string;      // High | Highest | Normal | Low | Lowest
}): Promise<string | null> {
  try {
    const task: Record<string, unknown> = {
      Subject: opts.subject,
      Due_Date: opts.dueDate,
      Status: "Not Started",
      Priority: opts.priority || "Normal",
      What_Id: opts.leadId,
      $se_module: "Leads",
    };
    if (opts.description) task.Description = opts.description;

    const result = (await zohoRequest("POST", "/Tasks", { data: [task] })) as {
      data?: Array<{ code?: string; status?: string; message?: string; details?: { id?: string } }>;
    };
    const created = result.data?.[0];
    if (created?.status === "success" && created.details?.id) {
      return created.details.id;
    }
    console.error("[createZohoTask] non-success:", JSON.stringify(created));
    return null;
  } catch (e) {
    console.error("[createZohoTask] failed:", (e as Error).message);
    return null;
  }
}

/** Mark a Zoho Task Completed. Best-effort — never throws. */
export async function closeZohoTask(taskId: string): Promise<void> {
  if (!taskId) return;
  try {
    await zohoRequest("PUT", "/Tasks", { data: [{ id: taskId, Status: "Completed" }] });
  } catch (e) {
    console.error("[closeZohoTask] failed:", (e as Error).message);
  }
}

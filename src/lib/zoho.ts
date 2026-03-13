// src/lib/zoho.ts
// Zoho CRM integration with OAuth refresh token flow


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
          // Free-form description for financial + owner details
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


async function zohoRequest(
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

  return response.json();
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
                      Lead_Source: leadData.source || "Meta Ads",
                      Lead_Status: leadData.Lead_Status || "New",
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

  // Financial + owner details go in Description
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
                      data?: Array<{ code: string; message: string; status: string }>;
          };
          const updated = result.data?.[0];
          if (updated && updated.status !== "success" && updated.code !== "SUCCESS") {
                      console.error("[Zoho] updateLead non-success:", JSON.stringify(updated));
          }
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
          const blob = new Blob([pdfBuffer], { type: "application/pdf" });
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

  const result = await response.json() as {
              data?: Array<{ code: string; message: string; status: string }>;
  };
          const item = result.data?.[0];
          if (item && item.status !== "success") {
                      throw new Error(`Zoho attachment non-success: code=${item.code} message=${item.message}`);
          }
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

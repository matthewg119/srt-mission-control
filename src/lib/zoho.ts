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

interface ZohoLeadData {
      firstName?: string;
      lastName?: string;
      businessName?: string;
      email?: string;
      phone?: string;
      source?: string;
      fundingAmount?: string | number;
      monthlyRevenue?: string | number;
      timeInBusiness?: string;
      industry?: string;
      creditScoreRange?: string;
      Lead_Status?: string;
}

interface ZohoApiRecord {
      id?: string;
      First_Name?: string;
      Last_Name?: string;
      Company?: string;
      Email?: string;
      Phone?: string;
      Lead_Source?: string;
      Funding_Amount_Requested?: string | number;
      Monthly_Revenue?: string | number;
      Time_in_Business?: string;
      Industry?: string;
      Credit_Score_Range?: string;
      Lead_Status?: string;
      [key: string]: unknown;
}

interface ZohoSearchCriteria {
      email?: string;
      phone?: string;
      criteria?: string;
}

async function getAccessToken(): Promise<string> {
      // Check cache with 5-minute buffer before expiry
  if (tokenCache && Date.now() < tokenCache.expiresAt - 5 * 60 * 1000) {
          return tokenCache.accessToken;
  }

  const clientId = process.env.ZOHO_CLIENT_ID;
      const clientSecret = process.env.ZOHO_CLIENT_SECRET;
      const refreshToken = process.env.ZOHO_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
          throw new Error(
                    "Missing Zoho OAuth credentials (ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN)"
                  );
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
          throw new Error(
                    `Zoho token request failed: ${response.status} ${response.statusText}`
                  );
  }

  const data: ZohoTokenResponse = await response.json();

  if (data.error) {
          throw new Error(`Zoho token error: ${data.error}`);
  }

  // Cache the token (expires_in is in seconds)
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

  // Handle empty responses (e.g. 204 No Content)
  const text = await response.text();
      if (!text || !text.trim()) {
              return {};
      }

  try {
          return JSON.parse(text);
  } catch {
          throw new Error(`Zoho API returned invalid JSON: ${text.slice(0, 200)}`);
  }
}

export async function createLead(leadData: ZohoLeadData): Promise<string | null> {
      const record: ZohoApiRecord = {
              First_Name: leadData.firstName || "",
              Last_Name: leadData.lastName || leadData.businessName || "Unknown",
              Company: leadData.businessName || "",
              Email: leadData.email || "",
              Phone: leadData.phone || "",
              Lead_Source: leadData.source || "Meta Ads",
              Funding_Amount_Requested: leadData.fundingAmount,
              Monthly_Revenue: leadData.monthlyRevenue,
              Industry: leadData.industry || "",
              Credit_Score_Range: leadData.creditScoreRange || "",
              Time_in_Business: leadData.timeInBusiness || "",
              Lead_Status: leadData.Lead_Status || "New",
      };

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
      await zohoRequest("PUT", `/Leads/${zohoLeadId}`, { data: [updates] });
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

export async function testConnection(): Promise<boolean> {
      try {
              await zohoRequest("GET", "/Leads?per_page=1");
              return true;
      } catch (error) {
              console.error("Zoho connection test failed:", error);
              return false;
      }
}

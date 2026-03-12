const GHL_API_KEY = process.env.GHL_API_KEY || "";
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID || "";
const GHL_BASE_URL = "https://rest.gohighlevel.com/v1";

interface GhlContactParams {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  businessName?: string;
  source?: string;
  tags?: string[];
}

interface GhlOpportunityParams {
  ghlContactId: string;
  name: string;
  stageId: string | null;
  amount?: number;
  source?: string;
}

/**
 * Upsert (create or update) a contact in GoHighLevel.
 * Returns the contact ID if successful, or null on failure.
 */
export async function ghlUpsertContact(
  params: GhlContactParams
): Promise<string | null> {
  if (!GHL_API_KEY || !GHL_LOCATION_ID) {
    console.warn("[GHL] Missing GHL_API_KEY or GHL_LOCATION_ID — skipping contact upsert");
    return null;
  }

  try {
    const payload: Record<string, unknown> = {
      locationId: GHL_LOCATION_ID,
    };

    if (params.firstName) payload.firstName = params.firstName;
    if (params.lastName) payload.lastName = params.lastName;
    if (params.email) payload.email = params.email;
    if (params.phone) payload.phone = params.phone;
    if (params.businessName) payload.companyName = params.businessName;
    if (params.source) payload.source = params.source;
    if (params.tags && params.tags.length > 0) payload.tags = params.tags;

    const res = await fetch(`${GHL_BASE_URL}/contacts/upsert`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GHL_API_KEY}`,
        "Content-Type": "application/json",
        Version: "2021-07-28",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("[GHL] Contact upsert failed:", res.status, errText);
      return null;
    }

    const data = await res.json();
    const contactId: string | null = data?.contact?.id ?? data?.id ?? null;
    console.log("[GHL] Contact upserted:", contactId);
    return contactId;
  } catch (err) {
    console.error("[GHL] Contact upsert error:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Create an opportunity in GoHighLevel for a given contact.
 * Returns the opportunity ID if successful, or null on failure.
 */
export async function ghlCreateOpportunity(
  params: GhlOpportunityParams
): Promise<string | null> {
  if (!GHL_API_KEY || !GHL_LOCATION_ID) {
    console.warn("[GHL] Missing GHL_API_KEY or GHL_LOCATION_ID — skipping opportunity creation");
    return null;
  }

  if (!params.stageId) {
    console.warn("[GHL] No stageId provided — skipping opportunity creation");
    return null;
  }

  try {
    const payload: Record<string, unknown> = {
      title: params.name,
      status: "open",
      stageId: params.stageId,
      contactId: params.ghlContactId,
      locationId: GHL_LOCATION_ID,
    };

    if (params.amount !== undefined && !isNaN(params.amount)) {
      payload.monetaryValue = params.amount;
    }
    if (params.source) payload.source = params.source;

    const res = await fetch(`${GHL_BASE_URL}/opportunities/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GHL_API_KEY}`,
        "Content-Type": "application/json",
        Version: "2021-07-28",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("[GHL] Opportunity creation failed:", res.status, errText);
      return null;
    }

    const data = await res.json();
    const oppId: string | null = data?.opportunity?.id ?? data?.id ?? null;
    return oppId;
  } catch (err) {
    console.error("[GHL] Opportunity creation error:", err instanceof Error ? err.message : err);
    return null;
  }
}

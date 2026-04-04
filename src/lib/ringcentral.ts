// RingCentral API client for Speed to Lead (RingOut)

// ── Config ──

function getConfig() {
  return {
    serverUrl: process.env.RC_SERVER_URL || "https://platform.ringcentral.com",
    clientId: process.env.RC_APP_CLIENT_ID || "",
    clientSecret: process.env.RC_APP_CLIENT_SECRET || "",
    jwt: process.env.RC_USER_JWT || "",
    businessNumber: process.env.RC_BUSINESS_NUMBER || "",
  };
}

// ── Token caching ──

let cachedToken: { access_token: string; expires_at: number } | null = null;

async function getAccessToken(): Promise<string | null> {
  // Return cached token if still valid (60s buffer)
  if (cachedToken && Date.now() < cachedToken.expires_at - 60_000) {
    return cachedToken.access_token;
  }

  const { serverUrl, clientId, clientSecret, jwt } = getConfig();
  if (!clientId || !clientSecret || !jwt) {
    console.error("[RingCentral] Missing RC_APP_CLIENT_ID, RC_APP_CLIENT_SECRET, or RC_USER_JWT");
    return null;
  }

  try {
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const res = await fetch(`${serverUrl}/restapi/oauth/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }).toString(),
    });

    const data = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };

    if (!res.ok || !data.access_token) {
      console.error("[RingCentral] Auth failed:", data.error_description || data.error || res.status);
      return null;
    }

    cachedToken = {
      access_token: data.access_token,
      expires_at: Date.now() + (data.expires_in || 3600) * 1000,
    };

    console.log("[RingCentral] Token acquired successfully");
    return cachedToken.access_token;
  } catch (err) {
    console.error("[RingCentral] Auth error:", err instanceof Error ? err.message : err);
    return null;
  }
}

// ── Phone formatter ──

export function formatPhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");

  // 10 digits = US number without country code
  if (digits.length === 10) return `+1${digits}`;
  // 11 digits starting with 1 = US number with country code
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  // Anything else with 10+ digits, take as-is with +
  if (digits.length >= 10) return `+${digits}`;

  // Too short to be a real phone number
  return null;
}

// ── RingOut API ──

export interface RingOutStatus {
  id: string;
  status: {
    callStatus: string; // InProgress, Success, CannotReach, NoAnswer, Error
    callerStatus: string; // InProgress, Success, CannotReach, NoAnswer, Finished
    calleeStatus: string; // InProgress, Success, CannotReach, NoAnswer, Finished
  };
}

export async function initiateRingOut(
  agentPhone: string,
  leadPhone: string,
  agentExtension?: string
): Promise<{ success: boolean; data?: RingOutStatus; error?: string }> {
  const token = await getAccessToken();
  if (!token) return { success: false, error: "No access token" };

  const { serverUrl, businessNumber } = getConfig();

  // Format lead phone and caller ID to E.164 (RingCentral requires it)
  const formattedLead = formatPhone(leadPhone);
  const formattedCallerId = formatPhone(businessNumber);

  if (!formattedLead || !formattedCallerId) {
    const missing = [
      !formattedLead && "leadPhone",
      !formattedCallerId && "businessNumber",
    ].filter(Boolean).join(", ");
    console.error(`[RingCentral] Invalid phone number(s): ${missing}`);
    return { success: false, error: `Invalid phone number(s): ${missing}` };
  }

  // Format agent phone — append *ext to bypass IVR and ring extension directly
  const formattedAgent = formatPhone(agentPhone);
  if (!formattedAgent) {
    console.error("[RingCentral] Invalid agentPhone");
    return { success: false, error: "Invalid agentPhone" };
  }
  const agentDialString = agentExtension ? `${formattedAgent}*${agentExtension}` : formattedAgent;
  console.log(`[RingCentral] RingOut: from=${agentDialString}, to=${formattedLead}, callerId=${formattedCallerId}`);

  try {
    const res = await fetch(
      `${serverUrl}/restapi/v1.0/account/~/extension/~/ring-out`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: { phoneNumber: agentDialString },
          to: { phoneNumber: formattedLead },
          callerId: { phoneNumber: formattedCallerId },
          playPrompt: true,
        }),
      }
    );

    const data = (await res.json()) as RingOutStatus & {
      error?: string;
      message?: string;
    };

    if (!res.ok) {
      const errMsg = data.message || data.error || `HTTP ${res.status}`;
      console.error("[RingCentral] RingOut initiation failed:", errMsg, "Full response:", JSON.stringify(data));
      return { success: false, error: errMsg };
    }

    console.log(`[RingCentral] RingOut initiated: ${data.id}`);
    return { success: true, data };
  } catch (err) {
    console.error("[RingCentral] RingOut error:", err instanceof Error ? err.message : err);
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function getRingOutStatus(
  ringoutId: string
): Promise<{ success: boolean; data?: RingOutStatus; error?: string }> {
  const token = await getAccessToken();
  if (!token) return { success: false, error: "No access token" };

  const { serverUrl } = getConfig();

  try {
    const res = await fetch(
      `${serverUrl}/restapi/v1.0/account/~/extension/~/ring-out/${ringoutId}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (res.status === 404) {
      return { success: true, data: { id: ringoutId, status: { callStatus: "Error", callerStatus: "Finished", calleeStatus: "Finished" } } };
    }

    const data = (await res.json()) as RingOutStatus;
    if (!res.ok) {
      return { success: false, error: `HTTP ${res.status}` };
    }

    return { success: true, data };
  } catch (err) {
    console.error("[RingCentral] Status check error:", err instanceof Error ? err.message : err);
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function cancelRingOut(ringoutId: string): Promise<void> {
  const token = await getAccessToken();
  if (!token) return;

  const { serverUrl } = getConfig();

  try {
    await fetch(
      `${serverUrl}/restapi/v1.0/account/~/extension/~/ring-out/${ringoutId}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      }
    );
  } catch (err) {
    console.error("[RingCentral] Cancel error:", err instanceof Error ? err.message : err);
  }
}

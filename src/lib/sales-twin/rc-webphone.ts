// Sales Twin — RingCentral WebPhone credentials (SEPARATE app from Speed to Lead).
//
// The browser softphone uses its OWN RingCentral app (with the "VoIP Calling"
// permission) so Speed to Lead's app + JWT are never touched. This mints a token
// from the RC_WEBPHONE_* env vars via the same jwt-bearer flow as
// src/lib/ringcentral.ts, but with its own token cache and config.
//
// Fallback: if the RC_WEBPHONE_* vars aren't set, it falls back to the shared
// RC_* vars — so a single-app setup still works without code changes.

function getWebPhoneConfig() {
  return {
    serverUrl: process.env.RC_SERVER_URL || "https://platform.ringcentral.com",
    clientId: process.env.RC_WEBPHONE_CLIENT_ID || process.env.RC_APP_CLIENT_ID || "",
    clientSecret: process.env.RC_WEBPHONE_CLIENT_SECRET || process.env.RC_APP_CLIENT_SECRET || "",
    jwt: process.env.RC_WEBPHONE_JWT || process.env.RC_USER_JWT || "",
    // Caller ID for outbound softphone calls — defaults to the shared business number.
    businessNumber: process.env.RC_WEBPHONE_BUSINESS_NUMBER || process.env.RC_BUSINESS_NUMBER || "",
  };
}

export function getWebPhoneBusinessNumber(): string {
  return getWebPhoneConfig().businessNumber;
}

export function getWebPhoneServerUrl(): string {
  return getWebPhoneConfig().serverUrl;
}

// Token cache scoped to the WebPhone app (independent of the Speed-to-Lead cache).
let cachedToken: { access_token: string; expires_at: number } | null = null;

export async function getWebPhoneToken(): Promise<string | null> {
  if (cachedToken && Date.now() < cachedToken.expires_at - 60_000) {
    return cachedToken.access_token;
  }

  const { serverUrl, clientId, clientSecret, jwt } = getWebPhoneConfig();
  if (!clientId || !clientSecret || !jwt) {
    console.error("[sales-twin webphone] Missing RC_WEBPHONE_CLIENT_ID / RC_WEBPHONE_CLIENT_SECRET / RC_WEBPHONE_JWT");
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
      console.error("[sales-twin webphone] Auth failed:", data.error_description || data.error || res.status);
      return null;
    }

    cachedToken = {
      access_token: data.access_token,
      expires_at: Date.now() + (data.expires_in || 3600) * 1000,
    };
    return cachedToken.access_token;
  } catch (err) {
    console.error("[sales-twin webphone] Auth error:", err instanceof Error ? err.message : err);
    return null;
  }
}

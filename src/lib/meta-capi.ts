import { createHash } from "crypto";

const API_VERSION = "v21.0";

function getConfig() {
  return {
    pixelId: process.env.META_PIXEL_ID || "",
    accessToken: process.env.META_CAPI_TOKEN || "",
    testCode: process.env.META_CAPI_TEST_CODE || "",
  };
}

// ── Hashing ──

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashForMeta(value: string | undefined): string | undefined {
  if (!value || !value.trim()) return undefined;
  return sha256(value.trim().toLowerCase());
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  // Prepend US country code if 10 digits
  if (digits.length === 10) return "1" + digits;
  return digits;
}

// ── Types ──

export interface MetaUserData {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  city?: string;
  state?: string;
  zip?: string;
  fbc?: string; // _fbc cookie — NOT hashed
  fbp?: string; // _fbp cookie — NOT hashed
  clientIpAddress?: string;
  clientUserAgent?: string;
  externalId?: string; // GHL contactId
}

export interface MetaEvent {
  eventName: "Lead" | "CompleteRegistration" | "Purchase" | "PageView" | "InitiateCheckout";
  eventTime?: number;
  eventId?: string;
  eventSourceUrl?: string;
  userData: MetaUserData;
  customData?: Record<string, unknown>;
  actionSource: "website" | "system_generated";
}

// ── Build payload ──

function buildUserDataPayload(userData: MetaUserData): Record<string, unknown> {
  const d: Record<string, unknown> = {};

  if (userData.email) d.em = [hashForMeta(userData.email)];
  if (userData.phone) d.ph = [sha256(normalizePhone(userData.phone))];
  if (userData.firstName) d.fn = [hashForMeta(userData.firstName)];
  if (userData.lastName) d.ln = [hashForMeta(userData.lastName)];
  if (userData.city) d.ct = [hashForMeta(userData.city)];
  if (userData.state) d.st = [hashForMeta(userData.state)];
  if (userData.zip) d.zp = [sha256(userData.zip.trim().slice(0, 5))];
  if (userData.externalId) d.external_id = [sha256(userData.externalId.trim())];

  // These are NOT hashed
  if (userData.fbc) d.fbc = userData.fbc;
  if (userData.fbp) d.fbp = userData.fbp;
  if (userData.clientIpAddress) d.client_ip_address = userData.clientIpAddress;
  if (userData.clientUserAgent) d.client_user_agent = userData.clientUserAgent;

  return d;
}

// ── Send event ──

export async function sendEvent(
  event: MetaEvent
): Promise<{ success: boolean; response?: unknown; error?: string }> {
  const { pixelId, accessToken, testCode } = getConfig();

  if (!pixelId || !accessToken) {
    console.warn("[Meta CAPI] Missing META_PIXEL_ID or META_CAPI_TOKEN — skipping");
    return { success: false, error: "Missing configuration" };
  }

  const endpoint = `https://graph.facebook.com/${API_VERSION}/${pixelId}/events`;

  const payload: Record<string, unknown> = {
    data: [
      {
        event_name: event.eventName,
        event_time: event.eventTime || Math.floor(Date.now() / 1000),
        ...(event.eventId ? { event_id: event.eventId } : {}),
        event_source_url: event.eventSourceUrl || "https://srtagency.com",
        action_source: event.actionSource,
        user_data: buildUserDataPayload(event.userData),
        ...(event.customData ? { custom_data: event.customData } : {}),
      },
    ],
    ...(testCode ? { test_event_code: testCode } : {}),
  };

  try {
    const res = await fetch(`${endpoint}?access_token=${accessToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (!res.ok) {
      console.error("[Meta CAPI] Error:", JSON.stringify(data));
      return { success: false, error: JSON.stringify(data) };
    }

    console.log(`[Meta CAPI] ${event.eventName} sent successfully`);
    return { success: true, response: data };
  } catch (err) {
    console.error("[Meta CAPI] Network error:", err);
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

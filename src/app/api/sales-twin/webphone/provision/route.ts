// Sales Twin — WebPhone SIP provisioning (server).
// Reuses the existing RingCentral JWT->access-token flow (src/lib/ringcentral.ts),
// then provisions a WebRTC softphone device via /client-info/sip-provision and
// returns the SIP info to the browser WebPhone SDK.
//
// If the RingCentral app lacks the "VoIP Calling" permission, sip-provision
// returns 403 / feature-not-available — we surface a clear { error: "voip_not_enabled" }
// (HTTP 200) so the kiosk can show an enable-VoIP message instead of crashing.

import { NextResponse } from "next/server";
import { getWebPhoneToken, getWebPhoneBusinessNumber, getWebPhoneServerUrl } from "@/lib/sales-twin/rc-webphone";

export const dynamic = "force-dynamic";

export async function GET() {
  const token = await getWebPhoneToken();
  if (!token) {
    return NextResponse.json(
      { error: "rc_auth_failed", message: "RingCentral auth failed — check RC_WEBPHONE_CLIENT_ID / RC_WEBPHONE_CLIENT_SECRET / RC_WEBPHONE_JWT." },
      { status: 500 }
    );
  }

  const serverUrl = getWebPhoneServerUrl();
  const businessNumber = getWebPhoneBusinessNumber();

  let res: Response;
  try {
    res = await fetch(`${serverUrl}/restapi/v1.0/client-info/sip-provision`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sipInfo: [{ transport: "WSS" }] }),
    });
  } catch (err) {
    console.error("[sales-twin webphone] sip-provision network error:", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: "rc_network_error", message: "Could not reach RingCentral to provision the softphone." },
      { status: 502 }
    );
  }

  const text = await res.text();

  if (!res.ok) {
    const lower = text.toLowerCase();
    const voipMissing =
      res.status === 403 ||
      lower.includes("voip") ||
      lower.includes("feature") ||
      lower.includes("not available") ||
      lower.includes("not enabled") ||
      lower.includes("permission");

    if (voipMissing) {
      console.error("[sales-twin webphone] VoIP Calling not enabled on RC app:", res.status, text);
      return NextResponse.json({
        error: "voip_not_enabled",
        message:
          "RingCentral 'VoIP Calling' is not enabled on this app. Enable it in the RingCentral developer console (app → Auth & Permissions → add 'VoIP Calling'), then retry.",
      });
    }

    console.error("[sales-twin webphone] sip-provision failed:", res.status, text);
    return NextResponse.json(
      { error: "sip_provision_failed", message: `RingCentral sip-provision failed (HTTP ${res.status}).` },
      { status: 502 }
    );
  }

  let provision: unknown;
  try {
    provision = JSON.parse(text);
  } catch {
    return NextResponse.json(
      { error: "sip_provision_parse", message: "Unexpected sip-provision response." },
      { status: 502 }
    );
  }

  // The browser WebPhone SDK uses provision.sipInfo[0]; we also pass the caller-ID
  // business number so no NEXT_PUBLIC_* env is needed client-side.
  return NextResponse.json({ provision, businessNumber });
}

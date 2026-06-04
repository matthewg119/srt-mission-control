// Sales Twin — browser WebPhone wrapper (client-only).
//
// Thin wrapper over ringcentral-web-phone (v2 WebRTC softphone). The SDK touches
// browser-only APIs (RTCPeerConnection, getUserMedia, document) and is ESM, so it
// is dynamically imported and this module must only be loaded client-side (the
// kiosk dynamic-imports it inside its mount effect).
//
// Provisioning runs server-side (/api/sales-twin/webphone/provision) so RC creds
// never reach the browser; here we just consume the returned sipInfo.
//
// Exposes the remote MediaStream (getRemoteStream + onRemoteStream) for Phase 3
// live transcription, even though Phase 2 doesn't consume it yet.

import { formatPhone } from "@/lib/ringcentral";

// Thrown when the RC app lacks the "VoIP Calling" permission — the dialer catches
// this to show the enable-VoIP message instead of crashing / falling back.
export class VoipNotEnabledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VoipNotEnabledError";
  }
}

type AnyCallSession = {
  on: (event: string, cb: (...args: any[]) => void) => void;
  hangup: () => Promise<void>;
  state: string;
  mediaStream?: MediaStream;
};

export interface WebPhoneCallbacks {
  onRinging?: () => void;
  onAnswered?: () => void;
  onEnded?: () => void;
  onRemoteStream?: (stream: MediaStream) => void;
}

export class SalesTwinWebPhone {
  private wp: any = null;
  private session: AnyCallSession | null = null;
  private businessNumber = "";
  // Reassigned by the dialer before each call so handlers target the active dial.
  callbacks: WebPhoneCallbacks = {};

  get isConnected() {
    return !!this.wp;
  }

  // Provision + register the softphone. Throws VoipNotEnabledError when the RC
  // app can't provision a WebRTC device.
  async connect(): Promise<void> {
    if (this.wp) return;

    const res = await fetch("/api/sales-twin/webphone/provision");
    const data = await res.json();

    if (data?.error === "voip_not_enabled") {
      throw new VoipNotEnabledError(data.message || "RingCentral 'VoIP Calling' is not enabled on this app.");
    }
    if (data?.error || !data?.provision?.sipInfo?.[0]) {
      throw new Error(data?.message || "Failed to provision RingCentral softphone.");
    }

    this.businessNumber = data.businessNumber || "";
    const sipInfo = data.provision.sipInfo[0];

    const mod = await import("ringcentral-web-phone");
    const WebPhone = (mod.default || mod) as any;
    this.wp = new WebPhone({ sipInfo });
    await this.wp.start();
  }

  // Place an outbound call. Numbers go to the SDK as plain digits (E.164 without
  // the leading +). Caller ID defaults to the RC business number.
  async call(toNumber: string, fromNumber?: string): Promise<void> {
    if (!this.wp) throw new Error("WebPhone not connected — call connect() first.");

    const callee = stripPlus(formatPhone(toNumber));
    const callerId = stripPlus(formatPhone(fromNumber || this.businessNumber));
    if (!callee) throw new Error(`Invalid lead phone number: ${toNumber}`);

    const session = (await this.wp.call(callee, callerId || undefined)) as AnyCallSession;
    this.session = session;

    session.on("ringing", () => this.callbacks.onRinging?.());
    session.on("answered", () => this.callbacks.onAnswered?.());
    session.on("mediaStreamSet", (stream: MediaStream) => this.callbacks.onRemoteStream?.(stream));
    // disposed = call ended (normal); failed = could not connect. Both end this dial.
    session.on("disposed", () => this.handleEnded(session));
    session.on("failed", () => this.handleEnded(session));
  }

  private handleEnded(session: AnyCallSession) {
    if (this.session === session) this.session = null;
    this.callbacks.onEnded?.();
  }

  async hangup(): Promise<void> {
    const s = this.session;
    if (!s) return;
    try {
      await s.hangup();
    } catch {
      /* already gone */
    }
    if (this.session === s) this.session = null;
  }

  // Remote call audio — exposed for Phase 3 (live transcription).
  getRemoteStream(): MediaStream | undefined {
    return this.session?.mediaStream;
  }

  isOnCall(): boolean {
    return !!this.session && this.session.state !== "disposed" && this.session.state !== "failed";
  }

  async dispose(): Promise<void> {
    try {
      await this.hangup();
      if (this.wp) await this.wp.dispose();
    } catch {
      /* ignore */
    }
    this.wp = null;
    this.session = null;
  }
}

function stripPlus(e164: string | null): string | null {
  return e164 ? e164.replace(/^\+/, "") : null;
}

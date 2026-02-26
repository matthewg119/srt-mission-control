// GHL Conversations & Messaging API client

const BASE_URL = "https://services.leadconnectorhq.com";

class GHLMessagingClient {
  private apiKey: string;
  private locationId: string;

  constructor() {
    this.apiKey = process.env.GHL_API_KEY || "";
    this.locationId = process.env.GHL_LOCATION_ID || "";
  }

  private async request(endpoint: string, options: RequestInit = {}): Promise<Record<string, unknown>> {
    const response = await fetch(`${BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Version: "2021-07-28",
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get("retry-after") || "2", 10);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      return this.request(endpoint, options);
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`GHL Messaging API error ${response.status}: ${error}`);
    }

    return response.json();
  }

  // Get conversations list
  async getConversations(params?: {
    limit?: number;
    status?: "all" | "read" | "unread" | "starred";
  }): Promise<Record<string, unknown>> {
    const searchParams = new URLSearchParams({
      locationId: this.locationId,
    });
    if (params?.limit) searchParams.set("limit", String(params.limit));
    if (params?.status) searchParams.set("status", params.status);

    return this.request(`/conversations/search?${searchParams.toString()}`);
  }

  // Get messages for a conversation
  async getMessages(conversationId: string, params?: {
    limit?: number;
    lastMessageId?: string;
  }): Promise<Record<string, unknown>> {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set("limit", String(params.limit));
    if (params?.lastMessageId) searchParams.set("lastMessageId", params.lastMessageId);

    const query = searchParams.toString() ? `?${searchParams.toString()}` : "";
    return this.request(`/conversations/${conversationId}/messages${query}`);
  }

  // Send a message (SMS or Email)
  async sendMessage(params: {
    contactId: string;
    type: "SMS" | "Email";
    message?: string;
    subject?: string;
    html?: string;
  }): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = {
      type: params.type,
      contactId: params.contactId,
    };

    if (params.type === "SMS") {
      body.message = params.message;
    } else {
      body.subject = params.subject;
      body.html = params.html || params.message;
      body.emailFrom = `SRT Agency <noreply@srtagency.com>`;
    }

    return this.request(`/conversations/messages`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  // Get a single conversation
  async getConversation(conversationId: string): Promise<Record<string, unknown>> {
    return this.request(`/conversations/${conversationId}`);
  }

  // Search contacts (for composing new messages)
  async searchContacts(query: string): Promise<Record<string, unknown>> {
    return this.request(
      `/contacts/search?locationId=${this.locationId}&query=${encodeURIComponent(query)}`
    );
  }
}

export const ghlMessaging = new GHLMessagingClient();

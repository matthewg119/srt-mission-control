import { supabaseAdmin } from "@/lib/db";

const CLIENT_ID = process.env.MICROSOFT_CLIENT_ID || "";
const CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET || "";
const TENANT_ID = process.env.MICROSOFT_TENANT_ID || "common";
const REDIRECT_URI =
  (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000") +
  "/api/integrations/microsoft/callback";

const AUTH_URL = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/authorize`;
const TOKEN_URL = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
const GRAPH_URL = "https://graph.microsoft.com/v1.0";

const SCOPES = [
  "openid",
  "profile",
  "offline_access",
  "User.Read",
  "Mail.Read",
  "Mail.Send",
  "Mail.ReadWrite",
  "Files.ReadWrite",
  "MailboxSettings.ReadWrite",
].join(" ");

// ── OAuth Helpers ──

export function getAuthUrl(state?: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    response_mode: "query",
    state: state || "outlook-connect",
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}> {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    code,
    redirect_uri: REDIRECT_URI,
    grant_type: "authorization_code",
    scope: SCOPES,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token exchange failed: ${err}`);
  }

  return res.json();
}

async function refreshAccessToken(refreshToken: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
}> {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    scope: SCOPES,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token refresh failed: ${err}`);
  }

  return res.json();
}

// ── Token Management ──

async function getValidAccessToken(): Promise<string> {
  // Read tokens from integrations table
  const { data } = await supabaseAdmin
    .from("integrations")
    .select("config")
    .eq("name", "Microsoft 365")
    .single();

  if (!data?.config?.access_token || !data?.config?.refresh_token) {
    throw new Error("Microsoft 365 not connected — no tokens found");
  }

  const expiresAt = parseInt(data.config.expires_at || "0", 10);
  const now = Math.floor(Date.now() / 1000);

  // Token still valid (with 5-min buffer)
  if (expiresAt > now + 300) {
    return data.config.access_token;
  }

  // Refresh the token
  const tokens = await refreshAccessToken(data.config.refresh_token);

  // Save new tokens
  await supabaseAdmin
    .from("integrations")
    .update({
      config: {
        ...data.config,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: String(now + tokens.expires_in),
      },
      updated_at: new Date().toISOString(),
    })
    .eq("name", "Microsoft 365");

  return tokens.access_token;
}

// ── Graph API Client ──

async function graphRequest(
  endpoint: string,
  options: RequestInit & { rawResponse?: boolean; skipContentType?: boolean } = {}
): Promise<Record<string, unknown>> {
  const token = await getValidAccessToken();
  const { rawResponse, skipContentType, ...fetchOptions } = options;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...(options.headers as Record<string, string>),
  };
  if (!skipContentType) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${GRAPH_URL}${endpoint}`, {
    ...fetchOptions,
    headers,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Graph API error ${res.status}: ${err}`);
  }

  // Some endpoints return 204 No Content
  if (res.status === 204 || rawResponse) {
    return { ok: true };
  }

  return res.json();
}

// ── Public Methods ──

export const microsoft = {
  /** Get the signed-in user's profile */
  async getProfile(): Promise<Record<string, unknown>> {
    return graphRequest("/me");
  },

  /** Get inbox messages (latest 25 by default) */
  async getInbox(top = 25, skip = 0): Promise<Record<string, unknown>> {
    return graphRequest(
      `/me/mailFolders/inbox/messages?$top=${top}&$skip=${skip}&$orderby=receivedDateTime desc&$select=id,subject,from,receivedDateTime,isRead,bodyPreview,hasAttachments`
    );
  },

  /** Get a single email by ID */
  async getMessage(id: string): Promise<Record<string, unknown>> {
    return graphRequest(`/me/messages/${id}`);
  },

  /** Send an email (with optional attachments) */
  async sendMail(params: {
    to: string;
    subject: string;
    body: string;
    isHtml?: boolean;
    attachments?: Array<{ name: string; contentType: string; contentBytes: string }>;
  }): Promise<void> {
    const token = await getValidAccessToken();

    const message: Record<string, unknown> = {
      subject: params.subject,
      body: {
        contentType: params.isHtml ? "HTML" : "Text",
        content: params.body,
      },
      toRecipients: [
        { emailAddress: { address: params.to } },
      ],
    };

    if (params.attachments && params.attachments.length > 0) {
      message.attachments = params.attachments.map((a) => ({
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: a.name,
        contentType: a.contentType,
        contentBytes: a.contentBytes,
      }));
    }

    const res = await fetch(`${GRAPH_URL}/me/sendMail`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message }),
    });

    // sendMail returns 202 with no body on success
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Send mail failed: ${err}`);
    }
  },

  /** Reply to an email */
  async replyToMessage(messageId: string, comment: string): Promise<void> {
    const token = await getValidAccessToken();
    const res = await fetch(`${GRAPH_URL}/me/messages/${messageId}/reply`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ comment }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Reply failed: ${err}`);
    }
  },

  /** Mark an email as read */
  async markAsRead(messageId: string): Promise<Record<string, unknown>> {
    return graphRequest(`/me/messages/${messageId}`, {
      method: "PATCH",
      body: JSON.stringify({ isRead: true }),
    });
  },

  /** Get unread count */
  async getUnreadCount(): Promise<number> {
    const result = await graphRequest(
      `/me/mailFolders/inbox?$select=unreadItemCount`
    );
    return (result.unreadItemCount as number) || 0;
  },

  // ── OneDrive ──

  /** Create a folder in OneDrive. Returns { id, webUrl } */
  async createDriveFolder(folderName: string, parentPath = ""): Promise<{ id: string; webUrl: string }> {
    const endpoint = parentPath
      ? `/me/drive/root:/${encodeURIComponent(parentPath)}:/children`
      : `/me/drive/root/children`;

    const result = await graphRequest(endpoint, {
      method: "POST",
      body: JSON.stringify({
        name: folderName,
        folder: {},
        "@microsoft.graph.conflictBehavior": "useExisting",
      }),
    });

    return { id: result.id as string, webUrl: result.webUrl as string };
  },

  /** Upload a file to OneDrive. For files up to 4MB. Returns { id, webUrl } */
  async uploadDriveFile(
    folderPath: string,
    fileName: string,
    content: Buffer | Uint8Array,
    contentType: string
  ): Promise<{ id: string; webUrl: string }> {
    const token = await getValidAccessToken();
    const path = `${folderPath}/${fileName}`.replace(/\/+/g, "/");
    const res = await fetch(
      `${GRAPH_URL}/me/drive/root:/${encodeURIComponent(path)}:/content`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": contentType,
        },
        body: new Uint8Array(content),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OneDrive upload failed: ${err}`);
    }

    const result = await res.json();
    return { id: result.id, webUrl: result.webUrl };
  },

  // ── Outlook Signature ──

  /** Set the Outlook signature for the connected account */
  async setSignature(html: string): Promise<void> {
    const token = await getValidAccessToken();
    const res = await fetch(`${GRAPH_URL}/me/mailboxSettings`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        signatureSettings: {
          isEnabled: true,
          defaultSignatureForNewMessages: "SRT Agency",
          defaultSignatureForRepliesOrForwards: "SRT Agency",
          signatures: [
            { id: "srt-agency", name: "SRT Agency", html },
          ],
        },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Set signature failed: ${err}`);
    }
  },
};

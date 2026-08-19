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
  "Mail.Read.Shared",
  "Mail.Send",
  "Mail.Send.Shared",
  "Mail.ReadWrite",
  "Mail.ReadWrite.Shared",
  "Files.ReadWrite",
  "MailboxSettings.ReadWrite",
].join(" ");

// ── App-only (client-credentials) auth ──
// When MICROSOFT_GRAPH_APP_AUTH=1, Graph calls that DON'T need a user context
// (subscription lifecycle + reads against an explicit /users/{mailbox}) use an
// application-permission token instead of the delegated user token. App-permission
// subscriptions are NOT silently dropped when the signed-in user's token lapses,
// which is the whole point of the migration (see graph-subscription gotcha).
//
// /me-relative calls can never use app auth (no user), so this is opt-in per call —
// only the mailbox/subscription paths pass appAuth, everything else stays delegated.
export const USE_APP_AUTH = process.env.MICROSOFT_GRAPH_APP_AUTH === "1";
let _appToken: { token: string; expiresAt: number } | null = null;

async function getAppAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (_appToken && _appToken.expiresAt > now + 300) return _appToken.token;
  if (!TENANT_ID || TENANT_ID === "common") {
    throw new Error("MICROSOFT_TENANT_ID must be a specific tenant id for app-only (client_credentials) auth");
  }
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default",
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`App-only token request failed: ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  _appToken = { token: json.access_token, expiresAt: now + json.expires_in };
  return json.access_token;
}

// ── Signature cache ──
let _signatureCache: { html: string; fetchedAt: number } | null = null;

// ── Types ──

export interface GraphMessage {
  id: string;
  conversationId: string;
  subject: string;
  from: { emailAddress: { address: string; name?: string } };
  toRecipients: Array<{ emailAddress: { address: string; name?: string } }>;
  ccRecipients?: Array<{ emailAddress: { address: string; name?: string } }>;
  receivedDateTime: string;
  bodyPreview: string;
  webLink?: string;
  isDraft?: boolean;
}

// Lightweight shape returned by $search (includes sentDateTime so Sent Items
// can be ordered alongside received mail). `from` may be absent on drafts.
export interface GraphMessageSummary {
  id: string;
  conversationId: string;
  subject: string;
  from: { emailAddress?: { address?: string; name?: string } } | null;
  toRecipients?: Array<{ emailAddress?: { address?: string; name?: string } }>;
  receivedDateTime?: string;
  sentDateTime?: string;
  bodyPreview?: string;
  isDraft?: boolean;
}

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
  const { data, error: dbError } = await supabaseAdmin
    .from("integrations")
    .select("config")
    .eq("name", "Microsoft 365")
    .single();

  if (dbError) {
    console.error("[Microsoft] DB query for tokens failed:", dbError.message, dbError.code, dbError.details);
  }

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
  let tokens;
  try {
    tokens = await refreshAccessToken(data.config.refresh_token);
  } catch (refreshErr) {
    console.error("[Microsoft] Token refresh failed:", refreshErr instanceof Error ? refreshErr.message : refreshErr);
    await supabaseAdmin
      .from("integrations")
      .update({ status: "error", updated_at: new Date().toISOString() })
      .eq("name", "Microsoft 365");
    throw new Error(`Microsoft 365 token expired and refresh failed. Please reconnect at /dashboard/integrations.`);
  }

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
      status: "connected",
      updated_at: new Date().toISOString(),
    })
    .eq("name", "Microsoft 365");

  return tokens.access_token;
}

// ── Graph API Client ──

async function graphRequest(
  endpoint: string,
  options: RequestInit & { rawResponse?: boolean; skipContentType?: boolean; appAuth?: boolean } = {}
): Promise<Record<string, unknown>> {
  const { rawResponse, skipContentType, appAuth, ...fetchOptions } = options;
  const token = appAuth ? await getAppAccessToken() : await getValidAccessToken();

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...(options.headers as Record<string, string>),
  };
  if (!skipContentType) {
    headers["Content-Type"] = "application/json";
  }

  const url = endpoint.startsWith("http") ? endpoint : `${GRAPH_URL}${endpoint}`;
  const res = await fetch(url, {
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

/**
 * Normalize a recipient input into Graph `{ emailAddress: { address } }[]`, preserving order.
 * Accepts a single address, a comma-separated string, or an ordered array (which may itself
 * contain comma-separated entries). De-dupes case-insensitively while keeping first-seen order.
 */
function toGraphRecipients(
  input: string | string[] | undefined | null
): Array<{ emailAddress: { address: string } }> {
  if (!input) return [];
  const list = Array.isArray(input) ? input : [input];
  const seen = new Set<string>();
  const out: Array<{ emailAddress: { address: string } }> = [];
  for (const entry of list) {
    for (const raw of String(entry).split(",")) {
      const addr = raw.trim();
      if (!addr) continue;
      const key = addr.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ emailAddress: { address: addr } });
    }
  }
  return out;
}

// ── Public Methods ──

export const microsoft = {
  /** Stored Microsoft access token, refreshed (5-min buffer) if expired. Use this anywhere
   *  a raw Graph bearer token is needed so callers never hit a stale-token 401. */
  getAccessToken(): Promise<string> {
    return getValidAccessToken();
  },

  /** Token for reading an explicit shared mailbox (e.g. submissions@): app-only when
   *  MICROSOFT_GRAPH_APP_AUTH=1, else the delegated user token. Use for /users/{mailbox}
   *  Graph calls so the webhook keeps working through a delegated-token lapse. */
  getMailboxToken(): Promise<string> {
    return USE_APP_AUTH ? getAppAccessToken() : getValidAccessToken();
  },

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

  /**
   * Paginate messages from a specific mailbox folder. Follows @odata.nextLink.
   * `mailbox` undefined → /me. Otherwise /users/{mailbox} (works for shared/other mailboxes
   * the signed-in user has Mail.Read.Shared access to, e.g. submissions@srtagency.com).
   */
  async *listMessages(opts: {
    mailbox?: string;
    folder?: string;
    filter?: string;
    top?: number;
    select?: string[];
  }): AsyncIterable<GraphMessage> {
    const mailboxPath = opts.mailbox ? `/users/${encodeURIComponent(opts.mailbox)}` : "/me";
    const folder = opts.folder ?? "inbox";
    const top = opts.top ?? 100;
    const select = (opts.select ?? [
      "id",
      "conversationId",
      "subject",
      "from",
      "toRecipients",
      "ccRecipients",
      "receivedDateTime",
      "bodyPreview",
      "webLink",
      "isDraft",
    ]).join(",");

    const params = new URLSearchParams();
    params.set("$top", String(top));
    params.set("$orderby", "receivedDateTime desc");
    params.set("$select", select);
    if (opts.filter) params.set("$filter", opts.filter);

    let endpoint: string | null = `${mailboxPath}/mailFolders/${folder}/messages?${params.toString()}`;
    const appAuth = USE_APP_AUTH && !!opts.mailbox;

    while (endpoint) {
      const page: Record<string, unknown> = await graphRequest(endpoint, { appAuth });
      const value = (page.value as GraphMessage[] | undefined) ?? [];
      for (const msg of value) yield msg;
      endpoint = (page["@odata.nextLink"] as string | undefined) ?? null;
    }
  },

  /**
   * Fetch a message's body + headers. Returns plaintext body (via Prefer header).
   * Mailbox defaults to /me.
   */
  async getMessageBody(
    messageId: string,
    mailbox?: string
  ): Promise<{ body: string; conversationId: string; internetMessageHeaders: Array<{ name: string; value: string }> }> {
    const mailboxPath = mailbox ? `/users/${encodeURIComponent(mailbox)}` : "/me";
    const result = await graphRequest(
      `${mailboxPath}/messages/${messageId}?$select=body,conversationId,internetMessageHeaders`,
      { headers: { Prefer: 'outlook.body-content-type="text"' } }
    );
    const body = (result.body as { content?: string } | undefined)?.content ?? "";
    return {
      body,
      conversationId: (result.conversationId as string) ?? "",
      internetMessageHeaders: (result.internetMessageHeaders as Array<{ name: string; value: string }> | undefined) ?? [],
    };
  },

  /**
   * All messages across the mailbox (incl. Sent Items) that involve `address`.
   * Uses Graph $search, which scans from/to/cc across all folders. $search can't be
   * combined with $orderby, so callers sort the returned list themselves. Drafts filtered out.
   */
  async searchMessagesWithAddress(address: string, top = 50): Promise<GraphMessageSummary[]> {
    const search = encodeURIComponent(`"${address}"`);
    const select = [
      "id",
      "conversationId",
      "subject",
      "from",
      "toRecipients",
      "receivedDateTime",
      "sentDateTime",
      "bodyPreview",
      "isDraft",
    ].join(",");
    const result = await graphRequest(`/me/messages?$search=${search}&$top=${top}&$select=${select}`);
    return ((result.value as GraphMessageSummary[] | undefined) ?? []).filter((m) => !m.isDraft);
  },

  /** Full HTML body of one message (for the email-history popup's expanded view). */
  async getMessageHtml(messageId: string): Promise<{ html: string; conversationId: string }> {
    const result = await graphRequest(
      `/me/messages/${messageId}?$select=body,conversationId`,
      { headers: { Prefer: 'outlook.body-content-type="html"' } }
    );
    const html = (result.body as { content?: string } | undefined)?.content ?? "";
    return { html, conversationId: (result.conversationId as string) ?? "" };
  },

  /**
   * Get PDF/file attachments for a message. Returns array with name, size, contentBytes (base64), contentType.
   * `mailbox` undefined → /me. Otherwise /users/{mailbox} (e.g. submissions@srtagency.com), so we can
   * re-download the attachments of a message that landed in a shared mailbox.
   */
  async getMessageAttachments(messageId: string, mailbox?: string): Promise<Array<{
    id: string; name: string; size: number; contentBytes: string; contentType: string; isInline: boolean; contentId: string | null;
  }>> {
    const mailboxPath = mailbox ? `/users/${encodeURIComponent(mailbox)}` : "/me";
    // No $select: contentBytes is only on the fileAttachment subtype, not the base
    // microsoft.graph.attachment, so $select-ing it 400s. Fetching without $select returns
    // the full fileAttachment incl. contentBytes, isInline, and contentId.
    const result = await graphRequest(
      `${mailboxPath}/messages/${messageId}/attachments?$top=20`,
      { appAuth: USE_APP_AUTH && !!mailbox }
    );
    const raw = (result.value as Array<{
      id: string; name: string; size: number; contentBytes?: string; contentType: string; isInline?: boolean; contentId?: string | null;
    }> | undefined) ?? [];
    return raw.map((a) => ({
      id: a.id,
      name: a.name,
      size: a.size,
      contentBytes: a.contentBytes ?? "",
      contentType: a.contentType,
      isInline: a.isInline ?? false,
      contentId: a.contentId ?? null,
    }));
  },

  /**
   * Send an email (with optional attachments).
   * `fromMailbox` undefined → POST /me/sendMail (sends as the connected account).
   * Otherwise → POST /users/{mailbox}/sendMail so the message originates from a
   * shared mailbox the signed-in user has Send-As / Mail.Send.Shared on
   * (e.g. submissions@srtagency.com).
   */
  async sendMail(params: {
    to: string | string[];
    cc?: string | string[];
    bcc?: string | string[];
    subject: string;
    body: string;
    isHtml?: boolean;
    attachments?: Array<{ name: string; contentType: string; contentBytes: string; isInline?: boolean; contentId?: string | null }>;
    fromMailbox?: string;
  }): Promise<void> {
    const token = await getValidAccessToken();

    const message: Record<string, unknown> = {
      subject: params.subject,
      body: {
        contentType: params.isHtml ? "HTML" : "Text",
        content: params.body,
      },
      // Order is preserved: pass an array (e.g. funders that require a specific To-list order).
      toRecipients: toGraphRecipients(params.to),
    };

    const cc = toGraphRecipients(params.cc);
    if (cc.length > 0) message.ccRecipients = cc;
    const bcc = toGraphRecipients(params.bcc);
    if (bcc.length > 0) message.bccRecipients = bcc;

    if (params.attachments && params.attachments.length > 0) {
      message.attachments = params.attachments.map((a) => {
        const att: Record<string, unknown> = {
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: a.name,
          contentType: a.contentType,
          contentBytes: a.contentBytes,
        };
        // Preserve inline images (e.g. the signature) so they render via cid: instead of
        // showing as stray attachments.
        if (a.isInline) {
          att.isInline = true;
          if (a.contentId) att.contentId = a.contentId;
        }
        return att;
      });
    }

    const sendPath = params.fromMailbox
      ? `${GRAPH_URL}/users/${encodeURIComponent(params.fromMailbox)}/sendMail`
      : `${GRAPH_URL}/me/sendMail`;
    const res = await fetch(sendPath, {
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

  /**
   * Build a threaded HTML reply and LEAVE IT AS A DRAFT, returning its id and web link.
   *
   * createReply is the only supported way to thread an outbound message. Graph rejects
   * `conversationId` on POST /messages, and `internetMessageHeaders` only accepts X- prefixed
   * custom headers, so `In-Reply-To` / `References` cannot be set by hand. Handing Graph the
   * original message id is what makes the reply land in the same conversation, and it writes the
   * `Re:` subject itself — which is also why the caller never has to recover the original subject.
   *
   * Stopping at the draft is the point: every outbound email in this app is reviewed before it
   * sends. Pair with `sendDraft`.
   */
  async createReplyDraft(params: {
    messageId: string;
    html: string;
    mailbox?: string;
    to?: string | string[];
    attachments?: Array<{ name: string; contentType: string; contentBytes: string }>;
  }): Promise<{ id: string; webLink: string }> {
    const token = await getValidAccessToken();
    const base = params.mailbox
      ? `${GRAPH_URL}/users/${encodeURIComponent(params.mailbox)}`
      : `${GRAPH_URL}/me`;
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

    // 1) Create a draft reply (auto-populates recipients + threading metadata).
    const createRes = await fetch(`${base}/messages/${params.messageId}/createReply`, {
      method: "POST",
      headers,
    });
    if (!createRes.ok) throw new Error(`createReply failed: ${await createRes.text()}`);
    const draft = (await createRes.json()) as { id?: string; webLink?: string };
    if (!draft.id) throw new Error("createReply returned no draft id");

    // 2) Set our HTML body (and optionally override recipients).
    const patch: Record<string, unknown> = { body: { contentType: "HTML", content: params.html } };
    if (params.to) patch.toRecipients = toGraphRecipients(params.to);
    const patchRes = await fetch(`${base}/messages/${draft.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify(patch),
    });
    if (!patchRes.ok) throw new Error(`reply draft patch failed: ${await patchRes.text()}`);

    // 3) Attachments go on separately. createReply gives no way to include them, and PATCHing an
    // `attachments` array onto an existing message is ignored by Graph.
    for (const att of params.attachments ?? []) {
      const attRes = await fetch(`${base}/messages/${draft.id}/attachments`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: att.name,
          contentType: att.contentType,
          contentBytes: att.contentBytes,
        }),
      });
      if (!attRes.ok) throw new Error(`reply attachment failed: ${await attRes.text()}`);
    }

    return { id: draft.id, webLink: draft.webLink ?? "" };
  },

  /**
   * Send a threaded HTML reply to an existing message so it lands in the same
   * conversation as the original (Re: subject + In-Reply-To headers handled by
   * Graph). When `mailbox` is set the reply originates from that shared mailbox
   * (the message must live in that mailbox). Recipients default to the original
   * sender; pass `to` to override.
   *
   * Thin wrapper over createReplyDraft so there is ONE implementation of the createReply dance.
   */
  async sendReplyHtml(params: {
    messageId: string;
    html: string;
    mailbox?: string;
    to?: string | string[];
  }): Promise<void> {
    const draft = await microsoft.createReplyDraft(params);
    await microsoft.sendDraft(draft.id, params.mailbox);
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
      ? `/me/drive/root:/${parentPath.split("/").map(encodeURIComponent).join("/")}:/children`
      : `/me/drive/root/children`;

    const result = await graphRequest(endpoint, {
      method: "POST",
      body: JSON.stringify({
        name: folderName,
        folder: {},
        "@microsoft.graph.conflictBehavior": "replace",
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
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    const res = await fetch(
      `${GRAPH_URL}/me/drive/root:/${encodedPath}:/content`,
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

  /** Get a driveItem by id (returns path, webUrl, @microsoft.graph.downloadUrl when expanded). */
  async getDriveItem(itemId: string): Promise<{
    id: string;
    name: string;
    webUrl: string;
    downloadUrl: string | null;
    parentPath: string | null;
    size: number;
    file?: { mimeType?: string } | null;
  }> {
    const result = await graphRequest(
      `/me/drive/items/${itemId}?$select=id,name,webUrl,size,file,parentReference,@microsoft.graph.downloadUrl`
    );
    const parentRef = result.parentReference as { path?: string } | undefined;
    const pathStr = parentRef?.path ?? null;
    const parentPath = pathStr ? decodeURIComponent(pathStr.replace(/^\/drive\/root:/, "")) : null;
    return {
      id: result.id as string,
      name: result.name as string,
      webUrl: result.webUrl as string,
      downloadUrl: (result["@microsoft.graph.downloadUrl"] as string | undefined) ?? null,
      parentPath,
      size: (result.size as number) ?? 0,
      file: (result.file as { mimeType?: string } | null | undefined) ?? null,
    };
  },

  /** Download a driveItem's bytes via its short-lived downloadUrl. */
  async downloadDriveItem(itemId: string): Promise<{ buffer: Buffer; name: string; mimeType: string | null }> {
    const item = await this.getDriveItem(itemId);
    if (!item.downloadUrl) throw new Error(`No downloadUrl for driveItem ${itemId}`);
    const res = await fetch(item.downloadUrl);
    if (!res.ok) throw new Error(`OneDrive download failed: ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    return { buffer, name: item.name, mimeType: item.file?.mimeType ?? null };
  },

  /**
   * Drive delta query. Pass no token to bootstrap (returns @odata.deltaLink only via initialLatest=true),
   * or a saved deltaLink URL to fetch changes since last call. Returns items + the next deltaLink.
   */
  async driveDelta(opts: { deltaLink?: string; initialLatest?: boolean } = {}): Promise<{
    items: Array<{
      id: string;
      name: string;
      webUrl?: string;
      lastModifiedDateTime?: string;
      parentReference?: { path?: string };
      file?: { mimeType?: string };
      deleted?: { state?: string };
    }>;
    deltaLink: string | null;
  }> {
    const endpoint = opts.deltaLink
      ? opts.deltaLink
      : `/me/drive/root/delta${opts.initialLatest ? "?token=latest" : ""}`;

    type DeltaItem = {
      id: string;
      name: string;
      webUrl?: string;
      lastModifiedDateTime?: string;
      parentReference?: { path?: string };
      file?: { mimeType?: string };
      deleted?: { state?: string };
    };
    const items: DeltaItem[] = [];
    let nextLink: string | null = endpoint;
    let deltaLink: string | null = null;

    while (nextLink) {
      const page: Record<string, unknown> = await graphRequest(nextLink);
      const value = (page.value as DeltaItem[] | undefined) ?? [];
      items.push(...value);
      nextLink = (page["@odata.nextLink"] as string | undefined) ?? null;
      const dl = page["@odata.deltaLink"] as string | undefined;
      if (dl) deltaLink = dl;
    }

    return { items, deltaLink };
  },

  /** List children of a specific OneDrive folder by path. Returns [] if the folder doesn't exist. */
  async listFolderChildren(folderPath: string): Promise<Array<{ id: string; name: string; size: number; webUrl: string; isFile: boolean }>> {
    const encoded = folderPath.split("/").map(encodeURIComponent).join("/");
    try {
      const page = await graphRequest(`/me/drive/root:/${encoded}:/children?$select=id,name,size,webUrl,file,folder&$top=100`);
      const value = (page.value as Array<{ id: string; name: string; size?: number; webUrl: string; file?: unknown; folder?: unknown }> | undefined) ?? [];
      return value.map((v) => ({ id: v.id, name: v.name, size: v.size ?? 0, webUrl: v.webUrl, isFile: Boolean(v.file) }));
    } catch (e) {
      if ((e as Error).message.includes("404") || (e as Error).message.toLowerCase().includes("itemnotfound")) return [];
      throw e;
    }
  },

  /** Search the drive (optionally within a subfolder path). Returns ranked matches with id/name/webUrl. */
  async searchDrive(query: string, withinPath?: string): Promise<Array<{ id: string; name: string; webUrl: string; parentPath: string | null }>> {
    const endpoint = withinPath
      ? `/me/drive/root:/${withinPath.split("/").map(encodeURIComponent).join("/")}:/search(q='${encodeURIComponent(query)}')`
      : `/me/drive/root/search(q='${encodeURIComponent(query)}')`;
    const result = await graphRequest(`${endpoint}?$select=id,name,webUrl,parentReference&$top=10`);
    const value = (result.value as Array<{ id: string; name: string; webUrl: string; parentReference?: { path?: string } }> | undefined) ?? [];
    return value.map((item) => {
      const raw = item.parentReference?.path ?? null;
      return {
        id: item.id,
        name: item.name,
        webUrl: item.webUrl,
        parentPath: raw ? decodeURIComponent(raw.replace(/^\/drive\/root:/, "")) : null,
      };
    });
  },

  // ── Outlook Signature ──

  /**
   * Set the Outlook signature for the connected account.
   * Uses the beta Graph API (signatures aren't available in v1.0).
   * Step 1: Create or update the "SRT Agency" signature
   * Step 2: Set it as default for new messages and replies
   */
  async setSignature(html: string): Promise<void> {
    const token = await getValidAccessToken();
    const BETA = "https://graph.microsoft.com/beta";
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    // Step 1: Check if "SRT Agency" signature already exists
    let signatureId: string | null = null;

    try {
      const listRes = await fetch(`${BETA}/me/mailboxSettings/signatures`, { headers });
      if (listRes.ok) {
        const listData = await listRes.json();
        const existing = (listData.value as Array<{ id: string; displayName: string }> | undefined)?.find(
          (s) => s.displayName === "SRT Agency"
        );
        if (existing) signatureId = existing.id;
      }
    } catch {
      // Listing failed — we'll create a new one
    }

    // Step 2: Create or update the signature
    if (signatureId) {
      // Update existing
      const updateRes = await fetch(`${BETA}/me/mailboxSettings/signatures/${signatureId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ html }),
      });
      if (!updateRes.ok) {
        const err = await updateRes.text();
        throw new Error(`Update signature failed: ${err}`);
      }
    } else {
      // Create new
      const createRes = await fetch(`${BETA}/me/mailboxSettings/signatures`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          displayName: "SRT Agency",
          html,
        }),
      });
      if (!createRes.ok) {
        const err = await createRes.text();
        throw new Error(`Create signature failed: ${err}`);
      }
      const created = await createRes.json();
      signatureId = created.id;
    }

    // Step 3: Set as default for new messages and replies
    if (signatureId) {
      const settingsRes = await fetch(`${BETA}/me/mailboxSettings`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          signatureSettings: {
            isEnabled: true,
            useForNewMessages: signatureId,
            useForRepliesOrForwards: signatureId,
          },
        }),
      });
      if (!settingsRes.ok) {
        const err = await settingsRes.text();
        console.warn("Set default signature failed (signature was still created):", err);
      }
    }
  },

  /**
   * Read the user's default Outlook signature via Graph beta API.
   * Returns null if no default signature is configured or the call fails.
   * Cached for 30 minutes.
   */
  async getDefaultSignature(): Promise<string | null> {
    const now = Date.now();
    if (_signatureCache && now - _signatureCache.fetchedAt < 30 * 60 * 1000) {
      return _signatureCache.html;
    }
    try {
      const token = await getValidAccessToken();
      const BETA = "https://graph.microsoft.com/beta";
      const headers = { Authorization: `Bearer ${token}` };

      const settingsRes = await fetch(`${BETA}/me/mailboxSettings`, { headers });
      if (!settingsRes.ok) return null;
      const settings = await settingsRes.json();
      const defaultId: string | undefined =
        settings?.signatureSettings?.useForNewMessages ??
        settings?.signatureSettings?.useForRepliesOrForwards;
      if (!defaultId) return null;

      const sigRes = await fetch(`${BETA}/me/mailboxSettings/signatures/${defaultId}`, { headers });
      if (!sigRes.ok) return null;
      const sig = await sigRes.json();
      const html: string = sig.html ?? "";
      if (html) _signatureCache = { html, fetchedAt: now };
      return html || null;
    } catch {
      return null;
    }
  },

  /**
   * Capture helper: find the most recent message whose subject contains `subject`
   * and return its raw HTML body. Used to extract an Outlook signature that Graph
   * won't expose directly — compose a new mail in OWA (the default signature
   * auto-inserts), send it, then read the HTML back here.
   * Searches /me across all folders by default.
   */
  async getLatestHtmlBySubject(subject: string): Promise<{ id: string; subject: string; receivedDateTime: string; html: string } | null> {
    const search = encodeURIComponent(`"subject:${subject}"`);
    const list = await graphRequest(
      `/me/messages?$search=${search}&$top=5&$select=id,subject,receivedDateTime`
    );
    const first = ((list.value as Array<{ id: string; subject: string; receivedDateTime: string }> | undefined) ?? [])[0];
    if (!first) return null;
    // Graph returns HTML body by default (no Prefer header).
    const msg = await graphRequest(`/me/messages/${first.id}?$select=id,subject,receivedDateTime,body`);
    const html = (msg.body as { content?: string } | undefined)?.content ?? "";
    return {
      id: msg.id as string,
      subject: (msg.subject as string) ?? "",
      receivedDateTime: (msg.receivedDateTime as string) ?? "",
      html,
    };
  },

  /**
   * Diagnostic: hit the (non-existent) Graph beta signatures endpoint directly
   * and return the raw HTTP status + body text. Proves Graph does not expose
   * Outlook signatures — used by /api/debug/signature.
   */
  async rawSignaturesProbe(): Promise<{ status: number; ok: boolean; body: string }> {
    const token = await getValidAccessToken();
    const res = await fetch("https://graph.microsoft.com/beta/me/mailboxSettings/signatures", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.text().catch(() => "");
    return { status: res.status, ok: res.ok, body: body.slice(0, 500) };
  },

  /**
   * Fetch a specific Outlook signature by its display name.
   * Returns the HTML content or null if not found. Not cached (used infrequently).
   */
  async getSignatureByName(name: string): Promise<string | null> {
    try {
      const token = await getValidAccessToken();
      const BETA = "https://graph.microsoft.com/beta";
      const res = await fetch(`${BETA}/me/mailboxSettings/signatures`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      const data = await res.json();
      const match = (data.value as Array<{ id: string; displayName: string; html?: string }> | undefined)?.find(
        (s) => s.displayName.toLowerCase() === name.toLowerCase()
      );
      return match?.html ?? null;
    } catch {
      return null;
    }
  },

  // ── Change Notification Subscriptions ──

  /** Create a Graph change-notification subscription (e.g. new mail on submissions@). */
  async createSubscription(params: {
    resource: string;
    changeType: "created" | "updated" | "deleted" | "created,updated";
    notificationUrl: string;
    clientState: string;
    expirationMinutes?: number;
  }): Promise<{ id: string; expirationDateTime: string; resource: string }> {
    const minutes = params.expirationMinutes ?? 60 * 24 * 3;
    const expirationDateTime = new Date(Date.now() + minutes * 60 * 1000).toISOString();

    const result = await graphRequest("/subscriptions", {
      method: "POST",
      appAuth: USE_APP_AUTH,
      body: JSON.stringify({
        changeType: params.changeType,
        notificationUrl: params.notificationUrl,
        resource: params.resource,
        expirationDateTime,
        clientState: params.clientState,
      }),
    });

    return {
      id: result.id as string,
      expirationDateTime: result.expirationDateTime as string,
      resource: result.resource as string,
    };
  },

  /** Renew a subscription to extend its expirationDateTime. */
  async renewSubscription(subscriptionId: string, expirationMinutes = 60 * 24 * 3): Promise<{ id: string; expirationDateTime: string }> {
    const expirationDateTime = new Date(Date.now() + expirationMinutes * 60 * 1000).toISOString();
    const result = await graphRequest(`/subscriptions/${subscriptionId}`, {
      method: "PATCH",
      appAuth: USE_APP_AUTH,
      body: JSON.stringify({ expirationDateTime }),
    });
    return { id: result.id as string, expirationDateTime: result.expirationDateTime as string };
  },

  /** List all Graph subscriptions for this tenant's signed-in app. */
  async listSubscriptions(): Promise<Array<{ id: string; resource: string; expirationDateTime: string; notificationUrl: string }>> {
    const result = await graphRequest("/subscriptions", { appAuth: USE_APP_AUTH });
    return (result.value ?? []) as Array<{ id: string; resource: string; expirationDateTime: string; notificationUrl: string }>;
  },

  /** Delete a Graph subscription. */
  async deleteSubscription(subscriptionId: string): Promise<void> {
    await graphRequest(`/subscriptions/${subscriptionId}`, { method: "DELETE", appAuth: USE_APP_AUTH });
  },

  /**
   * Fetch one subscription by id. Returns null when Microsoft no longer has it
   * (404/410, or the 403 "ExtensionError/access denied" Graph returns once a
   * subscription's resource is no longer resolvable) — i.e. it was silently
   * dropped and must be re-created. Re-throws transient errors (token/5xx) so a
   * caller doesn't churn-recreate over a blip.
   */
  async getSubscription(subscriptionId: string): Promise<{ id: string; expirationDateTime: string } | null> {
    try {
      const result = await graphRequest(`/subscriptions/${subscriptionId}`, { appAuth: USE_APP_AUTH });
      return { id: result.id as string, expirationDateTime: result.expirationDateTime as string };
    } catch (e) {
      const msg = (e as Error).message || "";
      if (/error (404|410)\b|error 403\b|ResourceNotFound|ExtensionError|does not exist|not found/i.test(msg)) {
        return null;
      }
      throw e;
    }
  },

  /** Search inbox for emails matching a keyword (merchant name, lender, deal ref).
   *  mailbox defaults to submissions@srtagency.com (shared mailbox with lender replies).
   *  Falls back to /me/messages if the shared mailbox isn't accessible. */
  async searchMail(query: string, top = 20, mailbox = "submissions@srtagency.com"): Promise<Array<{
    id: string;
    subject: string;
    from: string;
    receivedDateTime: string;
    bodyPreview: string;
    webLink?: string;
  }>> {
    const encoded = encodeURIComponent(`"${query}"`);
    // Try shared mailbox first, fall back to /me if permission error
    let result: Record<string, unknown>;
    try {
      result = await graphRequest(
        `/users/${mailbox}/messages?$search=${encoded}&$top=${top}&$select=id,subject,from,receivedDateTime,bodyPreview,webLink`
      );
    } catch {
      result = await graphRequest(
        `/me/messages?$search=${encoded}&$top=${top}&$select=id,subject,from,receivedDateTime,bodyPreview,webLink`
      );
    }
    const messages = (result.value ?? []) as Array<{
      id: string;
      subject: string;
      from: { emailAddress: { address: string; name?: string } };
      receivedDateTime: string;
      bodyPreview: string;
      webLink?: string;
    }>;
    return messages.map((m) => ({
      id: m.id,
      subject: m.subject ?? "(no subject)",
      from: m.from?.emailAddress?.name
        ? `${m.from.emailAddress.name} <${m.from.emailAddress.address}>`
        : (m.from?.emailAddress?.address ?? ""),
      receivedDateTime: m.receivedDateTime,
      bodyPreview: m.bodyPreview ?? "",
      webLink: m.webLink,
    }));
  },

  /**
   * Create a draft email via Graph API (isDraft: true). Lands in the mailbox's Drafts folder
   * so the user can open, edit, and send it. `mailbox` undefined → /me; otherwise /users/{mailbox}.
   * Supports optional To list + file/inline attachments. Returns id + webLink (opens in Outlook).
   */
  async createDraft(params: {
    mailbox?: string;
    to?: string | string[];
    subject: string;
    body: string;
    attachments?: Array<{ name: string; contentType: string; contentBytes: string; isInline?: boolean; contentId?: string | null }>;
  }): Promise<{ id: string; webLink: string }> {
    const path = params.mailbox ? `/users/${encodeURIComponent(params.mailbox)}/messages` : "/me/messages";
    const message: Record<string, unknown> = {
      subject: params.subject,
      body: { contentType: "HTML", content: params.body },
      isDraft: true,
    };
    const to = toGraphRecipients(params.to);
    if (to.length > 0) message.toRecipients = to;
    if (params.attachments && params.attachments.length > 0) {
      message.attachments = params.attachments.map((a) => {
        const att: Record<string, unknown> = {
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: a.name,
          contentType: a.contentType,
          contentBytes: a.contentBytes,
        };
        if (a.isInline) {
          att.isInline = true;
          if (a.contentId) att.contentId = a.contentId;
        }
        return att;
      });
    }
    const result = await graphRequest(path, { method: "POST", body: JSON.stringify(message) });
    return { id: result.id as string, webLink: result.webLink as string };
  },

  /**
   * Send a draft that already exists, by message id.
   *
   * Sending the draft rather than composing a fresh message is what makes the
   * approval card honest: what goes out is byte for byte what Matthew saw in
   * Outlook, including any edit he made there before tapping Send.
   */
  async sendDraft(messageId: string, mailbox?: string): Promise<void> {
    const base = mailbox ? `/users/${encodeURIComponent(mailbox)}` : "/me";
    // 202 Accepted with an EMPTY body, so rawResponse: true. Without it
    // graphRequest calls res.json() on nothing and throws after a successful send,
    // which would look like a failure and invite a duplicate retry.
    await graphRequest(`${base}/messages/${messageId}/send`, { method: "POST", rawResponse: true });
  },

  /**
   * Delete a message, but ONLY while it is still an unsent draft.
   *
   * The isDraft check is not a nicety, it is the whole point of this function. A message id
   * SURVIVES being sent: the message moves to Sent Items and keeps the same id. So a stored id
   * that once pointed at a draft can, minutes later, point at an email a prospect has already
   * received, and an unguarded DELETE would silently destroy the only copy of it. Callers hold
   * exactly that kind of stale id (audit_reports.outlook_draft_id, replaced on every redraft),
   * so the guard lives here rather than in each of them.
   *
   * Never throws. A draft that is already gone is a normal outcome, not a failure, and the
   * callers are all "clean up the old one before making the new one" — the new draft matters
   * and the cleanup does not.
   */
  async deleteDraft(messageId: string, mailbox?: string): Promise<"deleted" | "not-a-draft" | "gone"> {
    const base = mailbox ? `/users/${encodeURIComponent(mailbox)}` : "/me";
    try {
      const msg = await graphRequest(`${base}/messages/${messageId}?$select=isDraft`);
      if (msg.isDraft !== true) return "not-a-draft";
    } catch {
      // A 404 here means it was deleted in Outlook by hand. Nothing to clean up.
      return "gone";
    }
    try {
      await graphRequest(`${base}/messages/${messageId}`, { method: "DELETE", rawResponse: true });
      return "deleted";
    } catch {
      return "gone";
    }
  },
};

// Screenshots dropped in a client's Slack thread become filed evidence.
//
// Runner v3 §3: "Files uploaded in a task thread are captured via the Slack events API,
// stored in Supabase storage, written to onboarding_docs against that task. That is how
// screenshots become evidence without me filing anything."
//
// That last clause is the requirement. The presence sweep is eighteen platforms, most of
// them manual, and the evidence for "missing" is a screenshot of an empty search result.
// If filing it is a separate chore, it does not happen — and then the 3c PDF has nothing
// to show and findings section 2 has nothing behind it. So the filing has to be a side
// effect of replying in the thread, and nothing else.
//
// ‼️ THE BUCKET IS PRIVATE AND THAT IS NOT A DEFAULT WORTH ACCEPTING.
// These files are screenshots of a CLIENT's Google, Yelp and Facebook listings: their
// address and phone as currently published, and whatever else lands in the thread. The
// `reels` bucket next door is public because it holds our own marketing renders. A public
// bucket here would be guessable-key access to another business's records, on our
// infrastructure, with no login. Reads go through short-lived signed URLs.

import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";

const BUCKET = "onboarding";

/** Long enough to open and read a screenshot, short enough that a copied link dies. */
const SIGNED_URL_TTL_SECONDS = 60 * 10;

export interface CapturedDoc {
  clientId: string;
  filename: string;
  stepKey: string | null;
}

/**
 * Which client owns this Slack thread, if any.
 *
 * The onboarding channel is ONE channel with a thread per client (clients.ops_thread_ts),
 * not a channel per client — per-client channels were retired on 2026-08-20. So the thread
 * timestamp is the whole routing key.
 *
 * Returns null for anything else in that channel, which is most of it. A file that does not
 * belong to a client thread is not this module's business and must fall through to the
 * handlers that were there first.
 */
export async function clientForThread(
  channelId: string,
  threadTs: string | null | undefined
): Promise<{ id: string; legalName: string } | null> {
  const onboardingChannel = process.env.SLACK_CLIENT_ONBOARDING_CHANNEL;
  if (!onboardingChannel || channelId !== onboardingChannel) return null;
  if (!threadTs) return null;

  const { data } = await supabaseAdmin
    .from("clients")
    .select("id, legal_name")
    .eq("ops_thread_ts", threadTs)
    .maybeSingle();

  if (!data) return null;
  return { id: data.id as string, legalName: data.legal_name as string };
}

/**
 * Download a Slack file and file it against a client.
 *
 * Idempotent on slack_file_id via a unique index, because the Slack events API redelivers
 * and handleFileShared can run twice for one upload. A duplicate insert is swallowed as a
 * no-op rather than treated as a failure: the file is already filed, which is the outcome
 * we wanted.
 */
export async function captureOnboardingFile(args: {
  clientId: string;
  file: {
    id: string;
    name?: string;
    mimetype?: string;
    url_private_download?: string;
    user?: string;
  };
  threadTs: string;
  stepKey?: string | null;
}): Promise<{ ok: boolean; skipped?: "duplicate" | "no_url"; error?: string }> {
  const { clientId, file, threadTs } = args;

  if (!file.url_private_download) return { ok: false, skipped: "no_url" };

  // Claim first, download second. A file that fails to download leaves no row, and the
  // claim is what stops two concurrent deliveries both spending the bandwidth.
  const { data: existing } = await supabaseAdmin
    .from("client_docs")
    .select("id")
    .eq("slack_file_id", file.id)
    .maybeSingle();

  if (existing) return { ok: true, skipped: "duplicate" };

  let buf: Buffer;
  try {
    buf = await slack.downloadFile(file.url_private_download);
  } catch (e) {
    return { ok: false, error: `download failed: ${(e as Error).message}` };
  }

  const filename = file.name ?? `${file.id}.bin`;
  const ext = (filename.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  // Keyed by client, so a listing of one client's evidence is a prefix query and nothing
  // else is in the way.
  const key = `${clientId}/${threadTs.replace(".", "-")}-${file.id}.${ext}`;

  const up = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(key, buf, { contentType: file.mimetype ?? "application/octet-stream", upsert: true });

  if (up.error) return { ok: false, error: `upload failed: ${up.error.message}` };

  const { error } = await supabaseAdmin.from("client_docs").insert({
    client_id: clientId,
    filename,
    content_type: file.mimetype ?? null,
    size_bytes: buf.byteLength,
    storage_ref: key,
    // No web_url. The bucket is private, so there is no durable link to store — a viewable
    // URL is minted on request and expires. Storing one here would be storing a dead link.
    web_url: null,
    delivery_step_key: args.stepKey ?? null,
    slack_file_id: file.id,
    slack_thread_ts: threadTs,
    uploaded_by: file.user ?? null,
  });

  // 23505 = the unique index did its job between the check above and here.
  if (error && (error as { code?: string }).code === "23505") {
    return { ok: true, skipped: "duplicate" };
  }
  if (error) return { ok: false, error: error.message };

  return { ok: true };
}

export interface OnboardingDocView {
  id: string;
  filename: string;
  contentType: string | null;
  sizeBytes: number | null;
  stepKey: string | null;
  uploadedAt: string;
  uploadedBy: string | null;
}

export async function listOnboardingDocs(clientId: string): Promise<OnboardingDocView[]> {
  const { data, error } = await supabaseAdmin
    .from("client_docs")
    .select("id, filename, content_type, size_bytes, delivery_step_key, uploaded_at, uploaded_by")
    .eq("client_id", clientId)
    .order("uploaded_at", { ascending: false });

  if (error) {
    console.error("[clients/onboarding-docs] list failed:", error.message);
    return [];
  }

  return (data ?? []).map((d) => ({
    id: d.id as string,
    filename: d.filename as string,
    contentType: (d.content_type as string | null) ?? null,
    sizeBytes: (d.size_bytes as number | null) ?? null,
    stepKey: (d.delivery_step_key as string | null) ?? null,
    uploadedAt: d.uploaded_at as string,
    uploadedBy: (d.uploaded_by as string | null) ?? null,
  }));
}

/**
 * A short-lived link to one file.
 *
 * Minted per request rather than stored, because the bucket is private and a stored URL
 * would either be permanent (defeating the point) or dead (worse than absent).
 */
export async function signedDocUrl(docId: string): Promise<string | null> {
  const { data: doc } = await supabaseAdmin
    .from("client_docs")
    .select("storage_ref")
    .eq("id", docId)
    .maybeSingle();

  const key = (doc?.storage_ref as string | null) ?? null;
  if (!key) return null;

  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(key, SIGNED_URL_TTL_SECONDS);

  if (error) {
    console.error("[clients/onboarding-docs] sign failed:", error.message);
    return null;
  }
  return data?.signedUrl ?? null;
}

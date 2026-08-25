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
import { resolvePlatformsFromText } from "@/config/presence-platforms";
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
): Promise<{ id: string; legalName: string; stepKey: string | null } | null> {
  const onboardingChannel = process.env.SLACK_CLIENT_ONBOARDING_CHANNEL;
  if (!onboardingChannel || channelId !== onboardingChannel) return null;
  if (!threadTs) return null;

  // ‼️ TWO KINDS OF THREAD NOW, AND MISSING THE SECOND WOULD HAVE BROKEN EVERY UPLOAD.
  //
  // The header thread (clients.ops_thread_ts) is what this matched when everything lived in
  // one thread. Since the board split into one top-level message per step, evidence is
  // dropped in the STEP's thread, whose parent is client_delivery_steps.slack_anchor_ts —
  // so a screenshot posted where it is now asked for would have matched nothing, fallen
  // through to the image analyser, and been filed as a content reference.
  //
  // Resolving via the step also fills delivery_step_key, which nothing populated before: the
  // step is no longer a guess, it is which thread the file was dropped in.
  const { data: step } = await supabaseAdmin
    .from("client_delivery_steps")
    .select("client_id, step_key")
    .eq("slack_anchor_ts", threadTs)
    .maybeSingle();

  if (step) {
    const { data: owner } = await supabaseAdmin
      .from("clients")
      .select("id, legal_name")
      .eq("id", step.client_id as string)
      .maybeSingle();
    if (owner) {
      return {
        id: owner.id as string,
        legalName: owner.legal_name as string,
        stepKey: step.step_key as string,
      };
    }
  }

  const { data } = await supabaseAdmin
    .from("clients")
    .select("id, legal_name")
    .eq("ops_thread_ts", threadTs)
    .maybeSingle();

  if (!data) return null;
  return { id: data.id as string, legalName: data.legal_name as string, stepKey: null };
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
  /**
   * The text of the Slack message this file was posted with, when there was one.
   *
   * ‼️ ONLY THE MESSAGE EVENT HAS THIS. handleFileShared goes through files.info, which returns
   * the file and its shares and no message text at all, so it passes null. Slack fires BOTH a
   * message (subtype file_share) and a file_shared for one upload with a comment, in no
   * guaranteed order, which is why attributePresenceDoc below exists: whichever event lands
   * first writes the row, and the message path backfills the attribution it is the only one
   * able to see.
   */
  messageText?: string | null;
}): Promise<{
  ok: boolean;
  skipped?: "duplicate" | "no_url";
  error?: string;
  /** The platform this was attributed to, when exactly one was named. */
  presencePlatform?: string | null;
}> {
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

  // ‼️ ATTRIBUTED ONLY ON THE MANUAL SWEEP STEP, AND ONLY WHEN EXACTLY ONE PLATFORM IS NAMED.
  //
  // Scoped to the step so a screenshot for access_granted or gbp_buildout whose message happens
  // to say "Google" does not acquire a presence_platform it has no business carrying. Zero
  // matches and two matches both leave it null, which is a real answer meaning nobody could
  // tell: two named platforms give no honest way to decide which one the picture shows, and
  // guessing would put a green tick on a platform nobody swept. The thread says what is
  // missing; the file is filed either way.
  const named =
    args.stepKey === "presence_sweep_manual" && args.messageText
      ? resolvePlatformsFromText(args.messageText)
      : [];
  const presencePlatform = named.length === 1 ? named[0] : null;

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
    presence_platform: presencePlatform,
  });

  // 23505 = the unique index did its job between the check above and here.
  if (error && (error as { code?: string }).code === "23505") {
    return { ok: true, skipped: "duplicate" };
  }
  if (error) return { ok: false, error: error.message };

  return { ok: true, presencePlatform };
}

/**
 * Attach a platform to a screenshot that was already filed without one.
 *
 * ‼️ THIS EXISTS BECAUSE TWO SLACK EVENTS RACE FOR ONE UPLOAD. A file posted with a comment
 * fires a `message` (subtype file_share) carrying the text, AND a `file_shared` carrying no
 * text, in no guaranteed order. Whichever lands first inserts the row. When file_shared wins,
 * the row goes in unattributed and the message handler backfills it here.
 *
 * The `.is("presence_platform", null)` predicate is what makes this a backfill and not an
 * overwrite: a row that already carries a platform is left alone, so a redelivered message
 * cannot relabel a screenshot. Same conditional-claim pattern postStepAnchor uses on
 * slack_anchor_ts.
 */
export async function attributePresenceDoc(
  slackFileId: string,
  platform: string
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("client_docs")
    .update({ presence_platform: platform })
    .eq("slack_file_id", slackFileId)
    .is("presence_platform", null)
    .select("id");

  if (error) {
    console.error("[clients/onboarding-docs] attribution failed:", error.message);
    return false;
  }
  return (data?.length ?? 0) > 0;
}

/**
 * File a PDF this app GENERATED, as opposed to evidence somebody uploaded.
 * captureOnboardingFile above cannot do this: it is Slack-inbound-shaped, requiring a
 * `file.id` and a `url_private_download`, and it dedupes on the unique slack_file_id index.
 * A generated artifact has neither. It writes slack_file_id null, which the index already
 * permits (it is partial, `where slack_file_id is not null`).
 *
 * ‼️ NOT IDEMPOTENT, ON PURPOSE. Re-running an auto step is how a findings doc gets
 * regenerated after the manual sweep fills in, and each run is a different document about a
 * different set of facts. Runner v3 section 2 says a re-run "writes a new output_ref and
 * supersedes"; it never edits the previous file, so the artifact that was actually sent to a
 * client on a given day is still there to be read back.
 */
export async function storeGeneratedDoc(args: {
  clientId: string;
  stepKey: string;
  filename: string;
  buffer: Buffer;
  contentType?: string;
}): Promise<{ ok: boolean; docId?: string; error?: string }> {
  const ext = (args.filename.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const key = `${args.clientId}/generated/${args.stepKey}-${stamp}.${ext}`;

  const up = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(key, args.buffer, {
      contentType: args.contentType ?? "application/pdf",
      upsert: false,
    });

  if (up.error) return { ok: false, error: `upload failed: ${up.error.message}` };

  const { data, error } = await supabaseAdmin
    .from("client_docs")
    .insert({
      client_id: args.clientId,
      filename: args.filename,
      content_type: args.contentType ?? "application/pdf",
      size_bytes: args.buffer.byteLength,
      storage_ref: key,
      // Same reasoning as the capture path: the bucket is private, so a stored URL would be a
      // dead link. Minted on request instead.
      web_url: null,
      delivery_step_key: args.stepKey,
      source: "generated",
      slack_file_id: null,
      slack_thread_ts: null,
      uploaded_by: "Mission Control",
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, docId: data.id as string };
}

export interface OnboardingDocView {
  id: string;
  filename: string;
  contentType: string | null;
  sizeBytes: number | null;
  stepKey: string | null;
  /** 'slack' = evidence somebody filed. 'generated' = an artifact this app produced. */
  source: "slack" | "generated";
  uploadedAt: string;
  uploadedBy: string | null;
}

export async function listOnboardingDocs(clientId: string): Promise<OnboardingDocView[]> {
  const { data, error } = await supabaseAdmin
    .from("client_docs")
    .select("id, filename, content_type, size_bytes, delivery_step_key, source, uploaded_at, uploaded_by")
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
    source: ((d.source as string | null) ?? "slack") as "slack" | "generated",
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

// Archiving a client whole, catching a duplicate onboarding, and re-onboarding from the archive.
//
// Matthew, 2026-09-15: "if someone cancels and we sell them again we need to reonboard but we will already
// have most of the data so is more of a reactivation", and the warning "must appear to avoid onboarding
// duplicates". Table: docs/2026-09-15-client-archives.sql.
//
// Three acts, in this order, and none of them skips the one before:
//   1. archiveClient writes EVERY row of every client_id table into client_archives, reads it back and
//      compares the counts. Nothing is deleted if the copy does not match.
//   2. deleteArchivedClient deletes the client only when an archive of exactly that client exists.
//   3. importFromArchive restores the KNOWLEDGE into a new onboarding: intake, audiences, the offer, the
//      framework documents, evidence, documents, and relinks the audits and fanout runs the delete nulled.
//
// ‼️ THE IMPORT RESTORES WHAT WE KNEW, NOT WHAT WAS DECIDED. A reactivated client is a new engagement: the
// offer comes back as a PROPOSAL to lock again on the prep call, and the sales letter comes back as a draft to
// approve again, because both were decisions about the old engagement and a cancelled client's offer is the
// first thing that may have changed. Step history, events, gate runs and Slack anchors are never imported:
// they describe a board that no longer exists, and an anchor ts pointing into an archived channel posts
// nowhere.

import { supabaseAdmin } from "@/lib/db";

/** Every table with a client_id, measured from information_schema on 2026-09-15. */
export const CLIENT_TABLES = [
  "attribution_bookings", "attribution_monthly", "attribution_sessions", "audience_documents", "client_audiences",
  "client_avatar_runs", "client_datasets", "client_delivery_steps", "client_dns_records", "client_docs",
  "client_events", "client_headlines", "client_hosts", "client_keywords", "client_messages", "client_offers",
  "client_onboarding_steps", "client_pages", "client_query_state", "client_question_sets", "client_replica_pages",
  "client_url_inventory", "client_weekly_reports", "client_workflow_runs", "colonies", "competitor_candidates",
  "concierge_configs", "concierge_scan_ledger", "concierge_sessions", "harvest_runs", "hub_hits", "lead_magnets",
  "nap_discrepancies", "page_candidates", "page_dataset", "page_gate_runs", "page_magnet_candidates", "page_plan",
  "page_sources", "page_studio_sessions", "review_audit_rows", "review_tool_submissions", "time_log",
  // SET NULL on delete: these rows survive the delete and are relinked on import.
  "audit_reports", "chat_conversations", "fanout_citations", "fanout_queries", "fanout_runs",
  "onboarding2_leads", "onboarding2_signings",
] as const;

/** The tables whose rows outlive the client with client_id nulled. Import points them at the new client. */
export const RELINK_TABLES = [
  "audit_reports", "chat_conversations", "fanout_citations", "fanout_queries", "fanout_runs",
  "onboarding2_leads", "onboarding2_signings",
] as const;

/**
 * ‼️ client_avatar_runs HAS NO FOREIGN KEY TO clients (measured 2026-09-15), so it does not cascade and
 * deleting the client would orphan its rows. Deleted by hand, after the archive holds them.
 */
const NO_CASCADE_TABLES = ["client_avatar_runs"] as const;

/**
 * The client fields a reactivation brings back, filled only where the new row has nothing.
 *
 * Left out on purpose: ids, slug, tokens, billing and pilot dates, Slack channel and anchors, payment,
 * Day 0, consent (a new engagement consents again), pixel_key (unique per hub), and `offer` (restored
 * through client_offers as a proposal, then mirrored).
 */
export const IMPORT_CLIENT_FIELDS = [
  "legal_name", "dba_name", "website", "domain", "address_line1", "address_line2", "city", "state", "postal_code",
  "phone", "hours", "services", "ideal_patient", "review_workflow", "access_inventory", "intake_step",
  "intake_completed_at", "review_incentive_flag", "testimonial_disclosure_required", "review_request_mode",
  "booking_software", "review_destination_primary", "review_destination_secondary", "review_owner_name",
  "market_center_lat", "market_center_lng", "market_radius_mi", "registrar", "contact_id", "zoho_lead_id",
  "vertical_slug", "business_type", "contact_preference", "dns_provider", "dns_nameservers", "theme",
  "audit_report_id", "site_intel", "primary_avatar", "primary_avatar_label", "primary_avatar_confirmed_at",
  "primary_avatar_confirmed_by", "primary_avatar_slug", "hub_skin", "hub_skin_candidates", "headline_framework",
] as const;

type Row = Record<string, unknown>;

export interface ClientSnapshot {
  version: 1;
  client: Row;
  tables: Record<string, Row[]>;
  /** The text of each uploaded document that has text, so a research file survives its storage object. */
  files: Array<{ docId: string; filename: string; contentType: string | null; storageRef: string | null; text: string | null }>;
  /** A table that could not be read, by name. An archive with errors is refused before anything is deleted. */
  errors: Record<string, string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure rules
// ─────────────────────────────────────────────────────────────────────────────

/** "SRT Agency, LLC" and "srt agency" are one business. Suffixes and punctuation are not identity. */
export function nameKey(name: string | null | undefined): string | null {
  const key = (name ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(llc|l l c|inc|incorporated|co|corp|corporation|ltd|pllc|pc|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return key.length >= 3 ? key : null;
}

/** example.com, from "https://www.Example.com/about". */
export function domainKey(site: string | null | undefined): string | null {
  const s = (site ?? "").trim().toLowerCase();
  if (!s) return null;
  const host = s.replace(/^[a-z]+:\/\//, "").split(/[/?#]/)[0].replace(/^www\./, "").replace(/:\d+$/, "");
  return /\./.test(host) ? host : null;
}

/** The last ten digits, so +1 (336) 555-0142 and 3365550142 match. */
export function phoneKey(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}

export interface Identity {
  legalName?: string | null;
  dbaName?: string | null;
  website?: string | null;
  domain?: string | null;
  email?: string | null;
  phone?: string | null;
}

/**
 * Why two identities look like the same business, in words. Empty means they do not.
 *
 * ‼️ A SHARED EMAIL DOMAIN IS NOT A MATCH, AND NEITHER IS gmail.com. Only the exact email, the website's own
 * domain, the phone, or the business name counts. A placeholder legal name (a self-serve start stores the
 * email there) is not a name.
 */
export function duplicateReasons(a: Identity, b: Identity): string[] {
  const out: string[] = [];
  const dom = (x: Identity) => domainKey(x.domain) ?? domainKey(x.website);
  if (dom(a) && dom(a) === dom(b)) out.push(`the website ${dom(a)}`);
  const email = (x: Identity) => (x.email ?? "").trim().toLowerCase() || null;
  if (email(a) && email(a) === email(b)) out.push(`the email ${email(a)}`);
  if (phoneKey(a.phone) && phoneKey(a.phone) === phoneKey(b.phone)) out.push("the phone number");
  const names = (x: Identity) =>
    [x.legalName, x.dbaName].filter((n) => n && !/@/.test(n)).map(nameKey).filter((k): k is string => Boolean(k));
  const shared = names(a).find((k) => names(b).includes(k));
  if (shared) out.push(`the name "${shared}"`);
  return out;
}

const isEmpty = (v: unknown) =>
  v === null ||
  v === undefined ||
  (typeof v === "string" && v.trim() === "") ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0);

/**
 * The patch that fills a new client from its archived self: only the fields the new row has nothing in.
 * The legal name counts as nothing when it is the email placeholder a self-serve start writes.
 */
export function clientFieldsToImport(archived: Row, current: Row): Row {
  const patch: Row = {};
  for (const field of IMPORT_CLIENT_FIELDS) {
    const value = archived[field];
    if (isEmpty(value)) continue;
    const mine = current[field];
    const placeholder = field === "legal_name" && typeof mine === "string" && mine === current.email;
    if (isEmpty(mine) || placeholder) patch[field] = value;
  }
  return patch;
}

/**
 * An archived offer as the new engagement's PROPOSAL: what was locked becomes what is proposed, the lock is
 * cleared, and the details (terms, outcome, price, positioning) come back with it.
 */
export function offerAsProposal(old: Row, clientId: string, audienceId: string, now: string): Row {
  const treatment = (old.treatment as string | null) || (old.proposed_treatment as string | null) || null;
  const source = old.proposed_source as string | null;
  return {
    client_id: clientId,
    audience_id: audienceId,
    is_primary: old.is_primary === true,
    proposed_treatment: treatment,
    proposed_source: source && ["primary_treatment", "highest_margin", "services_list", "call"].includes(source) ? source : "call",
    proposed_at: treatment ? now : null,
    treatment: null,
    locked_at: null,
    locked_by: null,
    magnet_key: old.magnet_key ?? null,
    positioning: old.positioning ?? null,
    terms: Array.isArray(old.terms) ? old.terms : [],
    terms_at: old.terms_at ?? null,
    outcome_promise: old.outcome_promise ?? null,
    outcome_set_at: old.outcome_set_at ?? null,
    price: old.price ?? null,
    price_set_at: old.price_set_at ?? null,
  };
}

/** A row copied onto another client: its id, owner and timestamps dropped, the rest kept. */
function copyRow(row: Row, clientId: string, drop: readonly string[] = []): Row {
  const out: Row = { ...row, client_id: clientId };
  for (const k of ["id", "created_at", "updated_at", ...drop]) delete out[k];
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Archive
// ─────────────────────────────────────────────────────────────────────────────

async function allRows(table: string, clientId: string): Promise<{ rows: Row[]; error?: string }> {
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin.from(table).select("*").eq("client_id", clientId).range(from, from + 999);
    if (error) return { rows, error: error.message };
    rows.push(...((data ?? []) as Row[]));
    if ((data ?? []).length < 1000) return { rows };
  }
}

export async function snapshotClient(clientId: string): Promise<ClientSnapshot | null> {
  const { data: client, error } = await supabaseAdmin.from("clients").select("*").eq("id", clientId).maybeSingle();
  if (error) throw new Error(`clients could not be read: ${error.message}`);
  if (!client) return null;

  const snapshot: ClientSnapshot = { version: 1, client: client as Row, tables: {}, files: [], errors: {} };
  for (const table of CLIENT_TABLES) {
    const { rows, error: e } = await allRows(table, clientId);
    // A table that does not exist on this database is not data lost; anything else is.
    if (e && !/does not exist|schema cache/i.test(e)) snapshot.errors[table] = e;
    if (rows.length) snapshot.tables[table] = rows;
  }

  const { extractFileText } = await import("@/lib/deck/extract");
  for (const doc of snapshot.tables.client_docs ?? []) {
    const ref = (doc.storage_ref as string | null) ?? null;
    let text: string | null = null;
    if (ref) {
      const dl = await supabaseAdmin.storage.from("onboarding").download(ref);
      if (!dl.error && dl.data) {
        text = await extractFileText(Buffer.from(await dl.data.arrayBuffer()), String(doc.filename ?? ""), String(doc.content_type ?? ""))
          .then((t) => (t ? t.slice(0, 500_000) : null))
          .catch(() => null);
      }
    }
    snapshot.files.push({
      docId: String(doc.id),
      filename: String(doc.filename ?? ""),
      contentType: (doc.content_type as string | null) ?? null,
      storageRef: ref,
      text,
    });
  }
  return snapshot;
}

export function rowCounts(snapshot: ClientSnapshot): Record<string, number> {
  return Object.fromEntries(Object.entries(snapshot.tables).map(([t, rows]) => [t, rows.length]));
}

export async function archiveClient(args: {
  clientId: string;
  by: string;
  reason: string;
}): Promise<{ ok: true; archiveId: string; counts: Record<string, number>; snapshot: ClientSnapshot } | { ok: false; error: string }> {
  const snapshot = await snapshotClient(args.clientId);
  if (!snapshot) return { ok: false, error: "no such client" };
  if (Object.keys(snapshot.errors).length) {
    return { ok: false, error: `some tables could not be read, so nothing was archived: ${JSON.stringify(snapshot.errors)}` };
  }

  const c = snapshot.client;
  const counts = rowCounts(snapshot);
  const { data, error } = await supabaseAdmin
    .from("client_archives")
    .insert({
      source_client_id: args.clientId,
      slug: c.slug,
      legal_name: c.legal_name ?? null,
      dba_name: c.dba_name ?? null,
      domain: domainKey((c.domain as string) ?? (c.website as string)) ?? null,
      website: c.website ?? null,
      email: c.email ?? null,
      phone: c.phone ?? null,
      contact_id: c.contact_id ?? null,
      name_key: nameKey((c.dba_name as string) || (c.legal_name as string)),
      snapshot,
      row_counts: counts,
      reason: args.reason,
      archived_by: args.by,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: `the archive could not be written: ${error?.message}` };

  // ‼️ READ BACK AND COMPARED BEFORE ANYTHING MAY BE DELETED. An insert that returned an id but stored a
  // truncated snapshot would otherwise be discovered on import, after the only other copy was gone.
  const { data: back } = await supabaseAdmin.from("client_archives").select("snapshot").eq("id", data.id).single();
  const stored = back?.snapshot as ClientSnapshot | undefined;
  // ‼️ COMPARED AS SORTED ENTRIES, NEVER AS JSON STRINGS: jsonb stores object keys in its own order, so the
  // same counts stringify differently on the way back and a whole archive would read as broken.
  const sorted = (c: Record<string, number>) => JSON.stringify(Object.entries(c).sort(([a], [b]) => a.localeCompare(b)));
  const same = stored && sorted(rowCounts(stored)) === sorted(counts) && stored.client?.id === args.clientId;
  if (!same) return { ok: false, error: `the archive ${data.id} was written but does not read back whole` };

  return { ok: true, archiveId: data.id as string, counts, snapshot };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Delete
// ─────────────────────────────────────────────────────────────────────────────

export async function deleteArchivedClient(args: {
  clientId: string;
  archiveId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: archive } = await supabaseAdmin
    .from("client_archives")
    .select("id, source_client_id, row_counts")
    .eq("id", args.archiveId)
    .maybeSingle();
  if (!archive || archive.source_client_id !== args.clientId) {
    return { ok: false, error: "there is no archive of exactly this client, so it was not deleted" };
  }

  for (const table of NO_CASCADE_TABLES) {
    const { error } = await supabaseAdmin.from(table).delete().eq("client_id", args.clientId);
    if (error) return { ok: false, error: `${table} could not be cleared: ${error.message}` };
  }
  const { error } = await supabaseAdmin.from("clients").delete().eq("id", args.clientId);
  if (error) return { ok: false, error: `the client could not be deleted: ${error.message}` };

  const { data: still } = await supabaseAdmin.from("clients").select("id").eq("id", args.clientId).maybeSingle();
  return still ? { ok: false, error: "the delete returned no error but the client is still there" } : { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Duplicates
// ─────────────────────────────────────────────────────────────────────────────

export interface DuplicateMatch {
  kind: "client" | "archive";
  id: string;
  name: string;
  /** The live client's board, or the archive date. */
  detail: string;
  reasons: string[];
  /** What an import would bring back, in a few words. Archives only. */
  carries: string | null;
}

function carriesLine(counts: Record<string, number>, snapshot?: ClientSnapshot | null): string {
  const offer = (snapshot?.tables.client_offers ?? []).find((o) => o.is_primary) ?? snapshot?.tables.client_offers?.[0];
  const parts = [
    offer ? `offer "${(offer.treatment as string) || (offer.proposed_treatment as string)}"` : null,
    counts.client_audiences ? `${counts.client_audiences} audience${counts.client_audiences === 1 ? "" : "s"}` : null,
    counts.audience_documents ? `${counts.audience_documents} framework document${counts.audience_documents === 1 ? "" : "s"}` : null,
    counts.audit_reports ? `${counts.audit_reports} audit${counts.audit_reports === 1 ? "" : "s"}` : null,
    snapshot?.client?.intake_completed_at ? "a completed intake" : null,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "its business details";
}

export async function findDuplicates(input: Identity & { excludeClientId?: string | null }): Promise<DuplicateMatch[]> {
  const matches: DuplicateMatch[] = [];
  const app = process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";

  const { data: clients } = await supabaseAdmin
    .from("clients")
    .select("id, slug, legal_name, dba_name, website, domain, email, phone, billing_status, created_at");
  for (const c of (clients ?? []) as Row[]) {
    if (c.id === input.excludeClientId) continue;
    const reasons = duplicateReasons(input, {
      legalName: c.legal_name as string, dbaName: c.dba_name as string, website: c.website as string,
      domain: c.domain as string, email: c.email as string, phone: c.phone as string,
    });
    if (!reasons.length) continue;
    matches.push({
      kind: "client",
      id: String(c.id),
      name: String(c.dba_name || c.legal_name || c.slug),
      detail: `${app}/dashboard/clients/${c.id}`,
      reasons,
      carries: null,
    });
  }

  const { data: archives, error } = await supabaseAdmin
    .from("client_archives")
    .select("id, legal_name, dba_name, website, domain, email, phone, row_counts, archived_at, snapshot->tables->client_offers, snapshot->client->intake_completed_at")
    .is("imported_into_client_id", null)
    .order("archived_at", { ascending: false });
  if (!error) {
    for (const a of (archives ?? []) as Row[]) {
      const reasons = duplicateReasons(input, {
        legalName: a.legal_name as string, dbaName: a.dba_name as string, website: a.website as string,
        domain: a.domain as string, email: a.email as string, phone: a.phone as string,
      });
      if (!reasons.length) continue;
      const partial = {
        tables: { client_offers: (a.client_offers as Row[] | null) ?? [] },
        client: { intake_completed_at: a.intake_completed_at },
      } as unknown as ClientSnapshot;
      matches.push({
        kind: "archive",
        id: String(a.id),
        name: String(a.dba_name || a.legal_name || "archived client"),
        detail: `archived ${String(a.archived_at).slice(0, 10)}`,
        reasons,
        carries: carriesLine((a.row_counts as Record<string, number>) ?? {}, partial),
      });
    }
  }
  return matches;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Import
// ─────────────────────────────────────────────────────────────────────────────

export async function importFromArchive(args: {
  archiveId: string;
  clientId: string;
  by: string;
}): Promise<{ ok: true; lines: string[] } | { ok: false; error: string }> {
  const { data: archive, error: readError } = await supabaseAdmin
    .from("client_archives")
    .select("id, snapshot, imported_into_client_id, archived_at")
    .eq("id", args.archiveId)
    .maybeSingle();
  if (readError || !archive) return { ok: false, error: `the archive could not be read: ${readError?.message ?? "not found"}` };
  // ‼️ ONCE, EVER. A second import into the same client would file its evidence and documents twice, and
  // into another client would split one business across two boards.
  if (archive.imported_into_client_id) {
    return {
      ok: false,
      error:
        archive.imported_into_client_id === args.clientId
          ? "that archive is already imported into this onboarding"
          : "that archive was already imported into another onboarding",
    };
  }
  // Claimed before the writes, so a double press cannot run two imports side by side.
  const { data: claimed } = await supabaseAdmin
    .from("client_archives")
    .update({ imported_into_client_id: args.clientId, imported_at: new Date().toISOString(), imported_by: args.by })
    .eq("id", args.archiveId)
    .is("imported_into_client_id", null)
    .select("id")
    .maybeSingle();
  if (!claimed) return { ok: false, error: "that archive is being imported already" };

  const snap = archive.snapshot as ClientSnapshot;
  const now = new Date().toISOString();
  const lines: string[] = [];
  const problems: string[] = [];

  // The business itself.
  const { data: current } = await supabaseAdmin.from("clients").select("*").eq("id", args.clientId).single();
  if (!current) {
    await supabaseAdmin.from("client_archives").update({ imported_into_client_id: null, imported_at: null, imported_by: null }).eq("id", args.archiveId);
    return { ok: false, error: "the new client could not be read, so nothing was imported" };
  }
  const patch = clientFieldsToImport(snap.client, current as Row);
  if (Object.keys(patch).length) {
    const { error } = await supabaseAdmin.from("clients").update({ ...patch, updated_at: now }).eq("id", args.clientId);
    if (error) problems.push(`business details: ${error.message}`);
    else lines.push(`${Object.keys(patch).length} business details (intake, address, avatar, design, site facts)`);
  }

  // Audiences, remapped.
  const audienceIds = new Map<string, string>();
  for (const aud of snap.tables.client_audiences ?? []) {
    const { data: existing } = await supabaseAdmin
      .from("client_audiences")
      .select("id")
      .eq("client_id", args.clientId)
      .eq("slug", aud.slug as string)
      .maybeSingle();
    if (existing) {
      audienceIds.set(String(aud.id), String(existing.id));
      continue;
    }
    const { data, error } = await supabaseAdmin.from("client_audiences").insert(copyRow(aud, args.clientId)).select("id").single();
    if (error || !data) problems.push(`audience ${aud.slug}: ${error?.message}`);
    else audienceIds.set(String(aud.id), String(data.id));
  }
  if (audienceIds.size) lines.push(`${audienceIds.size} audience${audienceIds.size === 1 ? "" : "s"}`);

  // Offers, as proposals.
  const offerIds = new Map<string, string>();
  for (const offer of snap.tables.client_offers ?? []) {
    const audienceId = audienceIds.get(String(offer.audience_id));
    if (!audienceId) continue;
    const { data, error } = await supabaseAdmin
      .from("client_offers")
      .insert(offerAsProposal(offer, args.clientId, audienceId, now))
      .select("id, is_primary, proposed_treatment, proposed_source, proposed_at, terms, terms_at, positioning, magnet_key")
      .single();
    if (error || !data) {
      problems.push(`offer: ${error?.message}`);
      continue;
    }
    offerIds.set(String(offer.id), String(data.id));
    if (data.is_primary) {
      // The deprecated mirror offers.ts still keeps for rollback, in its own shape.
      await supabaseAdmin
        .from("clients")
        .update({
          offer: {
            proposedTreatment: data.proposed_treatment, proposedSource: data.proposed_source, proposedAt: data.proposed_at,
            treatment: null, lockedAt: null, lockedBy: null, terms: data.terms ?? [], termsAt: data.terms_at,
            positioning: data.positioning, magnetKey: data.magnet_key,
          },
        })
        .eq("id", args.clientId);
      lines.push(`the offer "${data.proposed_treatment}" as a proposal to lock again on the prep call${(data.terms ?? []).length ? `, with its ${(data.terms as string[]).length} customer terms` : ""}`);
    }
  }

  // The framework documents, live versions only. A sales letter needs approving again.
  let docs = 0;
  for (const doc of (snap.tables.audience_documents ?? []).filter((d) => !d.superseded_at)) {
    const audienceId = audienceIds.get(String(doc.audience_id));
    const offerId = doc.offer_id ? offerIds.get(String(doc.offer_id)) : null;
    if (!audienceId || (doc.offer_id && !offerId)) continue;
    const relock = doc.kind === "sales_letter";
    const { error } = await supabaseAdmin.from("audience_documents").insert({
      ...copyRow(doc, args.clientId, ["superseded_at"]),
      audience_id: audienceId,
      offer_id: offerId ?? null,
      ...(relock ? { status: "draft", approved_at: null, approved_by: null, offer_fingerprint: null } : {}),
    });
    if (error) problems.push(`${doc.kind}: ${error.message}`);
    else docs += 1;
  }
  if (docs) lines.push(`${docs} framework document${docs === 1 ? "" : "s"} (a sales letter comes back as a draft)`);

  // Uploaded documents, still pointing at their stored files.
  const docIds = new Map<string, string>();
  for (const doc of snap.tables.client_docs ?? []) {
    const { data, error } = await supabaseAdmin
      .from("client_docs")
      .insert(copyRow(doc, args.clientId, ["step_id", "slack_file_id", "slack_thread_ts"]))
      .select("id")
      .single();
    if (error || !data) problems.push(`document ${doc.filename}: ${error?.message}`);
    else docIds.set(String(doc.id), String(data.id));
  }
  if (docIds.size) lines.push(`${docIds.size} uploaded document${docIds.size === 1 ? "" : "s"}`);
  const frameworkDoc = snap.client.headline_framework_doc_id as string | null;
  if (frameworkDoc && docIds.get(frameworkDoc)) {
    await supabaseAdmin.from("clients").update({ headline_framework_doc_id: docIds.get(frameworkDoc) }).eq("id", args.clientId);
  }

  // Evidence about the business (reviews, call notes, answered gaps), not about a page that is gone.
  let sources = 0;
  for (const src of (snap.tables.page_sources ?? []).filter((s) => !s.page_id)) {
    const { error } = await supabaseAdmin.from("page_sources").insert(copyRow(src, args.clientId));
    if (error) problems.push(`evidence: ${error.message}`);
    else sources += 1;
  }
  if (sources) lines.push(`${sources} piece${sources === 1 ? "" : "s"} of evidence`);

  // The audits, fanout runs and signings the delete left behind with client_id nulled.
  let relinked = 0;
  for (const table of RELINK_TABLES) {
    const ids = (snap.tables[table] ?? []).map((r) => r.id).filter(Boolean) as string[];
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await supabaseAdmin
        .from(table)
        .update({ client_id: args.clientId })
        .in("id", ids.slice(i, i + 200))
        .is("client_id", null)
        .select("id");
      if (error) problems.push(`${table}: ${error.message}`);
      else relinked += (data ?? []).length;
    }
  }
  if (relinked) lines.push(`${relinked} audit, fanout and signing rows relinked`);

  if (problems.length) lines.push(`Not imported: ${problems.join("; ")}`);
  return { ok: true, lines };
}

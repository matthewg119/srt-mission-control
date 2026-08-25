// Reading a directory listing off the screenshot of it — delivery step 14.
//
// Matthew: "help me so step 14 actually reads the images and creates the good report from the
// screenshots we sent before. I want it to work with screenshots because this says nothing was
// found." The cleanup PDF read "0 confirmed findings to correct, with 18 platforms still
// unchecked" on a client whose step 5 thread holds eighteen screenshots of those very listings.
//
// ‼️ IT PROPOSES A STATUS. IT NEVER CONFIRMS ONE.
//
// Runner v3 section 6: "NEVER auto-mark a listing verified. The tool proposes; I confirm." A row
// whose confirmed_status is null reads as not_checked everywhere, whatever the comparison
// proposed, and that is what stops a string comparison sending somebody to edit a client's live
// Google listing. Everything here writes proposed_status, raw_name, raw_address, raw_phone,
// listing_url and screenshot_ref. Nothing here writes confirmed_status.
//
// ‼️ THE COMPARATOR IS THE EXISTING ONE AND THERE MUST NOT BE A SECOND.
// compareListing() in nap-compare.ts already knows that "Ste 200" and "Suite 200" are the same
// address, that an entity suffix difference is a real finding rather than noise, and that a
// phone extension has to come off before the last ten digits mean anything. A second comparator
// living here would disagree with it within a month, and the two would be reported to a client
// as one number.
//
// What this file adds is only the READ: turning pixels into the three strings compareListing
// already takes.

import { callClaudeJSON, camelizeKeys, type ClaudeImageInput } from "@/lib/claude-calls";

/** Haiku, temperature 0. Same model and settings as the other two readers. */
const MODEL = "claude-haiku-4-5-20251001" as const;

export interface ListingRead {
  /**
   * Is there a listing on this page at all?
   *
   * ‼️ FALSE IS A FINDING, NOT A FAILURE. The sweep card asks for a screenshot of the EMPTY
   * search result where a business genuinely has no listing, and that picture is the evidence
   * for "missing". A reader that could not tell returns legible 0 instead.
   */
  found: boolean;
  name: string | null;
  /** The address as one line, exactly as the listing prints it. */
  address: string | null;
  phone: string | null;
  /** The address bar, verbatim, which is how the platform is resolved. */
  listingUrl: string | null;
  /** Whether the page shows the listing as claimed or verified. Null when it does not say. */
  claimed: boolean | null;
  legible: number;
  evidence: string;
}

const EMPTY: ListingRead = {
  found: false,
  name: null,
  address: null,
  phone: null,
  listingUrl: null,
  claimed: null,
  legible: 0,
  evidence: "nothing readable",
};

export async function readListing(image: ClaudeImageInput): Promise<ListingRead> {
  try {
    const { data } = await callClaudeJSON<ListingRead>({
      model: MODEL,
      system: [
        "You are looking at a screenshot of a business directory listing: a Google Maps place, a Yelp business page, a Bing Places result, an Apple Maps card, a BBB profile or similar. Read the business details printed on it.",
        "",
        "TRANSCRIBE, DO NOT INFER, AND DO NOT CORRECT:",
        "- Copy the name, the address and the phone EXACTLY as the listing prints them, including a suffix like LLC or Inc, including an abbreviation like Ste or Blvd, including odd punctuation. Businesses really are called things like Grey Seal Services LLC.",
        "- Do not expand abbreviations. Do not reformat the phone number. Do not add a state or a postcode the listing does not show. What is being measured is whether this listing DISAGREES with the record we hold, so tidying it up deletes the finding.",
        "- address is one line as printed. If only part of the address is on screen, return the part that is on screen rather than guessing the rest.",
        "- Anything not visible is null. A partial phone number is worse than none.",
        "",
        "found is about whether a LISTING FOR A BUSINESS is on this page at all.",
        "- true when a business listing is displayed, even if some of its fields are cut off.",
        "- false when the page shows a search that returned nothing, a No results message, an error page, or a directory with no matching business on it. That is a real and useful answer: it is the evidence that a business has no listing on that platform.",
        "- If you cannot tell which of those you are looking at, return legible 0 and say so in evidence rather than picking one.",
        "",
        "claimed is true only when the page explicitly says the listing is claimed, verified, or managed by the owner. It is false only when the page explicitly offers to claim it. Otherwise null.",
        "",
        "listingUrl is the browser address bar, character for character. If it is not visible, return null. Never reconstruct it.",
        "",
        "legible is 0 to 1 and measures how clearly the listing details are readable on this screen: a crisp listing with name, address and phone in view is 0.9; a listing with the address cut off is 0.5; a page you cannot classify at all is 0.",
        "evidence is one short phrase naming what you are looking at: google maps listing, yelp business page, empty search result, an error page.",
      ].join("\n"),
      user:
        "Read this listing. Return whether a business listing is on the page at all, then its name, address and phone exactly as printed, whether it shows as claimed, and the address bar verbatim.",
      images: [image],
      maxTokens: 600,
      temperature: 0,
      schemaHint:
        '{ "found": boolean, "name": string|null, "address": string|null, "phone": string|null, "listingUrl": string|null, "claimed": boolean|null, "legible": number, "evidence": string }',
      coerce: camelizeKeys,
      validate: (v: unknown): v is ListingRead => {
        const o = v as ListingRead;
        return !!o && typeof o === "object" && typeof o.legible === "number" && typeof o.found === "boolean";
      },
      describeInvalid: () =>
        "Return the object with every key present, found as a boolean, null for anything not printed on the page, and a numeric legible between 0 and 1.",
    });

    return {
      found: Boolean(data.found),
      name: blankToNull(data.name),
      address: blankToNull(data.address),
      phone: blankToNull(data.phone),
      listingUrl: blankToNull(data.listingUrl),
      claimed: typeof data.claimed === "boolean" ? data.claimed : null,
      legible: Number.isFinite(data.legible) ? data.legible : 0,
      evidence: data.evidence?.trim() || "not stated",
    };
  } catch (e) {
    console.error("[clients/listing-read] vision read failed:", (e as Error).message);
    return { ...EMPTY, evidence: `read failed: ${(e as Error).message}` };
  }
}

function blankToNull(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t.length > 0 ? t : null;
}

/** Below this the read is treated as no reading at all. Same threshold the other readers use. */
export const MIN_LEGIBLE = 0.5;

// ─────────────────────────────────────────────────────────────────────────────
// The pass: every attributed screenshot becomes a proposed status
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseAdmin } from "@/lib/db";
import { platformByKey } from "@/config/presence-platforms";
import { compareListing, type ComparisonResult } from "./nap-compare";
import { canonicalFor, loadSweep, effectiveStatus, type SweepRow } from "./presence-sweep";

/** Same headroom the other readers use, for the same reason. */
const MAX_VISION_BYTES = 6 * 1024 * 1024;

export interface ProposalOutcome {
  platform: string;
  /** What compareListing said, which is the whole point of not writing a second comparator. */
  result: ComparisonResult;
  read: ListingRead;
}

export interface ProposalPass {
  ok: boolean;
  error?: string;
  proposed: ProposalOutcome[];
  /** Attributed screenshots whose listing could not be read. Named, never silently dropped. */
  unreadable: Array<{ platform: string; evidence: string }>;
  /** Platforms already confirmed by a person, which this never touches. */
  alreadyConfirmed: string[];
}

/**
 * Read every attributed sweep screenshot and write what it proposes.
 *
 * ‼️ IT READS THE SCREENSHOTS THAT ARE ALREADY FILED. There is no second upload step and no
 * form. The eighteen pictures are in step 5's thread with a platform against each, which is
 * exactly the join this needs, and that attribution is the work Matthew already did.
 *
 * ‼️ A ROW WITH A CONFIRMED STATUS IS NEVER RE-PROPOSED OVER. confirmed_status is a person's
 * answer. A later screenshot is not evidence that they were wrong, and silently replacing their
 * answer with a model's is the exact inversion this whole design exists to prevent.
 */
export async function proposeListingStatuses(clientId: string): Promise<ProposalPass> {
  const empty: ProposalPass = { ok: true, proposed: [], unreadable: [], alreadyConfirmed: [] };

  const canonical = await canonicalFor(clientId);
  if (!canonical) {
    return {
      ...empty,
      ok: false,
      error:
        "No canonical NAP on file, so there is nothing to compare a listing AGAINST. Finish intake first.",
    };
  }

  const { data: step } = await supabaseAdmin
    .from("client_delivery_steps")
    .select("slack_anchor_ts")
    .eq("client_id", clientId)
    .eq("step_key", "presence_sweep_manual")
    .maybeSingle();

  const ts = (step?.slack_anchor_ts as string | null) ?? null;
  if (!ts) return empty;

  const { data: docs, error } = await supabaseAdmin
    .from("client_docs")
    .select("id, content_type, size_bytes, storage_ref, presence_platform")
    .eq("client_id", clientId)
    .eq("slack_thread_ts", ts)
    .not("presence_platform", "is", null)
    .order("uploaded_at", { ascending: true });

  if (error) return { ...empty, ok: false, error: error.message };

  const rows: SweepRow[] = await loadSweep(clientId);
  const byPlatform = new Map(rows.map((r) => [r.platform, r]));

  const out: ProposalPass = { ok: true, proposed: [], unreadable: [], alreadyConfirmed: [] };
  const done = new Set<string>();

  for (const doc of docs ?? []) {
    const platform = doc.presence_platform as string;
    // One screenshot per platform is enough: the first attributed shot IS the evidence, and
    // reading a second costs a model call to produce a second opinion nobody asked for.
    if (done.has(platform)) continue;

    const row = byPlatform.get(platform);
    if (!row) continue;

    if (row.confirmedStatus) {
      out.alreadyConfirmed.push(platform);
      done.add(platform);
      continue;
    }

    const contentType = (doc.content_type as string | null) ?? "";
    const ref = (doc.storage_ref as string | null) ?? null;
    if (!contentType.startsWith("image/") || !ref) continue;
    if (((doc.size_bytes as number | null) ?? 0) > MAX_VISION_BYTES) continue;

    const dl = await supabaseAdmin.storage.from("onboarding").download(ref);
    if (dl.error || !dl.data) continue;

    const buf = Buffer.from(await dl.data.arrayBuffer());
    const read = await readListing({ media_type: contentType, data: buf.toString("base64") });
    done.add(platform);

    if (read.legible < MIN_LEGIBLE) {
      out.unreadable.push({ platform, evidence: read.evidence });
      continue;
    }

    // ‼️ compareListing DECIDES, NOT THIS FILE. A listing that is not there is `missing`, which
    // is what passing null means and is why the empty-search-result screenshot is evidence.
    const result = compareListing(
      canonical,
      read.found ? { name: read.name, address: read.address, phone: read.phone } : null
    );

    const { error: writeError } = await supabaseAdmin
      .from("nap_discrepancies")
      .update({
        // ‼️ proposed_status. NEVER confirmed_status. See this file's header.
        proposed_status: result.status,
        raw_name: read.name,
        raw_address: read.address,
        raw_phone: read.phone,
        listing_url: read.listingUrl,
        screenshot_ref: ref,
        claimed: read.claimed,
      })
      .eq("id", row.id);

    if (writeError) {
      console.error("[clients/listing-read] proposal write failed:", writeError.message);
      continue;
    }

    out.proposed.push({ platform, result, read });
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Proposals into confirmations: the one human action
// ─────────────────────────────────────────────────────────────────────────────

export interface ConfirmListingsResult {
  ok: boolean;
  error?: string;
  confirmed: number;
  /** What was written, worst first, so the thread can say it rather than just count it. */
  byStatus: Record<string, string[]>;
}

/**
 * Copy every outstanding proposed_status into confirmed_status and stamp who did it.
 *
 * ‼️ THIS IS THE ONLY WRITER OF confirmed_status ON THIS PATH, AND IT RUNS FROM A BUTTON PRESS.
 * A proposal is a reading; a confirmation is somebody taking responsibility for it. The
 * citation cleanup list, the presence PDF and findings section 2 all read confirmed_status and
 * none of them reads proposed_status, so nothing a model wrote reaches a client-facing document
 * until this function runs.
 *
 * One tap for a whole batch, for the same reason the review grid confirms in one tap: the
 * alternative to a batch confirm is not more care, it is eighteen rows nobody ever confirms.
 */
export async function confirmProposedListings(args: {
  clientId: string;
  by: string;
}): Promise<ConfirmListingsResult> {
  const rows = (await loadSweep(args.clientId)).filter(
    (r) => r.proposedStatus !== null && r.confirmedStatus === null
  );

  if (!rows.length) return { ok: true, confirmed: 0, byStatus: {} };

  const stamp = new Date().toISOString();
  const byStatus: Record<string, string[]> = {};
  let confirmed = 0;

  for (const row of rows) {
    const status = row.proposedStatus as string;
    const { error } = await supabaseAdmin
      .from("nap_discrepancies")
      .update({ confirmed_status: status, checked_by: args.by, checked_at: stamp })
      .eq("id", row.id)
      // Same conditional-claim shape the other backfills use: a status somebody confirmed
      // between the read above and this write is left alone.
      .is("confirmed_status", null);

    if (error) return { ok: false, error: error.message, confirmed, byStatus };

    (byStatus[status] ??= []).push(platformByKey(row.platform)?.label ?? row.platform);
    confirmed += 1;
  }

  return { ok: true, confirmed, byStatus };
}

/** Worst first, the same order the cleanup list itself uses. */
const PROPOSAL_SEVERITY: Record<string, number> = {
  duplicate: 0,
  mismatch: 1,
  missing: 2,
  match: 3,
  not_checked: 4,
};

/**
 * The proposals as the step 14 card prints them.
 *
 * ‼️ EVERY LINE SAYS "PROPOSED" AND THE HEADER SAYS NOTHING IS RECORDED. A card that listed
 * eight findings without that word would read as eight findings, which is a green tick over
 * work nobody has checked. The screenshot is named on each line so the claim can be checked
 * against the picture it came from.
 */
export function formatCleanupProposals(rows: SweepRow[]): string[] {
  const proposals = rows
    .filter((r) => r.proposedStatus !== null && r.confirmedStatus === null)
    .sort(
      (a, b) =>
        (PROPOSAL_SEVERITY[a.proposedStatus ?? "not_checked"] ?? 9) -
        (PROPOSAL_SEVERITY[b.proposedStatus ?? "not_checked"] ?? 9)
    );

  if (!proposals.length) return [];

  const lines = [
    `*${proposals.length} listing${proposals.length === 1 ? "" : "s"} read off the screenshots in step 5's thread, worst first.*`,
    "*Nothing below is recorded.* These are proposals: every one of them reads as \"not checked\"",
    "on the client PDF until you confirm them, which is one tap.",
    "",
  ];

  for (const r of proposals) {
    const label = platformByKey(r.platform)?.label ?? r.platform;
    const detail =
      r.proposedStatus === "missing"
        ? "no listing found on the page"
        : [r.rawName, r.rawAddress, r.rawPhone].filter(Boolean).join(" · ") || "read, no fields legible";
    lines.push(`  • *${label}* — proposed \`${r.proposedStatus}\` — ${detail}`);
  }

  return lines;
}

/** Platforms that have a confirmed status already, for the card's own honesty line. */
export function confirmedCount(rows: SweepRow[]): number {
  return rows.filter((r) => effectiveStatus(r) !== "not_checked").length;
}

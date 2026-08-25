export const dynamic = "force-dynamic";
// The one button on the Instagram panel: add the lead, then draft the DM.
//
// A doorway, exactly like the CRM workflow route it is modelled on. Everything real lives in
// lib/instagram/dm-run.ts and lib/audit-engine/dm-pitch.ts, so the linter, the angle gates and the
// no-fabrication rules apply here identically to the email lane. A route that assembled its own
// prompt would bypass all of them silently, and the failure would look like slightly worse copy
// rather than like a bug.
//
// ‼️ IT RETURNS 202 AND A runId, NOT THE DRAFTS. A hook run is a crawl, a classify, four parallel
// engine calls and a model call, which does not fit in the 30s these /api/ext/* routes allow. The
// panel polls GET /api/ext/instagram/prospect/{runId}. Same split as /api/scan/start.

import { NextRequest } from "next/server";
import { requireExtTenant, jsonCors, preflight } from "@/lib/ext-auth";
import { supabaseAdmin } from "@/lib/db";
import { normalizeLeadPhone } from "@/lib/phone";
import {
  normalizeHandle,
  firstNameFrom,
  cityFromBio,
  resolveBioLink,
  resolveCityInput,
  unwrapInstagramLink,
  businessNameFrom,
} from "@/lib/instagram/profile";
import { IG_CLAIM_MINUTES, startDmRun, leadUrl, profileUrl } from "@/lib/instagram/dm-run";

export const runtime = "nodejs";
// ‼️ 300, NOT the 30 the other /api/ext/* routes use. The response goes out in about a second, but
// the scan continues inside waitUntil and that work counts against THIS function's budget: at 30
// the run would be killed mid-crawl and the row would sit on "running" forever. Same value, and
// the same reason, as the CRM workflow route that hosts the email hook.
export const maxDuration = 300;

export function OPTIONS(req: NextRequest) {
  return preflight(req);
}

interface Body {
  handle?: string;
  fullName?: string;
  bio?: string;
  externalUrl?: string | null;
  category?: string | null;
  businessEmail?: string | null;
  businessPhone?: string | null;
  /** A site Matthew typed into the panel. Beats anything scraped. */
  websiteOverride?: string | null;
  /** Set when he answered "no website at all" rather than pasting one. */
  noWebsite?: boolean;
  /**
   * A city or a ZIP he typed into the panel. Beats cityFromBio, and on most med spa profiles it is
   * the only source there is: the bio carries a booking link and no address.
   */
  cityOverride?: string | null;
  /** Set when he answered "I don't know" to the city prompt. The scan then runs national questions. */
  noCity?: boolean;
  /**
   * The BUSINESS name he typed into the panel, replacing what was read off the profile.
   *
   * ‼️ IT IS THE DIFFERENCE BETWEEN A SCAN AND NO SCAN. leahskinmethod posts under her own name, so
   * businessNameFrom(fullName) produced "Leah", research was handed a person's first name with no
   * city, missed entirely, and the DM went out having measured nothing. The clinic is The Plump
   * Room and only a person knows that.
   */
  businessNameOverride?: string | null;
  /** Free text from the panel, passed to the drafter verbatim. */
  instructions?: string | null;
}

export async function POST(req: NextRequest) {
  const tenant = await requireExtTenant(req);
  if (!tenant) return jsonCors(req, { ok: false, error: "unauthorized" }, 401);

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return jsonCors(req, { ok: false, error: "Invalid JSON body" }, 400);
  }

  const handle = normalizeHandle(body.handle);
  if (!handle) {
    return jsonCors(req, { ok: false, error: "No Instagram handle on this page.", field: "handle" }, 400);
  }

  const bio = (body.bio ?? "").trim();
  const fullName = (body.fullName ?? "").trim();
  // ‼️ The BUSINESS name, never the person and never a URL. classifyBusiness pins its name
  // override to whatever it is handed and every alias and mention match downstream is built from
  // it; see the override doc in classify.ts. An empty string is the right answer when the profile
  // gave us nothing usable, because it lets the classifier read the name off the crawled pages.
  // ‼️ WHAT HE TYPED BEATS WHAT WAS SCRAPED, on both fields, and `typedBy` is what carries that
  // distinction down to upsertContact. Every other value here is read off a profile page, and a
  // scrape is a weaker source than a person: the CRM's "only fill blanks" rule is right for the
  // former and exactly wrong for the latter, which is how `business_name: "Leah"` survived.
  const typedName = (body.businessNameOverride ?? "").trim();
  const businessName = typedName || businessNameFrom(fullName);
  const firstName = firstNameFrom(fullName);

  const typedCity = (body.cityOverride ?? "").trim();
  const resolvedTypedCity = typedCity ? await resolveCityInput(typedCity) : null;
  if (typedCity && !resolvedTypedCity) {
    return jsonCors(
      req,
      {
        ok: false,
        error: `I could not place "${typedCity}". Type a city name rather than a ZIP.`,
        field: "cityOverride",
      },
      400
    );
  }
  const city = resolvedTypedCity ?? cityFromBio(bio);

  // 1. Where the site comes from, in priority order. What Matthew typed always wins.
  const typed = (body.websiteOverride ?? "").trim();
  let website: string | null = null;
  let websiteNote = "";
  if (typed) {
    website = unwrapInstagramLink(typed);
    websiteNote = website ? "Website typed in the panel." : "";
    if (!website) {
      return jsonCors(req, { ok: false, error: `That does not look like a URL: ${typed}`, field: "websiteOverride" }, 400);
    }
  } else if (!body.noWebsite) {
    const resolved = await resolveBioLink(body.externalUrl);
    website = resolved.website;
    websiteNote = resolved.note;
  } else {
    websiteNote = "Marked as having no website of their own.";
  }

  // 2. The lead is created either way. Matthew asked for one press, and a profile worth scanning is
  //    a profile worth having in the CRM even when the scan cannot run yet.
  const contactId = await upsertContact({
    handle,
    businessName,
    firstName,
    website,
    city,
    email: (body.businessEmail ?? "").trim() || null,
    phone: (body.businessPhone ?? "").trim() || null,
    category: (body.category ?? "").trim() || null,
    typedName: Boolean(typedName),
    typedCity: Boolean(resolvedTypedCity),
  });

  // 3. No site and he has not yet said there is none: ask, and spend nothing.
  if (!website && !body.noWebsite) {
    return jsonCors(req, {
      ok: true,
      needsWebsite: true,
      contactId,
      leadUrl: leadUrl(contactId),
      handle,
      businessName,
      note: websiteNote,
    });
  }

  // 3b. No site, and no idea where they are: ask, and spend nothing. Twin of the gate above, and
  //     it sits here for the same reason that one does, BEFORE the claim guard and the run row.
  //
  // ‼️ GATED ON `!website` ONLY. The hook lane reads the city off the pages it crawls
  // (classification.city_detected), so asking there would be asking a question that already has an
  // answer. This lane has nothing to read: runMiniVisibilityCheck resolves the city from what it is
  // handed or from research that has usually already missed, and a null there means three national
  // questions asked about a local business.
  //
  // `noCity` is a real answer, not a giving-up. The scan runs, the questions go out without a
  // location, and DmSubject.cityless plus the dm-cityless lint rule keep the message from claiming
  // a local result it never measured.
  if (!website && !city && !body.noCity) {
    return jsonCors(req, {
      ok: true,
      needsCity: true,
      contactId,
      leadUrl: leadUrl(contactId),
      handle,
      businessName,
      note: websiteNote,
    });
  }

  // 4. Claim guard. A run is a crawl, a classify, four engine calls and a model call, and a
  //    double-click must not spend it twice. Same intent as HOOK_CLAIM_MINUTES on the CRM button.
  //
  // ‼️ ONLY A `running` RUN HOLDS THE CLAIM, and the missing status filter here was a live bug.
  // A double-click arrives while the first press is still running, so `running` is the whole of
  // what this guard needs. Matching any recent row instead meant a run that had already FAILED
  // went on being served as if it were in flight: the panel polled the dead run and re-rendered
  // its stored error_detail, so every press for the next five minutes replayed the first failure.
  // It made the panel look frozen and made "They have no website" look like it did nothing, when
  // in fact the flag was never read, because the route returned above the line that reads it.
  //
  // A `done` run does NOT hold the claim either. Pressing again after one finished is a deliberate
  // second press, and it usually carries new input: a website typed into the panel, or the
  // no-website flag. Serving the old row would silently ignore what was just typed.
  const since = new Date(Date.now() - IG_CLAIM_MINUTES * 60_000).toISOString();
  const { data: inFlight } = await supabaseAdmin
    .from("ig_dm_runs")
    .select("id, status")
    .eq("handle", handle)
    .eq("status", "running")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (inFlight?.id) {
    // Not an error for the panel: it just attaches to the run already going.
    return jsonCors(req, {
      ok: true,
      runId: inFlight.id as string,
      contactId,
      leadUrl: leadUrl(contactId),
      handle,
      website,
      reused: true,
      note: `A run for this profile is still going. Showing that one.`,
    });
  }

  const { data: run, error } = await supabaseAdmin
    .from("ig_dm_runs")
    .insert({
      tenant_id: tenant.tenantId,
      contact_id: contactId,
      handle,
      website,
      status: "running",
    })
    .select("id")
    .single();

  if (error || !run?.id) {
    return jsonCors(req, { ok: false, error: `Could not start the run: ${error?.message ?? "no row"}` }, 500);
  }

  startDmRun({
    runId: run.id as string,
    contactId,
    handle,
    website,
    businessName,
    firstName,
    city,
    // The bio was read at the top of this route, used once by cityFromBio, and thrown away. It is
    // often the best statement of what they sell that exists anywhere: see tradeFromBio.
    bio: bio || null,
    instructions: body.instructions ?? null,
  });

  return jsonCors(
    req,
    {
      ok: true,
      runId: run.id as string,
      contactId,
      leadUrl: leadUrl(contactId),
      profileUrl: profileUrl(handle),
      handle,
      website,
      businessName,
      firstName,
      city,
      note: websiteNote,
    },
    202
  );
}

/**
 * Create or update the CRM lead for this profile.
 *
 * Deduped on `instagram_handle`, which is the only identifier a profile reliably has: many med
 * spas publish no email and a shared front-desk number, so phone and email are not keys here.
 *
 * ‼️ ONLY FILLS BLANKS, EXCEPT WHERE A PERSON TYPED IT. `upsert` would overwrite a hand-corrected
 * business name or a website Matthew fixed in the CRM with whatever the bio says today, and a
 * scrape is a weaker source than a person. So an existing row is patched field by field, and only
 * where it is empty.
 *
 * `typedName` / `typedCity` are the inverse case and they invert the rule for exactly those two
 * fields. A value Matthew typed into the panel is a person correcting the scrape, which is the
 * stronger source by the same argument, so it overwrites. Without this, a wrong business name read
 * off a profile is permanent: the row is never blank again, so every future press re-reads "Leah"
 * and research keeps missing.
 */
async function upsertContact(input: {
  handle: string;
  businessName: string;
  firstName: string | null;
  website: string | null;
  city: string | null;
  email: string | null;
  phone: string | null;
  category: string | null;
  typedName: boolean;
  typedCity: boolean;
}): Promise<string | null> {
  const { data: existing } = await supabaseAdmin
    .from("contacts")
    .select("id, first_name, business_name, website, email, phone, biz_city, biz_state")
    .eq("instagram_handle", input.handle)
    .maybeSingle();

  const [cityPart, statePart] = (input.city ?? "").split(",").map((s) => s.trim());
  const phone = input.phone ? normalizeLeadPhone(input.phone) : "";

  if (existing?.id) {
    const patch: Record<string, unknown> = {};
    if (!existing.first_name && input.firstName) patch.first_name = input.firstName;
    if ((input.typedName || !existing.business_name) && input.businessName) {
      patch.business_name = input.businessName;
    }
    if (!existing.website && input.website) patch.website = input.website;
    if (!existing.email && input.email) patch.email = input.email;
    if (!existing.phone && phone) patch.phone = phone;
    if ((input.typedCity || !existing.biz_city) && cityPart) patch.biz_city = cityPart;
    if ((input.typedCity || !existing.biz_state) && statePart) patch.biz_state = statePart;

    if (Object.keys(patch).length > 0) {
      await supabaseAdmin.from("contacts").update(patch).eq("id", existing.id);
    }
    return existing.id as string;
  }

  const { data, error } = await supabaseAdmin
    .from("contacts")
    .insert({
      // first_name is required by the CRM's own create route. The handle is the honest fallback
      // here, unlike for the business name: it is what this lead is actually called on Instagram,
      // and it never reaches a prospect, because the DM greeting uses firstName or no greeting.
      first_name: input.firstName || input.handle,
      business_name: input.businessName || null,
      website: input.website,
      email: input.email,
      phone: phone || null,
      biz_city: cityPart || null,
      biz_state: statePart || null,
      instagram_handle: input.handle,
      source: "Instagram",
    })
    .select("id")
    .single();

  if (error) {
    // The unique index can reject a concurrent insert for the same handle. That is the index doing
    // its job, not a failure: re-read and use the row that won. Returning null here would run the
    // scan with no lead attached and drop the timeline note.
    const { data: raced } = await supabaseAdmin
      .from("contacts")
      .select("id")
      .eq("instagram_handle", input.handle)
      .maybeSingle();
    if (raced?.id) return raced.id as string;

    console.error("[ig/prospect] contact insert failed:", error.message);
    return null;
  }
  return (data?.id as string) ?? null;
}

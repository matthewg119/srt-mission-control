// One vertical, everything about it, in one place.
//
// ‼️ WHY A REGISTRY AND NOT FOUR CONSTANTS IN FOUR FILES. Adding a vertical used to mean editing
// `DFS_CATEGORIES` in maps-command.ts, `ICP_BY_VERTICAL` in icp.ts, a tier taxonomy that did not
// exist, and the campaign name at the recordHandoff call site in lane.ts. Four places is three
// places to forget, and the failure is silent in the worst way: a vertical with an ICP but no
// categories pulls nothing, and a vertical with categories but no campaign name hands its addresses
// off under a batch label. The TRT vertical is the recorded precedent for what that costs: it was
// added by forking medspa.ts into a 485 line twin and the column names drifted apart inside a week.
//
// ‼️ THE ICP TEXT STAYS IN icp.ts AND IS ONLY REFERENCED FROM HERE. That file's own header states
// the rule and it is right: prompt-shaped constants get their own file, the way
// src/data/disposable-domains.ts does. A paragraph of buyer profile inlined into a registry object
// is a paragraph nobody will reformat correctly in a diff.
//
// ‼️ AND THE CATEGORY LIST FOR A LIVE VERTICAL MAY NOT BE EDITED. scraper_cells is keyed on
// (vertical_slug, categories_key, cell_key), so changing `medspa`'s list turns every stored count
// into the answer to a question nobody asked any more and invalidates every paged offset, with
// nothing to say so. docs/2026-09-28-national-coverage-cells.sql states the remedy: a NEW VERTICAL
// SLUG, never an edit. Appending a query string is safe; appending a category is not.
//
// ‼️ NO EM DASHES. Parts of this file are compiled into a prompt.

import { DENTIST_ICP, MED_SPA_ICP } from "./icp";

/**
 * A tier band and the `judged_vertical` values that fall in it.
 *
 * ‼️ THE MODEL'S VOCABULARY AND THE STORED COLUMN ARE THE SAME LIST, ON PURPOSE. `tierPromptLines`
 * below compiles these arrays into the qualify prompt, so the model is shown exactly the strings it
 * is allowed to answer with, and `tierOf` maps an answer back to a band out of the same arrays. A
 * prompt that listed the categories in prose would let the model invent "medical aesthetics spa",
 * which stores fine, tiers as null, and quietly leaves the lead out of every Tier A count.
 */
export interface TierBand {
  tier: "A" | "B" | "C";
  /** Lower case, hyphen free, stable. These strings are written to raw_leads.judged_vertical. */
  verticals: readonly string[];
}

export interface VerticalDef {
  /**
   * serviceKey() shaped: lowercased, every non-alphanumeric stripped.
   *
   * ‼️ NEVER RENAMED. It is written onto every raw lead and every run, so a rename orphans the rows
   * carrying the old one. `medspa` now describes a front-desk buyer rather than a medical spa and
   * the key stayed anyway, which is why icp.ts's comment says the name is narrower than the profile.
   */
  slug: string;
  /** For cards and the territory page. Prose, changeable, never a key. */
  label: string;
  /** The buyer profile, by reference. Copied verbatim onto every run as list_pipeline_runs.icp_text. */
  icp: string;
  /**
   * DataForSEO category keys. THE ACTUAL SEARCH FILTER on the listings endpoint.
   *
   * ‼️ FROZEN FOR A LIVE VERTICAL. See the header: scraper_cells is keyed on this list.
   */
  dfsCategories: readonly string[];
  /**
   * The text searches this vertical is worth running, one per line of business.
   *
   * ‼️ THESE DRIVE THE OUTSCRAPER DOOR AND THE PLAN VIEW, NOT THE DataForSEO FILTER, and the
   * difference matters before anybody reads this list as coverage. `pullFromDataForSeo` searches on
   * `categories` and uses the query string only as provenance (`raw_leads.source_query`), so adding
   * "IV therapy" here does NOT make a DataForSEO pull find IV bars that `medical_spa` and friends
   * were not already returning. What it does do is give the territory plan view a command per line
   * of business, keep the provenance readable per row, and search properly on the Outscraper door,
   * which takes one string.
   *
   * To genuinely widen a DataForSEO pull you need a category, and a category needs a new slug.
   */
  searchQueries: readonly string[];
  /**
   * The ReachInbox campaign these addresses are handed off under.
   *
   * ‼️ IT REPLACES THE BATCH LABEL, WHICH WAS NEVER A CAMPAIGN NAME. recordHandoff was being given
   * `batch.batch_label`, so outreach_prospects.campaign held strings like
   * "pull maps medspa | Dallas TX | med spa | limit 500". reachinbox_campaign_funnel GROUPS on that
   * column, so every pull was its own campaign of one and the funnel could never report a rate.
   * Provenance did not need the campaign name to carry it: source_query and source_metro are on
   * every row already.
   */
  campaign: string;
  /**
   * The exact `contacts.source` the call list is written under.
   *
   * ‼️ A CONTROLLED VOCABULARY, MATCHED EXACTLY, AND NOT DERIVED FROM `label`. The leads page
   * filters on this column with `eq`, and its own comment says why: a substring match would merge
   * "Med Spa Scrape" with "Med Spa Scrape - No Website", which are the email list and the call
   * list, two different jobs. Deriving it from `label` produced
   * "Med spa and aesthetics Scrape - No Website" on the first run of the backfill: 253 contacts in
   * a fifth bucket that no filter on the page knows about.
   *
   * ‼️ AND IT KEEPS THE "- No Website" SUFFIX EVEN THOUGH THE CALL LIST IS NOW WIDER THAN THAT.
   * Four things route here: no website, a platform-only domain, a domain with no MX, and Tier C.
   * The suffix is no longer a precise description, and it IS the string 92 existing rows and the
   * page's filter already use. Renaming it would split one list in two to win an adjective. The
   * actual reason per lead is on the row, in `next_action_reason`.
   */
  crmSource: string;
  /**
   * What a judged business is worth, and the vocabulary the model may answer with.
   *
   * ‼️ TIER C IS LISTED, NOT OMITTED. A band we never email still has to be NAMED, or the model has
   * nowhere to put a nail bar and will force it into B. Naming it is what sends it to the call list
   * instead of the bin.
   */
  tiers: readonly TierBand[];
}

/**
 * Med spa, which is really the front-desk buyer.
 *
 * ‼️ THE FIVE CATEGORIES AND THEIR MEASURED KEEP RATES, which is why this list is what it is. From
 * the 500 record Dallas pull, by the primary category Google shows:
 *
 *   medical_spa                 146 pulled, 78 kept   53%
 *   laser_hair_removal_service    6 pulled,  4 kept   67%
 *   permanent_make_up_clinic      6 pulled,  3 kept   50%
 *   skin_care_clinic             77 pulled,  7 kept    9%
 *   facial_spa                   71 pulled,  5 kept    7%
 *
 * The two weak ones are kept deliberately: they are where most of the nail salons ride in, but they
 * still produced 12 real clinics per 500. Noise that gets filtered is cheaper than coverage that is
 * never pulled.
 *
 * ‼️ AND `day_spa` AND `beauty_salon` ARE STILL ABSENT. They kept 0 of 35 between them. A category
 * earns its place by converting, not by sounding adjacent.
 */
const MEDSPA: VerticalDef = {
  slug: "medspa",
  label: "Med spa and aesthetics",
  icp: MED_SPA_ICP,
  dfsCategories: [
    "medical_spa",
    "facial_spa",
    "skin_care_clinic",
    "laser_hair_removal_service",
    "permanent_make_up_clinic",
  ],
  searchQueries: [
    "med spa",
    "testosterone clinic",
    "men's health clinic",
    "weight loss clinic",
    "IV therapy",
  ],
  campaign: "medspa-front-desk",
  crmSource: "Med Spa Scrape - No Website",
  tiers: [
    {
      tier: "A",
      verticals: [
        "med spa",
        "aesthetics clinic",
        "trt clinic",
        "weight loss clinic",
        "iv therapy",
        "cosmetic dental",
      ],
    },
    { tier: "B", verticals: ["high end salon", "lash and brow", "chiropractor", "wellness clinic"] },
    { tier: "C", verticals: ["nail bar", "barber", "budget salon", "tattoo studio"] },
  ],
};

/**
 * Dentists, the second vertical.
 *
 * ‼️ ITS TIERS ARE UNMEASURED AND SAY SO. The med spa bands above come from a 500 record pull with
 * per-category keep rates. Nothing comparable has been pulled for dentistry, so these bands are a
 * reasoned guess: the general and cosmetic practices that compete on "best dentist near me" are A,
 * the adjacent specialists who buy differently are B, and the places with no patient to ask for a
 * review are C. Re-measure before trusting a Tier A count here, exactly as qualify.ts says to
 * re-measure the model: telling a med spa from a nail salon is not the same task as telling a family
 * practice from a denture clinic.
 *
 * ‼️ NPPES IS WORTH RUNNING HERE AND NOWHERE ELSE. Measured 2026-10-06: over 75 nameless Dallas med
 * spas it named 2, of which 1 was usable. A prior measurement found an authorized official on 20 of
 * 20 Oklahoma dental practices. See docs/2026-10-06-nppes-coverage.md.
 */
const DENTIST: VerticalDef = {
  slug: "dentist",
  label: "Dental practices",
  icp: DENTIST_ICP,
  dfsCategories: ["dentist", "cosmetic_dentist"],
  searchQueries: ["dentist", "cosmetic dentist", "family dentistry", "orthodontist", "dental implants"],
  campaign: "dentist-ai-visibility",
  crmSource: "Dentist Scrape - No Website",
  tiers: [
    {
      tier: "A",
      verticals: ["general dentistry", "cosmetic dental", "implant dentistry", "orthodontist"],
    },
    { tier: "B", verticals: ["pediatric dentistry", "periodontist", "endodontist", "oral surgeon"] },
    { tier: "C", verticals: ["denture clinic", "dental lab", "mobile dental"] },
  ],
};

/**
 * Every vertical this lane can build a list for.
 *
 * ‼️ ADDING ONE IS THIS OBJECT AND NOTHING ELSE. The ICP goes in icp.ts and is referenced; the
 * categories, queries, campaign and tiers go here. maps-command.ts, lane.ts and the territory page
 * all read through the helpers below, so nothing else needs touching.
 */
export const VERTICALS: readonly VerticalDef[] = [MEDSPA, DENTIST];

const BY_SLUG = new Map(VERTICALS.map((v) => [v.slug, v]));

/**
 * One vertical, or null.
 *
 * ‼️ NULL RATHER THAN A MED SPA DEFAULT, for the reason icpFor states. A `?? medspa` fallback is the
 * bug family that has bitten this codebase four separate times: it makes a wrong vertical look like
 * a working one, and a dentist list judged against the med spa profile drops every row for a reason
 * that reads plausible. Callers refuse.
 */
export function verticalDef(slug: string | null | undefined): VerticalDef | null {
  return BY_SLUG.get((slug || "").trim().toLowerCase()) ?? null;
}

/** DataForSEO category keys for a vertical. Empty means a DataForSEO pull would search for nothing. */
export function categoriesFor(slug: string | null | undefined): readonly string[] {
  return verticalDef(slug)?.dfsCategories ?? [];
}

/** The ReachInbox campaign for a vertical, or null when the vertical is unknown. */
export function campaignFor(slug: string | null | undefined): string | null {
  return verticalDef(slug)?.campaign ?? null;
}

/**
 * The `contacts.source` this vertical's call list is written under, or null.
 *
 * ‼️ NULL RATHER THAN A GUESSED STRING, for the reason verticalDef states. A call list written
 * under an invented source is a call list that exists in the table and on no filter.
 */
export function crmSourceFor(slug: string | null | undefined): string | null {
  return verticalDef(slug)?.crmSource ?? null;
}

/**
 * The band a judged vertical falls in, or null.
 *
 * ‼️ NULL IS NOT TIER C. An answer we do not recognise has not been tiered, and reading it as the
 * never-email band would silently stop mailing a business because the model used a synonym.
 * `verdictFaults` in qualify.ts refuses the unrecognised answer at the door instead, so this
 * returning null means something got past it and is worth seeing as "untiered" on the card.
 */
export function tierOf(slug: string | null | undefined, judged: string | null | undefined): "A" | "B" | "C" | null {
  const def = verticalDef(slug);
  const answer = (judged || "").trim().toLowerCase();
  if (!def || !answer) return null;
  for (const band of def.tiers) {
    if (band.verticals.includes(answer)) return band.tier;
  }
  return null;
}

/** Every judged_vertical string a vertical's model may answer with. The prompt's whole vocabulary. */
export function judgedVerticalsFor(slug: string | null | undefined): string[] {
  const def = verticalDef(slug);
  if (!def) return [];
  return def.tiers.flatMap((b) => [...b.verticals]);
}

/**
 * The tier taxonomy, as prompt lines.
 *
 * ‼️ COMPILED FROM THE SAME ARRAYS `tierOf` READS, which is the only reason the model's answers can
 * be trusted to tier. Writing the bands out by hand in the prompt would be a second copy, and the
 * first thing a second copy does is disagree: the model would be told about "medical aesthetics"
 * while the mapper only knows "aesthetics clinic", and every such lead would store untiered.
 */
export function tierPromptLines(slug: string | null | undefined): string[] {
  const def = verticalDef(slug);
  if (!def) return [];
  return def.tiers.map(
    (b) => `Tier ${b.tier}: ${b.verticals.join(", ")}` + (b.tier === "C" ? "   (stored and called, never emailed)" : "")
  );
}

/** Known slugs, sorted, for cards and refusal messages. */
export function verticalSlugs(): string[] {
  return VERTICALS.map((v) => v.slug).sort();
}

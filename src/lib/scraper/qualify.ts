// Stage 2: keep or drop, with a written reason, BEFORE a penny of enrichment is spent.
//
// Matthew, 2026-09-17: "AI qualification against ICP → keep/drop + written reason (before enrichment
// this is where the money is) ... Qualifying before enriching kills roughly half the enrichment spend
// on companies we were always going to drop. That one reorder pays for the build."
//
// ‼️ THERE IS NO SKIP PATH, AND THAT IS THE WHOLE DESIGN. The state after the picker resolves to
// Workflow C is `qualifying`, unconditionally. A "just this once" bypass is how the reorder stops
// being true, and once one list has skipped it every later list has a precedent.
//
// ‼️ THE REASON IS NOT DECORATION, IT IS THE CHECKPOINT. A few thousand rows cut for ONE reason means
// the ICP is wrong, not that the list is bad, and that has to be visible before the money goes. So
// every verdict carries prose a person can read in bulk, grouped and counted the way junk.csv already
// reports its own drops.
//
// ‼️ A FAILED VERDICT IS `null`, NEVER `false`. The tri-state rule mx.ts already documents: a model
// that timed out has not judged the company, and recording that as a drop silently throws away rows
// nobody decided about. Unjudged rows are reported as unjudged and re-run.

import { callClaudeJSON } from "@/lib/claude-calls";
import { judgedVerticalsFor, tierOf, tierPromptLines } from "./verticals";
import { reviewBand, routeForTier, type LeadRoute } from "./tiering";

/**
 * ‼️ HAIKU, AND IT WAS MEASURED RATHER THAN ASSUMED. Swapping a model to save money is only a saving
 * if it judges the same way, so both were run over the SAME 35 Dallas rows that reached the model on
 * 2026-09-27: they agreed on 34 of 35, which is 97%.
 *
 * The single disagreement is the reassuring part. Haiku kept `VIO Med Spa | Richardson`, a franchise
 * Sonnet dropped, and that is the SAFE direction to be wrong in: a false keep costs a crawl, which is
 * free, and at worst one MillionVerifier credit. A false drop loses a lead nobody will ever look at
 * again. Rule 3 of the system prompt already asks for exactly that bias.
 *
 * Cost, at the published rates: $2.56 per 10,000 businesses against $7.69 on sonnet-4-6.
 *
 * Re-measure before assuming this holds for a new vertical. Telling a med spa from a nail salon is
 * not the same task as telling a plumber from a handyman.
 */
const MODEL = "claude-haiku-4-5-20251001" as const;

/**
 * Stamped onto every verdict as `raw_leads.qualify_model`.
 *
 * ‼️ RECORDED PER ROW RATHER THAN PER RUN, because a run can span a model change: the sweep is
 * re-entered every five minutes and a deploy lands between ticks. Comparing two runs' keep rates
 * without knowing which model judged which half is comparing nothing.
 */
export const QUALIFY_MODEL: string = MODEL;

/** Small enough that one bad row cannot cost the batch, big enough that the ICP is not re-sent per company. */
export const QUALIFY_CHUNK = 20;

export interface QualifyCandidate {
  id: string;
  businessName: string;
  domain: string | null;
  /** The raw cell, so the free rules can tell "blank" from "somebody else's platform". */
  website: string | null;
  city: string | null;
  state: string | null;
  categories: string | null;
  primaryType: string | null;
  rating: number | null;
  reviewCount: number | null;
  instagramHandle: string | null;
  /**
   * Whether the owner has verified the Google listing.
   *
   * ‼️ SHOWN TO THE MODEL BECAUSE RULE 5 ASKS ABOUT TRADING, and this is the one field in the
   * payload that speaks to it directly. 429 of the Dallas 500 are claimed and 71 are not; an
   * unclaimed listing with four reviews is a different proposition from a claimed one with four.
   * Null is printed as nothing rather than as "not claimed", for the reason the column comment gives.
   */
  isClaimed: boolean | null;
}

export interface Verdict {
  id: string;
  /** null means the model did not judge it. Never coerce this to false. */
  keep: boolean | null;
  reason: string;
  /**
   * What the business IS, out of the vertical's own vocabulary, or null on a drop or a failure.
   *
   * ‼️ IT IS NOT THE RUN'S VERTICAL. A `medspa` pull returns nail bars, and that is a fact worth
   * storing rather than discarding: a row tagged `nail bar` is a lead a future salon campaign
   * already owns, and re-pulling the metro to find it again would pay for the records twice.
   */
  judgedVertical: string | null;
  /** A, B or C, derived from judgedVertical by tierOf. null on a drop or a failure. */
  tier: "A" | "B" | "C" | null;
  /**
   * Where the lead goes. DERIVED, never asked for.
   *
   * ‼️ THE MODEL IS NOT ASKED WHICH CHANNEL TO USE, and that is deliberate. It is being asked
   * what a business is, which it can see; "email or call" depends on the state of our MillionVerifier
   * credits and of the crawl, which it cannot. routeForTier in tiering.ts owns that mapping, in one
   * place, so changing it does not mean re-running a model over 500 rows.
   */
  route: LeadRoute | null;
}

/**
 * The judge's standing instructions.
 *
 * ‼️ IT ASKS WHAT THE BUSINESS IS, NOT WHETHER WE WANT IT, AND THAT IS THE CHANGE OF 2026-10-08.
 * A boolean made the model decide both at once, and the widened front-desk profile made that
 * impossible to use: 256 of 500 Dallas rows were kept, and 24 of the 155 still unenriched carry 300+
 * reviews, mostly the salons and nail bars the widened profile admits. One keep flag cannot say
 * "yes, and email it last". Naming the business lets tiering decide priority with no second call.
 *
 * ‼️ THE VOCABULARY IS GIVEN RATHER THAN DESCRIBED. The vertical list in the user message is
 * compiled from the same arrays tierOf() reads, so an answer either tiers or is refused at the door
 * by verdictFaults. Asking for a free-text category instead gets "medical aesthetics spa", which
 * stores fine, tiers as null, and silently leaves the lead out of every Tier A count.
 *
 * ‼️ AND RULE 6 IS THE ONE THAT CHANGED THE ECONOMICS. An off-vertical business used to be a
 * drop, so a nail bar in a med spa pull was paid for and then thrown away. Now it is stored with its
 * own tag, which means the first salon campaign starts with leads already bought.
 */
const SYSTEM = [
  "You are classifying companies against an ideal customer profile, before anybody spends money",
  "enriching them. For each company return the vertical it belongs to and one short reason.",
  "",
  "RULES:",
  "1. Judge ONLY against the profile you are given. Not against whether the business looks good.",
  "2. `vertical` must be EXACTLY one of the strings in the list you are given, or the single word",
  "   `drop`. Do not invent a category, do not pluralise one, and do not combine two.",
  "3. `drop` is for a business the profile excludes: a national chain location, a company that sells",
  "   TO clinics, a hospital or large medical group, a permanently closed listing, or a directory",
  "   entry rather than a real business. Nothing else.",
  "4. The reason is read in bulk by a person looking for a pattern, so write the ACTUAL criterion",
  "   that decided it, in four to twelve words. 'not a fit' is useless. 'chain, not owner operated'",
  "   is the whole point.",
  "5. When the row does not say enough to judge, pick the closest vertical and say what was missing.",
  "   Do NOT drop it. A cheap enrichment on a maybe beats losing a company nobody looked at, and the",
  "   tier decides how soon it gets contacted anyway.",
  "6. A business that is not this profile's trade but is still a real local business with a front",
  "   desk gets the closest vertical on the list, never `drop`. Those are kept and contacted on a",
  "   different campaign; dropping one means paying to pull it again later.",
  "7. Return a verdict for every id you were given, and invent no ids.",
  "8. Never use an em dash.",
].join("\n");

const SCHEMA_HINT =
  `{ "verdicts": [ { "id": "the id given", "vertical": "one of the listed strings, or drop", ` +
  `"reason": "why, in a few words" } ] }`;

function describe(c: QualifyCandidate): string {
  return [
    `id: ${c.id}`,
    `  name: ${c.businessName}`,
    c.domain ? `  website: ${c.domain}` : "  website: none found",
    c.city || c.state ? `  where: ${[c.city, c.state].filter(Boolean).join(", ")}` : "",
    c.categories ? `  categories: ${c.categories}` : "",
    c.primaryType ? `  google type: ${c.primaryType}` : "",
    c.reviewCount !== null ? `  reviews: ${c.reviewCount}${c.rating !== null ? ` at ${c.rating}` : ""}` : "",
    c.isClaimed === false ? "  google listing: NOT claimed by the owner" : "",
    // ‼️ THE BAND NEXT TO THE COUNT, NOT INSTEAD OF IT. The count is strictly more information, so
    // replacing it would be a loss; what the band adds is the same bucketing a person reasons in,
    // which is what rule 5 of the system prompt needs when it asks whether a business is plainly
    // still trading. "4 reviews" and "small" together say more than either alone.
    //
    // ‼️ AND IT IS A HINT, BECAUSE THE DISTRIBUTION SAYS IT CANNOT BE A VERDICT. The 1 to 99 band is
    // 65% of everything that became sendable and 60% of the 155 still unenriched. A rule that cut it
    // would delete most of the list; one that preferred the 300+ tail would preferentially email the
    // salons and nail bars the widened ICP admits. See reviewBand in tiering.ts.
    c.reviewCount !== null ? `  size: ${reviewBand(c.reviewCount)} by review count` : "",
    c.instagramHandle ? `  instagram: @${c.instagramHandle}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * The word the model answers with when the profile excludes a business.
 *
 * ‼️ A SENTINEL IN THE SAME FIELD RATHER THAN A SECOND FIELD. Two fields (`vertical` plus
 * `keep`) let the model answer "nail bar" and "keep: false", which is two verdicts disagreeing, and
 * the writer would have to pick one. One field has one answer.
 *
 * ‼️ AND IT MUST NEVER COLLIDE WITH A REAL VERTICAL. `verticalVocabularyFaults` asserts that in
 * the probe, because a vertical literally named "drop" would make every one of its leads a drop.
 */
export const DROP_ANSWER = "drop";

/**
 * Every reason a batch of verdicts is unusable. Pure, for the probe.
 *
 * ‼️ THE VOCABULARY IS CHECKED HERE, AT THE DOOR, AND NOT LEFT TO TIER AS null LATER. callClaudeJSON
 * retries on a validation failure, so a refused batch is re-asked; a batch accepted with an
 * unrecognised vertical is written to 500 rows that tier as null, and nothing anywhere says the
 * model used a synonym. The expensive version of this mistake is silent, so the check is loud.
 */
export function verdictFaults(
  raw: unknown,
  ids: readonly string[],
  allowed: readonly string[]
): string[] {
  const faults: string[] = [];
  const v = raw as { verdicts?: unknown } | null;
  const list = Array.isArray(v?.verdicts) ? (v!.verdicts as Array<Record<string, unknown>>) : [];

  if (!list.length) return ["no verdicts were returned."];

  const given = new Set(ids);
  const seen = new Set<string>();
  const vocabulary = new Set([...allowed.map((a) => a.toLowerCase()), DROP_ANSWER]);

  for (const r of list) {
    const id = typeof r.id === "string" ? r.id : "";
    if (!id) faults.push("a verdict has no id.");
    else if (!given.has(id)) faults.push(`verdict names ${id}, which was not in the batch.`);
    else if (seen.has(id)) faults.push(`${id} is judged twice.`);
    else seen.add(id);

    const vertical = typeof r.vertical === "string" ? r.vertical.trim().toLowerCase() : "";
    if (!vertical) faults.push(`${id || "a verdict"}: a vertical is required.`);
    else if (!vocabulary.has(vertical)) {
      faults.push(
        `${id || "a verdict"}: \`${vertical}\` is not one of the verticals it was given. ` +
          `Use exactly one of: ${[...vocabulary].join(", ")}.`
      );
    }

    const reason = typeof r.reason === "string" ? r.reason.trim() : "";
    if (!reason) faults.push(`${id || "a verdict"}: a reason is required.`);
    else if (reason.length > 160) faults.push(`${id}: the reason is over 160 characters.`);
    else if (reason.includes("—")) faults.push(`${id}: the reason carries an em dash.`);
  }

  const missing = ids.filter((i) => !seen.has(i));
  if (missing.length) faults.push(`${missing.length} of ${ids.length} companies were not judged.`);

  return faults;
}

/**
 * Whether a vertical's own tier vocabulary is usable as a prompt vocabulary. Pure, for the probe.
 *
 * ‼️ THE TWO FAILURES IT CATCHES ARE BOTH SILENT. A band listing the literal word "drop" would
 * turn every business in that band into a drop, and the same string in two bands would make tierOf
 * return whichever band is iterated first, so a lead's tier would depend on array order. Neither
 * shows up as an error; both change what gets emailed.
 */
export function verticalVocabularyFaults(words: readonly string[]): string[] {
  const faults: string[] = [];
  const seen = new Set<string>();
  for (const w of words) {
    const k = w.trim().toLowerCase();
    if (!k) faults.push("a tier band lists an empty vertical.");
    if (k === DROP_ANSWER) faults.push(`a tier band lists \`${DROP_ANSWER}\`, which is the drop sentinel.`);
    if (seen.has(k)) faults.push(`\`${k}\` appears in more than one tier band.`);
    seen.add(k);
  }
  return faults;
}

/**
 * Judge one chunk. Returns a verdict per input id, with `keep: null` for anything the model failed on.
 *
 * ‼️ IT RESOLVES RATHER THAN THROWS ON A MODEL FAILURE. A thrown chunk would abandon the nineteen
 * rows beside the one that confused it, and the caller cannot tell a model timeout from an empty
 * list. Unjudged comes back as unjudged and the caller re-runs it.
 */
export async function qualifyChunk(
  candidates: readonly QualifyCandidate[],
  icp: string,
  vertical: string
): Promise<Verdict[]> {
  const ids = candidates.map((c) => c.id);
  if (!ids.length) return [];

  // ‼️ THE VOCABULARY COMES FROM THE REGISTRY, NOT FROM THIS FILE. qualify.ts is deliberately
  // vertical-agnostic (its system prompt says "judge ONLY against the profile you are given"), which
  // is what lets one sweep serve a second vertical without a fork. A tier table compiled in here
  // would quietly make that false, the same way a med-spa paragraph in the judge would.
  const allowed = judgedVerticalsFor(vertical);
  const bands = tierPromptLines(vertical);
  if (!allowed.length) {
    // ‼️ REFUSED RATHER THAN RUN WITH AN EMPTY LIST. With no vocabulary every answer fails
    // validation, so the chunk would be re-asked twice and parked as unjudged at full model price,
    // and the card would read "the model did not return a verdict" about a configuration mistake.
    return ids.map((id) => ({
      id,
      keep: null,
      reason: "no tier vocabulary is registered for `" + vertical + "` in src/lib/scraper/verticals.ts",
      judgedVertical: null,
      tier: null,
      route: null,
    }));
  }

  const user = [
    "THE IDEAL CUSTOMER PROFILE:",
    icp.trim(),
    "",
    "THE VERTICALS YOU MAY ANSWER WITH, exactly as written, or the single word `drop`:",
    ...allowed.map((a) => "  " + a),
    "",
    // ‼️ THE BANDS ARE SHOWN, AND THE MODEL IS NOT ASKED FOR ONE. Showing them is what makes a
    // borderline business land in the right band: told that `nail bar` is the never-emailed tier, the
    // model stops putting a genuine aesthetics clinic there to be safe. Asking for the letter as well
    // would be a second answer free to contradict the first.
    "For context, how those verticals are banded. Do NOT return a tier, only a vertical:",
    ...bands.map((b) => "  " + b),
    "",
    `THE COMPANIES, ${candidates.length} of them:`,
    ...candidates.map(describe),
  ].join("\n");

  try {
    const res = await callClaudeJSON<{ verdicts: Array<Record<string, unknown>> }>({
      model: MODEL,
      system: SYSTEM,
      user,
      maxTokens: 4000,
      // Low: this is a judgement against a written rule, not a creative act.
      temperature: 0.2,
      schemaHint: SCHEMA_HINT,
      validate: (v): v is { verdicts: Array<Record<string, unknown>> } =>
        verdictFaults(v, ids, allowed).length === 0,
      describeInvalid: (v) => verdictFaults(v, ids, allowed).join(" "),
    });

    const byId = new Map(res.data.verdicts.map((r) => [String(r.id), r]));
    return ids.map((id) => {
      const r = byId.get(id);
      if (!r) {
        return {
          id,
          keep: null,
          reason: "the model did not return a verdict for this row",
          judgedVertical: null,
          tier: null,
          route: null,
        };
      }
      const answer = String(r.vertical ?? "").trim().toLowerCase();
      const dropped = answer === DROP_ANSWER;
      const tier = dropped ? null : tierOf(vertical, answer);
      return {
        id,
        // ‼️ keep IS DERIVED FROM THE ANSWER AND IS STILL WRITTEN, because every stage downstream
        // reads `qualify_keep`: pendingEnrich, qualifyTally, dropReasons and droppedRows all do.
        // Tier C is keep TRUE, because by the front-desk profile a nail bar genuinely is the buyer;
        // what it is not is worth an email, and that is what `route` says.
        keep: !dropped,
        reason: String(r.reason).trim(),
        judgedVertical: dropped ? null : answer,
        tier,
        route: routeForTier(tier, !dropped),
      };
    });
  } catch (e) {
    return ids.map((id) => ({
      id,
      keep: null,
      reason: `not judged: ${(e as Error).message}`,
      judgedVertical: null,
      tier: null,
      route: null,
    }));
  }
}

export interface DropGroup {
  reason: string;
  count: number;
  examples: string[];
}

/**
 * Drop reasons, grouped and counted, which is the human checkpoint before any money is spent.
 *
 * ‼️ GROUPED ON A NORMALISED REASON, NOT ON THE VERBATIM STRING. The model writes "chain, not owner
 * operated" and "a chain rather than owner operated" for the same judgement, and a group-by on the
 * raw text would report two groups of one instead of one group of two, which is exactly the signal
 * this exists to surface.
 */
 // ‼️ IT ASKS FOR THE THREE FIELDS IT READS, NOT FOR A WHOLE Verdict. Every caller builds this
// shape out of a database row rather than from a model answer (dropReasons returns name and reason,
// nothing else), so demanding a full Verdict would mean three call sites inventing null tiers and
// null routes to satisfy a type, and one of them would eventually invent a non-null one.
export function groupDrops(
  verdicts: ReadonlyArray<{ keep: boolean | null; reason: string; businessName?: string }>
): DropGroup[] {
  const groups = new Map<string, DropGroup>();

  for (const v of verdicts) {
    if (v.keep !== false) continue;
    const key = normalizeReason(v.reason);
    const g = groups.get(key) ?? { reason: v.reason, count: 0, examples: [] };
    g.count += 1;
    if (g.examples.length < 3 && v.businessName) g.examples.push(v.businessName);
    groups.set(key, g);
  }

  return [...groups.values()].sort((a, b) => b.count - a.count);
}

const REASON_STOPWORDS = new Set(["a", "an", "the", "is", "are", "not", "no", "rather", "than", "and", "or", "of", "it"]);

export function normalizeReason(reason: string): string {
  return reason
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !REASON_STOPWORDS.has(w))
    .sort()
    .join(" ");
}

/**
 * How the run's judged rows break down by tier and by route.
 *
 * ‼️ `untiered` IS A FIRST-CLASS FIELD AND NOT A ROUNDING ERROR. All 256 kept rows on the Dallas
 * run were judged under the boolean prompt, before tiers existed, and no honest backfill can give
 * them one. Folding them into Tier A would overstate supply on the only data there is, and dropping
 * them from the card would make the counts not add up with nothing to say why.
 */
export interface TierTally {
  a: number;
  b: number;
  c: number;
  untiered: number;
  /** route = 'email'. The number that actually becomes a campaign. */
  emailable: number;
  /** route = 'call'. No website, aggregator only, or Tier C. Stored, never emailed. */
  callable: number;
}

/** The card a person reads before releasing the spend. */
export function dropReviewLines(args: {
  raw: number;
  kept: number;
  unjudged: number;
  groups: DropGroup[];
  /** Absent on a run judged before tiering existed, and the card then says nothing about tiers. */
  tiers?: TierTally;
}): string[] {
  const dropped = args.raw - args.kept - args.unjudged;
  const lines = [
    `*Qualified against the ICP:* ${args.kept} kept of ${args.raw}, ${dropped} dropped.`,
    args.unjudged ? `:warning: ${args.unjudged} were not judged and will be re-run. They are not drops.` : "",
  ].filter(Boolean);

  // ‼️ THE TIERS COME BEFORE THE DROPS ON THE CARD, because the question this gate is really
  // asking has changed. It used to be "is the ICP wrong", answered by the drop reasons. With a
  // widened profile that keeps half the pull, the question is "is what we are about to email worth
  // emailing", and that is answered by how much of the keep is Tier A.
  const t = args.tiers;
  if (t) {
    lines.push("");
    lines.push("*What the keep is made of*");
    lines.push(`  Tier A  ${t.a}`);
    lines.push(`  Tier B  ${t.b}`);
    lines.push(`  Tier C  ${t.c}   _stored and called, never emailed_`);
    if (t.untiered) {
      lines.push(`  untiered  ${t.untiered}   _judged before tiering existed, treated as emailable_`);
    }
    lines.push("");
    lines.push(
      `  :email: *${t.emailable}* go to enrichment.  :telephone_receiver: *${t.callable}* go to the call list ` +
        "instead of the bin: `bun run scripts/export-cold-call-leads.ts`."
    );

    // ‼️ THE FLAG FIRES ON TIER A BEING THIN, WHICH IS THE EXPENSIVE SHAPE AND THE EASY ONE TO
    // MISS. A pull that is mostly Tier B reads fine on every other number on this card: the keep
    // rate is healthy, the drop reasons are varied, and the list that goes out is salons. The
    // threshold is a third rather than a half because the measured mix is not known yet; Tier A rate
    // is the first thing week 1 of the operating procedure exists to measure.
    const judged = t.a + t.b + t.c;
    if (judged >= 20 && t.a * 3 < judged) {
      lines.push("");
      lines.push(
        `  :mag: *Only ${t.a} of ${judged} judged rows are Tier A.* The categories or the metro are ` +
          "finding adjacent businesses rather than the buyer. Worth a look before the crawl, because " +
          "a Tier B list sends fine and converts like a Tier B list."
      );
    }
  }

  lines.push("");
  lines.push("*Why they were dropped, most common first:*");

  for (const g of args.groups.slice(0, 12)) {
    lines.push(`  • ${g.count} x ${g.reason}${g.examples.length ? `  _${g.examples.join(", ")}_` : ""}`);
  }

  // ‼️ THE WHOLE REASON THIS CARD EXISTS, SAID ON THE CARD. Somebody scanning it needs to be told
  // what they are looking for, or they tick it because the numbers look plausible.
  const top = args.groups[0];
  if (top && dropped > 0 && top.count / dropped > 0.5) {
    lines.push("");
    lines.push(
      `:mag: *${Math.round((top.count / dropped) * 100)}% of the drops are one reason.* That usually means the ICP or the ` +
        "search is wrong rather than the list. Worth a look before the enrichment spend."
    );
  }

  lines.push("");
  // ‼️ THE WORD "SPEND" LEFT THIS LINE WHEN THE FIRST RUNG TURNED OUT TO BE FREE, BUT THE GATE DID
  // NOT. What it holds back changed rather than disappearing, and in this order:
  //   1. The ICP being wrong. It costs nothing here and costs the WHOLE list downstream, and the
  //      :mag: flag above is the only place that signal is ever read. Removing the gate because the
  //      next stage got cheaper would delete the one checkpoint that catches it.
  //   2. MillionVerifier credits. The spend moved one stage later, it did not vanish: every address
  //      the crawl finds is an address MV is billed for.
  //   3. Our crawl footprint. Free to us is not free to them. `fetchPage` models "blocked" as a
  //      first-class outcome because small-business hosts push back, and releasing a thousand-site
  //      crawl against a mis-qualified list is the reputational cost that replaced the dollar one.
  //
  // ‼️ KEEP THE LITERAL PREFIX "React :white_check_mark: to release" — _probe-list-prep.ts greps
  // this file and this output for it.
  lines.push(
    "React :white_check_mark: to release the kept rows into enrichment. The crawl is free; what " +
      "this holds back is a wrong ICP, the MillionVerifier credits after it, and a thousand " +
      "fetches against real clinics' websites."
  );
  return lines;
}

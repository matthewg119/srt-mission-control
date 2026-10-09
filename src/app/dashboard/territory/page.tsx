// The territory system. A map, a table, and the thing that makes it a territory system: a plan.
//
// ‼️ IT IS NOT A DASHBOARD AND THE DIFFERENCE IS THE PLAN SECTION. A dashboard reports what has
// happened. The question the operator has every morning is "which metro next, and is the one I am in
// finished", and until this page existed the only way to answer it was reading run labels in Slack.
//
// ‼️ IT INTRODUCES NO SOURCE OF TRUTH. Every number is derived at request time from raw_leads,
// sendable_leads, outreach_prospects, list_pipeline_runs and scraper_cells, through the functions in
// docs/2026-10-08-territory-rollups.sql. See src/lib/scraper/territory.ts.
//
// ‼️ AND THE PLAN'S JOB IS TO STOP A METRO BEING BOUGHT TWICE, NOT TO FIND DUPLICATES AFTERWARDS.
// That is already handled: place_id is uniquely indexed per run, raw_leads_place_created indexes it
// across runs, and dropCrossRunDuplicates cut 35 of the Dallas 500 before the model was paid to
// judge them. A "do not pull" marker before the spend is the half that was missing.

import Link from "next/link";
import { TerritoryMap } from "@/components/scraper/territory-map";
import { formatRelativeTime } from "@/lib/utils";
import { verticalSlugs } from "@/lib/scraper/verticals";
import {
  DOT_GRID,
  DOT_LIMIT,
  SENDING,
  cellsMeasured,
  contactsPerDay,
  metroPlan,
  metroRows,
  pullCommands,
  rawPerDay,
  sendsPerDay,
  stateRows,
  territoryDots,
  territoryVertical,
} from "@/lib/scraper/territory";

export const metadata = { title: "Territory | SRT Mission Control" };
export const dynamic = "force-dynamic";

interface SearchParams {
  vertical?: string;
  /** "metro" switches the dot grid off, for working inside one city. */
  zoom?: string;
}

function Num({ n, dim }: { n: number | null; dim?: boolean }) {
  if (n === null) return <span className="text-gray-300">not measured</span>;
  return <span className={dim && n === 0 ? "text-gray-300" : ""}>{n.toLocaleString()}</span>;
}

export default async function TerritoryPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;

  // ‼️ THE VERTICAL IS VALIDATED AGAINST THE REGISTRY RATHER THAN DEFAULTED SILENTLY. A `?? "medspa"`
  // on an unknown value is the bug family that has bitten this codebase four separate times: it
  // makes a wrong vertical look like a working one. An unknown slug here would render a plausible
  // empty map, and "empty" is exactly the signal this page exists to produce.
  const known = verticalSlugs();
  const asked = (sp.vertical ?? "").trim().toLowerCase();
  const vertical = known.includes(asked) ? asked : known.includes("medspa") ? "medspa" : known[0];
  const unknownVertical = asked.length > 0 && !known.includes(asked);

  const grid = sp.zoom === "metro" ? DOT_GRID.metro : DOT_GRID.national;

  const [dots, metros, states, cells] = await Promise.all([
    territoryDots(vertical, grid),
    metroRows(vertical),
    stateRows(vertical),
    cellsMeasured(vertical),
  ]);

  const def = territoryVertical(vertical);
  const plan = metroPlan(metros);

  const statePulled: Record<string, number> = {};
  for (const s of states.rows) statePulled[s.name] = s.pulled;

  const totals = metros.reduce(
    (acc, m) => ({
      pulled: acc.pulled + m.pulled,
      qualified: acc.qualified + m.qualified,
      tierA: acc.tierA + m.tierA,
      callable: acc.callable + m.callable,
      sendable: acc.sendable + m.sendable,
      emailed: acc.emailed + m.emailed,
    }),
    { pulled: 0, qualified: 0, tierA: 0, callable: 0, sendable: 0, emailed: 0 }
  );

  const raw = rawPerDay();
  const worked = plan.filter((p) => p.worked);
  const next = plan.filter((p) => !p.worked).slice(0, 5);
  // ‼️ SUPPLY IS SUMMED ONLY OVER METROS THAT HAVE BEEN MEASURED. A metro nobody has counted
  // contributes null, not zero, so the total says "the measured metros hold N days" rather than
  // implying the other fifteen hold nothing.
  const measuredDays = worked
    .filter((p) => p.daysOfSupply !== null)
    .reduce((acc, p) => acc + (p.daysOfSupply ?? 0), 0);
  const unmeasuredWorked = worked.filter((p) => p.daysOfSupply === null).length;

  // Cell pulls: rows whose source_metro is a coordinate triple and therefore belongs to the cell
  // system's geography rather than to a named metro. Counted so they are never silently missing.
  const cellPullRows = metros.filter((m) => m.metro && /^-?\d+(\.\d+)?,/.test(m.metro));

  return (
    <div className="space-y-8 p-6">
      <header>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Territory</h1>
            <p className="mt-1 text-sm text-gray-500">
              Where the lead engine has been, and where to send it next. Read this before every pull.
            </p>
          </div>
          <nav className="flex items-center gap-2 text-sm">
            {known.map((v) => (
              <Link
                key={v}
                href={`/dashboard/territory?vertical=${v}${sp.zoom ? `&zoom=${sp.zoom}` : ""}`}
                className={
                  v === vertical
                    ? "rounded bg-gray-900 px-3 py-1 text-white"
                    : "rounded border border-gray-300 px-3 py-1 text-gray-700 hover:bg-gray-50"
                }
              >
                {territoryVertical(v)?.label ?? v}
              </Link>
            ))}
          </nav>
        </div>
        {unknownVertical && (
          <p className="mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            There is no vertical called <code>{asked}</code>, so this is showing{" "}
            <strong>{def?.label ?? vertical}</strong> instead. Known verticals:{" "}
            {known.map((v) => `\`${v}\``).join(", ")}. Add one in{" "}
            <code>src/lib/scraper/verticals.ts</code>.
          </p>
        )}
      </header>

      {/* ── the funnel, as counts ───────────────────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { label: "pulled", n: totals.pulled, note: "raw records bought" },
          { label: "qualified", n: totals.qualified, note: "routed to enrichment" },
          { label: "Tier A", n: totals.tierA, note: "the buyer, as judged" },
          { label: "call list", n: totals.callable, note: "no address, real business" },
          { label: "address found", n: totals.sendable, note: "verified and shippable" },
          { label: "handed off", n: totals.emailed, note: "committed to a campaign" },
        ].map((s) => (
          <div key={s.label} className="rounded-lg border border-gray-200 bg-white p-3">
            <div className="text-xs uppercase tracking-wide text-gray-500">{s.label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">
              {s.n.toLocaleString()}
            </div>
            <div className="mt-0.5 text-xs text-gray-400">{s.note}</div>
          </div>
        ))}
      </section>

      {/* ‼️ THE TIER A ZERO IS EXPLAINED ON THE PAGE RATHER THAN LEFT TO LOOK BROKEN. Every stored
          row was judged under a boolean prompt before tiers existed, and no honest backfill can
          invent a tier. The next pull fills this in. */}
      {totals.tierA === 0 && totals.qualified > 0 && (
        <p className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
          <strong>Tier A is zero because tiering is newer than this data.</strong> All{" "}
          {totals.qualified.toLocaleString()} qualified rows were judged under the old keep-or-drop
          prompt, and a tier cannot be backfilled from a boolean without inventing it. The next pull
          returns tiers, and <code>untiered</code> in the table below is where these rows sit
          meanwhile. They are still treated as emailable.
        </p>
      )}

      {/* ── the map ─────────────────────────────────────────────────────────────────────────── */}
      <section>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-medium text-gray-900">The map</h2>
          <div className="flex items-center gap-2 text-sm">
            <Link
              href={`/dashboard/territory?vertical=${vertical}`}
              className={
                grid === DOT_GRID.national
                  ? "rounded bg-gray-900 px-2.5 py-1 text-white"
                  : "rounded border border-gray-300 px-2.5 py-1 text-gray-700 hover:bg-gray-50"
              }
            >
              clustered
            </Link>
            <Link
              href={`/dashboard/territory?vertical=${vertical}&zoom=metro`}
              className={
                grid === DOT_GRID.metro
                  ? "rounded bg-gray-900 px-2.5 py-1 text-white"
                  : "rounded border border-gray-300 px-2.5 py-1 text-gray-700 hover:bg-gray-50"
              }
            >
              every business
            </Link>
          </div>
        </div>
        <TerritoryMap dots={dots} statePulled={statePulled} capped={dots.length >= DOT_LIMIT} />
        {states.unplaced > 0 && (
          <p className="mt-2 text-xs text-gray-500">
            {states.unplaced.toLocaleString()} leads have no state on file, so they are on the map by
            coordinate but not in the state layer. <code>raw_leads.state</code> comes from the
            vendor&apos;s address region and is sometimes absent.
          </p>
        )}
      </section>

      {/* ── the table ───────────────────────────────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-lg font-medium text-gray-900">Per metro</h2>
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full min-w-[920px] text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium">metro</th>
                <th className="px-3 py-2 text-right font-medium">pulled</th>
                <th className="px-3 py-2 text-right font-medium">qualified</th>
                <th className="px-3 py-2 text-right font-medium">A</th>
                <th className="px-3 py-2 text-right font-medium">B</th>
                <th className="px-3 py-2 text-right font-medium">C</th>
                <th className="px-3 py-2 text-right font-medium">untiered</th>
                <th className="px-3 py-2 text-right font-medium">call</th>
                <th className="px-3 py-2 text-right font-medium">sendable</th>
                <th className="px-3 py-2 text-right font-medium">handed off</th>
                <th className="px-3 py-2 text-right font-medium">remaining</th>
                <th className="px-3 py-2 text-left font-medium">last pulled</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 tabular-nums">
              {metros.length === 0 && (
                <tr>
                  <td colSpan={12} className="px-3 py-6 text-center text-gray-500">
                    Nothing has been pulled for {def?.label ?? vertical} yet. The plan below says
                    where to start.
                  </td>
                </tr>
              )}
              {metros.map((m) => (
                <tr key={`${m.verticalSlug}-${m.metro}`} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium text-gray-900">{m.metro ?? "(no metro)"}</td>
                  <td className="px-3 py-2 text-right">{m.pulled.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right">{m.qualified.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right">
                    <Num n={m.tierA} dim />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Num n={m.tierB} dim />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Num n={m.tierC} dim />
                  </td>
                  <td className="px-3 py-2 text-right text-gray-500">{m.untiered.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right text-amber-700">{m.callable.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right">{m.sendable.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right">{m.emailed.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right">
                    <Num n={m.remaining} />
                  </td>
                  <td className="px-3 py-2 text-gray-500">
                    {m.lastPulledAt ? formatRelativeTime(m.lastPulledAt) : "never"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {cellPullRows.length > 0 && (
          <p className="mt-2 text-xs text-gray-500">
            {cellPullRows.length} of these rows are cell pulls, whose metro is a coordinate triple
            rather than a city. They are counted in the totals and are not matched to a named metro
            in the plan below, because guessing which city a 40km circle belongs to is how a pull
            lands in the wrong column.
          </p>
        )}
      </section>

      {/* ── the plan ────────────────────────────────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-1 text-lg font-medium text-gray-900">The plan</h2>
        <p className="mb-4 text-sm text-gray-500">
          Pick the next metro from here, never from memory. The order is{" "}
          <code>METROS</code> in <code>src/lib/trt.ts</code>: Sun Belt first.
        </p>

        <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-gray-200 bg-white p-3">
            <div className="text-xs uppercase tracking-wide text-gray-500">sends a day</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{sendsPerDay().toLocaleString()}</div>
            <div className="mt-0.5 text-xs text-gray-400">
              {SENDING.mailboxes} mailboxes x {SENDING.perMailboxPerDay}
            </div>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-3">
            <div className="text-xs uppercase tracking-wide text-gray-500">new contacts a day</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{contactsPerDay().toLocaleString()}</div>
            <div className="mt-0.5 text-xs text-gray-400">on a {SENDING.sequenceDays} day sequence</div>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-3">
            <div className="text-xs uppercase tracking-wide text-gray-500">raw records a day</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">
              {raw.low.toLocaleString()} to {raw.high.toLocaleString()}
            </div>
            <div className="mt-0.5 text-xs text-gray-400">
              at the measured {Math.round(SENDING.rawToSendableLow * 100)} to{" "}
              {Math.round(SENDING.rawToSendableHigh * 100)}% raw to sendable
            </div>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-3">
            <div className="text-xs uppercase tracking-wide text-gray-500">days of supply</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">
              {measuredDays ? measuredDays.toFixed(1) : "0"}
            </div>
            <div className="mt-0.5 text-xs text-gray-400">
              in the measured worked metros
              {unmeasuredWorked > 0 ? `, ${unmeasuredWorked} unmeasured` : ""}
            </div>
          </div>
        </div>

        {/* ‼️ THE BUDGET WARNING IS ON THE PLAN, NOT IN A RUNBOOK. MillionVerifier is the real
            constraint and it is the one nobody notices until a run stops mid-upload: DataForSEO at
            4,000 records a day is about $1.53. */}
        <p className="mb-5 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <strong>MillionVerifier is the budget, not DataForSEO.</strong>{" "}
          {SENDING.verifierCreditsLeft.toLocaleString()} bulk credits at roughly 500 addresses a day
          is about {Math.round(SENDING.verifierCreditsLeft / 500)} days. Records cost about $
          {(
            (raw.high / 1000) * SENDING.dfsPerThousand +
            Math.ceil(raw.high / 1000) * SENDING.dfsPerTask
          ).toFixed(2)}{" "}
          a day at {raw.high.toLocaleString()} records. Buy credits before scaling, not during.
        </p>

        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium">#</th>
                <th className="px-3 py-2 text-left font-medium">metro</th>
                <th className="px-3 py-2 text-right font-medium">pulled</th>
                <th className="px-3 py-2 text-right font-medium">sendable</th>
                <th className="px-3 py-2 text-right font-medium">remaining</th>
                <th className="px-3 py-2 text-right font-medium">days left</th>
                <th className="px-3 py-2 text-left font-medium">next step</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 tabular-nums">
              {plan.map((p) => {
                const finished = p.worked && p.remaining === 0;
                return (
                  <tr key={p.key} className={p.worked ? "bg-gray-50/60" : "hover:bg-gray-50"}>
                    <td className="px-3 py-2 text-gray-400">{p.priority}</td>
                    <td className="px-3 py-2 font-medium text-gray-900">{p.label}</td>
                    <td className="px-3 py-2 text-right">{p.pulled.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">{p.sendable.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">
                      <Num n={p.remaining} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      {p.daysOfSupply === null ? (
                        <span className="text-gray-300">unknown</span>
                      ) : (
                        p.daysOfSupply.toFixed(1)
                      )}
                    </td>
                    <td className="px-3 py-2 text-left">
                      {finished ? (
                        <span className="rounded bg-gray-200 px-2 py-0.5 text-xs text-gray-700">
                          finished, do not pull
                        </span>
                      ) : p.worked ? (
                        <span className="rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-800">
                          in progress, continue from offset {p.pulled.toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-500">unworked</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ‼️ THE COMMANDS ARE GENERATED, WHICH IS THE OTHER HALF OF "READ THE MAP BEFORE EVERY
            PULL". A plan that says "go to Houston" and leaves the grammar to memory is a plan that
            gets a limit wrong, and `limit 3000` against a metro holding 1,765 is exactly how batch
            7a472c40 died on an HTTP 500 with nothing bought. */}
        {next.length > 0 && def && (
          <div className="mt-5 rounded-lg border border-gray-200 bg-white p-4">
            <h3 className="text-sm font-medium text-gray-900">
              Next up: {next[0].label}, in 300 row chunks
            </h3>
            <p className="mt-1 text-xs text-gray-500">
              Paste these into #srt-scraper one at a time. A pull is serialised on purpose: two in
              flight means two crawls competing for one cron tick.
            </p>
            <pre className="mt-3 overflow-x-auto rounded bg-gray-900 p-3 text-xs leading-relaxed text-gray-100">
              {pullCommands(def, next[0].label, 0).join("\n")}
            </pre>
            <p className="mt-2 text-xs text-gray-500">
              Then: {next.slice(1).map((p) => p.label).join(", ")}.
            </p>
          </div>
        )}

        {/* The in-progress metros get their own continue-from-here block, because the offset is the
            thing that is easy to get wrong and expensive to get wrong. */}
        {worked.filter((p) => p.remaining !== 0).length > 0 && def && (
          <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50/50 p-4">
            <h3 className="text-sm font-medium text-gray-900">Finish what is started first</h3>
            {worked
              .filter((p) => p.remaining !== 0)
              .map((p) => (
                <div key={p.key} className="mt-3">
                  <div className="text-xs text-gray-600">
                    {p.label}: {p.pulled.toLocaleString()} pulled
                    {p.remaining !== null ? `, about ${p.remaining.toLocaleString()} left` : ", circle not measured"}
                  </div>
                  <pre className="mt-1 overflow-x-auto rounded bg-gray-900 p-3 text-xs leading-relaxed text-gray-100">
                    {pullCommands(def, p.label, p.pulled).join("\n")}
                  </pre>
                </div>
              ))}
          </div>
        )}
      </section>

      {/* ── the national cell crawl ─────────────────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-2 text-lg font-medium text-gray-900">National coverage</h2>
        {cells === 0 ? (
          <p className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
            <strong>No circles have been measured.</strong> The national cell crawl models US
            coverage properly as a quadtree and has never been run, so <code>scraper_cells</code> is
            empty and the plan above is limited to the {plan.length} metros in{" "}
            <code>src/lib/trt.ts</code>. Run <code>coverage {vertical}</code> in #srt-scraper to
            measure it. Each circle costs $0.0124 to count and the answer is bought by a check mark
            on a card, like any other spend.
          </p>
        ) : (
          <p className="text-sm text-gray-600">
            {cells.toLocaleString()} circles measured for {def?.label ?? vertical}. The cell system
            owns national coverage; the metro plan above is the near-term queue inside it.
          </p>
        )}
      </section>

      <footer className="border-t border-gray-200 pt-4 text-xs text-gray-400">
        Every number here is read live from <code>raw_leads</code>, <code>sendable_leads</code>,{" "}
        <code>outreach_prospects</code>, <code>list_pipeline_runs</code> and{" "}
        <code>scraper_cells</code>. There is no territory table and nothing is cached.
        {def && (
          <>
            {" "}
            {def.label} searches: {def.searchQueries.join(", ")}. ReachInbox campaign:{" "}
            <code>{def.campaign}</code>.
          </>
        )}
      </footer>
    </div>
  );
}

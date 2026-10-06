// Three ways the client view could look, to be chosen between rather than described.
//
// Matthew, 2026-10-06: "since we have the chat agent i'm sure we are no longer going to use this
// clients tab only the chatbot so this lets make it something more simple and minimalistic to see
// customer relationship and deal status, please create a few variations."
//
// ‼️ MOCK DATA, AND IT SAYS SO ON THE PAGE. Nothing here reads the database. This is a decision
// about SHAPE, and wiring three layouts to real queries before one of them is picked is two
// layouts of wasted plumbing. The row shape below is deliberately the one the real tables already
// hold, so whichever wins is a query away rather than a rewrite.
//
// ‼️ AND IT REPLACES NOTHING YET. /dashboard/clients is untouched and still the live page. This
// route is a preview, noindex, and carries no actions: no buttons that write, no links that tick
// a step. A design preview that can change a client's state is not a preview.
//
// The three, and what each is FOR, because they are not the same answer in different paint:
//
//   1 BOARD    stage columns, one card per client. Answers "where is everybody" in one glance,
//              and makes a stuck client visible by the size of the column it is sitting in.
//   2 LIST     one line each, sorted by what is owed. Answers "what do I do next" and holds
//              forty clients on a laptop screen, which neither of the others does.
//   3 FOCUS    a few large cards, one per client, relationship first. Answers "how is this
//              client actually doing" and is the only one with room to say why.

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Client view, three ways",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/** The shape the real tables already hold, so a pick is a query away and not a rewrite. */
interface Row {
  name: string;
  stage: string;
  /** What is owed next, in the words somebody would say out loud. */
  next: string;
  /** Days since anybody spoke to them. The relationship number. */
  quiet: number;
  mrr: number;
  /** Where the delivery board has got to, out of 41. */
  step: number;
  health: "good" | "watch" | "risk";
}

const ROWS: Row[] = [
  { name: "Northlight Skin Studio", stage: "Delivering", next: "Pages 3 to 6 need approving", quiet: 2, mrr: 499, step: 24, health: "good" },
  { name: "Med Spa 123", stage: "Onboarding", next: "Setup call booked for Thursday", quiet: 0, mrr: 499, step: 6, health: "good" },
  { name: "Dermacare Collective", stage: "Delivering", next: "Waiting on their Google access", quiet: 9, mrr: 499, step: 17, health: "watch" },
  { name: "Lumen Aesthetics", stage: "At risk", next: "No reply to three emails", quiet: 23, mrr: 499, step: 11, health: "risk" },
  { name: "Harbour Health", stage: "Live", next: "Day 60 re-measure due", quiet: 5, mrr: 499, step: 41, health: "good" },
  { name: "Clear Skin Co", stage: "Onboarding", next: "Cards printed, not posted", quiet: 4, mrr: 0, step: 3, health: "watch" },
];

const STAGES = ["Onboarding", "Delivering", "Live", "At risk"] as const;

const DOT: Record<Row["health"], string> = {
  good: "bg-emerald-400",
  watch: "bg-amber-400",
  risk: "bg-rose-400",
};

const VARIANTS = [
  { key: "1", label: "Board" },
  { key: "2", label: "List" },
  { key: "3", label: "Focus" },
] as const;

function money(n: number): string {
  return n === 0 ? "not billing" : `$${n}/mo`;
}

/** The relationship, said as a person would say it rather than as a number. */
function quietLine(days: number): string {
  if (days === 0) return "spoke today";
  if (days === 1) return "spoke yesterday";
  return `${days} days quiet`;
}

export default function CrmDemo({ searchParams }: { searchParams: { v?: string } }) {
  const v = VARIANTS.some((x) => x.key === searchParams.v) ? searchParams.v : "1";

  return (
    <main className="min-h-screen bg-[#0b0b0c] p-6 text-[#f4f4f5]">
      <header className="mx-auto mb-6 max-w-5xl">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          Design preview
        </p>
        <h1 className="mt-1 text-2xl font-bold">Client view, three ways</h1>
        <p className="mt-1 text-sm text-white/50">
          Mock data. Nothing here reads or writes anything, and the live clients page is untouched.
        </p>
        <nav className="mt-4 flex gap-2">
          {VARIANTS.map((x) => (
            <a
              key={x.key}
              href={`/demo/crm?v=${x.key}`}
              className={`rounded-full px-3 py-1 text-sm ${
                v === x.key
                  ? "bg-emerald-400 font-semibold text-[#07211c]"
                  : "border border-white/15 text-white/70"
              }`}
            >
              {x.label}
            </a>
          ))}
        </nav>
      </header>

      <div className="mx-auto max-w-5xl">
        {v === "1" && <Board />}
        {v === "2" && <List />}
        {v === "3" && <Focus />}
      </div>
    </main>
  );
}

/** 1. Where is everybody. A column that grows is a problem you can see without reading. */
function Board() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {STAGES.map((stage) => {
        const inStage = ROWS.filter((r) => r.stage === stage);
        return (
          <section key={stage} className="rounded-lg border border-white/10 bg-[#141416] p-3">
            <h2 className="mb-3 flex items-center justify-between text-sm font-semibold">
              <span>{stage}</span>
              <span className="text-white/40">{inStage.length}</span>
            </h2>
            <div className="flex flex-col gap-2">
              {inStage.map((r) => (
                <article key={r.name} className="rounded border border-white/10 bg-black/20 p-3">
                  <div className="flex items-start gap-2">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[r.health]}`} />
                    <p className="text-sm font-semibold leading-snug">{r.name}</p>
                  </div>
                  <p className="mt-2 text-xs leading-snug text-white/60">{r.next}</p>
                  <p className="mt-2 text-xs text-white/35">
                    {quietLine(r.quiet)} · {money(r.mrr)}
                  </p>
                </article>
              ))}
              {inStage.length === 0 && <p className="text-xs text-white/25">Nobody</p>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** 2. What do I do next. Sorted by how long they have been ignored, worst first. */
function List() {
  const sorted = [...ROWS].sort((a, b) => b.quiet - a.quiet);
  return (
    <div className="overflow-hidden rounded-lg border border-white/10 bg-[#141416]">
      {sorted.map((r, i) => (
        <article
          key={r.name}
          className={`flex items-center gap-4 px-4 py-3 ${i > 0 ? "border-t border-white/10" : ""}`}
        >
          <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[r.health]}`} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{r.name}</p>
            <p className="truncate text-xs text-white/55">{r.next}</p>
          </div>
          <span className="hidden w-24 shrink-0 text-right text-xs text-white/40 sm:block">
            {r.stage}
          </span>
          <span className="w-24 shrink-0 text-right text-xs text-white/40">
            {quietLine(r.quiet)}
          </span>
          <span className="hidden w-20 shrink-0 text-right text-xs text-white/40 sm:block">
            {money(r.mrr)}
          </span>
        </article>
      ))}
    </div>
  );
}

/** 3. How is this one actually doing. The only one with room to say why. */
function Focus() {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {ROWS.map((r) => (
        <article key={r.name} className="rounded-lg border border-white/10 bg-[#141416] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-bold">{r.name}</h2>
              <p className="mt-0.5 text-xs text-white/40">
                {r.stage} · {money(r.mrr)}
              </p>
            </div>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                r.health === "good"
                  ? "bg-emerald-400/15 text-emerald-300"
                  : r.health === "watch"
                    ? "bg-amber-400/15 text-amber-300"
                    : "bg-rose-400/15 text-rose-300"
              }`}
            >
              {r.health === "good" ? "On track" : r.health === "watch" ? "Watch" : "At risk"}
            </span>
          </div>

          <p className="mt-3 text-sm text-white/80">{r.next}</p>

          {/* The delivery board as one bar. 41 steps is a number nobody holds in their head. */}
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-white/40">
              <span>Step {r.step} of 41</span>
              <span>{quietLine(r.quiet)}</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-emerald-400"
                style={{ width: `${Math.round((r.step / 41) * 100)}%` }}
              />
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

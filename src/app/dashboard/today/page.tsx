import Link from "next/link";
import { buildDayPlan } from "@/lib/today/plan";
import { TodayPlan } from "@/components/today-plan";

export const metadata = { title: "Today | SRT Mission Control" };
export const dynamic = "force-dynamic";

// The day, in one place: what is waiting on a person across every live client, grouped by the hat
// it is under and ordered by what it unblocks.
//
// ‼️ RENDERED SERVER SIDE, NEVER THROUGH THE CHAT. /api/chat is capped at 60 seconds, and a plan you
// have to ask for is both slower and a second answer to a question the page already answers. The
// chat CHANGES this list; it does not produce it.
//
// ‼️ IT IS NOT A SECOND BOARD. Every delivery row links to the Slack card that owns it. Nothing here
// ticks a step, publishes a page or sends a message.

function hours(n: number): string {
  if (n < 60) return `${n} minutes`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m ? `${h}h ${m}m` : `${h} hours`;
}

export default async function TodayPage() {
  const plan = await buildDayPlan();
  const count = plan.groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-medium text-white">Today</h1>
          <p className="mt-1 text-xs text-[rgba(255,255,255,0.4)]">
            {count === 0
              ? "Nothing is waiting on you."
              : `${count} thing${count === 1 ? "" : "s"} waiting on you, about ${hours(plan.estMinutes)} estimated. Biggest first means what unblocks the most, not what takes longest.`}
          </p>
        </div>
        <Link
          href="/dashboard/assistant"
          className="rounded-lg border border-[rgba(255,255,255,0.12)] px-3 py-1.5 text-xs text-[rgba(255,255,255,0.6)] hover:text-white"
        >
          Work through it with Vektor
        </Link>
      </div>

      <TodayPlan plan={plan} />
    </div>
  );
}

import { auth } from "@/lib/auth";
import { buildDayPlan } from "@/lib/today/plan";
import { TodayPlan } from "@/components/today-plan";
import { ChatInterface } from "@/components/chat-interface";

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
  const [plan, session] = await Promise.all([buildDayPlan(), auth().catch(() => null)]);
  const count = plan.groups.reduce((n, g) => n + g.items.length, 0);
  const name = (session?.user?.name as string) || "there";

  return (
    <div className="mx-auto max-w-[1400px]">
      <div className="mb-6">
        <h1 className="text-xl font-medium text-white">Today</h1>
        <p className="mt-1 text-xs text-[rgba(255,255,255,0.4)]">
          {count === 0
            ? "Nothing is waiting on you."
            : `${count} thing${count === 1 ? "" : "s"} waiting on you, about ${hours(plan.estMinutes)} estimated. Biggest first means what unblocks the most, not what takes longest.`}
        </p>
      </div>

      {/*
        The plan on the left, the chat on the right, one brain.

        ‼️ THE PLAN IS RENDERED, NOT ASKED FOR. /api/today/chat is capped at 60 seconds and a day you
        have to request is both slower and a second answer to a question this page already answers.
        The chat CHANGES the list; it never produces it.
      */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)]">
        <TodayPlan plan={plan} />
        <div className="h-[calc(100vh-13rem)] min-h-[520px] overflow-hidden rounded-xl border border-[rgba(255,255,255,0.07)]">
          <ChatInterface userName={name} apiEndpoint="/api/today/chat" />
        </div>
      </div>
    </div>
  );
}

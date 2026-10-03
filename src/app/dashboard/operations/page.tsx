import Link from "next/link";
import { FileText, Mail, Users, Zap, MessageSquare, ArrowRight } from "lucide-react";

export const metadata = { title: "Operations | SRT Mission Control" };

// The one door the five operations pages are now behind.
//
// ‼️ IT IS AN INDEX, NOT A MERGE. Nothing moved. Templates, Sequences, Email Director, Automations
// and Campaigns are all still at their own URLs, still their own pages, and every link already
// pasted into a thread still works. Matthew asked for five sidebar lines to become one; this is
// the one.
//
// ‼️ AND NOT FIVE TABS, FOR A DULL REASON. The five routes do not share a path segment, so a
// shared Next layout would have meant moving four folders under a route group. That renames every
// URL or needs a redirect for each, which is a lot of breakage to buy a tab strip.

const TOOLS = [
  {
    href: "/dashboard/templates",
    icon: FileText,
    name: "Templates",
    blurb: "The email and SMS bodies every other surface sends. Edit the words once.",
  },
  {
    href: "/dashboard/sequences",
    icon: Mail,
    name: "Sequences",
    blurb: "Multi step outreach: what goes out, how long after the last one, and to whom.",
  },
  {
    href: "/dashboard/email-sequences",
    icon: Users,
    name: "Email Director",
    blurb: "The cold email programme. Mailboxes, daily volume and what came back.",
  },
  {
    href: "/dashboard/automations",
    icon: Zap,
    name: "Automations",
    blurb: "What fires when a lead enters a stage, and what chases one that goes quiet.",
  },
  {
    href: "/dashboard/campaigns",
    icon: MessageSquare,
    name: "Campaigns",
    blurb: "One off sends to a list, and how each one performed.",
  },
] as const;

export default function OperationsPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-6">
      <h1 className="text-xl font-semibold text-white">Operations</h1>
      <p className="mt-1 text-xs text-[rgba(255,255,255,0.45)]">
        Everything that sends something. Five tools, unchanged, behind one door.
      </p>

      <div className="mt-6 space-y-2">
        {TOOLS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="group flex items-start gap-3 rounded-xl border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.02)] p-4 transition-colors hover:border-[rgba(0,201,167,0.45)] hover:bg-[rgba(0,201,167,0.04)]"
          >
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[rgba(0,201,167,0.12)] text-[#00C9A7]">
              <t.icon size={16} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-white">{t.name}</span>
              <span className="mt-0.5 block text-xs text-[rgba(255,255,255,0.45)]">{t.blurb}</span>
            </span>
            <ArrowRight
              size={15}
              className="mt-1 shrink-0 text-[rgba(255,255,255,0.2)] group-hover:text-[#00C9A7]"
            />
          </Link>
        ))}
      </div>
    </div>
  );
}

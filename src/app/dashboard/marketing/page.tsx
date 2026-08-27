"use client";

import Link from "next/link";
import { Mail, ArrowRight } from "lucide-react";

// Carousel Studio, the Meta Ads Command Center and Ad Intelligence were deleted on
// 2026-08-27. All three were built for the MCA brokerage SRT closed in July 2026: the ads
// prompt opened "SRT Agency, a business funding company (MCA - Merchant Cash Advance)" and
// the carousel scripts pitched "Revenue-based funding. $5K-$500K." Nothing here was
// crawlable, so none of it was why answer engines called SRT a lender, but a nightly cron
// generating loan copy for a company that no longer lends is how a stale identity feeds
// itself. Do not rebuild them for AEO - that content lives in the reel/drop lanes.
const tools = [
  {
    title: "Email Signature",
    description: "Create professional SRT Agency email signatures and copy them straight into Outlook.",
    href: "/dashboard/marketing/signature",
    icon: Mail,
    color: "#00C9A7",
  },
];

export default function MarketingPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Marketing</h1>
        <p className="text-sm text-[rgba(255,255,255,0.4)] mt-1">
          AI-powered marketing tools for SRT Agency
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {tools.map((tool) => {
          const Icon = tool.icon;
          return (
            <Link
              key={tool.href}
              href={tool.href}
              className="group bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.06)] rounded-xl p-6 hover:border-[rgba(255,255,255,0.12)] transition-all"
            >
              <div className="flex items-start gap-4">
                <div
                  className="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: `${tool.color}18` }}
                >
                  <Icon className="h-5 w-5" style={{ color: tool.color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-white">
                      {tool.title}
                    </h3>
                    <ArrowRight className="h-3.5 w-3.5 text-[rgba(255,255,255,0.2)] group-hover:text-[rgba(255,255,255,0.5)] transition-colors" />
                  </div>
                  <p className="text-xs text-[rgba(255,255,255,0.4)] mt-1 leading-relaxed">
                    {tool.description}
                  </p>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

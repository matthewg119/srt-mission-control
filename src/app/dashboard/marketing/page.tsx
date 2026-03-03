"use client";

import Link from "next/link";
import { Palette, Mail, Target, Brain, ArrowRight } from "lucide-react";

const tools = [
  {
    title: "Carousel Studio",
    description: "Generate Instagram carousels with AI-powered scripts, custom visuals, and one-click JPG download.",
    href: "/dashboard/marketing/carousel",
    icon: Palette,
    color: "#F5A623",
  },
  {
    title: "Email Signature",
    description: "Create professional SRT Agency email signatures and copy them straight into Outlook.",
    href: "/dashboard/marketing/signature",
    icon: Mail,
    color: "#00C9A7",
  },
  {
    title: "Meta Ads Command Center",
    description: "100 verticals \u00D7 7 awareness layers. AI-powered campaign builder with ICP-specific language.",
    href: "/dashboard/marketing/ads",
    icon: Target,
    color: "#1B65A7",
  },
  {
    title: "Ad Intelligence",
    description: "AI-powered nightly ad ideas, pattern detection, and Telegram reports from CRM data.",
    href: "/dashboard/marketing/ad-intelligence",
    icon: Brain,
    color: "#9B59B6",
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

"use client";

import { useState, useEffect } from "react";
import {
  BarChart3,
  Lightbulb,
  Phone,
  TrendingUp,
  DollarSign,
  Users,
} from "lucide-react";
import Link from "next/link";
import {
  generateDailyCalls,
  generateLeadMagnetIdeas,
} from "@/config/mock-calls";
import type { MockCall, LeadMagnetIdea } from "@/config/mock-calls";

const TYPE_COLORS: Record<string, string> = {
  ebook: "#1B65A7",
  checklist: "#00C9A7",
  calculator: "#F5A623",
  webinar: "#9B59B6",
  template: "#E67E22",
  guide: "#2ECC71",
  video: "#E74C3C",
  infographic: "#3498DB",
};

export default function DailyRecapPage() {
  const [calls, setCalls] = useState<MockCall[]>([]);
  const [ideas, setIdeas] = useState<LeadMagnetIdea[]>([]);

  useEffect(() => {
    setCalls(generateDailyCalls(10));
    setIdeas(generateLeadMagnetIdeas(10));
  }, []);

  const hotLeads = calls.filter(
    (c) => c.outcome === "interested" || c.outcome === "applied"
  ).length;
  const totalRequested = calls.reduce((s, c) => s + c.requestedAmount, 0);
  const topIndustries = [...new Set(calls.map((c) => c.industry))].slice(0, 4);

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[rgba(0,201,167,0.1)]">
          <BarChart3 className="h-5 w-5 text-[#00C9A7]" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">Daily Recap</h1>
          <p className="text-sm text-[rgba(255,255,255,0.4)]">
            {new Date().toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </p>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 mb-6 bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-1">
        {[
          { key: "feed", label: "Feed", href: "/dashboard/call-recap" },
          { key: "log", label: "Call Log", href: "/dashboard/call-recap/log" },
          { key: "daily", label: "Daily Recap", href: "/dashboard/call-recap/daily" },
        ].map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            className={`flex-1 text-center px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab.key === "daily"
                ? "bg-[rgba(255,255,255,0.08)] text-white"
                : "text-[rgba(255,255,255,0.4)] hover:text-white hover:bg-[rgba(255,255,255,0.04)]"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          {
            label: "Calls Made",
            value: calls.length,
            icon: Phone,
            color: "#1B65A7",
          },
          {
            label: "Hot Leads",
            value: hotLeads,
            icon: TrendingUp,
            color: "#00C9A7",
          },
          {
            label: "Funding Requested",
            value: `$${(totalRequested / 1000).toFixed(0)}k`,
            icon: DollarSign,
            color: "#F5A623",
          },
          {
            label: "Lead Magnets",
            value: ideas.length,
            icon: Lightbulb,
            color: "#9B59B6",
          },
        ].map((stat) => (
          <div
            key={stat.label}
            className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-4"
          >
            <div className="flex items-center gap-2 mb-2">
              <stat.icon
                className="h-4 w-4"
                style={{ color: stat.color }}
              />
              <span className="text-xs text-[rgba(255,255,255,0.4)]">
                {stat.label}
              </span>
            </div>
            <p className="text-xl font-bold text-white">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Top Industries */}
      <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-4 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Users className="h-4 w-4 text-[rgba(255,255,255,0.4)]" />
          <span className="text-sm font-medium text-white">
            Top Industries Today
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {topIndustries.map((ind) => (
            <span
              key={ind}
              className="text-xs px-3 py-1 bg-[rgba(255,255,255,0.05)] rounded-full text-[rgba(255,255,255,0.6)]"
            >
              {ind}
            </span>
          ))}
        </div>
      </div>

      {/* Lead Magnet Ideas */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Lightbulb className="h-5 w-5 text-[#F5A623]" />
          <h2 className="text-lg font-bold text-white">
            Lead Magnet Ideas
          </h2>
          <span className="text-xs text-[rgba(255,255,255,0.3)] ml-1">
            Generated from today&apos;s calls
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {ideas.map((idea, idx) => {
            const color = TYPE_COLORS[idea.type] || "#1B65A7";
            return (
              <div
                key={idea.id}
                className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-4 hover:border-[rgba(255,255,255,0.12)] transition-colors"
              >
                <div className="flex items-start gap-3">
                  <span className="text-xs font-bold text-[rgba(255,255,255,0.15)] mt-0.5">
                    {idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-sm font-semibold text-white truncate">
                        {idea.title}
                      </h3>
                      <span
                        className="text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0"
                        style={{
                          backgroundColor: `${color}18`,
                          color,
                        }}
                      >
                        {idea.type}
                      </span>
                    </div>
                    <p className="text-xs text-[rgba(255,255,255,0.5)] line-clamp-2">
                      {idea.description}
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-[10px] text-[rgba(255,255,255,0.3)]">
                        {idea.industry}
                      </span>
                      <span className="text-[10px] text-[rgba(255,255,255,0.2)]">
                        &bull;
                      </span>
                      <span className="text-[10px] text-[rgba(255,255,255,0.3)]">
                        {idea.painPoint}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

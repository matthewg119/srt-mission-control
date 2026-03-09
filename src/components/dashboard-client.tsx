"use client";

import { MessageSquare, Kanban, Mail, Activity, AlertCircle, Clock, TrendingUp, Users } from "lucide-react";
import { StatCard } from "./stat-card";
import Link from "next/link";

interface StaleDeal {
  contact_name: string;
  business_name: string;
  stage: string;
  updated_at: string;
  relativeTime: string;
}

interface DashboardClientProps {
  userName: string;
  formattedDate: string;
  stats: {
    activeDeals: number;
    pendingDrafts: number;
    inUnderwriting: number;
    funded: number;
  };
  staleDeals: StaleDeal[];
  newLeads: number;
  logs: Array<{
    id: string;
    event_type: string;
    description: string;
    relativeTime: string;
  }>;
}

export function DashboardClient({ userName, formattedDate, stats, staleDeals, newLeads, logs }: DashboardClientProps) {
  const hasAttentionItems = staleDeals.length > 0 || stats.pendingDrafts > 0 || newLeads > 0;

  return (
    <div>
      {/* Welcome */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Welcome back, {userName}</h1>
        <p className="text-sm text-[rgba(255,255,255,0.5)] mt-1">
          SRT Agency Operations Center — {formattedDate}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Active Deals" value={stats.activeDeals} accentColor="#00C9A7" />
        <StatCard label="Pending Review" value={stats.pendingDrafts} accentColor="#F5A623" />
        <StatCard label="Pending Stips" value={stats.inUnderwriting} accentColor="#f59e0b" />
        <StatCard label="Funded This Month" value={stats.funded} accentColor="#4CAF50" />
      </div>

      {/* Needs Attention */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <AlertCircle size={16} className="text-[#F5A623]" />
          <h2 className="text-base font-semibold text-white">Needs Attention</h2>
        </div>

        {!hasAttentionItems ? (
          <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-5 text-center">
            <p className="text-sm text-[rgba(255,255,255,0.4)]">All clear — no items need attention right now.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {/* New leads */}
            {newLeads > 0 && (
              <Link
                href="/dashboard/pipeline"
                className="flex items-center justify-between bg-[rgba(0,201,167,0.06)] border border-[rgba(0,201,167,0.15)] rounded-lg px-4 py-3 hover:border-[rgba(0,201,167,0.3)] transition-colors"
              >
                <div className="flex items-center gap-3">
                  <TrendingUp size={14} className="text-[#00C9A7]" />
                  <span className="text-sm text-white">
                    <span className="font-semibold text-[#00C9A7]">{newLeads} new lead{newLeads > 1 ? "s" : ""}</span> came in the last 24 hours
                  </span>
                </div>
                <span className="text-xs text-[rgba(255,255,255,0.3)]">View →</span>
              </Link>
            )}

            {/* Pending email drafts */}
            {stats.pendingDrafts > 0 && (
              <Link
                href="/dashboard/email-agents"
                className="flex items-center justify-between bg-[rgba(245,166,35,0.06)] border border-[rgba(245,166,35,0.15)] rounded-lg px-4 py-3 hover:border-[rgba(245,166,35,0.3)] transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Mail size={14} className="text-[#F5A623]" />
                  <span className="text-sm text-white">
                    <span className="font-semibold text-[#F5A623]">{stats.pendingDrafts} email draft{stats.pendingDrafts > 1 ? "s" : ""}</span> waiting for your approval
                  </span>
                </div>
                <span className="text-xs text-[rgba(255,255,255,0.3)]">Review →</span>
              </Link>
            )}

            {/* Stale deals */}
            {staleDeals.map((deal) => (
              <Link
                key={`${deal.business_name}-${deal.updated_at}`}
                href="/dashboard/pipeline"
                className="flex items-center justify-between bg-[rgba(231,76,60,0.06)] border border-[rgba(231,76,60,0.15)] rounded-lg px-4 py-3 hover:border-[rgba(231,76,60,0.3)] transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Clock size={14} className="text-[#E74C3C]" />
                  <div>
                    <span className="text-sm text-white font-medium">{deal.business_name || deal.contact_name}</span>
                    <span className="text-xs text-[rgba(255,255,255,0.4)] ml-2">— {deal.stage}</span>
                  </div>
                </div>
                <span className="text-xs text-[rgba(255,255,255,0.3)] whitespace-nowrap">No activity {deal.relativeTime}</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-3 gap-3 mb-8">
        <Link
          href="/dashboard/assistant"
          className="flex items-center gap-2 px-4 py-3 bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl text-sm text-white hover:border-[rgba(255,255,255,0.12)] transition-colors"
        >
          <MessageSquare size={16} className="text-[#00C9A7]" />
          AI Chat
        </Link>
        <Link
          href="/dashboard/pipeline"
          className="flex items-center gap-2 px-4 py-3 bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl text-sm text-white hover:border-[rgba(255,255,255,0.12)] transition-colors"
        >
          <Kanban size={16} className="text-[#9C27B0]" />
          Pipeline
        </Link>
        <Link
          href="/dashboard/email-agents"
          className="flex items-center gap-2 px-4 py-3 bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl text-sm text-white hover:border-[rgba(255,255,255,0.12)] transition-colors"
        >
          <Mail size={16} className="text-[#1B65A7]" />
          Review Emails
        </Link>
      </div>

      {/* Activity Feed */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Activity size={16} className="text-[rgba(255,255,255,0.4)]" />
          <h2 className="text-base font-semibold text-white">Recent Activity</h2>
        </div>
        {logs.length === 0 ? (
          <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-6 text-center">
            <p className="text-[rgba(255,255,255,0.4)] text-sm">No activity yet.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {logs.map((log) => (
              <div
                key={log.id}
                className="flex items-center justify-between bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-lg px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-[#00C9A7] shrink-0" />
                  <span className="text-sm text-white">{log.description}</span>
                </div>
                <span className="text-xs text-[rgba(255,255,255,0.3)] whitespace-nowrap ml-4">
                  {log.relativeTime}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

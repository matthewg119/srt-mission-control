"use client";

import { usePathname } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import { Menu, Bell, X, CheckCheck } from "lucide-react";
import { supabase } from "@/lib/db";

interface HeaderProps {
  user: { name?: string | null };
  onMenuClick: () => void;
}

interface SystemAlert {
  id: string;
  severity: "info" | "warning" | "error" | "critical";
  title: string;
  message: string;
  source?: string;
  read: boolean;
  created_at: string;
}

const titleMap: Record<string, string> = {
  "/dashboard": "Command Center",
  "/dashboard/pipeline": "Pipeline",
  "/dashboard/brain-trust": "Brain Trust",
  "/dashboard/email-agents": "Email Agents",
  "/dashboard/templates": "Templates",
  "/dashboard/sequences": "Sequences",
  "/dashboard/workflows": "Workflows",
  "/dashboard/systems": "Systems",
  "/dashboard/lenders": "Lenders",
  "/dashboard/checklist": "Checklist",
  "/dashboard/settings": "Settings",
};

const SEVERITY_COLORS: Record<string, string> = {
  info: "#0ea5e9",
  warning: "#f59e0b",
  error: "#ef4444",
  critical: "#dc2626",
};

function getPageTitle(pathname: string): string {
  if (titleMap[pathname]) return titleMap[pathname];
  const segments = pathname.split("/");
  while (segments.length > 1) {
    segments.pop();
    const parentPath = segments.join("/");
    if (titleMap[parentPath]) return titleMap[parentPath];
  }
  return "Command Center";
}

function getFirstName(name?: string | null): string {
  if (!name) return "there";
  return name.split(" ")[0];
}

function formatAlertTime(ts: string): string {
  const d = new Date(ts);
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function Header({ user, onMenuClick }: HeaderProps) {
  const pathname = usePathname();
  const pageTitle = getPageTitle(pathname);
  const firstName = getFirstName(user.name);
  const [alerts, setAlerts] = useState<SystemAlert[]>([]);
  const [bellOpen, setBellOpen] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);

  const unreadCount = alerts.filter((a) => !a.read).length;

  useEffect(() => {
    fetchAlerts();
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setBellOpen(false);
      }
    }
    if (bellOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [bellOpen]);

  async function fetchAlerts() {
    try {
      // Use anon client — system_alerts is a read-only public table
      const { data } = await supabase
        .from("system_alerts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      setAlerts(data || []);
    } catch {
      // Table may not exist yet
    }
  }

  async function markAllRead() {
    try {
      await supabase
        .from("system_alerts")
        .update({ read: true })
        .eq("read", false);
      setAlerts((prev) => prev.map((a) => ({ ...a, read: true })));
    } catch {
      // Silent fail
    }
  }

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between border-b border-[rgba(255,255,255,0.06)] bg-[#0B1426] px-6">
      {/* Left side */}
      <div className="flex items-center gap-4">
        <button
          onClick={onMenuClick}
          className="md:hidden rounded-md p-1.5 text-[rgba(255,255,255,0.5)] transition-colors hover:bg-[rgba(255,255,255,0.05)] hover:text-white"
          aria-label="Toggle sidebar"
        >
          <Menu className="h-5 w-5" />
        </button>
        <h1 className="text-lg font-semibold text-white">{pageTitle}</h1>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-3">
        {/* Bell icon */}
        <div ref={bellRef} className="relative">
          <button
            onClick={() => { setBellOpen(!bellOpen); if (!bellOpen) fetchAlerts(); }}
            className="relative p-2 rounded-lg text-[rgba(255,255,255,0.4)] hover:text-white hover:bg-[rgba(255,255,255,0.05)] transition-colors"
          >
            <Bell size={18} />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 w-2 h-2 bg-[#ef4444] rounded-full" />
            )}
          </button>

          {bellOpen && (
            <div className="absolute right-0 mt-2 w-80 bg-[#0F1E35] border border-[rgba(255,255,255,0.1)] rounded-xl shadow-2xl overflow-hidden z-50">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[rgba(255,255,255,0.06)]">
                <span className="text-sm font-semibold text-white">
                  Alerts {unreadCount > 0 && <span className="text-[#ef4444]">({unreadCount})</span>}
                </span>
                <div className="flex items-center gap-2">
                  {unreadCount > 0 && (
                    <button
                      onClick={markAllRead}
                      className="flex items-center gap-1 text-[10px] text-[rgba(255,255,255,0.4)] hover:text-white"
                    >
                      <CheckCheck size={12} /> Mark all read
                    </button>
                  )}
                  <button onClick={() => setBellOpen(false)} className="text-[rgba(255,255,255,0.4)] hover:text-white">
                    <X size={14} />
                  </button>
                </div>
              </div>

              <div className="max-h-80 overflow-y-auto divide-y divide-[rgba(255,255,255,0.04)]">
                {alerts.length === 0 ? (
                  <p className="text-xs text-[rgba(255,255,255,0.3)] text-center py-6">No alerts</p>
                ) : (
                  alerts.slice(0, 10).map((alert) => (
                    <div
                      key={alert.id}
                      className={`px-4 py-3 ${!alert.read ? "bg-[rgba(255,255,255,0.02)]" : ""}`}
                    >
                      <div className="flex items-start gap-2">
                        <span
                          className="w-2 h-2 rounded-full mt-1.5 shrink-0"
                          style={{ background: SEVERITY_COLORS[alert.severity] || "#64748b" }}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-white truncate">{alert.title}</p>
                          <p className="text-[11px] text-[rgba(255,255,255,0.5)] mt-0.5 line-clamp-2">{alert.message}</p>
                          {alert.source && (
                            <p className="text-[10px] text-[rgba(255,255,255,0.25)] mt-0.5">{alert.source}</p>
                          )}
                        </div>
                        <span className="text-[10px] text-[rgba(255,255,255,0.25)] shrink-0 mt-0.5">
                          {formatAlertTime(alert.created_at)}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        <span className="text-sm text-[rgba(255,255,255,0.5)]">Hey, {firstName}</span>
      </div>
    </header>
  );
}

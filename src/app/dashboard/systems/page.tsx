"use client";

import { useState, useEffect } from "react";
import { ExternalLink, LayoutGrid } from "lucide-react";

interface SystemTile {
  name: string;
  description: string;
  url: string;
  category: string;
  emoji: string;
  dynamic?: boolean;
}

const STATIC_TILES: SystemTile[] = [
  // CRM
  { name: "GoHighLevel", description: "CRM, pipeline, contacts, automations", url: "https://app.gohighlevel.com", category: "CRM", emoji: "🎯" },
  // Email & Files
  { name: "Outlook", description: "Email inbox and calendar", url: "https://outlook.office365.com", category: "Email & Files", emoji: "📧" },
  { name: "OneDrive", description: "Deal documents and file storage", url: "https://onedrive.live.com", category: "Email & Files", emoji: "🗂️" },
  { name: "Teams", description: "SRT Deal Room — internal comms", url: "https://teams.microsoft.com", category: "Email & Files", emoji: "💬" },
  // Marketing
  { name: "Meta Business Suite", description: "Facebook & Instagram ads management", url: "https://business.facebook.com", category: "Marketing", emoji: "📣" },
  { name: "srtagency.com", description: "Public website and landing pages", url: "https://srtagency.com", category: "Marketing", emoji: "🌐" },
  { name: "Vercel", description: "Website deployments and analytics", url: "https://vercel.com/dashboard", category: "Marketing", emoji: "▲" },
  // Infrastructure
  { name: "Azure Portal", description: "App registrations and Graph API permissions", url: "https://portal.azure.com", category: "Infrastructure", emoji: "☁️" },
  { name: "Supabase", description: "Mission Control database and auth", url: "https://supabase.com/dashboard", category: "Infrastructure", emoji: "🔋" },
  { name: "Railway", description: "AI agents service hosting", url: "https://railway.app/dashboard", category: "Infrastructure", emoji: "🚂" },
  { name: "Anthropic Console", description: "Claude API usage and keys", url: "https://console.anthropic.com", category: "Infrastructure", emoji: "🤖" },
];

const CATEGORY_ORDER = ["CRM", "Email & Files", "Marketing", "Lender Portals", "Infrastructure"];

export default function SystemsPage() {
  const [lenderPortals, setLenderPortals] = useState<SystemTile[]>([]);

  useEffect(() => {
    fetch("/api/lenders")
      .then((r) => r.json())
      .then((data) => {
        const portals: SystemTile[] = (data.lenders || [])
          .filter((l: { portal_url: string | null; is_active: boolean }) => l.portal_url && l.is_active)
          .map((l: { name: string; portal_url: string }) => ({
            name: l.name,
            description: "Lender submission portal",
            url: l.portal_url,
            category: "Lender Portals",
            emoji: "🏦",
            dynamic: true,
          }));
        setLenderPortals(portals);
      })
      .catch(() => {});
  }, []);

  const allTiles = [...STATIC_TILES, ...lenderPortals];

  const grouped = CATEGORY_ORDER.reduce<Record<string, SystemTile[]>>((acc, cat) => {
    const tiles = allTiles.filter((t) => t.category === cat);
    if (tiles.length > 0) acc[cat] = tiles;
    return acc;
  }, {});

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[rgba(0,201,167,0.1)]">
          <LayoutGrid className="h-5 w-5 text-[#00C9A7]" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">Systems Hub</h1>
          <p className="text-sm text-[rgba(255,255,255,0.4)]">Quick access to all tools and platforms</p>
        </div>
      </div>

      {/* Grouped tiles */}
      <div className="space-y-8">
        {Object.entries(grouped).map(([category, tiles]) => (
          <div key={category}>
            <h2 className="text-xs font-semibold text-[rgba(255,255,255,0.4)] uppercase tracking-wider mb-3">
              {category}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {tiles.map((tile) => (
                <a
                  key={tile.name}
                  href={tile.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-start gap-4 bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-4 hover:border-[rgba(255,255,255,0.12)] hover:bg-[rgba(255,255,255,0.05)] transition-all"
                >
                  <span className="text-2xl leading-none mt-0.5">{tile.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-white">{tile.name}</span>
                      {tile.dynamic && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[rgba(27,101,167,0.2)] text-[#1B65A7]">Lender</span>
                      )}
                    </div>
                    <p className="text-xs text-[rgba(255,255,255,0.4)] mt-0.5 truncate">{tile.description}</p>
                  </div>
                  <ExternalLink size={14} className="text-[rgba(255,255,255,0.2)] group-hover:text-[rgba(255,255,255,0.5)] shrink-0 mt-0.5 transition-colors" />
                </a>
              ))}
            </div>
          </div>
        ))}

        {lenderPortals.length === 0 && (
          <p className="text-xs text-[rgba(255,255,255,0.3)] italic">
            Add lenders with portal URLs in the <a href="/dashboard/lenders" className="text-[#00C9A7] hover:underline">Lenders</a> page to see them here.
          </p>
        )}
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";
import { IntegrationCard } from "@/components/integration-card";

interface Integration {
  id: string;
  name: string;
  type: string;
  status: string;
  config: Record<string, string>;
  last_sync: string | null;
}

export default function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [setupResult, setSetupResult] = useState<Record<string, unknown> | null>(null);
  const [settingUp, setSettingUp] = useState(false);

  const fetchIntegrations = async () => {
    try {
      const res = await fetch("/api/integrations");
      const data = await res.json();
      setIntegrations(data.integrations || []);
    } catch {
      setIntegrations([]);
    }
    setLoading(false);
  };

  useEffect(() => { fetchIntegrations(); }, []);

  const handleSetupGHL = async () => {
    if (!confirm("This will create the Business Loans pipeline and 26 custom fields in GoHighLevel. Continue?")) return;
    setSettingUp(true);
    setSetupResult(null);
    try {
      const res = await fetch("/api/ghl/setup", { method: "POST" });
      const data = await res.json();
      setSetupResult(data);
      fetchIntegrations();
    } catch (e) {
      setSetupResult({ error: "Setup failed" });
    }
    setSettingUp(false);
  };

  const handleSyncGHL = async () => {
    try {
      await fetch("/api/ghl/sync", { method: "POST" });
      fetchIntegrations();
    } catch {
      // Error
    }
  };

  const handleSaveConfig = async (id: string, config: Record<string, string>) => {
    try {
      await fetch("/api/integrations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, config }),
      });
      fetchIntegrations();
    } catch {
      // Error
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Integrations</h1>
        <p className="text-sm text-[rgba(255,255,255,0.5)] mt-1">Connect your tools to Mission Control</p>
      </div>

      {/* Setup result banner */}
      {setupResult && (
        <div className="mb-4 bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-4">
          <h3 className="text-sm font-semibold text-white mb-2">GHL Setup Results</h3>
          {(setupResult as Record<string, Record<string, unknown>>).summary && (
            <div className="flex gap-4 text-xs">
              <span className="text-[#00C9A7]">✓ Created: {((setupResult as Record<string, Record<string, number>>).summary).created}</span>
              <span className="text-[#F5A623]">⟳ Skipped: {((setupResult as Record<string, Record<string, number>>).summary).skipped}</span>
              <span className="text-[#E74C3C]">✗ Errors: {((setupResult as Record<string, Record<string, number>>).summary).errors}</span>
            </div>
          )}
          <button onClick={() => setSetupResult(null)} className="text-xs text-[rgba(255,255,255,0.4)] mt-2 hover:text-white">Dismiss</button>
        </div>
      )}

      {settingUp && (
        <div className="mb-4 bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-4 text-center">
          <div className="animate-spin w-6 h-6 border-2 border-[#00C9A7] border-t-transparent rounded-full mx-auto mb-2" />
          <p className="text-sm text-[rgba(255,255,255,0.5)]">Setting up GHL pipeline and custom fields... This may take a minute.</p>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-5 animate-pulse h-40" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {integrations.map((integration) => (
            <IntegrationCard
              key={integration.id || integration.name}
              integration={integration}
              onSetupGHL={integration.name === "GoHighLevel" ? handleSetupGHL : undefined}
              onSyncGHL={integration.name === "GoHighLevel" ? handleSyncGHL : undefined}
              onSaveConfig={handleSaveConfig}
            />
          ))}
        </div>
      )}
    </div>
  );
}

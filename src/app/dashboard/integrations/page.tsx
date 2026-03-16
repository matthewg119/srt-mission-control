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
  const [msStatus, setMsStatus] = useState<string | null>(null);

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

  useEffect(() => {
    fetchIntegrations();
    // Check for Microsoft OAuth redirect result
    const params = new URLSearchParams(window.location.search);
    if (params.get("ms_connected")) {
      setMsStatus("Microsoft 365 connected successfully!");
      window.history.replaceState({}, "", window.location.pathname);
    } else if (params.get("ms_error")) {
      setMsStatus(`Microsoft 365 error: ${params.get("ms_error")}`);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const handleSetSignature = async () => {
    setMsStatus("Setting email signature...");
    try {
      const res = await fetch("/api/integrations/microsoft/signature", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setMsStatus("Email signature set successfully! Check your Outlook settings.");
      } else {
        setMsStatus(`Signature error: ${data.error || "Unknown error"}`);
      }
    } catch {
      setMsStatus("Failed to set email signature. Please try again.");
    }
  };

  const handleDisconnectMicrosoft = async () => {
    if (!confirm("Disconnect Microsoft 365? You can reconnect anytime.")) return;
    try {
      const res = await fetch("/api/integrations/microsoft/disconnect", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        console.error("Disconnect failed:", data.error || res.statusText);
        alert("Failed to disconnect Microsoft 365. Please try again.");
      }
    } catch (err) {
      console.error("Disconnect error:", err);
      alert("Failed to disconnect Microsoft 365. Please try again.");
    }
    fetchIntegrations();
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

      {/* Microsoft connection banner */}
      {msStatus && (
        <div className={`mb-4 border rounded-xl p-4 ${msStatus.includes("error") ? "bg-[rgba(231,76,60,0.1)] border-[rgba(231,76,60,0.2)]" : "bg-[rgba(0,201,167,0.1)] border-[rgba(0,201,167,0.2)]"}`}>
          <p className={`text-sm ${msStatus.includes("error") ? "text-[#E74C3C]" : "text-[#00C9A7]"}`}>{msStatus}</p>
          <button onClick={() => setMsStatus(null)} className="text-xs text-[rgba(255,255,255,0.4)] mt-1 hover:text-white">Dismiss</button>
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
              onDisconnectMicrosoft={integration.name === "Microsoft 365" ? handleDisconnectMicrosoft : undefined}
              onSetSignature={integration.name === "Microsoft 365" && integration.status === "connected" ? handleSetSignature : undefined}
              onSaveConfig={handleSaveConfig}
            />
          ))}
        </div>
      )}
    </div>
  );
}

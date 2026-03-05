"use client";

import { useState } from "react";
import { formatRelativeTime } from "@/lib/utils";

interface Integration {
  id: string;
  name: string;
  type: string;
  status: string;
  config: Record<string, string>;
  last_sync: string | null;
}

const INTEGRATION_ICONS: Record<string, string> = {
  GoHighLevel: "📊",
  "AI Configuration": "🤖",
  "Microsoft 365": "📧",
  "Microsoft Teams": "💬",
  Quo: "📞",
  "Quo Phone": "📞",
  OneDrive: "📁",
  "Meta Pixel": "📈",
};

const STATUS_COLORS: Record<string, string> = {
  connected: "#00C9A7",
  disconnected: "#E74C3C",
  error: "#E74C3C",
  coming_soon: "#F5A623",
};

interface IntegrationCardProps {
  integration: Integration;
  onSetupGHL?: () => void;
  onSyncGHL?: () => void;
  onConnectMicrosoft?: () => void;
  onDisconnectMicrosoft?: () => void;
  onSetSignature?: () => void;
  onSaveConfig?: (id: string, config: Record<string, string>) => void;
}

export function IntegrationCard({
  integration,
  onSetupGHL,
  onSyncGHL,
  onConnectMicrosoft,
  onDisconnectMicrosoft,
  onSetSignature,
  onSaveConfig,
}: IntegrationCardProps) {
  const [showConfig, setShowConfig] = useState(false);
  const [configValues, setConfigValues] = useState(integration.config || {});
  const [saving, setSaving] = useState(false);

  const icon = (integration as unknown as Record<string, unknown>).icon as string || INTEGRATION_ICONS[integration.name] || "🔌";

  // Microsoft 365 should show "Disconnected" instead of "Coming Soon" since it's a real integration
  const effectiveStatus =
    integration.name === "Microsoft 365" && integration.status === "coming_soon"
      ? "disconnected"
      : integration.status;

  const statusColor = STATUS_COLORS[effectiveStatus] || "#F5A623";

  const handleSave = async () => {
    if (!onSaveConfig) return;
    setSaving(true);
    await onSaveConfig(integration.id, configValues);
    setSaving(false);
    setShowConfig(false);
  };

  const statusLabel =
    effectiveStatus === "coming_soon"
      ? "Coming Soon"
      : effectiveStatus.charAt(0).toUpperCase() + effectiveStatus.slice(1);

  return (
    <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-5 card-hover">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{icon}</span>
          <div>
            <h3 className="font-semibold text-white">{integration.name}</h3>
            <p className="text-xs text-[rgba(255,255,255,0.4)]">{integration.type}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: statusColor }}
          />
          <span className="text-xs text-[rgba(255,255,255,0.5)]">{statusLabel}</span>
        </div>
      </div>

      <p className="text-xs text-[rgba(255,255,255,0.4)] mb-4">
        {integration.last_sync
          ? `Last synced ${formatRelativeTime(integration.last_sync)}`
          : "Never synced"}
      </p>

      {/* GHL-specific buttons */}
      {integration.name === "GoHighLevel" && (
        <div className="flex gap-2 mb-3">
          {integration.status !== "connected" && onSetupGHL && (
            <button
              onClick={onSetupGHL}
              className="text-xs px-3 py-1.5 bg-[#00C9A7] text-[#0B1426] rounded-md font-medium hover:opacity-90 transition-opacity"
            >
              Setup Pipeline
            </button>
          )}
          {onSyncGHL && (
            <button
              onClick={onSyncGHL}
              className="text-xs px-3 py-1.5 bg-[rgba(255,255,255,0.08)] text-white rounded-md hover:bg-[rgba(255,255,255,0.12)] transition-colors"
            >
              Sync Now
            </button>
          )}
        </div>
      )}

      {/* Microsoft 365 buttons */}
      {integration.name === "Microsoft 365" && (
        <div className="mb-3">
          {integration.status === "connected" ? (
            <div>
              <p className="text-xs text-[#00C9A7] mb-1">
                Connected as {integration.config?.email || integration.config?.display_name || "Outlook"}
              </p>
              <p className="text-xs text-[rgba(255,255,255,0.4)] mb-2">
                📁 OneDrive: Active — files auto-organized by deal
              </p>
              <div className="flex gap-2 flex-wrap">
                <a
                  href="/dashboard/mail"
                  className="text-xs px-3 py-1.5 bg-[#00C9A7] text-[#0B1426] rounded-md font-medium hover:opacity-90 transition-opacity"
                >
                  Open Inbox
                </a>
                {onSetSignature && (
                  <button
                    onClick={onSetSignature}
                    className="text-xs px-3 py-1.5 bg-[rgba(255,255,255,0.08)] text-white rounded-md hover:bg-[rgba(255,255,255,0.12)] transition-colors"
                  >
                    Set Signature
                  </button>
                )}
                {onDisconnectMicrosoft && (
                  <button
                    onClick={onDisconnectMicrosoft}
                    className="text-xs px-3 py-1.5 bg-[rgba(255,255,255,0.08)] text-[rgba(255,255,255,0.5)] rounded-md hover:bg-[rgba(231,76,60,0.2)] hover:text-[#E74C3C] transition-colors"
                  >
                    Disconnect
                  </button>
                )}
              </div>
            </div>
          ) : (
            onConnectMicrosoft && (
              <button
                onClick={onConnectMicrosoft}
                className="text-xs px-3 py-1.5 bg-[#00C9A7] text-[#0B1426] rounded-md font-medium hover:opacity-90 transition-opacity"
              >
                Connect Outlook
              </button>
            )
          )}
        </div>
      )}

      {/* Coming soon message — skip for Microsoft 365 which has its own button block */}
      {integration.status === "coming_soon" && integration.name !== "Microsoft 365" && (
        <p className="text-xs text-[rgba(255,255,255,0.3)] italic">
          {integration.name === "Microsoft Teams" && "Receives notifications for deal events"}
          {(integration.name === "Quo" || integration.name === "Quo Phone") && "Will sync call recordings + transcriptions"}
          {integration.name === "OneDrive" && "Will auto-organize deal files by stage"}
          {integration.name === "Meta Pixel" && "Tracking on srtagency.com"}
        </p>
      )}

      {/* Configure button */}
      {effectiveStatus !== "coming_soon" && (
        <button
          onClick={() => setShowConfig(!showConfig)}
          className="text-xs text-[rgba(255,255,255,0.5)] hover:text-white transition-colors"
        >
          {showConfig ? "Close" : "Configure"}
        </button>
      )}

      {/* Config panel */}
      {showConfig && (
        <div className="mt-4 pt-4 border-t border-[rgba(255,255,255,0.06)] space-y-3">
          {integration.name === "GoHighLevel" && (
            <>
              <ConfigField label="API Key" field="apiKey" values={configValues} onChange={setConfigValues} />
              <ConfigField label="Location ID" field="locationId" values={configValues} onChange={setConfigValues} />
            </>
          )}
          {integration.name === "Microsoft Teams" && (
            <ConfigField label="Webhook URL" field="webhookUrl" values={configValues} onChange={setConfigValues} />
          )}
          {integration.name === "Quo" && (
            <ConfigField label="API Key" field="apiKey" values={configValues} onChange={setConfigValues} />
          )}
          {integration.name === "Meta Pixel" && (
            <ConfigField label="Pixel ID" field="pixelId" values={configValues} onChange={setConfigValues} />
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-xs px-3 py-1.5 bg-[#00C9A7] text-[#0B1426] rounded-md font-medium hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Configuration"}
          </button>
        </div>
      )}
    </div>
  );
}

function ConfigField({
  label,
  field,
  values,
  onChange,
}: {
  label: string;
  field: string;
  values: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
}) {
  return (
    <div>
      <label className="text-xs text-[rgba(255,255,255,0.5)] block mb-1">{label}</label>
      <input
        type="text"
        value={values[field] || ""}
        onChange={(e) => onChange({ ...values, [field]: e.target.value })}
        className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-1.5 text-sm text-white placeholder-[rgba(255,255,255,0.3)] focus:outline-none focus:border-[#00C9A7]"
        placeholder={`Enter ${label.toLowerCase()}`}
      />
    </div>
  );
}

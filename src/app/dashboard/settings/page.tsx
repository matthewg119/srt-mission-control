"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { User, Users, Bot, AlertTriangle, Trash2, Bell } from "lucide-react";

export default function SettingsPage() {
  const { data: session } = useSession();
  const [activeTab, setActiveTab] = useState("account");

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-6">Settings</h1>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 border-b border-[rgba(255,255,255,0.06)] pb-3 flex-wrap">
        {[
          { id: "account", label: "Account", icon: User },
          { id: "team", label: "Team", icon: Users },
          { id: "ai", label: "AI Configuration", icon: Bot },
          { id: "notifications", label: "Notifications", icon: Bell },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors ${
              activeTab === tab.id
                ? "bg-[rgba(255,255,255,0.08)] text-white"
                : "text-[rgba(255,255,255,0.5)] hover:text-white"
            }`}
          >
            <tab.icon size={14} />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "account" && <AccountTab />}
      {activeTab === "team" && <TeamTab isAdmin={(session?.user as unknown as Record<string, unknown>)?.role === "admin"} currentUserId={(session?.user as unknown as Record<string, unknown>)?.id as string} />}
      {activeTab === "ai" && <AIConfigTab />}
      {activeTab === "notifications" && <NotificationsTab />}
    </div>
  );
}

function AccountTab() {
  const { data: session } = useSession();
  const [name, setName] = useState(session?.user?.name || "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const handleSaveName = async () => {
    setSaving(true);
    try {
      await fetch("/api/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: (session?.user as unknown as Record<string, unknown>)?.id, name }),
      });
      setMessage("Name updated successfully");
    } catch {
      setMessage("Failed to update name");
    }
    setSaving(false);
  };

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      setMessage("Passwords do not match");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: (session?.user as unknown as Record<string, unknown>)?.id,
          current_password: currentPassword,
          password: newPassword,
        }),
      });
      if (res.ok) {
        setMessage("Password changed successfully");
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        const data = await res.json();
        setMessage(data.error || "Failed to change password");
      }
    } catch {
      setMessage("Failed to change password");
    }
    setSaving(false);
  };

  return (
    <div className="max-w-lg space-y-6">
      {message && (
        <div className={`text-sm px-4 py-2 rounded-lg ${message.includes("success") ? "bg-[#00C9A7]/10 text-[#00C9A7]" : "bg-[#E74C3C]/10 text-[#E74C3C]"}`}>
          {message}
        </div>
      )}

      <div>
        <label className="text-xs text-[rgba(255,255,255,0.5)] block mb-1">Name</label>
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-[#00C9A7]"
          />
          <button onClick={handleSaveName} disabled={saving} className="px-4 py-2 bg-[#00C9A7] text-[#0B1426] rounded-md text-sm font-semibold disabled:opacity-50">
            Save
          </button>
        </div>
      </div>

      <div>
        <label className="text-xs text-[rgba(255,255,255,0.5)] block mb-1">Email</label>
        <input
          value={session?.user?.email || ""}
          readOnly
          className="w-full bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-md px-3 py-2 text-sm text-[rgba(255,255,255,0.4)] cursor-not-allowed"
        />
      </div>

      <div className="pt-4 border-t border-[rgba(255,255,255,0.06)]">
        <h3 className="text-sm font-semibold text-white mb-3">Change Password</h3>
        <div className="space-y-3">
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="Current password"
            className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-2 text-sm text-white placeholder-[rgba(255,255,255,0.3)] focus:outline-none focus:border-[#00C9A7]"
          />
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New password"
            className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-2 text-sm text-white placeholder-[rgba(255,255,255,0.3)] focus:outline-none focus:border-[#00C9A7]"
          />
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm new password"
            className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-2 text-sm text-white placeholder-[rgba(255,255,255,0.3)] focus:outline-none focus:border-[#00C9A7]"
          />
          <button
            onClick={handleChangePassword}
            disabled={saving || !currentPassword || !newPassword}
            className="px-4 py-2 bg-[#00C9A7] text-[#0B1426] rounded-md text-sm font-semibold disabled:opacity-50"
          >
            Change Password
          </button>
        </div>
      </div>
    </div>
  );
}

function TeamTab({ isAdmin, currentUserId }: { isAdmin: boolean; currentUserId: string }) {
  const [users, setUsers] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "member" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/users")
      .then((r) => r.json())
      .then((data) => setUsers(data.users || []))
      .finally(() => setLoading(false));
  }, []);

  const handleAdd = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setShowAdd(false);
        setForm({ name: "", email: "", password: "", role: "member" });
        const data = await fetch("/api/users").then((r) => r.json());
        setUsers(data.users || []);
      }
    } catch { /* error */ }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this user?")) return;
    await fetch("/api/users", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setUsers(users.filter((u) => u.id !== id));
  };

  if (!isAdmin) {
    return (
      <div className="text-center py-16 text-[rgba(255,255,255,0.4)]">
        <p>Only admins can manage team members.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-white">Team Members</h3>
        <button onClick={() => setShowAdd(true)} className="text-xs px-3 py-1.5 bg-[#00C9A7] text-[#0B1426] rounded-md font-medium">
          Add User
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">{[1, 2].map((i) => <div key={i} className="h-16 bg-[rgba(255,255,255,0.03)] rounded-lg animate-pulse" />)}</div>
      ) : (
        <div className="space-y-2">
          {users.map((user) => (
            <div key={user.id as string} className="flex items-center justify-between bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-lg px-4 py-3">
              <div>
                <p className="text-sm text-white font-medium">{user.name as string}</p>
                <p className="text-xs text-[rgba(255,255,255,0.4)]">{user.email as string}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#00C9A7]/20 text-[#00C9A7]">{user.role as string}</span>
                <span className="text-[10px] text-[rgba(255,255,255,0.3)]">
                  {user.last_login ? `Last login: ${new Date(user.last_login as string).toLocaleDateString()}` : "Never logged in"}
                </span>
                {user.id !== currentUserId && (
                  <button onClick={() => handleDelete(user.id as string)} className="p-1 text-[rgba(255,255,255,0.3)] hover:text-[#E74C3C]">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-[#0f1d32] border border-[rgba(255,255,255,0.1)] rounded-xl p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold text-white mb-4">Add User</h2>
            <div className="space-y-3">
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name" className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-[#00C9A7]" />
              <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Email" type="email" className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-[#00C9A7]" />
              <input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Password" type="password" className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-[#00C9A7]" />
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-[#00C9A7]">
                <option value="admin" className="bg-[#0f1d32]">Admin</option>
                <option value="member" className="bg-[#0f1d32]">Member</option>
                <option value="viewer" className="bg-[#0f1d32]">Viewer</option>
              </select>
              <div className="flex gap-2 justify-end pt-2">
                <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm text-[rgba(255,255,255,0.5)]">Cancel</button>
                <button onClick={handleAdd} disabled={saving || !form.name || !form.email || !form.password} className="px-4 py-2 bg-[#00C9A7] text-[#0B1426] rounded-md text-sm font-semibold disabled:opacity-50">
                  {saving ? "Adding..." : "Add User"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationsTab() {
  const NOTIFICATION_EVENTS = [
    { key: "new_deal_intake", label: "New deal intake", description: "When a new deal is processed" },
    { key: "funder_response", label: "Funder response received", description: "When a funder approves, declines, or counters" },
    { key: "deal_stale_4h", label: "Deal stale (4+ hours)", description: "When a deal has no activity for over 4 hours" },
    { key: "all_funders_declined", label: "All funders declined", description: "Critical alert when every submitted funder declines" },
    { key: "contract_unsigned_4h", label: "Contract unsigned (4+ hours)", description: "When a contract sent to a merchant isn't signed" },
    { key: "manual_routing_needed", label: "Manual email routing needed", description: "When File Router can't confidently match an email to a deal" },
    { key: "daily_pipeline_summary", label: "Daily pipeline summary", description: "Scheduled overview of all active deals" },
  ];

  const [settings, setSettings] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/integrations")
      .then((r) => r.json())
      .then((data) => {
        const notifConfig = (data.integrations || []).find(
          (i: Record<string, unknown>) => i.name === "Notification Settings"
        );
        if (notifConfig?.config) {
          setSettings(notifConfig.config as Record<string, boolean>);
        } else {
          // Default all on
          const defaults: Record<string, boolean> = {};
          for (const e of NOTIFICATION_EVENTS) defaults[e.key] = true;
          setSettings(defaults);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const toggle = (key: string) => {
    setSettings((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/integrations");
      const data = await res.json();
      const existing = (data.integrations || []).find(
        (i: Record<string, unknown>) => i.name === "Notification Settings"
      );
      if (existing) {
        await fetch("/api/integrations", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: existing.id, config: settings }),
        });
      }
      setMessage("Notification settings saved");
    } catch {
      setMessage("Failed to save");
    }
    setSaving(false);
    setTimeout(() => setMessage(""), 3000);
  };

  if (loading) return <div className="space-y-3">{[1,2,3].map((i) => <div key={i} className="h-14 bg-[rgba(255,255,255,0.03)] rounded-lg animate-pulse" />)}</div>;

  return (
    <div className="max-w-lg">
      <p className="text-sm text-[rgba(255,255,255,0.5)] mb-6">
        Configure which events trigger notifications. These will be sent via Microsoft Teams when the AI agents are active.
      </p>

      {message && (
        <div className="text-sm px-4 py-2 rounded-lg bg-[#00C9A7]/10 text-[#00C9A7] mb-4">{message}</div>
      )}

      <div className="space-y-2 mb-6">
        {NOTIFICATION_EVENTS.map((event) => (
          <div
            key={event.key}
            className="flex items-center justify-between bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-lg px-4 py-3"
          >
            <div>
              <p className="text-sm font-medium text-white">{event.label}</p>
              <p className="text-xs text-[rgba(255,255,255,0.4)] mt-0.5">{event.description}</p>
            </div>
            <button
              onClick={() => toggle(event.key)}
              className={`w-10 h-5 rounded-full transition-colors shrink-0 ml-4 ${settings[event.key] ? "bg-[#00C9A7]" : "bg-[rgba(255,255,255,0.1)]"}`}
            >
              <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform mx-0.5 ${settings[event.key] ? "translate-x-5" : "translate-x-0"}`} />
            </button>
          </div>
        ))}
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="px-4 py-2 bg-[#00C9A7] text-[#0B1426] rounded-lg font-semibold text-sm hover:opacity-90 disabled:opacity-50"
      >
        {saving ? "Saving..." : "Save Notifications"}
      </button>
    </div>
  );
}

function AIConfigTab() {
  const [additionalContext, setAdditionalContext] = useState("");
  const [priorities, setPriorities] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch("/api/integrations")
      .then((r) => r.json())
      .then((data) => {
        const aiConfig = (data.integrations || []).find(
          (i: Record<string, unknown>) => i.name === "AI Configuration"
        );
        if (aiConfig?.config) {
          setAdditionalContext((aiConfig.config as Record<string, string>).additionalContext || "");
          setPriorities((aiConfig.config as Record<string, string>).priorities || "");
        }
      });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      // Find or create AI Configuration integration entry
      const res = await fetch("/api/integrations");
      const data = await res.json();
      let aiConfig = (data.integrations || []).find(
        (i: Record<string, unknown>) => i.name === "AI Configuration"
      );

      if (aiConfig) {
        await fetch("/api/integrations", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: aiConfig.id,
            config: { additionalContext, priorities },
          }),
        });
      }
      setMessage("AI configuration saved");
    } catch {
      setMessage("Failed to save");
    }
    setSaving(false);
  };

  return (
    <div className="max-w-lg space-y-6">
      <div className="flex items-start gap-3 bg-[#F5A623]/10 border border-[#F5A623]/20 rounded-lg p-4">
        <AlertTriangle size={16} className="text-[#F5A623] mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-sm text-[#F5A623] font-medium">API Key Not Configured</p>
          <p className="text-xs text-[rgba(255,255,255,0.5)] mt-1">
            The Anthropic API key is not set. Add it to your environment variables (ANTHROPIC_API_KEY) to enable AI features.
          </p>
        </div>
      </div>

      {message && (
        <div className="text-sm px-4 py-2 rounded-lg bg-[#00C9A7]/10 text-[#00C9A7]">{message}</div>
      )}

      <div>
        <label className="text-xs text-[rgba(255,255,255,0.5)] block mb-1">Additional Context</label>
        <p className="text-[10px] text-[rgba(255,255,255,0.3)] mb-2">Extra text appended to the AI system prompt</p>
        <textarea
          value={additionalContext}
          onChange={(e) => setAdditionalContext(e.target.value)}
          rows={4}
          className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-[#00C9A7] resize-none"
          placeholder="Add context about current focus areas, ongoing deals, etc."
        />
      </div>

      <div>
        <label className="text-xs text-[rgba(255,255,255,0.5)] block mb-1">Current Priorities</label>
        <p className="text-[10px] text-[rgba(255,255,255,0.3)] mb-2">Injected into the AI system prompt as priorities</p>
        <textarea
          value={priorities}
          onChange={(e) => setPriorities(e.target.value)}
          rows={4}
          className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-[#00C9A7] resize-none"
          placeholder="e.g., Focus on closing Q1 deals, onboard 2 new sales reps"
        />
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="px-4 py-2 bg-[#00C9A7] text-[#0B1426] rounded-lg font-semibold text-sm hover:opacity-90 disabled:opacity-50"
      >
        {saving ? "Saving..." : "Save Configuration"}
      </button>
    </div>
  );
}

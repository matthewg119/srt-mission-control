"use client";

interface StatCardProps {
  label: string;
  value: number | string;
  accentColor: string;
  icon?: React.ReactNode;
}

export function StatCard({ label, value, accentColor, icon }: StatCardProps) {
  return (
    <div
      className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-5 card-hover"
      style={{ borderLeftWidth: "3px", borderLeftColor: accentColor }}
    >
      <div className="flex items-center justify-between mb-2">
        {icon && <div className="text-[rgba(255,255,255,0.3)]">{icon}</div>}
      </div>
      <div className="font-mono text-3xl font-bold text-white">{value}</div>
      <div className="text-sm text-[rgba(255,255,255,0.5)] mt-1">{label}</div>
    </div>
  );
}

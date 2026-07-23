import Image from "next/image";

export function ReportHeader({
  businessType,
  city,
  clientName,
  createdAt,
}: {
  businessType: string | null;
  city: string | null;
  clientName: string | null;
  createdAt: string;
}) {
  const date = new Date(createdAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <header className="flex items-center gap-3 border-b border-border-subtle pb-6">
      <Image src="/srt-logo.png" alt="SRT Agency" width={40} height={40} className="rounded shrink-0" />
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wider text-reef">AI Visibility Report</p>
        <h1 className="truncate text-xl font-semibold text-text-primary">
          {clientName || businessType || "Your Business"}
        </h1>
        <p className="text-sm text-text-secondary">
          {[businessType, city].filter(Boolean).join(" · ")} · {date}
        </p>
      </div>
    </header>
  );
}

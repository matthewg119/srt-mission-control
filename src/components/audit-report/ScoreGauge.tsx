export function ScoreGauge({ score, mentioned, total }: { score: number; mentioned: number; total: number }) {
  const radius = 70;
  const strokeWidth = 14;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.max(0, Math.min(100, score)) / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-4 py-4">
      <div className="relative flex items-center justify-center" style={{ width: 180, height: 180 }}>
        <svg width="180" height="180" viewBox="0 0 180 180" className="-rotate-90">
          <circle cx="90" cy="90" r={radius} stroke="rgba(255,255,255,0.08)" strokeWidth={strokeWidth} fill="none" />
          <circle
            cx="90"
            cy="90"
            r={radius}
            stroke="#00C9A7"
            strokeWidth={strokeWidth}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-4xl font-bold text-text-primary">{score}</span>
          <span className="text-xs text-text-secondary">/ 100</span>
        </div>
      </div>
      <p className="text-center text-sm text-text-secondary">
        Appeared in <span className="font-semibold text-text-primary">{mentioned}</span> of {total} buyer questions
      </p>
    </div>
  );
}

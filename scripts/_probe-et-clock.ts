// Read-only proof that the DST guards actually work. Checks both candidate UTC firing hours
// across an EDT date and an EST date, and the Monday-looks-back-to-Friday rule.

import { etWallClock, previousBusinessDayET, etDateKey, isETBusinessDay } from "@/lib/followup-operator/cadence";

function show(label: string, iso: string) {
  const d = new Date(iso);
  const w = etWallClock(d);
  const fires = w.hour === 7 && w.minute >= 20 && w.minute <= 45 && w.weekday >= 1 && w.weekday <= 5;
  console.log(
    `  ${label.padEnd(26)} ${iso}  ->  ET ${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")} wd=${w.weekday}  ${fires ? "FIRES" : "skip"}`
  );
}

console.log("\n7:30am ET nudge cron is \"30 11,12 * * 1-5\". Exactly one firing must act.\n");
console.log("EDT (summer, UTC-4) - Thu 2026-08-20:");
show("11:30 UTC", "2026-08-20T11:30:00Z");
show("12:30 UTC", "2026-08-20T12:30:00Z");
console.log("\nEST (winter, UTC-5) - Thu 2026-01-15:");
show("11:30 UTC", "2026-01-15T11:30:00Z");
show("12:30 UTC", "2026-01-15T12:30:00Z");

console.log("\nprevious business day (nudge selection window):");
for (const iso of [
  "2026-08-17T12:00:00Z", // Monday
  "2026-08-18T12:00:00Z", // Tuesday
  "2026-08-21T12:00:00Z", // Friday
]) {
  const d = new Date(iso);
  const { start, end } = previousBusinessDayET(d);
  const w = etWallClock(d);
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  console.log(`  ${names[w.weekday]} ${etDateKey(d)}  -> window ${etDateKey(start)} (${start.toISOString().slice(11, 16)}Z) .. ${etDateKey(new Date(end.getTime() - 1000))}  businessDay=${isETBusinessDay(d)}`);
}
console.log("");

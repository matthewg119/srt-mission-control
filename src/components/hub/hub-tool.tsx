"use client";

// The interactive assets a tool page renders, and the one switch that resolves a key to one.
//
// ‼️ CLIENT COMPONENTS, INSIDE A SERVER-RENDERED PAGE. The page around them is still ISR at
// five minutes, still crawlable, still carries its own JSON-LD. Only the widget hydrates.
//
// ‼️ NOTHING HERE FETCHES, STORES OR ASKS FOR ANYTHING. No network call, no localStorage, no
// email gate. A tool that asks for an address before it answers is a form, and the `tool`
// format refuses one in as many words: "a result that cannot be produced without asking for
// a name or an email". The whole point of the asset is that it is useful before anybody has
// decided to trust us.
//
// ‼️ THE LIMITS LINE IS RENDERED BY THE FRAME, NOT BY EACH TOOL, so it cannot be forgotten by
// whoever writes the next one. An estimate with no stated limits is one a reader takes for a
// quote.

import { useMemo, useState } from "react";
import { getToolComponent } from "@/config/tool-components";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="hub-tool-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

/** How many working days from a date. Weekends out; holidays deliberately unknown. */
function BusinessDays() {
  const today = new Date().toISOString().slice(0, 10);
  const [start, setStart] = useState(today);
  const [days, setDays] = useState("10");

  const result = useMemo(() => {
    const n = Number.parseInt(days, 10);
    const from = new Date(`${start}T00:00:00`);
    if (!Number.isFinite(n) || n < 0 || Number.isNaN(from.getTime())) return null;

    const d = new Date(from);
    let left = n;
    // Counts forward one day at a time rather than by arithmetic on weeks. Slower and
    // obviously correct, which is the right trade for something a person checks by hand.
    while (left > 0) {
      d.setDate(d.getDate() + 1);
      const day = d.getDay();
      if (day !== 0 && day !== 6) left--;
    }
    return d;
  }, [start, days]);

  return (
    <div className="hub-tool">
      <div className="hub-tool-inputs">
        <Field label="Starting on">
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="Working days">
          <input
            type="number"
            min={0}
            max={365}
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
        </Field>
      </div>
      <p className="hub-tool-result">
        {result ? (
          <>
            <strong>
              {result.toLocaleDateString(undefined, {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </strong>
          </>
        ) : (
          <span className="hub-tool-muted">Enter a date and a number of working days.</span>
        )}
      </p>
    </div>
  );
}

/** How many whole sessions a budget covers, and what is left. */
function SessionsToBudget() {
  const [price, setPrice] = useState("");
  const [budget, setBudget] = useState("");

  const result = useMemo(() => {
    const p = Number.parseFloat(price);
    const b = Number.parseFloat(budget);
    if (!Number.isFinite(p) || !Number.isFinite(b) || p <= 0 || b < 0) return null;
    const whole = Math.floor(b / p);
    return { whole, left: b - whole * p };
  }, [price, budget]);

  const money = (n: number) => n.toFixed(2).replace(/\.00$/, "");

  return (
    <div className="hub-tool">
      <div className="hub-tool-inputs">
        <Field label="One session costs">
          <input
            type="number"
            min={0}
            step="1"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </Field>
        <Field label="You have to spend">
          <input
            type="number"
            min={0}
            step="1"
            inputMode="decimal"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
          />
        </Field>
      </div>
      <p className="hub-tool-result">
        {result ? (
          <>
            <strong>
              {result.whole} session{result.whole === 1 ? "" : "s"}
            </strong>
            {result.left > 0 ? (
              <span className="hub-tool-muted"> with {money(result.left)} left over</span>
            ) : null}
          </>
        ) : (
          <span className="hub-tool-muted">Enter a price and a budget.</span>
        )}
      </p>
    </div>
  );
}

/**
 * Resolve a component_key to its asset.
 *
 * ‼️ AN UNKNOWN KEY RENDERS NOTHING, AND THAT IS THE DESIGN. A page whose tool is missing is a
 * visible, fixable state. Rendering a placeholder, or falling back to some other tool, would
 * put something on a client's live domain that nobody chose.
 */
export function HubTool({ componentKey }: { componentKey: string }) {
  const spec = getToolComponent(componentKey);
  if (!spec) return null;

  const body =
    componentKey === "business-days" ? (
      <BusinessDays />
    ) : componentKey === "sessions-to-budget" ? (
      <SessionsToBudget />
    ) : null;

  if (!body) return null;

  return (
    <section className="hub-tool-frame" aria-label={spec.label}>
      {body}
      {/* Rendered by the frame so no tool can ship without it. */}
      <p className="hub-tool-limits">{spec.limits}</p>
    </section>
  );
}

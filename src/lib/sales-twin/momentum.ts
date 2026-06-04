// MOMENTUM ENGINE — pure logic, no side effects.
// State persists in st_momentum_state (Supabase); the kiosk subscribes via Realtime.

export type MomentumState = "RED" | "GREEN";

export interface MomentumSnapshot {
  current_state: MomentumState;
  entered_at: string;
  last_connect_at: string | null;
  consecutive_connects: number;
  window_started_at: string | null;
  green_expires_at: string | null;
  active_queue: "cold" | "warm";
  updated_at?: string;
}

export interface MomentumConfig {
  required_connects: number; // default 3
  window_minutes: number; // default 8
  green_duration_minutes: number; // default 15
}

export function evaluateConnect(
  snapshot: MomentumSnapshot,
  config: MomentumConfig,
  windowConnectTimes: Date[], // timestamps of all connects within the current window
  now: Date = new Date()
): {
  nextSnapshot: MomentumSnapshot;
  didFlipToGreen: boolean;
  didExtendGreen: boolean;
} {
  const windowMs = config.window_minutes * 60 * 1000;
  const cutoff = new Date(now.getTime() - windowMs);

  // Count connects within the window
  const inWindow = windowConnectTimes.filter((t) => t > cutoff);
  const count = inWindow.length;

  if (snapshot.current_state === "GREEN") {
    // Extend green window
    const newExpiry = new Date(
      now.getTime() + config.green_duration_minutes * 60 * 1000
    );
    return {
      nextSnapshot: {
        ...snapshot,
        last_connect_at: now.toISOString(),
        consecutive_connects: count,
        green_expires_at: newExpiry.toISOString(),
        updated_at: now.toISOString(),
      },
      didFlipToGreen: false,
      didExtendGreen: true,
    };
  }

  // RED state — check if threshold met
  if (count >= config.required_connects) {
    const greenExpiry = new Date(
      now.getTime() + config.green_duration_minutes * 60 * 1000
    );
    return {
      nextSnapshot: {
        current_state: "GREEN",
        entered_at: now.toISOString(),
        last_connect_at: now.toISOString(),
        consecutive_connects: count,
        window_started_at: inWindow[0]?.toISOString() || now.toISOString(),
        green_expires_at: greenExpiry.toISOString(),
        active_queue: "warm",
      },
      didFlipToGreen: true,
      didExtendGreen: false,
    };
  }

  return {
    nextSnapshot: {
      ...snapshot,
      last_connect_at: now.toISOString(),
      consecutive_connects: count,
      window_started_at: inWindow[0]?.toISOString() || now.toISOString(),
    },
    didFlipToGreen: false,
    didExtendGreen: false,
  };
}

export function evaluateWindowExpired(
  snapshot: MomentumSnapshot,
  now: Date = new Date()
): MomentumSnapshot {
  if (snapshot.current_state === "RED") return snapshot;
  return {
    current_state: "RED",
    entered_at: now.toISOString(),
    last_connect_at: snapshot.last_connect_at,
    consecutive_connects: 0,
    window_started_at: null,
    green_expires_at: null,
    active_queue: "cold",
  };
}

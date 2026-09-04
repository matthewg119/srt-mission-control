// Which of the two lanes a newly provisioned client's widget speaks from.
//
// ‼️ THIS PROPOSES. IT DOES NOT DECIDE, AND THE DISTINCTION IS THE WHOLE FILE.
//
// docs/2026-09-03-concierge-audience.sql says, in capitals, "AND THE COLUMN IS EXPLICIT, NEVER
// DERIVED FROM vertical", because reading the audience off a classifier's free text would mean
// that the day a second AEO agency onboards, their patients start getting pitched on booking a
// call with us. That rule holds and is not being loosened here.
//
// What it bans is deriving at READ time. conciergeTenant() still reads an explicit column and
// nothing downstream of it ever consults a vertical to work out who is being spoken to. What this
// adds is a SEED: provisioning proposes a value, a person ratifies it on the step card, and
// concierge_configs.audience_confirmed_at records that they did. That is CONTRACT.md's "the tool
// proposes, a person confirms", the same shape as clients.primary_avatar, and until somebody
// confirms, the concierge_live verifier refuses to turn the widget on.
//
// The alternative was what shipped: no writer at all, so every client fell to the column default
// 'patient' and SRT was 'owner' only because a migration updated one row by hand. A silent default
// there is the wrong bot on a client's live site.
//
// ‼️ A CLOSED ALLOWLIST, NOT A HEURISTIC. No regex over free text, no substring match on "agency".
// A vertical this map has never seen is `unambiguous: false`, which is the card asking rather than
// the code guessing. Adding a key here is a deliberate act by somebody who knows what that vertical
// means; matching "agency" loosely would silently claim every marketing client that ever onboards.

import type { Audience } from "./magnets";

/**
 * The verticals whose audience is not in question.
 *
 * Keys are what `verticalFor()` returns, which is `clients.vertical_slug` and then
 * `clients.business_type` behind it. Both are kebab-case free text written by classify.ts, so the
 * lookup is lowercased and trimmed before it gets here.
 *
 * Only the owner lane is listed. Everything absent proposes `patient`, which is the safe direction:
 * a patient bot on an agency's site offers a skin scan nobody wants, while an owner bot on a
 * clinic's site pitches their patients on hiring an AEO agency.
 */
const OWNER_VERTICALS: Readonly<Record<string, Audience>> = {
  "aeo-agency": "owner",
  "aeo-agency-med-spa": "owner",
  "aeo-marketing-agency": "owner",
};

export interface AudienceProposal {
  audience: Audience;
  /**
   * True only when this vertical is named in the map above.
   *
   * False is not an error and is not a weak yes. It means nobody has said what this vertical is,
   * so `patient` is a placeholder standing in until a person presses a button, and the card says
   * so out loud rather than showing a decision that was never made.
   */
  unambiguous: boolean;
  /** Said in words, because it goes straight onto the step card. */
  reason: string;
}

/**
 * What to seed `concierge_configs.audience` with, and whether anybody should be asked.
 *
 * Pure and database free, so scripts/_probe-magnet-drafts.ts proves the whole mapping offline with
 * no model and no rows, the same way rungOf() is proved in magnets.ts.
 *
 * The caller passes the vertical from `verticalFor(clientId)` in clients/harvest.ts, which walks
 * vertical_slug then business_type and REFUSES rather than guessing. Its `{ ok: false }` arrives
 * here as `null`, which is the ambiguous case and not a failure.
 */
export function proposeAudience(vertical: string | null): AudienceProposal {
  const key = (vertical ?? "").trim().toLowerCase();

  if (!key) {
    return {
      audience: "patient",
      unambiguous: false,
      reason:
        "This client has no vertical on file, so nothing here says who the widget is talking to. " +
        "It is seeded as patient, which is a placeholder and not a reading.",
    };
  }

  const named = OWNER_VERTICALS[key];
  if (named) {
    return {
      audience: named,
      unambiguous: true,
      reason: `\`${key}\` is a business we sell TO, so the widget speaks to an owner.`,
    };
  }

  return {
    audience: "patient",
    unambiguous: false,
    reason:
      `\`${key}\` is not one of the verticals whose audience has been written down, so it is ` +
      `seeded as patient. That is the safe direction, not a measurement: confirm it below.`,
  };
}

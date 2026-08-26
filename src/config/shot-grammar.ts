// Shot grammar - the variety engine for every generated image prompt.
//
// The problem this replaces: each lane prepended ONE fixed look string to every
// prompt (`vertical.style_token` in broll-suggestions, `style_dna ?? style_token`
// in hook-studio) and let the model pick a subject from a short hardcoded menu.
// Same grade, same lens, same twelve scenes, forever - three "different" images
// came back as one photo in three crops.
//
// The inversion: CODE deals a distinct combination of photographic axes per image
// and the model only writes the scene sentence inside that constraint. Subjects
// come from a 120-entry library, so a channel can run for weeks without repeating
// a setup. `dealShots` refuses anything used recently (LRU per axis, widest on
// subject) and never repeats a value inside one deal.
//
// Realism is the second job. Generated B-roll reads as AI because it is too clean:
// perfect symmetry, dust motes in a god ray, teal-and-orange. REALISM_TAIL and
// AI_TELL_BAN ship on every prompt to fight exactly that.
//
// RECOGNITION is the third, and it is the one this file got wrong until 2026-08-26.
// Every drop was a technically excellent photograph of a place the viewer did not
// recognise: a gym parking lot at dawn, a floor scale against a wall, magazines on a
// lobby table, and nobody in any of them. A med spa owner scrolling past learns nothing
// about who the video is for. Two rules now hold, and they hold on every prompt:
//   1. The location is the avatar's own business (owner-lane SUBJECTS are all inside the
//      clinic now, and shotGuards takes the avatar's setting law).
//   2. Someone is always in frame and always mid-task (the PRESENCE axis lost its
//      "Nobody in frame" value, and PERSON_LAW says it again in words).
// What is still banned is performing for the camera, not being visible - see
// CAMERA_AWARE_BAN.

export type ShotLane = "owner" | "treatment";

export interface AxisEntry {
  key: string;
  /** The prompt fragment, written to drop straight into a sentence. */
  text: string;
  /** Relative odds when dealing. Default 1. */
  weight?: number;
}

export interface SubjectEntry extends AxisEntry {
  lane: ShotLane;
}

/** The five HOW axes. A lane that brings its own subject (hook studio, storyboards) deals
 *  one of these; the B-roll lane deals a full ShotSpec on top of it. */
export interface LookSpec {
  capture: AxisEntry;
  light: AxisEntry;
  grade: AxisEntry;
  framing: AxisEntry;
  presence: AxisEntry;
}

export interface ShotSpec extends LookSpec {
  subject: SubjectEntry;
}

/** Recently-used keys per axis, most-recent-first (read from `broll_drops`). */
export interface RecentShots {
  subject?: string[];
  capture?: string[];
  light?: string[];
  grade?: string[];
  framing?: string[];
  presence?: string[];
}

// ---- the axes ---------------------------------------------------------------------------

// HOW the frame was captured. This is the axis that does the most work against the
// "everything is a cinematic 35mm still" sameness.
export const CAPTURE: AxisEntry[] = [
  { key: "phone_handheld", text: "Shot handheld on a phone, slight tilt, nothing straightened" },
  { key: "phone_flash", text: "Shot on a phone with the on-camera flash, harsh foreground falloff" },
  { key: "security_cam", text: "A security-camera still, wide angle, mild barrel distortion, slightly soft" },
  { key: "counter_edge", text: "Shot from behind the reception counter, the counter edge cutting the bottom of the frame" },
  { key: "doc_photo", text: "A printed page photographed on a desk at a slight angle, one corner lifting" },
  { key: "screen_offshot", text: "A monitor photographed off the screen, faint moire and a reflection in the glass" },
  { key: "reflection", text: "Shot through glass so the reflection doubles over what is behind it" },
  { key: "long_lens", text: "Shot on a long lens from the far end of the room, compressed and slightly grainy" },
  { key: "overhead_phone", text: "A phone held straight down over the surface, flat lay, hand shadow at the edge" },
  { key: "disposable", text: "A disposable-camera frame, heavy grain, blown highlights" },
  { key: "tripod_wide", text: "A locked-off wide on a tripod, level and patient" },
  { key: "through_doorway", text: "Shot from a hallway through an open doorway, the door frame cutting the edges" },
  { key: "over_shoulder", text: "An over-the-shoulder crop, the near shoulder out of focus and dark" },
  { key: "photo_of_photo", text: "A photograph of a printed photograph pinned to a board, edges curling" },
];

export const LIGHT: AxisEntry[] = [
  { key: "overcast", text: "Flat overcast daylight, no visible shadow direction" },
  { key: "hard_noon", text: "Hard midday sun, black-edged shadows, blown highlights" },
  { key: "sodium_lot", text: "Orange parking-lot light coming through the front glass after dark" },
  { key: "one_tube", text: "A single fluorescent tube overhead, everything else falling off" },
  { key: "screen_only", text: "Lit only by a screen, the rest of the room unlit" },
  { key: "headlights", text: "Headlights raking through the front glass, moving highlights" },
  { key: "blue_hour_blinds", text: "Blue-hour light through half-closed blinds" },
  { key: "mixed_wb", text: "A warm lamp fighting cool daylight, two color temperatures in one frame" },
  { key: "direct_flash", text: "Direct flash, flat and unflattering, hard shadow on the wall behind" },
  { key: "windshield_sun", text: "Low sun through the front window, glare across the glass" },
  { key: "led_panel", text: "A clinical LED panel directly overhead, even and shadowless" },
  { key: "backlit_window", text: "Backlit by a window that blows out completely behind the subject" },
];

// Color treatment. The old locked look survives as ONE of ten, no longer the law.
export const GRADE: AxisEntry[] = [
  { key: "uncorrected", text: "Uncorrected phone color, not graded" },
  { key: "clinical_white", text: "Slightly overexposed clinical white, near-blown walls" },
  { key: "warm_domestic", text: "Warm domestic color, slightly yellow" },
  { key: "cold_office", text: "Cold blue-green office color" },
  { key: "flash_contrast", text: "High-contrast flash color, saturated and hard" },
  { key: "faded", text: "Faded and washed out, low saturation, lifted blacks" },
  { key: "sodium_orange", text: "Heavy sodium orange, almost monochrome" },
  { key: "muted_film", text: "Muted 35mm film color, fine grain" },
  { key: "green_fluoro", text: "A green fluorescent cast nobody corrected" },
  { key: "crushed_black", text: "Crushed blacks, most of the frame reading as shadow" },
];

export const FRAMING: AxisEntry[] = [
  { key: "macro", text: "Macro detail, filling the frame" },
  { key: "closeup", text: "Close-up" },
  { key: "mid", text: "Mid shot" },
  { key: "wide", text: "Wide shot with room around the subject" },
  { key: "corner_wide", text: "Ultra-wide from a room corner, walls converging" },
  { key: "compressed", text: "Long-lens compression, background stacked flat" },
  { key: "overhead", text: "Directly overhead" },
  { key: "low_waist", text: "Low angle from about waist height" },
];

// WHO is working in the frame. This axis USED to carry "Nobody in frame" at triple weight,
// and that one value is what produced the back catalogue Matthew rejected on 2026-08-26:
// well-composed empty parking lots and lobby tables that say nothing about who the video is
// for. There is no empty option any more - every frame has a person in it and that person is
// always mid-task. Roles are written role-neutral ("the owner", "a staff member") because
// Hook Studio deals these looks for every avatar, not only the clinic.
export const PRESENCE: AxisEntry[] = [
  { key: "owner_back", text: "The owner is in frame working, seen from behind or over her shoulder", weight: 2 },
  { key: "owner_profile", text: "The owner is in frame in three-quarter profile, mid-task, unaware of the camera", weight: 2 },
  { key: "owner_hands", text: "The owner's hands only, mid-task, cropped at the wrist by the frame edge" },
  { key: "staff_edge", text: "A staff member working at the edge of frame, face turned away" },
  { key: "gloved_hands", text: "Gloved hands working at the edge of frame, the rest of the person cut off" },
  { key: "staff_cross", text: "A staff member crossing the frame mid-stride, motion-blurred past recognition" },
  { key: "client_leaving", text: "A client being walked toward the door, seen from behind" },
  { key: "reflected_worker", text: "Someone working, seen only as a reflection in glass or a screen" },
  { key: "silhouette_work", text: "A silhouette working behind frosted glass or a half-open door" },
];

// ---- the subject library ----------------------------------------------------------------

type SubjectSeed = [string, string];

function lane(seeds: SubjectSeed[], laneId: ShotLane): SubjectEntry[] {
  return seeds.map(([key, text]) => ({ key, text, lane: laneId }));
}

// `owner` - the avatar's own side of HER OWN CLINIC. Every subject here is inside the med spa
// or standing at its own door: front desk, lobby, back office, retail wall, back room,
// hallway, its own lot. That is the whole change of 2026-08-26. The old library wandered to
// kitchen islands, gas pumps, school pickup lines and a gym parking lot at dawn - technically
// "the owner's world", and the drops it produced were unrecognisable to a med spa owner, which
// is the only test that matters. If a subject could be photographed at any small business in
// America, it does not belong in this list.
//
// This lane feeds the daily b-roll drop only (dealShots is called from broll-suggestions.ts,
// which runs for drop_mode "broll_suggestions" - the clinic channel). Adding a second
// broll_suggestions avatar means splitting this lane by vertical first.
const OWNER_SUBJECTS: SubjectEntry[] = lane(
  [
    // the front desk
    ["front_desk_phone", "the reception phone on a med spa front desk, not ringing"],
    ["booking_screen", "the booking calendar open on a med spa front-desk monitor, the day mostly white space"],
    ["checkin_tablet", "the check-in tablet on its stand at a med spa reception counter"],
    ["card_reader", "the card reader on a med spa checkout counter"],
    ["receipt_tape", "a curl of receipt tape left on a med spa checkout counter"],
    ["intake_clipboard", "a clipboard of blank intake forms on a med spa reception desk"],
    ["treatment_menu", "a laminated treatment menu on a med spa reception counter, curling at one corner"],
    ["gift_cards", "a rack of gift cards on a med spa reception counter"],
    ["keys_counter", "a ring of keys dropped on a med spa front counter at close"],
    ["headset_desk", "a headset resting across the keyboard at a med spa front desk"],
    ["sticky_notes", "a med spa front-desk monitor, its bezel crowded with sticky notes"],
    ["pen_cup", "a cup of pens on a med spa front counter, one missing its cap"],
    ["reception_mirror", "the mirror behind a med spa reception desk"],
    ["cancel_texts", "a phone on a med spa front desk showing a cancellation text thread, the words too small to read"],
    // the lobby
    ["lobby_chairs", "the waiting chairs in a med spa lobby, seen from the front desk"],
    ["magazines", "magazines fanned on a med spa lobby table, one cover curled"],
    ["water_station", "the water and cucumber station in a med spa lobby"],
    ["plant_dry", "a potted plant going dry in a med spa lobby corner"],
    ["clock_wall", "a wall clock in a med spa lobby in late afternoon light"],
    ["diploma_wall", "framed injector certifications on a med spa lobby wall, the glass reflecting a window"],
    ["retail_shelf_front", "the retail shelf of serums behind a med spa front desk, labels out of focus"],
    ["before_after_wall", "a wall of framed clinic photography in a med spa lobby, the images out of focus"],
    // the doors and the street directly outside
    ["clinic_front_door", "the front door of a med spa seen from inside, the street beyond it"],
    ["door_hours", "the vinyl business hours on a med spa glass front door, shot from inside"],
    ["open_sign", "an OPEN sign hanging in a med spa front window"],
    ["window_decal", "the clinic window decal peeling at one corner, shot from inside the med spa"],
    ["suite_sign", "the strip-mall suite sign outside a med spa, six tenants listed"],
    ["sidewalk_sign", "an A-frame sign on the sidewalk directly outside a med spa"],
    ["clinic_lot_morning", "the med spa's own parking lot at seven in the morning with one car in it"],
    ["rival_across", "a rival clinic storefront seen from inside the med spa front window, its lot full"],
    ["mail_under_door", "a pile of mail wedged under a med spa glass front door"],
    // the back office
    ["back_office_desk", "the owner's back-office desk in a med spa, a laptop and paperwork on it"],
    ["agency_invoices", "a stack of unopened marketing agency invoices on a med spa back-office desk"],
    ["ai_answer_rivals", "a laptop on a med spa desk showing an AI answer that lists three other clinics"],
    ["phone_search", "a phone held over a med spa reception counter with a search open on it"],
    ["dashboard_monitor", "a marketing dashboard on a med spa back-office monitor, every number out of focus"],
    ["review_printout", "a printed page of clinic reviews on a med spa desk, one circled in pen"],
    ["whiteboard_goals", "a whiteboard of monthly goals in a med spa back office, half erased"],
    ["calculator", "a calculator sitting on a printed spreadsheet on a med spa back-office desk"],
    ["notebook_list", "a spiral notebook of handwritten to-dos on a med spa front desk, the writing illegible"],
    ["filing_drawer", "an open filing drawer of client charts in a med spa back office"],
    ["printer_tray", "a printer mid-job in a med spa back office, paper stacked in the tray"],
    ["shredder", "a shredder bin full of paper strips in a med spa back office"],
    ["wifi_router", "a router and tangled cables on a shelf in a med spa back office"],
    ["loan_statement", "a printed equipment loan statement on a med spa desk, the numbers too small to read"],
    // the back of house
    ["product_cartons", "unopened product cartons stacked in a med spa back room"],
    ["product_lockbox", "a small lockbox of injectable cartons in a med spa back room"],
    ["vial_fridge", "a small refrigerator of product vials in a med spa back room"],
    ["supply_shelf", "a med spa supply shelf, boxes of gloves and gauze stacked unevenly"],
    ["breakroom", "the break room of a med spa, one chair pulled out"],
    ["scrubs_hook", "folded scrubs on a hook behind a med spa back door"],
    ["badge_lanyard", "a clinic badge on a lanyard hanging by a med spa back door"],
    ["stool_alone", "a rolling stool in the middle of a lit med spa treatment room"],
    ["hallway_doors", "the back hallway of a med spa, treatment room doors along it"],
    ["light_switches", "the bank of light switches inside a med spa back door, only the first one flipped up"],
    ["alarm_panel", "the security keypad beside a med spa back door"],
    ["trash_bags", "trash bags set by a med spa back door at closing"],
    ["consult_table", "a consult room table in a med spa with a brochure and a pen on it"],
  ],
  "owner"
);

// `treatment` - the room itself. Used when the belief needs identity resonance or a
// direct their-chair-is-full contrast. The old lane had one idea (gloved hand, syringe,
// a woman's face) and shot it three times; this is the fix.
const TREATMENT_SUBJECTS: SubjectEntry[] = lane(
  [
    ["syringe_tray", "a single capped syringe lying on a stainless tray"],
    ["client_chair_doorway", "a client reclined in the treatment chair seen from the doorway, head turned away"],
    ["massage_overhead", "a massage in progress from directly above, only hands and a shoulder in frame"],
    ["facial_mask", "a cooling mask being lifted at the edge of frame"],
    ["laser_cradle", "a laser handpiece resting in its cradle"],
    ["microneedling", "a microneedling pen mid-pass, extreme close, only skin texture"],
    ["hydrafacial_wand", "a hydrafacial wand and its coiled tubing"],
    ["vial_load", "a gloved hand drawing from a small vial"],
    ["mirror_check", "the aftercare mirror on a counter with the room reflected in it"],
    ["checkout", "a med spa front-desk checkout, a card going into a reader"],
    ["robe_hook", "a robe on a hook in a med spa changing corner"],
    ["injectable_box", "a foil-wrapped carton on a counter beside a skin marker"],
    ["sharps", "a sharps container mounted on a treatment room wall"],
    ["towel_warmer", "an open towel warmer with steam coming off the stack"],
    ["consult_clipboard", "a consult sheet on a clipboard, the handwriting illegible"],
    ["bed_repaper", "a treatment bed being re-papered, the roll pulled halfway"],
    ["gauze_tray", "gauze, alcohol pads and a marker laid out on a tray"],
    ["ice_roller", "an ice roller resting on a folded towel"],
    ["led_mask", "an LED face mask glowing on its stand"],
    ["cryo_tank", "a small cryo tank standing in a treatment room corner"],
    ["wax_pot", "a wax pot warming with a spatula resting across it"],
    ["lash_tray", "a lash tray and tweezers under a task lamp"],
    ["glove_box", "a glove box mounted by a treatment room door with one glove half pulled out"],
    ["sanitizer", "a sanitizer pump on a treatment room counter catching the light"],
    ["skin_marker_dots", "marking dots drawn on a cheek, extreme macro, no full face in frame"],
    ["numbing_cream", "a tube of numbing cream and a wooden depressor"],
    ["chair_controls", "the foot pedal and chair controls under a treatment bed"],
    ["armrest", "a forearm resting on a treatment armrest, cropped at the elbow"],
    ["hair_cap", "a disposable cap hanging on a treatment room hook"],
    ["magnifier_lamp", "a magnifier lamp swung out over an empty bed"],
    ["retail_shelf", "a med spa retail shelf of serums with the labels out of focus"],
    ["sample_jars", "small sample jars lined up on a med spa retail shelf"],
    ["tint_bowl", "a tint bowl and brush on a rolling cart"],
    ["steamer", "a facial steamer running toward an empty bed"],
    ["instrument_cart", "a rolling cart of instruments beside a treatment bed"],
    ["uv_cabinet", "a sterilizer cabinet with the door ajar"],
    ["towel_cart", "a cart of folded white towels in a med spa hallway"],
    ["laundry_bin", "a bin of used towels beside a med spa back door"],
    ["timer", "a timer counting down on a treatment room counter"],
    ["speaker_phone", "a small speaker and a phone playing music on a treatment room shelf"],
    ["candle", "a candle burning on a treatment room windowsill"],
    ["privacy_curtain", "a privacy curtain drawn halfway"],
    ["blanket_fold", "a folded blanket at the foot of a treatment bed"],
    ["slippers", "disposable slippers on the floor beside a bed"],
    ["water_glass", "a glass of water with a straw on a treatment room side table"],
    ["photo_backdrop", "a photo light and a plain backdrop set up in a treatment room corner"],
    ["ring_light", "a ring light on a stand in a treatment room, facing a stool"],
    ["tablet_consent", "a tablet showing a consent form with a stylus resting on it"],
    ["appointment_card", "a printed appointment card left on a med spa counter"],
    ["aftercare_sheet", "an aftercare sheet folded on a pillow"],
    ["headband", "a spa headband on a folded towel"],
    ["cotton_rounds", "cotton rounds and a toner bottle on a tray"],
    ["gua_sha", "a gua sha stone and an oil bottle on a treatment room counter"],
    ["contour_paddles", "body-contouring paddles laid out on a treatment bed"],
    ["compression_wrap", "a compression wrap coiled on a treatment room shelf"],
    ["scale_tape", "a body-composition scale and a tape measure in a med spa treatment room"],
    ["iv_bag", "an IV bag hanging on a pole beside a med spa drip lounge chair"],
    ["iv_arm", "a taped IV line on a forearm, cropped above the elbow"],
    ["drip_lounge", "a row of med spa drip lounge chairs with one blanket left behind"],
    ["back_hallway", "a med spa back hallway of treatment room doors with one standing open"],
  ],
  "treatment"
);

export const SUBJECTS: SubjectEntry[] = [...OWNER_SUBJECTS, ...TREATMENT_SUBJECTS];

export function subjectsFor(laneId: ShotLane): SubjectEntry[] {
  return SUBJECTS.filter((s) => s.lane === laneId);
}

// ---- the guards -------------------------------------------------------------------------

// What makes a frame read as photographed rather than rendered.
export const REALISM_TAIL =
  "Imperfect framing: the subject slightly off-center and something cut off by the frame edge. " +
  "Real clutter, wear, fingerprints and scuffs. Visible sensor noise in the shadows. " +
  "Mixed white balance. No perfect symmetry.";

// The tells in our own back catalogue. Named explicitly because a model will produce
// every one of them by default when asked for "cinematic".
export const AI_TELL_BAN =
  "Do not produce: dust motes floating in a light beam, god rays, teal-and-orange grading, " +
  "glowing UI panels floating in dark space, lens flares, glossy stock-photo polish, " +
  "cinematic haze, or a flawlessly tidy symmetrical room.";

// What the frame may NOT do with the person in it. This used to be a blanket face ban, and
// together with the "Nobody in frame" presence value it is what emptied every room. The line
// that actually matters is not "no faces" but "nobody performing for a camera": a real worker
// caught mid-task reads as photographed, a model looking down the lens reads as stock.
export const CAMERA_AWARE_BAN =
  "Nobody looks into the camera, poses for it, or smiles for it. No stock-photo models, no headshots, " +
  "no staged team portrait. A working face may sit in frame turned away, in profile or three-quarter, " +
  "or be cut by the frame edge; the work is the subject, never the person.";

// The half of the 2026-08-26 correction that the presence axis cannot enforce on its own: a
// dealt presence value can still come back as a beautifully composed room with a hand somewhere
// in the corner. Stated as its own sentence so it survives a model that skims.
export const PERSON_LAW =
  "Someone is always in this frame and always mid-task, doing real work in this business. Never an empty room.";

/**
 * The closing guards every image prompt ends with (scene 1 of a Hook Studio video excepted -
 * see hookGuards). `settingLaw` is the avatar's own location contract, passed in rather than
 * hardcoded because Hook Studio deals these guards for every vertical, and "the location is
 * always the med spa" is true of exactly one of them. The avatar's `image_negative` is folded
 * in, but skipped when it only restates CAMERA_AWARE_BAN.
 */
export function shotGuards(extraNegative?: string, settingLaw?: string | null): string {
  const trimmed = (extraNegative ?? "").trim().replace(/[.\s]+$/, "");
  const duplicate = !trimmed || CAMERA_AWARE_BAN.toLowerCase().includes(trimmed.toLowerCase());
  const extra = duplicate ? "" : `${trimmed}. `;
  const setting = (settingLaw ?? "").trim();
  const where = setting ? `${setting.replace(/[.\s]+$/, "")}. ` : "";
  return `${where}${PERSON_LAW} ${REALISM_TAIL} ${AI_TELL_BAN} ${CAMERA_AWARE_BAN} ${extra}No on-screen text, logos, or watermarks in the image. 9:16 vertical.`;
}

// ---- rendering --------------------------------------------------------------------------

/**
 * The look sentence for one dealt shot, WITHOUT the subject. Replaces the single fixed
 * `style_token` / `style_dna` string at call sites that already carry their own action.
 */
export function renderLookLine(spec: LookSpec): string {
  return [
    `${spec.capture.text}.`,
    `${spec.framing.text}.`,
    `${spec.light.text}.`,
    `${spec.grade.text}.`,
    `${spec.presence.text}.`,
  ].join(" ");
}

/** The full brief including the dealt subject, handed to the generator as a constraint. */
export function renderShotBrief(spec: ShotSpec): string {
  return `Subject: ${spec.subject.text}. ${renderLookLine(spec)}`;
}

/** A short human label for the Slack card, so the operator can see the spread at a glance. */
export function shotLabel(spec: ShotSpec): string {
  return [spec.subject.key, spec.capture.key, spec.light.key, spec.grade.key, spec.framing.key, spec.presence.key].join(" / ");
}

/** The axis keys to log so the next deal can avoid them. */
export function shotKeys(spec: ShotSpec): Record<string, string> {
  return {
    subject_key: spec.subject.key,
    capture_key: spec.capture.key,
    light_key: spec.light.key,
    grade_key: spec.grade.key,
    framing_key: spec.framing.key,
    presence_key: spec.presence.key,
    lane: spec.subject.lane,
  };
}

// ---- the dealer -------------------------------------------------------------------------

// How far back each axis WANTS to remember. Subject is widest because a repeated subject is
// the repetition a human actually notices; framing/presence are narrow because there are
// only so many ways to point a camera.
const WINDOW: Record<keyof RecentShots, number> = {
  subject: 30,
  capture: 8,
  light: 8,
  grade: 8,
  framing: 5,
  presence: 4,
};

// How many entries each axis actually has. `subject` counts one lane, not the whole library,
// because a deal only ever draws from one lane at a time.
const AXIS_SIZE: Record<keyof RecentShots, number> = {
  subject: Math.min(subjectsFor("owner").length, subjectsFor("treatment").length),
  capture: CAPTURE.length,
  light: LIGHT.length,
  grade: GRADE.length,
  framing: FRAMING.length,
  presence: PRESENCE.length,
};

/**
 * The window an axis can actually honor. A 10-entry axis drawing 3 per deal cannot exclude
 * the last 8 and still have three distinct values left, so asking for that just pushes every
 * deal into the fallback and repeats anyway. Clamping keeps the promise honest and adjusts
 * on its own when entries are added to an axis.
 */
export function effectiveWindow(axis: keyof RecentShots, dealSize: number): number {
  return Math.max(0, Math.min(WINDOW[axis], AXIS_SIZE[axis] - dealSize - 1));
}

function weightedPick<T extends AxisEntry>(pool: T[]): T {
  const total = pool.reduce((sum, e) => sum + (e.weight ?? 1), 0);
  let r = Math.random() * total;
  for (const e of pool) {
    r -= e.weight ?? 1;
    if (r <= 0) return e;
  }
  return pool[pool.length - 1];
}

/**
 * Pick one entry that is neither in the recent window nor already used in this deal.
 * Falls back progressively (drop the window, then drop the deal guard) so a small axis
 * with a long history still returns something instead of throwing.
 */
function pickAxis<T extends AxisEntry>(
  entries: T[],
  recent: string[] | undefined,
  window: number,
  usedInDeal: Set<string>
): T {
  const blocked = new Set((recent ?? []).slice(0, window));
  const fresh = entries.filter((e) => !blocked.has(e.key) && !usedInDeal.has(e.key));
  if (fresh.length) return weightedPick(fresh);
  const unusedHere = entries.filter((e) => !usedInDeal.has(e.key));
  return weightedPick(unusedHere.length ? unusedHere : entries);
}

function emptyUsed(): Record<keyof RecentShots, Set<string>> {
  return {
    subject: new Set(),
    capture: new Set(),
    light: new Set(),
    grade: new Set(),
    framing: new Set(),
    presence: new Set(),
  };
}

function dealLook(
  recent: RecentShots,
  used: Record<keyof RecentShots, Set<string>>,
  dealSize: number
): LookSpec {
  const w = (axis: keyof RecentShots) => effectiveWindow(axis, dealSize);
  const look: LookSpec = {
    capture: pickAxis(CAPTURE, recent.capture, w("capture"), used.capture),
    light: pickAxis(LIGHT, recent.light, w("light"), used.light),
    grade: pickAxis(GRADE, recent.grade, w("grade"), used.grade),
    framing: pickAxis(FRAMING, recent.framing, w("framing"), used.framing),
    presence: pickAxis(PRESENCE, recent.presence, w("presence"), used.presence),
  };
  used.capture.add(look.capture.key);
  used.light.add(look.light.key);
  used.grade.add(look.grade.key);
  used.framing.add(look.framing.key);
  used.presence.add(look.presence.key);
  return look;
}

/**
 * Deal `count` distinct LOOKS for a caller that supplies its own subject (hook studio's
 * storyboard options, the enrich path). No two looks in one deal share an axis value, which
 * is what stops three "different" options coming back as one photo in three crops.
 */
export function dealLooks(opts: { count: number; recent?: RecentShots }): LookSpec[] {
  const used = emptyUsed();
  return Array.from({ length: opts.count }, () => dealLook(opts.recent ?? {}, used, opts.count));
}

/**
 * Deal `count` distinct shot specs for a lane. Nothing repeats inside the deal, and
 * nothing repeats against the recent history the caller read out of `broll_drops`.
 */
export function dealShots(opts: {
  lane: ShotLane;
  count: number;
  recent?: RecentShots;
  /** Per-shot lane override, index-aligned with the deal. Falls back to `lane`. */
  lanes?: ShotLane[];
}): ShotSpec[] {
  const { lane: laneId, count, recent = {}, lanes } = opts;
  const used = emptyUsed();

  const out: ShotSpec[] = [];
  for (let i = 0; i < count; i++) {
    const pool = subjectsFor(lanes?.[i] ?? laneId);
    const subject = pickAxis(pool, recent.subject, effectiveWindow("subject", count), used.subject);
    used.subject.add(subject.key);
    out.push({ subject, ...dealLook(recent, used, count) });
  }
  return out;
}

/** How many distinct combinations the grammar can express, for the Slack footer. */
export function grammarSize(laneId?: ShotLane): number {
  const subjects = laneId ? subjectsFor(laneId).length : SUBJECTS.length;
  return subjects * CAPTURE.length * LIGHT.length * GRADE.length * FRAMING.length * PRESENCE.length;
}

// ---- the hook shot (Hook Studio scene 1) -------------------------------------------------
//
// Scene 1 of a Hook Studio video is the one frame whose job is to say WHO the video is for
// before a single word of copy is read. Everything above exists to make B-roll look
// photographed rather than generated. The hook is the deliberate opposite, and BOTH reversals
// are scoped to this one shot:
//
//   - CAMERA_AWARE_BAN is dropped. The patient's face IS the frame. Matthew's references are full
//     face, eyes closed, head turned three-quarter, the practitioner entering as gloved hands.
//   - REALISM_TAIL and AI_TELL_BAN are dropped. Those references read "Photorealistic
//     cinematic vertical 9:16, muted desaturated warm-neutral color grade": clean, composed,
//     aspirational, which is precisely what the documentary guards forbid.
//
// Do not "fix" a hook that looks too polished by putting the realism tail back on it, and do
// not let the treatment subject leak past scene 1 - injection footage in every shot is the
// consumer-advertising failure the avatar's visual rules still guard against everywhere else.

/** The four treatment families Matthew named, four framings each so rotation is real. Written
 *  the way his references read: the patient carries the frame, the practitioner is hands. */
export const HOOK_TREATMENT_SUBJECTS: AxisEntry[] = [
  // botox
  { key: "botox_crowsfoot", text: "a gloved hand steadying the temple while a fine syringe sits at the crow's foot, the patient reclined with her eyes closed and her head turned three-quarter" },
  { key: "botox_forehead", text: "a syringe angled above the brow and a second gloved hand flattening the forehead, the patient's eyes closed and her head tipped back on the headrest" },
  { key: "botox_glabella", text: "a fine needle poised between the brows with gloved fingers bracketing the skin, the patient's face calm and turned slightly away" },
  { key: "botox_masseter", text: "a syringe angled at the jaw below the ear and a gloved hand cupping the cheek, the patient's head turned to show the jawline" },
  // filler
  { key: "filler_lip", text: "a syringe at the lip border and a gloved hand cradling the chin, the patient's eyes closed and her chin lifted toward the light" },
  { key: "filler_cheek", text: "a cannula pass along the cheekbone with pale marker dots still on the skin, the patient's head turned three-quarter" },
  { key: "filler_jaw", text: "a gloved hand steadying the chin while a syringe traces the jawline, the patient's face lifted and still" },
  { key: "filler_tear_trough", text: "a fine syringe held just below the eye, the patient's eyes closed and her head resting back against the chair" },
  // hifu
  { key: "hifu_jaw", text: "an ultrasound handpiece drawn along the jawline with clear gel catching the light, the patient's head tilted back on the headrest" },
  { key: "hifu_cheek", text: "a HIFU handpiece pressed flat to the cheek and held by a gloved hand, the patient's eyes closed" },
  { key: "hifu_neck", text: "a handpiece worked down the side of the neck through gleaming gel, the patient's chin lifted and her eyes closed" },
  { key: "hifu_screen", text: "a HIFU handpiece at the temple with the treatment screen glowing out of focus behind, the patient reclined and still" },
  // laser hair removal
  { key: "lhr_underarm", text: "a laser handpiece over a raised underarm, the nurse in orange safety glasses leaning in, the patient's eyes under opaque shields" },
  { key: "lhr_shin", text: "a laser handpiece drawn along a shin, the nurse in orange safety glasses, the room light dimmed around the treatment field" },
  { key: "lhr_upper_lip", text: "a laser handpiece at the upper lip with gloved fingers holding the skin taut, both nurse and patient in protective eyewear" },
  { key: "lhr_jawline", text: "a laser handpiece passing under the jaw, the nurse in orange safety glasses watching the tip, the patient's eyes shielded" },
];

/** The hook's craft, replacing the dealt look line entirely for scene 1. */
export const HOOK_LOOK =
  "Shot the way a med spa shoots its own campaign. A clean, styled treatment room: neutral walls, " +
  "a leather treatment chair, a spa headband or robe where it fits. Shallow depth of field, soft " +
  "directional light, the practitioner present only as gloved hands and forearms unless the subject names her.";

/** The one axis that still rotates on the hook. Both values are his; his two reference rows
 *  differ by exactly this and nothing else. Two entries, so the window below alternates them. */
export const HOOK_GRADE: AxisEntry[] = [
  { key: "warm_neutral", text: "muted desaturated warm-neutral color grade" },
  { key: "cool_clinical", text: "muted desaturated cool clinical color grade" },
];

/** "Not graphic" as Matthew means it. The syringe, the needle and the handpiece are the POINT
 *  and are never banned - every reference has one touching skin. What is banned is the
 *  clinical-textbook register that turns an aspirational frame into a medical photograph. */
export const NOT_GRAPHIC_BAN =
  "Do not produce: blood, bruising, swelling, broken or wounded skin, a before-and-after split, " +
  "a medical diagram, or clinical-textbook framing. The frame stays calm and aspirational.";

/** The scene-1 sibling of shotGuards(). Deliberately carries neither CAMERA_AWARE_BAN, PERSON_LAW, REALISM_TAIL,
 *  AI_TELL_BAN nor the avatar's image_negative (which restates the face ban). */
export function hookGuards(): string {
  return `${NOT_GRAPHIC_BAN} No on-screen text, logos, or watermarks in the image. 9:16 vertical.`;
}

export interface HookShot {
  subject: AxisEntry;
  grade: AxisEntry;
}

/** Recently-dealt hook keys, most-recent-first. */
export interface RecentHooks {
  subject?: string[];
  grade?: string[];
}

// Subject remembers 8 back (half the library); grade has two values, so a window of 1 makes it
// alternate, which is the most rotation two entries can honestly offer.
const HOOK_WINDOW: Record<keyof RecentHooks, number> = { subject: 8, grade: 1 };

/** Deal the hook: one treatment subject and one grade, neither repeating against `recent`. */
export function dealHookShot(opts: { recent?: RecentHooks } = {}): HookShot {
  const recent = opts.recent ?? {};
  return {
    subject: pickAxis(HOOK_TREATMENT_SUBJECTS, recent.subject, HOOK_WINDOW.subject, new Set()),
    grade: pickAxis(HOOK_GRADE, recent.grade, HOOK_WINDOW.grade, new Set()),
  };
}

/** The hook brief, opening the way his references open: format, grade, then craft and subject. */
export function renderHookBrief(shot: HookShot): string {
  return `Photorealistic cinematic vertical 9:16, ${shot.grade.text}. ${HOOK_LOOK} Subject: ${shot.subject.text}.`;
}

/** A short label for the Slack card, so the dealt treatment is visible at a glance. */
export function hookLabel(shot: HookShot): string {
  return `${shot.subject.key} / ${shot.grade.key}`;
}

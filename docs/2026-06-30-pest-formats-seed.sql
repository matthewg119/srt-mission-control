-- Seed the pest_control content calendar from the 60-idea / 8-format library
-- (~/Downloads/pest-control-content-library.md), POV-transformed per BUILD §8:
-- every idea is rewritten to first-person POV with the wearer's own gloved hands.
--
-- Lives in a separate id namespace (`pest_seed_*`) from the generator output
-- (`pest_control_gen_*`) so both can coexist in the rotation pool.
-- Difficulty: Format 1 = easy (11 shots), Format 2 = hard (15), Formats 3-8 = medium (13).
-- ADD ONLY. Safe to re-run: ON CONFLICT (id) DO NOTHING. reference_urls defaults to '[]'.

-- Ensure the pest_control vertical exists (vertical_formats.vertical_id is a NOT NULL FK).
-- Mirrors the in-code PEST_CONTROL_SEED in src/config/verticals.ts. A real avatar ingest
-- (POST /api/content/ingest-avatar) later fills avatar_summary / beliefs / offer.
INSERT INTO verticals (id, name, audience, language, status, business_descriptor, wearer_role, style_token)
VALUES (
  'pest_control', 'Pest Control', 'homeowner', 'en', 'active',
  'pest control business', 'pest control technician',
  'First-person POV as if recorded on Ray-Ban Meta smart glasses: eye-level head-mounted camera, the wearer''s own gloved hands and forearms visible in the lower frame doing the task, mild wide-angle lens with slight barrel distortion, subtle natural handheld head-movement, realistic natural daylight, true-to-life un-graded color, candid and authentic, looks like real captured footage, not a studio or cinematic shot.'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO vertical_formats (id, vertical_id, format_group, scene, hook, difficulty, shot_count) VALUES
-- Format 1 - Satisfying / ASMR process b-roll (easy)
('pest_seed_f1_01','pest_control','satisfying_broll','POV walking across a green lawn at golden hour, the wearer''s gloved hand raising a backpack fogger wand as slow-mo fog rolls out across the grass.','POV: your bug problem disappearing.','easy',11),
('pest_seed_f1_02','pest_control','satisfying_broll','POV crouched at a baseboard, the wearer''s gloved hand misting one even line of treatment along the wall-floor seam.','The line they won''t cross.','easy',11),
('pest_seed_f1_03','pest_control','satisfying_broll','POV pouring granular bait into a hand spreader, the wearer''s gloved hands tilting the bag as granules scatter across the grass.','Lawn armor, loading.','easy',11),
('pest_seed_f1_04','pest_control','satisfying_broll','POV the wearer''s gloved hand injecting dust from a crack-and-crevice tool into a thin wall gap.','Sealing the highways they travel.','easy',11),
('pest_seed_f1_05','pest_control','satisfying_broll','POV tracing the sprayer wand around a house foundation perimeter, the wearer''s gloved hand keeping the band even.','One lap = 90 days of protection.','easy',11),
('pest_seed_f1_06','pest_control','satisfying_broll','POV reaching up with a power-duster, the wearer''s gloved hand clearing webs off a porch ceiling corner.','Spider eviction day.','easy',11),
('pest_seed_f1_07','pest_control','satisfying_broll','POV the wearer''s gloved hand feeding expanding foam into a floor drain to kill drain flies.','Where the gnats actually come from.','easy',11),
('pest_seed_f1_08','pest_control','satisfying_broll','POV dragging a treatment hose around a wooden deck, the wearer''s gloved hand laying clean even coverage.','Satisfying? Yes. Necessary? Also yes.','easy',11),
-- Format 2 - Pest reveal and removal (hard)
('pest_seed_f2_01','pest_control','pest_reveal','POV the wearer''s head tilts up to reveal a basketball-sized wasp nest under an eave, gloved hand reaching toward it.','Found this on a ''routine'' inspection.','hard',15),
('pest_seed_f2_02','pest_control','pest_reveal','POV the wearer''s gloved hands knocking a hornet nest into a bag with one clean drop.','Bye.','hard',15),
('pest_seed_f2_03','pest_control','pest_reveal','POV the wearer''s gloved hand sweeping a flashlight behind a fridge as roaches scatter.','What''s behind YOUR fridge.','hard',15),
('pest_seed_f2_04','pest_control','pest_reveal','POV the wearer''s gloved hand lifting mulch to reveal a termite mud tube.','This means they''re already inside.','hard',15),
('pest_seed_f2_05','pest_control','pest_reveal','POV the wearer''s gloved hand opening an attic hatch to reveal mouse droppings on insulation.','Nobody checks up here. We do.','hard',15),
('pest_seed_f2_06','pest_control','pest_reveal','POV the wearer''s gloved hand pulling a dead rat from a wall void.','The smell finally makes sense.','hard',15),
('pest_seed_f2_07','pest_control','pest_reveal','POV the wearer''s gloved hands cutting open a cardboard box full of nesting ants.','Storage-room horror.','hard',15),
('pest_seed_f2_08','pest_control','pest_reveal','POV the wearer crouched over an in-ground yellowjacket nest, gloved hand guiding smoke into the hole.','In-ground = the scary ones.','hard',15),
-- Format 3 - Before / After (medium)
('pest_seed_f3_01','pest_control','before_after','POV the wearer''s gloved hand clearing a web-covered patio, then the same patio spotless.','10 minutes. Tops.','medium',13),
('pest_seed_f3_02','pest_control','before_after','POV the wearer''s gloved hand wiping an ant trail off a counter, then the clean counter.','Gone for good, not gone for a day.','medium',13),
('pest_seed_f3_03','pest_control','before_after','POV the wearer treating a bug-ridden flowerbed, then the clean treated bed.','Curb appeal, restored.','medium',13),
('pest_seed_f3_04','pest_control','before_after','POV the wearer''s gloved hands sealing and baiting a mouse-chewed pantry, then the clean closed pantry.','We don''t just trap. We close the door.','medium',13),
('pest_seed_f3_05','pest_control','before_after','POV the wearer clearing a wasp-covered playset, then the kids'' playset safe and clear.','Kids can play again.','medium',13),
('pest_seed_f3_06','pest_control','before_after','POV the wearer fogging a mosquito-swarmed backyard at dusk, then a calm usable yard.','Get your summer nights back.','medium',13),
('pest_seed_f3_07','pest_control','before_after','POV the wearer''s gloved hand treating a roach-infested cabinet, then the sealed clean cabinet.','The before they don''t want you to see.','medium',13),
('pest_seed_f3_08','pest_control','before_after','POV the wearer laying a barrier line along an overgrown tick-heavy yard edge, then the treated edge.','The tick line.','medium',13),
-- Format 4 - Equipment and tech showcase (medium)
('pest_seed_f4_01','pest_control','equipment_tech','POV the wearer''s gloved hand aiming a thermal camera at a wall, a heat-blob nest glowing on the screen.','We can see them through walls.','medium',13),
('pest_seed_f4_02','pest_control','equipment_tech','POV the wearer''s gloved hands opening a tamper-proof rodent bait station to show the mechanism.','Kid-and-pet-safe.','medium',13),
('pest_seed_f4_03','pest_control','equipment_tech','POV the wearer''s gloved hand spinning up a backpack fogger, fan blades blurring.','The machine that ends mosquito season.','medium',13),
('pest_seed_f4_04','pest_control','equipment_tech','POV the wearer''s gloved hand feeding a borescope camera into a wall void, the screen view visible.','A camera where your eyes can''t go.','medium',13),
('pest_seed_f4_05','pest_control','equipment_tech','POV the wearer''s gloved hand pressing a moisture meter to a damp baseboard as it beeps.','Moisture is the #1 thing that invites termites.','medium',13),
('pest_seed_f4_06','pest_control','equipment_tech','POV the wearer''s gloved hands guiding a spray drone along a large commercial roofline.','Commercial scale, same precision.','medium',13),
('pest_seed_f4_07','pest_control','equipment_tech','POV the wearer''s gloved hand pulling a full glue board from behind an oven.','24 hours. One board.','medium',13),
('pest_seed_f4_08','pest_control','equipment_tech','POV the wearer''s gloved hand sweeping a UV flashlight at night as a scorpion glows.','They glow. That''s how we find them.','medium',13),
-- Format 5 - Educational did-you-know (medium)
('pest_seed_f5_01','pest_control','educational','POV the wearer''s gloved hand holding a macro view of a single roach close to the lens.','One roach = up to 50 eggs in a single case.','medium',13),
('pest_seed_f5_02','pest_control','educational','POV a mosquito landing on the wearer''s forearm in slow zoom.','A mosquito can smell you from 30 feet away.','medium',13),
('pest_seed_f5_03','pest_control','educational','POV the wearer''s gloved hand holding up a termite-swarm illustration card.','Termites cause ~$5B in damage a year. Insurance won''t cover it.','medium',13),
('pest_seed_f5_04','pest_control','educational','POV the wearer''s gloved hand pointing at a rat squeezing through a quarter-sized hole.','If a quarter fits, a rat fits.','medium',13),
('pest_seed_f5_05','pest_control','educational','POV the wearer''s gloved hand lifting a cutaway of an underground ant colony.','A single colony can hold 500,000 ants.','medium',13),
('pest_seed_f5_06','pest_control','educational','POV the wearer''s gloved hand holding a macro view of a bed bug on a mattress seam.','They can live a year without feeding.','medium',13),
('pest_seed_f5_07','pest_control','educational','POV the wearer''s gloved hand lighting a corner web with a house spider in it.','Most never bite. The ones that do, we ID.','medium',13),
('pest_seed_f5_08','pest_control','educational','POV the wearer''s gloved hands holding a wasp and a bee side by side for comparison.','Know which one you''re dealing with.','medium',13),
-- Format 6 - Myth-buster (medium)
('pest_seed_f6_01','pest_control','myth_buster','POV the wearer''s gloved hand holding an ultrasonic plug-in with a red X over it.','These do NOT work. Here''s what does.','medium',13),
('pest_seed_f6_02','pest_control','myth_buster','POV the wearer''s gloved hand holding a peppermint-oil bottle with a red X over it.','Smells nice. Repels nothing long-term.','medium',13),
('pest_seed_f6_03','pest_control','myth_buster','POV the wearer''s gloved hand gesturing at a cat staring at a mouse hole, a red X over it.','Your cat is not a pest plan.','medium',13),
('pest_seed_f6_04','pest_control','myth_buster','POV the wearer''s gloved hand holding a bug-bomb can with a red X over it.','Bug bombs scatter roaches. They don''t kill the nest.','medium',13),
('pest_seed_f6_05','pest_control','myth_buster','POV the wearer''s gloved hand placing cheese on a trap with a red X, then swapping in peanut butter.','Mice prefer peanut butter. Cheese is a movie myth.','medium',13),
('pest_seed_f6_06','pest_control','myth_buster','POV the wearer''s gloved hand gesturing across a spotless kitchen.','But my house is clean. Pests want water, not crumbs.','medium',13),
('pest_seed_f6_07','pest_control','myth_buster','POV the wearer''s gloved hand gesturing at a snowy winter scene through a window.','Pests don''t die in winter. They move inside.','medium',13),
('pest_seed_f6_08','pest_control','myth_buster','POV the wearer''s gloved hand holding a store-shelf DIY spray can.','It kills what you see. Not what you don''t.','medium',13),
-- Format 7 - Seasonal / pest alert (medium)
('pest_seed_f7_01','pest_control','seasonal_alert','POV the wearer''s gloved hand parting spring flowers to reveal emerging ants.','Spring = ant season. Treat before they''re inside.','medium',13),
('pest_seed_f7_02','pest_control','seasonal_alert','POV the wearer at summer dusk, gloved hand raising a fogger as a mosquito swarm rises.','Mosquito season is here. Get ahead of it.','medium',13),
('pest_seed_f7_03','pest_control','seasonal_alert','POV the wearer''s gloved hand near a foundation in fall leaves as mice scurry.','Cooling nights = rodents looking for a way in.','medium',13),
('pest_seed_f7_04','pest_control','seasonal_alert','POV the wearer''s gloved hand opening a winter attic as a squirrel darts.','Attic noises in winter? Not the house settling.','medium',13),
('pest_seed_f7_05','pest_control','seasonal_alert','POV the wearer''s gloved hand pointing at standing rain water teeming with larvae.','Every puddle is a mosquito nursery.','medium',13),
('pest_seed_f7_06','pest_control','seasonal_alert','POV the wearer''s gloved hand near firewood stacked by a door as spiders crawl.','Firewood by the house = spiders inside.','medium',13),
('pest_seed_f7_07','pest_control','seasonal_alert','POV the wearer''s gloved hand at an indoor water source during a heat wave as ants gather.','Heat drives them inside for water.','medium',13),
('pest_seed_f7_08','pest_control','seasonal_alert','POV the wearer surveying storm aftermath, gloved hand gesturing at displaced pests.','After a storm, pests look for a new home. Yours.','medium',13),
-- Format 8 - Prevention tip / pro move (medium)
('pest_seed_f8_01','pest_control','prevention_tip','POV the wearer''s gloved hands installing a door sweep under a garage door.','Seal this gap. It''s the #1 entry point.','medium',13),
('pest_seed_f8_02','pest_control','prevention_tip','POV the wearer''s gloved hand trimming a branch off the roofline.','Branches touching your roof = a bug bridge.','medium',13),
('pest_seed_f8_03','pest_control','prevention_tip','POV the wearer''s gloved hand pulling mulch back from the foundation.','Keep mulch 12 inches off the wall.','medium',13),
('pest_seed_f8_04','pest_control','prevention_tip','POV the wearer''s gloved hand dumping a plant saucer of standing water.','Empty standing water weekly. Mosquitoes need 7 days.','medium',13),
('pest_seed_f8_05','pest_control','prevention_tip','POV the wearer''s gloved hands pouring pet food into a sealed storage bin.','Open pet food feeds more than your dog.','medium',13),
('pest_seed_f8_06','pest_control','prevention_tip','POV the wearer''s gloved hand fixing a torn window screen.','One small tear is an open door.','medium',13)
ON CONFLICT (id) DO NOTHING;

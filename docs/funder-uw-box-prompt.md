# Funder Underwriting Box — prompt + load guide

The "ready to shop" suggester (`src/lib/ai-intel/suggest-funders.ts`) reads one free-text
**underwriting box** per funder from `lenders.underwriting_box` and matches it against the deal's
bank-statement summary. The tighter and more consistent each box is, the better the suggestions.

Only funders we are actually signed up with (have a submission email or portal) get suggested. A
funder with no box can still be named manually in Slack — it just won't be auto-suggested with a
fit reason.

**Master funder list (source):**
https://docs.google.com/spreadsheets/d/13NDqNrsisvZDGJca7l0IiF8DtGZxkG0kUA-YStsCHcQ/edit?gid=2068473573

---

## How to build the boxes (Claude project prompt)

Spin up a Claude project, paste the prompt below, then feed it each funder's guidelines (the sheet
row, a rate sheet PDF, an email, or just what you know). It returns one clean `underwriting_box`
string per funder in the house format.

> **Prompt — paste into the project's instructions:**
>
> You are building underwriting summaries for SRT Agency's MCA funders. For each funder I give you,
> output a SINGLE line called `underwriting_box` capturing exactly what that funder wants to see in a
> deal, so a matcher can decide fit from a merchant's bank statements.
>
> Use this order and ` · ` separators, omitting any field the funder doesn't specify:
> `Min $X/mo deposits · TIB Nmo+ · max $Y · positions 1st–Nth, max N · blocks <industries> · NSF tolerance ~N/mo · neg days <ok/limit> · factor A.AA–B.BB · funds N–Nh · <any hard rule>`
>
> Rules:
> - Keep it terse — fragments, not sentences. No marketing language.
> - Normalize money to `$25k`, `$1.2M`. Normalize time to months.
> - Capture hard disqualifiers explicitly (e.g. "no sole-prop", "no startups <6mo", "no cannabis/auto/trucking", "1st position only").
> - If the funder is lenient on something risky, say so (e.g. "NSFs OK if <8/mo", "neg days OK").
> - If a detail is unknown, leave it out — do not invent numbers.
> - Output ONLY the `underwriting_box` line (plus the funder name as a heading), nothing else.

**Example output**

```
Velocity Capital
Min $30k/mo deposits · TIB 6mo+ · max $150k · positions 1st–3rd, max 3 · blocks trucking/auto-sales · NSF tolerance ~6/mo · factor 1.30–1.49 · funds 24–48h · no sole-prop under $20k/mo
```

---

## Per-funder template (fill from the sheet, then convert with the prompt)

| Funder | Submit (email/portal) | Min mo. revenue | Min TIB | Max amount | Positions | Blocked industries | NSF / neg-day tolerance | Factor range | Notes / hard rules |
|--------|----------------------|-----------------|---------|------------|-----------|--------------------|--------------------------|--------------|--------------------|
|        |                      |                 |         |            |           |                    |                          |              |                    |

---

## Loading the boxes into Supabase

After running `docs/2026-06-04-funder-suggestions.sql`, set each box with one `UPDATE` (match on the
funder's `name` exactly as it appears in the `lenders` table):

```sql
UPDATE public.lenders
SET underwriting_box = 'Min $30k/mo deposits · TIB 6mo+ · max $150k · positions 1st–3rd, max 3 · blocks trucking/auto-sales · NSF tolerance ~6/mo · factor 1.30–1.49 · funds 24–48h · no sole-prop under $20k/mo'
WHERE name = 'Velocity Capital';
```

Repeat per funder. Re-running an `UPDATE` just overwrites the box, so you can iterate freely.

Tip: to see which active funders still need a box:

```sql
SELECT name, submission_method
FROM public.lenders
WHERE is_active = true AND (underwriting_box IS NULL OR underwriting_box = '')
ORDER BY name;
```

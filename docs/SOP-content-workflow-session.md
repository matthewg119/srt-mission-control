# SOP — Content Workflow Slack Session (Content Engine v3)

How the `#content-full` Vektor session runs. `go` starts it; you drive the whole thing by typing
in the channel (thread replies also work). Heavy generation runs in the background so Slack acks
fast. Two diagrams: how it used to run (and why it stalled), and how it runs now.

Legend: `[box]` = a step Vektor posts. `{diamond}` = a decision. Arrows are what YOU send.

## BEFORE — the old flow (copy asked twice, could stall)

```mermaid
flowchart TD
  A([go]) --> B[Vektor: which avatar?]
  B -->|reply a number| C[30 headlines + story material]
  C -->|headline N / paste| D[Hookset:<br/>5 verbal + 5 title + 5 POV]
  D -->|title N / verbal N / pov N / hook TEXT| E[3 captions + 3 storyboards]
  E -->|pick C S| F[Picture plan<br/>auto-authored POV workflow<br/>scenes + timed captions]
  F -->|react ✅| G[Generate scene images]
  G --> H[song / sequence]

  D -. paste your own copy block .-> STUCK[[no match:<br/>hookset only accepts<br/>title/verbal/pov/hook - session stalls]]
  style STUCK fill:#3a1414,stroke:#a33,color:#f5c2c2
```

Problems: copy was asked for **twice** (hookset, then captions/storyboards) before any workflow
choice, and pasting your own lines at the hooks step matched no command, so it stalled.

## AFTER — the current flow (workflow asked right after the hooks)

```mermaid
flowchart TD
  A([go]) --> B[Vektor: which avatar?]
  B -->|reply a number| C[30 headlines + story material]
  C -->|headline N / paste| D[Hookset:<br/>5 verbal + 5 title + 5 POV]
  D -->|pick a hook OR paste your own lines| W{Which workflow?}

  W -->|workflow N = draft| X[Emit Claude Code prompt<br/>to configure it]
  W -->|workflow N = no copy structure| F[Picture plan as before]
  W -->|workflow N = has copy structure| S[Structured copy<br/>labeled boxes:<br/>avatar / callout / pain / reason /<br/>dream / CTA - seeded from YOUR message]

  S -->|line N edit / paste to re-slot| S
  S -->|react ✅| P[Paint the picture<br/>copy shown on the shot images]
  P -->|react ✅| G[Generate shot images]
  G -->|song key or url| M{Confirm render mode<br/>static images or video?}
  M -->|shot-length validation| M
  M -->|react ✅| R[Emit Claude Code render prompt<br/>+ video description]

  style W fill:#14233a,stroke:#3a6ea5,color:#c2d8f5
  style R fill:#14331a,stroke:#3a8a4a,color:#c2f5c9
```

Two fixes: (1) the workflow is asked **immediately after the hooks** (the separate captions/
storyboards step is removed from this path, so copy is asked once); (2) pasting your own copy at
the hooks step now advances the flow and **seeds the labeled copy from your words** (re-slotted
into the boxes), so Vektor gives feedback on your message instead of asking again.

## Command cheat-sheet
- `go` — start (pick an avatar by number, or `new` to create one)
- `headline N` or paste your own headline
- `title N` / `verbal N` / `pov N` / `hook <text>` — pick a hook, **or just paste your copy**
- `workflow N` — pick the workflow to build into
- `line N <text>` — edit one labeled copy box; paste a full block to re-slot it
- `song <key|url>` — set the song (then confirm the render mode)
- `save as <name>` / `save draft` / `modify copy` — when a paste does not match the structure
- `map` / `library` — the workflow inventory

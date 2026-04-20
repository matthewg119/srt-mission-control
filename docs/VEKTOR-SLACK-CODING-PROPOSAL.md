# Proposal — talking to Claude Code from Slack (VeKtor as your coding copilot)

## The ask

> "I would like Vektor to be connected to this chat like an extension of claude code... If I can treat that chat as this same chat claude code in vs studio same in slack with vektor that would be fire."

You spend most of your week on calls, not at VS Code. You want to direct code changes from Slack while you're moving. This is achievable and genuinely useful.

## The short version

Build a **Slack-to-Claude-API bridge** that lets you drop messages in `#Vektor` and have Claude edit code in this repo on your behalf, just like a Claude Code session in VS Code. Under the hood it uses the **Claude Agent SDK** — Anthropic's official toolkit for building Claude Code-style agents.

## How it works

```
You in #Vektor:
  "Read src/lib/ai-intel/guardian.ts and tell me where
   we handle the dead state."

Slack bot forwards the message →
  Claude Agent SDK spins up a session with:
    - Access to this repo's filesystem (read + write + bash)
    - Your system prompt + project memory
    - Tool loop: Read, Edit, Grep, Glob, Bash, etc.
  →
Claude reads the file, posts a reply in the thread:
  "Lines 49-55 — state='dead' triggers suppress +
   cancels active sequence_enrollments. No Meta event."

You reply in thread:
  "Make dead fire a custom Meta 'DealAbandoned' event."

Claude edits the file, runs the build, replies with:
  "Done. Added to meta-events.ts + tests pass.
   Commit message proposed: [see thread]."

You react 👍 to approve the commit + push.
```

## What you get

- Every `#Vektor` message = Claude Code session with full repo context
- Threaded conversations are stateful (same session continues)
- You can ask it to read files, edit them, run `bun run build`, search for patterns, explain existing logic
- Destructive actions (delete files, force push, drop tables) still need explicit confirmation — same safety rails as the CLI Claude Code
- Works from phone Slack app while you're on sales calls

## Why not just Telegram

You already have a Telegram bot ([src/app/api/telegram/webhook/route.ts](../src/app/api/telegram/webhook/route.ts)), but it runs the AI Office Manager tool loop — different tool set (pipeline queries, email drafts), not filesystem access. The Slack bridge would be a separate surface focused on code work specifically.

## Cost

Light usage: **~$30-80/mo** in Claude API credits. Heavy daily use (dozens of sessions): **~$200-400/mo**. You're already paying for Claude Code / Anthropic API — this is additional on top.

## The two viable architectures

### A) Self-hosted agent (recommended)

Run a small long-lived Node process somewhere with access to the repo. Listens to Slack events. Spawns a Claude Agent SDK session per thread. Posts responses back.

**Pros:** full filesystem control, runs builds locally, low-latency
**Cons:** needs a server (not Vercel — can't keep a process alive). Options: a $5/mo DigitalOcean droplet, or a cheap Fly.io machine. Or your own Mac if it's on.
**Built by:** ~2 focused days of work

### B) Vercel-resident with temporary sandbox

Vercel function → pulls repo into a temp dir → runs Claude Agent SDK → pushes changes back to a branch. Posts PR link to Slack.

**Pros:** stays on your existing Vercel infra
**Cons:** cold start on every message (5-10s latency), no persistent session state across messages, higher friction
**Built by:** ~3-4 days of work (more plumbing)

## Recommendation

Go with **A)** and run it on your Mac for the first month while you try it. If you use it heavily, move to a $10/mo Fly.io machine. Hard dependency: your Mac needs to stay on while you want VeKtor available.

## What I'd build in session #1 (minimal viable)

1. New Slack app scope: `channels:history`, `chat:write`, `files:write` for the `#Vektor` channel
2. A `vektor-slack-bridge` repo with a Node process that:
   - Subscribes to Slack events via Socket Mode (no public URL needed)
   - On message in `#Vektor` → spawns Claude Agent SDK with this repo as cwd
   - Streams Claude's output back to the Slack thread as it runs
3. Commit/push confirmation gate: when Claude wants to commit, it posts the diff + commit message and waits for 👍 before running `git commit && git push`
4. Safety rails: filesystem writes allowed, but force-pushes / `rm -rf` always require explicit confirmation (same as CLI Claude Code)

## What I don't recommend

- **Running Claude Agent inside Mission Control's Next.js app.** Serverless + filesystem writes + long-running sessions = bad fit. Keep the code-work bot separate.
- **Sharing a session across channels.** Keep one thread = one session. Otherwise context mixes and Claude gets confused about what "this file" means.
- **Letting VeKtor edit production env vars or deploy prod.** Both need a human in the loop.

## Timeline

One focused afternoon to stand up the minimum viable bridge with Socket Mode + commit/push gating. Another afternoon to add the polish (error handling, token usage tracking, session cleanup).

---

## Your decision

Want me to build this next session? I can also:
- Scaffold the repo structure now (empty, ready to fill in)
- Write the exact `bun create` script + env vars needed
- Spec out the Slack app manifest as JSON you paste into api.slack.com

Just say "yes, build the Slack code bridge" and point me at where you want the repo to live.

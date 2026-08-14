# Punchcard — working notes for Claude Code

A local-first daily task app. A "time card" you punch out as the day goes. Built for
Bobby and his girlfriend, both on Android, installed as a PWA from GitHub Pages.

This file is the memory of how the app is built and *why*. Read it before changing
anything. When you make a decision that future-you would want to know, add it here.

## First rule: this is a hand-tuned app, not a scaffold

Every choice below was made deliberately, usually after several iterations and often
after looking at rendered output. Don't "modernize," reformat, or swap approaches
because something looks unconventional — the unconventional parts are load-bearing.
If a change seems to call for breaking one of these rules, stop and ask Bobby first.

## What it is, physically

- **One file: `index.html`.** Markup, CSS, and JS all inline. No build step, no
  bundler, no npm dependencies at runtime. This is intentional — it must stay a single
  static file that works opened directly or hosted. Do not split it into modules or
  introduce a framework.
- Supporting files: `manifest.json`, `sw.js` (service worker), `icon-*.png`, `README.md`.
- `test.js` — a headless jsdom harness. Not shipped; it's the safety net (see Workflow).

## Design law

The look is "manila time card": flat ink on paper stock. Specifics:

- **Flat everywhere. Depth in exactly one place: the sky art** (top-right of the header).
  A picture of the sky earns gradients and glow; a task row does not. Do not add
  shadows, gradients, or glassmorphism to cards, rows, buttons, or sheets. If you find
  yourself reaching for `box-shadow` on a control, that's the signal to stop.
- **Palette lives in CSS variables** at the top of the `<style>` block, with a light
  (`:root`) and dark (`[data-theme="dark"]`) set. Dark is deliberately violet
  (`--paper:#171231`), not neutral grey — Bobby chose that. Change colours only by
  editing these variables so both themes stay coherent.
- **Type:** Bricolage Grotesque (display headings), Public Sans (body), JetBrains Mono
  (all times, labels, meta). Times and small-caps labels are ALWAYS mono. Keep it.
- **Signature elements** — don't casually redesign these, they *are* the app:
  - the punch strip (15-min blocks filling with each task's colour)
  - the hole-punch check-off (circle collapses, paper chads fly)
  - the sky art
- **Per-task colour is pinned to the task** (`hueIdx`), not its list position. Reordering
  must never recolour tasks or the strip.

## Architecture that will bite you if you forget it

- **Timers are wall-clock, never tick counters.** A running timer is stored as
  `S.running = {id, since: <epoch ms>}`. Elapsed = `now - since`, computed on read via
  `secOf(t)` / `liveSec(t)`. This is the *only* correct approach — the app gets frozen
  by Android (screen off, backgrounded, tab discarded) and a `setInterval` counter
  silently loses time. The heartbeat interval only *repaints*; it must never accumulate.
  If you touch timing, preserve this. `commit()` folds live time into `t.sec` and
  re-anchors; call it before any read that needs a settled number.

- **Saves are revisioned.** `save(passive)` bumps `S.rev`. A *passive* write (heartbeat,
  backgrounding, page hide) will NOT overwrite storage that has a higher `rev` — it
  adopts the newer copy instead. Only a deliberate user edit wins. This exists because
  opening the file from Downloads spawns multiple tabs; without it, a stale tab clobbers
  good data on close. Keep passive/active distinct when adding new writes.

- **Day model.** `view` is an integer offset: 0 = today, +n ahead, -n behind.
  - Future days are a *planning* view: items live in `S.plans[dateKey]` and are delivered
    to the live card by `rollover()` when that day arrives (it catches up across missed
    days too). No timers, nothing to punch on a future day.
  - Past days are read-only, drawn from `S.history[dateKey]`.
  - `rollover()` runs at `settings.dayStart` (default 4am), not midnight.

- **The sky** (`skySVG()`): free-floating SVG shapes on transparency — moon/sun, stars,
  clouds, glow. **No background `<rect>`, no CSS mask.** An earlier version composited a
  full picture and faded its edges; the picture's gradient was lighter than the card and
  revealed a visible box. The fix was to draw only the elements. Don't reintroduce a
  backing rectangle. Time-of-day is computed locally; weather is the *only* network call.

## Privacy — a hard constraint, not a preference

The app is local-first and Bobby has told his gf the same. Everything stays on-device.
The single exception is the weather feature (opt-in, off by default): it sends a
coarse location (rounded to ~0.1°, ~10km) to open-meteo.com. Do not add analytics,
telemetry, external fonts beyond the Google Fonts already present, CDN scripts, or any
other outbound request. If a feature seems to need the network, flag it explicitly.

## Workflow

- **Run the tests before every commit:** `node test.js`. It boots the real HTML in
  jsdom and exercises add/punch/timer-freeze/plan/rollover/save-conflict/sky. Add a
  case when you add a feature. It's caught real bugs that reading the code did not.
- **Visual changes need eyes, not just green tests.** jsdom can't render. For anything
  that changes the sky or layout, render it out (cairosvg / a screenshot) and actually
  look before declaring it done. Every sky bug so far was invisible in the markup.
- **Deploy = push `index.html`.** GitHub Pages serves it; `sw.js` is network-first for
  the page, so a push reaches both phones on next launch. Usually only `index.html`
  changes — mention it if a change also touches `sw.js`/`manifest.json`, since those are
  cached differently.
- **Ask before committing** unless Bobby says otherwise in the session.

## History / storage shape (for reference)

`localStorage["punchcard.v1"]` holds one JSON blob: `{rev, savedAt, tasks[], plans{},
history{}, lastDay, running, settings{}, sky?}`. Tasks: `{id, title, daily, done, sec,
target, hueIdx, created, doneAt?, carried?}`. Settings: `{theme, sound, haptics,
cardHours, dayStart, autoStop, sky, weather}`. There's an Export/Import (JSON) backup
in Settings — the migration path when the storage origin changes (e.g. file:// → Pages).

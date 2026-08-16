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

- **Waking up.** `wake()` runs on `visibilitychange`, `pageshow`, and `focus` — all
  three, deliberately redundant, because standalone PWA launches on Android have been
  seen to just not fire `visibilitychange` reliably. It re-reads storage, repaints
  (cheap, safe to repeat if more than one signal fires for the same resume), and forces
  a real weather fetch via `refreshWeather(true)` — `render()` alone recomputes
  `phaseNow()` correctly, but never refetches, and the periodic 5-minute weather
  refresh is a plain `setInterval` that Android is free to throttle or freeze while
  backgrounded. Without the forced fetch, sunrise/sunset can be hours stale exactly
  when you open the app. `lastWake` debounces the fetch (not the repaint) to one per
  3s so three signals firing together don't triple-fetch.

- **Day model.** `view` is an integer offset: 0 = today, +n ahead, -n behind.
  - Future days are a *planning* view: items live in `S.plans[dateKey]` and are delivered
    to the live card by `rollover()` when that day arrives (it catches up across missed
    days too). No timers, nothing to punch on a future day.
  - Past days are read-only, drawn from `S.history[dateKey]`.
  - `rollover()` runs at `settings.dayStart` (default 4am), not midnight.
  - Reaching a specific day directly (not just one step at a time) is the calendar icon
    (`#calbtn`) in `#tabbar`, which opens `#calpanel` via `openCalPanel()`. It is **not** a
    dimmed overlay sheet — the panel grows from height 0 *in place*, shoving the card up to
    make room, then collapses back to nothing (closed it has no height and no border, so it
    leaves no trace above the tab bar). Bobby wanted it to shove the card up, not cover it.
    `renderCalPanel()` builds the *same* month grid as `planSheet()` (idea scheduling) —
    deliberately not a second calendar widget — through the shared `monthGridCells()`
    helper, which always pads to exactly 42 cells (6 rows) so switching from a 4-row month
    to a 6-row one (e.g. August 2026, which opens on a Saturday) doesn't grow/shrink the
    picker. It opens in both directions (`backLimit()..MAX_AHEAD` instead of
    `0..MAX_AHEAD`, since jumping should reach the past too), marks days that actually have
    something with a dot (`dayHasContent()` — checks `S.tasks`, `S.plans`, or `S.history`
    depending on which side of today the day falls), and browses months freely (no
    `prevOk`/`nextOk` cap, unlike `planSheet()` where scheduling into an unreachable month
    would be pointless). Tapping a day jumps `view` there and closes the panel; re-tapping
    `#calbtn` toggles it shut; switching tab closes it (`selectTab` calls `closeCalPanel()`).
    The open forces a reflow (`void p.offsetHeight`) before adding `.open` so the
    height:0 → height transition actually fires — an rAF would defer it past the test's
    synchronous check. Opening it also adds `.calopen` to `#app`, which folds the card's
    chrome away (`#app.calopen` hides the sky, strip/striplab, the rail and the composer)
    so a few of the day's tasks stay visible *above* the calendar instead of the tall
    greeting+sky+strip eating the whole card and leaving only the header. Everything
    unfolds again on close.

- **Today and Rhythm slide; the drawer doesn't.** `#deck` is a fixed window holding
  `#track` (twice as wide, two `.pane`s side by side: `#p-today`, `#p-rhythm`). Switching
  between Today and Rhythm toggles `#track.rhythm`, translating the track one pane width
  with a slight overshoot (`cubic-bezier(.22,1.12,.32,1)`) so the incoming tab bumps into
  place. The header (greeting + sky + strip) above and `#tabbar` below never move — they're
  the anchors, deliberately, so the app feels like one surface with the body changing under
  it. Rhythm wears the same rotating greeting as Today (not a flat "Rhythm" label) —
  it's today seen a different way, so the header stays identical across the slide. The day
  rail (`#rail`) and the add-task composer (`#composer`) live **inside** the
  Today pane, so they ride along when it slides — and the rail moved *up* here from the old
  bottom stack, reading as "< Today >" at the top of the card. Only Today↔Rhythm slide: the
  idea drawer (`#m-ideas`) is its own separate space (bare — no sky/strip), reached by
  hiding `#deck` and showing `#m-ideas`, not part of the track. `render()` no longer toggles
  `.hidden` on `#m-today`/`#m-rhythm` (both panes are always present in the track); it sets
  `#deck.hidden` for the drawer and `#track.rhythm` for the slide. Day-swipe (`goDay`) still
  translates `#m-today` on its own, independent of the track — the two transforms don't
  collide, because day-swipe is a small nudge within the pane and the track slide is a
  full pane-width translate.

- **Tab navigation lives in `#tabbar`, at the bottom, as icons — not a top row of text
  pills.** It was a top `<nav role="tablist">` with three text buttons (today/rhythm/
  drawer) until Bobby noticed it read as generic AI-app boilerplate once he'd seen the
  same pattern elsewhere and couldn't unsee it. `#tabbar` is the last child of `#app`,
  after `#ideacomposer`, and stays visible across every tab exactly like the old row did
  (still true: "the tab row stays — it's how you leave" for the drawer). It holds four
  icon buttons: today/rhythm/drawer as `role="tab"` with `data-tab`, plus `#calbtn` (the
  `openCalPanel()` calendar jump) with no `data-tab` of its own — it isn't a tab, just parked
  in the same row since a jump-to-date picker is exactly as useful from Rhythm or the
  drawer as from the card, and four icons reads better than three plus an odd one out
  elsewhere. `selectTab()` and its wiring are scoped to `#tabbar [role="tab"]`, not a
  bare `nav button`, specifically so `#calbtn` doesn't get treated as a selectable tab.
  This was *not* a listed signature element, so redesigning it doesn't cross the
  "don't casually redesign signature elements" rule above — but change it deliberately,
  not reflexively, same as anything else here.
  - Sheets (`#sheet`) have no drag handle. There was a `.grab` bar at the top; it looked
    like a resize/drag affordance but the sheet doesn't respond to dragging, so it was
    just misleading and got removed. Don't add one back unless the sheet actually
    becomes draggable.

- **The idea drawer** (`tab==="ideas"`). A holding place for things worth doing that
  have no date yet — a museum, a date-night idea, a place to eat. Deliberately *not* a
  third day-view: it has no card, no strip, no timers, and `#datelab`/`#rail` are hidden
  while it's open (the tab row stays — it's how you leave). It's the third tab next to today/rhythm (big tap targets, and
  getting back is self-evident); a right-swipe on `#m-ideas` also returns to the card,
  same commit-sideways rule as the day swipe. `#m-ideas` needs `touch-action:pan-y` for
  that — without it the browser claims the horizontal gesture and fires pointercancel.
  The sky is hidden here too: the drawer isn't a day, so there's nothing to report.
  - An idea is `{id, title, notes, url, created}` in `S.ideas`.
  - It leaves the drawer exactly two ways, and both turn it into a normal task:
    onto today (`pullIdea` → `S.tasks`) or onto a future day (`scheduleIdea` →
    `S.plans[key]`, reusing the planning machinery that already existed).
  - The task carries `fromIdea:{notes,url}`. `rollover()` uses that to put it **back**
    in the drawer if the day ends with it unpunched — the point of the drawer is that
    an undated idea shouldn't silently become a chore you drag between days. A *punched*
    one is finished and does not come back.
  - The month grid only allows today..`MAX_AHEAD`, matching what the day rail can reach.
  - Traffic goes both ways: `deferTask()` on the edit sheet takes an unfinished task off
    today's card, either onto tomorrow's plan or back into the drawer as an idea. Like
    `removeTask()`, the time it logged today leaves with it — `snapshot()` rebuilds the
    day's record from whatever is still on the card — so both actions offer undo.
  - A scheduled idea stays visible in the drawer, greyed, under an "On the calendar"
    divider, and is read back out of `S.plans` rather than copied into `S.ideas` — one
    source of truth, nothing to resync if the plan changes. Tapping it offers to move
    the date or return it to the drawer.

- **The header tint.** The `header` carries a gradient from the current phase's sky
  colour down to plain `--paper`, reaching paper before the strip so there's no seam.
  The phase colour is the `SKY` constant (which had gone dead when the old background
  rect was removed — this gave it a job again), set as `--skyraw` by `paintSky()` and
  mixed into the paper with `color-mix` rather than used neat, so one set of colours
  works on both themes. The flat `background:var(--paper)` declared just before the
  gradient is a real fallback: without `color-mix` the gradient is dropped and the
  header is plain paper. Tint and art share a switch — turn off "Sky in the header"
  and both go, and neither shows in the drawer.
  This is the one sanctioned exception to "flat everywhere" beyond the art itself;
  Bobby asked for it after seeing it mocked up.

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
history{}, ideas[], lastDay, running, settings{}, sky?, palette?, greeting?}`. Tasks:
`{id, title, daily, done, sec, target, hueIdx, created, doneAt?, carried?, fromIdea?}`.
Ideas: `{id, title, notes, url, created}`. Settings: `{theme, sound, haptics,
cardHours, dayStart, autoStop, sky, weather}`. There's an Export/Import (JSON) backup
in Settings — the migration path when the storage origin changes (e.g. file:// → Pages).

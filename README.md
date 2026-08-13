# Punchcard

A daily task card you punch out as you go. Runs entirely on your phone — no account,
no server, no network calls. Your data lives in the browser's storage on that device.

## Getting it onto your Android phone

### Option A — the quick way (no hosting)
1. Put `index.html` in your phone's Downloads (email it to yourself, Google Drive, USB).
2. Open it with Chrome.
3. It works and saves your tasks. You just won't get a home-screen icon or offline
   caching, because Chrome restricts `file://` pages.

### Option B — a real installable app (recommended, ~5 minutes, free)
Any static host over HTTPS turns this folder into an installable Android app.

**GitHub Pages**
1. Create a new public repo, upload every file in this folder to the root.
2. Settings → Pages → Source: `main` / root → Save.
3. Open the URL Chrome gives you on your phone.
4. Chrome menu (⋮) → **Add to Home screen** / **Install app**.

It then launches full-screen with its own icon, works offline (service worker), and
behaves like any other app in your launcher. Netlify Drop (drag the folder onto
netlify.com/drop) does the same thing in about thirty seconds.

### Option C — an actual APK
Wrap this folder with [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap)
or [Capacitor](https://capacitorjs.com/) if you want a `.apk` to sideload or ship to
the Play Store. You need Node and the Android SDK installed for either.

## What's in here
- `index.html` — the entire app: markup, styles, logic. No build step, no dependencies.
- `manifest.json` — name, colours, icons for installation.
- `sw.js` — service worker; caches the app so it opens offline.
- `icon-*.png` — launcher icons.

## Using it
- **Add** — type at the bottom, Enter or +. Tap `daily` first to make it recurring.
- **Punch out** — tap the circle. It punches through, chads fly, sound + vibration.
- **Time** — tap play to start the clock. Only one task runs at a time. The timer
  stores *when* you started rather than counting seconds, so it stays accurate
  through a locked screen, an app switch, Chrome discarding the tab, or a reboot.
  A session left running is capped (4h by default, configurable in Settings).
- **Reorder** — press and hold a task for a moment until it lifts, then drag it
  where you want. The edit sheet also has move up/down buttons if you'd rather tap.
- **Edit** — tap a task's name: rename, set a target time, nudge logged time up or
  down (for when you forget to hit play), delete.
- **Rhythm tab** — today's split, fourteen-day history, streaks for daily tasks.
- **Settings (gear)** — light/dark/auto, card length, when your day rolls over,
  sound, vibration, and JSON export/import for backups.

## Day rollover
At your chosen hour (4am by default) the card resets: daily tasks come back unchecked
with the clock at zero, finished one-offs drop away, unfinished ones carry over
marked `carried`. The previous day's totals go into history for the charts.

## Two copies at once
Opening the HTML file from Downloads makes Chrome start a *new tab* each time, so it's
easy to end up with several copies of the app running. Each write carries a revision
number and a background copy will never overwrite a newer one — but the cleanest fix is
to host it and install it, so there's only ever one.

## Backups
Settings → Export writes a JSON file. Clearing Chrome's site data wipes the app's
storage, so export occasionally if the history matters to you.

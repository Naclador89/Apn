# Breathless — Gasping for More

A single-file breath-hold / apnea training web app. No build step, no
dependencies, no backend — just open `index.html`. Installable as a PWA on
mobile and desktop.

## Features

- **Three session goals**: Reps, Time, and Scenario training.
- **Scenario sub-modes**: Stopwatch, Sudden Death Hold, Sudden Death Speed,
  Sudden Death Mixed, Time Attack, and Rhythm Rush — each a different
  challenge format with its own pacing and (for the fail-based modes) an
  optional Lives system so a miss doesn't have to end the session instantly.
- **Gamification**: XP, ranks, streaks, and personal-best records across
  sessions.
- **Custom probability curves**: shape the timing/randomness of holds with an
  editable curve (Uniform, Skew low, Middle, Skew high, or hand-drawn) for both
  rest and hold phases.
- **Camera control**: use a webcam instead of touch to detect hold/release,
  with guided calibration and light-adaptation.
- **Screen-color cues**: an optional full-screen green/yellow/red overlay
  (with a crisp colored border) that visually signals breathe/get-ready/hold
  alongside the usual voice/tone/vibration cues.
- **Presets**: save, load, and delete your own training configurations.
- **History & stats**: sessions are tracked locally; clear the history anytime.
- **Bilingual UI**: German and English (`de` / `en`), switchable in the header
  (a handful of other languages are prepared but not yet fully translated).
- **Fully local**: all data lives in `localStorage` on your device — nothing is
  sent anywhere.

## Running locally

Because it's a single static file, any of these work:

```bash
# Just open it
xdg-open index.html        # Linux
open index.html            # macOS

# …or serve it (needed for PWA install-to-homescreen behaviour;
# note there is no service worker, so there's no offline cache — it's
# just a single static file served over HTTP)
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Deploying

The app is a static `index.html`, so it deploys anywhere that serves static
files. With **GitHub Pages**: enable Pages for this repository (Settings →
Pages → Deploy from branch → `main` / root) and the app is live.

## Safety

> **Breath-hold training carries real risks.** Never practise static apnea in or
> near water without trained, active supervision. Do not train to the point of
> blackout. This app is a training aid, not medical advice — train responsibly.

## Structure

```
index.html             # the entire app: markup, styles, logic, i18n strings
manifest.webmanifest    # PWA manifest (name, icons, theme colors)
icon.svg                # app icon source
```

For a technical deep-dive into the app's architecture (state machine,
scenario engine, settings/i18n system, known issues) see `CLAUDE.md` and
`ARCHITECTURE.md`.

# Breath-hold trainer (Apnea)

A single-file, offline-capable breath-hold / apnea training web app. No build
step, no dependencies, no backend — just open `index.html`. Installable as a PWA
on mobile and desktop.

## Features

- **Three session goals**: Reps, Time, and Scenario training.
- **Custom probability curves**: shape the timing/randomness of holds with an
  editable curve (Uniform, Skew low, Middle, Skew high, or hand-drawn) for both
  rest and hold phases.
- **Presets**: save, load, and delete your own training configurations.
- **History & stats**: sessions are tracked locally; clear the history anytime.
- **Bilingual UI**: German and English (`de` / `en`), switchable in the header.
- **Fully local**: all data lives in `localStorage` on your device — nothing is
  sent anywhere.

## Running locally

Because it's a single static file, any of these work:

```bash
# Just open it
xdg-open index.html        # Linux
open index.html            # macOS

# …or serve it (needed for PWA install / service-worker behaviour)
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
index.html   # the entire app (markup, styles, logic, i18n, PWA manifest)
```

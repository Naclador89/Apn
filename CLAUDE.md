# Breathless — orientation guide for Claude Code

Read this first when picking up work in this repo. For the deep technical
reference (full field tables, call-site inventories, known issues), see
`ARCHITECTURE.md`.

**Keep both files current.** Whenever you add, rename, or remove a feature,
function, setting, or scenario — or discover a new inconsistency — update
the relevant section here and in `ARCHITECTURE.md` in the same change. These
docs are only useful if they don't drift from the code.

## What this is

Breathless ("Gasping for More") is a breath-hold training PWA, built as a
**single HTML file with no build step**: `index.html` contains all markup,
CSS, JS, and i18n strings. There is no bundler, no package.json, no test
runner — just open the file or serve it statically.

```
index.html            everything: markup, styles, logic, i18n strings
manifest.webmanifest   PWA manifest (name, icons, theme colors)
icon.svg               app icon source (also duplicated as an inline
                        data-URI favicon at index.html:~11 — the two are
                        NOT auto-synced; update both if you change the icon)
README.md              user-facing overview
CLAUDE.md              this file
ARCHITECTURE.md         deep technical reference
```

`index.html`'s `<script>` block runs `926`–`3749`, wrapped in a single
`"use strict"` IIFE. `$(id)` is a `getElementById` shorthand defined near the
top of that block.

## Core architecture at a glance

**Global session state**: a single object `S` (declared `let S = null;` at
`index.html:2159`) holds everything about the in-flight session. It's built
by `buildPlan()` (`index.html:2235`) at session start and set back to `null`
at the end of `finish()`/`stopSession()`. Many fields are *not* set in
`buildPlan()` — they're added ad hoc by whichever function first needs them
(rep counters, scenario phase fields, timer handles). See
`ARCHITECTURE.md § Global state` for the full field table.

Module-level state sits right above `S`: `holding` (is the hold currently
active — mutated at 13 call sites, no shared setter), `lastCueKind`,
`curScreenColorState`, and the various timer handles (`restTimer`,
`reactTimer`, `swRestTimer`, `clockTimer`, `releaseTimer`), plus the `cam`
object for camera control.

**Two parallel session paths**, forking at the shared entry points
`pressStart()`/`pressEnd()` (`index.html:3139`/`3177`) based on
`S.goal === "scenario"`:

- **Reps / Time** (`S.goal` = `"reps"` or `"time"`): `armReady()` →
  `beginRep()` → `loop()` (RAF, delta-time) → `completeRep()` → `nextRep()`
  → back to `beginRep()`. This is the only path with the strict-mode /
  penalty / late-start-tolerance system (`S.strict`, `S.penalty`,
  `S.lateTol`, `startReactionWindow()`).
- **Scenario** (`S.goal === "scenario"`, 6 sub-modes — see table below):
  `armReadyScenario()` → `bootFirstPress()` → `pressStartStopwatch()` /
  `pressEndStopwatch()` → `finalizeStopwatchRelease()`, driven by
  `stopwatchHoldLoop()` (timestamp-based, not delta-integrated) plus
  per-scenario timers (`S.sd_timer`, `S.rr_timer`).

Both paths funnel into `finish()` (`index.html:3266`) on success/game-over.
Manually hitting Stop calls `finish()` for scenario sessions but
`stopSession()` (`index.html:3334`, no history/gamification bookkeeping) for
reps/time — this asymmetry is intentional-looking but undocumented; see
`ARCHITECTURE.md § Known Issues`.

**Scenario engine** (dispatch table, all set up in `armReadyScenario()`,
`index.html:2437`):

| Scenario | Phase concept | Timer |
|---|---|---|
| `stopwatch` | none — freeform hold/release | `swRestTimer` |
| `sd_hold` | none — must beat previous hold or lose a life | `swRestTimer` (shared with stopwatch) |
| `sd_speed` | `S.sd_phase`: action ↔ rest | own `S.sd_timer` |
| `sd_mixed` | `S.sd_phase`: action → hold → pause | own `S.sd_timer` |
| `timeattack` | none — accumulate hold time to a target | none (RAF-driven) |
| `rhythm` | implicit, via `S.rr_level`/`S.rr_countIn` | own `S.rr_timer` |

Naming is **not** consistent across scenarios (`sd_`/`sw`/`ta_`/`rr_`
prefixes don't map 1:1 to what they claim — e.g. `sd_hold` never sets
`S.sd_phase` at all). Don't assume a prefix tells you which scenarios use a
field; check `ARCHITECTURE.md § Scenario engine` or grep.

**Cue/feedback layer**: three *different*, overlapping small dispatchers —
`setCue(kind,...)` (`index.html:3095`, `kind` ∈ `"up"/"down"/"rest"`, also
always calls `applyScreenColor()`), `cmd(kind)` (`index.html:2065`, `kind` ∈
`"down"/"up"/"hold"`, drives speech+beep+vibrate), and `tick(kind)`
(`index.html:2045`, lighter beep+vibrate only, for rapid action-phase taps).
Don't confuse `setCue`'s and `cmd`'s `kind` — they share two string values
but are different enumerations for different purposes.

**Screen-color mode** (`applyScreenColor()`, `index.html:2392`): two overlay
layers, `#screenColorLayer` (slow ambient fill) and
`#screenColorBorderLayer` (instant, fully-opaque 10px border using the
theme's `--good`/`--rise`/`--bad` vars) — both driven by the same 3-state
derivation (green/yellow/red) computed once per call. When a real late-start
tolerance window is ticking (reps/time only, `S.penalty` + `S.lateTol > 0`),
the yellow ramp is paced to `S.lateTol` seconds instead of a fixed cosmetic
duration; see `ARCHITECTURE.md § Cue/feedback system` for the derivation
logic.

**Settings / persistence**: `SETTING_IDS` (`index.html:1616`, 40 element
IDs) + `KV`/`readAll()`/`writeAll()` (`index.html:932`/`1625`/`1633`)
round-trip the whole settings form through `localStorage` key
`lat.settings`. `buildPlan()` independently re-reads the same DOM elements
(with its own clamping) rather than reusing `readAll()`'s output — a
dual-source-of-truth pattern to keep in mind if you add a new setting (wire
it into *both* `SETTING_IDS` and `buildPlan()`, and usually
`updateSummaries()` too).

**i18n**: `I18N` object (`index.html:940`) defines 11 languages; only
`de`/`en` are complete (207/207 keys each) and exposed via
`SUPPORTED_LANGS = ["de","en"]` (`index.html:1328`) — the other 9 are
intentional 27-key stubs, not dead code, not reachable. `T()` merges
`en.strings` (fallback) with the active language. **Known gap**: the
`sd_hold`/`sd_speed`/`sd_mixed`/`timeattack` scenario engines have large
amounts of hardcoded German UI text that bypasses `T()` entirely — see
`ARCHITECTURE.md § Known Issues` before touching those code paths.

## Known inconsistencies (condensed — see `ARCHITECTURE.md § Known Issues` for full detail)

- Sudden Death (hold/speed/mixed) + Time Attack scenario text is mostly
  hardcoded German, unlike `stopwatch`/`rhythm` which are properly localized.
- `finish()`/`stopSession()` share a near-duplicated teardown block and
  differ in whether they record history/gamification on early stop.
- `holding` is mutated at 13 call sites with no shared setter; the
  `pendingRelease`-resume logic is duplicated verbatim in two places.
- Validation errors, some dialogs (`alert`/`confirm`), and `aria-label`s are
  hardcoded English, bypassing `T()`.
- A handful of magic numbers (150ms tap threshold, 650ms rep pacing delay,
  camera adapt-alpha 0.03, rhythm ±260ms timing window) have no inline
  explanation.

## Camera control & Lives system (one-liners — see `ARCHITECTURE.md` for detail)

- Camera control (`index.html:3361` on) drives the exact same
  `pressStart()`/`pressEnd()` as touch/keyboard via `camOnPress()`/
  `camOnRelease()` — it's a genuine drop-in input source, works in every
  session type. No mid-session stream-loss detection exists yet.
- Lives system (`tryLoseLife()`, `index.html:2383`) is wired into exactly
  `sd_hold`, `sd_speed`, `sd_mixed`, `rhythm` — `stopwatch`/`timeattack` have
  no fail condition, so lives are structurally inapplicable there
  (`scenarioSupportsLives()`, `index.html:2118`).

## Workflow notes for this repo

- Always develop on the branch named in your task instructions; never push
  elsewhere without asking.
- No test suite exists. Verify changes with: (1) `node --check` on the
  extracted `<script>` block, (2) headless-Chromium Playwright scripts
  driving the actual UI (this is the established pattern throughout the
  project's history — see commit log), (3) screenshots for anything visual.
- This file and `ARCHITECTURE.md` are the map. If you spend more than a
  couple of minutes re-deriving something about the app's structure that
  isn't written down here, that's a signal to add it once you're done.

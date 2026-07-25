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
runner — just open the file or serve it statically. The one deliberate
exception is `sw.js`, the offline service worker (SWs cannot be inlined).

```
index.html            everything: markup, styles, logic, i18n strings
sw.js                 offline service worker (precache + stale-while-
                        revalidate). BUMP its CACHE version string whenever
                        index.html or a precached asset changes, or returning
                        users keep the previous version one visit longer.
manifest.webmanifest   PWA manifest (name, icons, theme colors)
icon.svg               app icon source (also duplicated as an inline
                        data-URI favicon at index.html:~11 — the two are
                        NOT auto-synced; update both if you change the icon)
README.md              user-facing overview
CLAUDE.md              this file
ARCHITECTURE.md         deep technical reference
```

`index.html`'s `<script>` block runs `1000`–`4330`, wrapped in a single
`"use strict"` IIFE. `$(id)` is a `getElementById` shorthand defined near the
top of that block.

## Core architecture at a glance

**Global session state**: a single object `S` (declared `let S = null;` at
`index.html:2539`) holds everything about the in-flight session. It's built
by `buildPlan()` (`index.html:2660`) at session start and set back to `null`
at the end of `finish()`/`stopSession()`. Many fields are *not* set in
`buildPlan()` — they're added ad hoc by whichever function first needs them
(rep counters, scenario phase fields, timer handles). See
`ARCHITECTURE.md § Global state` for the full field table.

Module-level state sits right above `S`: `holding` (is the hold currently
active), `lastCueKind`, `curScreenColorState`, and the various timer handles
(`restTimer`, `reactTimer`, `swRestTimer`, `clockTimer`, `releaseTimer`),
plus the `cam` object for camera control. `holding` is set directly at 9
call sites; the two that were verified near-verbatim duplicates are
centralized behind `resumeHeldRelease(loopFn)` and `releaseHold()` — see
`ARCHITECTURE.md § Known Issues` for why the other 7 weren't forced into the
same helpers. `holding` has a companion, `activePointerId` — the
`pointerId` of the touch/pointer currently driving the hold (`null` for
camera-/keyboard-driven holds, which have no pointer). `pressStart()`/
`pressStartStopwatch()`/`resumeHeldRelease()` take an optional `pointerId`
argument and set it; `pressEnd()` checks it and ignores a
pointerup/pointercancel/lostpointercapture from a pointer that isn't the
active one, so a second finger touching down and lifting elsewhere on the
screen can't cut a hold short (previously the biggest offender was the
`window`-level `pointerup` fallback next to `holdBtn`'s listeners, which had
zero pointer filtering at all).

**Two parallel session paths**, forking at the shared entry points
`armReady()`/`pressStart()`/`pressEnd()` (`index.html:2791`/`3392`/`3423`)
based on `S.goal === "scenario" && !usesRepsEngine(S.scenario)` — where
`usesRepsEngine(scn)` (`index.html:2484`) is `interval`/`co2`/`o2`:

- **Reps / Time / Interval Sequence / CO₂-O₂ tables** (`S.goal` = `"reps"`
  or `"time"`, or `S.goal === "scenario"` with a `usesRepsEngine()`
  scenario): `armReady()` →
  `beginRep()` → `loop()` (RAF, delta-time) → `completeRep()` → `nextRep()`
  → back to `beginRep()`. This is the only path with the strict-mode /
  penalty / late-start-tolerance system (`S.strict`, `S.penalty`,
  `S.lateTol`, `startReactionWindow()`). **These scenarios deliberately
  keep `S.goal === "scenario"` for the whole session** — they never
  masquerade as `S.goal === "reps"` **or** `S.goal === "time"` — and
  instead get the `usesRepsEngine()` exception at the exact 3
  dispatch points above, so they ride the entire reps engine unmodified
  while still being excluded from the Reps-/Time-mode personal-best
  records and correctly tagged in history. Interval additionally has phase
  machinery (see "Interval Sequence" below); the CO₂/O₂ tables only feed a
  fixed per-round schedule into `holdDurationFor()`/`restSecsForNext()`
  (see "CO₂ / O₂ tables" below).
- **Scenario** (`S.goal === "scenario"`, the other 6 sub-modes — see table
  below): `armReadyScenario()` → `bootFirstPress()` → `pressStartStopwatch()`
  / `pressEndStopwatch()` → `finalizeStopwatchRelease()`, driven by
  `stopwatchHoldLoop()` (timestamp-based, not delta-integrated) plus
  per-scenario timers (`S.sd_timer`, `S.rr_timer`). Every one of these is
  press-gated.

Both paths funnel into `finish()` (`index.html:3807`) on success/game-over —
this is what records history/gamification. Manually hitting Stop always
calls `stopSession()` (`index.html:3864`) instead, for both session types:
an aborted session is never recorded, only a natural end is.

**Scenario engine** (dispatch table, all set up in `armReadyScenario()`,
`index.html:2907`):

| Scenario | Phase concept | Timer |
|---|---|---|
| `stopwatch` | none — freeform hold/release | `swRestTimer` |
| `sd_hold` | none — must beat previous hold or lose a life | `swRestTimer` (shared with stopwatch) |
| `sd_speed` | `S.sd_phase`: action ↔ rest | own `S.sd_timer` |
| `sd_mixed` | `S.sd_phase`: action → hold → pause | own `S.sd_timer` |
| `timeattack` | none — accumulate hold time to a target | none (RAF-driven) |
| `rhythm` | implicit, via `S.rr_level`/`S.rr_countIn` | own `S.rr_timer` |

`interval`, `co2`, and `o2` are deliberately **not** in this table — they
never call `armReadyScenario()` (they ride the reps engine, see
`usesRepsEngine()` above).

Naming is **not** consistent across scenarios (`sd_`/`sw`/`ta_`/`rr_`
prefixes don't map 1:1 to what they claim — e.g. `sd_hold` never sets
`S.sd_phase` at all). Don't assume a prefix tells you which scenarios use a
field; check `ARCHITECTURE.md § Scenario engine` or grep.

**Interval Sequence** (`S.scenario === "interval"`, 2–6 phases,
`index.html:3508`-`3277`): each phase is configured by picking one of your
saved **presets** from a dropdown (`ivPhasePreset1..6`), so running the
sequence feels exactly like running several independent Reps *or Time*
sessions back to back — press-gated, with the same hold/rest probability
curves, strict mode, penalty, and late-start tolerance as the standalone
mode the preset was saved from, phase by phase. **A phase can be either
rep-count-driven or duration-driven**, decided by the assigned preset's own
saved `goal` (`"reps"` vs `"time"`) — `applyRepsConfig(cfg, src)`
(`index.html:2653`) sets `cfg.iv_phaseMode` accordingly (`S.iv_phaseMode` at
runtime) and either rolls `cfg.totalReps` or carries over `cfg.totalMin`
with `cfg.totalReps = null`. Preset-select dropdowns tag each option with
its mode (`(Reps)`/`(Time)`, via `populatePresetOptions()`,
`index.html:2254`) so it's clear which is which before assigning it to a
phase. Mechanically this works by reusing the entire Reps engine unmodified
(see above) plus one hook: `nextRep()`'s end-of-session check
(`index.html:3540`) now fires on **either** `S.done >= S.totalReps` (a
reps-mode phase) **or** the phase's own `S.endAt` timestamp elapsing
(`S.iv_phaseMode === "time"` — `S.endAt`/`S.iv_phaseStartAt` are set in
`bootFirstPress()` for phase 1 and in `ivAdvancePhase()` for every phase
after, deliberately reusing the same fields standalone Time mode uses
rather than inventing parallel `iv_`-prefixed ones, since they're
per-phase-scoped for interval and never read by the `S.goal==="time"`-gated
code that owns them normally — see `timeUp()`/`sessionProgress()`/
`applyPenalty()`/`penaltyNote()`, all of which got a
`S.scenario==="interval" && S.iv_phaseMode==="time"` sibling branch
alongside their existing `S.goal==="time"` check, precisely because
`S.goal` itself must never become `"time"` here — same PR-record-
contamination reasoning as why it never becomes `"reps"`, see below).
`ivAdvancePhase()` (`index.html:3523`) re-applies the next phase's preset
onto the live `S` via `applyRepsConfig(S, presetObj)`, resets `S.done` to 0
(per-phase, so `#repNow`/`#repTotal` behave exactly as a fresh Reps session
would — hidden entirely for a time-based phase, same as standalone Time
mode), and swaps in that phase's captured probability curve via
`applyIvPhaseCurve()` (`index.html:1654`). The true cross-phase rep total is
tracked separately in `S.iv_totalDone` (incremented in `completeRep()`),
since `S.done` itself is per-phase; `finish()` reports `S.iv_totalDone`
instead of `S.done` for interval sessions. Presets capture their
probability-curve shape too (`presetSave()`/`presetLoad()`), and a
mid-session curve swap is restored from `S.iv_savedCurves` (snapshotted at
session start) in `teardownSessionTimers()` — purely in memory, **never**
via `saveCurves()`, so the user's own hand-drawn curve shapes in
`localStorage` are never touched by an Interval Sequence run, whether it
ends naturally or via manual Stop. `ivUpdatePhaseIndicator()`
(`index.html:3508`) reuses the `#swStats` slot (shared with the other
scenarios) to show "Phase X/Y" and the active preset's name. An old preset
saved before curve-capture existed (no `.curves` key) falls back to a
blank/uniform-random curve rather than crashing.

**CO₂ / O₂ tables** (`S.scenario === "co2"`/`"o2"`): classic apnea training
tables as first-class scenarios. CO₂ = fixed hold, rest shrinks each round;
O₂ = hold grows each round, rest fixed. Both ride the reps engine via
`usesRepsEngine()` with exactly two hooks: `buildPlan()` computes
`cfg.tableSchedule` (`[{hold, rest}]` per round, `rest` = rest *before* that
round, floor 3 s, `totalReps` = rounds 2–10) and `holdDurationFor()`/
`restSecsForNext()` return the scheduled values instead of sampling curves.
Tables force `strict=false, penalty=false, hide=false` in `buildPlan()` — an
early release only pauses the hold (`heldMs` keeps accumulating on
re-press), no penalties, so table semantics stay predictable regardless of
the user's saved difficulty settings. `tableUpdateStats()` reuses the shared
`#swStats` slot (like interval's phase indicator) to show the current round's
hold target and the upcoming rest. Completing a table sets a
`tableComplete` finish message and chases a per-table personal best
(`rec.co2`/`rec.o2` = total held seconds; excluded from the generic pace
record like every scenario). No fail concept → no lives
(`scenarioSupportsLives()` unchanged).

**Cue/feedback layer**: three *different*, overlapping small dispatchers —
`setCue(kind,...)` (`index.html:3614`, `kind` ∈ `"up"/"down"/"rest"`, also
always calls `applyScreenColor()`), `cmd(kind)` (`index.html:2419`, `kind` ∈
`"down"/"up"/"hold"`, drives speech+beep+vibrate), and `tick(kind)`
(`index.html:2399`, lighter beep+vibrate only, for rapid action-phase taps).
Don't confuse `setCue`'s and `cmd`'s `kind` — they share two string values
but are different enumerations for different purposes.

**Screen-color mode** (`applyScreenColor()`, `index.html:2862`): two overlay
layers, `#screenColorLayer` (slow ambient fill) and
`#screenColorBorderLayer` (instant, fully-opaque 10px border using the
theme's `--good`/`--rise`/`--bad` vars) — both driven by the same 3-state
derivation (green/yellow/red) computed once per call. When a real late-start
tolerance window is ticking (reps/time only, `S.penalty` + `S.lateTol > 0`),
the yellow ramp is paced to `S.lateTol` seconds instead of a fixed cosmetic
duration; see `ARCHITECTURE.md § Cue/feedback system` for the derivation
logic.

**Settings / persistence**: `SETTING_IDS` (`index.html:1895`, 56 element
IDs — 7 of them are the Interval Sequence scenario's per-phase fields,
`ivPhaseCount` + `ivPhasePreset1..6`, each a `<select>` of saved preset
names rather than a raw numeric field; 7 more are the CO₂/O₂ table fields
`tableRounds`/`co2Hold`/`co2Rest`/`co2Dec`/`o2Hold`/`o2Inc`/`o2Rest`; plus
`rrWindow`, the now-configurable Rhythm Rush timing window, 80–600 ms) +
`KV`/`readAll()`/`writeAll()`
(`index.html:1018`/`1776`) round-trip the whole settings form through
`localStorage` key `lat.settings`. `buildPlan()` independently re-reads the
same DOM elements (with its own clamping) rather than reusing `readAll()`'s
output — a dual-source-of-truth pattern to keep in mind if you add a new
setting (wire it into *both* `SETTING_IDS` and `buildPlan()`, and usually
`updateSummaries()` too). This one is still open — see
`ARCHITECTURE.md § Known Issues`. Presets (`presetSave()`/`presetLoad()`,
`index.html:2264`/`2117`) capture the *entire* `readAll()` output plus the
current probability-curve shape — this is what lets an Interval Sequence
phase reproduce a full Reps- or Time-mode session exactly, including
hold/rest timing curves, from a single dropdown pick.
**Export/import** (`exportData()`/`importData()`, buttons in the Presets &
stats panel) back up every `lat.`-prefixed `localStorage` key to a JSON
file and restore it — only `lat.*` keys are ever written back, and a
successful import ends in `location.reload()` (the simplest correct full
re-init). The same panel shows a **records overview** (`renderRecords()`,
`#recordsBox`): one line per nonzero `g.rec` personal best, rendered via
the same `recordLabel()`/`recordValue()` pair the finish-screen badges use.

**i18n**: `I18N` object (`index.html:1026`) defines 11 languages; only
`de`/`en` are complete (fully in sync key-for-key) and exposed via
`SUPPORTED_LANGS = ["de","en"]` (`index.html:1590`) — the other 9 are
intentional stubs, not dead code, not reachable. `T()` merges `en.strings`
(fallback) with the active language. All nine scenarios (including the
Sudden Death family and Time Attack, which used to bypass this, and the
CO₂/O₂ tables) route their UI text through `T()`; validation errors,
`alert`/`confirm` dialogs, and `aria-label`s do too (`data-i18n-aria` +
`applyRuntimeI18n()`).

## Known inconsistencies (condensed — see `ARCHITECTURE.md § Known Issues` for full detail)

Resolved in a follow-up pass (kept here as a record, not deleted): Sudden
Death/Time Attack hardcoded-German text, the `finish()`/`stopSession()`
history-recording asymmetry + duplicated teardown, the two verified
`holding`-flag duplications, hardcoded validation/dialog/`aria-label`
strings, missing camera stream-loss detection, unexplained magic numbers,
and multitouch spuriously ending an in-progress hold (a second finger
lifting anywhere on the screen no longer calls `pressEnd()` unless it's the
pointer that actually started the hold — see `activePointerId` above).

Resolved in a third review pass: the generic "Best pace" record being
contaminated by tap scenarios (rhythm/`sd_mixed` tap tempos — now gated to
press-gated rep sessions in `commitGameSession()`); `sd_speed` losing an
in-flight rep at the action-phase boundary when `releaseGrace > 0` (now
`flushPendingRelease()`, same as `sd_mixed`); Interval Sequence re-reading
presets from `localStorage` at each phase advance (deleting one mid-session
soft-locked the session — presets are now snapshotted into
`S.iv_phasePresetObjs` at `buildPlan()` time); an interval time-phase
starting one extra rep when its deadline passed during a rest countdown
(`ivPhaseTimeUp()` now also checked in `beginRep()`); and the last
hardcoded-English UI text (stats box, curve-overlay titles, eyes-closed tap
hint, "Wdhs" plural — all through `T()` now). `updateSummaries()` also
names Time Attack/Rhythm in the goal summary, and history entries now store
`scenario` alongside `goal`.

Still open, deliberately left as documented rather than fixed:
- `readAll()`/`buildPlan()` dual source of truth for settings — can
  silently diverge on out-of-range input.
- Naming inconsistencies: `sw`/`sd_`/`ta_`/`rr_` prefixes don't map cleanly
  to their scope; `S`'s scenario-state fields mix snake-ish prefixes with
  the rest of `S`'s camelCase. Full rename = large diff for cosmetic gain.
- Confetti palette and curve-editor stroke color hardcode hex values close
  to but not identical to the theme's `--good`/`--bad`/`--rise` — a
  subjective cosmetic call, not a bug.
- 9 of 11 `I18N` languages are intentional stubs, gated off by
  `SUPPORTED_LANGS`.
- Loading a pre-curve-capture preset (no `.curves` key) blanks the stored
  hand-drawn curves via `presetLoad()`'s `saveCurves()` — full-restore
  semantics, only affects legacy presets; documented, not changed.
- Rest/late-start countdowns are tick-counted `setInterval`s, so
  background-tab throttling stretches them (deadline-based timestamps
  would be exact) — see `ARCHITECTURE.md § Known Issues` for why this and
  the RAF hold loop freezing while hidden are left as-is.

## Camera control & Lives system (one-liners — see `ARCHITECTURE.md` for detail)

- Camera control (`index.html:3875` on) drives the exact same
  `pressStart()`/`pressEnd()` as touch/keyboard via `camOnPress()`/
  `camOnRelease()` — it's a genuine drop-in input source, works in every
  session type. Mid-session stream loss (permission revoked, device
  unplugged) is now detected (`camWatchStreamTracks()`) and surfaced with a
  `camStreamLost` message instead of silently freezing.
- Lives system (`tryLoseLife()`, `index.html:2853`) is wired into exactly
  `sd_hold`, `sd_speed`, `sd_mixed`, `rhythm` — `stopwatch`/`timeattack`/
  `interval` have no fail condition, so lives are structurally inapplicable
  there (`scenarioSupportsLives()`, `index.html:2472`).

## Workflow notes for this repo

- Always develop on the branch named in your task instructions; never push
  elsewhere without asking.
- After changing `index.html` (or any precached asset), bump the `CACHE`
  version string in `sw.js` in the same commit — that's what makes deployed
  clients pick up the new version.
- No test suite exists. Verify changes with: (1) `node --check` on the
  extracted `<script>` block, (2) headless-Chromium Playwright scripts
  driving the actual UI (this is the established pattern throughout the
  project's history — see commit log), (3) screenshots for anything visual.
- This file and `ARCHITECTURE.md` are the map. If you spend more than a
  couple of minutes re-deriving something about the app's structure that
  isn't written down here, that's a signal to add it once you're done.

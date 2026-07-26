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

`index.html`'s `<script>` block runs `956`–`4042`, wrapped in a single
`"use strict"` IIFE. `$(id)` is a `getElementById` shorthand defined near the
top of that block.

## Core architecture at a glance

**Global session state**: a single object `S` (declared `let S = null;` at
`index.html:2322`) holds everything about the in-flight session. It's built
by `buildPlan()` (`index.html:2451`) at session start and set back to `null`
at the end of `finish()`/`stopSession()`. Many fields are *not* set in
`buildPlan()` — they're added ad hoc by whichever function first needs them
(rep counters, scenario phase fields, timer handles). See
`ARCHITECTURE.md § Global state` for the full field table.

Module-level state sits right above `S`: `holding` (is the hold currently
active), `lastCueKind`, `curScreenColorState`, and the various timer handles
(`restTimer`, `reactTimer`, `swRestTimer`, `clockTimer`, `releaseTimer`,
`nextRepTimer`), plus the `cam` object for camera control. `holding` is set
directly at 9 call sites; the two that were verified near-verbatim
duplicates are centralized behind `resumeHeldRelease(loopFn)` and
`releaseHold()` — see `ARCHITECTURE.md § Known Issues` for why the other 7
weren't forced into the same helpers. `holding` has a companion,
`activePointerId` — the `pointerId` of the touch/pointer currently driving
the hold (`SYNTHETIC_POINTER`, a module-level `Symbol`, for
camera-/keyboard-driven holds, which have no pointer; `null` while idle).
`pressStart()`/`pressStartStopwatch()`/`resumeHeldRelease()` take an
optional `pointerId` argument and set it; `pressEnd()` checks it and
ignores a pointerup/pointercancel/lostpointercapture from a pointer that
isn't the active one, so a second finger touching down and lifting
elsewhere on the screen can't cut a hold short — including during a
camera- or keyboard-driven hold, since no real `pointerId` can ever equal
`SYNTHETIC_POINTER`; only the no-argument `pressEnd()` calls from
`camOnRelease()`/keyup can end those. (Previously the biggest offender was
the `window`-level `pointerup` fallback next to `holdBtn`'s listeners,
which had zero pointer filtering at all.)

**Two parallel session paths**, forking at the shared entry points
`armReady()`/`pressStart()`/`pressEnd()` (`index.html:2553`/`3409`/`3441`)
based on `S.goal === "scenario" && S.scenario !== "interval"`:

- **Reps / Time / Interval Sequence** (`S.goal` = `"reps"` or `"time"`, or
  `S.goal === "scenario" && S.scenario === "interval"`): `armReady()` →
  `beginRep()` → `loop()` (RAF, delta-time) → `completeRep()` → `nextRep()`
  → back to `beginRep()`. This is the only path with the strict-mode /
  penalty / late-start-tolerance system (`S.strict`, `S.penalty`,
  `S.lateTol`, `startReactionWindow()`). **Interval Sequence deliberately
  keeps `S.goal === "scenario"`/`S.scenario === "interval"` for the whole
  session** — it never masquerades as `S.goal === "reps"` **or**
  `S.goal === "time"`, even though individual phases can be either
  rep-count-driven or duration-driven (see "Interval Sequence" below) — and
  instead gets a `&& S.scenario !== "interval"` exception at the exact 3
  dispatch points above, so it rides the entire reps engine unmodified while
  still being excluded from both the Reps-mode and Time-mode personal-best
  records and correctly tagged in history.
- **Scenario** (`S.goal === "scenario"`, the other 6 sub-modes — see table
  below): `armReadyScenario()` → `bootFirstPress()` → `pressStartStopwatch()`
  / `pressEndStopwatch()` → `finalizeStopwatchRelease()`, driven by
  `stopwatchHoldLoop()` (timestamp-based, not delta-integrated) plus
  per-scenario timers (`S.sd_timer`, `S.rr_timer`). Every one of these is
  press-gated.

Both paths funnel into `finish()` (`index.html:3565`) on success/game-over —
this is what records history/gamification. Manually hitting Stop always
calls `stopSession()` (`index.html:3621`) instead, for both session types:
an aborted session is never recorded, only a natural end is.

**Scenario engine** (dispatch table, all set up in `armReadyScenario()`,
`index.html:2654`):

| Scenario | Phase concept | Timer |
|---|---|---|
| `stopwatch` | none — freeform hold/release | `swRestTimer` |
| `sd_hold` | none — must beat previous hold or lose a life | `swRestTimer` (shared with stopwatch) |
| `sd_speed` | `S.sd_phase`: action ↔ rest | own `S.sd_timer` |
| `sd_mixed` | `S.sd_phase`: action → hold → pause | own `S.sd_timer` |
| `timeattack` | none — accumulate hold time to a target | none (RAF-driven) |
| `rhythm` | implicit, via `S.rr_level`/`S.rr_countIn` | own `S.rr_timer` |

`interval` is deliberately **not** in this table — it never calls
`armReadyScenario()` (see "Interval Sequence" below).

Naming is **not** consistent across scenarios (`sd_`/`sw`/`ta_`/`rr_`
prefixes don't map 1:1 to what they claim — e.g. `sd_hold` never sets
`S.sd_phase` at all). Don't assume a prefix tells you which scenarios use a
field; check `ARCHITECTURE.md § Scenario engine` or grep.

**Interval Sequence** (`S.scenario === "interval"`, 2–6 phases,
`index.html:3239`-`3264`): each phase is configured by picking one of your
saved **presets** from a dropdown (`ivPhasePreset1..6`), so running the
sequence feels exactly like running several independent Reps *or Time*
sessions back to back — press-gated, with the same hold/rest probability
curves, strict mode, penalty, and late-start tolerance as the standalone
mode the preset was saved from, phase by phase. **A phase can be either
rep-count-driven or duration-driven**, decided by the assigned preset's own
saved `goal` (`"reps"` vs `"time"`) — `applyRepsConfig(cfg, src)`
(`index.html:2425`) sets `cfg.iv_phaseMode` accordingly (`S.iv_phaseMode` at
runtime) and either rolls `cfg.totalReps` or carries over `cfg.totalMin`
with `cfg.totalReps = null`. Preset-select dropdowns tag each option with
its mode (`(Reps)`/`(Time)`, via `populatePresetOptions()`,
`index.html:2075`) so it's clear which is which before assigning it to a
phase — and the six phase dropdowns additionally **filter out presets saved
in Scenario mode** (`repsTimeOnly` flag; `validate()` also rejects a stale
scenario-preset selection), since a phase can only reproduce a Reps- or
Time-mode session. Mechanically this works by reusing the entire Reps
engine unmodified (see above) plus one hook: `nextRep()`'s end-of-session
check (`index.html:3269`) fires on **either** `S.done >= S.totalReps` (a
reps-mode phase) **or** the phase's own `S.endAt` timestamp elapsing —
`beginRep()` re-checks the same deadline so it can't slip past during a
rest countdown, mirroring standalone Time mode's `timeUp()` check there
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
`ivAdvancePhase()` (`index.html:3248`) re-applies the next phase's preset
onto the live `S` via `applyRepsConfig(S, presetObj)`, resets `S.done` to 0
(per-phase, so `#repNow`/`#repTotal` behave exactly as a fresh Reps session
would — hidden entirely for a time-based phase, same as standalone Time
mode), and swaps in that phase's captured probability curve via
`applyIvPhaseCurve()` (`index.html:1542`). The true cross-phase rep total is
tracked separately in `S.iv_totalDone` (incremented in `completeRep()`),
since `S.done` itself is per-phase; `finish()` reports `S.iv_totalDone`
instead of `S.done` for interval sessions. Presets capture their
probability-curve shape too (`presetSave()`/`presetLoad()`), and a
mid-session curve swap is restored from `S.iv_savedCurves` (snapshotted at
session start) in `teardownSessionTimers()` — purely in memory, **never**
via `saveCurves()`, so the user's own hand-drawn curve shapes in
`localStorage` are never touched by an Interval Sequence run, whether it
ends naturally or via manual Stop. `ivUpdatePhaseIndicator()`
(`index.html:3239`) reuses the `#swStats` slot (shared with the other
scenarios) to show "Phase X/Y" and the active preset's name. An old preset
saved before curve-capture existed (no `.curves` key) falls back to a
blank/uniform-random curve rather than crashing.

**Cue/feedback layer**: three *different*, overlapping small dispatchers —
`setCue(kind,...)` (`index.html:3365`, `kind` ∈ `"up"/"down"/"rest"`, also
always calls `applyScreenColor()`), `cmd(kind)` (`index.html:2212`, `kind` ∈
`"down"/"up"/"hold"`, drives speech+beep+vibrate), and `tick(kind)`
(`index.html:2192`, lighter beep+vibrate only, for rapid action-phase taps).
Don't confuse `setCue`'s and `cmd`'s `kind` — they share two string values
but are different enumerations for different purposes.

**Screen-color mode** (`applyScreenColor()`, `index.html:2609`): two overlay
layers, `#screenColorLayer` (slow ambient fill) and
`#screenColorBorderLayer` (instant, fully-opaque 10px border using the
theme's `--good`/`--rise`/`--bad` vars) — both driven by the same 3-state
derivation (green/yellow/red) computed once per call. When a real late-start
tolerance window is ticking (reps/time only, `S.penalty` + `S.lateTol > 0`),
the yellow ramp is paced to `S.lateTol` seconds instead of a fixed cosmetic
duration; see `ARCHITECTURE.md § Cue/feedback system` for the derivation
logic.

**Settings / persistence**: `SETTING_IDS` (`index.html:1740`, 48 element
IDs — 7 of them are the Interval Sequence scenario's per-phase fields,
`ivPhaseCount` + `ivPhasePreset1..6`, each a `<select>` of saved preset
names rather than a raw numeric field) + `KV`/`readAll()`/`writeAll()`
(`index.html:962`/`1751`) round-trip the whole settings form through
`localStorage` key `lat.settings`. `buildPlan()` independently re-reads the
same DOM elements (with its own clamping) rather than reusing `readAll()`'s
output — a dual-source-of-truth pattern to keep in mind if you add a new
setting (wire it into *both* `SETTING_IDS` and `buildPlan()`, and usually
`updateSummaries()` too). This one is still open — see
`ARCHITECTURE.md § Known Issues`. Presets (`presetSave()`/`presetLoad()`,
`index.html:2091`/`2102`) capture the *entire* `readAll()` output plus the
current probability-curve shape — this is what lets an Interval Sequence
phase reproduce a full Reps- or Time-mode session exactly, including
hold/rest timing curves, from a single dropdown pick.

**i18n**: `I18N` object (`index.html:970`) defines 11 languages; only
`de`/`en` are complete (fully in sync key-for-key) and exposed via
`SUPPORTED_LANGS = ["de","en"]` (`index.html:1478`) — the other 9 are
intentional stubs, not dead code, not reachable. `T()` merges `en.strings`
(fallback) with the active language. All six scenarios (including the
Sudden Death family and Time Attack, which used to bypass this) now route
their UI text through `T()`; validation errors, `alert`/`confirm` dialogs,
`aria-label`s (`data-i18n-aria` + `applyRuntimeI18n()`), the curve-editor
overlay titles (`refreshCurveOverlayForMode()`), and the stats box
(`renderStats()` — re-rendered from `applyRuntimeI18n()` on language switch,
since its content is runtime HTML the `data-i18n` pass can't cover) do too.

## Known inconsistencies (condensed — see `ARCHITECTURE.md § Known Issues` for full detail)

Resolved in a follow-up pass (kept here as a record, not deleted): Sudden
Death/Time Attack hardcoded-German text, the `finish()`/`stopSession()`
history-recording asymmetry + duplicated teardown, the two verified
`holding`-flag duplications, hardcoded validation/dialog/`aria-label`
strings, missing camera stream-loss detection, unexplained magic numbers,
and multitouch spuriously ending an in-progress hold (a second finger
lifting anywhere on the screen no longer calls `pressEnd()` unless it's the
pointer that actually started the hold — see `activePointerId` above).

Resolved in a subsequent full code-review pass (also kept as a record):
the dead-and-broken `attachCurveDrawing("__dyn__", …)` wiring that threw a
`TypeError` on every curve-overlay draw gesture (deleted; the overlay is
driven solely by `wireOverlayCanvas()`); Sudden Death Speed losing an
in-flight rep at the action-phase boundary when `releaseGrace > 0` (now
uses `flushPendingRelease()` like Mixed); Rhythm Rush / Mixed tap counts
contaminating the generic "Best pace" record (record now gated to
rep-driven sessions — reps/time/interval); Interval phase dropdowns
offering Scenario-mode presets (filtered + validated, see Interval
Sequence above); hardcoded-English curve-overlay titles and stats box
(localized); the goal-summary chip showing nothing for Time Attack/Rhythm;
stray touches ending camera-/keyboard-driven holds (`SYNTHETIC_POINTER`,
see above); `completeRep()`'s untracked 650 ms timeout surviving into a
restarted session (now `nextRepTimer`, cleared in
`teardownSessionTimers()`); an interval time-phase deadline slipping past
during a rest countdown (`beginRep()` re-check); the never-read
`S.spokeHold` field; and the camera setup loop continuing to sample a dead
stream after stream loss.

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

## Camera control & Lives system (one-liners — see `ARCHITECTURE.md` for detail)

- Camera control (`index.html:3632` on) drives the exact same
  `pressStart()`/`pressEnd()` as touch/keyboard via `camOnPress()`/
  `camOnRelease()` — it's a genuine drop-in input source, works in every
  session type. Mid-session stream loss (permission revoked, device
  unplugged) is now detected (`camWatchStreamTracks()`) and surfaced with a
  `camStreamLost` message instead of silently freezing.
- Lives system (`tryLoseLife()`, `index.html:2600`) is wired into exactly
  `sd_hold`, `sd_speed`, `sd_mixed`, `rhythm` — `stopwatch`/`timeattack`/
  `interval` have no fail condition, so lives are structurally inapplicable
  there (`scenarioSupportsLives()`, `index.html:2265`).

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

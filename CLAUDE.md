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
- **Scenario** (`S.goal === "scenario"`, the other 7 sub-modes — see table
  below): `armReadyScenario()` → `bootFirstPress()` → `pressStartStopwatch()`
  / `pressEndStopwatch()` → `finalizeStopwatchRelease()`, driven by
  `stopwatchHoldLoop()` (timestamp-based, not delta-integrated) plus
  per-scenario timers (`S.sd_timer`, `S.rr_timer`, `S.pb_timer`). All of
  these are press-gated **except `powerbreath`**, which is fully
  timer-driven — a press there only boots the session and ends the retention
  early (see "Power Breathing" below).

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
| `powerbreath` | `S.pb_phase`: breathe → retention → recovery, per round | own `S.pb_timer` |

`interval` is deliberately **not** in this table — it never calls
`armReadyScenario()` (see "Interval Sequence" below).

Naming is **not** consistent across scenarios (`sd_`/`sw`/`ta_`/`rr_`
prefixes don't map 1:1 to what they claim — e.g. `sd_hold` never sets
`S.sd_phase` at all). Don't assume a prefix tells you which scenarios use a
field; check `ARCHITECTURE.md § Scenario engine` or grep.

**Interval Sequence** (`S.scenario === "interval"`, 2–8 phases,
`index.html:3239`-`3264`): the phases come from one of two places, picked
with the `#ivLevelSel` dropdown — a **built-in level** (`IV_LEVELS`, five of
them, `l2` is the default; see "Built-in levels" just below) or `custom`,
where each phase is configured by picking one of your saved **presets** from
a dropdown (`ivPhasePreset1..8`, cap in `IV_MAX_PHASES`). Both funnel
through `ivPhaseSrc(st, idx)`, the single place that resolves a phase index
to its settings object — built-in phases come off `S.iv_phaseObjs`, custom
ones out of `KV.get(K.presets)` — so everything downstream is identical, and
running the sequence feels exactly like running several independent Reps *or Time*
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
phase — and the eight phase dropdowns additionally **filter out presets saved
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

**Built-in levels** (`IV_LEVELS`, defined next to `applyIvPhaseCurve()`):
five ready-made sequences `l1`–`l5` (Anfänger → Ultra Extrem), 6–7 phases
each, 7:00–12:30. The key design point is that **a built-in phase is just a
plain object shaped like `readAll()`'s output — i.e. like a saved preset**,
so `applyRepsConfig()`/`applyIvPhaseCurve()` consume it unchanged and the
levels needed almost no engine code. Three builders on top of
`IV_PHASE_BASE`:
- `ivPh(label, secs, hold, rest)` — fixed hold/breathe. Uses
  `holdChance:100` with `minHold===maxHold` rather than `baseHold`, because
  only the long-hold branch of `holdDurationFor()` sets `long:true`, which
  is what puts the **seconds countdown** on screen.
- `ivMix(label, secs, holds[], rests[])` — the Flow/Chaos phases. Those are
  *ordered* HOLD/BREATHE cycles in the source spec, which the engine can't
  express (one hold + one rest are drawn per rep), so they're approximated
  as a random draw over exactly the cycle's values via a synthesized
  probability curve: `ivCurveFor(vals, min, max)` puts one narrow spike per
  value at `round((v-min)/(max-min)*(CURVE_N-1))`, and a value listed twice
  gets double weight, so each value's cycle frequency survives. Only the
  order/pairing is randomized.
- `ivBreathe(label, secs)` — **breathe-only phase**: no press at all. The
  only genuinely new engine code. `applyRepsConfig()` carries
  `S.iv_breathe`; `nextRep()` then spends the phase's remaining duration in
  the rest countdown it already has and calls `nextRep(false)` instead of
  `beginRep()` when it elapses. Never valid as phase 1 (the session needs a
  first press to boot via `bootFirstPress()`), so every level starts with a
  hold phase.

Built-in levels aren't bound by `IV_MAX_PHASES` (`iv_phasePresets` is just
an array) but all stay within it. `validate()` skips the preset-presence
checks when a level is selected, so a level runs with an empty preset store.
`ivApplyLevelVisibility()`/`ivRenderLevelInfo()` swap the manual phase
dropdowns for a read-only listing (re-rendered from `applyRuntimeI18n()`,
like `renderStats()`). Phase labels are the author's proper names and are
deliberately untranslated; only the level titles (`ivLevel1..5`) are.
A settings blob written before this existed has no `ivLevelSel`, so the init
path defaults it to `"custom"` when any `ivPhasePreset*` was assigned —
otherwise upgrading would silently replace a hand-built sequence with Level
2. Related fix in the same place: `refreshPresetSelect()` now runs **before**
`writeAll(saved)`, since assigning a `<select>.value` with no matching
`<option>` is a silent no-op and used to drop every saved phase assignment
on reload.

**Power Breathing** (`S.scenario === "powerbreath"`, Wim-Hof-/Pranayama-
inspired): the only mode in the app that is **not press-gated at all**. Each
round runs power breathing → **retention** (hold on *empty* lungs) →
**recovery** (fixed hold on *full* lungs), driven entirely by one interval
timer `S.pb_timer` (50 ms, `pbTick()`), modelled on Rhythm Rush — which is
also timer-driven and where a press means "event", not "hold". Rounds come
from `PB_ROUTINES` (three built-in routines, `standard` = 3 rounds is the
default, picked with `#pbRoutineSel`); each round is
`{breaths, inhaleMs, exhaleMs, retentionSec, recoverySec}`.

The whole integration into the press engine is **two lines**:
`pressStartStopwatch()` routes to `pbPress()` and `pressEndStopwatch()`
returns early — exactly the pattern `rhythm` already uses there. `pbPress()`
boots the session on the first press (via the shared `bootFirstPress()`,
which supplies clock/wake-lock/audio-resume/exit-guard) and otherwise only
does one thing: end the retention early. Space/Enter work for free, since the
existing `keydown` handler calls `pressStart()` anyway. `holding` is never
set, so `pressEnd()`'s `if(!holding) return` already made the release path a
no-op even before the explicit guard.

Retention ends **either** when the target elapses (auto-advance) **or** on a
tap; both book the *actually held* time into `S.pb_log`, which
`pbRenderDoneList()` turns into the per-round summary in `#doneList` on the
finish screen. During the breathing phase the cue kind stays `"up"` for the
whole phase and in/out is carried by the big text, the rising/falling
`setFill()` and the two-pitch `pbBreathCue()` — deliberately *not* by
switching cue kinds, which would make the screen-color layer flicker at a
0.9 s cadence (`applyScreenColor()` is untouched). Speech fires only every
10th breath, because `say()` cancels the previous utterance.

**Deliberately not scored**: `buildPlan()` sets `cfg.noRecord = true` and
`finish()`'s recording block is gated on `!S.noRecord`, so no history, no XP,
no records, no PB — a retention on empty lungs isn't comparable to this app's
full-lung hold PB, and there is no rep count worth turning into XP. Knock-on
effect to keep in mind: such a session also doesn't feed the daily streak or
the stats box. `scenarioSupportsLives()` excludes it automatically (there is
no fail condition).

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

**Settings / persistence**: `SETTING_IDS` (`index.html:1740`, 56 element
IDs — 10 of them belong to the Interval Sequence scenario: `ivLevelSel`
(built-in level or `custom`) plus `ivPhaseCount` + `ivPhasePreset1..8`, each
a `<select>` of saved preset names rather than a raw numeric field; plus
`pbRoutineSel` for Power Breathing)
+ `KV`/`readAll()`/`writeAll()`
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

Resolved alongside the built-in Interval levels: `writeAll(saved)` running
*before* `refreshPresetSelect()` at init, so every saved Interval phase
assignment (and the main `#presetSel` selection) was silently dropped on
reload — assigning a `<select>.value` with no matching `<option>` is a
no-op. The two calls are now in the other order.

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

## Camera control, Noise punishment & Lives system (one-liners — see `ARCHITECTURE.md` for detail)

- Camera control (`index.html:3632` on) drives the exact same
  `pressStart()`/`pressEnd()` as touch/keyboard via `camOnPress()`/
  `camOnRelease()` — it's a genuine drop-in input source, works in every
  session type. Mid-session stream loss (permission revoked, device
  unplugged) is now detected (`camWatchStreamTracks()`) and surfaced with a
  `camStreamLost` message instead of silently freezing.
- Noise punishment (microphone, `mic` module right after the camera block):
  a Difficulty-panel toggle + amount + limit slider with live level meter.
  **Only offered while the Voice-cues toggle is off** (`noiseAvailable()`;
  greyed out + `hintNoiseNeedsVoiceOff` otherwise, and switching voice cues
  on auto-unchecks it via `syncNoiseAvailability()`). Reason: an open mic
  routes output to the communication speaker on many devices, which made
  the spoken cues sound distant — a product-level resolution of a conflict
  no in-page audio setting could fix. Consequence: a violation is announced
  by **beep/vibration only** (`cmdNoise()` still speaks `S.words.noise`,
  but `say()` no-ops while voice cues are off). `applyRepsConfig()` re-checks
  the rule (`cfg.sig.speech → noisePenalty = false`) so a stale settings
  blob or an Interval phase preset can't smuggle it back in.
  If the mic's **peak** level (not RMS — peak catches short transients;
  50 ms poll over a 2048-sample window) crosses the limit while a session
  is running past its first press, the session is extended via
  `applyPenalty(S.noisePenaltyX)` (same branch logic as the early-release
  penalty, so it works for reps/time/interval time-phases alike) and
  announced via `cmdNoise()` — its own configurable cue word
  (`cmdNoiseWord`, `S.words.noise`, `cueNoise` per language), distinct from
  the early-release penalty word. 2.5 s cooldown per violation; the app's
  own speech is never punished (`synth.speaking` guard); stream loss
  disables the feature mid-session instead of freezing (`micStreamLost`).
  **`micSync()` owns the mic lifecycle** — open only during a session that
  actually uses noise punishment, or on the setup screen for the live meter;
  called from `show()`/the toggle/`applyGoalVisibility()`. This matters: an
  open mic pushes many devices into a communication audio mode that routes
  output to the earpiece speaker and makes *all* audio (including the OS
  speech cues) sound thin and far away, so the mic must never idle open.
  For the same reason the capture asks for **`echoCancellation:false`** —
  AEC requires the voice-communication path and is the strongest trigger of
  that routing switch (briefly setting it `true` caused a user-reported
  "klingt entfernt" regression; do not turn it back on). The mic also uses
  its **own** `AudioContext`, closed in `micStop()`, so the shared cue
  context is never bound to a mic source. Since AEC is off, the mic hears
  the app's own cues: `micBlank()` suspends detection while a beep or
  utterance is sounding (window estimated from the text length, trimmed on
  `onend`).
  Scoped exactly like the other difficulty fields: hidden for scenarios,
  inherited per-phase from presets by Interval Sequence
  (`applyRepsConfig()` carries `noisePenalty`/`noisePenaltyX`/`noiseThr`).
- Lives system (`tryLoseLife()`, `index.html:2600`) is wired into exactly
  `sd_hold`, `sd_speed`, `sd_mixed`, `rhythm` — `stopwatch`/`timeattack`/
  `interval`/`powerbreath` have no fail condition, so lives are structurally
  inapplicable there (`scenarioSupportsLives()`, `index.html:2265`).

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

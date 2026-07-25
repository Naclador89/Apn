# Architecture reference — Breathless

Deep technical reference for `index.html` (single-file PWA, ~4300 lines, plus the `sw.js` service worker).
Read `CLAUDE.md` first for the quick orientation; this file is the detailed
backing reference for everything summarized there.

All line numbers below reflect the file as of the documentation pass that
created this file. They will drift as the code changes — **if you notice a
reference here is off by more than a few lines, fix it while you're in the
area**, rather than leaving it stale for the next reader.

---

## 1. Global state reference

### The `S` object

Declared `let S = null;` at `index.html:2539`. Created by `buildPlan()`
(`index.html:2660`) at session start, discarded (`S = null`) at the end
of both `finish()` (`index.html:3807`) and `stopSession()` (`index.html:3864`).

**Fields set in `buildPlan()`:**

| Field | Purpose |
|---|---|
| `goal` | `"reps"` / `"time"` / `"scenario"` |
| `base`, `chance`, `minHold`, `maxHold`, `minRest`, `maxRest`, `releaseGrace`, `strict`, `penalty`, `penaltyX`, `lateTol`, `hide` | the shared hold/rest/strict/penalty difficulty field set, populated by the shared helper `applyRepsConfig(cfg, src)` (`index.html:2653`) — used both for the plain baseline (`applyRepsConfig(cfg, readAll())`) and, for Interval Sequence, re-applied per phase from a saved preset object (see `iv_*` below and § 3) |
| `iv_phaseMode`, `totalReps` / `totalMin` | also set by `applyRepsConfig()`: reads `src.goal` and sets `iv_phaseMode` to `"time"` (with `totalMin` and `totalReps=null`) or `"reps"` (with `totalReps` rolled via `rand(minReps,maxReps)`) — this is what lets an Interval Sequence phase be either rep-count- or duration-driven; harmless/unused for non-interval sessions |
| `armed` | whether input is currently accepted |
| `progressTone`, `prAnnounce` | feedback toggles |
| `pr` | personal-best snapshot from `getPR()` at session start |
| `longestHold`, `prBeaten` | running/session PR tracking — spans the **whole** session for every goal, including all phases of an Interval Sequence run (no per-phase reset) |
| `sig` | `{speech,beep,vibrate}` cue-channel toggles |
| `words` | `{down,up,hold,penalty,finish}` custom cue text |
| `rate` | speech rate (0.5–2) |
| `eyesClosed`, `guardExit`, `screenColor` | display/handling toggles — session-wide even for Interval Sequence; not varied per phase (a deliberate scope limit, see § 3) |
| `scenario`, `sd_actionMs`, `sd_pauseMs`, `sd_startReps`, `sd_startHold`, `ta_target`, `rr_bpm`, `rr_step`, `rr_window`, `livesOn`, `livesCount` | only populated when `goal === "scenario"` (`rr_window` = the configurable Rhythm Rush ± timing window, 80–600 ms) |
| `iv_phasePresets`, `iv_phasePresetObjs`, `iv_phaseIdx`, `iv_totalDone`, `iv_savedCurves` | only populated when `scenario === "interval"` — see § 3 |
| `tableSchedule` | only populated when `scenario === "co2"`/`"o2"` — the per-round `{hold, rest}` schedule, see § 3 |

Note: `totalReps`/`totalMin` above are set by `applyRepsConfig()` per the
`iv_phaseMode` row, then `buildPlan()` immediately overrides them again for
non-interval `goal==="time"` (`cfg.totalMin = num("totalMin"); cfg.totalReps
= null;`) and non-interval `goal==="scenario"` (`cfg.totalReps = null;`) —
harmless double-set, not a bug, since `applyRepsConfig()` must independently
get these right for Interval Sequence's own per-phase re-application
(`ivAdvancePhase()`, which has no such follow-up override).

**Fields set ad hoc at runtime** (never in `buildPlan`, added by whichever
function first needs them — this is most of the state):

- `S.done` — rep/round counter. Set in `startSession()`, mutated in
  `completeRep()`, `finalizeStopwatchRelease()`, `taComplete()`,
  `rhythmTap()` (which aliases it to `S.rr_hits` — the only scenario that
  does this the other way round). **For Interval Sequence, `S.done` is
  per-phase** — reset to `0` in `ivAdvancePhase()` (`index.html:3523`) at
  every phase transition, so `#repNow`/`#repTotal` behave exactly as they
  would for a standalone Reps session. The true cross-phase total is
  tracked separately in `S.iv_totalDone`, incremented alongside `S.done` in
  `completeRep()`; `finish()` reports `S.iv_totalDone` instead of `S.done`
  for interval sessions specifically.
- `S.cur`, `S.heldMs`, `S.spokeHold`, `S.lastSpokenSec` — per-rep hold
  target/progress. Set in `armReady()`/`beginRep()`, reset again inline in
  `finalizeRelease()`'s strict-mode branch.
- `S.subBase` — current sub-cue text template, overwritten from at least 6
  different call sites.
- `S.armed`, `S.waitingStart` — input-gate flags.
- `S.startTime`, `S.endAt` — session clock anchors, set in
  `bootFirstPress()` (`index.html:3004`) and `rhythmStart()`
  (`index.html:3395`) — **the wall clock starts on first press, not at
  `buildPlan()`/`startSession()`**. `S.endAt` is also reused, unmodified in
  meaning, for Interval Sequence's time-based phases (see § 3) — it just
  gets re-set to the *current phase's* end time by `bootFirstPress()`
  (phase 1) or `ivAdvancePhase()` (every phase after), rather than the
  whole session's; safe because every reader of `S.endAt` for standalone
  Time mode is gated on `S.goal==="time"`, never true for interval.
- `S.livesMax`, `S.livesLeft` — lives system, set in `armReadyScenario()`,
  mutated in `tryLoseLife()` (`index.html:2853`).
- Stopwatch-family (`sw`-prefixed, shared beyond just "stopwatch" — see
  § Known Issues): `S.swLongest`, `S.swLastReleaseTs`, `S.swHoldStartTs`,
  `S.swReleaseTs`.
- Sudden-death family (`sd_`-prefixed, shared loosely across `sd_hold`/
  `sd_speed`/`sd_mixed` — see § Known Issues): `sd_phase`,
  `sd_repsThisPhase`, `sd_prevPhaseReps`, `sd_prevActionReps`, `sd_prevHold`,
  `sd_actionMsAcc`, `sd_mixedRounds`, `sd_holdTargetHit`, `sd_lastCountSec`,
  `sd_phaseEndTs`, `sd_timer`.
- `S.scenarioFailMsg` — the end-of-session Game Over / Time Attack / Rhythm
  result message, used by **every** scenario. (Renamed from `S.sd_failMsg`,
  which was misleadingly `sd_`-prefixed despite being scenario-generic.)
- Time Attack: `S.ta_target` (from `buildPlan`) + ad hoc `S.taScore`.
- Rhythm (`rr_`-prefixed): `S.rr_interval`, `S.rr_window`,
  `S.rr_beatsPerLevel`, `S.rr_hits`, `S.rr_level`, `S.rr_countIn`,
  `S.rr_beatTime`, `S.rr_ticked`, `S.rr_tapped`, `S.rr_timer`,
  `S.rr_lastFlashAt`, `S.rr_flashUntil`.
- `S.holdSec` — cumulative held seconds across the whole session, touched
  in `completeRep()`/`finalizeStopwatchRelease()`/`taComplete()`.
- `S.reactLeft` — late-start countdown, set in `startReactionWindow()`
  (`index.html:3574`).
- `S.iv_*` (Interval Sequence, `iv_` prefix) — `iv_phasePresets` (array of
  saved preset names, one per phase, set in `buildPlan()`),
  `iv_phasePresetObjs` (the *resolved* preset objects, snapshotted in
  `buildPlan()` so deleting a preset mid-session can't NaN a later phase's
  config — `ivAdvancePhase()` reads these, never `localStorage`),
  `iv_phaseIdx` (0-based current phase, also set in `buildPlan()`), `iv_totalDone`
  (cross-phase cumulative rep count, see the `S.done` bullet above),
  `iv_savedCurves` (snapshot of the user's real global probability-curve
  state, captured in `buildPlan()` before the first phase's curve is
  applied, restored in-memory-only in `teardownSessionTimers()`),
  `iv_phaseMode` (`"reps"`\|`"time"`, set by `applyRepsConfig()` from the
  current phase's preset `.goal`), `iv_phaseStartAt` (when the *current*
  phase began — distinct from `S.startTime`, the whole session's start;
  needed for time-based phases' progress-ratio and end-time math). See § 3.

### Other module-level state

Declared near `let S = null;` (`index.html:2539` onward) unless noted:

| Var | Purpose |
|---|---|
| `holding` | true while the hold is actively engaged — set directly at 9 call sites; the two verified duplicates are centralized behind `resumeHeldRelease(loopFn)` (`index.html:3138`) and `releaseHold()` (`index.html:3150`), see § Known Issues |
| `activePointerId` | `pointerId` of the touch/pointer currently driving the hold; `null` while idle and for camera-/keyboard-driven holds (they pass no `pointerId`). Set alongside `holding=true` in `pressStart()`, `pressStartStopwatch()`, `resumeHeldRelease()`; cleared alongside `holding=false` in `releaseHold()`. `pressEnd()` ignores a pointerup/pointercancel/lostpointercapture whose `pointerId` doesn't match, so a second finger touching down and lifting elsewhere can't end an in-progress hold |
| `lastCueKind` | last `kind` passed to `setCue()`; drives `applyScreenColor()`'s green/yellow decision |
| `curScreenColorState` | last applied screen-color state, used to skip redundant class churn / restart CSS animations |
| `raf` | current `requestAnimationFrame` handle — shared by `loop()` (reps/time) and `stopwatchHoldLoop()` (scenario); only one runs at a time |
| `restTimer` | `setInterval` for the reps/time rest countdown (`nextRep`) |
| `reactTimer` | `setInterval` for the late-start penalty countdown (`startReactionWindow`), reps/time only |
| `pendingRelease` / `releaseTimer` | shared release-grace mechanism, used by both paths |
| `wakeLock` | Screen Wake Lock API handle |
| `guardActive` | swipe-guard/fullscreen-guard on/off |
| `goal` | UI-level session-goal selection, tracked separately from `S.goal` before a session exists |
| `swRestTimer` | `setInterval` powering the "rest since last hold" display for `stopwatch`/`sd_hold` only |
| `clockTimer` | `setInterval` for the top clock display |
| `lastTs` | last RAF timestamp for `loop()`'s delta-time integration (reps/time only — `stopwatchHoldLoop` reads `Date.now()` directly instead, an inconsistent timing strategy between the two paths) |
| `keyHeld` | space/enter key debounce |
| `cam` (`index.html:3875`) | camera-control module state — see § Camera control subsystem |

---

## 2. Session lifecycle

```
startSession() [index.html:2759]
  → buildPlan()                          (builds S; for interval, also resolves
                                            phase 1's preset and its curve)
  → show("session")
  → armReady()  or  armReadyScenario()    (dispatch on S.goal==="scenario"
                                            && S.scenario!=="interval")
        ↓ user presses
  → pressStart() / pressEnd()             ← universal input entry point
        │  if S.goal==="scenario" && S.scenario!=="interval":
        │      delegate to pressStartStopwatch()/pressEndStopwatch()
        │  otherwise (reps/time/interval): fall through to the reps engine
        ↓
  reps/time/interval: beginRep → loop → completeRep → nextRep → beginRep (loop);
                       for interval, nextRep's end check calls ivAdvancePhase()
                       to re-apply the next phase's preset before falling
                       through to the same rest-countdown/beginRep() path
  scenario (6 others): bootFirstPress (once) → pressStartStopwatch/
             pressEndStopwatch/finalizeStopwatchRelease, looping via
             stopwatchHoldLoop, S.sd_timer/S.rr_timer depending on scenario
        ↓
  finish()          (goal met / scenario game-over / Time Attack target hit /
                      Interval Sequence's last phase ends)
    or
  stopSession()     (user hits Stop — every goal/scenario, never recorded)
```

`armReady()`/`pressStart()`/`pressEnd()` (`index.html:2791`/`3392`/`3423`)
are the **only** shared dispatch points between the two families. They're
the single entry point for all input sources: the hold button, the
eyes-closed tap surface, the space/enter key, and the camera
(`camOnPress`/`camOnRelease`). Below this dispatch point the two paths are
almost entirely separate — **except for Interval Sequence**, which is
`S.goal==="scenario"` but deliberately takes the reps-engine branch at all
three dispatch points via a `&& S.scenario !== "interval"` exception, so it
reuses the entire Reps/Time path below unmodified (see § 3 for why `S.goal`
is never rewritten to `"reps"` to achieve this).

### Reps/Time/Interval-Sequence/table path

The dispatch condition at `armReady()`/`pressStart()`/`pressEnd()` is
`S.goal === "scenario" && !usesRepsEngine(S.scenario)` →  scenario path;
`usesRepsEngine(scn)` (`index.html:2484`) returns true for `interval`,
`co2`, and `o2` — the scenarios that ride this path instead.

- `armReady()` (`index.html:2791`): arms the first rep, picks `S.cur` via
  `holdDurationFor()`. For `S.scenario==="interval"`, also shows `#swStats`
  and calls `ivUpdatePhaseIndicator()` (`index.html:3485`); for the CO₂/O₂
  tables it shows the same slot via `tableUpdateStats()` (current round's
  hold + upcoming rest).
- `pressStart()`: on `waitingStart`, calls `bootFirstPress()` (shared with
  scenario) to start the clock, then sets `holding=true` and kicks `loop()`.
- `loop(ts)` (`index.html:3625`): RAF-driven, delta-time hold-progress
  integration; calls `completeRep()` at target.
- `pressEnd()` → `finalizeRelease()` (`index.html:3706`): strict-mode
  restart, penalty, early-release messaging. **Only this path uses
  `S.strict`, `S.penalty`, `startReactionWindow`, `applyPenalty`** — which is
  exactly why Interval Sequence rides this path: each phase gets the real
  strict/penalty/late-start-tolerance system, not a reimplementation.
- `completeRep()` (`index.html:3752`): finalizes a rep, updates
  `S.done`/`S.holdSec`/`S.longestHold`/PR, and (interval only) increments
  `S.iv_totalDone`; `setTimeout(650ms)` → `nextRep(false)`.
- `nextRep(first)` (`index.html:3510`): checks end conditions; for interval,
  a met end condition first tries `ivAdvancePhase()` (`index.html:3494`) —
  if it returns `true` (more phases remain), execution falls through into
  the same rest-countdown/`beginRep()` code below using the newly-applied
  phase's config; only when `ivAdvancePhase()` returns `false` (last phase
  finished) does it fall through to `finish()`. For a finished CO₂/O₂ table
  it sets the `tableComplete` finish message here.
- `beginRep()` (`index.html:3544`): mirrors `armReady()` for reps 2..N, also
  calls `startReactionWindow()`.

### Scenario path (the other six sub-modes)

- `armReadyScenario()` (`index.html:2907`): single dispatcher that inline-
  initializes each of the **six** non-interval scenarios' fields in one
  large if/else chain, then calls `rhythmStart()` for `"rhythm"` as a
  special case (rhythm alone auto-starts, no press needed to boot).
- `bootFirstPress()` (`index.html:2985`): shared boot logic (clock/wake-
  lock/guard) **plus** it owns the entire `S.sd_timer` `setInterval`
  definitions for `sd_speed` and `sd_mixed` — two full per-scenario state
  machines defined inside this one function as anonymous closures.
  `sd_hold`/`stopwatch`/`timeattack` have no equivalent timer (purely
  press/release driven); `rhythm` has its own separate `S.rr_timer` set up
  in `rhythmStart()`.
- `pressStartStopwatch()` (`index.html:3157`): handles "start holding";
  delegates immediately to `rhythmTap()` if scenario is `rhythm` (taps, not
  holds). The release-grace resume branch calls the shared
  `resumeHeldRelease()` helper (`index.html:3138`, see § Known Issues).
- `pressEndStopwatch()` (`index.html:3233`) → `finalizeStopwatchRelease()`
  (`index.html:3245`): ~120-line function with a big if/else-if chain over
  `S.scenario` (`sd_hold`, `sd_mixed`, `sd_speed`, else), duplicating much
  of what `completeRep()`/`finalizeRelease()` do for reps/time, reimplemented
  scenario-by-scenario.
- `stopwatchHoldLoop()` (`index.html:3201`): the scenario equivalent of
  `loop()`, but `Date.now()`-based rather than delta-integrated; also
  special-cases `timeattack` (calls `taComplete`) and `sd_mixed`'s hold
  phase inline. Its guard condition hand-lists the scenario names it applies
  to — `rhythm` is excluded (owns its own timer, `S.rr_timer`); `interval`
  never reaches this function at all (it doesn't take the scenario path),
  so no exclusion is needed for it here.
- `taComplete()` (`index.html:3367`) and the `rhythm*` family
  (`rhythmStart` `index.html:3395`, `rhythmTick` `3155`, `rhythmTap` `3171`,
  `rhythmMiss` `3191`) are further, mostly self-contained mini state
  machines that still funnel through `finish()`.

### Shared vs. diverging

**Shared:** `pressStart`/`pressEnd` dispatch, `bootFirstPress`,
`setCue`/`cmd`/`applyScreenColor`, `startClock`/`updateClock`,
`progressStart/Update/Stop`, `finish()`, camera hooks, the
`releaseGrace`/`pendingRelease`/`releaseTimer` mechanism.

**Diverges:** timing integration strategy (delta-time RAF vs. `Date.now()`
deltas), rest/countdown mechanism (`restTimer`+`nextRep` vs. `swRestTimer`/
`sd_timer`/`rr_timer`), the penalty/strict-mode system (reps/time/interval
only — see § Known Issues' history for why `finish()`/`stopSession()` used
to diverge here too, before being unified: both now behave identically
across every goal/scenario — `stopSession()` for manual Stop, never
recorded; `finish()` for natural end, always recorded).

---

## 3. Scenario engine

| Scenario | Phase field(s) | Transitions | Timer |
|---|---|---|---|
| `stopwatch` | none | freeform hold/release loop; only `S.swLongest`/`S.swLastReleaseTs` tracked | `swRestTimer` |
| `sd_hold` | none | same freeform loop; each hold must beat `S.sd_prevHold` or `tryLoseLife()`/`finish()` | `swRestTimer` (shared with stopwatch) |
| `sd_speed` | `S.sd_phase` ∈ {action, rest} | action ends by timer → checks `sd_repsThisPhase` vs `sd_prevPhaseReps` → rest → action | own `S.sd_timer` (100ms tick) |
| `sd_mixed` | `S.sd_phase` ∈ {action, hold, pause} | action → hold (beat `sd_prevActionReps`) → hold (beat `sd_prevHold`, uses `mixedHoldCue`/`mixedHoldTargetCue`) → pause → action | own `S.sd_timer` (100ms tick, separate closure from sd_speed's) |
| `timeattack` | none | continuous accumulation of `S.holdSec` until it reaches `S.ta_target` → `taComplete()` | none (RAF-driven via `stopwatchHoldLoop`) |
| `rhythm` | implicit via `S.rr_countIn`/`S.rr_level` | count-in (4 beats) → tapping, level/BPM steps up every `rr_beatsPerLevel` hits, any miss → `tryLoseLife()`/`finish()` | own `S.rr_timer` (20ms tick, `rhythmTick`) |

`interval` is deliberately **not** in this table — it doesn't take the
scenario path at all (see § 2). It's documented separately below.

No lives support: `scenarioSupportsLives()` deliberately excludes `interval`
(alongside `stopwatch`/`timeattack`) since there's no fail condition — a
fixed practice sequence, not a challenge to survive. No per-scenario
personal-best record in `commitGameSession()` either, for the same reason
(no natural "best" metric for a sequence of arbitrary preset-driven phases);
XP still accrues via the existing generic formula.

### Interval Sequence (`S.scenario === "interval"`)

Unlike the six scenarios above, Interval Sequence is **not** a separate
state machine bolted onto the scenario path — it's the entire Reps/Time
engine (§ 2), reused unmodified, with a small number of extra hooks. This
was a deliberate rework (an earlier version had its own fully-automatic,
timer-driven, non-press-gated engine — see § Known Issues for that history)
in favor of making each phase behave like a genuine standalone Reps *or
Time* session: same hold/rest probability curves, same strict mode,
penalty, and late-start tolerance, phase by phase, back to back — **and**,
as of a follow-up rework, a phase can be either rep-count-driven or
duration-driven, picked up automatically from whichever kind of preset is
assigned to it.

**Why `S.goal` is never rewritten to `"reps"` or `"time"`:**
`commitGameSession()` branches on `snap.goal === "reps"` *and*
`snap.goal === "time"` to award their respective personal-best records
(`index.html:2064`/`1931`). If Interval Sequence sessions literally set
`S.goal` to either value to reuse the engine, every run would silently
contaminate whichever record matched the current phase — reversing the
deliberate exclusion noted above. Instead, `S.goal` stays `"scenario"` and
`S.scenario` stays `"interval"` for the whole session, and exactly 3
dispatch points get a `&& S.scenario !== "interval"` exception (`armReady()`,
`pressStart()`, `pressEnd()` — see § 2) so the reps engine runs without ever
needing to know it's inside a scenario. Everywhere else the engine branches
on `S.goal === "time"` (`timeUp()`, `sessionProgress()`, `applyPenalty()`,
`penaltyNote()`, `bootFirstPress()`) gets a sibling
`S.scenario === "interval" && S.iv_phaseMode === "time"` branch instead —
see "Time-based phases" below.

**Phase configuration — presets, not a duplicate settings UI.** Each phase
(2–6, `S.iv_phasePresets`) is configured by picking one of the user's saved
**presets** from a dropdown (`ivPhasePreset1..6` in the settings form,
`SETTING_IDS`). A preset already captures the entire Reps- or Time-mode
difficulty field set via `readAll()` (including which of the two goals it
was saved under), plus (as of the curve-capture rework) the
probability-curve shape (see below) — so assigning a preset to a phase slot
reproduces a full Reps- or Time-mode session exactly, without a second copy
of the settings UI (which would otherwise mean up to 6 independent curve
editors, times two for Reps vs. Time fields). `populatePresetOptions()`
(`index.html:2254`) tags each dropdown option with `(Reps)`/`(Time)` (reusing
the existing `t.goalReps`/`t.goalTime` labels) by reading the preset's own
stored `.goal`, so it's clear which is which before assigning it.

**Mechanics:**
- `buildPlan()` (`index.html:2679`) resolves **all** phases' preset objects
  once into `cfg.iv_phasePresetObjs` (so a preset deleted mid-session can't
  break a later phase), applies phase 1's via `applyRepsConfig(cfg, p0)`
  (`index.html:2653` — the same helper used for the plain baseline),
  snapshots the real global curve state into `cfg.iv_savedCurves`, then
  swaps in phase 1's curve via `applyIvPhaseCurve(p0)` (`index.html:1654`).
- `ivAdvancePhase()` (`index.html:3523`), called from `nextRep()`'s
  end-of-session check (`index.html:3540`): increments `S.iv_phaseIdx`; if
  phases remain, takes the next preset from `S.iv_phasePresetObjs`,
  re-applies it onto the *live* `S` via `applyRepsConfig(S, p)`, swaps its
  curve via
  `applyIvPhaseCurve(p)`, resets `S.done` to `0` (per-phase — see § 1) and
  `S.iv_phaseStartAt` to the current time, sets `S.endAt` for a time-based
  phase (see below), updates `#repTotal`/`#repNow`, and calls
  `ivUpdatePhaseIndicator()` (`index.html:3508`, reuses the shared
  `#swStats` slot to show "Phase X/Y" and the active preset's name — same
  reused-readout pattern as every other scenario, see the naming notes
  below). Returns `false` once the last phase is exhausted, at which point
  `nextRep()` falls through to `finish()` with
  `S.scenarioFailMsg = T().ivComplete(n)`.
- The rest period before each new phase's first hold is sampled from that
  phase's own `minRest`/`maxRest` for free — `applyRepsConfig()` swaps
  `S.minRest`/`S.maxRest` before `restSecsForNext()` runs later in the same
  `nextRep()` call, so no extra plumbing was needed for a natural pause
  between phases.
- `finish()` reports `S.iv_totalDone` (not `S.done`) as the session total
  for interval sessions — see § 1's `S.done` bullet for why the two are
  split.

**Time-based phases.** `applyRepsConfig(cfg, src)` (`index.html:2653`) reads
`src.goal`: if `"time"`, it sets `cfg.iv_phaseMode = "time"`,
`cfg.totalMin = fn("totalMin")`, and `cfg.totalReps = null`; otherwise
(`"reps"` or anything else — an unchanged fallback) it sets
`cfg.iv_phaseMode = "reps"` and rolls `cfg.totalReps` as before. `S.endAt`
and `S.iv_phaseStartAt` are deliberately the **same, non-`iv_`-prefixed
`S.endAt`** field standalone Time mode already uses (plus one new
interval-specific `S.iv_phaseStartAt`, since `S.startTime` is the *whole
session's* start, not the current phase's) — reusing `S.endAt` is safe
because every place that reads it for standalone Time mode is gated on
`S.goal === "time"`, which is never true for interval, so the two uses never
collide:
- `bootFirstPress()` (`index.html:3004`) sets `S.iv_phaseStartAt = S.startTime`
  for phase 1, and — if `S.iv_phaseMode === "time"` — `S.endAt = S.startTime
  + S.totalMin*60*1000`, mirroring the standalone-Time-mode line right above
  it.
- `ivAdvancePhase()` sets `S.iv_phaseStartAt = Date.now()` and (if the new
  phase is time-based) `S.endAt = S.iv_phaseStartAt + S.totalMin*60*1000`
  for every phase after the first.
- `nextRep()`'s end check (`index.html:3540`) now fires on
  `(S.totalReps && S.done >= S.totalReps) || ivPhaseTimeUp`, where
  `ivPhaseTimeUp = S.scenario==="interval" && S.iv_phaseMode==="time" &&
  S.endAt && Date.now() >= S.endAt` — `timeUp()` itself is untouched and
  still never fires for interval (gated on `S.goal==="time"`).
- `sessionProgress()` (`index.html:1875`, used by "timing"-mode probability
  curves) gained a matching branch ahead of its existing
  `S.goal==="time"` one, computing the ratio from `S.iv_phaseStartAt`/
  `S.endAt` instead of `S.startTime`/`S.endAt` — without it, a "timing"-curve
  on a time-based interval phase would silently always sample as if progress
  were `0`, since neither of the two pre-existing branches (`S.goal==="time"`,
  `S.totalReps>0`) is ever true for it.
- `applyPenalty()`/`penaltyNote()` (`index.html:3762`/`3506`) each gained an
  `S.scenario==="interval" && S.iv_phaseMode==="time"` alternative alongside
  their `S.goal==="time"` check — without it, a late-start penalty on a
  time-based phase would silently do nothing (neither the time-extension
  branch nor the rep-count-extension branch would fire, since `S.totalReps`
  is `null` for a time-based phase).
- `$("repTotalWrap")`'s visibility (toggled in `startSession()` and
  `ivAdvancePhase()` alike, both keyed off `S.totalReps`) already hides
  correctly for a time-based phase for free, matching standalone Time mode.

**Curve capture/restore — the most error-prone part of this design.** The
probability-curve system (`curves`/`curveMode`, § below "Cue/feedback
system" or grep) is a single global mutable object with one `localStorage`
key (`K.curves`); there's no built-in way to have several independent named
curves. Two distinct rules keep this safe:
1. `presetSave()`/`presetLoad()` (`index.html:2264`/`2117`) capture/restore
   the curve shape as part of the preset blob (`snap.curves =
   {hold,rest,modeHold,modeRest}`) — this is what lets a phase reproduce its
   curve at all. `applyIvPhaseCurve(presetObj)` (`index.html:1654`) applies
   a captured curve, or falls back to a blank/uniform-random curve if the
   preset predates curve-capture (no `.curves` key) — this must never
   crash, since old presets are expected to exist.
2. **Mid-session curve swaps must never call `saveCurves()`.** Every swap
   during a running Interval Sequence session (`buildPlan()`'s first-phase
   application, `ivAdvancePhase()`'s per-phase swap) only mutates the
   in-memory `curves`/`curveMode` objects. The user's *real* global curve
   state is snapshotted into `S.iv_savedCurves` before the first swap, and
   restored — **purely in memory, never via `saveCurves()`** — in
   `teardownSessionTimers()` (shared by both `finish()` and `stopSession()`,
   so this holds even if the user manually stops mid-sequence). Getting
   this boundary wrong would silently overwrite the user's own hand-drawn
   curve shapes in `localStorage`; this was verified explicitly with a
   Playwright script that hand-set a distinctive curve, ran a full Interval
   Sequence (and separately, a manually-stopped one), and confirmed the
   `lat.curves` `localStorage` blob was byte-identical before and after.

### CO₂ / O₂ tables (`S.scenario === "co2"` / `"o2"`)

Classic apnea training tables as first-class scenarios, riding the reps
engine via `usesRepsEngine()` (see § 2). CO₂ table = fixed hold, rest
shrinking per round; O₂ table = hold growing per round, fixed rest.

**Mechanics — exactly two hooks into the reps engine:**
- `buildPlan()` computes `cfg.tableSchedule`: an array of
  `{hold, rest}` per round, where `rest` is the rest *before* that round
  (`[0].rest = 0`, unused — the first rep starts rest-free like any first
  rep). Inputs (all in `SETTING_IDS`): shared `tableRounds` (2–10, dflt 8);
  CO₂ `co2Hold`/`co2Rest`/`co2Dec` (rest floor 3 s); O₂
  `o2Hold`/`o2Inc`/`o2Rest`. `cfg.totalReps = rounds`, so the standard
  "Rep x/N" display and `nextRep()`'s `S.done >= S.totalReps` end check
  work unmodified.
- `holdDurationFor()` and `restSecsForNext()` return
  `tableSchedule[S.done]`'s values instead of sampling the probability
  curves (`long:true` so the countdown + `holdForN` subcue show the
  target).

**Forced-relaxed difficulty:** `buildPlan()` overrides `strict=false,
penalty=false, hide=false` for tables regardless of saved settings — an
early release merely pauses the hold (`heldMs` accumulates across
re-presses, the non-strict `finalizeRelease()` path), and there are no
penalties, so a table's timing structure is always exactly what was
configured. `releaseGrace` still applies.

**UI:** `tableUpdateStats()` reuses the shared `#swStats` slot (same
pattern as `ivUpdatePhaseIndicator()`) showing the current round's hold
target and the upcoming rest; refreshed in `armReady()`/`beginRep()`.

**Records:** completing a table chases `rec.co2`/`rec.o2` = total held
seconds (`commitGameSession()`); a manually-stopped table never records
(only `finish()` commits). Tables are excluded from the generic pace
record like every scenario, and have no fail concept → no lives
(`scenarioSupportsLives()` returns false for them).

### Naming-consistency notes (read before adding a 10th scenario)

- **`sd_` prefix** is used for `sd_hold`/`sd_speed`/`sd_mixed` fields, but
  `sd_hold` never sets `S.sd_phase` — the prefix implies a phase machine
  that only 2 of the 3 "sd_" scenarios actually have. (The generic
  end-of-session message field was similarly `sd_`-prefixed despite being
  used by every scenario — now renamed to `S.scenarioFailMsg`, see § 1.)
- **`sw` prefix** originally meant "stopwatch" but is shared by `sd_hold`
  too, and the DOM elements it's tied to (`#swStats`, `#swRest`,
  `#swLongest`) are reused and manually relabeled with hardcoded strings for
  every other scenario (including `interval`) — `sw` is really just "the two
  generic stat readouts", reused for seven different meanings.
- **`ta_` prefix** exists only for `ta_target`; `taScore`/`taComplete` drop
  the underscore.
- **`rr_` prefix** (rhythm) is internally consistent, but
  `S.done = S.rr_hits` — rhythm aliases the generic `done` counter to its
  own field rather than the reverse, unlike every other scenario.
- **`iv_` prefix** (Interval Sequence) is reserved for the small set of
  fields genuinely specific to the multi-phase mechanism itself
  (`iv_phasePresets`, `iv_phaseIdx`, `iv_totalDone`, `iv_savedCurves`).
  Everything else about an Interval Sequence session — `S.base`,
  `S.minHold`/`S.maxHold`, `S.minRest`/`S.maxRest`, `S.strict`, `S.penalty`,
  `S.totalReps`, `S.done`, etc. — is the **same, non-prefixed** field the
  Reps engine already uses, re-populated per phase by `applyRepsConfig()`.
  This is intentional (interval phases *are* Reps-mode sessions
  mechanically, not a parallel implementation reusing generic-sounding
  names by convention), not the same kind of "generic field reuse" pattern
  as `sw`/`sd_`/`rr_` above.

---

## 4. Cue/feedback system

### `setCue(kind, big, sub)` (`index.html:3614`)

Only three `kind` values are ever passed: **`"up"`**, **`"down"`**,
**`"rest"`**. Sets `lastCueKind`, the `#cue` CSS class, and always calls
`applyScreenColor()`.

### `cmd(kind)` (`index.html:2419`)

A *different*, overlapping vocabulary: `"down"`, `"up"`, `"hold"` (plus
`cmdCount`, `cmdFinish`, `cmdPenalty`, `cmdPenaltyThenDown` for other cue
moments). Dispatches speech/beep/vibrate, each gated by
`S.sig.speech`/`S.sig.beep`/`S.sig.vibrate`. **`cmd`'s `kind` and
`setCue`'s `kind` are different enumerations that happen to share two
string values** ("up"/"down") — easy to conflate when reading call sites.

`tick(kind)` (`index.html:2399`) is a third, lighter cue helper for
`isActionTap()` cases (rapid sd_speed/sd_mixed reps) — same "down"/"up"
vocabulary again, beep+vibrate only, no speech.

### Screen-color layer (`applyScreenColor(force)`, `index.html:2862`)

Two DOM layers, `#screenColorLayer` (background wash) and
`#screenColorBorderLayer` (10px inset-`box-shadow` border, fully opaque,
using `--good`/`--rise`/`--bad`), both toggled together from one derived
`state`:

1. `S.scenario === "rhythm"` → red flash driven by `S.rr_flashUntil`,
   otherwise yellow.
2. `holding` → red.
3. `isActionTap()` (mid-action-phase between taps) → yellow, explicitly
   *not* green even if `lastCueKind==="rest"` (a "brief relax" cue fires
   here that isn't a real breathe-now moment).
4. `lastCueKind === "rest" || "down"` → green.
5. else → yellow, with the yellow-rise CSS animation duration
   (`--scYellowDur`) paced to `S.lateTol` seconds if a real late-start
   tolerance window is ticking (`reactTimer` truthy, `S.penalty`,
   `S.lateTol > 0`, reps/time only) — otherwise a fixed cosmetic 2.8s.

State is memoized in `curScreenColorState` to skip no-op restarts, with a
`force` param and a reflow hack (`void el.offsetWidth`) to force-restart the
CSS keyframe animation when needed (used by `startReactionWindow()`'s
penalty tick and `flashTolerancePenalty()`'s `tolFlash` overlay class).

This layer is **entirely orthogonal to `setCue`/`cmd`** — it only reads
`lastCueKind`, `holding`, `S.scenario`, and timer state; it's invoked as a
side effect from `setCue()` itself plus a handful of direct calls.

---

## 5. Settings, persistence & i18n

### `SETTING_IDS` / `KV` / `readAll()` / `writeAll()`

Storage helper `KV` (`index.html:1018`) wraps `localStorage` with keys under
`K` (`lat.settings`, `lat.presets`, `lat.history`, `lat.pr`, `lat.curves`,
`lat.game`). A few keys are used as raw string literals instead of going
through `K`: `"lat.lang"`, `"lat.advOpen"`, `"lat.cam"`,
`"lat.camOnboarded"` — inconsistent but harmless (all share the `lat.`
prefix).

`SETTING_IDS` (`index.html:1895`, 56 element IDs — 7 are the Interval
Sequence scenario's per-phase fields: `ivPhaseCount` + `ivPhasePreset1..6`,
each a `<select>` of saved preset names; 7 more are the CO₂/O₂ table
fields `tableRounds`/`co2Hold`/`co2Rest`/`co2Dec`/`o2Hold`/`o2Inc`/
`o2Rest`; plus `rrWindow`) + `readAll()`/
`writeAll()` (`index.html:1907`/`1784`) round-trip the settings form through
`lat.settings` on every change (debounced 400ms). `writeAll()` also contains
a legacy migration shim: old blobs with `o.rest` but no `o.minRest` get
split into `minRest`/`maxRest`. A settings blob from before this rework
(stale `ivDur1`/`ivHold1`/... keys, no `ivPhasePreset1`) is silently ignored
by the same `if(!(id in o)) continue;` guard — the phase selects just come
up unassigned and `validate()` blocks starting until real presets are
picked.

**Important**: `buildPlan()` does **not** call `readAll()` — it
independently re-reads the same DOM elements with its own clamping logic.
Any new setting must be wired into `SETTING_IDS`, `buildPlan()`, and usually
`updateSummaries()` — three separate places. If a user enters an
out-of-range value, `readAll()` persists it raw while `buildPlan()` silently
clamps it at session start with no user-visible feedback.

**Settings grouped by panel** (`<details class="panel">`):

| Panel | Settings |
|---|---|
| `secGoal` | `minReps, maxReps, totalMin, scenarioSel, sdActionSec, sdPauseSec, sdStartReps, sdStartHold, taTarget, rrBpm, rrStep, rrWindow, tableRounds, co2Hold, co2Rest, co2Dec, o2Hold, o2Inc, o2Rest, livesOn, livesCount` + `goal` |
| `secTiming` | `baseHold, minRest, maxRest, holdChance, minHold, maxHold` |
| `secChallenge` (advanced) | `strict, penalty, penaltyX, lateTol, hideDur, releaseGrace` |
| `secSignals` (advanced) | `voice, beep, vibrate, cmdDown, cmdUp, cmdHold, cmdPenaltyWord, cmdFinishWord, cmdRate` |
| `secCoaching` (advanced) | `progressTone, prAnnounce` |
| `secDisplay` (advanced) | `eyesClosed, guardExit, screenColor` |
| `secCamera` (advanced) | `cameraControl` |
| header | `appLang` |

`secGoal`/`secTiming` are shown by default; everything else is behind
`#advToggle` (`#advancedWrap`), whose open/closed state persists separately
via `lat.advOpen`.

### Data export / import + records overview (`secPresets`)

`exportData()`/`importData()` (buttons `#dataExport`/`#dataImport` +
hidden `#importFile` file input, next to Clear history): export gathers
every `lat.`-prefixed `localStorage` key into
`{app:"breathless", version:1, exportedAt, data:{...}}` and triggers a
dated `.json` download; import parses the file, validates that `data`
contains at least one `lat.*` key (anything else in the file is ignored —
only `lat.*` keys are ever written back), asks `confirm(T().confirmImport)`,
writes via `KV.set`, and ends in `location.reload()` — deliberately the
whole-page reload rather than piecemeal re-init, since boot already does
settings/curves/presets/stats/language restoration correctly.

`renderRecords(t)` fills `#recordsBox` (under `#statsBox`) with one line
per nonzero `g.rec` personal best in a fixed order, using
`recordLabel()`/`recordValue()` — the same pair `recordText()` composes for
the finish-screen badges (refactored out of it for exactly this reuse).
Hidden entirely while all records are zero; re-rendered from
`renderStats()`, which itself runs on boot, finish, language change, and
(via reload) import.

Not in `SETTING_IDS` (deliberately out-of-band): `camRelThr`, `camPressThr`,
`camAdapt` (persisted via `saveCamCfg()` → `lat.cam` instead — reasonable,
since calibration is per-device/lighting, not a shareable "setting").

**Redundant language persistence**: `appLang` round-trips through
`lat.settings` (via `SETTING_IDS`) but the actually-active language is driven
by a separate `lat.lang` key + `setLang()`; `writeAll()` only sets the
`<select>`'s DOM value without dispatching `change`. Harmless today (both
paths stay in sync via `applyRuntimeI18n()` always resyncing the select at
the end), but it's two parallel mechanisms for one concept.

**When `goal !== "scenario"` settings still get read regardless**: `strict`,
`penalty`, `penaltyX`, `lateTol`, `hideDur`, `releaseGrace` are hidden in the
UI when `goal==="scenario"`, but `buildPlan()` still copies all of them into
`cfg` unconditionally. This is harmless in practice only because the
scenario path never calls the reps/time functions that read them — but
there's no structural guarantee of that, and leftover checkbox state from a
previous goal carries over invisibly on a mode switch.

### i18n

`I18N` (`index.html:1026`) defines 11 languages: `de, en, zh, hi, es, fr, ar,
bn, pt, ru, ur`. `T()` merges `en.strings` (fallback) with the active
language's `strings`. `SUPPORTED_LANGS = ["de","en"]`
(`index.html:1590`) is the actual gate — only these two are offered in the
language dropdown.

`de` and `en` each define the same `strings` keys (identical sets, zero
gaps) — grew from 207 through the i18n/aria-label localization pass, to 311
with the original Interval Sequence scenario's keys, then down by a net 5
(9 removed — `sublblIvDur/Hold/Rest`, `ariaIvDur/Hold/Rest`,
`ivPhaseTimeLabel`, `ivHoldingSub`, `ivRestingSub`, all describing the old
automatic-cueing UI — 4 added — `ariaIvPhasePreset`, `errIvPhasePreset`,
`ivPhaseLabel`, `ivPresetLabel`) with this rework, landing at **306**. The
other 9 languages each define only **27** keys — genuine, intentional stubs
(not reachable, not dead code to delete — they're prepared for future
translation work).

Two keys (`scenarioTitle`, `statsStreak`) are defined in `de`/`en` but
appear unreferenced anywhere — worth confirming before deleting.

`applyRuntimeI18n()` (`index.html:1605`) walks `[data-i18n]`/
`[data-i18n-ph]`/`[data-i18n-aria]` elements (the last sets `aria-label`),
then re-runs `updateScenarioHint()`, `ivLabelPhases()` (sets the Interval
Sequence's numbered "Phase N" headings and each phase preset select's
aria-label via `t.ariaIvPhasePreset(i)` — can't be a static `data-i18n-aria`
key since it needs an embedded phase number, same technique as
`sdSpeedRepsGoal(n)`), `applyGoalVisibility()`, `refreshPresetSelect()`
(which also now repopulates every `ivPhasePreset1..6` select via the shared
`populatePresetOptions()` helper, preserving each select's current value if
it still exists), `updateSummaries()`, and curve redraws.

**Feature-toggle inventory:**

| id | Panel | Effect |
|---|---|---|
| `strict` | secChallenge | Early release before hold completes restarts the rep |
| `penalty` | secChallenge | Enables the extend-session-on-early-release/late-start penalty system; reveals `penaltyX`/`lateTol` |
| `penaltyX` | secChallenge | Penalty magnitude (+reps or +seconds depending on `goal`) |
| `lateTol` | secChallenge | Grace period (s) before a late hold-start triggers a penalty |
| `hideDur` | secChallenge | Hides required hold duration; voice announces it live |
| `releaseGrace` | secChallenge | Debounce so brief finger lifts don't count as release |
| `voice`/`beep`/`vibrate` | secSignals | Per-channel cue toggles |
| `cmdDown/cmdUp/cmdHold/cmdPenaltyWord/cmdFinishWord` | secSignals | Custom cue words (auto-reseeded per language) |
| `cmdRate` | secSignals | Speech rate, clamped 0.5–2 |
| `progressTone` | secCoaching | Quiet rising tone during hold |
| `prAnnounce` | secCoaching | Announces personal-best hold beaten |
| `eyesClosed` | secDisplay | Tap-anywhere hold surface instead of the button |
| `guardExit` | secDisplay | Edge-swipe/back/reload guard + best-effort fullscreen |
| `screenColor` | secDisplay | Green/yellow/red screen fill + border cues |
| `cameraControl` | secCamera | Webcam ROI brightness threshold replaces touch input |
| `livesOn`/`livesCount` | secGoal (scenario) | Survive a scenario failure using a life instead of instant game-over |
| `camAdapt` (not in `SETTING_IDS`, persisted via `lat.cam`) | camOverlay | Adapts calibration to slow lighting drift |

---

## 6. Camera control subsystem

All logic in one block, `index.html:3875` onward. CSS `index.html:390-417`.
Markup: PiP preview `#camPip` (`~825`), setup overlay `#camOverlay`
(`~883`), onboarding card `#camIntro` (`~925`).

### State object

`const cam = {...}` (`index.html:3875`): `stream`, `video`, `running`,
`raf`, `mode` (`"idle"|"setup"|"session"`), `roi` (centered 30%×30% box by
default), `ref` (calibration baseline frame), a 48×48 downsample buffer
(`aw`/`ah`/`actx`), `pressThr:25`, `releaseThr:10`, `pixelDelta:25`,
`pressed`, `facing`, `adapt:true`, and auto-calibration measurement fields.
Persisted via `saveCamCfg()`/`loadCamCfg()` under `localStorage` key
`"lat.cam"`.

### Capture & detection pipeline

1. **Acquire**: `camAcquire()` (`index.html:4012`) calls `getUserMedia` with
   facingMode + 640×480 ideal constraints; retries with bare
   `{video:true}` on failure before giving up.
2. **Sample**: `camSampleGray()` (`index.html:3915`) draws the ROI sub-rect
   (computed against the *mirrored* preview) into the 48×48 canvas,
   converts to grayscale via standard luma weights.
3. **Change score**: `camChangeFrom(g)` (`index.html:3925`) counts pixels
   differing from the reference frame by more than `pixelDelta` (25),
   returns a percentage of 2304 pixels.
4. **Hysteresis**: in the main loop's `tick()`, not-pressed + `pct >=
   pressThr` → `cam.pressed=true` + `camOnPress()`; pressed + `pct <=
   releaseThr` → `cam.pressed=false` + `camOnRelease()`. Classic two-
   threshold hysteresis to avoid flicker.
5. **Adaptive drift**: if `cam.adapt`, the reference frame is nudged toward
   the live frame by `CAM_ADAPT_ALPHA = 0.03` per tick — frozen while
   pressed or auto-calibrating.

### Calibration

- **Manual** `camCalibrate()` (`index.html:3930`): snapshots the current
  frame as `cam.ref`; user sets thresholds manually.
- **Auto** `camAutoCalibrate()` (`index.html:3936`): snapshots reference,
  measures idle noise floor for 1.6s, derives thresholds via a hand-tuned
  formula (`releaseThr = clamp(3,40,round(measMax)+4)`; `pressThr =
  clamp(rel+3, 90, round(rel*2)+6)`) — these constants are tuned-by-feel,
  not derived from any documented model.

### Routing into shared input handling — confirmed

```js
function camOnPress(){ if(cam.mode==="session"){ try{ pressStart(); }catch(e){} } }
function camOnRelease(){ if(cam.mode==="session"){ try{ pressEnd(); }catch(e){} } }
```

These call the exact same `pressStart()`/`pressEnd()` used by touch/
keyboard — camera control is a genuine drop-in replacement for the input
path, working in every session type (reps/time, all 6 press-gated
scenarios, and Interval Sequence), not just a subset.

### Setup/consent flow

Toggling `#cameraControl` fires `maybeShowCamIntro()`
(`index.html:4065`, gated by `lat.camOnboarded`). `startSession()` redirects
to `camOpenSetup()` (`index.html:4038`) instead of starting a session if the
camera isn't yet in `"session"` mode; `camConfirmStart()`
(`index.html:4086`) validates thresholds and calibration before switching
modes and calling `startSession()` again. Camera flip forces recalibration
(`cam.ref = null`) since front/rear framing/lighting differ substantially.

### Error handling

- No camera / permission denied: shown as static text, no retry/re-prompt
  UX, and all failure modes (denied vs. no hardware vs. unsatisfiable
  constraints) collapse to the same message. Still a known gap, not fixed.
- **Stream-loss detection**: every acquired stream's tracks get a
  `track.onended` watcher (`camWatchStreamTracks()`, `index.html:4024`). If
  the feed dies mid-session (permission revoked, device unplugged), any
  stuck hold is released via `pressEnd()`, the camera is detached
  (`camDetach()`), and a `camStreamLost` message is shown (`#subcue`
  in-session, `#camErr` during setup) — no more silent freeze. The watcher
  guards against firing after an intentional stream replacement (e.g.
  `camFlip()`'s restart) by checking `cam.stream === stream` before
  reacting.

---

## 7. Lives system

Core state/UI: CSS `index.html:423-429`; checkbox `#livesOn`; row container
`#livesRow`.

```js
function scenarioSupportsLives(scn){
  return scn==="sd_hold" || scn==="sd_speed" || scn==="sd_mixed" || scn==="rhythm";
}
```
(`index.html:2472`) — gates whether the toggle is even shown.

**Every `tryLoseLife()` call site** (`index.html:2853`, note: distinct from
`cueLifeLost()` at `2586`, which is just the vibrate/beep/flash cue fired
from inside it):

| Scenario | Fail condition |
|---|---|
| `sd_hold` | held shorter than the previous round's hold |
| `sd_speed` | action phase ends with fewer reps than the previous phase (two related but distinct checks in the timer) |
| `sd_mixed` | hold-phase sub-check: held ≤ previous hold |
| `rhythm` | missed/late beat tap (`rhythmMiss()`) |

`stopwatch` and `timeattack` have **zero** calls to `tryLoseLife()` — they
have no fail/game-over condition at all (pure best-effort/PR-chasing modes),
so a lives system is structurally inapplicable, matching
`scenarioSupportsLives()`'s explicit exclusion.

**Mechanics**: `S.livesMax`/`S.livesLeft` set in `armReadyScenario()` when
`S.livesOn && scenarioSupportsLives(...)` (else `S.livesMax=0,
S.livesLeft=null`, the sentinel that hides `#livesRow`). `tryLoseLife()`
decrements, re-renders, cues, and returns whether lives remain. Every call
site follows the same pattern: `if(tryLoseLife()){ /* reset phase, retry */
} else { S.scenarioFailMsg = ...; finish(); }` — reaching 0 lives is what turns a
survivable miss into game-over; with lives remaining, the same fail
condition instead resets the current phase and lets the player retry.

---

## 8. PWA / repo infrastructure

- **Manifest** (`manifest.webmanifest`): standalone display, references
  `icon-192.png`/`icon-512.png`/`apple-touch-icon.png` — all three PNGs
  exist in the repo alongside `icon.svg`.
- **Icon**: `icon.svg` is duplicated as an inline base64/data-URI favicon at
  `index.html:~11` — two copies of the same artwork, not auto-synced.
- **Service worker** (`sw.js`, registered at the end of `index.html`'s
  boot, non-fatal on `file://`): precaches `index.html` + manifest + icons
  on install (`skipWaiting`), deletes old caches on activate
  (`clients.claim`). Same-origin requests are served
  **stale-while-revalidate** — cached copy instantly, background refresh —
  so an updated deploy lands on the *next* visit after the change;
  cross-origin (Google Fonts) is cache-first with opaque responses, failing
  silently offline (the `system-ui` font fallback covers it). **The
  `CACHE` version string in `sw.js` must be bumped whenever `index.html`
  or a precached asset changes** — that is the app's entire update
  mechanism.
- **No TODO/FIXME/XXX/debug markers** anywhere in `index.html` (verified by
  grep; only false-positive substring hits on the word "Tempo").

### Feature history (chronological, from `git log`)

1. Baseline breath-hold trainer + repo setup
2. GitHub Pages deploy workflow
3. Gamification layer (XP, ranks, streak, records) for scenario mode
4. Gamification extended to reps/time (records, pace)
5. Speed-mode pace differentiation (action-phase-only tempo)
6. Sudden Death Mixed scenario added (action + hold + pause)
7. Mixed mode: live hold progress, configurable start values, hold audio cue
8. Quiet action-phase reps (short blip instead of speech)
9. Mixed: countdown into the hold phase
10. Setup layout redesign: Simple/Advanced split + full DE/EN localization
11. Rebrand to Breathless — Gasping for More
12. Camera control added: ROI change detection with hysteresis
13. Pages deploy trigger / branch-based Pages simplification
14. Camera control hardened: flip, auto-thresholds, light adaptation, onboarding
15. Time Attack and Rhythm Rush scenarios added
16. App icon/favicon + palette refinement
17. Header language dropdown fix (overlap, supported-langs only)
18. Lives system added (for all fail-based scenarios)
19. Animated screen-color mode added (green/yellow/red breath cues)
20. Screen-color yellow phase coupled to the real late-start tolerance
21. Screen-color mode given a strong, opaque border layer
22. Full structural review pass: Sudden Death/Time Attack localized,
    `finish()`/`stopSession()` unified (manual Stop never records for any
    scenario), `holding`'s two verified duplications centralized, remaining
    hardcoded strings/aria-labels localized, camera stream-loss detection
    added, magic numbers documented
23. Interval Sequence scenario added: user-configured 2–6 phases with
    fully-automatic (not press-gated) hold/rest cueing — a generic,
    content-neutral interval-training practice tool
24. Interval Sequence reworked: phases are now press-gated and
    preset-driven — each phase reuses the entire Reps-mode engine
    (rep-count range, hold/rest probability curves, strict mode, penalty,
    late-start tolerance) via a saved preset assigned to that phase slot,
    so running the sequence feels exactly like running several independent
    Reps sessions back to back; the old fully-automatic timer-driven engine
    (`ivStartCycle`/`ivTick`/`ivPressStart`/`ivPressEnd`) was removed
25. Interval Sequence phases extended to also accept Time-mode presets, not
    just Reps ones — a phase can now be duration-driven (`S.iv_phaseMode`),
    reusing `S.endAt`/introducing `S.iv_phaseStartAt` rather than `S.goal`,
    for the same PR-record-contamination reason `S.goal` was never
    rewritten to `"reps"`; preset dropdowns now tag each option `(Reps)`/
    `(Time)` so it's clear which is which
26. Review pass: pace-record gating, `sd_speed` boundary flush, interval
    preset snapshotting, interval time-phase deadline in `beginRep()`, last
    hardcoded-English strings localized (see § 9)
27. Five features in one pass: offline service worker (`sw.js`, precache +
    stale-while-revalidate); CO₂/O₂ table scenarios (riding the reps engine
    via `usesRepsEngine()`); data export/import (full `lat.*` backup JSON);
    records overview in the stats panel (`renderRecords()`); configurable
    Rhythm Rush timing window (`rrWindow` setting replacing the hardcoded
    260 ms)

This narrative explains several of the inconsistencies below: features
built early (Sudden Death family) predate the i18n retrofit and the
screen-color/lives systems built later, which is why they're the ones
missing localization and needing the newer systems bolted on rather than
designed in from the start.

---

## 9. Known Issues / technical debt

Honest inventory of what's messy, each with a risk note. Struck-through
(~~…~~) items are **resolved** — kept here (not deleted) as a record of what
was found and how it was addressed; bold-led items are **open**, deliberately
left as documented, low-priority calls rather than fixed as drive-by
changes. Update this list again the next time an item here gets fixed or a
new one is found. (History: a first audit pass flagged the original set; a
follow-up pass fixed most of it; a third review pass — pace contamination
through tick-counted countdowns below — added and fixed the next batch.)

- ~~Hardcoded German bypassed i18n in the Sudden Death family and Time
  Attack.~~ **Fixed.** `sd_hold`/`sd_speed`/`sd_mixed`/`timeattack` now route
  every swStats label, live subcue, cue-word override, and Game Over message
  through `T()` (~25 new `I18N.de`/`en` keys, following the existing
  `swRestLabel`/`taDone`/`rrOver` pattern), verified in both languages via
  Playwright. `S.sd_failMsg` was also renamed to `S.scenarioFailMsg` while
  touching these lines, since every scenario sets it, not just the `sd_`
  ones.
- ~~`finish()`/`stopSession()` asymmetry.~~ **Fixed.** The shared ~10-line
  teardown block is now `teardownSessionTimers()`, called by both. The Stop
  button now always calls `stopSession()` regardless of `S.goal` — manual
  Stop never records to history/gamification for either session type;
  `finish()` (natural end: target reached / game over) still does. Verified:
  reps/time and scenario both behave identically now for manual-stop vs.
  natural-end.
- ~~`holding` mutated at 13 call sites with duplicated logic.~~ **Partially
  fixed.** Auditing all 13 showed they're not all the same shape — arming a
  new rep/session and final cleanup are genuinely different resets, not
  duplicates. The two call sites that **were** verified near-verbatim
  duplicates are now centralized: `resumeHeldRelease(loopFn)` (the
  release-grace resume logic, previously copy-pasted between
  `pressStartStopwatch()`/`pressStart()`) and `releaseHold()` (the
  `holding=false; applyScreenColor(); cancelAnimationFrame(raf);` triple,
  previously repeated in `pressEnd()`/`pressEndStopwatch()`/
  `flushPendingRelease()`/`taComplete()`). Raw mutation count: 13 → 9, with
  the two real duplications named and single-sourced. The remaining 9 are
  intentionally left alone (see `armReady()`/`armReadyScenario()`/
  `beginRep()`/`completeRep()`/`stopSession()` in § 2) — forcing them into
  one helper would be premature abstraction, not simplification.
- ~~Multitouch could spuriously end an in-progress hold.~~ **Fixed.** None
  of the `pointerdown`/`pointerup`/`pointercancel`/`lostpointercapture`
  listeners on `holdBtn`/`tapSurface` (nor the `window`-level `pointerup`
  fallback next to `holdBtn`'s listeners, which had no filtering at all)
  checked which `pointerId` had actually started the current hold, so a
  second finger touching down and lifting elsewhere on the screen — e.g. an
  accidental palm touch — would call `pressEnd()` and cut the hold short
  even though the original holding finger was still down. Fixed by adding
  the `activePointerId` companion variable (see table above): `pressEnd()`
  now no-ops when the releasing `pointerId` doesn't match the one that
  started the hold. Camera/keyboard paths call `pressStart()`/`pressEnd()`
  with no `pointerId` argument and are unaffected. Verified with a
  Playwright script dispatching independent `pointerId`s at `holdBtn` and
  `tapSurface`.
- ~~Validation errors, `alert`/`confirm` dialogs, and vibration-test
  messages hardcoded English.~~ **Fixed.** `validate()`'s ~12 error strings,
  the preset-save `alert`, the history-clear `confirm`, and all three
  vibration-test messages now route through `T()` (new `err*`/
  `confirmClearHistory`/`vibrate*` keys).
- ~~`aria-label` attributes hardcoded English, ignored by
  `applyRuntimeI18n()`.~~ **Fixed.** `applyRuntimeI18n()` now also walks
  `[data-i18n-aria]` elements and sets `aria-label` from `T()`; all ~40
  `aria-label`s in the settings form got a matching `data-i18n-aria="..."`
  attribute + `aria*` key pair (the static English `aria-label` stays as the
  pre-JS fallback, same pattern as `data-i18n-ph`).
- ~~No stream-loss detection for camera control.~~ **Fixed.** Every
  acquired `MediaStream`'s tracks now get a `track.onended` watcher
  (`camWatchStreamTracks()`); if the feed dies mid-session (permission
  revoked, device unplugged), any stuck hold is released, the camera is
  detached, and a new `camStreamLost` message is shown (`#subcue` in-session,
  `#camErr` during setup) instead of silently freezing. Verified by
  dispatching a synthetic `ended` event on the track in both modes.
- ~~Magic numbers without inline explanation.~~ **Fixed** with one-line
  comments: `heldMs > 150` (accidental-tap threshold), `650ms` post-rep
  pacing delay, `CAM_ADAPT_ALPHA = 0.03`, `rr_window = 260ms` (since
  promoted to a real setting, `rrWindow` — 260 is now only the fallback).
- ~~Generic pace record contaminated by tap scenarios.~~ **Fixed.**
  `commitGameSession()`'s generic `pace` (`reps*60/elapsed`) was computed —
  and its record chased — for every non-`sd_speed` session, including
  Rhythm Rush (reps = metronome taps ≈ BPM) and `sd_mixed`'s rapid action
  taps, so one rhythm run permanently locked "Best pace" at a tap tempo no
  real reps session could beat. Now gated to press-gated rep sessions only
  (`goal === "reps"`/`"time"`/scenario `interval`); `speedPace` unchanged.
  Verified via Playwright: a 7-hit, >30 s rhythm run records `rec.rhythm`
  but leaves `rec.pace` at 0.
- ~~`sd_speed` lost the in-flight rep at the action-phase boundary.~~
  **Fixed.** The phase-end handler used `if (holding) pressEndStopwatch()`,
  which with `releaseGrace > 0` merely *defers* the release — the pass/fail
  check on the next line then ran without that rep, and the deferred
  finalize later landed in the `rest` phase where it counted nothing. Could
  cause an unfair game over. Now uses `flushPendingRelease()` (counts an
  in-progress *or* grace-pending tap synchronously), exactly like
  `sd_mixed` already did at its action→hold boundary.
- ~~Interval Sequence re-read presets from `localStorage` at each phase
  advance.~~ **Fixed.** Deleting an assigned preset mid-session made
  `ivAdvancePhase()` resolve `{}` → `applyRepsConfig()` produced NaNs → the
  hold could never complete (`S.heldMs >= NaN`), soft-locking the session.
  `buildPlan()` now snapshots the resolved preset objects into
  `S.iv_phasePresetObjs` and `ivAdvancePhase()` reads only those.
- ~~Interval time-phase could start one extra rep after its deadline.~~
  **Fixed.** The phase-deadline check lived only in `nextRep()`; if the
  deadline passed *during the rest countdown*, `beginRep()` (which for
  standalone Time mode re-checks `timeUp()` at exactly that moment) started
  another rep anyway. The check is now the shared `ivPhaseTimeUp()` helper,
  and `beginRep()` routes an expired phase back through `nextRep()` to
  advance/finish.
- ~~Stats box, curve-editor overlay titles, and the eyes-closed tap hint
  hardcoded English.~~ **Fixed.** `renderStats()`'s five lines,
  `refreshCurveOverlayForMode()`'s four title/subtitle variants, and the
  `.tapHint` span now route through `T()` (new `stats*`/`curveTitle*`/
  `curveSubTitle*`-family/`tapHint`/`repPlural` keys, de + en);
  `applyRuntimeI18n()` additionally calls `renderStats()` since the stats
  box is innerHTML-built rather than `data-i18n`-driven. The `finish()`
  pluralization (`T().rep + "s"` → "Wdhs" in German) now uses `repPlural`.
  `updateSummaries()`'s scenario-name map also gained the missing
  `timeattack`/`rhythm` entries, and history entries now store `scenario`
  alongside `goal` (older entries simply lack the key).
- **`presetLoad()` of a pre-curve-capture preset blanks the stored curves**:
  a preset saved before curve capture existed has no `.curves`, so loading
  it runs `applyIvPhaseCurve()`'s uniform-fallback *and then* persists that
  blank via `saveCurves()`, overwriting the user's hand-drawn shapes. Left
  as-is deliberately — "load preset" is a full-restore operation and the
  ambiguity only affects legacy presets — but documented here.
- **Tick-counted countdowns vs. deadlines**: the rest and late-start
  countdowns decrement a counter per `setInterval` tick instead of
  comparing against a deadline timestamp, so background-tab timer
  throttling stretches them. (Playwright's mock clock exposes the same
  property: `clock.fastForward()` fires a repeating timer only once, so
  tests must use `clock.runFor()` around these countdowns.) Not fixed —
  the scenario engine's deadline-based timers are unaffected, and the RAF
  hold loop freezing while hidden is arguably the safe behavior for a
  breath-hold app.
- **`readAll()`/`buildPlan()` dual source of truth** for settings (see § 5)
  — can silently diverge on out-of-range input. Not addressed — would need
  a decision on whether `buildPlan()`'s clamping should also correct the
  persisted value, which is a behavior change, not a pure cleanup.
- **Naming inconsistencies** (not addressed, deliberately deferred): `sw`/
  `sd_`/`ta_`/`rr_` prefixes still don't map cleanly to their scope (see
  § 3); `S`'s scenario-state fields still mix snake-ish prefixes
  (`sd_actionMs`) with the rest of `S`'s camelCase. A full rename would touch
  a large fraction of the scenario engine for a purely internal/cosmetic
  gain — left as a deliberate future call, not a quick fix.
- **Confetti palette** (`index.html:2173`) and the curve-editor stroke
  color still hardcode hex values close to but not identical to the theme's
  `--good`/`--bad`/`--rise` CSS variables. Left intentionally as-is — this is
  a subjective/cosmetic call with no clear "correct" fix, not a correctness
  bug.
- 9 of 11 `I18N` languages are still 27/306-key stubs, intentionally gated
  off by `SUPPORTED_LANGS` — documented here so nobody assumes they're
  either dead code to delete or complete/reachable.
- Two `I18N` keys (`scenarioTitle`, `statsStreak`) still appear to be
  defined but unreferenced — worth confirming before deleting.

# Architecture reference — Breathless

Deep technical reference for `index.html` (single-file PWA, ~3750 lines).
Read `CLAUDE.md` first for the quick orientation; this file is the detailed
backing reference for everything summarized there.

All line numbers below reflect the file as of the documentation pass that
created this file. They will drift as the code changes — **if you notice a
reference here is off by more than a few lines, fix it while you're in the
area**, rather than leaving it stale for the next reader.

---

## 1. Global state reference

### The `S` object

Declared `let S = null;` at `index.html:2344`. Created by `buildPlan()`
(`index.html:2421`) at session start, discarded (`S = null`) at the end
of both `finish()` (`index.html:3566`) and `stopSession()` (`index.html:3622`).

**Fields set in `buildPlan()`:**

| Field | Purpose |
|---|---|
| `goal` | `"reps"` / `"time"` / `"scenario"` |
| `base`, `chance`, `minHold`, `maxHold` | fixed hold length + long-hold probability/range (reps/time) |
| `minRest`, `maxRest` | rest range (reps/time) |
| `releaseGrace` | ms grace before a release counts (shared by both paths) |
| `strict` | early release restarts the rep (reps/time only) |
| `penalty`, `penaltyX`, `lateTol` | early-release / late-start penalty system (reps/time only) |
| `hide` | hide required hold duration from the UI |
| `armed` | whether input is currently accepted |
| `progressTone`, `prAnnounce` | feedback toggles |
| `pr` | personal-best snapshot from `getPR()` at session start |
| `longestHold`, `prBeaten` | running/session PR tracking |
| `sig` | `{speech,beep,vibrate}` cue-channel toggles |
| `words` | `{down,up,hold,penalty,finish}` custom cue text |
| `rate` | speech rate (0.5–2) |
| `eyesClosed`, `guardExit`, `screenColor` | display/handling toggles |
| `scenario`, `sd_actionMs`, `sd_pauseMs`, `sd_startReps`, `sd_startHold`, `ta_target`, `rr_bpm`, `rr_step`, `livesOn`, `livesCount` | only populated when `goal === "scenario"` |
| `totalMin` | only when `goal === "time"` |
| `totalReps` | reps count (reps) or `null` (time/scenario) |

**Fields set ad hoc at runtime** (never in `buildPlan`, added by whichever
function first needs them — this is most of the state):

- `S.done` — rep/round counter. Set in `startSession()`, mutated in
  `completeRep()`, `finalizeStopwatchRelease()`, `taComplete()`,
  `rhythmTap()` (which aliases it to `S.rr_hits` — the only scenario that
  does this the other way round).
- `S.cur`, `S.heldMs`, `S.spokeHold`, `S.lastSpokenSec` — per-rep hold
  target/progress. Set in `armReady()`/`beginRep()`, reset again inline in
  `finalizeRelease()`'s strict-mode branch.
- `S.subBase` — current sub-cue text template, overwritten from at least 6
  different call sites.
- `S.armed`, `S.waitingStart` — input-gate flags.
- `S.startTime`, `S.endAt` — session clock anchors, set in
  `bootFirstPress()` (`index.html:2715`) and `rhythmStart()`
  (`index.html:3134`) — **the wall clock starts on first press, not at
  `buildPlan()`/`startSession()`**.
- `S.livesMax`, `S.livesLeft` — lives system, set in `armReadyScenario()`,
  mutated in `tryLoseLife()` (`index.html:2579`).
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
  (`index.html:3344`).
- `S.iv_*` (Interval Sequence, `iv_` prefix) — `iv_phaseCount`, `iv_phases`
  (array of `{durMs,holdMs,restMs}`), `iv_phaseIdx`, `iv_phaseEndTs`,
  `iv_cycleState` (`"hold"`\|`"rest"`), `iv_cycleEndTs`, `iv_timer`. See
  § Scenario engine.

### Other module-level state

Declared near `let S = null;` (`index.html:2344` onward) unless noted:

| Var | Purpose |
|---|---|
| `holding` | true while the hold is actively engaged — set directly at 9 call sites; the two verified duplicates are centralized behind `resumeHeldRelease(loopFn)` (`index.html:2875`) and `releaseHold()` (`index.html:2887`), see § Known Issues |
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
| `cam` (`index.html:3633`) | camera-control module state — see § Camera control subsystem |

---

## 2. Session lifecycle

```
startSession() [index.html:2511]
  → buildPlan()                          (builds S)
  → show("session")
  → armReady()  or  armReadyScenario()    (dispatch on S.goal === "scenario")
        ↓ user presses
  → pressStart() / pressEnd()             ← universal input entry point
        │  if S.goal==="scenario": delegate to pressStartStopwatch()/pressEndStopwatch()
        ↓
  reps/time: beginRep → loop → completeRep → nextRep → beginRep (loop)
  scenario:  bootFirstPress (once) → pressStartStopwatch/pressEndStopwatch/
             finalizeStopwatchRelease, looping via stopwatchHoldLoop,
             S.sd_timer/S.rr_timer/S.iv_timer depending on scenario
        ↓
  finish()          (goal met / scenario game-over / Time Attack target hit /
                      Interval Sequence's last phase ends)
    or
  stopSession()     (user hits Stop — every goal/scenario, never recorded)
```

`pressStart()`/`pressEnd()` (`index.html:3424`/`3455`) are the **only**
shared dispatch point between the two families. They're the single entry
point for all input sources: the hold button, the eyes-closed tap surface,
the space/enter key, and the camera (`camOnPress`/`camOnRelease`). Below
this dispatch point the two paths are almost entirely separate.

### Reps/Time path

- `armReady()` (`index.html:2535`): arms the first rep, picks `S.cur` via
  `holdDurationFor()`.
- `pressStart()`: on `waitingStart`, calls `bootFirstPress()` (shared with
  scenario) to start the clock, then sets `holding=true` and kicks `loop()`.
- `loop(ts)` (`index.html:3391`): RAF-driven, delta-time hold-progress
  integration; calls `completeRep()` at target.
- `pressEnd()` → `finalizeRelease()` (`index.html:3472`): strict-mode
  restart, penalty, early-release messaging. **Only this path uses
  `S.strict`, `S.penalty`, `startReactionWindow`, `applyPenalty`.**
- `completeRep()` (`index.html:3518`): finalizes a rep, updates
  `S.done`/`S.holdSec`/`S.longestHold`/PR, `setTimeout(650ms)` →
  `nextRep(false)`.
- `nextRep(first)` (`index.html:3292`): checks end conditions, runs the rest
  countdown, calls `beginRep()`.
- `beginRep()` (`index.html:3314`): mirrors `armReady()` for reps 2..N, also
  calls `startReactionWindow()`.

### Scenario path

- `armReadyScenario()` (`index.html:2633`): single dispatcher that inline-
  initializes **all seven** scenarios' fields in one large if/else chain,
  then calls `rhythmStart()` for `"rhythm"` as a special case (rhythm alone
  auto-starts, no press needed to boot).
- `bootFirstPress()` (`index.html:2715`): shared boot logic (clock/wake-
  lock/guard) **plus** it owns the entire `S.sd_timer` `setInterval`
  definitions for `sd_speed` and `sd_mixed`, and the `S.iv_timer` setup for
  `interval` — three full per-scenario state machines defined inside this
  one function (the first two as anonymous closures, `interval`'s as a
  named-function dispatch, see § 3). `sd_hold`/`stopwatch`/`timeattack` have
  no equivalent timer (purely press/release driven); `rhythm` has its own
  separate `S.rr_timer` set up in `rhythmStart()`.
- `pressStartStopwatch()` (`index.html:2894`): handles "start holding";
  delegates immediately to `rhythmTap()` if scenario is `rhythm` (taps, not
  holds) or to `ivPressStart()` if scenario is `interval` (press tracked
  passively, doesn't gate cueing — see § 3) — both routed through the same
  entry point. The release-grace resume branch calls the shared
  `resumeHeldRelease()` helper (`index.html:2875`, see § Known Issues).
- `pressEndStopwatch()` (`index.html:2971`) → `finalizeStopwatchRelease()`
  (`index.html:2984`): ~120-line function with a big if/else-if chain over
  `S.scenario` (`sd_hold`, `sd_mixed`, `sd_speed`, else), duplicating much
  of what `completeRep()`/`finalizeRelease()` do for reps/time, reimplemented
  scenario-by-scenario. `interval` bypasses this entirely — `pressEndStopwatch()`
  delegates to `ivPressEnd()` as its very first line, same as `rhythm`
  structurally never reaching it either.
- `stopwatchHoldLoop()` (`index.html:2939`): the scenario equivalent of
  `loop()`, but `Date.now()`-based rather than delta-integrated; also
  special-cases `timeattack` (calls `taComplete`) and `sd_mixed`'s hold
  phase inline. Its guard condition hand-lists five scenario names — `rhythm`
  and `interval` are both deliberately excluded (each owns its own timer:
  `S.rr_timer`/`S.iv_timer`), so adding an 8th scenario risks forgetting to
  add it here (no assertion ties this list to the scenario dropdown).
- `taComplete()` (`index.html:3106`) and the `rhythm*` family
  (`rhythmStart` `index.html:3134`, `rhythmTick` `3151`, `rhythmTap` `3167`,
  `rhythmMiss` `3187`) are further, mostly self-contained mini state
  machines that still funnel through `finish()`. The `interval` family
  (`ivStartCycle`/`ivTick`/`ivPressStart`/`ivPressEnd`, `index.html:3205`-
  `3260`) is architecturally the same idea, one level more removed from
  press events — see § 3 for why.

### Shared vs. diverging

**Shared:** `pressStart`/`pressEnd` dispatch, `bootFirstPress`,
`setCue`/`cmd`/`applyScreenColor`, `startClock`/`updateClock`,
`progressStart/Update/Stop`, `finish()`, camera hooks, the
`releaseGrace`/`pendingRelease`/`releaseTimer` mechanism.

**Diverges:** timing integration strategy (delta-time RAF vs. `Date.now()`
deltas), rest/countdown mechanism (`restTimer`+`nextRep` vs. `swRestTimer`/
`sd_timer`/`rr_timer`/`iv_timer`), the penalty/strict-mode system (reps/time
only), and whether cueing is press-gated (every scenario except `interval`)
or fully automatic/timer-driven (`interval` only — see § Known Issues'
history for why `finish()`/`stopSession()` used to diverge here too, before
being unified: both now behave identically across every goal/scenario —
`stopSession()` for manual Stop, never recorded; `finish()` for natural end,
always recorded).

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
| `interval` | `S.iv_phaseIdx` (0..N-1) × `S.iv_cycleState` ∈ {hold, rest} | user configures 2–6 phases (each with its own `durMs`/`holdMs`/`restMs`); within a phase, cues alternate hold↔rest on the phase's own rhythm (`ivStartCycle()`) **fully automatically, not press-gated** — the physical press is tracked passively for `holding`-driven screen-color feedback and stats only, never gates cue timing; when the phase's `durMs` budget elapses, auto-advances to the next phase; after the last phase, calls `finish()` (natural end, always recorded) | own `S.iv_timer` (100ms tick, `ivTick()`) |

**`interval` is the one scenario with fully automatic cueing.** Every other
scenario in this table is press-gated (the cue/phase only advances once the
user actually presses/releases, or — for `rhythm` — taps within a timing
window). `interval` was deliberately built the opposite way: the goal is
training the user to *keep up with* an externally-set rhythm before applying
it for real, so the app must never wait for the user. This is why it bypasses
`finalizeStopwatchRelease()`/`stopwatchHoldLoop()` entirely — see § 2's
Scenario path section.

No lives support: `scenarioSupportsLives()` deliberately excludes `interval`
(alongside `stopwatch`/`timeattack`) since there's no fail condition — a
fixed practice cadence, not a challenge to survive. No per-scenario
personal-best record in `commitGameSession()` either, for the same reason
(no natural "best" metric for a configurable practice cadence); XP still
accrues via the existing generic formula.

### Naming-consistency notes (read before adding an 8th scenario)

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
- **`iv_` prefix** (Interval Sequence, added later) is the one fully
  consistent one: every field it owns is `iv_`-prefixed, and there's no
  reuse of `sw`/generic fields for anything `interval`-specific beyond the
  intentional reuse of `S.swHoldStartTs`/`S.swReleaseTs`/`S.done`/
  `S.holdSec`/`S.longestHold` for its passive press-tracking (a deliberate
  choice to reuse genuinely generic fields, not a naming inconsistency).

---

## 4. Cue/feedback system

### `setCue(kind, big, sub)` (`index.html:3380`)

Only three `kind` values are ever passed: **`"up"`**, **`"down"`**,
**`"rest"`**. Sets `lastCueKind`, the `#cue` CSS class, and always calls
`applyScreenColor()`.

### `cmd(kind)` (`index.html:2232`)

A *different*, overlapping vocabulary: `"down"`, `"up"`, `"hold"` (plus
`cmdCount`, `cmdFinish`, `cmdPenalty`, `cmdPenaltyThenDown` for other cue
moments). Dispatches speech/beep/vibrate, each gated by
`S.sig.speech`/`S.sig.beep`/`S.sig.vibrate`. **`cmd`'s `kind` and
`setCue`'s `kind` are different enumerations that happen to share two
string values** ("up"/"down") — easy to conflate when reading call sites.

`tick(kind)` (`index.html:2212`) is a third, lighter cue helper for
`isActionTap()` cases (rapid sd_speed/sd_mixed reps) — same "down"/"up"
vocabulary again, beep+vibrate only, no speech.

### Screen-color layer (`applyScreenColor(force)`, `index.html:2588`)

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

Storage helper `KV` (`index.html:986`) wraps `localStorage` with keys under
`K` (`lat.settings`, `lat.presets`, `lat.history`, `lat.pr`, `lat.curves`,
`lat.game`). A few keys are used as raw string literals instead of going
through `K`: `"lat.lang"`, `"lat.advOpen"`, `"lat.cam"`,
`"lat.camOnboarded"` — inconsistent but harmless (all share the `lat.`
prefix).

`SETTING_IDS` (`index.html:1779`, 60 element IDs — 19 are the Interval
Sequence scenario's per-phase fields) + `readAll()`/
`writeAll()` (`index.html:1792`/`1800`) round-trip the settings form through
`lat.settings` on every change (debounced 400ms). `writeAll()` also contains
a legacy migration shim: old blobs with `o.rest` but no `o.minRest` get
split into `minRest`/`maxRest`.

**Important**: `buildPlan()` does **not** call `readAll()` — it
independently re-reads the same DOM elements with its own clamping logic.
Any new setting must be wired into `SETTING_IDS`, `buildPlan()`, and usually
`updateSummaries()` — three separate places. If a user enters an
out-of-range value, `readAll()` persists it raw while `buildPlan()` silently
clamps it at session start with no user-visible feedback.

**Settings grouped by panel** (`<details class="panel">`):

| Panel | Settings |
|---|---|
| `secGoal` | `minReps, maxReps, totalMin, scenarioSel, sdActionSec, sdPauseSec, sdStartReps, sdStartHold, taTarget, rrBpm, rrStep, livesOn, livesCount` + `goal` |
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

`I18N` (`index.html:994`) defines 11 languages: `de, en, zh, hi, es, fr, ar,
bn, pt, ru, ur`. `T()` merges `en.strings` (fallback) with the active
language's `strings`. `SUPPORTED_LANGS = ["de","en"]`
(`index.html:1486`) is the actual gate — only these two are offered in the
language dropdown.

Verified key coverage: `de` and `en` each define all **311** `strings` keys
(identical sets, zero gaps — grew from 207 through the i18n/aria-label
localization pass, then to 311 with the Interval Sequence scenario's ~17
keys). The other 9 languages each define only **27** keys —
genuine, intentional stubs (not reachable, not dead code to delete — they're
prepared for future translation work).

Two keys (`scenarioTitle`, `statsStreak`) are defined in `de`/`en` but
appear unreferenced anywhere — worth confirming before deleting.

`applyRuntimeI18n()` (`index.html:1501`) walks `[data-i18n]`/
`[data-i18n-ph]`/`[data-i18n-aria]` elements (the last sets `aria-label`),
then re-runs `updateScenarioHint()`, `ivLabelPhases()` (sets the Interval
Sequence's numbered "Phase N" headings and per-phase aria-labels — can't be
a static `data-i18n-aria` key since it needs an embedded phase number, same
technique as `sdSpeedRepsGoal(n)`), `applyGoalVisibility()`,
`refreshPresetSelect()`, `updateSummaries()`, and curve redraws.

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

All logic in one block, `index.html:3633` onward. CSS `index.html:390-417`.
Markup: PiP preview `#camPip` (`~825`), setup overlay `#camOverlay`
(`~883`), onboarding card `#camIntro` (`~925`).

### State object

`const cam = {...}` (`index.html:3633`): `stream`, `video`, `running`,
`raf`, `mode` (`"idle"|"setup"|"session"`), `roi` (centered 30%×30% box by
default), `ref` (calibration baseline frame), a 48×48 downsample buffer
(`aw`/`ah`/`actx`), `pressThr:25`, `releaseThr:10`, `pixelDelta:25`,
`pressed`, `facing`, `adapt:true`, and auto-calibration measurement fields.
Persisted via `saveCamCfg()`/`loadCamCfg()` under `localStorage` key
`"lat.cam"`.

### Capture & detection pipeline

1. **Acquire**: `camAcquire()` (`index.html:3770`) calls `getUserMedia` with
   facingMode + 640×480 ideal constraints; retries with bare
   `{video:true}` on failure before giving up.
2. **Sample**: `camSampleGray()` (`index.html:3673`) draws the ROI sub-rect
   (computed against the *mirrored* preview) into the 48×48 canvas,
   converts to grayscale via standard luma weights.
3. **Change score**: `camChangeFrom(g)` (`index.html:3683`) counts pixels
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

- **Manual** `camCalibrate()` (`index.html:3688`): snapshots the current
  frame as `cam.ref`; user sets thresholds manually.
- **Auto** `camAutoCalibrate()` (`index.html:3694`): snapshots reference,
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
path, working in every session type (reps/time and all 6 scenarios), not
just a subset.

### Setup/consent flow

Toggling `#cameraControl` fires `maybeShowCamIntro()`
(`index.html:3823`, gated by `lat.camOnboarded`). `startSession()` redirects
to `camOpenSetup()` (`index.html:3796`) instead of starting a session if the
camera isn't yet in `"session"` mode; `camConfirmStart()`
(`index.html:3844`) validates thresholds and calibration before switching
modes and calling `startSession()` again. Camera flip forces recalibration
(`cam.ref = null`) since front/rear framing/lighting differ substantially.

### Error handling

- No camera / permission denied: shown as static text, no retry/re-prompt
  UX, and all failure modes (denied vs. no hardware vs. unsatisfiable
  constraints) collapse to the same message. Still a known gap, not fixed.
- **Stream-loss detection**: every acquired stream's tracks get a
  `track.onended` watcher (`camWatchStreamTracks()`, `index.html:3782`). If
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
(`index.html:2285`) — gates whether the toggle is even shown.

**Every `tryLoseLife()` call site** (`index.html:2579`, note: distinct from
`cueLifeLost()` at `2569`, which is just the vibrate/beep/flash cue fired
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
  `icon-192.png`/`icon-512.png`/`apple-touch-icon.png` — **only `icon.svg`
  exists in the repo**; verify the referenced PNGs are actually generated
  before relying on install-icon behavior.
- **Icon**: `icon.svg` is duplicated as an inline base64/data-URI favicon at
  `index.html:~11` — two copies of the same artwork, not auto-synced.
- **No service worker.** Grepped for `serviceWorker`/`sw.js` registration:
  none exists. The app has no offline cache layer beyond ordinary HTTP
  caching of the single file — the app is installable (manifest +
  standalone display) but not actually offline-capable in the service-worker
  sense.
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

This narrative explains several of the inconsistencies below: features
built early (Sudden Death family) predate the i18n retrofit and the
screen-color/lives systems built later, which is why they're the ones
missing localization and needing the newer systems bolted on rather than
designed in from the start.

---

## 9. Known Issues / technical debt

Honest inventory of what's messy, each with a risk note. A first audit pass
flagged the items below; a follow-up pass then fixed everything except the
last three (naming, confetti/curve colors, stub languages), which were
deliberately left as documented, low-priority items rather than fixed as
drive-by changes. **Resolved** items are kept here (not deleted) as a record
of what was found and how it was addressed — update this list again the next
time an item here gets fixed or a new one is found.

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
  pacing delay, `CAM_ADAPT_ALPHA = 0.03`, `rr_window = 260ms`.
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
- **Confetti palette** (`index.html:2044`) and the curve-editor stroke
  color still hardcode hex values close to but not identical to the theme's
  `--good`/`--bad`/`--rise` CSS variables. Left intentionally as-is — this is
  a subjective/cosmetic call with no clear "correct" fix, not a correctness
  bug.
- 9 of 11 `I18N` languages are still 27/311-key stubs, intentionally gated
  off by `SUPPORTED_LANGS` — documented here so nobody assumes they're
  either dead code to delete or complete/reachable.
- Two `I18N` keys (`scenarioTitle`, `statsStreak`) still appear to be
  defined but unreferenced — worth confirming before deleting.

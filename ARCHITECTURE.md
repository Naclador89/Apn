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

Declared `let S = null;` at `index.html:2159`. Created by `buildPlan()`
(`index.html:2235-2313`) at session start, discarded (`S = null`) at the end
of both `finish()` (`index.html:3266`) and `stopSession()` (`index.html:3334`).

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
  `bootFirstPress()` (`index.html:2515`) and `rhythmStart()`
  (`index.html:2918`) — **the wall clock starts on first press, not at
  `buildPlan()`/`startSession()`**.
- `S.livesMax`, `S.livesLeft` — lives system, set in `armReadyScenario()`,
  mutated in `tryLoseLife()` (`index.html:2383`).
- Stopwatch-family (`sw`-prefixed, shared beyond just "stopwatch" — see
  § Known Issues): `S.swLongest`, `S.swLastReleaseTs`, `S.swHoldStartTs`,
  `S.swReleaseTs`.
- Sudden-death family (`sd_`-prefixed, shared loosely across `sd_hold`/
  `sd_speed`/`sd_mixed` — see § Known Issues): `sd_phase`,
  `sd_repsThisPhase`, `sd_prevPhaseReps`, `sd_prevActionReps`, `sd_prevHold`,
  `sd_actionMsAcc`, `sd_mixedRounds`, `sd_holdTargetHit`, `sd_lastCountSec`,
  `sd_phaseEndTs`, `sd_timer`, `sd_failMsg` (the last one is actually used by
  **every** scenario, not just the `sd_` ones — a naming leftover).
- Time Attack: `S.ta_target` (from `buildPlan`) + ad hoc `S.taScore`.
- Rhythm (`rr_`-prefixed): `S.rr_interval`, `S.rr_window`,
  `S.rr_beatsPerLevel`, `S.rr_hits`, `S.rr_level`, `S.rr_countIn`,
  `S.rr_beatTime`, `S.rr_ticked`, `S.rr_tapped`, `S.rr_timer`,
  `S.rr_lastFlashAt`, `S.rr_flashUntil`.
- `S.holdSec` — cumulative held seconds across the whole session, touched
  in `completeRep()`/`finalizeStopwatchRelease()`/`taComplete()`.
- `S.reactLeft` — late-start countdown, set in `startReactionWindow()`
  (`index.html:3059`).

### Other module-level state

Declared near `let S = null;` (`index.html:2159` onward) unless noted:

| Var | Purpose |
|---|---|
| `holding` | true while the hold is actively engaged — the single most-mutated flag in the file (13 assignment sites, see § Known Issues) |
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
| `cam` (`index.html:3361`) | camera-control module state — see § Camera control subsystem |

---

## 2. Session lifecycle

```
startSession() [index.html:2315]
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
             S.sd_timer, or S.rr_timer depending on scenario
        ↓
  finish()          (goal met / scenario game-over / Time Attack target hit)
    or
  stopSession()     (user hits Stop — reps/time & stopwatch-family only)
```

`pressStart()`/`pressEnd()` (`index.html:3139`/`3177`) are the **only**
shared dispatch point between the two families. They're the single entry
point for all input sources: the hold button, the eyes-closed tap surface,
the space/enter key, and the camera (`camOnPress`/`camOnRelease`). Below
this dispatch point the two paths are almost entirely separate.

### Reps/Time path

- `armReady()` (`index.html:2339`): arms the first rep, picks `S.cur` via
  `holdDurationFor()`.
- `pressStart()`: on `waitingStart`, calls `bootFirstPress()` (shared with
  scenario) to start the clock, then sets `holding=true` and kicks `loop()`.
- `loop(ts)` (`index.html:3106`): RAF-driven, delta-time hold-progress
  integration; calls `completeRep()` at target.
- `pressEnd()` → `finalizeRelease()` (`index.html:3196`): strict-mode
  restart, penalty, early-release messaging. **Only this path uses
  `S.strict`, `S.penalty`, `startReactionWindow`, `applyPenalty`.**
- `completeRep()` (`index.html:3242`): finalizes a rep, updates
  `S.done`/`S.holdSec`/`S.longestHold`/PR, `setTimeout(650ms)` →
  `nextRep(false)`.
- `nextRep(first)` (`index.html:3007`): checks end conditions, runs the rest
  countdown, calls `beginRep()`.
- `beginRep()` (`index.html:3029`): mirrors `armReady()` for reps 2..N, also
  calls `startReactionWindow()`.

### Scenario path

- `armReadyScenario()` (`index.html:2437`): single dispatcher that inline-
  initializes **all six** scenarios' fields in one large if/else chain, then
  calls `rhythmStart()` for `"rhythm"` as a special case (rhythm alone
  auto-starts, no press needed to boot).
- `bootFirstPress()` (`index.html:2515`): shared boot logic (clock/wake-
  lock/guard) **plus** it owns the entire `S.sd_timer` `setInterval`
  definitions for `sd_speed` and `sd_mixed` — two full per-scenario state
  machines defined as anonymous closures inside this one function.
  `sd_hold`/`stopwatch`/`timeattack` have no equivalent timer (purely
  press/release driven); `rhythm` has its own separate `S.rr_timer` set up
  in `rhythmStart()`.
- `pressStartStopwatch()` (`index.html:2669`): handles "start holding";
  delegates immediately to `rhythmTap()` if scenario is `rhythm` — rhythm
  doesn't "hold", it taps, but is routed through the same entry point.
- `pressEndStopwatch()` (`index.html:2754`) → `finalizeStopwatchRelease()`
  (`index.html:2768`): ~120-line function with a big if/else-if chain over
  `S.scenario` (`sd_hold`, `sd_mixed`, `sd_speed`, else), duplicating much
  of what `completeRep()`/`finalizeRelease()` do for reps/time, reimplemented
  scenario-by-scenario.
- `stopwatchHoldLoop()` (`index.html:2722`): the scenario equivalent of
  `loop()`, but `Date.now()`-based rather than delta-integrated; also
  special-cases `timeattack` (calls `taComplete`) and `sd_mixed`'s hold
  phase inline. Its guard condition hand-lists five scenario names — adding
  a 7th scenario risks forgetting to add it here (no assertion ties this
  list to the scenario dropdown).
- `taComplete()` (`index.html:2890`) and the `rhythm*` family
  (`rhythmStart` `index.html:2918`, `rhythmTick` `2934`, `rhythmTap` `2950`,
  `rhythmMiss` `2970`) are further, mostly self-contained mini state
  machines that still funnel through `finish()`.

### Shared vs. diverging

**Shared:** `pressStart`/`pressEnd` dispatch, `bootFirstPress`,
`setCue`/`cmd`/`applyScreenColor`, `startClock`/`updateClock`,
`progressStart/Update/Stop`, `finish()`, camera hooks, the
`releaseGrace`/`pendingRelease`/`releaseTimer` mechanism.

**Diverges:** timing integration strategy (delta-time RAF vs. `Date.now()`
deltas), rest/countdown mechanism (`restTimer`+`nextRep` vs. `swRestTimer`/
`sd_timer`/`rr_timer`), the penalty/strict-mode system (reps/time only), and
— critically — `finish()`/`stopSession()` are not symmetric (see § Known
Issues).

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

### Naming-consistency notes (read before adding a 7th scenario)

- **`sd_` prefix** is used for `sd_hold`/`sd_speed`/`sd_mixed` fields, but
  `sd_hold` never sets `S.sd_phase` — the prefix implies a phase machine
  that only 2 of the 3 "sd_" scenarios actually have.
  `S.sd_failMsg` is used by **every** scenario including `timeattack` and
  `rhythm` — it's really a generic "end-of-session message" field misnamed
  after "sudden death".
- **`sw` prefix** originally meant "stopwatch" but is shared by `sd_hold`
  too, and the DOM elements it's tied to (`#swStats`, `#swRest`,
  `#swLongest`) are reused and manually relabeled with hardcoded strings for
  every other scenario — `sw` is really just "the two generic stat
  readouts", reused for six different meanings.
- **`ta_` prefix** exists only for `ta_target`; `taScore`/`taComplete` drop
  the underscore.
- **`rr_` prefix** (rhythm) is the most internally consistent, but
  `S.done = S.rr_hits` — rhythm aliases the generic `done` counter to its
  own field rather than the reverse, unlike every other scenario.

---

## 4. Cue/feedback system

### `setCue(kind, big, sub)` (`index.html:3095`)

Only three `kind` values are ever passed: **`"up"`**, **`"down"`**,
**`"rest"`**. Sets `lastCueKind`, the `#cue` CSS class, and always calls
`applyScreenColor()`.

### `cmd(kind)` (`index.html:2065`)

A *different*, overlapping vocabulary: `"down"`, `"up"`, `"hold"` (plus
`cmdCount`, `cmdFinish`, `cmdPenalty`, `cmdPenaltyThenDown` for other cue
moments). Dispatches speech/beep/vibrate, each gated by
`S.sig.speech`/`S.sig.beep`/`S.sig.vibrate`. **`cmd`'s `kind` and
`setCue`'s `kind` are different enumerations that happen to share two
string values** ("up"/"down") — easy to conflate when reading call sites.

`tick(kind)` (`index.html:2045`) is a third, lighter cue helper for
`isActionTap()` cases (rapid sd_speed/sd_mixed reps) — same "down"/"up"
vocabulary again, beep+vibrate only, no speech.

### Screen-color layer (`applyScreenColor(force)`, `index.html:2392`)

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

Storage helper `KV` (`index.html:932`) wraps `localStorage` with keys under
`K` (`lat.settings`, `lat.presets`, `lat.history`, `lat.pr`, `lat.curves`,
`lat.game`). A few keys are used as raw string literals instead of going
through `K`: `"lat.lang"`, `"lat.advOpen"`, `"lat.cam"`,
`"lat.camOnboarded"` — inconsistent but harmless (all share the `lat.`
prefix).

`SETTING_IDS` (`index.html:1616`, 40 element IDs) + `readAll()`/
`writeAll()` (`index.html:1625`/`1633`) round-trip the settings form through
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

`I18N` (`index.html:940`) defines 11 languages: `de, en, zh, hi, es, fr, ar,
bn, pt, ru, ur`. `T()` merges `en.strings` (fallback) with the active
language's `strings`. `SUPPORTED_LANGS = ["de","en"]`
(`index.html:1328`) is the actual gate — only these two are offered in the
language dropdown.

Verified key coverage: `de` and `en` each define all **207** `strings` keys
(identical sets, zero gaps). The other 9 languages each define only **27**
keys — genuine, intentional stubs (not reachable, not dead code to delete —
they're prepared for future translation work).

Two keys (`scenarioTitle`, `statsStreak`) are defined in `de`/`en` but
appear unreferenced anywhere — worth confirming before deleting.

`applyRuntimeI18n()` (`index.html:1343`) walks `[data-i18n]`/
`[data-i18n-ph]` elements, then re-runs `updateScenarioHint()`,
`applyGoalVisibility()`, `refreshPresetSelect()`, `updateSummaries()`, and
curve redraws.

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

All logic in one block, `index.html:3361` onward. CSS `index.html:390-417`.
Markup: PiP preview `#camPip` (`~825`), setup overlay `#camOverlay`
(`~883`), onboarding card `#camIntro` (`~925`).

### State object

`const cam = {...}` (`index.html:3361`): `stream`, `video`, `running`,
`raf`, `mode` (`"idle"|"setup"|"session"`), `roi` (centered 30%×30% box by
default), `ref` (calibration baseline frame), a 48×48 downsample buffer
(`aw`/`ah`/`actx`), `pressThr:25`, `releaseThr:10`, `pixelDelta:25`,
`pressed`, `facing`, `adapt:true`, and auto-calibration measurement fields.
Persisted via `saveCamCfg()`/`loadCamCfg()` under `localStorage` key
`"lat.cam"`.

### Capture & detection pipeline

1. **Acquire**: `camAcquire()` (`index.html:3495`) calls `getUserMedia` with
   facingMode + 640×480 ideal constraints; retries with bare
   `{video:true}` on failure before giving up.
2. **Sample**: `camSampleGray()` (`index.html:3398`) draws the ROI sub-rect
   (computed against the *mirrored* preview) into the 48×48 canvas,
   converts to grayscale via standard luma weights.
3. **Change score**: `camChangeFrom(g)` (`index.html:3408`) counts pixels
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

- **Manual** `camCalibrate()` (`index.html:3413`): snapshots the current
  frame as `cam.ref`; user sets thresholds manually.
- **Auto** `camAutoCalibrate()` (`index.html:3419`): snapshots reference,
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
(`index.html:3528`, gated by `lat.camOnboarded`). `startSession()` redirects
to `camOpenSetup()` (`index.html:3501`) instead of starting a session if the
camera isn't yet in `"session"` mode; `camConfirmStart()`
(`index.html:3549`) validates thresholds and calibration before switching
modes and calling `startSession()` again. Camera flip forces recalibration
(`cam.ref = null`) since front/rear framing/lighting differ substantially.

### Error handling — known gaps

- No camera / permission denied: shown as static text, no retry/re-prompt
  UX, and all failure modes (denied vs. no hardware vs. unsatisfiable
  constraints) collapse to the same message.
- **No `track.onended`/error listener** — if the stream dies mid-session
  (permission revoked, tab backgrounded, device unplugged), the gesture
  detector just silently stops updating; no user-facing error, no pause, no
  fallback to touch.

---

## 7. Lives system

Core state/UI: CSS `index.html:423-429`; checkbox `#livesOn`; row container
`#livesRow`.

```js
function scenarioSupportsLives(scn){
  return scn==="sd_hold" || scn==="sd_speed" || scn==="sd_mixed" || scn==="rhythm";
}
```
(`index.html:2118`) — gates whether the toggle is even shown.

**Every `tryLoseLife()` call site** (`index.html:2383`, note: distinct from
`cueLifeLost()` at `2373`, which is just the vibrate/beep/flash cue fired
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
} else { S.sd_failMsg = ...; finish(); }` — reaching 0 lives is what turns a
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

This narrative explains several of the inconsistencies below: features
built early (Sudden Death family) predate the i18n retrofit and the
screen-color/lives systems built later, which is why they're the ones
missing localization and needing the newer systems bolted on rather than
designed in from the start.

---

## 9. Known Issues / technical debt

Honest inventory of what's messy, each with a risk note. None of these are
fixed as part of a documentation pass — they're flagged here so future work
can address them deliberately, with full context, rather than by accident.

- **Biggest one: hardcoded German bypasses i18n in the Sudden Death family
  and Time Attack.** `sd_hold`/`sd_speed`/`sd_mixed`/`timeattack` scenario
  code is riddled with hardcoded German UI strings that never route through
  `T()` — swStats labels ("Phase Zeit", "Gesamt-Hold", "Level (BPM)" etc.),
  live subcues ("Action-Phase endet in Xs", "Halten in Xs"), cue-word
  overrides that bypass the user's custom words entirely ("HALTEN",
  "GESCHAFFT"), and failure messages mixing German/English in one string.
  `stopwatch` and `rhythm` are correctly localized via `T()`. **This is a
  real, easily-reproducible bug in English mode**, not just a stylistic gap.
  Risk to fix: touches dozens of call sites across 4 scenario engines,
  needs full regression testing in both languages.
- **`finish()`/`stopSession()` asymmetry.** Both open with a near-identical
  ~10-line teardown block (cancel timers, hide UI, reset color state) that
  should be a shared `teardownSessionTimers()` helper. Beyond that, `finish()`
  additionally does history/gamification bookkeeping that `stopSession()`
  skips entirely — and the Stop button branches so that **stopping a
  scenario session early always records it, stopping a reps/time session
  early never does.** Looks like an unintentional asymmetry, not a
  deliberate design choice. Risk to fix: behavior-changing, needs an
  explicit decision on which behavior is "correct" before touching it.
- **`holding` mutated at 13 call sites**, no shared setter/getter. The
  `pendingRelease`-resume block is duplicated near-verbatim between
  `pressStartStopwatch()` and `pressStart()`. Good candidate for a shared
  `beginHold()`/`endHold()` helper, but touches every input path — needs
  careful regression testing across touch/keyboard/camera/eyes-closed.
- **`readAll()`/`buildPlan()` dual source of truth** for settings (see § 5)
  — can silently diverge on out-of-range input.
- Validation error strings (`validate()`), some `alert`/`confirm` dialogs,
  and vibration-test messages are hardcoded English, never routed through
  `T()`.
- `aria-label` attributes across the settings form are hardcoded English,
  never updated by `applyRuntimeI18n()` — screen-reader users get English
  labels regardless of `appLang`.
- Magic numbers without inline explanation: `heldMs > 150` (early-tap
  threshold in `finalizeRelease()`), `650ms` post-rep pacing delay in
  `completeRep()`, `CAM_ADAPT_ALPHA = 0.03`, `rr_window = 260ms` (rhythm
  beat-timing tolerance, not user-configurable unlike `rr_bpm`/`rr_step`).
- Naming inconsistencies: `sw`/`sd_`/`ta_`/`rr_` prefixes don't map cleanly
  to their scope (see § 3); `S`'s scenario-state fields mix snake-ish
  prefixes (`sd_actionMs`) with the rest of `S`'s camelCase.
- Confetti palette (`index.html:~1888`) and the curve-editor stroke color
  hardcode hex values close to but not identical to the theme's
  `--good`/`--bad`/`--rise` CSS variables. Left intentionally as-is — this
  is a subjective/cosmetic call with no clear "correct" fix, not a
  correctness bug.
- 9 of 11 `I18N` languages are 27/207-key stubs, intentionally gated off by
  `SUPPORTED_LANGS` — documented here so nobody assumes they're either dead
  code to delete or complete/reachable.
- Two `I18N` keys (`scenarioTitle`, `statsStreak`) appear to be defined but
  unreferenced — worth confirming before deleting.

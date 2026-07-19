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

`index.html`'s `<script>` block runs `926`–`3855`, wrapped in a single
`"use strict"` IIFE. `$(id)` is a `getElementById` shorthand defined near the
top of that block.

## Core architecture at a glance

**Global session state**: a single object `S` (declared `let S = null;` at
`index.html:2344`) holds everything about the in-flight session. It's built
by `buildPlan()` (`index.html:2421`) at session start and set back to `null`
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
same helpers.

**Two parallel session paths**, forking at the shared entry points
`pressStart()`/`pressEnd()` (`index.html:3424`/`3455`) based on
`S.goal === "scenario"`:

- **Reps / Time** (`S.goal` = `"reps"` or `"time"`): `armReady()` →
  `beginRep()` → `loop()` (RAF, delta-time) → `completeRep()` → `nextRep()`
  → back to `beginRep()`. This is the only path with the strict-mode /
  penalty / late-start-tolerance system (`S.strict`, `S.penalty`,
  `S.lateTol`, `startReactionWindow()`).
- **Scenario** (`S.goal === "scenario"`, 7 sub-modes — see table below):
  `armReadyScenario()` → `bootFirstPress()` → `pressStartStopwatch()` /
  `pressEndStopwatch()` → `finalizeStopwatchRelease()`, driven by
  `stopwatchHoldLoop()` (timestamp-based, not delta-integrated) plus
  per-scenario timers (`S.sd_timer`, `S.rr_timer`, `S.iv_timer`).
  `interval` is architecturally the odd one out: it bypasses
  `finalizeStopwatchRelease()`/`stopwatchHoldLoop()` entirely (own
  `ivPressStart()`/`ivPressEnd()`/`ivTick()`, `index.html:3244`/`3252`/
  `3217`) because its cueing is fully automatic and timer-driven —
  hold/rest cues advance on the app's own clock regardless of whether the
  user is actually pressing; the physical press is tracked passively
  (`holding`-driven screen-color feedback + stats only), it never gates
  cue timing. Every other scenario in the table below *is* press-gated.

Both paths funnel into `finish()` (`index.html:3566`) on success/game-over —
this is what records history/gamification. Manually hitting Stop always
calls `stopSession()` (`index.html:3622`) instead, for both session types:
an aborted session is never recorded, only a natural end is.

**Scenario engine** (dispatch table, all set up in `armReadyScenario()`,
`index.html:2633`):

| Scenario | Phase concept | Timer |
|---|---|---|
| `stopwatch` | none — freeform hold/release | `swRestTimer` |
| `sd_hold` | none — must beat previous hold or lose a life | `swRestTimer` (shared with stopwatch) |
| `sd_speed` | `S.sd_phase`: action ↔ rest | own `S.sd_timer` |
| `sd_mixed` | `S.sd_phase`: action → hold → pause | own `S.sd_timer` |
| `timeattack` | none — accumulate hold time to a target | none (RAF-driven) |
| `rhythm` | implicit, via `S.rr_level`/`S.rr_countIn` | own `S.rr_timer` |
| `interval` | `S.iv_phaseIdx` (0..N-1) × `S.iv_cycleState` (hold/rest) — user-configured 2–6 phases, each with its own duration/hold/rest length | own `S.iv_timer`, fully automatic cueing (not press-gated, see above) |

Naming is **not** consistent across scenarios (`sd_`/`sw`/`ta_`/`rr_`
prefixes don't map 1:1 to what they claim — e.g. `sd_hold` never sets
`S.sd_phase` at all). Don't assume a prefix tells you which scenarios use a
field; check `ARCHITECTURE.md § Scenario engine` or grep.

**Cue/feedback layer**: three *different*, overlapping small dispatchers —
`setCue(kind,...)` (`index.html:3380`, `kind` ∈ `"up"/"down"/"rest"`, also
always calls `applyScreenColor()`), `cmd(kind)` (`index.html:2232`, `kind` ∈
`"down"/"up"/"hold"`, drives speech+beep+vibrate), and `tick(kind)`
(`index.html:2212`, lighter beep+vibrate only, for rapid action-phase taps).
Don't confuse `setCue`'s and `cmd`'s `kind` — they share two string values
but are different enumerations for different purposes.

**Screen-color mode** (`applyScreenColor()`, `index.html:2588`): two overlay
layers, `#screenColorLayer` (slow ambient fill) and
`#screenColorBorderLayer` (instant, fully-opaque 10px border using the
theme's `--good`/`--rise`/`--bad` vars) — both driven by the same 3-state
derivation (green/yellow/red) computed once per call. When a real late-start
tolerance window is ticking (reps/time only, `S.penalty` + `S.lateTol > 0`),
the yellow ramp is paced to `S.lateTol` seconds instead of a fixed cosmetic
duration; see `ARCHITECTURE.md § Cue/feedback system` for the derivation
logic.

**Settings / persistence**: `SETTING_IDS` (`index.html:1779`, 60 element
IDs — 19 of them are the Interval Sequence scenario's per-phase fields,
`ivPhaseCount` + `ivDur1..6`/`ivHold1..6`/`ivRest1..6`) +
`KV`/`readAll()`/`writeAll()` (`index.html:986`/`1792`) round-trip
the whole settings form through `localStorage` key `lat.settings`.
`buildPlan()` independently re-reads the same DOM elements (with its own
clamping) rather than reusing `readAll()`'s output — a dual-source-of-truth
pattern to keep in mind if you add a new setting (wire it into *both*
`SETTING_IDS` and `buildPlan()`, and usually `updateSummaries()` too). This
one is still open — see `ARCHITECTURE.md § Known Issues`.

**i18n**: `I18N` object (`index.html:994`) defines 11 languages; only
`de`/`en` are complete (fully in sync key-for-key) and exposed via
`SUPPORTED_LANGS = ["de","en"]` (`index.html:1486`) — the other 9 are
intentional stubs, not dead code, not reachable. `T()` merges `en.strings`
(fallback) with the active language. All six scenarios (including the
Sudden Death family and Time Attack, which used to bypass this) now route
their UI text through `T()`; validation errors, `alert`/`confirm` dialogs,
and `aria-label`s do too (`data-i18n-aria` + `applyRuntimeI18n()`).

## Known inconsistencies (condensed — see `ARCHITECTURE.md § Known Issues` for full detail)

Resolved in a follow-up pass (kept here as a record, not deleted): Sudden
Death/Time Attack hardcoded-German text, the `finish()`/`stopSession()`
history-recording asymmetry + duplicated teardown, the two verified
`holding`-flag duplications, hardcoded validation/dialog/`aria-label`
strings, missing camera stream-loss detection, and unexplained magic
numbers.

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

- Camera control (`index.html:3633` on) drives the exact same
  `pressStart()`/`pressEnd()` as touch/keyboard via `camOnPress()`/
  `camOnRelease()` — it's a genuine drop-in input source, works in every
  session type. Mid-session stream loss (permission revoked, device
  unplugged) is now detected (`camWatchStreamTracks()`) and surfaced with a
  `camStreamLost` message instead of silently freezing.
- Lives system (`tryLoseLife()`, `index.html:2579`) is wired into exactly
  `sd_hold`, `sd_speed`, `sd_mixed`, `rhythm` — `stopwatch`/`timeattack`/
  `interval` have no fail condition, so lives are structurally inapplicable
  there (`scenarioSupportsLives()`, `index.html:2285`).

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

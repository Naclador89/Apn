(function(){
  "use strict";
  const $ = id => document.getElementById(id);

  // ---------- storage helpers (localStorage; degrade silently if unavailable) ----------
  const KV = {
    get(k, dflt){ try{ const v=localStorage.getItem(k); return v==null?dflt:JSON.parse(v); }catch(e){ return dflt; } },
    set(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} },
    del(k){ try{ localStorage.removeItem(k); }catch(e){} },
  };
  const K = { settings:"lat.settings", presets:"lat.presets", history:"lat.history", pr:"lat.pr", curves:"lat.curves", game:"lat.game" };

  // ---------- i18n: top-10 most-spoken languages ----------
  let LANG = "en";
  const T = () => Object.assign({}, I18N.en.strings, (I18N[LANG] && I18N[LANG].strings) || {});
  const cueWord = (kind) => {
    const L = I18N[LANG] || I18N.en;
    return kind==="down" ? L.cueDown : kind==="up" ? L.cueUp : kind==="long" ? L.cueLong :
           kind==="penalty" ? L.cuePenalty : kind==="finish" ? L.cueFinish : "";
  };
  const speechTag = () => (I18N[LANG] || I18N.en).speech;

  // only fully-translated languages are offered; the rest fall back to English
  const SUPPORTED_LANGS = ["de","en"];
  function populateLangSelect(){
    const sel = $("appLang"); if(!sel) return;
    sel.innerHTML = SUPPORTED_LANGS.map(code=>
      `<option value="${code}">${I18N[code].name}</option>`).join("");
    sel.value = LANG;
  }
  function setLang(code){
    if(SUPPORTED_LANGS.indexOf(code) === -1) code = "en";
    LANG = code;
    KV.set("lat.lang", code);
    document.documentElement.setAttribute("lang", code);
    document.documentElement.setAttribute("dir", (code==="ar"||code==="ur") ? "rtl" : "ltr");
    applyRuntimeI18n();
  }
  function applyRuntimeI18n(){
    const t = T();
    // localize every element carrying a data-i18n / data-i18n-ph key
    document.querySelectorAll('[data-i18n]').forEach(el=>{
      const v = t[el.getAttribute('data-i18n')];
      if(typeof v === "string") el.textContent = v;
    });
    document.querySelectorAll('[data-i18n-ph]').forEach(el=>{
      const v = t[el.getAttribute('data-i18n-ph')];
      if(typeof v === "string") el.placeholder = v;
    });
    document.querySelectorAll('[data-i18n-aria]').forEach(el=>{
      const v = t[el.getAttribute('data-i18n-aria')];
      if(typeof v === "string") el.setAttribute('aria-label', v);
    });
    const rl2 = $("repLabel"); if(rl2) rl2.textContent = t.rep;
    updateScenarioHint();
    ivLabelPhases();
    applyGoalVisibility();      // refresh the dynamic penalty label for the language
    if(typeof refreshPresetSelect === "function") refreshPresetSelect();
    if(typeof updateSummaries === "function") updateSummaries();
    try{ drawCurve("hold"); drawCurve("rest"); }catch(e){}
    if($("appLang")) $("appLang").value = LANG;
  }
  // Scenario description under the picker — changes with the chosen scenario.
  function updateScenarioHint(){
    const el = $("scenarioHint"); if(!el) return;
    const t = T();
    const map = { stopwatch:t.hintStopwatch, sd_hold:t.hintSdHold, sd_speed:t.hintSdSpeed, sd_mixed:t.hintSdMixed, timeattack:t.hintTimeAttack, rhythm:t.hintRhythm, interval:t.hintInterval };
    const v = map[$("scenarioSel").value];
    if(typeof v === "string") el.textContent = v;
  }



  // ---------- probability curves (hand-drawn) ----------
  const CURVE_N = 60;
  const curves = { hold: new Array(CURVE_N).fill(0), rest: new Array(CURVE_N).fill(0) };
  const curveMode = { hold: "random", rest: "random" };
  function loadCurves(){
    const stored = KV.get(K.curves, null);
    if(stored && Array.isArray(stored.hold) && stored.hold.length===CURVE_N) curves.hold = stored.hold.slice();
    if(stored && Array.isArray(stored.rest) && stored.rest.length===CURVE_N) curves.rest = stored.rest.slice();
    if(stored && stored.modeHold==="timing") curveMode.hold = "timing";
    if(stored && stored.modeRest==="timing") curveMode.rest = "timing";
  }
  function saveCurves(){ KV.set(K.curves, {hold:curves.hold, rest:curves.rest, modeHold:curveMode.hold, modeRest:curveMode.rest}); }

  function applyIvPhaseCurve(presetObj){
    const c = presetObj && presetObj.curves;
    if(c && Array.isArray(c.hold) && c.hold.length===CURVE_N && Array.isArray(c.rest) && c.rest.length===CURVE_N){
      curves.hold = c.hold.slice(); curves.rest = c.rest.slice();
      curveMode.hold = c.modeHold==="timing" ? "timing" : "random";
      curveMode.rest = c.modeRest==="timing" ? "timing" : "random";
    } else {
      curves.hold = new Array(CURVE_N).fill(0); curves.rest = new Array(CURVE_N).fill(0);
      curveMode.hold = "random"; curveMode.rest = "random";
    }
  }

  const CURVE_PRESETS = {
    uniform: i => 0.6,
    high:    i => 0.05 + 0.95 * (i/(CURVE_N-1)),
    low:     i => 0.05 + 0.95 * (1 - i/(CURVE_N-1)),
    middle:  i => { const x = (i/(CURVE_N-1) - 0.5)*2; return 0.05 + 0.95*Math.exp(-x*x*3); },
  };
  function applyPreset(which, name){
    if(name === undefined) return;
    if(name === "clear"){ curves[which] = new Array(CURVE_N).fill(0); }
    else { const f = CURVE_PRESETS[name]; if(!f) return; curves[which] = Array.from({length:CURVE_N}, (_,i)=>f(i)); }
    saveCurves(); drawCurve(which);
  }

  function drawCurve(which, targetCanvas){
    const cv = targetCanvas || $(which==="hold" ? "curveHold" : "curveRest");
    if(!cv) return;
    const rect = cv.getBoundingClientRect();
    if(rect.width < 1 || rect.height < 1) return;
    const dpr = window.devicePixelRatio || 1;
    if(cv.width !== Math.round(rect.width*dpr) || cv.height !== Math.round(rect.height*dpr)){
      cv.width = Math.max(1, Math.round(rect.width*dpr));
      cv.height = Math.max(1, Math.round(rect.height*dpr));
    }
    const w = cv.width, h = cv.height;
    const ctx = cv.getContext("2d");
    ctx.clearRect(0,0,w,h);
    ctx.strokeStyle = "#1e2230"; ctx.lineWidth = 1;
    for(let i=1;i<4;i++){ const y = h*i/4; ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }
    for(let i=1;i<6;i++){ const x = w*i/6; ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }
    const arr = curves[which];
    const isEmpty = arr.every(v => v<=0.001);
    ctx.beginPath();
    ctx.moveTo(0, h);
    for(let i=0;i<CURVE_N;i++){
      const x = (i/(CURVE_N-1))*w;
      const y = h - (isEmpty ? 0.6 : arr[i]) * h * 0.92 - h*0.04;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h); ctx.closePath();
    const grad = ctx.createLinearGradient(0,0,0,h);
    grad.addColorStop(0, isEmpty ? "rgba(149,154,171,.18)" : "rgba(245,181,68,.45)");
    grad.addColorStop(1, isEmpty ? "rgba(149,154,171,.05)" : "rgba(245,181,68,.06)");
    ctx.fillStyle = grad; ctx.fill();
    ctx.beginPath();
    for(let i=0;i<CURVE_N;i++){
      const x = (i/(CURVE_N-1))*w;
      const y = h - (isEmpty ? 0.6 : arr[i]) * h * 0.92 - h*0.04;
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.strokeStyle = isEmpty ? "#5a6072" : "#F5B544"; ctx.lineWidth = 2*dpr; ctx.stroke();
    if(isEmpty){
      ctx.fillStyle = "#5a6072"; ctx.font = `${12*dpr}px "Space Grotesk", sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const msg = targetCanvas ? (T().sumDrawFinger || "Draw with your finger or mouse") : (T().sumTapDraw || "Tap to draw the probability curve");
      ctx.fillText(msg, w/2, h/2);
    }
  }

  function attachCurveDrawing(which, cv){
    if(!cv) cv = $(which==="hold" ? "curveHold" : "curveRest");
    if(!cv) return;
    let drawing = false, lastIdx = -1, lastVal = 0;
    const posToIdxVal = (ev)=>{
      const r = cv.getBoundingClientRect();
      const x = Math.max(0, Math.min(r.width, ev.clientX - r.left));
      const y = Math.max(0, Math.min(r.height, ev.clientY - r.top));
      const idx = Math.max(0, Math.min(CURVE_N-1, Math.round(x/r.width*(CURVE_N-1))));
      const val = Math.max(0, Math.min(1, 1 - (y/r.height - 0.04)/0.92));
      return {idx, val};
    };
    const write = (idx, val)=>{
      if(lastIdx < 0){ curves[which][idx] = val; }
      else {
        const a = Math.min(lastIdx, idx), b = Math.max(lastIdx, idx);
        for(let i=a;i<=b;i++){
          const t = (b===a) ? 1 : (i-a)/(b-a);
          const v = (lastIdx<=idx) ? (lastVal + (val-lastVal)*t) : (val + (lastVal-val)*t);
          curves[which][i] = v;
        }
      }
      lastIdx = idx; lastVal = val;
    };
    const redraw = ()=>{ drawCurve(which, cv); };
    cv.addEventListener("pointerdown", e=>{
      e.preventDefault(); drawing = true; lastIdx = -1;
      try{ cv.setPointerCapture(e.pointerId); }catch(_){}
      const {idx,val} = posToIdxVal(e); write(idx,val); redraw();
    });
    cv.addEventListener("pointermove", e=>{
      if(!drawing) return;
      const {idx,val} = posToIdxVal(e); write(idx,val); redraw();
    });
    const stop = ()=>{ if(!drawing) return; drawing = false; lastIdx = -1; saveCurves(); updateSummaries && updateSummaries(); drawCurve(which); };
    cv.addEventListener("pointerup", stop);
    cv.addEventListener("pointercancel", stop);
    cv.addEventListener("lostpointercapture", stop);
    cv.addEventListener("contextmenu", e=>e.preventDefault());
  }

  let overlayWhich = null;
  function openCurveEditor(which){
    overlayWhich = which;
    const ov = $("curveOverlay"); if(!ov) return;
    refreshCurveOverlayForMode();
    ov.classList.remove("hidden");
    ov.setAttribute("aria-hidden", "false");
    const big = $("curveBig");
    if(!big.dataset.wired){
      attachCurveDrawing("__dyn__", big);
      big.dataset.wired = "1";
    }
    requestAnimationFrame(()=>drawCurve(which, big));
  }
  function refreshCurveOverlayForMode(){
    const which = overlayWhich; if(!which) return;
    const isHold = which==="hold";
    const mode = curveMode[which];
    $("curveOverlayTitle").textContent = isHold
      ? (mode==="timing" ? "Long-hold duration over the session" : "Long-hold probability curve")
      : (mode==="timing" ? "Rest duration over the session" : "Rest probability curve");
    $("curveOverlaySub").textContent = mode==="timing"
      ? (isHold ? "X = session progress. Y = long-hold duration at that time."
                : "X = session progress. Y = rest length at that time.")
      : (isHold ? "Higher on the curve = long hold more likely to be that duration."
                : "Higher on the curve = rest more likely to be that length.");
    if(mode==="timing"){
      $("curveBigLo").textContent = "0% · " + (isHold ? num("minHold") : num("minRest")) + "s";
      $("curveBigHi").textContent = "100% · " + (isHold ? num("maxHold") : num("maxRest")) + "s";
    } else {
      $("curveBigLo").textContent = (isHold ? num("minHold") : num("minRest")) + "s";
      $("curveBigHi").textContent = (isHold ? num("maxHold") : num("maxRest")) + "s";
    }
    const mr = $("modeRandom"), mt = $("modeTiming");
    if(mr && mt){
      mr.setAttribute("aria-pressed", mode==="random" ? "true" : "false");
      mt.setAttribute("aria-pressed", mode==="timing" ? "true" : "false");
    }
    drawCurve(which, $("curveBig"));
  }
  function closeCurveEditor(){
    const ov = $("curveOverlay"); if(!ov) return;
    ov.classList.add("hidden");
    ov.setAttribute("aria-hidden", "true");
    if(overlayWhich) drawCurve(overlayWhich);
    updateSummaries();
    overlayWhich = null;
  }

  function wireOverlayCanvas(){
    const cv = $("curveBig"); if(!cv) return;
    let drawing = false, lastIdx = -1, lastVal = 0;
    const posToIdxVal = (ev)=>{
      const r = cv.getBoundingClientRect();
      const x = Math.max(0, Math.min(r.width, ev.clientX - r.left));
      const y = Math.max(0, Math.min(r.height, ev.clientY - r.top));
      const idx = Math.max(0, Math.min(CURVE_N-1, Math.round(x/r.width*(CURVE_N-1))));
      const val = Math.max(0, Math.min(1, 1 - (y/r.height - 0.04)/0.92));
      return {idx, val};
    };
    const write = (which, idx, val)=>{
      if(lastIdx < 0){ curves[which][idx] = val; }
      else {
        const a = Math.min(lastIdx, idx), b = Math.max(lastIdx, idx);
        for(let i=a;i<=b;i++){
          const t = (b===a) ? 1 : (i-a)/(b-a);
          const v = (lastIdx<=idx) ? (lastVal + (val-lastVal)*t) : (val + (lastVal-val)*t);
          curves[which][i] = v;
        }
      }
      lastIdx = idx; lastVal = val;
    };
    cv.addEventListener("pointerdown", e=>{
      if(!overlayWhich) return;
      e.preventDefault(); drawing = true; lastIdx = -1;
      try{ cv.setPointerCapture(e.pointerId); }catch(_){}
      const {idx,val} = posToIdxVal(e); write(overlayWhich, idx, val); drawCurve(overlayWhich, cv);
    });
    cv.addEventListener("pointermove", e=>{
      if(!drawing || !overlayWhich) return;
      const {idx,val} = posToIdxVal(e); write(overlayWhich, idx, val); drawCurve(overlayWhich, cv);
    });
    const stop = ()=>{ if(!drawing) return; drawing = false; lastIdx = -1; saveCurves(); };
    cv.addEventListener("pointerup", stop);
    cv.addEventListener("pointercancel", stop);
    cv.addEventListener("lostpointercapture", stop);
    cv.addEventListener("contextmenu", e=>e.preventDefault());
  }

  function sampleFromCurve(which, min, max){
    if(!(max>min)) return min;
    const arr = curves[which];
    const isEmpty = arr.every(v=>v<=0.001);
    if(curveMode[which]==="timing" && !isEmpty){
      const p = sessionProgress();               
      const x = p * (CURVE_N - 1);
      const i = Math.max(0, Math.min(CURVE_N-2, Math.floor(x)));
      const f = x - i;
      const y = Math.max(0, Math.min(1, arr[i]*(1-f) + arr[i+1]*f));
      return Math.round(min + y * (max - min));
    }
    let total = 0;
    for(let i=0;i<CURVE_N;i++) total += Math.max(0, arr[i]);
    if(total <= 0.0001) return rand(min, max);
    let r = Math.random() * total, i = 0;
    for(; i<CURVE_N; i++){ r -= Math.max(0, arr[i]); if(r <= 0) break; }
    if(i >= CURVE_N) i = CURVE_N - 1;
    const t = (i + Math.random()) / CURVE_N;
    return Math.round(min + t * (max - min));
  }

  function sessionProgress(){
    if(!S) return 0;
    if(S.scenario === "interval" && S.iv_phaseMode === "time" && S.iv_phaseStartAt && S.endAt){
      return Math.max(0, Math.min(1, (Date.now()-S.iv_phaseStartAt)/(S.endAt-S.iv_phaseStartAt)));
    }
    if(S.goal==="time" && S.startTime && S.endAt){
      return Math.max(0, Math.min(1, (Date.now()-S.startTime)/(S.endAt-S.startTime)));
    }
    if(S.totalReps && S.totalReps>0){
      return Math.max(0, Math.min(1, (S.done || 0)/S.totalReps));
    }
    return 0;
  }

  function updateCurveAxes(){
    const set = (id, v)=>{ const e=$(id); if(e) e.textContent = v; };
    set("curveHoldLo", num("minHold") + "s");
    set("curveHoldHi", num("maxHold") + "s");
    set("curveRestLo", num("minRest") + "s");
    set("curveRestHi", num("maxRest") + "s");
  }


  const SETTING_IDS = [
    "minReps","maxReps","totalMin","scenarioSel","sdActionSec","sdPauseSec","sdStartReps","sdStartHold","taTarget","rrBpm","rrStep","livesOn","livesCount",
    "ivPhaseCount",
    "ivPhasePreset1","ivPhasePreset2","ivPhasePreset3","ivPhasePreset4","ivPhasePreset5","ivPhasePreset6",
    "baseHold","holdChance","minHold","maxHold","minRest","maxRest","releaseGrace",
    "strict","penalty","penaltyX","lateTol","hideDur",
    "voice","beep","vibrate","eyesClosed","guardExit","screenColor","cameraControl",
    "cmdDown","cmdUp","cmdHold","cmdPenaltyWord","cmdFinishWord","cmdRate",
    "appLang",
    "progressTone","prAnnounce",
  ];
  function readAll(){
    const o = { goal };
    for(const id of SETTING_IDS){
      const el = $(id); if(!el) continue;
      o[id] = (el.type==="checkbox") ? el.checked : el.value;
    }
    return o;
  }
  function writeAll(o){
    if(!o) return;
    if(o.rest !== undefined && o.minRest === undefined){
      o.minRest = o.rest; o.maxRest = o.rest;
    }
    if(o.goal){
      const btn = document.querySelector(`#goalSeg button[data-goal="${o.goal}"]`);
      if(btn) btn.click();
    }
    for(const id of SETTING_IDS){
      if(!(id in o)) continue;
      const el = $(id); if(!el) continue;
      if(el.type==="checkbox") el.checked = !!o[id]; else el.value = o[id];
    }
    if($("goalSeg")) [...$("goalSeg").children].forEach(b=>{
      if(b.getAttribute("aria-pressed")==="true"){ /* sync handled */ }
    });
    applyScenarioVisibility();
  }
  function saveSettingsNow(){ KV.set(K.settings, readAll()); }
  function debouncedSaveSettings(){
    clearTimeout(saveSettingsTimer);
    saveSettingsTimer = setTimeout(()=>{ saveSettingsNow(); updateSummaries(); }, 400);
    try{ updateSummaries(); }catch(e){}
  }
  let saveSettingsTimer = 0;

  function updateSummaries(){
    const s = readAll();
    const t = T();
    const setTxt = (id, txt) => { const e = $(id); if(e) e.textContent = txt; };
    const scName = { stopwatch: (t.scenarioStopwatch||"").split(" — ")[0], sd_hold: t.scenarioSdHold, sd_speed: t.scenarioSdSpeed, sd_mixed: t.scenarioSdMixed, interval: t.scenarioInterval };
    const goalTxt = {
      reps: `${t.goalReps} ${s.minReps}–${s.maxReps}`,
      time: `${t.goalTime} ${s.totalMin} ${t.sumMin}`,
      scenario: `${t.goalScenario} · ${scName[s.scenarioSel] || ""}`,
      }[goal] || "";
    setTxt("sumGoal", goalTxt);
    const hasHoldCurve = curves.hold.some(v=>v>0.001);
    const hasRestCurve = curves.rest.some(v=>v>0.001);
    const holdMark = hasHoldCurve ? (curveMode.hold==="timing" ? " →" : " ~") : "";
    const restMark = hasRestCurve ? (curveMode.rest==="timing" ? " →" : " ~") : "";
    const restTxt = s.minRest===s.maxRest ? (s.minRest+"s") : (s.minRest+"–"+s.maxRest+"s"+restMark);
    const holdTxt = (s.minHold+"–"+s.maxHold+"s"+holdMark);
    setTxt("sumTiming", (goal==="scenario") ? t.sumFreeform : `${t.sumHoldWord} ${s.baseHold}s · ${t.sumRestWord} ${restTxt} · ${s.holdChance}% ${t.sumLongWord} (${holdTxt})`);
    const ch = [];
    if(goal!=="scenario"){
      if(s.strict) ch.push(t.sumStrict);
      if(s.penalty) ch.push(t.sumPenalty(s.penaltyX));
      if(s.hideDur) ch.push(t.sumHidden);
    }
    setTxt("sumChallenge", ch.length ? ch.join(" · ") : t.sumRelaxed);
    const sig = [];
    if(s.voice) sig.push(t.sumVoice);
    if(s.beep) sig.push(t.sumBeep);
    if(s.vibrate) sig.push(t.sumVibrate);
    setTxt("sumSignals", sig.length ? sig.join(" · ") : t.sumNoCues);
    const co = [];
    if(s.progressTone) co.push(t.sumTone);
    if(s.prAnnounce) co.push(t.sumPB);
    setTxt("sumCoaching", co.length ? co.join(" · ") : t.sumOff);
    const dsp = [];
    if(s.eyesClosed) dsp.push(t.sumEyesClosed);
    if(s.guardExit) dsp.push(t.sumSwipeGuard);
    if(s.screenColor) dsp.push(t.sumScreenColor);
    setTxt("sumDisplay", dsp.length ? dsp.join(" · ") : t.sumDefault);
    setTxt("sumCamera", s.cameraControl ? t.sumCamOn : t.sumOff);
    const p = KV.get(K.presets, {});
    const h = KV.get(K.history, []);
    setTxt("sumPresets", t.sumPresetsLine(Object.keys(p).length, h.length));
  }

  function getPR(){ return KV.get(K.pr, 0) || 0; }
  function setPR(v){ KV.set(K.pr, v); }

  // ---------- gamification: XP, ranks, streak, per-scenario records ----------
  const RANK_XP = [0, 100, 300, 700, 1500, 3000, 6000];
  function loadGame(){
    const g = KV.get(K.game, null) || {};
    return {
      xp: g.xp || 0,
      streakCount: g.streakCount || 0,
      streakLast: (g.streakLast == null ? null : g.streakLast),
      rec: Object.assign({ stopwatch:0, sd_hold:0, sd_speed:0, sd_mixed:0, reps:0, time:0, pace:0, speedPace:0, timeattack:0, rhythm:0 }, g.rec || {})
    };
  }
  function saveGame(g){ KV.set(K.game, g); }
  function localDay(ts){
    const d = new Date(ts);
    return Math.floor((d.getTime() - d.getTimezoneOffset()*60000) / 86400000);
  }
  function rankInfo(xp){
    let idx = 0;
    for(let i=0;i<RANK_XP.length;i++){ if(xp >= RANK_XP[i]) idx = i; }
    const names = T().rankNames || [];
    const curMin = RANK_XP[idx];
    const nextMin = (idx+1 < RANK_XP.length) ? RANK_XP[idx+1] : null;
    return {
      idx, name: names[idx] || ("Rank " + (idx+1)),
      into: xp - curMin,
      span: (nextMin != null) ? (nextMin - curMin) : null
    };
  }
  // Apply one finished session to the persistent game state; returns a summary
  // for the finish screen. Rewards total hold time, reps, streak & records —
  // deliberately NOT raw max hold time alone (safety-conscious design).
  function commitGameSession(snap){
    const g = loadGame();
    const beforeIdx = rankInfo(g.xp).idx;

    let xp = Math.round((snap.holdSec || 0) / 3) + (snap.reps || 0);

    // daily streak (1 grace day: a single missed day does not break it)
    const today = localDay(Date.now());
    let streakEvent = "same";
    if(g.streakLast == null){ g.streakCount = 1; streakEvent = "start"; }
    else {
      const diff = today - g.streakLast;
      if(diff <= 0){ streakEvent = "same"; }
      else if(diff === 1 || diff === 2){ g.streakCount++; streakEvent = "inc"; }
      else { g.streakCount = 1; streakEvent = "reset"; }
    }
    g.streakLast = today;
    const streakBonus = Math.min(g.streakCount, 10) * 2;
    xp += streakBonus;

    // ---- personal-best records (may be several in one session) ----
    const records = [];
    function tryRecord(key, val){
      if(val > (g.rec[key] || 0)){ g.rec[key] = val; records.push({ key, val }); }
    }
    const reps = snap.reps || 0;
    const elapsed = snap.elapsedSec || 0;

    if(snap.goal === "scenario"){
      if(snap.scenario === "stopwatch") tryRecord("stopwatch", Math.round((snap.swLongest || 0) * 10) / 10);
      else if(snap.scenario === "sd_hold") tryRecord("sd_hold", snap.sdRounds || 0);
      else if(snap.scenario === "sd_speed") tryRecord("sd_speed", snap.sdSpeedBest || 0);
      else if(snap.scenario === "sd_mixed") tryRecord("sd_mixed", snap.mixedRounds || 0);
      else if(snap.scenario === "timeattack") tryRecord("timeattack", snap.taScore || 0);
      else if(snap.scenario === "rhythm") tryRecord("rhythm", snap.rrBpm || 0);
    } else if(snap.goal === "reps"){
      tryRecord("reps", reps);
    } else if(snap.goal === "time"){
      tryRecord("time", reps);
    }

    // ---- pace (reps per minute) ----
    // Speed mode gets its own "action pace" over action-phase time only
    // (pauses excluded), tracked as a distinct record from the generic pace.
    let pace = 0, paceShown = false, paceKind = null;
    const isSpeed = snap.goal === "scenario" && snap.scenario === "sd_speed";
    if(reps > 0){
      if(isSpeed && (snap.actionSec || 0) > 0){
        pace = Math.round((reps * 60 / snap.actionSec) * 10) / 10;
        paceShown = true; paceKind = "speed";
        if(reps >= 5 && snap.actionSec >= 20) tryRecord("speedPace", pace);
      } else if(!isSpeed && elapsed > 0){
        pace = Math.round((reps * 60 / elapsed) * 10) / 10;
        paceShown = true; paceKind = "total";
        // only chase a pace record on sessions substantial enough to be meaningful
        if(reps >= 5 && elapsed >= 30) tryRecord("pace", pace);
      }
    }

    if(records.length) xp += 25;

    xp = Math.max(xp, 1);
    g.xp += xp;
    saveGame(g);

    const rank = rankInfo(g.xp);
    return {
      xpGained: xp, streakBonus, streakCount: g.streakCount, streakEvent,
      records, pace, paceShown, paceKind,
      rank, leveledUp: rank.idx > beforeIdx, totalXp: g.xp
    };
  }

  function recordText(t, rec){
    const map = {
      stopwatch: t.recStopwatch, sd_hold: t.recSdHold, sd_speed: t.recSdSpeed, sd_mixed: t.recSdMixed,
      reps: t.recReps, time: t.recTime, pace: t.recPace, speedPace: t.recSpeedPace,
      timeattack: t.recTimeAttack, rhythm: t.recRhythm
    };
    const label = map[rec.key] || "";
    let val;
    if(rec.key === "stopwatch") val = fmtSW(rec.val);
    else if(rec.key === "pace" || rec.key === "speedPace") val = rec.val + "/min";
    else if(rec.key === "rhythm") val = rec.val + " BPM";
    else val = rec.val;
    return (t.newBest || "New best!") + " · " + label + " " + val;
  }

  function renderFinishGame(r){
    const box = $("finishGame"); if(!box) return;
    if(!r){ box.classList.add("hidden"); return; }
    box.classList.remove("hidden");
    const t = T();

    $("fgRankName").textContent = r.rank.name;
    $("fgXpGain").textContent = t.xpGained ? t.xpGained(r.xpGained) : ("+" + r.xpGained + " XP");
    const pct = (r.rank.span == null) ? 100 : Math.max(4, Math.min(100, Math.round(100 * r.rank.into / r.rank.span)));
    const fill = $("fgBarFill");
    fill.style.width = "0%";
    requestAnimationFrame(()=>requestAnimationFrame(()=>{ fill.style.width = pct + "%"; }));
    $("fgXpText").textContent = (r.rank.span == null)
      ? (r.totalXp + " XP · MAX")
      : (r.rank.into + " / " + r.rank.span + " XP");

    const badges = $("fgBadges");
    if(r.records && r.records.length){
      badges.classList.remove("hidden");
      badges.innerHTML = r.records.map(rec=>
        `<div class="fgBadge">🏆 ${recordText(t, rec)}</div>`).join("");
    } else { badges.classList.add("hidden"); badges.innerHTML = ""; }

    const lu = $("fgLevelUp");
    if(r.leveledUp){ lu.classList.remove("hidden"); $("fgLevelUpTxt").textContent = t.levelUp ? t.levelUp(r.rank.name) : ("Rank up: " + r.rank.name); }
    else lu.classList.add("hidden");

    const pc = $("fgPace");
    if(r.paceShown){
      pc.classList.remove("hidden");
      const paceFn = (r.paceKind === "speed") ? (t.paceActionLine || t.paceLine) : t.paceLine;
      pc.innerHTML = paceFn ? paceFn(r.pace) : ("Pace: " + r.pace + " reps/min");
    } else pc.classList.add("hidden");

    const st = $("fgStreak");
    if(r.streakCount > 1){ st.classList.remove("hidden"); st.innerHTML = t.streakLine ? t.streakLine(r.streakCount) : ("🔥 " + r.streakCount); }
    else st.classList.add("hidden");

    if((r.records && r.records.length) || r.leveledUp){ confettiBurst(); vibrate([0,40,60,40]); }
  }

  function confettiBurst(){
    try{
      let cv = $("confettiCanvas");
      if(!cv){ cv = document.createElement("canvas"); cv.id = "confettiCanvas"; document.body.appendChild(cv); }
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = cv.width = Math.floor(innerWidth * dpr);
      const H = cv.height = Math.floor(innerHeight * dpr);
      cv.style.display = "block";
      const ctx = cv.getContext("2d");
      const colors = ["#F5B544","#74d39a","#e8736b","#ECEAE3","#e89a25"];
      const P = [];
      for(let i=0;i<130;i++){
        P.push({
          x: W/2 + (Math.random()-0.5)*W*0.3, y: H*0.34,
          vx: (Math.random()-0.5)*14*dpr, vy: (Math.random()*-13-6)*dpr,
          g: 0.35*dpr, r: (3+Math.random()*4)*dpr,
          rot: Math.random()*6.28, vr: (Math.random()-0.5)*0.3,
          c: colors[i % colors.length], life: 1
        });
      }
      let last = performance.now();
      function frame(now){
        const dt = Math.min(32, now - last) / 16.7; last = now;
        ctx.clearRect(0,0,W,H);
        let alive = false;
        for(const p of P){
          p.vy += p.g*dt; p.x += p.vx*dt; p.y += p.vy*dt; p.rot += p.vr*dt; p.life -= 0.006*dt;
          if(p.y < H+20 && p.life > 0){
            alive = true;
            ctx.save(); ctx.globalAlpha = Math.max(0,p.life);
            ctx.translate(p.x,p.y); ctx.rotate(p.rot);
            ctx.fillStyle = p.c; ctx.fillRect(-p.r, -p.r*0.6, p.r*2, p.r*1.2);
            ctx.restore();
          }
        }
        if(alive) requestAnimationFrame(frame);
        else { ctx.clearRect(0,0,W,H); cv.style.display = "none"; }
      }
      requestAnimationFrame(frame);
    }catch(e){}
  }

  function addHistory(entry){
    const h = KV.get(K.history, []);
    h.push(entry);
    if(h.length>200) h.splice(0, h.length-200);
    KV.set(K.history, h);
  }
  function renderStats(){
    const h = KV.get(K.history, []);
    const box = $("statsBox"); if(!box) return;
    if(!h.length){ box.textContent = "No sessions yet."; return; }
    const total = h.length;
    const last = h[h.length-1];
    const week = Date.now() - 7*24*3600*1000;
    const recent = h.filter(x=>x.at>=week);
    const sumHold = h.reduce((a,x)=>a + (x.holdSec||0), 0);
    const bestRep = Math.max(0, ...h.map(x=>x.longestHold||0));
    const fmt = s=>{ s=Math.round(s); const m=Math.floor(s/60); return m? (m+":"+String(s%60).padStart(2,"0")) : (s+" s"); };
    const t = T();
    const g = loadGame();
    const ri = rankInfo(g.xp);
    let gameLine = `${t.statsRank || "Rank"}: <b>${ri.name}</b> · <b>${g.xp}</b> XP`;
    if(g.streakCount > 1) gameLine += ` · 🔥 <b>${g.streakCount}</b>`;
    if(g.rec && g.rec.pace > 0) gameLine += ` · <b>${g.rec.pace}</b>/min`;
    if(g.rec && g.rec.speedPace > 0) gameLine += ` · ⚡<b>${g.rec.speedPace}</b>/min`;
    box.innerHTML =
      gameLine + `<br>` +
      `Total sessions: <b>${total}</b> · last 7 days: <b>${recent.length}</b><br>` +
      `Longest hold (record): <b>${bestRep} s</b><br>` +
      `Total time held: <b>${fmt(sumHold)}</b><br>` +
      `Last session: <b>${new Date(last.at).toLocaleString()}</b> · ${last.reps} reps · ${fmt(last.elapsed)}`;
  }

  function populatePresetOptions(sel){
    if(!sel) return;
    const prev = sel.value;
    const p = KV.get(K.presets, {});
    const names = Object.keys(p).sort();
    const t = T();
    const tag = n => p[n] && p[n].goal === "time" ? ` (${t.goalTime})` : p[n] && p[n].goal === "reps" ? ` (${t.goalReps})` : "";
    sel.innerHTML = `<option value="">${t.optLoad}</option>` +
      names.map(n=>`<option value="${n.replace(/"/g,"&quot;")}">${(n+tag(n)).replace(/</g,"&lt;")}</option>`).join("");
    if(names.includes(prev)) sel.value = prev;
  }
  function refreshPresetSelect(){
    populatePresetOptions($("presetSel"));
    for(let i=1;i<=6;i++) populatePresetOptions($("ivPhasePreset"+i));
  }
  function presetSave(){
    const name = ($("presetName").value || "").trim();
    if(!name){ alert(T().errNoPresetName); return; }
    const p = KV.get(K.presets, {});
    const snap = readAll();
    snap.curves = { hold: curves.hold.slice(), rest: curves.rest.slice(), modeHold: curveMode.hold, modeRest: curveMode.rest };
    p[name] = snap;
    KV.set(K.presets, p);
    refreshPresetSelect();
    $("presetSel").value = name;
  }
  function presetLoad(){
    const name = $("presetSel").value;
    if(!name) return;
    const p = KV.get(K.presets, {});
    if(!p[name]) return;
    writeAll(p[name]);
    applyIvPhaseCurve(p[name]);
    saveCurves();
    drawCurve("hold"); drawCurve("rest");
    $("presetName").value = name;
    saveSettingsNow();
  }
  function presetDel(){
    const name = $("presetSel").value;
    if(!name) return;
    const p = KV.get(K.presets, {});
    delete p[name];
    KV.set(K.presets, p);
    refreshPresetSelect();
  }

  let progOsc = null, progGain = null;
  function progressStart(){
    if(!S || !S.progressTone) return;
    const ctx = ensureAudio(); if(!ctx) return;
    try{
      progOsc = ctx.createOscillator(); progGain = ctx.createGain();
      progOsc.type = "sine"; progOsc.frequency.value = 220;
      progGain.gain.value = 0;
      progGain.gain.linearRampToValueAtTime(0.035, ctx.currentTime + 0.15);
      progOsc.connect(progGain); progGain.connect(ctx.destination);
      progOsc.start();
    }catch(e){ progOsc = progGain = null; }
  }
  function progressUpdate(p){
    if(!progOsc || !progGain) return;
    try{
      progOsc.frequency.setTargetAtTime(220 + 440*Math.min(1,Math.max(0,p)), audioCtx.currentTime, 0.1);
    }catch(e){}
  }
  function progressStop(){
    if(!progOsc){ return; }
    try{
      const ctx = audioCtx;
      progGain.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
      const osc = progOsc, g = progGain;
      setTimeout(()=>{ try{ osc.stop(); osc.disconnect(); g.disconnect(); }catch(e){} }, 250);
    }catch(e){}
    progOsc = null; progGain = null;
  }

  const synth = window.speechSynthesis || null;
  function say(text){
    if(!S || !S.sig || !S.sig.speech || !synth) return;
    try{
      synth.cancel();                 
      const u = new SpeechSynthesisUtterance(text);
      u.lang = speechTag();
      u.rate = (S && S.rate) || 1;
      synth.speak(u);
    }catch(e){}
  }

  let audioCtx = null;
  function ensureAudio(){
    if(audioCtx) return audioCtx;
    try{ audioCtx = new (window.AudioContext||window.webkitAudioContext)(); }catch(e){ audioCtx = null; }
    return audioCtx;
  }
  function beep(freq, durMs, delayMs){
    const ctx = ensureAudio(); if(!ctx) return;
    try{
      const t0 = ctx.currentTime + (delayMs||0)/1000;
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = "sine"; osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.28, t0+0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0+durMs/1000);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(t0); osc.stop(t0+durMs/1000+0.03);
    }catch(e){}
  }
  function vibrate(pattern){ try{ if(navigator.vibrate) navigator.vibrate(pattern); }catch(e){} }

  // True while tapping reps inside a Speed/Mixed action phase — there we want
  // a short press/release blip, not a spoken cue on every single rep.
  function isActionTap(){
    return !!S && (S.scenario==="sd_speed" || S.scenario==="sd_mixed") && S.sd_phase==="action";
  }
  // Short non-spoken press/release indicator for action-phase reps.
  function tick(kind){
    if(!S || !S.sig) return;
    if(S.sig.beep) beep(kind==="down" ? 900 : 520, 40, 0);
    if(S.sig.vibrate) vibrate(kind==="down" ? 18 : 12);
  }

  // Distinct cue for the Mixed action->hold transition ("now HOLD").
  function mixedHoldCue(){
    if(!S || !S.sig) return;
    if(S.sig.speech) say(T().holdNow || "Hold");
    if(S.sig.beep){ beep(680,140,0); beep(920,200,150); }
    if(S.sig.vibrate) vibrate([0,90,60,90]);
  }
  // Fired once when a Mixed hold passes the previous round's hold time.
  function mixedHoldTargetCue(){
    if(!S || !S.sig) return;
    if(S.sig.beep){ beep(880,120,0); beep(1175,170,110); }
    if(S.sig.vibrate) vibrate([0,60,40,60]);
  }

  function cmd(kind){
    if(!S) return;
    if(S.sig.speech) say(S.words[kind]);
    if(S.sig.beep){
      if(kind==="down"){ beep(520,90,0); beep(700,120,110); }
      else if(kind==="up"){ beep(400,170,0); }
      else if(kind==="hold"){ beep(760,280,0); }
    }
    if(S.sig.vibrate){
      if(kind==="down") vibrate([60,40,60]);
      else if(kind==="up") vibrate(200);
      else if(kind==="hold") vibrate([220,90,220]);
    }
  }
  function cmdCount(n){
    if(!S) return;
    if(S.sig.speech) say(String(n));
    if(S.sig.beep) beep(900,55,0);
    if(S.sig.vibrate) vibrate(40);
  }
  function cmdFinish(){
    if(!S) return;
    if(S.sig.speech) say(S.words.finish);
    if(S.sig.beep){ beep(660,120,0); beep(880,120,150); beep(1175,220,320); }
    if(S.sig.vibrate) vibrate([120,60,120,60,220]);
  }
  function cmdPenalty(){
    if(!S) return;
    if(S.sig.speech) say(S.words.penalty);
    if(S.sig.beep){ beep(320,150,0); beep(220,200,170); }
    if(S.sig.vibrate) vibrate([300,120,300]);
  }
  function cmdPenaltyThenDown(){
    if(!S) return;
    if(S.sig.speech) say(S.words.penalty + ". " + S.words.down);
    if(S.sig.beep){ beep(320,150,0); beep(220,200,170); beep(520,90,470); beep(700,120,580); }
    if(S.sig.vibrate) vibrate([300,120,300, 220, 60,40,60]);
  }

  let goal = "reps";
  function applyGoalVisibility(){
    const isScenario = goal==="scenario";
    $("repsField").classList.toggle("hidden", goal!=="reps");
    $("timeField").classList.toggle("hidden", goal!=="time");
    $("scenarioField").classList.toggle("hidden", !isScenario);
    $("secTiming").classList.toggle("hidden", isScenario);   // whole Timing panel is irrelevant for scenarios
    ["fBase","fChance","fHolds","fRest"].forEach(id=>$(id).classList.toggle("hidden", isScenario));
    ["fStrict","fPenaltyToggle","penaltyValField","fHideDur"].forEach(id=>$(id).classList.toggle("hidden", isScenario));
    applyScenarioVisibility();
    $("penaltyLbl").textContent = (goal==="time") ? (T().penaltySeconds || "Penalty amount (+seconds)")
                                                  : (T().penaltyReps || "Penalty amount (+reps)");
  }
  // scenarios that have a "fail" concept the lives system can apply to
  function scenarioSupportsLives(scn){
    return scn==="sd_hold" || scn==="sd_speed" || scn==="sd_mixed" || scn==="rhythm";
  }
  function applyScenarioVisibility(){
    const sc = $("scenarioSel").value;
    const isScen = goal==="scenario";
    $("sdSpeedField").classList.toggle("hidden", !(isScen && (sc==="sd_speed" || sc==="sd_mixed")));
    $("sdMixedField").classList.toggle("hidden", !(isScen && sc==="sd_mixed"));
    $("taField").classList.toggle("hidden", !(isScen && sc==="timeattack"));
    $("rrField").classList.toggle("hidden", !(isScen && sc==="rhythm"));
    $("ivField").classList.toggle("hidden", !(isScen && sc==="interval"));
    ivApplyPhaseVisibility();
    $("livesField").classList.toggle("hidden", !(isScen && scenarioSupportsLives(sc)));
    $("livesCountField").classList.toggle("hidden", !$("livesOn").checked);
  }
  function ivApplyPhaseVisibility(){
    const n = Math.min(6, Math.max(2, Math.round(parseFloat($("ivPhaseCount").value) || 3)));
    for(let i=1;i<=6;i++){
      const row = $("ivPhaseRow"+i); if(row) row.classList.toggle("hidden", i>n);
    }
  }
  function ivLabelPhases(){
    const t = T();
    for(let i=1;i<=6;i++){
      const head = $("ivPhaseHead"+i); if(head) head.textContent = t.ivPhaseHeading(i);
      const sel = $("ivPhasePreset"+i); if(sel) sel.setAttribute("aria-label", t.ariaIvPhasePreset(i));
    }
  }
  $("scenarioSel").addEventListener("change", ()=>{ applyScenarioVisibility(); updateScenarioHint(); });
  $("livesOn").addEventListener("change", applyScenarioVisibility);
  $("ivPhaseCount").addEventListener("input", ivApplyPhaseVisibility);

  // advanced settings: collapsed by default, state remembered
  (function initAdvanced(){
    const btn = $("advToggle"), wrap = $("advancedWrap");
    if(!btn || !wrap) return;
    const setOpen = (open)=>{
      wrap.classList.toggle("hidden", !open);
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      btn.classList.toggle("open", open);
      KV.set("lat.advOpen", !!open);
    };
    setOpen(!!KV.get("lat.advOpen", false));
    btn.addEventListener("click", ()=> setOpen(wrap.classList.contains("hidden")));
  })();
  $("goalSeg").addEventListener("click", e=>{
    const b = e.target.closest("button[data-goal]");
    if(!b) return;
    goal = b.dataset.goal;
    [...$("goalSeg").children].forEach(c=>c.setAttribute("aria-pressed", c===b));
    applyGoalVisibility();
  });

  const num = id => parseInt($(id).value, 10);
  const fnum = id => parseFloat($(id).value);
  const rand = (a,b) => Math.floor(Math.random()*(b-a+1))+a;

  let S = null;
  let holding = false;
  let activePointerId = null;  // pointerId that started the current hold;
                                // null while idle and for camera-/keyboard-driven holds
  let lastCueKind = "up";
  let curScreenColorState = null;
  let raf = 0;
  let restTimer = 0;     
  let reactTimer = 0;    
  let pendingRelease = false; 
  let releaseTimer = 0;  

  let wakeLock = null;
  async function acquireWake(){
    try{
      if("wakeLock" in navigator){
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener && wakeLock.addEventListener("release", ()=>{ wakeLock = null; });
      }
    }catch(e){ wakeLock = null; }
  }
  function releaseWake(){ try{ if(wakeLock){ wakeLock.release(); } }catch(e){} wakeLock = null; }
  document.addEventListener("visibilitychange", ()=>{
    if(document.visibilityState==="visible" && S && !wakeLock) acquireWake();
  });

  function setTapSurface(on){
    const el = $("tapSurface");
    if(!el) return;
    el.classList.toggle("hidden", !on);
  }

  let guardActive = false;
  function beforeUnloadHandler(e){ if(S){ e.preventDefault(); e.returnValue = ""; return ""; } }
  function popStateHandler(){ if(S && guardActive){ try{ history.pushState({tt:1}, ""); }catch(e){} } }
  function enableGuard(){
    if(guardActive) return;
    guardActive = true;
    try{ history.pushState({tt:1}, ""); }catch(e){}
    window.addEventListener("popstate", popStateHandler);
    window.addEventListener("beforeunload", beforeUnloadHandler);
    try{ if(document.documentElement.requestFullscreen && !document.fullscreenElement) document.documentElement.requestFullscreen(); }catch(e){}
  }
  function disableGuard(){
    if(!guardActive) return;
    guardActive = false;
    window.removeEventListener("popstate", popStateHandler);
    window.removeEventListener("beforeunload", beforeUnloadHandler);
    try{ if(document.fullscreenElement && document.exitFullscreen) document.exitFullscreen(); }catch(e){}
  }

  function validate(){
    const t = T();
    if(goal==="reps"){
      const a=num("minReps"), b=num("maxReps");
      if(!(a>=1) || !(b>=1)) return t.errRepsInvalid;
      if(a>b) return t.errRepsMinMax;
    } else if(goal==="time"){
      if(!(num("totalMin")>=1)) return t.errDurationMin;
    }
    if(goal!=="scenario"){
      if(!(fnum("baseHold")>=0.1)) return t.errHoldMin;
      const hc=num("holdChance");
      if(!(hc>=0 && hc<=100)) return t.errChanceRange;
      const mn=num("minHold"), mx=num("maxHold");
      if(!(mn>=1)||!(mx>=1)) return t.errLongHoldInvalid;
      if(mn>mx) return t.errLongHoldMinMax;
      const rn=num("minRest"), rx=num("maxRest");
      if(rn<0 || rx<0 || isNaN(rn) || isNaN(rx)) return t.errRestNegative;
      if(rn>rx) return t.errRestMinMax;
    }
    if(num("releaseGrace")<0 || isNaN(num("releaseGrace"))) return t.errReleaseGraceNegative;
    if(goal!=="scenario"){
      if($("penalty").checked && !(num("penaltyX")>=1)) return t.errPenaltyAmount;
      if($("penalty").checked && !(num("lateTol")>=1)) return t.errLateTolMin;
    }
    if(goal==="scenario" && $("scenarioSel").value === "interval"){
      const n = Math.min(6, Math.max(2, Math.round(parseFloat($("ivPhaseCount").value) || 3)));
      const presets = KV.get(K.presets, {});
      for(let i=1;i<=n;i++){
        const name = $("ivPhasePreset"+i).value;
        if(!name || !presets[name]) return t.errIvPhasePreset(i);
      }
    }
    return null;
  }

  // Populates the Reps-mode difficulty fields (hold/rest ranges,
  // strict/penalty/lateTol/hideDur) on `cfg` from any object shaped like
  // readAll()'s output — which is exactly what a saved preset already is.
  // Shared by buildPlan()'s baseline and by Interval Sequence's per-phase
  // preset application (ivAdvancePhase()). `src.goal` decides whether the
  // phase is rep-count-driven ("reps", or anything else — the pre-existing
  // behavior) or duration-driven ("time"): `cfg.iv_phaseMode` records which,
  // so Interval Sequence's own time-based-phase-end/penalty/progress logic
  // (see nextRep()/applyPenalty()/sessionProgress()) knows which applies —
  // `cfg.goal`/`S.goal` itself is never touched here, since it must stay
  // "scenario" for the whole Interval Sequence session (see § in
  // ARCHITECTURE.md on why: contaminating the per-goal PR record).
  function applyRepsConfig(cfg, src){
    const n  = id => parseInt(src[id], 10);
    const fn = id => parseFloat(src[id]);
    cfg.base         = fn("baseHold");
    cfg.chance       = n("holdChance");
    cfg.minHold      = n("minHold");
    cfg.maxHold      = n("maxHold");
    cfg.minRest      = n("minRest");
    cfg.maxRest      = n("maxRest");
    cfg.releaseGrace = Math.max(0, n("releaseGrace") || 0);
    cfg.strict       = !!src.strict;
    cfg.penalty      = !!src.penalty;
    cfg.penaltyX     = n("penaltyX") || 0;
    cfg.lateTol      = n("lateTol") || 0;
    cfg.hide         = !!src.hideDur;
    if(src.goal === "time"){
      cfg.iv_phaseMode = "time";
      cfg.totalMin     = fn("totalMin");
      cfg.totalReps    = null;
    } else {
      cfg.iv_phaseMode = "reps";
      cfg.totalReps    = rand(n("minReps"), n("maxReps"));
    }
    return cfg;
  }

  function buildPlan(){
    const cfg = {
      goal,
      armed: false,
      progressTone: $("progressTone").checked,
      prAnnounce: $("prAnnounce").checked,
      pr: getPR(),          
      longestHold: 0,       
      prBeaten: false,      
      sig: {
        speech: $("voice").checked,
        beep: $("beep").checked,
        vibrate: $("vibrate").checked,
      },
      words: {
        down: ($("cmdDown").value || "").trim() || "Hold",
        up:   ($("cmdUp").value || "").trim() || "Breathe",
        hold: ($("cmdHold").value || "").trim() || "Keep going",
        penalty: ($("cmdPenaltyWord").value || "").trim() || "Penalty",
        finish: ($("cmdFinishWord").value || "").trim() || "Done",
      },
      rate: Math.min(2, Math.max(0.5, parseFloat($("cmdRate").value) || 1)),
      eyesClosed: $("eyesClosed").checked,
      guardExit: $("guardExit").checked,
      screenColor: $("screenColor").checked,
    };
    applyRepsConfig(cfg, readAll());   // baseline reps-shaped fields; overridden per phase for Interval Sequence, nulled below for time/other-scenario goals
    if(goal==="scenario"){
      cfg.scenario = $("scenarioSel").value || "stopwatch";
      const actSec = Math.min(600, Math.max(5, Math.round(parseFloat($("sdActionSec").value) || 60)));
      const pauSec = Math.min(300, Math.max(3, Math.round(parseFloat($("sdPauseSec").value) || 20)));
      cfg.sd_actionMs = actSec * 1000;
      cfg.sd_pauseMs  = pauSec * 1000;
      cfg.sd_startReps = Math.min(50, Math.max(1, Math.round(parseFloat($("sdStartReps").value) || 1)));
      cfg.sd_startHold = Math.min(120, Math.max(0, parseFloat($("sdStartHold").value) || 0));
      cfg.ta_target = Math.min(900, Math.max(10, Math.round(parseFloat($("taTarget").value) || 60)));
      cfg.rr_bpm = Math.min(200, Math.max(20, Math.round(parseFloat($("rrBpm").value) || 45)));
      cfg.rr_step = Math.min(40, Math.max(1, Math.round(parseFloat($("rrStep").value) || 8)));
      cfg.livesOn = $("livesOn").checked;
      cfg.livesCount = Math.min(9, Math.max(1, Math.round(parseFloat($("livesCount").value) || 3)));
      if(cfg.scenario === "interval"){
        const n = Math.min(6, Math.max(2, Math.round(parseFloat($("ivPhaseCount").value) || 3)));
        cfg.iv_phasePresets = [1,2,3,4,5,6].map(i => $("ivPhasePreset"+i).value || "").slice(0, n);
        cfg.iv_phaseIdx = 0;
        cfg.iv_totalDone = 0;
        const presets = KV.get(K.presets, {});
        const p0 = presets[cfg.iv_phasePresets[0]] || {};
        applyRepsConfig(cfg, p0);       // phase 1's own preset overrides the baseline
        cfg.iv_savedCurves = { hold: curves.hold.slice(), rest: curves.rest.slice(), modeHold: curveMode.hold, modeRest: curveMode.rest };
        applyIvPhaseCurve(p0);
      } else {
        cfg.totalReps = null;
      }
    } else if(goal==="time"){
      cfg.totalMin = num("totalMin");
      cfg.totalReps = null;
    }
    // goal==="reps": cfg.totalReps is already correctly rolled by applyRepsConfig(cfg, readAll()) above
    return cfg;
  }

  function holdDurationFor(cfg){
    if(Math.random()*100 < cfg.chance){
      return { secs: sampleFromCurve("hold", cfg.minHold, cfg.maxHold), long:true };
    }
    return { secs: cfg.base, long:false };
  }

  function restSecsForNext(){
    return sampleFromCurve("rest", S.minRest, S.maxRest);
  }

  function show(which){
    $("setup").classList.toggle("hidden", which!=="setup");
    $("session").classList.toggle("hidden", which!=="session");
    $("finish").classList.toggle("hidden", which!=="finish");
  }

  function startSession(){
    const msg = validate();
    $("err").textContent = msg || "";
    if(msg) return;

    // camera mode: place & calibrate the ROI first, then this runs again in "session" mode
    if(camEnabled() && cam.mode!=="session"){ camOpenSetup(); return; }

    if(synth){ try{ synth.cancel(); synth.resume(); }catch(e){} }

    S = buildPlan();
    S.done = 0;
    show("session");
    $("repTotalWrap").style.display = S.totalReps ? "" : "none";
    $("repTotal").textContent = S.totalReps || "";
    $("repNow").textContent = "0";
    armReady();   
  }

  function fmtSW(s){
    s = Math.max(0,s);
    return s.toFixed(1) + "s";
  }

  function armReady(){
    if(!S) return;
    if(S.goal === "scenario" && S.scenario !== "interval") return armReadyScenario();
    S.cur = holdDurationFor(S);
    S.heldMs = 0;
    S.spokeHold = false;
    S.lastSpokenSec = null;
    holding = false;
    applyScreenColor();
    setFill(0);
    $("repNow").textContent = 1;
    S.subBase = (!S.hide && S.cur.long) ? T().holdForN(S.cur.secs) : T().pressAndHold;
    $("timer").textContent = "";
    setCue("up", T().ready, S.eyesClosed ? T().tapToStart : T().pressToStart);
    $("btnLab").textContent = T().pressToStart;
    S.armed = true;          
    S.waitingStart = true;   
    setTapSurface(S.eyesClosed);
    $("clock").textContent = (S.goal==="time") ? ("0:00 / " + fmtTime(S.totalMin*60)) : "0:00";
    if(S.scenario === "interval"){
      $("swStats").classList.remove("hidden");
      ivUpdatePhaseIndicator();
    }
  }

  // ---------- lives system: survive a fail instead of instant game over ----------
  function renderLives(justLostIdx){
    const el = $("livesRow"); if(!el) return;
    if(!S || S.livesLeft == null){ el.classList.add("hidden"); el.innerHTML = ""; return; }
    el.classList.remove("hidden");
    let html = "";
    for(let i=0;i<S.livesMax;i++){
      const lost = i >= S.livesLeft;
      const cls = "heart" + (lost ? " lost" : "") + (lost && i===justLostIdx ? " justLost" : "");
      html += `<span class="${cls}">♥</span>`;
    }
    el.innerHTML = html;
  }
  function cueLifeLost(){
    if(!S) return;
    if(S.sig && S.sig.vibrate) vibrate([0,70,60,70]);
    if(S.sig && S.sig.beep){ beep(300,100,0); beep(220,150,120); }
    const btn = $("holdBtn");
    if(btn){ btn.classList.add("lifeLost"); setTimeout(()=>btn.classList.remove("lifeLost"), 380); }
  }
  // Call at a fail point. Returns true if a life absorbed the failure (caller
  // should reset to a retry state instead of finishing); false = truly over
  // (either lives are off, or the last one is spent) — caller should finish().
  function tryLoseLife(){
    if(!S || S.livesLeft == null) return false;
    S.livesLeft = Math.max(0, S.livesLeft - 1);
    renderLives(S.livesLeft);
    cueLifeLost();
    return S.livesLeft > 0;
  }

  // ---------- screen color mode: green (may breathe) / yellow (about to hold) / red (holding) ----------
  function applyScreenColor(force){
    const el = $("screenColorLayer"); if(!el) return;
    const elBorder = $("screenColorBorderLayer");
    if(!S || !S.screenColor){
      if(curScreenColorState !== null){
        el.classList.add("hidden"); el.classList.remove("green","yellow","red");
        if(elBorder){ elBorder.classList.add("hidden"); elBorder.classList.remove("green","yellow","red"); }
        curScreenColorState = null;
      }
      return;
    }
    let state, yellowDur = null;
    if(S.scenario === "rhythm"){
      state = (Date.now() < (S.rr_flashUntil||0)) ? "red" : "yellow";
    } else if(holding){
      state = "red";
    } else if(isActionTap()){
      // sd_speed/sd_mixed action phase: setCue("rest",...) fires here between
      // taps (existing "brief relax" behavior), but that's not a real
      // breathe-now moment mid-action -> stay yellow.
      state = "yellow";
    } else if(lastCueKind === "rest" || lastCueKind === "down"){
      state = "green";
    } else {
      state = "yellow";
      // A real late-start tolerance window is ticking (reps/time only, only
      // when the penalty toggle + lateTol are active; reactTimer is 0
      // whenever no such window is running) -> pace the rise to lateTol
      // seconds instead of the generic cosmetic duration.
      if(S.goal !== "scenario" && reactTimer && S.penalty && S.lateTol > 0){
        yellowDur = S.lateTol;
      }
    }
    el.style.setProperty("--scYellowDur", (yellowDur != null ? yellowDur : 2.8) + "s");
    if(state === curScreenColorState && !force) return;   // no change -> don't restart the animation
    curScreenColorState = state;
    el.classList.remove("hidden","green","yellow","red");
    void el.offsetWidth;                        // force reflow so the keyframe animation restarts cleanly
    el.classList.add(state);
    if(elBorder){
      elBorder.classList.remove("hidden","green","yellow","red");
      elBorder.classList.add(state);
    }
  }

  function armReadyScenario(){
    holding = false;
    applyScreenColor();
    pendingRelease = false; clearTimeout(releaseTimer); releaseTimer = 0;
    setFill(0);
    $("repNow").textContent = 0;
    S.subBase = "";
    $("timer").textContent = "–";
    setCue("up", T().ready, S.eyesClosed ? T().tapToStart : T().pressToStart);
    $("btnLab").textContent = T().pressToStart;
    S.armed = true;
    S.waitingStart = true;
    setTapSurface(S.eyesClosed);
    $("clock").textContent = "0:00";

    if(S.livesOn && scenarioSupportsLives(S.scenario)){
      S.livesMax = S.livesCount || 3;
      S.livesLeft = S.livesMax;
    } else {
      S.livesMax = 0;
      S.livesLeft = null;
    }
    renderLives();

    $("swStats").classList.remove("hidden");
    if(S.scenario === "stopwatch"){
      S.swLongest = 0;
      S.swLastReleaseTs = null;
      $("swRest").textContent = fmtSW(0);
      $("swLongest").textContent = fmtSW(0);
      document.querySelector('#swStats .swStat:nth-child(1) .swLbl').textContent = T().swRestLabel || "Rest since last hold";
      document.querySelector('#swStats .swStat:nth-child(2) .swLbl').textContent = T().swLongestLabel || "Longest hold";
    } else if (S.scenario === "sd_hold") {
      S.sd_prevHold = 0;
      S.swLastReleaseTs = null;
      $("swRest").textContent = fmtSW(0);
      $("swLongest").textContent = "0.0s";
      document.querySelector('#swStats .swStat:nth-child(1) .swLbl').textContent = T().swRestLabel || "Rest since last hold";
      document.querySelector('#swStats .swStat:nth-child(2) .swLbl').textContent = T().sdHoldLastLabel;
    } else if (S.scenario === "sd_speed") {
      S.sd_phase = "action";
      S.sd_repsThisPhase = 0;
      S.sd_prevPhaseReps = 0;
      S.sd_actionMsAcc = 0;   // total action-phase time (pauses excluded), for action pace
      $("swRest").textContent = fmtSW((S.sd_actionMs||60000)/1000);
      $("swLongest").textContent = "0";
      document.querySelector('#swStats .swStat:nth-child(1) .swLbl').textContent = T().sdPhaseTimeLabel;
      document.querySelector('#swStats .swStat:nth-child(2) .swLbl').textContent = T().sdSpeedRepsGoal(0);
    } else if (S.scenario === "sd_mixed") {
      S.sd_phase = "action";
      S.sd_repsThisPhase = 0;
      // start values (round 1): need > (startReps-1) reps and > startHold seconds
      S.sd_prevActionReps = Math.max(0, (S.sd_startReps || 1) - 1);
      S.sd_prevHold = S.sd_startHold || 0;
      S.sd_mixedRounds = 0;
      S.sd_holdTargetHit = false;
      S.sd_lastCountSec = 0;
      $("swRest").textContent = fmtSW((S.sd_actionMs||60000)/1000);
      $("swLongest").textContent = "0";
      document.querySelector('#swStats .swStat:nth-child(1) .swLbl').textContent = T().sdPhaseTimeLabel;
      document.querySelector('#swStats .swStat:nth-child(2) .swLbl').textContent = T().sdMixedActionRepsGoal(S.sd_prevActionReps);
    } else if (S.scenario === "timeattack") {
      S.swLongest = 0;
      const tgt = (S.ta_target||60);
      $("swRest").textContent = fmtSW(0);
      $("swLongest").textContent = fmtSW(tgt);
      document.querySelector('#swStats .swStat:nth-child(1) .swLbl').textContent = T().taTotalLabel;
      document.querySelector('#swStats .swStat:nth-child(2) .swLbl').textContent = T().taTargetLabel;
    } else if (S.scenario === "rhythm") {
      // rhythm auto-starts with a count-in; no press needed to boot
      $("swRest").textContent = "0";
      $("swLongest").textContent = fmtSW(0);
      document.querySelector('#swStats .swStat:nth-child(1) .swLbl').textContent = T().rhythmLevelLabel;
      document.querySelector('#swStats .swStat:nth-child(2) .swLbl').textContent = T().rhythmHitsLabel;
      rhythmStart();
    }
  }

  function bootFirstPress(){
    S.waitingStart = false;
    S.startTime = Date.now();
    if(S.goal==="time") S.endAt = S.startTime + S.totalMin*60*1000;
    if(S.scenario === "interval"){
      S.iv_phaseStartAt = S.startTime;
      if(S.iv_phaseMode === "time") S.endAt = S.startTime + S.totalMin*60*1000;
    }

    if(S.scenario==="sd_speed") {
       const actionMs = S.sd_actionMs || 60000;
       const pauseMs  = S.sd_pauseMs  || 20000;
       S.sd_phaseEndTs = S.startTime + actionMs;
       S.sd_timer = setInterval(()=>{
           if(!S || S.scenario !== "sd_speed") { clearInterval(S.sd_timer); return; }
           const now = Date.now();
           const remain = Math.max(0, (S.sd_phaseEndTs - now) / 1000);
           $("swRest").textContent = fmtSW(remain);
           
           if (S.sd_phase === "action" && !holding) {
               $("subcue").textContent = T().sdActionEndsIn(Math.ceil(remain));
           } else if (S.sd_phase === "rest") {
               $("subcue").textContent = T().sdRestNextIn(Math.ceil(remain));
           }

           if (remain <= 0) {
               if (S.sd_phase === "action") {
                   if (holding) pressEndStopwatch();
                   if (S.sd_prevPhaseReps > 0 && S.sd_repsThisPhase < S.sd_prevPhaseReps) {
                       if(tryLoseLife()){
                           // retry: redo the same action phase from scratch, target unchanged
                           S.sd_phaseEndTs = now + actionMs;
                           S.sd_repsThisPhase = 0;
                           $("repNow").textContent = 0;
                           $("swLongest").textContent = "0";
                           setCue("up", T().ready, T().actionPhaseCue);
                           cmd("down");
                           return;
                       }
                       S.scenarioFailMsg = T().sdSpeedFail(S.sd_repsThisPhase, S.sd_prevPhaseReps);
                       finish();
                       return;
                   }
                   S.sd_actionMsAcc = (S.sd_actionMsAcc || 0) + actionMs;   // completed action phase
                   S.sd_phase = "rest";
                   S.sd_phaseEndTs = now + pauseMs;
                   S.sd_prevPhaseReps = Math.max(S.sd_prevPhaseReps || 0, S.sd_repsThisPhase);
                   S.sd_repsThisPhase = 0;
                   $("repNow").textContent = 0;
                   document.querySelector('#swStats .swStat:nth-child(2) .swLbl').textContent = T().sdSpeedRepsGoal(S.sd_prevPhaseReps);
                   $("swLongest").textContent = "0";
                   setCue("rest", T().scenarioPauseBig, T().scenarioPauseSub);
                   cmd("up");
               } else {
                   S.sd_phase = "action";
                   S.sd_phaseEndTs = now + actionMs;
                   setCue("up", T().ready, T().actionPhaseCue);
                   cmd("down");
               }
           }
       }, 100);
    }

    if(S.scenario==="sd_mixed") {
       const actionMs = S.sd_actionMs || 60000;
       S.sd_phaseEndTs = S.startTime + actionMs;
       S.sd_timer = setInterval(()=>{
           if(!S || S.scenario !== "sd_mixed") { clearInterval(S.sd_timer); return; }
           // hold phase is freeform (no countdown) — driven by press/release
           if (S.sd_phase === "hold"){
               if(!holding) $("subcue").textContent = T().sdMixedHoldSub(S.sd_prevHold);
               return;
           }
           const now = Date.now();
           const remain = Math.max(0, (S.sd_phaseEndTs - now) / 1000);
           $("swRest").textContent = fmtSW(remain);

           if (S.sd_phase === "action") {
               const secs = Math.ceil(remain);
               if(!holding) $("subcue").textContent = T().sdMixedActionCountdown(secs);
               // prominent 3-2-1 countdown into the hold phase
               if(secs>=1 && secs<=3 && !holding){
                   $("timer").textContent = String(secs);
                   if(secs !== S.sd_lastCountSec){
                       S.sd_lastCountSec = secs;
                       const el = $("timer");                         // re-trigger the pulse each second
                       el.classList.remove("counting"); void el.offsetWidth; el.classList.add("counting");
                       if(S.sig.beep) beep(500 + (4-secs)*130, 90, 0);   // 3->620, 2->750, 1->880
                       if(S.sig.vibrate) vibrate(20);
                   }
               }
           } else if (S.sd_phase === "pause") {
               $("subcue").textContent = T().sdMixedPauseSub(Math.ceil(remain));
           }

           if (remain <= 0) {
               if (S.sd_phase === "action") {
                   flushPendingRelease();   // count any in-progress tap synchronously
                   // must do MORE reps than the previous action phase
                   if (S.sd_repsThisPhase <= S.sd_prevActionReps) {
                       if(tryLoseLife()){
                           // retry: redo the same action phase from scratch, target unchanged
                           S.sd_phaseEndTs = now + actionMs;
                           S.sd_repsThisPhase = 0;
                           S.sd_lastCountSec = 0;
                           setFill(0);
                           $("timer").classList.remove("counting");
                           $("repNow").textContent = 0;
                           document.querySelector('#swStats .swStat:nth-child(2) .swLbl').textContent = T().sdMixedActionRepsGoal(S.sd_prevActionReps);
                           $("swLongest").textContent = "0";
                           setCue("up", T().ready, T().actionPhaseCue);
                           cmd("down");
                           return;
                       }
                       S.scenarioFailMsg = T().sdMixedActionFail(S.sd_repsThisPhase, S.sd_prevActionReps);
                       finish();
                       return;
                   }
                   S.sd_prevActionReps = S.sd_repsThisPhase;
                   // -> HOLD phase (must beat the previous hold to continue)
                   S.sd_phase = "hold";
                   S.sd_holdTargetHit = false;
                   setFill(0);
                   $("timer").classList.remove("counting");
                   $("swRest").textContent = fmtSW(0);
                   $("timer").textContent = fmtSW(0);
                   document.querySelector('#swStats .swStat:nth-child(1) .swLbl').textContent = T().sdHoldPhaseLabel;
                   document.querySelector('#swStats .swStat:nth-child(2) .swLbl').textContent = T().sdHoldGoalLabel(S.sd_prevHold);
                   $("swLongest").textContent = S.sd_prevHold>0 ? `>${S.sd_prevHold.toFixed(1)}s` : "–";
                   setCue("up", T().holdBigCue, T().sdMixedHoldTargetSub(S.sd_prevHold));
                   mixedHoldCue();
               } else if (S.sd_phase === "pause") {
                   S.sd_phase = "action";
                   S.sd_phaseEndTs = now + actionMs;
                   S.sd_repsThisPhase = 0;
                   S.sd_lastCountSec = 0;
                   setFill(0);
                   $("repNow").textContent = 0;
                   document.querySelector('#swStats .swStat:nth-child(1) .swLbl').textContent = T().sdPhaseTimeLabel;
                   document.querySelector('#swStats .swStat:nth-child(2) .swLbl').textContent = T().sdMixedActionRepsGoal(S.sd_prevActionReps);
                   $("swLongest").textContent = "0";
                   setCue("up", T().ready, T().actionPhaseCue);
                   cmd("down");
               }
           }
       }, 100);
    }

    startClock();
    acquireWake();
    const ac = ensureAudio(); if(ac && ac.state==="suspended"){ try{ ac.resume(); }catch(e){} }
    if(S.guardExit) enableGuard();
  }

  // Shared "resume a hold that was still inside its release-grace window"
  // logic — was duplicated near-verbatim between pressStartStopwatch() and
  // pressStart(). loopFn is the RAF loop to resume (stopwatchHoldLoop or loop).
  function resumeHeldRelease(loopFn, pointerId){
    clearTimeout(releaseTimer); releaseTimer = 0;
    pendingRelease = false;
    holding = true;
    activePointerId = (pointerId !== undefined) ? pointerId : null;
    applyScreenColor();
    $("holdBtn").classList.add("holding");
    progressStart();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loopFn);
  }
  // Shared "stop holding right now" triple, used by every path that ends an
  // in-progress hold before its own follow-up logic (finalize, grace timer, etc).
  function releaseHold(){
    holding = false;
    activePointerId = null;
    applyScreenColor();
    cancelAnimationFrame(raf);
  }

  let swRestTimer = 0;
  function pressStartStopwatch(pointerId){
    if(S && S.scenario === "rhythm"){ rhythmTap(); return; }   // a press = a beat tap
    if(S && S.scenario === "sd_speed" && S.sd_phase === "rest") return;
    if(S && S.scenario === "sd_mixed" && S.sd_phase === "pause") return;

    if(pendingRelease){
      resumeHeldRelease(stopwatchHoldLoop, pointerId);
      return;
    }
    if(S.waitingStart) bootFirstPress();
    clearInterval(swRestTimer); swRestTimer = 0;
    S.swHoldStartTs = Date.now();
    holding = true;
    activePointerId = (pointerId !== undefined) ? pointerId : null;
    applyScreenColor();
    $("holdBtn").classList.add("holding");
    setCue("up", S.words.down, "");
    $("btnLab").textContent = T().holding;
    $("timer").classList.remove("counting");
    $("timer").textContent = fmtSW(0);
    if(isActionTap()){
      tick("down");           // short blip, no speech, for rapid action reps
    } else {
      if(S.sig.vibrate) vibrate(25);
      cmd("down");
    }
    progressStart();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(stopwatchHoldLoop);
  }
  // Finalize an in-progress or grace-pending release right now (no defer).
  // Used at the Mixed action->hold boundary so a lingering tap is counted as a
  // rep instead of being mis-evaluated as the (short) hold after the phase flips.
  function flushPendingRelease(){
    if(!S) return;
    if(holding){
      releaseHold();
      S.swReleaseTs = Date.now();
    } else if(!pendingRelease){
      return;
    }
    clearTimeout(releaseTimer); releaseTimer = 0;
    pendingRelease = false;
    finalizeStopwatchRelease();
  }
  function stopwatchHoldLoop(){
    if(!holding || !S || (S.scenario !== "stopwatch" && S.scenario !== "sd_hold" && S.scenario !== "sd_speed" && S.scenario !== "sd_mixed" && S.scenario !== "timeattack")) return;
    const elapsed = (Date.now() - S.swHoldStartTs)/1000;
    $("timer").textContent = fmtSW(elapsed);
    // Time Attack: accumulate toward the target total; auto-finish when reached
    if(S.scenario === "timeattack"){
      const target = S.ta_target || 60;
      const total = (S.holdSec || 0) + elapsed;
      $("swRest").textContent = fmtSW(total);
      const p = Math.min(1, total/target);
      setFill(p); progressUpdate(p);
      if(total >= target){ taComplete(target); return; }
      raf = requestAnimationFrame(stopwatchHoldLoop);
      return;
    }
    // Mixed hold phase: fill the button up to the target (previous round's hold)
    if(S.scenario === "sd_mixed" && S.sd_phase === "hold" && (S.sd_prevHold || 0) > 0){
      const target = S.sd_prevHold;
      const p = Math.min(1, elapsed / target);
      setFill(p);
      progressUpdate(p);
      if(elapsed >= target && !S.sd_holdTargetHit){
        S.sd_holdTargetHit = true;
        setFill(1);
        setCue("up", T().holdTargetHitBig, T().holdTargetHitSub);
        mixedHoldTargetCue();
      }
    } else {
      progressUpdate(Math.min(1, elapsed/30));
    }
    raf = requestAnimationFrame(stopwatchHoldLoop);
  }
  function pressEndStopwatch(){
    releaseHold();
    S.swReleaseTs = Date.now();
    const graceMs = (S && S.releaseGrace) ? S.releaseGrace : 0;
    if(graceMs > 0){
      pendingRelease = true;
      clearTimeout(releaseTimer);
      releaseTimer = setTimeout(()=>{ releaseTimer=0; pendingRelease=false; finalizeStopwatchRelease(); }, graceMs);
      return;
    }
    finalizeStopwatchRelease();
  }
  function finalizeStopwatchRelease(){
    progressStop();
    $("holdBtn").classList.remove("holding");
    if(!S) return;
    const heldSec = Math.max(0, ((S.swReleaseTs || Date.now()) - S.swHoldStartTs)/1000);

    if (S.scenario === "sd_hold") {
        if (S.sd_prevHold > 0 && heldSec < S.sd_prevHold) {
            if(tryLoseLife()){
                // retry: same target, arm for the next hold attempt
                S.swLastReleaseTs = S.swReleaseTs || Date.now();
                $("swRest").textContent = fmtSW(0);
                setCue("rest", T().rest, S.eyesClosed ? T().tapToStart : T().pressToStart);
                $("btnLab").textContent = T().pressToStart;
                $("timer").textContent = fmtSW(0);
                clearInterval(swRestTimer);
                swRestTimer = setInterval(()=>{
                  if(!S || (S.scenario !== "stopwatch" && S.scenario !== "sd_hold")) { clearInterval(swRestTimer); return; }
                  const rs = (Date.now() - S.swLastReleaseTs)/1000;
                  $("timer").textContent = fmtSW(rs);
                  $("swRest").textContent = fmtSW(rs);
                }, 100);
                return;
            }
            S.scenarioFailMsg = T().sdHoldFail(heldSec.toFixed(1), S.sd_prevHold.toFixed(1));
            finish();
            return;
        }
        S.sd_prevHold = heldSec;
        $("swLongest").textContent = fmtSW(S.sd_prevHold);
    }

    if (S.scenario === "sd_mixed") {
        if (S.sd_phase === "action") {
            S.sd_repsThisPhase++;
            S.done = (S.done || 0) + 1;
            $("swLongest").textContent = S.sd_repsThisPhase;
            $("repNow").textContent = S.sd_repsThisPhase;
        } else if (S.sd_phase === "hold") {
            if (heldSec <= S.sd_prevHold) {
                if(tryLoseLife()){
                    // retry: same hold target, re-arm the hold
                    setFill(0);
                    $("timer").classList.remove("counting");
                    $("swRest").textContent = fmtSW(0);
                    $("timer").textContent = fmtSW(0);
                    S.sd_holdTargetHit = false;
                    setCue("up", T().holdBigCue, T().sdMixedHoldTargetSub(S.sd_prevHold));
                    mixedHoldCue();
                    return;
                }
                S.scenarioFailMsg = T().sdMixedHoldFail(heldSec.toFixed(1), S.sd_prevHold.toFixed(1));
                S.holdSec = (S.holdSec||0) + heldSec;
                if(heldSec > (S.longestHold||0)) S.longestHold = heldSec;
                finish();
                return;
            }
            // hold beaten -> round complete -> pause, then next action phase
            S.sd_prevHold = heldSec;
            S.done = (S.done || 0) + 1;
            S.sd_mixedRounds = (S.sd_mixedRounds || 0) + 1;
            S.sd_phase = "pause";
            S.sd_phaseEndTs = Date.now() + (S.sd_pauseMs || 20000);
            setFill(0);
            document.querySelector('#swStats .swStat:nth-child(1) .swLbl').textContent = T().pauseLabel;
            document.querySelector('#swStats .swStat:nth-child(2) .swLbl').textContent = T().sdMixedRoundLabel(S.sd_mixedRounds);
            $("swLongest").textContent = fmtSW(S.sd_prevHold);
        }
    } else if (S.scenario === "sd_speed") {
        if (S.sd_phase === "action") {
            S.sd_repsThisPhase++;
            S.done = (S.done || 0) + 1;
            $("swLongest").textContent = S.sd_repsThisPhase;
            $("repNow").textContent = S.sd_repsThisPhase;
        }
    } else {
        S.done = (S.done||0) + 1;
        $("repNow").textContent = S.done;
    }

    S.holdSec = (S.holdSec||0) + heldSec;                 
    if(S.scenario === "stopwatch") {
        if(heldSec > S.swLongest) S.swLongest = heldSec;
        $("swLongest").textContent = fmtSW(S.swLongest);
    }

    if(heldSec > (S.longestHold||0)) S.longestHold = heldSec;  
    const heldSecRounded = Math.round(heldSec);
    if(heldSecRounded > (S.pr||0) && !S.prBeaten && S.prAnnounce){
      S.prBeaten = true;
      say(T().newRecord(heldSecRounded));
    }
    if(isActionTap()) tick("up"); else cmd("up");

    if (S.scenario === "sd_speed" || S.scenario === "sd_mixed" || S.scenario === "timeattack") {
        if (S.scenario === "sd_mixed" && S.sd_phase === "pause") {
            setCue("rest", T().scenarioPauseBig, T().scenarioPauseSub);
        } else if (S.scenario === "timeattack") {
            $("swRest").textContent = fmtSW(S.holdSec || 0);
            setCue("rest", T().breathe, T().pressToStart);
        } else {
            setCue("rest", T().rest, S.eyesClosed ? T().tapToStart : T().pressToStart);
        }
        $("btnLab").textContent = T().pressToStart;
        $("timer").textContent = fmtSW(0);
    } else {
        S.swLastReleaseTs = S.swReleaseTs || Date.now();
        $("swRest").textContent = fmtSW(0);
        setCue("rest", T().rest, S.eyesClosed ? T().tapToStart : T().pressToStart);
        $("btnLab").textContent = T().pressToStart;
        $("timer").textContent = fmtSW(0);
        clearInterval(swRestTimer);
        swRestTimer = setInterval(()=>{
          if(!S || (S.scenario !== "stopwatch" && S.scenario !== "sd_hold")) { clearInterval(swRestTimer); return; }
          const rs = (Date.now() - S.swLastReleaseTs)/1000;
          $("timer").textContent = fmtSW(rs);
          $("swRest").textContent = fmtSW(rs);
        }, 100);
    }
  }

  // ---------- Time Attack: reach a target total hold as fast as possible ----------
  function taComplete(target){
    releaseHold(); progressStop();
    $("holdBtn").classList.remove("holding");
    clearTimeout(releaseTimer); releaseTimer = 0; pendingRelease = false;
    S.holdSec = target;
    const wall = Math.max(0.1, (Date.now() - S.startTime)/1000);
    const score = Math.round(target / wall * 100);
    S.taScore = score;
    S.done = (S.done || 0) + 1;
    S.scenarioFailMsg = T().taDone(Math.round(target), fmtTime(Math.round(wall)), score);
    finish();
  }

  // ---------- Rhythm Rush: tap on every beat of an accelerating metronome ----------
  function rhythmBeep(count){
    const ctx = ensureAudio(); if(ctx && ctx.state==="suspended"){ try{ ctx.resume(); }catch(e){} }
    beep(count ? 620 : 780, 45, 0);   // metronome always audible (it's the mechanic)
  }
  function rhythmPulse(){
    const b=$("holdBtn"); if(!b) return;
    b.classList.add("holding");
    setTimeout(()=>{ if(!holding) b.classList.remove("holding"); }, 110);
  }
  function rhythmUpdateStats(){
    $("swRest").textContent = "L" + (S.rr_level||1) + " · " + Math.round(S.rr_bpm) + " BPM";
    $("swLongest").textContent = S.rr_hits || 0;
    $("timer").textContent = S.rr_hits || 0;
  }
  function rhythmStart(){
    S.waitingStart = false;
    S.startTime = Date.now();
    S.rr_interval = 60000 / S.rr_bpm;
    S.rr_window = 260;   // ± timing tolerance (ms) around each beat to count as a hit; not user-configurable, unlike rr_bpm/rr_step
    S.rr_beatsPerLevel = 8;
    S.rr_hits = 0; S.rr_level = 1; S.rr_countIn = 4;
    S.rr_beatTime = Date.now() + 1200;   // lead-in before the first beat
    S.rr_ticked = false; S.rr_tapped = false;
    startClock(); acquireWake();
    const ac = ensureAudio(); if(ac && ac.state==="suspended"){ try{ ac.resume(); }catch(e){} }
    if(S.guardExit) enableGuard();
    rhythmUpdateStats();
    setCue("up", T().rhythmGetReady, T().rhythmTapBeat);
    $("btnLab").textContent = T().rhythmTap;
    S.rr_timer = setInterval(rhythmTick, 20);
  }
  function rhythmTick(){
    if(!S || S.scenario !== "rhythm"){ clearInterval(S.rr_timer); return; }
    const now = Date.now(), bt = S.rr_beatTime, W = S.rr_window;
    if(now >= bt && !S.rr_ticked){ S.rr_ticked = true; rhythmBeep(S.rr_countIn > 0); rhythmPulse(); }
    if(now > bt + W){
      if(S.rr_countIn > 0){
        S.rr_countIn--;
        S.rr_beatTime = bt + S.rr_interval; S.rr_ticked = false; S.rr_tapped = false;
        if(S.rr_countIn === 0) setCue("up", T().rhythmGo, T().rhythmTapBeat);
      } else if(!S.rr_tapped){
        rhythmMiss(T().rrMiss);
      } else {
        S.rr_beatTime = bt + S.rr_interval; S.rr_ticked = false; S.rr_tapped = false;
      }
    }
  }
  function rhythmTap(){
    if(!S || S.scenario !== "rhythm") return;
    const now = Date.now();
    if(now - (S.rr_lastFlashAt||0) >= 330){          // safety throttle: cap at ~3 flashes/sec (WCAG 2.3.1)
      S.rr_lastFlashAt = now;
      S.rr_flashUntil = now + 140;
      applyScreenColor();
      setTimeout(applyScreenColor, 140);              // reverts to yellow; self-correcting if a newer tap extended the flash
    }
    if(S.rr_countIn > 0){ rhythmPulse(); return; }   // ignore taps during the count-in
    const dt = now - S.rr_beatTime, W = S.rr_window;
    if(dt < -W){ rhythmMiss(T().rrEarly); return; }
    if(dt > W){ rhythmMiss(T().rrLate); return; }
    if(S.rr_tapped) return;
    S.rr_tapped = true; S.rr_hits++; S.done = S.rr_hits;
    if(S.sig.beep) beep(1040, 40, 0);
    if(S.sig.vibrate) vibrate(15);
    if(S.rr_hits % S.rr_beatsPerLevel === 0){ S.rr_level++; S.rr_bpm += S.rr_step; S.rr_interval = 60000 / S.rr_bpm; }
    rhythmUpdateStats();
  }
  function rhythmMiss(reason){
    if(!S) return;
    if(tryLoseLife()){
        // survive: this beat is spent (no hit, no level change), the tick loop
        // advances to the next beat at the same tempo on its next pass
        S.rr_tapped = true;
        return;
    }
    if(S.rr_timer) clearInterval(S.rr_timer);
    S.scenarioFailMsg = T().rrOver(reason, S.rr_hits||0, Math.round(S.rr_bpm||0));
    finish();
  }

  let clockTimer = 0;
  function fmtTime(totalSec){
    totalSec = Math.max(0, Math.floor(totalSec));
    const m = Math.floor(totalSec/60), s = totalSec%60;
    return m + ":" + String(s).padStart(2,"0");
  }
  function updateClock(){
    if(!S){ return; }
    const elapsed = (Date.now() - S.startTime)/1000;
    if(S.goal==="time"){
      const target = (S.endAt - S.startTime)/1000;
      $("clock").textContent = fmtTime(elapsed) + " / " + fmtTime(target);
    } else {
      $("clock").textContent = fmtTime(elapsed);
    }
  }
  function startClock(){
    clearInterval(clockTimer);
    updateClock();
    clockTimer = setInterval(updateClock, 1000);
  }

  function timeUp(){ return S.goal==="time" && S.endAt && Date.now() >= S.endAt; }

  function ivUpdatePhaseIndicator(){
    if(!S || S.scenario !== "interval") return;
    $("swStats").classList.remove("hidden");
    document.querySelector('#swStats .swStat:nth-child(1) .swLbl').textContent = T().ivPhaseLabel;
    $("swRest").textContent = T().ivPhaseOfLabel(S.iv_phaseIdx+1, S.iv_phasePresets.length);
    document.querySelector('#swStats .swStat:nth-child(2) .swLbl').textContent = T().ivPresetLabel;
    $("swLongest").textContent = S.iv_phasePresets[S.iv_phaseIdx] || "";
  }

  function ivAdvancePhase(){
    if(!S || S.scenario !== "interval") return false;
    S.iv_phaseIdx++;
    if(S.iv_phaseIdx >= S.iv_phasePresets.length) return false;
    const presets = KV.get(K.presets, {});
    const p = presets[S.iv_phasePresets[S.iv_phaseIdx]] || {};
    applyRepsConfig(S, p);
    applyIvPhaseCurve(p);
    S.done = 0;
    S.iv_phaseStartAt = Date.now();
    if(S.iv_phaseMode === "time") S.endAt = S.iv_phaseStartAt + S.totalMin*60*1000;
    $("repTotalWrap").style.display = S.totalReps ? "" : "none";
    $("repTotal").textContent = S.totalReps || "";
    $("repNow").textContent = 0;
    ivUpdatePhaseIndicator();
    return true;
  }

  function nextRep(first){
    if(!S) return;
    S.armed = false;
    const ivPhaseTimeUp = S.scenario === "interval" && S.iv_phaseMode === "time" && S.endAt && Date.now() >= S.endAt;
    if((S.totalReps && S.done >= S.totalReps) || ivPhaseTimeUp){
      if(S.scenario === "interval" && ivAdvancePhase()){
        // fall through into the rest-countdown/beginRep() below, now using the new phase's freshly-applied config
      } else {
        if(S.scenario === "interval") S.scenarioFailMsg = T().ivComplete(S.iv_phasePresets.length);
        return finish();
      }
    }
    if(timeUp()) return finish();

    const restSecs = restSecsForNext();
    const restMs = first ? 0 : restSecs*1000;
    if(restMs>0){
      let left = restSecs;
      setCue("rest", T().rest, `${T().breathe} · ${left}s`);
      $("timer").textContent = "";
      restTimer = setInterval(()=>{
        left--;
        if(left<=0){ clearInterval(restTimer); beginRep(); }
        else $("subcue").textContent = `${T().breathe} · ${left}s`;
      },1000);
    } else {
      beginRep();
    }
  }

  function beginRep(){
    if(!S) return;
    if(timeUp()) return finish();
    pendingRelease = false; clearTimeout(releaseTimer); releaseTimer = 0;
    S.cur = holdDurationFor(S);
    S.heldMs = 0;
    S.spokeHold = false;
    S.lastSpokenSec = null;
    holding = false;
    applyScreenColor();
    setFill(0);
    const n = S.done + 1;
    $("repNow").textContent = n;
    let big, sub;
    if(S.hide){
      big = S.words.down; sub = T().pressAndHold;
    } else if(S.cur.long){
      big = S.words.down + " " + T().andHold; sub = T().holdForN(S.cur.secs);
    } else {
      big = S.words.down; sub = T().pressAndHold;
    }
    $("timer").textContent = "";
    S.subBase = sub;
    S.armed = true;    
    setCue("up", big, sub);
    cmd("down");
    $("btnLab").textContent = T().pressHold;
    startReactionWindow();
  }

  function startReactionWindow(){
    clearInterval(reactTimer); reactTimer = 0;
    if(!S || !S.penalty || !(S.lateTol > 0)) return;
    S.reactLeft = S.lateTol;
    renderReact();
    reactTimer = setInterval(()=>{
      if(!S || !S.cur || holding) return;
      S.reactLeft--;
      if(S.reactLeft <= 0){
        applyPenalty();
        S.subBase = penaltyNote(T().tooLate);
        S.reactLeft = S.lateTol;
        cmdPenaltyThenDown();
        flashTolerancePenalty();      // brief flash at the penalty moment
        applyScreenColor(true);       // restart the rise in sync with the reset countdown
      }
      renderReact();
    },1000);
    applyScreenColor(true);           // start the rise now, paced to lateTol seconds (reactTimer is set above)
  }
  function flashTolerancePenalty(){
    if(!S || !S.screenColor) return;
    const el = $("screenColorLayer"); if(!el) return;
    const elBorder = $("screenColorBorderLayer");
    el.classList.add("tolFlash");
    if(elBorder) elBorder.classList.add("tolFlash");
    setTimeout(()=>{
      el.classList.remove("tolFlash");
      if(elBorder) elBorder.classList.remove("tolFlash");
    }, 350);
  }
  function renderReact(){
    if(!S) return;
    $("subcue").textContent = `${S.subBase} · ${T().startWithin(S.reactLeft)}`;
  }

  function setCue(kind, big, sub){
    lastCueKind = kind;
    const c = $("cue");
    c.className = "cue " + kind;
    c.textContent = big;
    $("subcue").textContent = sub || "";
    applyScreenColor();
  }
  function setFill(p){ $("fill").style.height = Math.max(0,Math.min(100,p*100)) + "%"; }

  let lastTs = 0;
  function loop(ts){
    if(!holding || !S || !S.cur){ return; }
    if(!lastTs) lastTs = ts;
    const dt = ts - lastTs;
    lastTs = ts;
    S.heldMs += dt;
    const target = S.cur.secs*1000;
    const p = S.heldMs/target;
    setFill(p);
    progressUpdate(p);
    const remain = Math.max(0, Math.ceil((target - S.heldMs)/1000));

    if(S.cur.long){
      if(S.hide){
        $("timer").textContent = "•";
        if(remain>=1 && remain<=5 && remain!==S.lastSpokenSec){
          S.lastSpokenSec = remain;
          cmdCount(remain);
        }
      } else {
        $("timer").textContent = remain;   
      }
    } else {
      $("timer").textContent = "";
    }

    if(S.heldMs >= target){
      completeRep();
      return;
    }
    raf = requestAnimationFrame(loop);
  }

  function pressStart(pointerId){
    if(!S || !S.armed) return;
    if(holding) return;
    if(S.goal === "scenario" && S.scenario !== "interval"){
      pressStartStopwatch(pointerId);
      return;
    }
    if(!S.cur) return;
    if(pendingRelease){
      lastTs = 0;
      resumeHeldRelease(loop, pointerId);
      return;
    }
    if(S.waitingStart){
      bootFirstPress();
      setCue("up", S.cur.long ? (S.words.down + " " + T().andHold) : S.words.down, S.subBase);
    }
    clearInterval(reactTimer); reactTimer = 0;
    if(S.subBase) $("subcue").textContent = S.subBase;
    holding = true;
    activePointerId = (pointerId !== undefined) ? pointerId : null;
    applyScreenColor();
    lastTs = 0;
    $("holdBtn").classList.add("holding");
    $("btnLab").textContent = T().holding;
    if(S.sig.vibrate) vibrate(25);  
    if(S.cur.long) cmd("hold");   
    progressStart();               
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
  }

  function pressEnd(pointerId){
    if(!holding) return;
    if(pointerId !== undefined && activePointerId !== null && pointerId !== activePointerId) return;
    if(S && S.goal === "scenario" && S.scenario !== "interval"){
      pressEndStopwatch();
      return;
    }
    releaseHold();
    const graceMs = (S && S.releaseGrace) ? S.releaseGrace : 0;
    if(graceMs > 0 && S && S.cur){
      pendingRelease = true;
      clearTimeout(releaseTimer);
      releaseTimer = setTimeout(()=>{ releaseTimer = 0; pendingRelease = false; finalizeRelease(); }, graceMs);
      return;
    }
    finalizeRelease();
  }

  function finalizeRelease(){
    progressStop();
    $("holdBtn").classList.remove("holding");
    if(!S || !S.cur) return;
    const target = S.cur.secs*1000;
    if(S.heldMs < target){
      const realAttempt = S.heldMs > 150;   // 150ms: below this, treat it as an accidental tap, not a real (penalized) early release
      const penalized = S.penalty && realAttempt;
      if(penalized) applyPenalty();
      if(S.strict){
        S.heldMs = 0;
        S.lastSpokenSec = null;
        S.spokeHold = false;
        setFill(0);
        $("timer").textContent = "";
        $("btnLab").textContent = T().tooEarlyLab;
        S.subBase = penaltyNote(T().tooEarly);
        setCue("up", S.words.down, S.subBase);
        if(penalized) cmdPenaltyThenDown(); else cmd("down");
        startReactionWindow();
      } else {
        $("btnLab").textContent = T().pressHold;
        if(penalized){
          setCue("up", T().continueWord, penaltyNote(T().tooEarly));
          cmdPenalty();
        }
      }
    }
  }

  function applyPenalty(){
    if(!S) return;
    if(S.goal==="time" || (S.scenario === "interval" && S.iv_phaseMode === "time")){
      S.endAt += S.penaltyX*1000;
    } else if(S.totalReps != null){
      S.totalReps += S.penaltyX;
      $("repTotal").textContent = S.totalReps;
    }
  }

  function penaltyNote(base){
    if(!S || !S.penalty) return base;
    const isTimed = S.goal==="time" || (S.scenario === "interval" && S.iv_phaseMode === "time");
    const unit = isTimed ? `+${S.penaltyX}s` : `+${S.penaltyX} reps`;
    return base + " · " + unit;
  }

  function completeRep(){
    holding = false;
    applyScreenColor();
    pendingRelease = false; clearTimeout(releaseTimer); releaseTimer = 0;
    S.armed = false;
    cancelAnimationFrame(raf);
    clearInterval(reactTimer); reactTimer = 0;
    progressStop();
    $("holdBtn").classList.remove("holding");
    setFill(1);
    const heldSec = Math.round((S.heldMs || 0)/1000);
    if(heldSec > S.longestHold) S.longestHold = heldSec;
    if(heldSec > (S.pr || 0) && !S.prBeaten && S.prAnnounce){
      S.prBeaten = true;
      say(T().newRecord(heldSec));
    }
    S.done++;
    if(S.scenario === "interval") S.iv_totalDone = (S.iv_totalDone||0) + 1;   // S.done is per-phase for interval (reset in ivAdvancePhase()); this tracks the true cross-phase total
    S.holdSec = (S.holdSec || 0) + heldSec;
    setCue("down", S.words.up, T().release);
    cmd("up");
    $("btnLab").textContent = T().pressHold;
    setTimeout(()=>{ if(S) nextRep(false); }, 650);   // 650ms: lets the release cue land before the rest countdown starts
  }

  // Shared teardown for both finish() (natural session end — recorded) and
  // stopSession() (manual Stop — never recorded, see § Known Issues history
  // in ARCHITECTURE.md for why that distinction matters).
  function teardownSessionTimers(){
    cancelAnimationFrame(raf);
    clearInterval(restTimer);
    clearInterval(reactTimer); reactTimer = 0;
    clearInterval(clockTimer); clockTimer = 0;
    clearInterval(swRestTimer); swRestTimer = 0;
    clearTimeout(releaseTimer); releaseTimer = 0; pendingRelease = false;
    if (S && S.sd_timer) clearInterval(S.sd_timer);
    if (S && S.rr_timer) clearInterval(S.rr_timer);

    if(S && S.iv_savedCurves){
      curves.hold = S.iv_savedCurves.hold.slice();
      curves.rest = S.iv_savedCurves.rest.slice();
      curveMode.hold = S.iv_savedCurves.modeHold;
      curveMode.rest = S.iv_savedCurves.modeRest;
    }

    progressStop();
    $("swStats").classList.add("hidden");
    $("livesRow").classList.add("hidden");
    $("screenColorLayer").classList.add("hidden");
    $("screenColorLayer").classList.remove("green","yellow","red");
    $("screenColorBorderLayer").classList.add("hidden");
    $("screenColorBorderLayer").classList.remove("green","yellow","red");
    curScreenColorState = null;
  }

  function finish(){
    teardownSessionTimers();
    const total = S ? (S.scenario === "interval" ? (S.iv_totalDone||0) : S.done) : 0;
    const elapsedSec = (S && S.startTime) ? Math.round((Date.now()-S.startTime)/1000) : 0;
    $("doneNum").textContent = total;
    if (S && S.scenarioFailMsg) {
        $("doneMsg").textContent = S.scenarioFailMsg;
    } else {
        $("doneMsg").textContent = (total===1 ? T().rep : (T().rep + "s")) + " · " + fmtTime(elapsedSec);
    }
    
    cmdFinish();
    let gameResult = null;
    if(S && S.startTime){
      addHistory({
        at: Date.now(),
        goal: S.goal,
        reps: total,
        elapsed: elapsedSec,
        holdSec: S.holdSec || 0,
        longestHold: S.longestHold || 0,
      });
      if((S.longestHold||0) > getPR()) setPR(S.longestHold);
      let sdActionSec = 0;
      if(S.scenario === "sd_speed"){
        sdActionSec = (S.sd_actionMsAcc || 0) / 1000;
        // add the in-progress action phase (if finishing mid-action)
        if(S.sd_phase === "action" && S.sd_phaseEndTs){
          const actionMs = S.sd_actionMs || 60000;
          const remain = Math.max(0, S.sd_phaseEndTs - Date.now());
          sdActionSec += Math.max(0, actionMs - remain) / 1000;
        }
      }
      gameResult = commitGameSession({
        goal: S.goal, scenario: S.scenario,
        holdSec: S.holdSec || 0, reps: total, elapsedSec: elapsedSec,
        actionSec: sdActionSec,
        swLongest: S.swLongest || 0,
        sdRounds: (S.scenario === "sd_hold") ? (S.done || 0) : 0,
        sdSpeedBest: S.sd_prevPhaseReps || 0,
        mixedRounds: S.sd_mixedRounds || 0,
        taScore: S.taScore || 0,
        rrBpm: Math.round(S.rr_bpm || 0)
      });
      renderStats();
    }
    renderFinishGame(gameResult);
    releaseWake(); disableGuard(); setTapSurface(false); camDetach();
    show("finish");
    S = null;
  }

  // Manual Stop — for reps/time AND scenario sessions alike. Never records to
  // history/gamification; a session only counts if it ends naturally via
  // finish() (goal met / game over). See ARCHITECTURE.md § Known Issues for
  // why this distinction was made explicit rather than left inconsistent.
  function stopSession(){
    teardownSessionTimers();
    if(synth){ try{ synth.cancel(); }catch(e){} }
    releaseWake(); disableGuard(); setTapSurface(false);
    camDetach();
    holding = false;
    S = null;
    show("setup");
  }

  // ================= camera control (ROI change detection + hysteresis) =====
  const cam = {
    stream:null, video:null, running:false, raf:0, mode:"idle",
    roi:{x:0.35,y:0.35,w:0.30,h:0.30},
    ref:null, aw:48, ah:48, actx:null,
    pressThr:25, releaseThr:10, pixelDelta:25,
    pressed:false, lastPct:0,
    facing:"user", adapt:true,
    measuring:false, measMax:0, measEnd:0
  };
  // CAM_ADAPT_ALPHA: exponential-smoothing rate for the drifting reference frame
  // (§ 6 in ARCHITECTURE.md) — small and tuned by feel so slow lighting changes
  // are absorbed without the reference chasing an actual press.
  const CAMK = "lat.cam", CAM_ONBOARD_KEY = "lat.camOnboarded", CAM_ADAPT_ALPHA = 0.03;
  function camSupported(){ return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia); }
  function camEnabled(){ const el=$("cameraControl"); return !!(el && el.checked); }
  function loadCamCfg(){
    const c = KV.get(CAMK, null); if(!c) return;
    if(c.roi && typeof c.roi.x==="number") cam.roi = { x:c.roi.x, y:c.roi.y, w:c.roi.w, h:c.roi.h };
    if(typeof c.pressThr==="number") cam.pressThr = c.pressThr;
    if(typeof c.releaseThr==="number") cam.releaseThr = c.releaseThr;
    if(c.facing==="user"||c.facing==="environment") cam.facing = c.facing;
    if(typeof c.adapt==="boolean") cam.adapt = c.adapt;
  }
  function saveCamCfg(){ KV.set(CAMK, { roi:cam.roi, pressThr:cam.pressThr, releaseThr:cam.releaseThr, facing:cam.facing, adapt:cam.adapt }); }
  function camGetVideo(){
    if(!cam.video){
      const v = document.createElement("video");
      v.setAttribute("playsinline",""); v.muted = true; v.autoplay = true;
      cam.video = v;
    }
    return cam.video;
  }
  function camMoveVideoTo(host){ const v=camGetVideo(); if(host && v.parentNode!==host) host.insertBefore(v, host.firstChild); }
  function camEnsureCanvas(){
    if(!cam.actx){ const c=document.createElement("canvas"); c.width=cam.aw; c.height=cam.ah; cam.actx=c.getContext("2d",{willReadFrequently:true}); }
  }
  // source rect inside the (horizontally mirrored) preview
  function camSrcRect(vw,vh){
    return { sx:(1-cam.roi.x-cam.roi.w)*vw, sy:cam.roi.y*vh, sw:cam.roi.w*vw, sh:cam.roi.h*vh };
  }
  function camSampleGray(){
    const v=cam.video; if(!v||!v.videoWidth||!cam.actx) return null;
    const r=camSrcRect(v.videoWidth, v.videoHeight);
    if(r.sw<2||r.sh<2) return null;
    try{ cam.actx.drawImage(v, r.sx,r.sy,r.sw,r.sh, 0,0, cam.aw,cam.ah); }catch(e){ return null; }
    let d; try{ d=cam.actx.getImageData(0,0,cam.aw,cam.ah).data; }catch(e){ return null; }
    const n=cam.aw*cam.ah, g=new Float32Array(n);
    for(let i=0;i<n;i++) g[i]=d[i*4]*0.299+d[i*4+1]*0.587+d[i*4+2]*0.114;
    return g;
  }
  function camChangeFrom(g){
    const r=cam.ref, n=g.length; let changed=0;
    for(let i=0;i<n;i++) if(Math.abs(g[i]-r[i])>cam.pixelDelta) changed++;
    return changed/n*100;
  }
  function camCalibrate(){
    const g=camSampleGray(); if(!g) return;
    cam.ref=g; cam.pressed=false; cam.measuring=false; saveCamCfg();
  }
  // Auto: set reference, then measure the idle noise floor for ~1.6s and
  // derive sensible release/press thresholds from it.
  function camAutoCalibrate(){
    const g=camSampleGray(); if(!g) return;
    cam.ref=g; cam.pressed=false;
    cam.measuring=true; cam.measMax=0; cam.measEnd=Date.now()+1600;
  }
  function camFinishAuto(){
    cam.measuring=false;
    let rel = Math.max(3, Math.min(40, Math.round(cam.measMax)+4));
    let press = Math.max(rel+3, Math.min(90, Math.round(rel*2)+6));
    cam.releaseThr=rel; cam.pressThr=press;
    const rt=$("camRelThr"), pt=$("camPressThr");
    if(rt) rt.value=rel; if(pt) pt.value=press;
    const rv=$("camRelVal"), pv=$("camPressVal");
    if(rv) rv.textContent=rel; if(pv) pv.textContent=press;
    updateCamMarks(); saveCamCfg();
  }
  function camOnPress(){ if(cam.mode==="session"){ try{ pressStart(); }catch(e){} } }
  function camOnRelease(){ if(cam.mode==="session"){ try{ pressEnd(); }catch(e){} } }
  function startCamLoop(){
    if(cam.running) return; cam.running=true;
    const tick=()=>{
      if(!cam.running) return;
      const g = camSampleGray();
      let pct = cam.lastPct||0;
      if(g){
        pct = cam.ref ? camChangeFrom(g) : 0;
        cam.lastPct = pct;
        if(cam.ref){
          if(!cam.pressed && pct>=cam.pressThr){ cam.pressed=true; camOnPress(); }
          else if(cam.pressed && pct<=cam.releaseThr){ cam.pressed=false; camOnRelease(); }
        }
        // sliding reference: slowly absorb gradual light drift while released
        // (frozen while pressed so the trigger isn't lost; paused during measuring)
        if(cam.adapt && cam.ref && !cam.pressed && !cam.measuring){
          const r=cam.ref, n=r.length;
          for(let i=0;i<n;i++) r[i]+=(g[i]-r[i])*CAM_ADAPT_ALPHA;
        }
        if(cam.measuring){
          if(pct>cam.measMax) cam.measMax=pct;
          if(Date.now()>=cam.measEnd) camFinishAuto();
        }
      }
      camRender(pct);
      cam.raf=requestAnimationFrame(tick);
    };
    cam.raf=requestAnimationFrame(tick);
  }
  function stopCamLoop(){ cam.running=false; if(cam.raf) cancelAnimationFrame(cam.raf); cam.raf=0; }
  function camRender(pct){
    const p=Math.max(0,Math.min(100,pct));
    const fill=$("camBarFill"); if(fill) fill.style.width=p+"%";
    const pctEl=$("camPct"); if(pctEl) pctEl.textContent=Math.round(p)+"%";
    const st=$("camState");
    if(st){
      if(cam.measuring){ st.textContent=T().camMeasuring; st.className="camState"; }
      else if(!cam.ref){ st.textContent=T().camStateCalib; st.className="camState"; }
      else if(cam.pressed){ st.textContent=T().camStatePressed; st.className="camState pressed"; }
      else { st.textContent=T().camStateReleased; st.className="camState released"; }
    }
    const roi=$("camRoi"); if(roi) roi.classList.toggle("pressed", cam.pressed);
    const pip=$("camPip");
    if(pip && !pip.classList.contains("hidden")){
      pip.classList.toggle("pressed", cam.pressed);
      const pf=$("camPipFill"); if(pf) pf.style.width=p+"%";
    }
  }
  function positionRoiBox(){
    const set=(el)=>{ if(!el) return; el.style.left=(cam.roi.x*100)+"%"; el.style.top=(cam.roi.y*100)+"%"; el.style.width=(cam.roi.w*100)+"%"; el.style.height=(cam.roi.h*100)+"%"; };
    set($("camRoi")); set($("camPipRoi"));
  }
  function updateCamMarks(){
    const mr=$("camMarkRel"), mp=$("camMarkPress");
    if(mr) mr.style.left=cam.releaseThr+"%";
    if(mp) mp.style.left=cam.pressThr+"%";
  }
  function camConstraints(){ return { video:{ facingMode:cam.facing, width:{ideal:640}, height:{ideal:480} }, audio:false }; }
  async function camAcquire(){
    let stream;
    try{ stream=await navigator.mediaDevices.getUserMedia(camConstraints()); }
    catch(e){ try{ stream=await navigator.mediaDevices.getUserMedia({ video:true, audio:false }); }catch(e2){ return null; } }
    return stream;
  }
  // No stream-loss detection existed before this: if the camera track died
  // mid-session (permission revoked, device unplugged, tab backgrounded and
  // reclaimed by the OS), the gesture detector just silently stopped updating
  // with no user-facing error and no fallback. Watch every acquired track and
  // react once, guarding against the listener firing after we ourselves
  // already replaced/stopped the stream (e.g. camFlip()'s intentional restart).
  function camWatchStreamTracks(stream){
    stream.getTracks().forEach(track=>{
      track.onended = ()=>{ if(cam.stream === stream) camHandleStreamLoss(); };
    });
  }
  function camHandleStreamLoss(){
    if(cam.mode === "session"){
      if(holding) pressEnd();   // don't leave a hold stuck open with a dead input source
      camDetach();
      $("subcue").textContent = T().camStreamLost;
    } else if(cam.mode === "setup"){
      $("camErr").textContent = T().camStreamLost;
    }
  }
  async function camOpenSetup(){
    const open=()=>{ const o=$("camOverlay"); o.classList.remove("hidden"); o.setAttribute("aria-hidden","false"); };
    $("camErr").textContent="";
    camEnsureCanvas(); loadCamCfg();
    if(!camSupported()){ open(); $("camErr").textContent=T().camNotSupported; return; }
    const stream = await camAcquire();
    if(!stream){ open(); $("camErr").textContent=T().camNoAccess; return; }
    cam.stream=stream; camWatchStreamTracks(stream);
    cam.ref=null; cam.pressed=false; cam.measuring=false; cam.mode="setup";
    const v=camGetVideo(); v.srcObject=stream;
    camMoveVideoTo($("camStage"));
    try{ await v.play(); }catch(e){}
    $("camRelThr").value=cam.releaseThr; $("camPressThr").value=cam.pressThr;
    $("camRelVal").textContent=cam.releaseThr; $("camPressVal").textContent=cam.pressThr;
    const ad=$("camAdapt"); if(ad) ad.checked=cam.adapt;
    positionRoiBox(); updateCamMarks();
    open(); startCamLoop();
  }
  async function camRestartStream(){
    if(cam.stream){ try{ cam.stream.getTracks().forEach(t=>t.stop()); }catch(e){} cam.stream=null; }
    const stream = await camAcquire();
    if(!stream){ $("camErr").textContent=T().camNoAccess; return; }
    cam.stream=stream; camWatchStreamTracks(stream); const v=camGetVideo(); v.srcObject=stream;
    try{ await v.play(); }catch(e){}
    cam.ref=null; cam.pressed=false; cam.measuring=false;   // recalibrate after switching camera
  }
  function camFlip(){ cam.facing = (cam.facing==="user")?"environment":"user"; saveCamCfg(); camRestartStream(); }
  function maybeShowCamIntro(){
    if(KV.get(CAM_ONBOARD_KEY, false)) return;
    const el=$("camIntro"); if(!el) return;
    el.classList.remove("hidden"); el.setAttribute("aria-hidden","false");
  }
  function dismissCamIntro(){
    const el=$("camIntro"); if(el){ el.classList.add("hidden"); el.setAttribute("aria-hidden","true"); }
    KV.set(CAM_ONBOARD_KEY, true);
  }
  function closeCamOverlay(){ const o=$("camOverlay"); o.classList.add("hidden"); o.setAttribute("aria-hidden","true"); }
  function camStopStream(){
    if(cam.stream){ try{ cam.stream.getTracks().forEach(t=>t.stop()); }catch(e){} cam.stream=null; }
    if(cam.video){ try{ cam.video.srcObject=null; }catch(e){} }
  }
  function camCancelSetup(){ stopCamLoop(); camStopStream(); closeCamOverlay(); cam.mode="idle"; }
  function camDetach(){
    if(cam.mode!=="session") return;
    stopCamLoop(); camStopStream();
    const pip=$("camPip"); if(pip){ pip.classList.add("hidden"); pip.classList.remove("pressed"); }
    cam.mode="idle"; cam.pressed=false;
  }
  function camConfirmStart(){
    if(!cam.ref){ $("camErr").textContent=T().camCalibrateFirst; return; }
    if(cam.pressThr<=cam.releaseThr){ $("camErr").textContent=T().camThrOrder; return; }
    $("camErr").textContent=""; cam.mode="session";
    closeCamOverlay();
    camMoveVideoTo($("camPipHost")); positionRoiBox();
    $("camPip").classList.remove("hidden");
    startSession();
  }
  (function wireCamera(){
    const calib=$("camCalibrate"); if(calib) calib.addEventListener("click", camCalibrate);
    const auto=$("camAuto"); if(auto) auto.addEventListener("click", camAutoCalibrate);
    const flip=$("camFlip"); if(flip) flip.addEventListener("click", camFlip);
    const adapt=$("camAdapt"); if(adapt) adapt.addEventListener("change", ()=>{ cam.adapt=adapt.checked; saveCamCfg(); });
    const camToggle=$("cameraControl"); if(camToggle) camToggle.addEventListener("change", ()=>{ if(camToggle.checked) maybeShowCamIntro(); });
    const introOk=$("camIntroOk"); if(introOk) introOk.addEventListener("click", dismissCamIntro);
    const rel=$("camRelThr");
    if(rel) rel.addEventListener("input", ()=>{ cam.releaseThr=+rel.value; if(cam.releaseThr>=cam.pressThr){ cam.pressThr=Math.min(95,cam.releaseThr+1); $("camPressThr").value=cam.pressThr; $("camPressVal").textContent=cam.pressThr; } $("camRelVal").textContent=cam.releaseThr; updateCamMarks(); saveCamCfg(); });
    const pr=$("camPressThr");
    if(pr) pr.addEventListener("input", ()=>{ cam.pressThr=+pr.value; if(cam.pressThr<=cam.releaseThr){ cam.releaseThr=Math.max(1,cam.pressThr-1); $("camRelThr").value=cam.releaseThr; $("camRelVal").textContent=cam.releaseThr; } $("camPressVal").textContent=cam.pressThr; updateCamMarks(); saveCamCfg(); });
    const cancel=$("camCancel"); if(cancel) cancel.addEventListener("click", camCancelSetup);
    const start=$("camStart"); if(start) start.addEventListener("click", camConfirmStart);
    // ROI drag / resize
    const stage=$("camStage"), box=$("camRoi"), handle=$("camRoiHandle");
    if(stage && box){
      let drag=null; const rect=()=>stage.getBoundingClientRect();
      box.addEventListener("pointerdown", e=>{ if(e.target===handle) return; e.preventDefault(); try{box.setPointerCapture(e.pointerId);}catch(_){} drag={mode:"move",px:e.clientX,py:e.clientY,ox:cam.roi.x,oy:cam.roi.y}; });
      handle.addEventListener("pointerdown", e=>{ e.preventDefault(); e.stopPropagation(); try{handle.setPointerCapture(e.pointerId);}catch(_){} drag={mode:"resize",px:e.clientX,py:e.clientY,ow:cam.roi.w,oh:cam.roi.h}; });
      const move=e=>{ if(!drag) return; const rc=rect(); const dx=(e.clientX-drag.px)/rc.width, dy=(e.clientY-drag.py)/rc.height;
        if(drag.mode==="move"){ cam.roi.x=Math.max(0,Math.min(1-cam.roi.w,drag.ox+dx)); cam.roi.y=Math.max(0,Math.min(1-cam.roi.h,drag.oy+dy)); }
        else { cam.roi.w=Math.max(0.06,Math.min(1-cam.roi.x,drag.ow+dx)); cam.roi.h=Math.max(0.06,Math.min(1-cam.roi.y,drag.oh+dy)); }
        positionRoiBox(); };
      const up=()=>{ if(drag){ drag=null; saveCamCfg(); } };
      box.addEventListener("pointermove", move); handle.addEventListener("pointermove", move);
      box.addEventListener("pointerup", up); handle.addEventListener("pointerup", up);
      box.addEventListener("lostpointercapture", up); handle.addEventListener("lostpointercapture", up);
    }
  })();

  const btn = $("holdBtn");
  btn.addEventListener("pointerdown", e=>{
    e.preventDefault();
    try{ btn.setPointerCapture(e.pointerId); }catch(_){}
    pressStart(e.pointerId);
  });
  btn.addEventListener("pointerup",     e=>{ e.preventDefault(); pressEnd(e.pointerId); });
  btn.addEventListener("pointercancel", e=>{ pressEnd(e.pointerId); });
  btn.addEventListener("lostpointercapture", e=>{ pressEnd(e.pointerId); });
  window.addEventListener("pointerup", e=>{ if(holding && e.pointerId === activePointerId) pressEnd(e.pointerId); });
  btn.addEventListener("contextmenu", e=>e.preventDefault());

  const tap = $("tapSurface");
  tap.addEventListener("pointerdown", e=>{
    e.preventDefault();
    try{ tap.setPointerCapture(e.pointerId); }catch(_){}
    pressStart(e.pointerId);
  });
  tap.addEventListener("pointerup",     e=>{ e.preventDefault(); pressEnd(e.pointerId); });
  tap.addEventListener("pointercancel", e=>{ pressEnd(e.pointerId); });
  tap.addEventListener("lostpointercapture", e=>{ pressEnd(e.pointerId); });
  tap.addEventListener("contextmenu", e=>e.preventDefault());

  let keyHeld = false;
  window.addEventListener("keydown", e=>{
    if($("session").classList.contains("hidden")) return;
    if((e.code==="Space"||e.code==="Enter") && !e.repeat && !keyHeld){
      e.preventDefault(); keyHeld=true; pressStart();
    }
  });
  window.addEventListener("keyup", e=>{
    if((e.code==="Space"||e.code==="Enter") && keyHeld){
      e.preventDefault(); keyHeld=false; pressEnd();
    }
  });
  window.addEventListener("blur", ()=>{ if(keyHeld){ keyHeld=false; pressEnd(); } });

  $("startBtn").addEventListener("click", startSession);
  $("stopBtn").addEventListener("click", ()=>{
    stopSession();   // manual stop never records — applies to reps/time and scenario alike
  });
  $("againBtn").addEventListener("click", ()=>{ show("setup"); });

  $("presetSave").addEventListener("click", ()=>{ presetSave(); updateSummaries(); });
  $("presetLoad").addEventListener("click", ()=>{ presetLoad(); updateSummaries(); });
  $("presetDel").addEventListener("click", ()=>{ presetDel(); updateSummaries(); });
  $("statsClear").addEventListener("click", ()=>{
    if(confirm(T().confirmClearHistory)){
      KV.del(K.history); KV.del(K.pr); KV.del(K.game); renderStats();
    }
  });

  for(const id of SETTING_IDS){
    const el = $(id); if(!el) continue;
    const ev = (el.type==="checkbox" || el.tagName==="SELECT") ? "change" : "input";
    el.addEventListener(ev, debouncedSaveSettings);
  }
  $("goalSeg").addEventListener("click", debouncedSaveSettings);

  (function bootRestore(){
    const savedLang = KV.get("lat.lang", null);
    const browserLang = (navigator.language || "en").slice(0,2).toLowerCase();
    LANG = I18N[savedLang] ? savedLang : (I18N[browserLang] ? browserLang : "en");
    populateLangSelect();
    document.documentElement.setAttribute("lang", LANG);
    document.documentElement.setAttribute("dir", (LANG==="ar"||LANG==="ur") ? "rtl" : "ltr");
    $("appLang").addEventListener("change", e=>{
      const newLang = e.target.value;
      const prev = I18N[LANG] || I18N.en;
      const nx = I18N[newLang] || I18N.en;
      const swap = (id, from, to) => { const el = $(id); if(!el) return; if((el.value||"").trim()===from) el.value = to; };
      swap("cmdDown", prev.cueDown, nx.cueDown);
      swap("cmdUp", prev.cueUp, nx.cueUp);
      swap("cmdHold", prev.cueLong, nx.cueLong);
      swap("cmdPenaltyWord", prev.cuePenalty, nx.cuePenalty);
      swap("cmdFinishWord", prev.cueFinish, nx.cueFinish);
      setLang(newLang);
      saveSettingsNow();
    });

    const saved = KV.get(K.settings, null);
    if(saved) writeAll(saved);
    const lg = I18N[LANG] || I18N.en;
    const seed = (id, val) => { const el = $(id); if(el && !((el.value||"").trim())) el.value = val; };
    seed("cmdDown", lg.cueDown);
    seed("cmdUp", lg.cueUp);
    seed("cmdHold", lg.cueLong);
    seed("cmdPenaltyWord", lg.cuePenalty);
    seed("cmdFinishWord", lg.cueFinish);
    applyRuntimeI18n();

    refreshPresetSelect();
    renderStats();
    loadCurves();
    ["hold","rest"].forEach(which=>{
      const cv = $(which==="hold" ? "curveHold" : "curveRest"); if(!cv) return;
      cv.addEventListener("click", ()=>openCurveEditor(which));
    });
    document.querySelectorAll('.curveOpen').forEach(btn=>{
      btn.addEventListener("click", ()=>openCurveEditor(btn.dataset.curve));
    });
    wireOverlayCanvas();
    document.querySelectorAll('[data-overlay-preset]').forEach(btn=>{
      btn.addEventListener("click", ()=>{
        if(!overlayWhich) return;
        applyPreset(overlayWhich, btn.dataset.overlayPreset);
        drawCurve(overlayWhich, $("curveBig"));
      });
    });
    $("curveOverlayDone").addEventListener("click", closeCurveEditor);
    document.querySelectorAll('#curveOverlay [data-mode]').forEach(btn=>{
      btn.addEventListener("click", ()=>{
        if(!overlayWhich) return;
        curveMode[overlayWhich] = btn.dataset.mode;
        saveCurves();
        refreshCurveOverlayForMode();
        updateSummaries();
      });
    });
    ["minHold","maxHold","minRest","maxRest"].forEach(id=>{
      const el = $(id); if(!el) return;
      el.addEventListener("input", ()=>{ updateCurveAxes(); });
    });
    updateCurveAxes();
    requestAnimationFrame(()=>{ drawCurve("hold"); drawCurve("rest"); });
    window.addEventListener("resize", ()=>{
      drawCurve("hold"); drawCurve("rest");
      if(overlayWhich) drawCurve(overlayWhich, $("curveBig"));
    });
    ["secTiming"].forEach(id=>{
      const d = $(id); if(!d) return;
      d.addEventListener("toggle", ()=>{ if(d.open) requestAnimationFrame(()=>{ drawCurve("hold"); drawCurve("rest"); }); });
    });
    updateSummaries();
  })();

  (function(){
    const vt = $("vibrate"), vh = $("vibrateHint");
    if(!("vibrate" in navigator)){
      if(vh) vh.textContent = T().vibrateUnsupported;
      return;
    }
    vt.addEventListener("change", ()=>{
      if(!vt.checked) return;
      let ok = false;
      try{ ok = navigator.vibrate([120,60,200]); }catch(e){ ok = false; }
      if(vh){
        vh.textContent = ok ? T().vibrateTestTriggered : T().vibrateBlocked;
      }
    });
  })();

  document.addEventListener("selectstart", e=>{ if(S) e.preventDefault(); });
  document.addEventListener("pointerdown", function prime(){
    if(synth){ try{ const u=new SpeechSynthesisUtterance(""); synth.speak(u); synth.cancel(); }catch(e){} }
    const ac = ensureAudio(); if(ac && ac.state==="suspended"){ try{ ac.resume(); }catch(e){} }
    document.removeEventListener("pointerdown", prime);
  }, {once:true});
})();

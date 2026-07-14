// ============================================================
// nl.jsx — NL 에이전트 화면. Render/Link의 '추론 스레드' 리듬 계승:
//   행동(연산 요청 → 완료 + 데이터 카드) → 생각 → 최종(SQL/clarify/불가)
//   → 실행 결과 → 채점 뱃지.
// 좌: 카테고리별 질문 목록(+판정 점) · 스코어보드. 우: 활성 질문의 스레드.
// 로직은 agent-core.js(검증 완료)를 그대로 사용 — 화면은 표현만.
// window.NLScreenV2 으로 노출.
// ============================================================
const { useState: n2UseState, useRef: n2UseRef, useEffect: n2UseEffect } = React;

const N_TV2 = { live: { think: 420, req: 600, done: 520 }, batch: { think: 60, req: 90, done: 80 } };
const VCOLORV2 = { correct: "var(--high)", partial: "var(--med)", wrong: "var(--low)" };
const VLABELV2 = { correct: "정답", partial: "부분", wrong: "오답" };
const CATLV2 = {
  // mock 카테고리
  normal: "정상 경로", family: "충돌 패밀리", granularity: "입도", boundary: "경계 결손", join: "조인",
  // fineract 카테고리 (재료 표적)
  metric: "정본 지표 (metric)",
  join_grain: "조인·grain",
  codedict: "코드값 사전",
  time_format: "시간·형식",
  review: "신뢰도 하향",
  conceptual: "개념 응축 (clarify)",
  analytic: "복합 분석",
  targeted: "표적 (실패 클래스)",
  // 공통
  free: "자유 질의 (탐색)",
};
const monoV2 = { fontFamily: "var(--monoV2)" };
const sleepV2 = (ms) => new Promise((r) => setTimeout(r, ms));
const NL_MARKER_COLORV2 = { "함정":"var(--low)", "경계":"var(--med)", "D8":"var(--sig)",
  "오류":"var(--lin)", "폴백":"var(--accent)", "조인":"var(--high)", "대표":"var(--dim)", "형식":"var(--lin)" };
const NL_MARKER_TIPV2 = {
  "함정": "정본 지표(get_metric)를 쓰지 않으면 숫자가 달라지게 설계된 문항 — 소박한 재계산은 오답",
  "D8":   "질문이 도메인·입도를 특정하지 않음 — 확인 질문 없이 한쪽을 고르면 값이 맞아도 오답",
  "경계": "레이어에 일부러 빠뜨린 정보 앞에서의 행동을 검증 — 지어내면 환각 플래그",
  "오류": "1차 실측에서 에이전트가 실제로 틀린 문항 — 역량 측정 항목으로 보존",
  "폴백": "Term 링크 없음 — search_columns(Description 검색) 폴백만으로 접근 가능, 신뢰도 한정 필수",
  "조인": "FK 경로를 타야 풀리는 문항 — 경로와 grain 처리를 함께 검증",
  "형식": "Description의 값 형식(YYYYMM 등)을 get_column으로 안 보면 0행 — 조회 건너뛰면 반드시 실패",
};
function QuestionRowV2({ q, r, active, busy, onView, onRun }) {
  const [hover, setHover] = n2UseState(false);
  const v = r && r.verdict;
  const done = r && r.status === "done";
  const viewable = r && (r.status === "done" || r.status === "running");  // 실행 중도 진행 트레이스 조회 가능
  const bg = active ? "rgba(255,255,255,0.05)" : (hover ? "rgba(255,255,255,0.025)" : "transparent");
  return (
    <div onClick={() => { if (viewable) onView(); }}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ padding: "4px 8px", borderRadius: 4, cursor: "pointer", transition: "background .12s",
               background: bg, borderLeft: active ? "2px solid var(--accent)" : "2px solid transparent" }}>
      <div style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
        <span style={{ width: 7, height: 7, borderRadius: 7, flexShrink: 0, alignSelf: "center",
                       background: v ? VCOLORV2[v.verdict] : (r && r.status === "running" ? "var(--sig)" : "var(--border)") }} />
        <span style={{ lineHeight: 1.5, flex: 1, minWidth: 0 }}>
          <span style={{ ...monoV2, fontSize: 12, color: "var(--dim)", marginRight: 5 }}>{q.id}</span>
          <span style={{ fontSize: 14.5, color: "var(--text)" }}>{q.text}</span>
          {((q.checkpoint||{}).markers||[]).map((m) => (
            <span key={m} style={{ marginLeft: 5 }}><NLMarkerChipV2 m={m} /></span>))}
        </span>
        {done && r.elapsed_ms != null && (
          <span style={{ ...monoV2, fontSize: 11.5, color: "var(--dim)", flexShrink: 0, alignSelf: "center" }}>
            {(r.elapsed_ms / 1000).toFixed(1)}s</span>)}
        <span onClick={(e) => { e.stopPropagation(); onRun(); }}
          title={done ? "다시 실행" : "실행"}
          style={{ ...monoV2, fontSize: 13, flexShrink: 0, alignSelf: "center", padding: "1px 6px", borderRadius: 4,
                   cursor: busy ? "default" : "pointer",
                   opacity: busy ? 0.3 : (hover ? 1 : 0.55), transition: "opacity .12s",
                   color: done ? "var(--sig)" : "var(--accent)",
                   border: `1px solid ${done ? "var(--sig)" : "var(--accent)"}${hover ? "88" : "44"}` }}>▷</span>
      </div>
      {v && v.flags.length > 0 && (
        <div style={{ ...monoV2, fontSize: 11, color: "var(--low)", paddingLeft: 14, marginTop: 2 }}>{v.flags.join(" · ")}</div>)}
    </div>);
}
function NLMarkerChipV2({ m }) {
  const [pos, setPos] = n2UseState(null);  // null=숨김, {x,y,placement}
  const ref = n2UseRef(null);
  const tip = NL_MARKER_TIPV2[m.split(":")[0]] || null;
  const color = NL_MARKER_COLORV2[m.split(":")[0]] || "var(--dim)";
  const W = 260;
  const show = () => {
    if (!tip || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const above = r.top > 120;  // 위 공간 충분하면 위, 아니면 아래
    // 좌우: 칩 중앙 기준, 뷰포트 8px 여백으로 클램프
    let cx = r.left + r.width / 2;
    cx = Math.max(8 + W / 2, Math.min(window.innerWidth - 8 - W / 2, cx));
    setPos({ x: cx, y: above ? r.top - 6 : r.bottom + 6, placement: above ? "above" : "below" });
  };
  return (
    <span ref={ref} style={{ display: "inline-block", flexShrink: 0 }}
      onMouseEnter={show} onMouseLeave={() => setPos(null)}>
      <span style={{ ...monoV2, fontSize: 11, color,
        border: `1px solid ${color}55`, borderRadius: 3, padding: "0px 4px" }}>{m}</span>
      {pos && tip && (
        <span style={{ position: "fixed", left: pos.x, top: pos.y,
                       transform: `translateX(-50%) ${pos.placement === "above" ? "translateY(-100%)" : ""}`,
                       zIndex: 9999, background: "#13161b", border: "1px solid var(--border)",
                       borderRadius: 5, padding: "7px 11px", width: W,
                       boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
                       pointerEvents: "none", whiteSpace: "normal" }}>
          <span style={{ ...monoV2, fontSize: 12, color, display: "block", marginBottom: 3 }}>{m}</span>
          <span style={{ fontSize: 14, color: "var(--muted)", lineHeight: 1.6 }}>{tip}</span>
        </span>)}
    </span>);
}

function NLScreenV2() {
  const [ready, setReady] = n2UseState(null);     // null=로딩, 'ok', 'err:...'
  const [results, setResults] = n2UseState({});   // qid → {status, events, final, verdict, execRows}
  const [active, setActive] = n2UseState(null);
  const [busy, setBusy] = n2UseState(false);           // 하나라도 실행 중이면 true (전체 실행 버튼 비활성용)
  const runningCountRef = n2UseRef(0);                  // 동시 실행 개수 - 여러 문항 병렬 실행 지원
  const runAllRef = n2UseRef(false);                    // runAll 자체의 이중 진입만 차단
  const [note, setNote] = n2UseState(null);
  const [selfCheck, setSelfCheck] = n2UseState(null);
  const dbRef = n2UseRef(null);
  const abortRef = n2UseRef(false);
  const followRef = n2UseRef(true);  // 전체 실행 중 진행 문항 자동 추적 (사용자 수동 선택 시 false)
  const runningRef = n2UseRef(null);  // 현재 실행 중 문항 id
  const isFree = window.Dataset.isFree();
  const [freeQs, setFreeQs] = n2UseState([]);   // fineract 자유 질의 목록 (골든셋과 병존)
  const [analystMode, setAnalystMode] = n2UseState(false);  // 실험: 분석 계약(agent-analyst-v0)으로 실행
  const [freeInput, setFreeInput] = n2UseState("");
  const goldens = window.Dataset.questions();
  const Q = isFree ? [...goldens, ...freeQs] : goldens;

  n2UseEffect(() => { (async () => {
    try {
      if (window.LiveAPI.ready) await window.LiveAPI.ready;
      const dbKey = "__DB_" + window.Dataset.get();
      if (window[dbKey]) { dbRef.current = window[dbKey]; }
      else {
        const SQL = await initSqlJs({ locateFile: (f) => "data/" + f });
        const buf = await (await fetch(window.Dataset.dbPath())).arrayBuffer();
        dbRef.current = new SQL.Database(new Uint8Array(buf));
        window[dbKey] = dbRef.current;
        window[dbKey + "_buf"] = buf;  // 워커 초기화용 원본 버퍼
      }
      // 에이전트 try_sql은 워커 스레드에서 실행 — 무거운 쿼리가 UI를 얼리지 않게.
      // 채점·탐색기는 메인 dbRef 유지 (호출 빈도 낮음).
      const wKey = "__DBW_" + window.Dataset.get();
      if (!window[wKey]) {
        const w = new Worker("js/db-worker.js?v=" + Date.now());
        const pending = new Map(); let seq = 0;
        w.onmessage = (ev) => { const p = pending.get(ev.data.id); if (p) { pending.delete(ev.data.id); p(ev.data); } };
        const wcall = (type, payload) => new Promise((res) => { const id = ++seq; pending.set(id, res); w.postMessage({ id, type, ...payload }); });
        const buf = window[dbKey + "_buf"] || (await (await fetch(window.Dataset.dbPath())).arrayBuffer());
        const initR = await wcall("init", { buf: buf.slice(0) });
        if (!initR.ok) throw new Error("워커 DB 초기화 실패: " + initR.error);
        window[wKey] = {
          exec: async (sql) => {
            const r = await wcall("exec", { sql });
            if (!r.ok) { const e = new Error(r.error); throw e; }
            return r.result;
          }
        };
      }
      window.LayerOpsV2.init(window.Dataset.layer(), (sql) => window[wKey].exec(sql));
      if (window.Scorer.setCodeDict) window.Scorer.setCodeDict(window.Dataset.layer().codedict);
      setReady("ok");
    } catch (e) { setReady("err: " + (e.message || e)); }
  })(); }, []);

  const setRes = (id, patch) => setResults((p) => ({ ...p, [id]: { ...(p[id] || {}), ...patch } }));

  async function runOne(q, live) {
    // 동시 실행 허용 (사용자가 여러 문항 클릭 가능) — 브라우저 정지 근본 원인들
    // (프로토콜 루프·카티전 조인)은 이미 자동 실측 대행·카티전 가드로 해소됨.
    runningCountRef.current++;
    setBusy(true);
    const T = live ? N_TV2.live : N_TV2.batch;
    const t0 = performance.now();
    if (live) runningRef.current = q.id;
    if (live || followRef.current) setActive(q.id);  // 단건은 항상, 전체 실행 중엔 추적 켜진 경우만
    setRes(q.id, { status: "running", events: [], final: null, verdict: null, execRows: null });
    const events = [];
    const push = (e) => { events.push(e); setRes(q.id, { events: [...events] }); };

    const onEvent = async (e) => {
      if (e.type === "think") { push({ k: "think", text: e.text }); await sleepV2(T.think); }
      else if (e.type === "op_request") { push({ k: "op", op: e.op, args: e.args, status: "req" }); await sleepV2(T.req); }
      else if (e.type === "op_done") {
        const i = events.findLastIndex((x) => x.k === "op" && x.status === "req");
        if (i >= 0) { events[i] = { ...events[i], status: "done", result: e.result }; setRes(q.id, { events: [...events] }); }
        await sleepV2(T.done);
      }
      else if (e.type === "note") push({ k: "note", text: e.text });
    };

    // 실험: 분석 계약(agent-analyst-v0) — 자유 질의 전용, 기존 v2 계약 무접촉
    const runner = q.mode === "analyst" ? window.AgentAnalystV0.run : window.AgentCoreV2.runAgentV2;
    const out = await runner({
      question: q.text,
      complete: (s, u) => window.LiveAPI.complete(s, u, { onRetry: (a, d) => setNote(`재시도 ${a}회…`),
                                                          maxTokens: q.mode === "analyst" ? 6000 : undefined }),
      layerCall: window.LayerOpsV2.call,
      catalogMap: window.LayerOpsV2.buildMap(),
      onEvent,
    });
    setNote(null);

    // 최종 액션 카드 + (sql이면) 실행
    let execRows = null, execErr = null;
    if (out.final.action === "sql" && out.final.sql) {
      try { execRows = await window.Scorer.runSql(dbRef.current, out.final.sql); }
      catch (e) { execErr = String(e.message || e); }
    }
    // 채점 SQL도 워커에서 - 무거운 골든(다중 조인 집계)이 메인을 점유해
    // 동시 실행 시 UI가 멈추던 문제 해소. dbRef는 탐색기 등 저빈도 경로만.
    const wExec = window["__DBW_" + window.Dataset.get()];
    const verdict = q.golden
      ? await window.Scorer.score(wExec ? wExec.exec : dbRef.current, q, out.final, { ops: out.opsTrace })
      : { id: q.id, cat: q.cat || "free", verdict: "n/a", flags: [], detail: "골든 없음 (탐색 실행)", ops_recall: null, n_ops: out.opsTrace.length };
    push({ k: "final", out: out.final, execRows, execErr });
    push({ k: "verdict", v: verdict });
    const elapsed_ms = Math.round(performance.now() - t0);
    setRes(q.id, { status: "done", final: out.final, verdict, execRows, execErr, opsTrace: out.opsTrace, elapsed_ms, turns: out.turns });
    runningCountRef.current = Math.max(0, runningCountRef.current - 1);
    if (runningCountRef.current === 0) { setBusy(false); runningRef.current = null; }
  }

  async function runAll() {
    if (runAllRef.current) return;
    runAllRef.current = true;
    abortRef.current = false; followRef.current = true;
    for (const q of Q) {
      if (abortRef.current) break;
      const ex = results[q.id];
      if (ex && ex.status === "done") continue;
      try { await runOne(q, false); } catch (e) { setRes(q.id, { status: "done", verdict: { verdict: "wrong", flags: [], detail: "실행 오류: " + e, cat: q.cat, ops_recall: 0, n_ops: 0 } }); }
    }
    followRef.current = true; runAllRef.current = false;
  }

  async function harnessSelfCheck() {
    // oracle 재생 — 브라우저에서도 채점기 100%인지 (node 검증의 현장 재확인)
    let ok = 0;
    for (const q of Q) {
      let out;
      if (q.mode === "sql") out = { action: "sql", sql: q.golden.sql, assumptions: [], confidence: "HIGH" };
      else if (q.mode === "clarify") out = { action: "clarify", clarify_question: "?" };
      else out = q.id === "B03" && q.golden.world_truth
        ? { action: "sql", sql: q.golden.world_truth.sql, assumptions: ["폴백"], confidence: "MEDIUM" }
        : { action: "cannot_answer", reason: "근거 없음" };
      const r = await window.Scorer.score(dbRef.current, q, out, { ops: (q.expected_ops || []).map((op) => ({ op, hit: true })) });
      if (r.verdict === "correct") ok++;
    }
    setSelfCheck(`oracle ${ok}/${Q.length}` + (ok === Q.length ? " ✓" : " ✗ 하니스 점검 필요"));
  }

  function downloadResults() {
    const lines = Q.filter((q) => results[q.id] && results[q.id].verdict)
      .map((q) => JSON.stringify({ id: q.id, text: q.text, ...results[q.id].verdict,
        final: results[q.id].final, ops: (results[q.id].opsTrace || []).map((o) => o.op) }));
    const blob = new Blob([lines.join("\n")], { type: "application/jsonl" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "nl-eval-results.jsonl"; a.click();
  }

  // ---- 스냅샷 저장 ----
  function saveSnapshot() {
    const snap = {
      version: 1,
      model: window.LiveAPI.getModel(),
      prompt_id: "agent_v2",
      created: new Date().toISOString(),
      results: Object.fromEntries(
        Q.filter((q) => results[q.id] && results[q.id].events)
          .map((q) => [q.id, {
            events: results[q.id].events,
            final: results[q.id].final,
            verdict: results[q.id].verdict,
            opsTrace: results[q.id].opsTrace || [],
            elapsed_ms: results[q.id].elapsed_ms,
            turns: results[q.id].turns,
          }])
      ),
    };
    const blob = new Blob([JSON.stringify(snap)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = "nl-snapshot.json"; a.click();
  }

  // ---- 스냅샷 불러오기 ----
  function applySnapshot(snap, silent) {
    if (!snap || !snap.version || !snap.results) throw new Error("형식 불일치");
    const loaded = {};
    for (const [id, r] of Object.entries(snap.results)) {
      loaded[id] = { status: "done", events: r.events || [], final: r.final,
                     verdict: r.verdict, opsTrace: r.opsTrace || [] };
    }
    setResults(loaded);
    if (!silent) {
      const cnt = Object.keys(loaded).length;
      const model = snap.model || "알 수 없음";
      const date = snap.created ? snap.created.slice(0, 10) : "날짜 미상";
      setNote(`스냅샷 로드 완료 — ${cnt}문항 · ${model} · ${date}`);
      setTimeout(() => setNote(null), 4000);
    }
  }

  // ---- 집계 ----
  const done = Q.filter((q) => results[q.id] && results[q.id].verdict);
  const agg = done.length ? window.Scorer.aggregate(done.map((q) => results[q.id].verdict)) : null;

  if (ready === null) return <CenterV2>DB·레이어 적재 중…</CenterV2>;
  if (ready !== "ok") return <CenterV2>초기화 실패 — {ready} (http 서버로 실행했는지 확인)</CenterV2>;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "390px 1fr", gap: 0,
                  height: "calc(100vh - 48px)", overflow: "hidden" }}>
      {/* ---- 좌: 제어 + 스코어보드 + 질문 목록 ---- */}
      <div style={{ borderRight: "1px solid var(--border)", padding: "18px 16px", overflowY: "auto" }}>
        <div style={{ ...monoV2, fontSize: 18, fontWeight: 600, marginBottom: 4 }}>NL 에이전트 · 레이어 소비 검증</div>
        <div style={{ fontSize: 14.5, color: "var(--muted)", marginBottom: 14 }}>
          충분히 채워진 시맨틱 레이어가 주어졌을 때, 레이어를 소비하는 에이전트의 로직이 성립하는가
        </div>
                {isFree && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 13.5, color: "var(--muted)", marginBottom: 6 }}>
              Fineract 재료 표적 골든 + 자유 질의 병존. 질문 추가 시 F## ID 부여.
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <input value={freeInput} onChange={(e) => setFreeInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && freeInput.trim() && !busy) {
                  const q = { id: "F" + String(freeQs.length + 1).padStart(2, "0"), cat: "free", text: freeInput.trim(),
                               mode: analystMode ? "analyst" : "free", golden: null, expected_ops: [] };
                  setFreeQs((p) => [...p, q]); setFreeInput("");
                  // 리렌더 후 실행 - Q 배열에 q가 포함된 상태에서 setActive 되도록
                  requestAnimationFrame(() => requestAnimationFrame(() => runOne(q, true)));
                }}}
                placeholder={analystMode ? "분석 목적 입력 후 Enter (예: 지난 분기 대출 실적을 분석해줘)" : "질문 입력 후 Enter (예: 활성 고객이 몇 명이야?)"}
                style={{ flex: 1, padding: "8px 10px", background: "var(--panel)", border: "1px solid var(--border)",
                         borderRadius: 6, color: "var(--text)", fontSize: 14 }} />
              <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13.5, color: analystMode ? "var(--accent)" : "var(--muted)", cursor: "pointer", whiteSpace: "nowrap" }}>
                <input type="checkbox" checked={analystMode} onChange={(e) => setAnalystMode(e.target.checked)} />
                분석 (실험)
              </label>
            </div>
          </div>
        )}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          <BtnV2 on={!busy && Q.length > 0} color="var(--accent)" onClick={runAll}>전체 실행 ({Q.length})</BtnV2>
          <BtnV2 on={busy} color="var(--low)" onClick={() => (abortRef.current = true)}>중단</BtnV2>
          <BtnV2 on={!busy} color="var(--dim)" onClick={harnessSelfCheck}>하니스 자가검증</BtnV2>
          <BtnV2 on={done.length > 0} color="var(--dim)" onClick={downloadResults}>결과 JSONL</BtnV2>
          <BtnV2 on={done.length > 0} color="var(--sig)" onClick={saveSnapshot}>스냅샷 저장</BtnV2>
                    <label style={{ ...monoV2, fontSize: 13, background: "var(--sig)22", color: "var(--sig)",
                          border: "1px solid var(--sig)", borderRadius: 4, padding: "6px 12px", cursor: "pointer" }}>
            📁 파일 로드
            <input type="file" accept=".json" style={{ display: "none" }} onChange={(e) => {
              const f = e.target.files && e.target.files[0];
              if (!f) return;
              const reader = new FileReader();
              reader.onload = (ev) => {
                try {
                  const snap = JSON.parse(ev.target.result);
                  applySnapshot(snap);
                  setNote("스냅샷 로드 완료: " + f.name);
                  setTimeout(() => setNote(null), 3000);
                } catch (err) {
                  setNote("파일 파싱 실패: " + (err.message || err));
                  setTimeout(() => setNote(null), 4000);
                }
                e.target.value = "";
              };
              reader.readAsText(f);
            }} />
          </label>
        </div>
        {selfCheck && <div style={{ ...monoV2, fontSize: 14.5, color: "var(--sig)", marginBottom: 8 }}>{selfCheck}</div>}
        {note && <div style={{ ...monoV2, fontSize: 14, color: "var(--med)", marginBottom: 8 }}>{note}</div>}
        {!window.LiveAPI.hasKey() && <KeyBoxV2 />}

        {agg && <ScoreboardV2 agg={agg} total={done.length} timing={(() => {
          const ts = done.map((q) => (results[q.id] || {}).elapsed_ms).filter((x) => x != null);
          if (!ts.length) return null;
          return { avg: ts.reduce((a, b) => a + b, 0) / ts.length / 1000, max: Math.max(...ts) / 1000 };
        })()} />}

        <div style={{ paddingRight: 4, border: "1px solid var(--border)", borderRadius: 4, padding: "6px 10px" }}>
        {Array.from(new Set(Q.map((q) => q.cat))).sort((a, b) => {
          const O = { normal: 1, family: 2, granularity: 3, boundary: 4, join: 5,
                      metric: 1, join_grain: 2, codedict: 3, time_format: 4, review: 5, conceptual: 6, analytic: 8, targeted: 9, free: 99 };
          return (O[a]||50) - (O[b]||50);
        }).map((cat) => (
          <div key={cat} style={{ marginTop: 14 }}>
            <div style={{ ...monoV2, fontSize: 13, letterSpacing: "0.08em", color: "var(--muted)", marginBottom: 6 }}>
              {CATLV2[cat].toUpperCase()}
            </div>
            {Q.filter((q) => q.cat === cat).map((q) => (
              <QuestionRowV2 key={q.id} q={q} r={results[q.id]} active={active === q.id} busy={busy}
                onView={() => { if (q.id !== runningRef.current) followRef.current = false; setActive(q.id); }}
                onRun={() => { runOne(q, true).catch(() => {
                  runningCountRef.current = Math.max(0, runningCountRef.current - 1);
                  if (runningCountRef.current === 0) setBusy(false);
                }); }} />))}
          </div>
        ))}
        </div>
      </div>

      {/* ---- 우: 트레이스(60%) + 질문 상세(40%) ---- */}
      <div style={{ display: "flex", overflow: "hidden", minHeight: 0 }}>
        <div style={{ flex: "0 0 60%", padding: "20px 24px", overflowY: "auto", borderRight: "1px solid var(--border)" }}>
          {!active && <CenterV2>질문을 클릭하면 단건 실행(라이브), 전체 실행은 좌측 버튼.</CenterV2>}
          {busy && !followRef.current && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, padding: "7px 12px",
                          background: "var(--sig)15", border: "1px solid var(--sig)44", borderRadius: 5 }}>
              <span style={{ ...monoV2, fontSize: 13, color: "var(--sig)" }}>진행 추적 멈춤 — 완료된 문항을 보는 중</span>
              <span onClick={() => { followRef.current = true; if (runningRef.current) setActive(runningRef.current); }} style={{ ...monoV2, fontSize: 13, color: "var(--accent)",
                border: "1px solid var(--accent)66", borderRadius: 4, padding: "2px 9px", cursor: "pointer" }}>최신으로 따라가기</span>
            </div>)}
          {active && Q.find((x) => x.id === active) && <ThreadV2 q={Q.find((x) => x.id === active)} r={results[active]} />}
        </div>
        <div style={{ flex: "0 0 40%", padding: "20px 22px", overflowY: "auto", background: "rgba(0,0,0,0.12)" }}>
          {!active && <CenterV2 style={{ fontSize: 15 }}>질문을 선택하면 상세 정보가 표시됩니다.</CenterV2>}
          {active && Q.find((x) => x.id === active) && window.QDetail && <window.QDetail db={dbRef.current} q={Q.find((x) => x.id === active)} />}
        </div>
      </div>
    </div>
  );
}

// ---- 스레드 ----
// 모델 산출 방어: 문자열이 아닌 값(객체·배열)이 렌더에 들어오면 React가 크래시(#31).
// Haiku가 assumptions/options를 [{interpretation, rationale}] 같은 객체로 낼 때가 있다.
function sf(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(sf).join(" · ");
  if (typeof v === "object") return Object.values(v).map(sf).join(" — ");
  return String(v);
}

function ThreadV2({ q, r }) {
  if (!r) return null;
  return (
    <div style={{ maxWidth: 860 }}>
      <div style={{ ...monoV2, fontSize: 13, color: "var(--muted)" }}>{q.id} · {CATLV2[q.cat]}
        {r.elapsed_ms != null && <span> · {(r.elapsed_ms / 1000).toFixed(1)}s · {r.turns || "?"}턴</span>}</div>
      <div style={{ fontSize: 20.5, fontWeight: 600, margin: "6px 0 18px" }}>{q.text}</div>
      {(r.events || []).map((e, i) => <EventV2 key={i} e={e} q={q} />)}
      {r.status === "running" && <div style={{ ...monoV2, fontSize: 14.5, color: "var(--sig)", animation: "pulse 1s infinite" }}>실행 중…</div>}
    </div>
  );
}

function EventV2({ e, q }) {
  if (e.k === "think")
    return <div style={{ borderLeft: "2px solid var(--med)", padding: "4px 12px", margin: "10px 0", fontSize: 15.5, color: "var(--muted)", fontStyle: "italic" }}>{sf(e.text)}</div>;
  if (e.k === "note")
    return <div style={{ ...monoV2, fontSize: 13, color: "var(--dim)", margin: "6px 0" }}>· {sf(e.text)}</div>;
  if (e.k === "op")
    return (
      <div style={{ border: "1px solid var(--border)", borderLeft: "2px solid var(--sig)", borderRadius: 5, padding: "9px 13px", margin: "10px 0", background: "rgba(0,0,0,0.22)" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
          <span style={{ ...monoV2, fontSize: 15, color: "var(--sig)", fontWeight: 600 }}>{e.op}</span>
          <span style={{ ...monoV2, fontSize: 14, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{JSON.stringify(e.args)}</span>
          <span style={{ flex: 1 }} />
          <span style={{ ...monoV2, fontSize: 12.5, color: e.status === "done" ? "var(--high)" : "var(--med)" }}>{e.status === "done" ? "조회 완료" : "요청 중…"}</span>
        </div>
        {e.result && <pre style={{ ...monoV2, fontSize: 13, color: "var(--text)", whiteSpace: "pre-wrap", margin: "8px 0 0", maxHeight: 150, overflowY: "auto", opacity: 0.85 }}>{JSON.stringify(e.result, null, 1).slice(0, 1200)}</pre>}
      </div>
    );
  if (e.k === "final") return <FinalCardV2 out={e.out} rows={e.execRows} err={e.execErr} />;
  if (e.k === "verdict") return <VerdictCardV2 v={e.v} q={q} />;
  return null;
}

function FinalCardV2({ out, rows, err }) {
  const tone = out.action === "sql" ? "var(--accent)" : out.action === "report" ? "var(--high, var(--accent))" : out.action === "clarify" ? "var(--med)" : "var(--dim)";
  return (
    <div style={{ border: `1px solid ${tone}55`, borderLeft: `2px solid ${tone}`, borderRadius: 5, padding: "11px 14px", margin: "14px 0" }}>
      <div style={{ ...monoV2, fontSize: 13, color: tone, letterSpacing: "0.06em", marginBottom: 7 }}>
        최종 액션 · {out.action.toUpperCase()} {out.confidence ? `· ${out.confidence}` : ""}
      </div>
      {out.action === "sql" && <pre style={{ ...monoV2, fontSize: 15, whiteSpace: "pre-wrap", margin: 0, color: "var(--text)" }}>{out.sql}</pre>}
      {out.action === "clarify" && (<div style={{ fontSize: 16 }}>{sf(out.clarify_question)}
        {(out.options || []).map((o, i) => <span key={i} style={{ ...monoV2, fontSize: 14, border: "1px solid var(--border)", borderRadius: 4, padding: "1px 8px", marginLeft: 7 }}>{sf(o)}</span>)}</div>)}
      {out.action === "cannot_answer" && <div style={{ fontSize: 16, color: "var(--muted)" }}>{sf(out.reason)}</div>}
      {out.action === "report" && (
        <div>
          <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 4 }}>{sf(out.title)}</div>
          {out.basis && <div style={{ ...monoV2, fontSize: 13.5, color: "var(--med)", marginBottom: 10 }}>기준: {sf(out.basis)}</div>}
          {(out.sections || []).map((s, i) => (
            <div key={i} style={{ margin: "10px 0", paddingLeft: 10, borderLeft: "2px solid var(--border)" }}>
              <div style={{ fontSize: 14.5, fontWeight: 600, color: "var(--text)" }}>
                {sf(s.heading)}
                {(out._unverified_sections || []).includes(s.heading) &&
                  <span style={{ ...monoV2, fontSize: 12, color: "var(--low)", marginLeft: 7 }}>미실측</span>}
              </div>
              <div style={{ fontSize: 15, margin: "3px 0" }}>{sf(s.finding)}</div>
              {s.sql && <pre style={{ ...monoV2, fontSize: 12.5, whiteSpace: "pre-wrap", margin: "4px 0 0", color: "var(--dim)" }}>{s.sql}</pre>}
            </div>
          ))}
          {out.summary && <div style={{ fontSize: 15.5, marginTop: 12, padding: "9px 11px", background: "var(--panel)", borderRadius: 5 }}>{sf(out.summary)}</div>}
          {(out.caveats || []).length > 0 &&
            <div style={{ ...monoV2, fontSize: 13.5, color: "var(--med)", marginTop: 8 }}>주의: {sf(out.caveats)}</div>}
        </div>
      )}
      {(out.assumptions || []).length > 0 &&
        <div style={{ ...monoV2, fontSize: 14, color: "var(--med)", marginTop: 7 }}>가정: {sf(out.assumptions)}</div>}
      {err && <div style={{ ...monoV2, fontSize: 14, color: "var(--low)", marginTop: 7 }}>실행 오류: {err}</div>}
      {rows && <ResultTableV2 rows={rows} />}
    </div>
  );
}

function ResultTableV2({ rows }) {
  if (!rows.length) return <div style={{ ...monoV2, fontSize: 14, color: "var(--dim)", marginTop: 8 }}>(0행)</div>;
  const cols = Object.keys(rows[0]); const view = rows.slice(0, 8);
  return (
    <div style={{ marginTop: 9, overflowX: "auto" }}>
      <table style={{ ...monoV2, fontSize: 14, borderCollapse: "collapse" }}>
        <thead><tr>{cols.map((c) => <th key={c} style={{ textAlign: "left", padding: "3px 12px 3px 0", color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{c}</th>)}</tr></thead>
        <tbody>{view.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c} style={{ padding: "3px 12px 3px 0", color: "var(--text)" }}>{String(r[c])}</td>)}</tr>)}</tbody>
      </table>
      {rows.length > 8 && <div style={{ ...monoV2, fontSize: 12.5, color: "var(--dim)", marginTop: 4 }}>… 총 {rows.length}행</div>}
    </div>
  );
}

function VerdictCardV2({ v, q }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "baseline", border: `1px solid ${VCOLORV2[v.verdict]}44`, borderRadius: 5, padding: "9px 14px", margin: "10px 0" }}>
      <span style={{ ...monoV2, fontSize: 15.5, fontWeight: 700, color: VCOLORV2[v.verdict] }}>{VLABELV2[v.verdict]}</span>
      {v.flags.map((f) => <span key={f} style={{ ...monoV2, fontSize: 12.5, color: "var(--low)", border: "1px solid var(--low)55", borderRadius: 4, padding: "1px 7px" }}>{f}</span>)}
      <span style={{ fontSize: 15, color: "var(--muted)" }}>{v.detail}</span>
      <span style={{ flex: 1 }} />
      <span style={{ ...monoV2, fontSize: 12.5, color: "var(--dim)" }}>연산 {v.n_ops}회 · 적절성 {Math.round(v.ops_recall * 100)}%</span>
    </div>
  );
}

function ScoreboardV2({ agg, total, timing }) {
  // 카테고리별 → 전체 합산 (표시 간소화)
  const sum = { correct: 0, partial: 0, wrong: 0, hallucination: 0, tool_miss: 0, n_ops: 0 };
  for (const b of Object.values(agg)) {
    sum.correct += b.correct || 0;
    sum.partial += b.partial || 0;
    sum.wrong += b.wrong || 0;
    sum.hallucination += b.hallucination || 0;
    sum.tool_miss += b.tool_miss || 0;
    sum.n_ops += (b.avg_ops || 0) * (b.n || 0);
  }
  const totalN = Object.values(agg).reduce((s, b) => s + (b.n || 0), 0);
  const avgOps = totalN ? (sum.n_ops / totalN).toFixed(1) : "0.0";
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 5, padding: "10px 12px", marginTop: 6 }}>
      <div style={{ ...monoV2, fontSize: 13, letterSpacing: "0.08em", color: "var(--muted)", marginBottom: 7 }}>스코어보드 · 채점 {total}건</div>
      <div style={{ display: "flex", gap: 10, ...monoV2, fontSize: 14, alignItems: "baseline" }}>
        <span style={{ color: "var(--high)" }}>정답 {sum.correct}</span>
        <span style={{ color: "var(--med)" }}>부분 {sum.partial}</span>
        <span style={{ color: "var(--low)" }}>오답 {sum.wrong}</span>
        {sum.hallucination > 0 && <span style={{ color: "var(--low)" }}>환각 {sum.hallucination}</span>}
        {sum.tool_miss > 0 && <span style={{ color: "var(--dim)" }}>tool-miss {sum.tool_miss}</span>}
        <span style={{ flex: 1 }} />
        <span style={{ color: "var(--dim)" }}>평균 {avgOps}연산</span>
        {timing && <span style={{ color: "var(--dim)" }}>· {timing.avg.toFixed(1)}s/문항 (최대 {timing.max.toFixed(1)}s)</span>}
      </div>
    </div>
  );
}

function KeyBoxV2() {
  const [k, setK] = n2UseState("");
  return (
    <div style={{ border: "1px dashed var(--border)", borderRadius: 5, padding: "8px 10px", marginBottom: 10 }}>
      <div style={{ fontSize: 14, color: "var(--muted)", marginBottom: 5 }}>로컬 실행 — API 키를 넣으면 localStorage에 저장됩니다 (claude.ai 안에서는 불필요)</div>
      <div style={{ display: "flex", gap: 6 }}>
        <input value={k} onChange={(e) => setK(e.target.value)} placeholder="sk-ant-…" type="password"
          style={{ ...monoV2, flex: 1, fontSize: 14, background: "rgba(0,0,0,0.3)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)", padding: "4px 8px" }} />
        <BtnV2 on={k.length > 10} color="var(--accent)" onClick={() => { localStorage.setItem("anthropic_key", k); location.reload(); }}>저장</BtnV2>
      </div>
    </div>
  );
}

function BtnV2({ on, color, onClick, children }) {
  return (
    <button onClick={on ? onClick : undefined} style={{ ...monoV2, fontSize: 14.5, padding: "5px 12px", borderRadius: 4,
      cursor: on ? "pointer" : "default", opacity: on ? 1 : 0.4,
      border: `1px solid ${color}66`, background: color + "18", color }}>{children}</button>
  );
}
function CenterV2({ children }) {
  return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh", color: "var(--muted)", fontSize: 16 }}>{children}</div>;
}

window.NLScreenV2 = NLScreenV2;


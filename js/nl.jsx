// ============================================================
// nl.jsx — NL 에이전트 화면. Render/Link의 '추론 스레드' 리듬 계승:
//   행동(연산 요청 → 완료 + 데이터 카드) → 생각 → 최종(SQL/clarify/불가)
//   → 실행 결과 → 채점 뱃지.
// 좌: 카테고리별 질문 목록(+판정 점) · 스코어보드. 우: 활성 질문의 스레드.
// 로직은 agent-core.js(검증 완료)를 그대로 사용 — 화면은 표현만.
// window.NLScreen 으로 노출.
// ============================================================
const { useState: nUseState, useRef: nUseRef, useEffect: nUseEffect } = React;

const N_T = { live: { think: 420, req: 600, done: 520 }, batch: { think: 60, req: 90, done: 80 } };
const VCOLOR = { correct: "var(--high)", partial: "var(--med)", wrong: "var(--low)" };
const VLABEL = { correct: "정답", partial: "부분", wrong: "오답" };
const CATL = { normal: "정상 경로", family: "충돌 패밀리", granularity: "입도", boundary: "경계 결손", join: "조인" };
const mono = { fontFamily: "var(--mono)" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NL_MARKER_COLOR = { "함정":"var(--low)", "경계":"var(--med)", "D8":"var(--sig)",
  "오류":"var(--lin)", "폴백":"var(--accent)", "조인":"var(--high)", "대표":"var(--dim)" };
const NL_MARKER_TIP = {
  "함정": "정본 지표(get_metric)를 쓰지 않으면 숫자가 달라지게 설계된 문항 — 소박한 재계산은 오답",
  "D8":   "질문이 도메인·입도를 특정하지 않음 — 확인 질문 없이 한쪽을 고르면 값이 맞아도 오답",
  "경계": "레이어에 일부러 빠뜨린 정보 앞에서의 행동을 검증 — 지어내면 환각 플래그",
  "오류": "1차 실측에서 에이전트가 실제로 틀린 문항 — 역량 측정 항목으로 보존",
  "폴백": "Term 링크 없음 — search_columns(Description 검색) 폴백만으로 접근 가능, 신뢰도 한정 필수",
  "조인": "FK 경로를 타야 풀리는 문항 — 경로와 grain 처리를 함께 검증",
};
function NLMarkerChip({ m }) {
  const [show, setShow] = nUseState(false);
  const tip = NL_MARKER_TIP[m.split(":")[0]] || null;
  const color = NL_MARKER_COLOR[m.split(":")[0]] || "var(--dim)";
  return (
    <span style={{ position: "relative", display: "inline-block", flexShrink: 0 }}
      onMouseEnter={() => tip && setShow(true)} onMouseLeave={() => setShow(false)}>
      <span style={{ ...mono, fontSize: 9, color,
        border: `1px solid ${color}55`, borderRadius: 3, padding: "0px 4px" }}>{m}</span>
      {show && tip && (
        <span style={{ position: "absolute", bottom: "calc(100% + 6px)", left: "50%",
                       transform: "translateX(-50%)", zIndex: 100,
                       background: "#13161b", border: "1px solid var(--border)",
                       borderRadius: 5, padding: "7px 11px", width: 260,
                       boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
                       pointerEvents: "none", whiteSpace: "normal" }}>
          <span style={{ ...mono, fontSize: 10, color, display: "block", marginBottom: 3 }}>{m}</span>
          <span style={{ fontSize: 11.5, color: "var(--muted)", lineHeight: 1.6 }}>{tip}</span>
          <span style={{ position: "absolute", bottom: -5, left: "50%",
                         width: 8, height: 8, background: "#13161b",
                         border: "1px solid var(--border)", borderTop: "none", borderLeft: "none",
                         transform: "translateX(-50%) rotate(45deg)" }} />
        </span>)}
    </span>);
}

function NLScreen() {
  const [ready, setReady] = nUseState(null);     // null=로딩, 'ok', 'err:...'
  const [results, setResults] = nUseState({});   // qid → {status, events, final, verdict, execRows}
  const [active, setActive] = nUseState(null);
  const [busy, setBusy] = nUseState(false);
  const [note, setNote] = nUseState(null);
  const [selfCheck, setSelfCheck] = nUseState(null);
  const dbRef = nUseRef(null);
  const abortRef = nUseRef(false);
  const Q = window.QUESTIONS;

  nUseEffect(() => { (async () => {
    try {
      if (window.LiveAPI.ready) await window.LiveAPI.ready;
      if (window.__DB) { dbRef.current = window.__DB; }
      else {
        const SQL = await initSqlJs({ locateFile: (f) => "data/" + f });
        const buf = await (await fetch("data/world.db")).arrayBuffer();
        dbRef.current = new SQL.Database(new Uint8Array(buf));
        window.__DB = dbRef.current;
      }
      window.LayerOps.init(window.LAYER);
      setReady("ok");
    } catch (e) { setReady("err: " + (e.message || e)); }
  })(); }, []);

  const setRes = (id, patch) => setResults((p) => ({ ...p, [id]: { ...(p[id] || {}), ...patch } }));

  async function runOne(q, live) {
    const T = live ? N_T.live : N_T.batch;
    setActive(q.id);
    setRes(q.id, { status: "running", events: [], final: null, verdict: null, execRows: null });
    const events = [];
    const push = (e) => { events.push(e); setRes(q.id, { events: [...events] }); };

    const onEvent = async (e) => {
      if (e.type === "think") { push({ k: "think", text: e.text }); await sleep(T.think); }
      else if (e.type === "op_request") { push({ k: "op", op: e.op, args: e.args, status: "req" }); await sleep(T.req); }
      else if (e.type === "op_done") {
        const i = events.findLastIndex((x) => x.k === "op" && x.status === "req");
        if (i >= 0) { events[i] = { ...events[i], status: "done", result: e.result }; setRes(q.id, { events: [...events] }); }
        await sleep(T.done);
      }
      else if (e.type === "note") push({ k: "note", text: e.text });
    };

    const out = await window.AgentCore.runAgent({
      question: q.text,
      complete: (s, u) => window.LiveAPI.complete(s, u, { onRetry: (a, d) => setNote(`재시도 ${a}회…`) }),
      layerCall: window.LayerOps.call,
      sysPrompt: window.NLData.NL_SYS, userPrompt: window.NLData.userPrompt,
      maxOps: window.NLData.MAX_OPS, onEvent,
    });
    setNote(null);

    // 최종 액션 카드 + (sql이면) 실행
    let execRows = null, execErr = null;
    if (out.final.action === "sql" && out.final.sql) {
      try { execRows = window.Scorer.runSql(dbRef.current, out.final.sql); }
      catch (e) { execErr = String(e.message || e); }
    }
    const verdict = window.Scorer.score(dbRef.current, q, out.final, { ops: out.opsTrace });
    push({ k: "final", out: out.final, execRows, execErr });
    push({ k: "verdict", v: verdict });
    setRes(q.id, { status: "done", final: out.final, verdict, execRows, execErr, opsTrace: out.opsTrace });
  }

  async function runAll() {
    abortRef.current = false; setBusy(true);
    for (const q of Q) {
      if (abortRef.current) break;
      const ex = results[q.id];
      if (ex && ex.status === "done") continue;
      try { await runOne(q, false); } catch (e) { setRes(q.id, { status: "done", verdict: { verdict: "wrong", flags: [], detail: "실행 오류: " + e, cat: q.cat, ops_recall: 0, n_ops: 0 } }); }
    }
    setBusy(false);
  }

  function harnessSelfCheck() {
    // oracle 재생 — 브라우저에서도 채점기 100%인지 (node 검증의 현장 재확인)
    let ok = 0;
    for (const q of Q) {
      let out;
      if (q.mode === "sql") out = { action: "sql", sql: q.golden.sql, assumptions: [], confidence: "HIGH" };
      else if (q.mode === "clarify") out = { action: "clarify", clarify_question: "?" };
      else out = q.id === "B03" && q.golden.world_truth
        ? { action: "sql", sql: q.golden.world_truth.sql, assumptions: ["폴백"], confidence: "MEDIUM" }
        : { action: "cannot_answer", reason: "근거 없음" };
      const r = window.Scorer.score(dbRef.current, q, out, { ops: (q.expected_ops || []).map((op) => ({ op, hit: true })) });
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

  // ---- 집계 ----
  const done = Q.filter((q) => results[q.id] && results[q.id].verdict);
  const agg = done.length ? window.Scorer.aggregate(done.map((q) => results[q.id].verdict)) : null;

  if (ready === null) return <Center>DB·레이어 적재 중…</Center>;
  if (ready !== "ok") return <Center>초기화 실패 — {ready} (http 서버로 실행했는지 확인)</Center>;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "390px 1fr", gap: 0, minHeight: "100vh" }}>
      {/* ---- 좌: 제어 + 스코어보드 + 질문 목록 ---- */}
      <div style={{ borderRight: "1px solid var(--border)", padding: "18px 16px", overflowY: "auto" }}>
        <div style={{ ...mono, fontSize: 15, fontWeight: 600, marginBottom: 4 }}>NL Agent · 중규모 검증</div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 14 }}>
          레이어 8연산만으로 조회 — 스키마 전문 비제공 · 질문 {Q.length}개
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          <Btn on={!busy} color="var(--accent)" onClick={runAll}>전체 실행</Btn>
          <Btn on={busy} color="var(--low)" onClick={() => (abortRef.current = true)}>중단</Btn>
          <Btn on={!busy} color="var(--dim)" onClick={harnessSelfCheck}>하니스 자가검증</Btn>
          <Btn on={done.length > 0} color="var(--dim)" onClick={downloadResults}>결과 JSONL</Btn>
        </div>
        {selfCheck && <div style={{ ...mono, fontSize: 12, color: "var(--sig)", marginBottom: 8 }}>{selfCheck}</div>}
        {note && <div style={{ ...mono, fontSize: 11.5, color: "var(--med)", marginBottom: 8 }}>{note}</div>}
        {!window.LiveAPI.hasKey() && <KeyBox />}

        {agg && <Scoreboard agg={agg} total={done.length} />}

        {Object.keys(CATL).map((cat) => (
          <div key={cat} style={{ marginTop: 14 }}>
            <div style={{ ...mono, fontSize: 11, letterSpacing: "0.08em", color: "var(--muted)", marginBottom: 6 }}>
              {CATL[cat].toUpperCase()}
            </div>
            {Q.filter((q) => q.cat === cat).map((q) => {
              const r = results[q.id]; const v = r && r.verdict;
              return (
                <div key={q.id} onClick={() => !busy && (r && r.events ? setActive(q.id) : runOne(q, true))}
                  style={{ padding: "4px 8px", borderRadius: 4, cursor: "pointer",
                           background: active === q.id ? "rgba(255,255,255,0.05)" : "transparent",
                           borderLeft: active === q.id ? "2px solid var(--accent)" : "2px solid transparent" }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={{ width: 7, height: 7, borderRadius: 7, flexShrink: 0,
                                   background: v ? VCOLOR[v.verdict] : (r && r.status === "running" ? "var(--sig)" : "var(--border)") }} />
                    <span style={{ lineHeight: 1.5 }}>
                      <span style={{ ...mono, fontSize: 10, color: "var(--dim)", marginRight: 5 }}>{q.id}</span>
                      <span style={{ fontSize: 12, color: "var(--text)" }}>{q.text}</span>
                      {((q.checkpoint||{}).markers||[]).map((m) => (
                        <span key={m} style={{ marginLeft: 5 }}><NLMarkerChip m={m} /></span>))}
                    </span>
                  </div>
                  {v && v.flags.length > 0 && (
                    <div style={{ ...mono, fontSize: 9, color: "var(--low)", paddingLeft: 14, marginTop: 2 }}>{v.flags.join(" · ")}</div>)}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* ---- 우: 트레이스(60%) + 질문 상세(40%) ---- */}
      <div style={{ display: "flex", overflow: "hidden" }}>
        <div style={{ flex: "0 0 60%", padding: "20px 24px", overflowY: "auto", borderRight: "1px solid var(--border)" }}>
          {!active && <Center>질문을 클릭하면 단건 실행(라이브), 전체 실행은 좌측 버튼.</Center>}
          {active && <Thread q={Q.find((x) => x.id === active)} r={results[active]} />}
        </div>
        <div style={{ flex: "0 0 40%", padding: "20px 22px", overflowY: "auto", background: "rgba(0,0,0,0.12)" }}>
          {!active && <Center style={{ fontSize: 12.5 }}>질문을 선택하면 상세 정보가 표시됩니다.</Center>}
          {active && window.QDetail && <window.QDetail db={dbRef.current} q={Q.find((x) => x.id === active)} />}
        </div>
      </div>
    </div>
  );
}

// ---- 스레드 ----
function Thread({ q, r }) {
  if (!r) return null;
  return (
    <div style={{ maxWidth: 860 }}>
      <div style={{ ...mono, fontSize: 11, color: "var(--muted)" }}>{q.id} · {CATL[q.cat]}</div>
      <div style={{ fontSize: 17, fontWeight: 600, margin: "6px 0 18px" }}>{q.text}</div>
      {(r.events || []).map((e, i) => <Event key={i} e={e} q={q} />)}
      {r.status === "running" && <div style={{ ...mono, fontSize: 12, color: "var(--sig)", animation: "pulse 1s infinite" }}>실행 중…</div>}
    </div>
  );
}

function Event({ e, q }) {
  if (e.k === "think")
    return <div style={{ borderLeft: "2px solid var(--med)", padding: "4px 12px", margin: "10px 0", fontSize: 13, color: "var(--muted)", fontStyle: "italic" }}>{e.text}</div>;
  if (e.k === "note")
    return <div style={{ ...mono, fontSize: 11, color: "var(--dim)", margin: "6px 0" }}>· {e.text}</div>;
  if (e.k === "op")
    return (
      <div style={{ border: "1px solid var(--border)", borderLeft: "2px solid var(--sig)", borderRadius: 5, padding: "9px 13px", margin: "10px 0", background: "rgba(0,0,0,0.22)" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
          <span style={{ ...mono, fontSize: 12.5, color: "var(--sig)", fontWeight: 600 }}>{e.op}</span>
          <span style={{ ...mono, fontSize: 11.5, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{JSON.stringify(e.args)}</span>
          <span style={{ flex: 1 }} />
          <span style={{ ...mono, fontSize: 10.5, color: e.status === "done" ? "var(--high)" : "var(--med)" }}>{e.status === "done" ? "조회 완료" : "요청 중…"}</span>
        </div>
        {e.result && <pre style={{ ...mono, fontSize: 11, color: "var(--text)", whiteSpace: "pre-wrap", margin: "8px 0 0", maxHeight: 150, overflowY: "auto", opacity: 0.85 }}>{JSON.stringify(e.result, null, 1).slice(0, 1200)}</pre>}
      </div>
    );
  if (e.k === "final") return <FinalCard out={e.out} rows={e.execRows} err={e.execErr} />;
  if (e.k === "verdict") return <VerdictCard v={e.v} q={q} />;
  return null;
}

function FinalCard({ out, rows, err }) {
  const tone = out.action === "sql" ? "var(--accent)" : out.action === "clarify" ? "var(--med)" : "var(--dim)";
  return (
    <div style={{ border: `1px solid ${tone}55`, borderLeft: `2px solid ${tone}`, borderRadius: 5, padding: "11px 14px", margin: "14px 0" }}>
      <div style={{ ...mono, fontSize: 11, color: tone, letterSpacing: "0.06em", marginBottom: 7 }}>
        최종 액션 · {out.action.toUpperCase()} {out.confidence ? `· ${out.confidence}` : ""}
      </div>
      {out.action === "sql" && <pre style={{ ...mono, fontSize: 12.5, whiteSpace: "pre-wrap", margin: 0, color: "var(--text)" }}>{out.sql}</pre>}
      {out.action === "clarify" && (<div style={{ fontSize: 13.5 }}>{out.clarify_question}
        {(out.options || []).map((o, i) => <span key={i} style={{ ...mono, fontSize: 11.5, border: "1px solid var(--border)", borderRadius: 4, padding: "1px 8px", marginLeft: 7 }}>{o}</span>)}</div>)}
      {out.action === "cannot_answer" && <div style={{ fontSize: 13.5, color: "var(--muted)" }}>{out.reason}</div>}
      {(out.assumptions || []).length > 0 &&
        <div style={{ ...mono, fontSize: 11.5, color: "var(--med)", marginTop: 7 }}>가정: {out.assumptions.join(" · ")}</div>}
      {err && <div style={{ ...mono, fontSize: 11.5, color: "var(--low)", marginTop: 7 }}>실행 오류: {err}</div>}
      {rows && <ResultTable rows={rows} />}
    </div>
  );
}

function ResultTable({ rows }) {
  if (!rows.length) return <div style={{ ...mono, fontSize: 11.5, color: "var(--dim)", marginTop: 8 }}>(0행)</div>;
  const cols = Object.keys(rows[0]); const view = rows.slice(0, 8);
  return (
    <div style={{ marginTop: 9, overflowX: "auto" }}>
      <table style={{ ...mono, fontSize: 11.5, borderCollapse: "collapse" }}>
        <thead><tr>{cols.map((c) => <th key={c} style={{ textAlign: "left", padding: "3px 12px 3px 0", color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{c}</th>)}</tr></thead>
        <tbody>{view.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c} style={{ padding: "3px 12px 3px 0", color: "var(--text)" }}>{String(r[c])}</td>)}</tr>)}</tbody>
      </table>
      {rows.length > 8 && <div style={{ ...mono, fontSize: 10.5, color: "var(--dim)", marginTop: 4 }}>… 총 {rows.length}행</div>}
    </div>
  );
}

function VerdictCard({ v, q }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "baseline", border: `1px solid ${VCOLOR[v.verdict]}44`, borderRadius: 5, padding: "9px 14px", margin: "10px 0" }}>
      <span style={{ ...mono, fontSize: 13, fontWeight: 700, color: VCOLOR[v.verdict] }}>{VLABEL[v.verdict]}</span>
      {v.flags.map((f) => <span key={f} style={{ ...mono, fontSize: 10.5, color: "var(--low)", border: "1px solid var(--low)55", borderRadius: 4, padding: "1px 7px" }}>{f}</span>)}
      <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{v.detail}</span>
      <span style={{ flex: 1 }} />
      <span style={{ ...mono, fontSize: 10.5, color: "var(--dim)" }}>연산 {v.n_ops}회 · 적절성 {Math.round(v.ops_recall * 100)}%</span>
    </div>
  );
}

function Scoreboard({ agg, total }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 5, padding: "10px 12px", marginTop: 6 }}>
      <div style={{ ...mono, fontSize: 11, letterSpacing: "0.08em", color: "var(--muted)", marginBottom: 7 }}>스코어보드 · 채점 {total}건</div>
      {Object.entries(agg).map(([cat, b]) => (
        <div key={cat} style={{ display: "flex", gap: 8, ...mono, fontSize: 11.5, padding: "2px 0", alignItems: "baseline" }}>
          <span style={{ width: 78, color: "var(--text)" }}>{CATL[cat] || cat}</span>
          <span style={{ color: "var(--high)" }}>정답 {b.correct}</span>
          <span style={{ color: "var(--med)" }}>부분 {b.partial}</span>
          <span style={{ color: "var(--low)" }}>오답 {b.wrong}</span>
          {b.hallucination > 0 && <span style={{ color: "var(--low)" }}>환각 {b.hallucination}</span>}
          {b.tool_miss > 0 && <span style={{ color: "var(--dim)" }}>tool-miss {b.tool_miss}</span>}
          <span style={{ flex: 1 }} />
          <span style={{ color: "var(--dim)" }}>{b.avg_ops}연산</span>
        </div>
      ))}
    </div>
  );
}

function KeyBox() {
  const [k, setK] = nUseState("");
  return (
    <div style={{ border: "1px dashed var(--border)", borderRadius: 5, padding: "8px 10px", marginBottom: 10 }}>
      <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 5 }}>로컬 실행 — API 키를 넣으면 localStorage에 저장됩니다 (claude.ai 안에서는 불필요)</div>
      <div style={{ display: "flex", gap: 6 }}>
        <input value={k} onChange={(e) => setK(e.target.value)} placeholder="sk-ant-…" type="password"
          style={{ ...mono, flex: 1, fontSize: 11.5, background: "rgba(0,0,0,0.3)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)", padding: "4px 8px" }} />
        <Btn on={k.length > 10} color="var(--accent)" onClick={() => { localStorage.setItem("anthropic_key", k); location.reload(); }}>저장</Btn>
      </div>
    </div>
  );
}

function Btn({ on, color, onClick, children }) {
  return (
    <button onClick={on ? onClick : undefined} style={{ ...mono, fontSize: 12, padding: "5px 12px", borderRadius: 4,
      cursor: on ? "pointer" : "default", opacity: on ? 1 : 0.4,
      border: `1px solid ${color}66`, background: color + "18", color }}>{children}</button>
  );
}
function Center({ children }) {
  return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh", color: "var(--muted)", fontSize: 13.5 }}>{children}</div>;
}

window.NLScreen = NLScreen;


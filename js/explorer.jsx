// ============================================================
// explorer.jsx — corpus-v1 데이터 탐색 v2.
// 뷰 5개: 테이블(물리) · Term(의미) · 메트릭 · 충돌 지도 · 질문셋
//  + 전역 검색(만능 진입점) + 전 화면 교차 링크 + 해시 딥링크(#x=view/선택)
// 원칙: 이 화면은 '레이어가 아는 만큼 + DB 원시 값'만 보여준다.
//  family는 사람용 감사 정보로 표시하되, 에이전트 연산(get_term)에서는 계속 비노출(D10).
// 순수 로직은 explorer-lib.js (node 검증 완료), 이 파일은 표현만.
// ============================================================
const { useState: eUseState, useRef: eUseRef, useEffect: eUseEffect } = React;
const eMono = { fontFamily: "var(--mono)" };
const DOM_COLOR = { CUSTOMER: "var(--sig)", LOAN: "var(--accent)", CARD: "var(--lin)", DEPOSIT: "var(--high)", RISK: "var(--low)", CLIENT: "var(--sig)", SAVINGS: "var(--high)", COMMON: "var(--dim)" };
const ROLE_COLOR = { stored_as: "var(--accent)", measured_by: "var(--sig)", identified_by: "var(--high)",
                     attribute_of: "var(--med)", dated_by: "var(--lin)", segmented_by: "var(--text)", expressed_as: "var(--low)" };
const FAM_LABEL = { F1_grade: "F1 등급", F2_status: "F2 상태", F3_repayment: "F3 상환방식", F4_limit: "F4 한도",
                    F5_dlnq: "F5 연체", F6_balance: "F6 잔액", F7_maturity: "F7 만기" };
const ECAT = {
  normal:      { label: "정상 경로",   desc: "레이어 연산이 순서대로 돌아야 풀리는 기본 질문" },
  family:      { label: "충돌 패밀리", desc: "같은 말이 여러 도메인에 걸림 — 어느 쪽인지 확인하지 않으면 조용히 틀린다" },
  granularity: { label: "입도",        desc: "같은 개념의 다른 측정 단계 — 신청금액 vs 실행금액처럼 단계에 따라 숫자가 달라진다" },
  boundary:    { label: "경계 결손",   desc: "레이어에 일부러 빠뜨린 정보 — 모르면 모른다고 해야 하고, 지어내면 안 된다" },
  join:        { label: "조인",        desc: "두 테이블을 이어야 풀리는 질문 — 경로와 grain을 함께 검증한다" },
};
const VIEWS = [["dashboard", "대시보드"], ["table", "테이블"], ["term", "Term"], ["metric", "메트릭"], ["codedict", "코드사전"], ["collision", "충돌 지도"], ["question", "질문셋"]];

function ExplorerScreen() {
  const [ready, setReady] = eUseState(null);
  const [route, setRoute] = eUseState(() => window.ExplorerLib.parseHash(location.hash) || { v: "dashboard", sel: null });
  const [counts, setCounts] = eUseState({});
  const dbRef = eUseRef(null);
  const idxRef = eUseRef(null);
  const L = window.Dataset.layer(), Q = window.Dataset.questions();

  function nav(v, sel, hl) {
    setRoute({ v, sel: sel || null, hl: hl || null });
    try { history.replaceState(null, "", window.ExplorerLib.toHash(v, sel)); } catch (e) {}
  }

  eUseEffect(() => { (async () => {
    try {
      if (window.__DB) dbRef.current = window.__DB;
      else {
        const SQL = await initSqlJs({ locateFile: (f) => "data/" + f });
        const buf = await (await fetch(window.Dataset.dbPath())).arrayBuffer();
        dbRef.current = new SQL.Database(new Uint8Array(buf));
        window.__DB = dbRef.current;
      }
      idxRef.current = window.ExplorerLib.buildIndexes(L);
      const c = {};
      for (const t of L.tables) c[t.name] = dbRef.current.exec(`SELECT COUNT(*) FROM ${t.name}`)[0].values[0][0];
      setCounts(c); setReady("ok");
    } catch (e) { setReady("err: " + (e.message || e)); }
  })(); }, []);

  if (ready === null) return <ECenter>world.db(24MB) 적재 중…</ECenter>;
  if (ready !== "ok") return <ECenter>초기화 실패 — {ready} (http 서버로 실행했는지 확인)</ECenter>;

  const idx = idxRef.current;
  const totalRows = Object.values(counts).reduce((a, b) => a + b, 0);
  const props = { db: dbRef.current, L, Q, idx, counts, route, nav };

  return (
    <div>
      <div style={{ display: "flex", gap: 2, alignItems: "center", padding: "8px 16px", borderBottom: "1px solid var(--border)" }}>
        {VIEWS.map(([k, label]) => (
          <div key={k} onClick={() => nav(k, null)}
            style={{ ...eMono, fontSize: 14, padding: "5px 12px", cursor: "pointer", borderRadius: 4,
                     color: route.v === k ? "var(--text)" : "var(--dim)",
                     background: route.v === k ? "rgba(255,255,255,0.07)" : "transparent" }}>
            {label}
          </div>))}
        <div style={{ flex: 1 }} />
        <SearchBox L={L} Q={Q} nav={nav} />
        <span style={{ ...eMono, fontSize: 12.5, color: "var(--dim)", marginLeft: 12 }}>
          {L.tables.length}T · {L.columns.length}C · {totalRows.toLocaleString()}행 · Term {L.terms.length}
        </span>
      </div>
      {route.v === "dashboard" && <window.DashboardView {...props} />}
      {route.v === "table" && <TableView {...props} />}
      {route.v === "term" && <TermView {...props} />}
      {route.v === "metric" && <MetricView {...props} />}
      {route.v === "codedict" && <CodedictView {...props} />}
      {route.v === "collision" && <CollisionView {...props} />}
      {route.v === "question" && <QuestionView {...props} />}
    </div>
  );
}

// ============ 전역 검색 — 만능 진입점 ============
function SearchBox({ L, Q, nav }) {
  const [q, setQ] = eUseState("");
  const [open, setOpen] = eUseState(false);
  const results = q ? window.ExplorerLib.searchAll(L, Q, q) : [];
  const KIND = { term: ["T", "var(--accent)", "term"], column: ["C", "var(--sig)", null],
                 table: ["TB", "var(--high)", "table"], metric: ["M", "var(--lin)", "metric"],
                 question: ["Q", "var(--med)", "question"] };
  function go(r) {
    setOpen(false); setQ("");
    if (r.kind === "column") { const [t] = r.id.split("."); nav("table", t, r.id); }
    else nav(KIND[r.kind][2], r.id);
  }
  return (
    <div style={{ position: "relative" }}>
      <input value={q} placeholder="Term·컬럼·테이블·메트릭·질문 검색"
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onKeyDown={(e) => { if (e.key === "Enter" && results.length) go(results[0]); if (e.key === "Escape") setOpen(false); }}
        style={{ ...eMono, fontSize: 14, width: 280, background: "rgba(0,0,0,0.3)", color: "var(--text)",
                 border: "1px solid var(--border)", borderRadius: 4, padding: "5px 10px" }} />
      {open && results.length > 0 && (
        <div style={{ position: "absolute", top: "110%", right: 0, width: 420, zIndex: 50, background: "var(--panel)",
                      border: "1px solid var(--border)", borderRadius: 6, maxHeight: 340, overflowY: "auto",
                      boxShadow: "0 8px 24px rgba(0,0,0,0.5)" }}>
          {results.map((r, i) => (
            <div key={i} onClick={() => go(r)}
              style={{ display: "flex", gap: 9, padding: "7px 12px", cursor: "pointer", alignItems: "baseline",
                       borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
              <span style={{ ...eMono, fontSize: 11.5, color: KIND[r.kind][1], width: 18, flexShrink: 0 }}>{KIND[r.kind][0]}</span>
              <span style={{ ...eMono, fontSize: 14.5, color: "var(--text)", whiteSpace: "nowrap" }}>{r.label}</span>
              <span style={{ fontSize: 13, color: "var(--dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.sub}</span>
            </div>))}
        </div>)}
    </div>
  );
}

// ============ 공용 ============
function TwoPane({ left, right }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "330px 1fr", minHeight: "calc(100vh - 96px)" }}>
      <div style={{ borderRight: "1px solid var(--border)", padding: "14px 14px", overflowY: "auto" }}>{left}</div>
      <div style={{ padding: "18px 26px", overflowY: "auto" }}>{right}</div>
    </div>);
}
function Section({ title, children }) {
  return (<div style={{ marginTop: 20 }}>
    <div style={{ ...eMono, fontSize: 13, letterSpacing: "0.08em", color: "var(--muted)", marginBottom: 9 }}>{title}</div>
    {children}</div>);
}
function Badge({ color, children, onClick }) {
  return <span onClick={onClick} style={{ ...eMono, fontSize: 11.5, color, border: `1px solid ${color}55`, borderRadius: 4,
    padding: "0px 6px", marginLeft: 5, whiteSpace: "nowrap", display: "inline-block", marginBottom: 2,
    cursor: onClick ? "pointer" : "default" }}>{children}</span>;
}
function Chip({ color, children, onClick }) {
  return <span onClick={onClick} style={{ ...eMono, fontSize: 13, color: color || "var(--text)",
    border: `1px solid ${color || "var(--border)"}66`, borderRadius: 4, padding: "2px 9px",
    marginRight: 6, marginBottom: 5, display: "inline-block", cursor: onClick ? "pointer" : "default" }}>{children}</span>;
}
function HoverRow({ active, onClick, children, style }) {
  const [hover, setHover] = eUseState(false);
  const bg = active ? "rgba(255,255,255,0.06)" : (hover ? "rgba(255,255,255,0.03)" : "transparent");
  return (
    <div onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ ...style, background: bg, transition: "background .12s", cursor: "pointer" }}>
      {children}
    </div>);
}
function ECenter({ children }) {
  return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh", color: "var(--muted)", fontSize: 16 }}>{children}</div>;
}
function ResultTbl({ rows }) {
  if (!rows || !rows.length) return <div style={{ ...eMono, fontSize: 13, color: "var(--dim)", marginTop: 6 }}>(0행)</div>;
  const cols = Object.keys(rows[0]); const view = rows.slice(0, 8);
  return (
    <div style={{ marginTop: 8, overflowX: "auto" }}>
      <table style={{ ...eMono, fontSize: 12.5, borderCollapse: "collapse" }}>
        <thead><tr>{cols.map((c) => <th key={c} style={{ textAlign: "left", padding: "3px 12px 3px 0", color: "var(--muted)", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>{c}</th>)}</tr></thead>
        <tbody>{view.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c} style={{ padding: "3px 12px 3px 0", color: "var(--text)", whiteSpace: "nowrap" }}>{String(r[c])}</td>)}</tr>)}</tbody>
      </table>
      {rows.length > 8 && <div style={{ ...eMono, fontSize: 12, color: "var(--dim)", marginTop: 4 }}>… 총 {rows.length}행</div>}
    </div>);
}

// ============ ① 테이블 뷰 (물리) ============
function TableView({ db, L, idx, counts, route, nav }) {
  const sel = route.sel || "LOAN_ACCT_MST";
  const doms = Array.from(new Set(L.tables.map((t) => t.domain).filter(Boolean)));
  const left = doms.map((d) => (
    <div key={d} style={{ marginBottom: 12 }}>
      <div style={{ ...eMono, fontSize: 13, letterSpacing: "0.08em", color: DOM_COLOR[d], marginBottom: 5 }}>{d}</div>
      {L.tables.filter((t) => t.domain === d).map((t) => (
        <HoverRow key={t.name} active={sel === t.name} onClick={() => nav("table", t.name)}
          style={{ display: "flex", gap: 8, alignItems: "baseline", padding: "3.5px 8px", borderRadius: 4 }}>
          <span style={{ ...eMono, fontSize: 14, color: "var(--text)" }}>{t.name}</span>
          <span style={{ flex: 1 }} />
          <span style={{ ...eMono, fontSize: 12, color: "var(--dim)" }}>{(counts[t.name] || 0).toLocaleString()}</span>
        </HoverRow>))}
    </div>));
  return <TwoPane left={left} right={<TableDetail db={db} L={L} idx={idx} name={sel} counts={counts} hl={route.hl} nav={nav} />} />;
}

function TableDetail({ db, L, idx, name, counts, hl, nav }) {
  const t = L.tables.find((x) => x.name === name);
  if (!t) return <ECenter>테이블 없음: {name}</ECenter>;
  const cols = L.columns.filter((c) => c.table === name);
  const out = t.fk_edges.map((e) => ({ via: e.from.split(".")[1], to: e.to.split(".")[0] }));
  const inn = [];
  for (const ot of L.tables) if (ot.name !== name)
    for (const e of ot.fk_edges) if (e.to.split(".")[0] === name) inn.push({ from: ot.name, via: e.from.split(".")[1] });
  let sample = [];
  try {
    const r = db.exec(`SELECT * FROM ${name} LIMIT 5`);
    if (r.length) sample = r[0].values.map((v) => Object.fromEntries(r[0].columns.map((c, i) => [c, v[i]])));
  } catch (e) {}
  const codeCols = cols.filter((c) => c.code_system || /(_CD|_FLG|_enum|_cv_id)$/.test(c.id.split(".")[1]));
  const dists = codeCols.slice(0, 4).map((c) => {
    const col = c.id.split(".")[1];
    try {
      const r = db.exec(`SELECT ${col}, COUNT(*) n FROM ${name} GROUP BY ${col} ORDER BY n DESC LIMIT 8`);
      if (!r.length) return null;
      const total = r[0].values.reduce((a, v) => a + v[1], 0);
      const dict = L.codedict[c.id];
      return { col, dictless: !dict && /(_CD|_enum|_cv_id)$/.test(col),
               rows: r[0].values.map(([v, n]) => ({ v: String(v), label: dict ? dict[v] : null, n, pct: n / total })) };
    } catch (e) { return null; }
  }).filter(Boolean);
  const hlRef = eUseRef(null);
  eUseEffect(() => { if (hlRef.current) hlRef.current.scrollIntoView({ block: "center" }); }, [name, hl]);

  return (
    <div style={{ maxWidth: 980 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
        <span style={{ ...eMono, fontSize: 21.5, fontWeight: 700 }}>{name}</span>
        <span style={{ ...eMono, fontSize: 13, color: DOM_COLOR[t.domain] }}>{t.domain}</span>
        <span style={{ fontSize: 15, color: "var(--muted)" }}>grain: {t.grain}</span>
        <span style={{ ...eMono, fontSize: 14, color: "var(--dim)" }}>{(counts[name] || 0).toLocaleString()}행</span>
      </div>
      <FkGraph name={name} out={out} inn={inn} nav={(n) => nav("table", n)} />
      <Section title={`컬럼 ${cols.length}개 — 레이어 오버레이 (Term 역할 뱃지 클릭 → Term 뷰)`}>
        <table style={{ ...eMono, fontSize: 14, borderCollapse: "collapse", width: "100%" }}>
          <thead><tr>{["컬럼", "타입", "키", "Description", "Term 연결"].map((h) => (
            <th key={h} style={{ textAlign: "left", padding: "4px 10px 4px 0", color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{h}</th>))}</tr></thead>
          <tbody>{cols.map((c) => {
            const col = c.id.split(".")[1];
            const dictless = !L.codedict[c.id] && /(_CD|_enum|_cv_id)$/.test(col);
            const isHl = hl === c.id;
            return (
              <tr key={c.id} ref={isHl ? hlRef : null}
                  style={{ borderBottom: "1px solid rgba(255,255,255,0.04)",
                           background: isHl ? "rgba(232,162,83,0.12)" : "transparent" }}>
                <td style={{ padding: "4px 10px 4px 0", color: "var(--text)", whiteSpace: "nowrap" }}>
                  {col}
                  {c.classification && <Badge color="var(--low)">{c.classification}</Badge>}
                  {dictless && <Badge color="var(--med)">사전 미등재</Badge>}
                </td>
                <td style={{ padding: "4px 10px 4px 0", color: "var(--dim)", whiteSpace: "nowrap" }}>{c.type}</td>
                <td style={{ padding: "4px 10px 4px 0", color: "var(--sig)", whiteSpace: "nowrap", cursor: c.fk ? "pointer" : "default" }}
                    onClick={c.fk ? () => nav("table", c.fk.split(".")[0]) : undefined}>
                  {c.pk ? "PK" : c.fk ? "FK→" + c.fk.split(".")[0] : ""}</td>
                <td style={{ padding: "4px 10px 4px 0", color: "var(--muted)", fontFamily: "var(--sans)", fontSize: 14.5 }}>
                  {c.description.text}
                  {c.description.source === "auto" && <span style={{ ...eMono, fontSize: 11.5, color: "var(--dim)" }}> (auto)</span>}
                </td>
                <td style={{ padding: "4px 0" }}>
                  {(idx.colTerms[c.id] || []).map((x, i) => (
                    <Badge key={i} color={ROLE_COLOR[x.role] || "var(--dim)"} onClick={() => nav("term", x.term)}>
                      {x.term}·{x.role}{x.value ? `='${x.value}'` : ""}
                    </Badge>))}
                </td>
              </tr>);
          })}</tbody>
        </table>
      </Section>
      {dists.length > 0 && (
        <Section title="코드성 컬럼 값 분포">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
            {dists.map((d) => (
              <div key={d.col} style={{ border: "1px solid var(--border)", borderRadius: 5, padding: "10px 13px" }}>
                <div style={{ ...eMono, fontSize: 14.5, color: "var(--text)", marginBottom: 8 }}>
                  {d.col}{d.dictless && <Badge color="var(--med)">코드사전 미등재 — 의미 미상</Badge>}
                </div>
                {d.rows.map((r) => (
                  <div key={r.v} style={{ display: "flex", gap: 8, alignItems: "center", padding: "2px 0" }}>
                    <span style={{ ...eMono, fontSize: 13, color: "var(--text)", width: 34 }}>{r.v}</span>
                    <span style={{ fontSize: 13, color: r.label ? "var(--muted)" : "var(--med)", width: 92, fontFamily: "var(--sans)" }}>
                      {r.label || (d.dictless ? "?" : "")}</span>
                    <div style={{ flex: 1, height: 9, background: "rgba(255,255,255,0.05)", borderRadius: 3 }}>
                      <div style={{ width: `${Math.max(r.pct * 100, 1.5)}%`, height: "100%", borderRadius: 3,
                                    background: d.dictless ? "var(--med)" : "var(--sig)", opacity: 0.75 }} />
                    </div>
                    <span style={{ ...eMono, fontSize: 12.5, color: "var(--dim)", width: 84, textAlign: "right" }}>
                      {r.n.toLocaleString()} · {(r.pct * 100).toFixed(1)}%</span>
                  </div>))}
              </div>))}
          </div>
        </Section>)}
      <Section title="샘플 행 (LIMIT 5)"><ResultTbl rows={sample} /></Section>
    </div>
  );
}

function FkGraph({ name, out, inn, nav }) {
  const W = 940, rowH = 26, H = Math.max(inn.length, out.length, 1) * rowH + 46;
  const cy = H / 2;
  return (
    <Section title={`FK 이웃 — 들어오는 참조 ${inn.length} · 나가는 참조 ${out.length} (클릭 이동)`}>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
        {inn.map((e, i) => {
          const y = 28 + i * rowH;
          return (<g key={"i" + i}>
            <path d={`M 285 ${y} C 360 ${y}, 380 ${cy}, 425 ${cy}`} stroke="var(--border)" fill="none" />
            <text x={280} y={y + 4} textAnchor="end" onClick={() => nav(e.from)}
              style={{ fill: "var(--sig)", fontSize: 14, fontFamily: "var(--mono)", cursor: "pointer" }}>{e.from}</text>
            <text x={300} y={y - 5} style={{ fill: "var(--dim)", fontSize: 11, fontFamily: "var(--mono)" }}>{e.via}</text>
          </g>);
        })}
        {out.map((e, i) => {
          const y = 28 + i * rowH;
          return (<g key={"o" + i}>
            <path d={`M 515 ${cy} C 560 ${cy}, 580 ${y}, 655 ${y}`} stroke="var(--border)" fill="none" />
            <text x={660} y={y + 4} textAnchor="start" onClick={() => nav(e.to)}
              style={{ fill: "var(--accent)", fontSize: 14, fontFamily: "var(--mono)", cursor: "pointer" }}>{e.to}</text>
            <text x={585} y={y - 5} style={{ fill: "var(--dim)", fontSize: 11, fontFamily: "var(--mono)" }}>{e.via}</text>
          </g>);
        })}
        <rect x={425} y={cy - 14} width={90} height={28} rx={5} fill="rgba(255,255,255,0.05)" stroke="var(--border)" />
        <text x={470} y={cy + 4} textAnchor="middle" style={{ fill: "var(--text)", fontSize: 12, fontFamily: "var(--mono)", fontWeight: 600 }}>
          {name.length > 14 ? name.slice(0, 13) + "…" : name}</text>
      </svg>
    </Section>
  );
}

// ============ ② Term 뷰 (의미) ============
// TermView: 3단 — 도메인 네비(좌 88px) / Term 목록(중 200px) / Term 상세(우 나머지)
function termDoms(L) { return [...Array.from(new Set(L.terms.map((t) => t.domain).filter(Boolean))), "_DISTRACTOR"]; }
function TermView({ L, idx, route, nav }) {
  const sel = route.sel || "대출연체";
  const _termDoms = termDoms(L).filter((d) => d !== "_DISTRACTOR");
  const initDom = () => { const t = idx.termByName[sel]; return (t && (t.links||[]).length) ? (t.domain||_termDoms[0]||"COMMON") : "_DISTRACTOR"; };
  const [activeDom, setActiveDom] = eUseState(initDom);
  const [filter, setFilter] = eUseState("");
  const nf = window.ExplorerLib.norm(filter);
  const match = (t) => !nf || [t.name,...(t.synonyms||[])].some((k)=>window.ExplorerLib.norm(k).includes(nf));
  eUseEffect(() => {
    const t = idx.termByName[sel];
    if (t) setActiveDom((t.links&&t.links.length) ? (t.domain||_termDoms[0]||"COMMON") : "_DISTRACTOR");
  }, [sel]);
  const domCounts = {};
  for (const d of _termDoms)
    domCounts[d] = L.terms.filter((t)=>t.domain===d&&(t.links||[]).length).length;
  domCounts["_DISTRACTOR"] = L.terms.filter((t)=>!(t.links||[]).length).length;
  const listTerms = activeDom === "_DISTRACTOR"
    ? L.terms.filter((t)=>!(t.links||[]).length&&match(t))
    : L.terms.filter((t)=>t.domain===activeDom&&(t.links||[]).length&&match(t));
  const domNav = (
    <div style={{width:140,borderRight:"1px solid var(--border)",padding:"14px 8px",overflowY:"auto",flexShrink:0}}>
      <div style={{...eMono,fontSize: 11.5,letterSpacing:"0.1em",color:"var(--dim)",marginBottom:10,paddingLeft:10}}>DOMAIN</div>
      {termDoms(L).map((d)=>{
        const label = d==="_DISTRACTOR"?"DISTRACTOR":d;
        const color = d==="_DISTRACTOR"?"var(--dim)":DOM_COLOR[d];
        const active = activeDom===d;
        return (
          <div key={d} onClick={()=>{setActiveDom(d);setFilter("");}}
            style={{padding:"6px 10px",borderRadius:4,cursor:"pointer",marginBottom:2,
                    background:active?"rgba(255,255,255,0.07)":"transparent",
                    borderLeft:active?`2px solid ${color}`:"2px solid transparent",
                    display:"flex",alignItems:"center",justifyContent:"space-between",gap:6}}>
            <span style={{...eMono,fontSize: 13,color:active?color:"var(--dim)",fontWeight:active?600:400,
                          whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{label}</span>
            <span style={{...eMono,fontSize: 11.5,color:"var(--dim)",flexShrink:0}}>{domCounts[d]}</span>
          </div>);
      })}
    </div>);
  const termList = (
    <div style={{width:240,borderRight:"1px solid var(--border)",padding:"14px 8px",overflowY:"auto",flexShrink:0}}>
      <input value={filter} onChange={(e)=>setFilter(e.target.value)} placeholder="필터"
        style={{...eMono,fontSize: 13,width:"100%",background:"rgba(0,0,0,0.3)",color:"var(--text)",
                border:"1px solid var(--border)",borderRadius:4,padding:"4px 8px",marginBottom:8}} />
      {listTerms.length===0&&<div style={{...eMono,fontSize: 13,color:"var(--dim)",padding:"4px 6px"}}>(없음)</div>}
      {listTerms.map((t)=>{
        const active = sel===t.name;
        const hasCol = (t.synonyms||[]).some((s)=>(idx.surfaceCount[s]||1)>=2);
        return (
          <HoverRow key={t.name} active={active} onClick={()=>nav("term",t.name)}
            style={{padding:"5px 7px",borderRadius:4,marginBottom:1,
                    borderLeft:active?"2px solid var(--accent)":"2px solid transparent"}}>
            <div style={{display:"flex",alignItems:"center",gap:5}}>
              <span style={{fontSize: 15,color:active?"var(--text)":"var(--muted)",flex:1,lineHeight:1.4}}>{t.name}</span>
              {hasCol&&<span style={{...eMono,fontSize: 11,color:"var(--low)"}}>⚠</span>}
              {t.family&&<span style={{...eMono,fontSize: 10,color:"var(--med)"}}>{t.family.split("_")[0]}</span>}
            </div>
            <div style={{...eMono,fontSize: 11.5,color:"var(--dim)"}}>{(t.links||[]).length} links</div>
          </HoverRow>);
      })}
    </div>);
  return (
    <div style={{display:"flex",minHeight:"calc(100vh - 96px)"}}>
      {domNav}{termList}
      <div style={{flex:1,padding:"18px 26px",overflowY:"auto"}}>
        <TermDetail L={L} idx={idx} name={sel} nav={nav} />
      </div>
    </div>);
}

function TermDetail({ L, idx, name, nav }) {
  const t = idx.termByName[name];
  if (!t) return <ECenter>Term 없음: {name}</ECenter>;
  const byRole = {};
  for (const lk of t.links || []) {
    const r = lk.kind === "metric" ? "measured_by" : lk.role;
    (byRole[r] = byRole[r] || []).push(lk);
  }
  const roles = Object.keys(ROLE_COLOR).filter((r) => byRole[r]);
  return (
    <div style={{ maxWidth: 880 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <span style={{ fontSize: 23, fontWeight: 700 }}>{t.name}</span>
        <span style={{ ...eMono, fontSize: 13, color: DOM_COLOR[t.domain] || "var(--dim)" }}>{t.domain || "공통"}</span>
        {t.family && <Chip color="var(--med)" onClick={() => nav("collision", t.family)}>{FAM_LABEL[t.family] || t.family} 패밀리</Chip>}
        {!(t.links || []).length && <Chip color="var(--dim)">미연결 distractor</Chip>}
      </div>
      <div style={{ fontSize: 16, color: "var(--muted)", margin: "10px 0 0", lineHeight: 1.6 }}>{t.definition}</div>

      {(t.synonyms || []).length > 0 && (
        <Section title="동의어 — ⚠N은 그 표면형을 공유하는 Term 수 (의도된 충돌, 클릭 → 충돌 지도)">
          {(t.synonyms || []).map((s) => {
            const n = idx.surfaceCount[s] || 1;
            return <Chip key={s} color={n >= 2 ? "var(--low)" : "var(--text)"}
              onClick={n >= 2 ? () => nav("collision", s) : undefined}>{s}{n >= 2 ? ` ⚠${n}` : ""}</Chip>;
          })}
        </Section>)}

      {roles.length > 0 && (
        <Section title="실현(links) — 역할별 · 자산 클릭 시 해당 뷰로">
          {roles.map((r) => (
            <div key={r} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "4px 0" }}>
              <span style={{ ...eMono, fontSize: 13, color: ROLE_COLOR[r], width: 110, flexShrink: 0 }}>{r}</span>
              <div>
                {byRole[r].map((lk, i) => lk.kind === "metric"
                  ? <Chip key={i} color="var(--sig)" onClick={() => nav("metric", lk.asset)}>{lk.asset}</Chip>
                  : <Chip key={i} color="var(--text)" onClick={() => nav("table", lk.asset.split(".")[0], lk.asset)}>
                      {lk.asset}{lk.value ? ` = '${lk.value}'` : ""}{lk.domain ? ` (${lk.domain})` : ""}</Chip>)}
              </div>
            </div>))}
        </Section>)}

      {t.valid_values && (
        <Section title="유효 코드값 (valid_values)">
          <table style={{ ...eMono, fontSize: 14, borderCollapse: "collapse" }}>
            <tbody>{Object.entries(t.valid_values).map(([k, v]) => (
              <tr key={k}><td style={{ padding: "2px 18px 2px 0", color: "var(--text)" }}>{k}</td>
                <td style={{ padding: "2px 0", color: "var(--muted)", fontFamily: "var(--sans)" }}>{v}</td></tr>))}</tbody>
          </table>
        </Section>)}
    </div>
  );
}

// ============ ③ 메트릭 뷰 ============
function MetricView({ L, idx, route, nav }) {
  const sel = route.sel || L.metrics[0].id;
  const left = L.metrics.map((m) => (
    <HoverRow key={m.id} active={sel === m.id} onClick={() => nav("metric", m.id)}
      style={{ padding: "5px 8px", borderRadius: 4 }}>
      <div style={{ fontSize: 15, color: "var(--text)" }}>{m.name}</div>
      <div style={{ ...eMono, fontSize: 12, color: "var(--dim)" }}>{m.id}</div>
    </HoverRow>));
  const m = L.metrics.find((x) => x.id === sel) || L.metrics[0];
  const right = (
    <div style={{ maxWidth: 820 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
        <span style={{ fontSize: 23, fontWeight: 700 }}>{m.name}</span>
        <span style={{ ...eMono, fontSize: 14, color: "var(--dim)" }}>{m.id}</span>
      </div>
      <Section title="정의식 (expr)">
        <pre style={{ ...eMono, fontSize: 15, background: "rgba(0,0,0,0.25)", border: "1px solid var(--border)",
                      borderRadius: 5, padding: "10px 13px", whiteSpace: "pre-wrap", margin: 0 }}>{m.expr}</pre>
      </Section>
      <Section title="기준 필터 (base_filters) — 정본과 소박한 재계산을 가르는 지점">
        {(m.base_filters || []).length
          ? m.base_filters.map((f, i) => <Chip key={i} color="var(--low)">{f}</Chip>)
          : <span style={{ ...eMono, fontSize: 14, color: "var(--dim)" }}>(없음)</span>}
      </Section>
      {m.note && <Section title="주석"><div style={{ fontSize: 15.5, color: "var(--muted)" }}>{m.note}</div></Section>}
      <Section title="grain"><span style={{ ...eMono, fontSize: 14.5, color: "var(--text)" }}>{m.grain}</span></Section>
      <Section title="이 지표로 측정되는 Term (measured_by 역방향)">
        {(idx.metricTerms[m.id] || []).map((tn) => <Chip key={tn} color="var(--accent)" onClick={() => nav("term", tn)}>{tn}</Chip>)}
        {!(idx.metricTerms[m.id] || []).length && <span style={{ ...eMono, fontSize: 14, color: "var(--low)" }}>⚠ 고아 메트릭 — 도달 경로 없음</span>}
      </Section>
    </div>);
  return <TwoPane left={left} right={right} />;
}

// ============ 코드사전 뷰 ============
function CodedictView({ idx, route, nav }) {
  const sel = route.sel;
  const entries = idx.codeEntries;
  const registered = entries.filter((e) => e.status === "registered");
  const identifier = entries.filter((e) => e.status === "identifier");
  const missing = entries.filter((e) => e.status === "missing");
  const DOMS = Array.from(new Set(entries.map((e) => e.domain).filter(Boolean)));

  const EntryCard = ({ e }) => {
    const isSel = sel === e.id;
    return (
      <div style={{ border: `1px solid ${isSel ? "var(--sig)" : "var(--border)"}`, borderRadius: 6, padding: "11px 14px",
                    background: "rgba(255,255,255,0.015)" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
          <span style={{ ...eMono, fontSize: 15, color: "var(--text)" }}>{e.col}</span>
          <span style={{ ...eMono, fontSize: 12, color: DOM_COLOR[e.domain] || "var(--dim)" }}>{e.domain}</span>
          <span style={{ flex: 1 }} />
          <span onClick={() => nav("table", e.table, e.id)} style={{ ...eMono, fontSize: 12, color: "var(--dim)", cursor: "pointer" }}>{e.table} →</span>
        </div>
        {e.desc && <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 9, lineHeight: 1.5 }}>{e.desc}</div>}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {Object.entries(e.dict).map(([code, label]) => (
            <span key={code} style={{ ...eMono, fontSize: 13, border: "1px solid var(--border)", borderRadius: 4, padding: "2px 8px" }}>
              <span style={{ color: "var(--sig)" }}>{code}</span>
              <span style={{ color: "var(--dim)", margin: "0 4px" }}>→</span>
              <span style={{ color: "var(--text)" }}>{label}</span>
            </span>))}
        </div>
      </div>);
  };

  return (
    <div style={{ padding: "18px 26px", maxWidth: 1040 }}>
      <div style={{ border: "1px solid var(--border)", borderRadius: 7, padding: "14px 18px", marginBottom: 24,
                    borderLeft: "3px solid var(--sig)" }}>
        <div style={{ ...eMono, fontSize: 14.5, color: "var(--sig)", marginBottom: 8 }}>코드사전이란?</div>
        <div style={{ fontSize: 16, color: "var(--muted)", lineHeight: 1.75 }}>
          코드성 컬럼(<span style={{ ...eMono, fontSize: 14.5 }}>_CD</span>로 끝나는 컬럼)에 저장된 <b style={{ color: "var(--text)", fontWeight: 500 }}>코드값과 그 의미의 매핑</b>이다.
          예를 들어 <span style={{ ...eMono, fontSize: 14.5, color: "var(--sig)" }}>REGION_CD='SE'</span>가 "서울"을 뜻한다는 정보로,
          에이전트가 "서울 지역" 같은 자연어를 올바른 코드값으로 변환(<span style={{ ...eMono, fontSize: 14.5 }}>resolve_code</span>)할 때 쓰인다.
          프로그래밍 코드가 아니라 <b style={{ color: "var(--text)", fontWeight: 500 }}>값 사전</b>이다.
        </div>
        <div style={{ fontSize: 15.5, color: "var(--muted)", lineHeight: 1.75, marginTop: 8 }}>
          사전이 <b style={{ color: "var(--low)", fontWeight: 500 }}>비어 있는 컬럼</b>에서는 에이전트가 코드값을 추측하면 안 되고(환각),
          확인을 요청하거나 부재를 보고해야 한다 — 경계 결손 검증(B01·B02)의 핵심 자원이다.
        </div>
      </div>

      <Section title={`등재된 코드사전 — ${registered.length}개 (값↔라벨 매핑 보유)`}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(330px, 1fr))", gap: 12 }}>
          {DOMS.flatMap((d) => registered.filter((e) => e.domain === d)).map((e) => <EntryCard key={e.id} e={e} />)}
        </div>
      </Section>

      <Section title={`의도적 결손 — ${missing.length}개 (경계 검증용 의도적 공백)`}>
        <div style={{ fontSize: 14.5, color: "var(--muted)", marginBottom: 10, lineHeight: 1.6 }}>
          코드값은 데이터에 존재하지만 사전이 비어 있다. 에이전트가 의미를 추측하면 환각으로 잡힌다.
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {missing.map((e) => (
            <div key={e.id} onClick={() => nav("table", e.table, e.id)}
              style={{ border: "1px solid var(--low)44", borderRadius: 6, padding: "9px 13px", cursor: "pointer",
                       background: "var(--low)0c" }}>
              <div style={{ ...eMono, fontSize: 14.5, color: "var(--low)" }}>{e.col}</div>
              <div style={{ ...eMono, fontSize: 12, color: "var(--dim)", marginTop: 2 }}>{e.table} · {e.domain}</div>
            </div>))}
        </div>
      </Section>

      <Section title={`식별자성 코드 — ${identifier.length}개 (사전화 대상 아님)`}>
        <div style={{ fontSize: 14.5, color: "var(--muted)", marginBottom: 10, lineHeight: 1.6 }}>
          상품코드·우편번호처럼 값이 개방적이라 고정 사전을 두지 않는다. 결손이 아니라 본래 사전화 대상이 아닌 컬럼.
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {identifier.map((e) => (
            <span key={e.id} onClick={() => nav("table", e.table, e.id)}
              style={{ ...eMono, fontSize: 13, color: "var(--dim)", border: "1px solid var(--border)", borderRadius: 4,
                       padding: "3px 9px", cursor: "pointer" }}>{e.col}</span>))}
        </div>
      </Section>
    </div>
  );
}

// ============ ④ 충돌 지도 ============
function CollisionView({ idx, route, nav }) {
  const sel = route.sel;
  const FAM_CLASH = {
    "F1_grade": ["신용등급·고객등급·카드등급", "이름은 같은 '등급'이지만 코드체계·척도·도메인이 전부 다르다"],
    "F2_status": ["신청상태·계좌상태·카드상태·수신계좌상태", "'대출상태'라는 말이 신청 처리 단계와 계좌 생애주기 둘 다에 쓰임 — ACCT_STAT_CD가 두 테이블에 동명으로 존재"],
    "F3_repayment": ["대출상환방식 vs 카드결제방식", "'상환방식'이 두 도메인에 걸림 — 코드체계 완전히 다름 (원리금균등 vs 일시불·리볼빙)"],
    "F4_limit": ["여신한도(RISK) vs 카드이용한도(CARD)", "'한도' 하나가 총 신용 공여 한도와 월간 카드 사용 한도 두 개념에 대응"],
    "F5_dlnq": ["대출연체(LOAN) vs 카드연체(CARD)", "'연체'와 '연체율'이 두 도메인에 걸림 — 정본 메트릭도 각각 따로 정의됨"],
    "F6_balance": ["대출잔액(미상환 원금) vs 예금잔액(수신 계좌 잔액)", "'잔액·잔고'가 부채와 자산 양쪽에 걸림 — 전체 잔액 총계 질문 시 반드시 도메인 확인 필요"],
    "F7_maturity": ["대출만기(LOAN_EXP_DT) vs 예금만기(MTRT_DT)", "'만기' 하나로 대출 계약 종료와 예금 만기 모두 지칭"],
  };
  return (
    <div style={{ padding: "18px 26px", maxWidth: 1040 }}>
      <div style={{ border: "1px solid var(--border)", borderRadius: 7, padding: "14px 18px", marginBottom: 24,
                    borderLeft: "3px solid var(--low)" }}>
        <div style={{ ...eMono, fontSize: 14.5, color: "var(--low)", marginBottom: 8 }}>충돌 지도란?</div>
        <div style={{ fontSize: 16, color: "var(--muted)", lineHeight: 1.75 }}>
          이 코퍼스는 같은 말이 여러 도메인·입도의 개념에 걸리는 상황을 의도적으로 설계했다.
          예를 들어 "연체율이 어떻게 돼?"라는 질문에 대출연체율(8.5%)과 카드연체율(4.1%) 중 어느 쪽인지는 질문만으로 결정되지 않는다.
          에이전트가 조용히 한쪽을 고르면 — 맞든 틀리든 — 사용자는 그 가정을 확인할 방법이 없다.
        </div>
        <div style={{ fontSize: 16, color: "var(--muted)", lineHeight: 1.75, marginTop: 8 }}>
          충돌 지도는 이 설계의 전체 구조를 보여준다.
          <b style={{ color: "var(--text)", fontWeight: 500 }}> 패밀리</b>는 같은 추상 개념(등급·상태·잔액 등)이 도메인별로 실현된 묶음이고,
          <b style={{ color: "var(--text)", fontWeight: 500 }}> 동의어 충돌 표</b>는 같은 표면형(단어)이 실제로 어느 Term들에 닿는지를 보여준다.
          <span style={{ ...eMono, fontSize: 14, color: "var(--low)", marginLeft: 6 }}>⚠</span> 표시가 있는 말은 에이전트가 반드시 확인 질문을 해야 한다(D8 채점 정책).
        </div>
      </div>
      <Section title="충돌 패밀리 — 7군 · 각 군의 충돌 어휘와 이유 (Term 클릭 → Term 뷰)">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12 }}>
          {Object.entries(idx.families).map(([f, terms]) => {
            const clash = FAM_CLASH[f] || ["", ""];
            return (
              <div key={f} style={{ border: `1px solid ${sel===f?"var(--med)":"var(--border)"}`, borderRadius: 6, padding: "11px 14px" }}>
                <div style={{ ...eMono, fontSize: 14.5, color: "var(--med)", marginBottom: 5 }}>{FAM_LABEL[f]||f}</div>
                <div style={{ fontSize: 14, color: "var(--low)", marginBottom: 4 }}>충돌 어휘: {clash[0]}</div>
                <div style={{ fontSize: 14, color: "var(--dim)", marginBottom: 9, lineHeight: 1.55 }}>{clash[1]}</div>
                <div style={{ display: "flex", flexWrap: "wrap" }}>
                  {terms.map((tn) => <Chip key={tn} color="var(--text)" onClick={() => nav("term", tn)}>{tn}</Chip>)}
                </div>
              </div>);
          })}
        </div>
      </Section>
      <Section title={`동의어 충돌 표 — 같은 말이 2개 이상 Term에 닿는 표면형 ${idx.collisions.length}개`}>
        <div style={{ fontSize: 15, color: "var(--muted)", marginBottom: 12, lineHeight: 1.6 }}>
          아래 표의 각 행은 하나의 표현(단어·동의어)이 복수의 Term에 걸리는 경우다.
          에이전트가 이 표현이 포함된 질문을 받으면 resolve_terms가 복수 후보를 반환하고,
          에이전트는 어느 Term인지 확인 질문을 해야 한다. 확인 없이 답하면 D8 오답 처리된다.
        </div>
        {idx.collisions.map((c) => (
          <div key={c.word} style={{ display: "flex", gap: 12, alignItems: "center", padding: "7px 12px", borderRadius: 5,
                                     border: `1px solid ${sel===c.word?"var(--low)":"rgba(255,255,255,0.05)"}`, marginBottom: 6 }}>
            <span style={{ ...eMono, fontSize: 15.5, color: "var(--low)", width: 112, flexShrink: 0 }}>"{c.word}"</span>
            <span style={{ ...eMono, fontSize: 12, color: "var(--dim)", width: 30, flexShrink: 0 }}>→</span>
            <div style={{ display: "flex", flexWrap: "wrap" }}>
              {c.terms.map((tn) => {
                const t = idx.termByName[tn];
                return <Chip key={tn} color="var(--text)" onClick={() => nav("term", tn)}>
                  {tn} <span style={{ color: DOM_COLOR[t.domain]||"var(--dim)" }}>·{t.domain||"공통"}</span></Chip>;
              })}
            </div>
          </div>))}
      </Section>
    </div>
  );
}

// ============ ⑤ 질문셋 뷰 ============
function QuestionView({ db, Q, route, nav }) {
  if (!Q || Q.length === 0) {
    return <ECenter>골든 질문 세트가 없는 데이터셋입니다 (Fineract 탐색 모드). NL 탭에서 자유 질의로 관찰하세요.</ECenter>;
  }
  const sel = route.sel || Q[0].id;
  const cats = ["normal", "family", "granularity", "boundary", "join"];
  const left = cats.map((cat) => (
    <div key={cat} style={{ marginBottom: 11 }}>
      <div style={{ marginBottom: 6 }}>
          <span style={{ ...eMono, fontSize: 13, letterSpacing: "0.08em", color: "var(--muted)" }}>{ECAT[cat].label.toUpperCase()}</span>
          <div style={{ fontSize: 12.5, color: "var(--dim)", marginTop: 2, lineHeight: 1.5 }}>{ECAT[cat].desc}</div>
        </div>
      {Q.filter((q) => q.cat === cat).map((q) => (
        <HoverRow key={q.id} active={sel === q.id} onClick={() => nav("question", q.id)}
          style={{ padding: "4px 8px", borderRadius: 4,
                   borderLeft: sel === q.id ? "2px solid var(--accent)" : "2px solid transparent" }}>
          <div style={{ lineHeight: 1.5 }}>
            <span style={{ ...eMono, fontSize: 12, color: "var(--dim)", marginRight: 5 }}>{q.id}</span>
            <span style={{ fontSize: 14, color: "var(--text)" }}>{q.text}</span>
            {(q.checkpoint && q.checkpoint.markers || []).map((m) => (
              <span key={m} style={{ marginLeft: 5 }}><MarkerChip m={m} small={true} /></span>))}
          </div>
        </HoverRow>))}
    </div>));
  const q = Q.find((x) => x.id === sel) || Q[0];
  return <TwoPane left={left} right={<QDetail db={db} q={q} />} />;
}

function RunnableSql({ db, sql, label }) {
  const [rows, setRows] = eUseState(null);
  const [err, setErr] = eUseState(null);
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 5, padding: "9px 12px", marginBottom: 9 }}>
      {label && <div style={{ ...eMono, fontSize: 13, color: "var(--med)", marginBottom: 6 }}>{label}</div>}
      <pre style={{ ...eMono, fontSize: 14, whiteSpace: "pre-wrap", margin: 0, color: "var(--text)" }}>{sql}</pre>
      <div style={{ marginTop: 7 }}>
        <span onClick={() => { try { setErr(null); setRows(window.Scorer.runSql(db, sql)); } catch (e) { setErr(String(e.message || e)); } }}
          style={{ ...eMono, fontSize: 13, color: "var(--high)", border: "1px solid var(--high)66", borderRadius: 4,
                   padding: "2px 10px", cursor: "pointer" }}>실행</span>
        {err && <span style={{ ...eMono, fontSize: 13, color: "var(--low)", marginLeft: 8 }}>{err}</span>}
      </div>
      {rows && <ResultTbl rows={rows} />}
    </div>);
}

const MARKER_COLOR = { "함정":"var(--low)", "경계":"var(--med)", "D8":"var(--sig)",
  "오류":"var(--lin)", "폴백":"var(--accent)", "조인":"var(--high)", "대표":"var(--dim)", "형식":"var(--lin)" };
const MARKER_TIP = {
  "함정": "정본 지표(get_metric)를 쓰지 않으면 숫자가 달라지게 설계된 문항 — 소박한 재계산은 오답",
  "D8":   "질문이 도메인·입도를 특정하지 않음 — 확인 질문 없이 한쪽을 고르면 값이 맞아도 오답",
  "경계": "레이어에 일부러 빠뜨린 정보 앞에서의 행동을 검증 — 지어내면 환각 플래그",
  "오류": "1차 실측에서 에이전트가 실제로 틀린 문항 — 역량 측정 항목으로 보존",
  "폴백": "Term 링크 없음 — search_columns(Description 검색) 폴백만으로 접근 가능, 신뢰도 한정 필수",
  "조인": "FK 경로를 타야 풀리는 문항 — 경로와 grain 처리를 함께 검증",
  "형식": "Description의 값 형식(YYYYMM 등)을 get_column으로 안 보면 0행 — 조회 건너뛰면 반드시 실패",
};

// 커스텀 툴팁 — 앱 토큰 스타일, 마커 위에 말풍선
function MarkerChip({ m, small }) {
  const [pos, setPos] = eUseState(null);
  const ref = eUseRef(null);
  const tip = MARKER_TIP[m.split(":")[0]] || null;
  const color = MARKER_COLOR[m.split(":")[0]] || "var(--dim)";
  const W = 260;
  const show = () => {
    if (!tip || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const above = r.top > 120;
    let cx = r.left + r.width / 2;
    cx = Math.max(8 + W / 2, Math.min(window.innerWidth - 8 - W / 2, cx));
    setPos({ x: cx, y: above ? r.top - 6 : r.bottom + 6, placement: above ? "above" : "below" });
  };
  return (
    <span ref={ref} style={{ display: "inline-block", flexShrink: 0 }}
      onMouseEnter={show} onMouseLeave={() => setPos(null)}>
      <span style={{ ...eMono, fontSize: small ? 9 : 11, color,
        border: `1px solid ${color}66`, borderRadius: small ? 3 : 4,
        padding: small ? "0px 4px" : "2px 8px",
        display: "inline-block", marginRight: small ? 0 : 6, marginBottom: small ? 0 : 4 }}>{m}</span>
      {pos && tip && (
        <span style={{ position: "fixed", left: pos.x, top: pos.y,
                       transform: `translateX(-50%) ${pos.placement === "above" ? "translateY(-100%)" : ""}`,
                       zIndex: 9999, background: "var(--panel)", border: "1px solid var(--border)",
                       borderRadius: 5, padding: "7px 11px", width: W,
                       boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
                       pointerEvents: "none", whiteSpace: "normal" }}>
          <span style={{ ...eMono, fontSize: 12, color, display: "block", marginBottom: 3 }}>{m}</span>
          <span style={{ fontSize: 14, color: "var(--muted)", lineHeight: 1.6 }}>{tip}</span>
        </span>)}
    </span>);
}

function QDetail({ db, q }) {
  const MODE = { sql: ["단일 골든", "var(--high)"], clarify: ["모호 — D8 3단 채점", "var(--med)"], missing: ["의도된 결손", "var(--low)"], free: ["자유 질의 (탐색)", "var(--sig)"] };
  const cp = q.checkpoint || {};
  const markers = cp.markers || [];
  const ECAT_LOCAL = typeof ECAT !== "undefined" ? ECAT : {};
  const catLabel = (ECAT_LOCAL[q.cat] || {}).label || q.cat;
  return (
    <div>
      {/* 패널 헤더 — "체크포인트" 레이블 + 질문을 아주 작게 */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ ...eMono, fontSize: 12, letterSpacing: "0.1em", color: "var(--med)", marginBottom: 5 }}>
          체크포인트 · {q.id} · {catLabel}
        </div>
        <div style={{ fontSize: 14.5, color: "var(--muted)", lineHeight: 1.5 }}>{q.text}</div>
      </div>
      {/* 마커 + mode 칩 */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 12 }}>
        {MODE[q.mode] && <Chip color={MODE[q.mode][1]}>{MODE[q.mode][0]}</Chip>}
        {markers.map((m) => <MarkerChip key={m} m={m} small={false} />)}
      </div>
      {/* 체크포인트 내용 — 헤더 레이블 없이 바로 행 */}
      {(cp.must || cp.watch || cp.trap) && (
        <div style={{ border: "1px solid var(--border)", borderLeft: "3px solid var(--med)", borderRadius: 5,
                      padding: "12px 14px", marginBottom: 16, background: "rgba(0,0,0,0.18)" }}>
          {cp.must && (
            <div style={{ display: "flex", gap: 10, marginBottom: 7 }}>
              <span style={{ ...eMono, fontSize: 12.5, color: "var(--high)", flexShrink: 0, width: 100 }}>해야 할 것</span>
              <span style={{ fontSize: 14.5, color: "var(--text)", lineHeight: 1.6 }}>{cp.must}</span>
            </div>)}
          {cp.watch && (
            <div style={{ display: "flex", gap: 10, marginBottom: 7 }}>
              <span style={{ ...eMono, fontSize: 12.5, color: "var(--sig)", flexShrink: 0, width: 100 }}>트레이스에서</span>
              <span style={{ fontSize: 14.5, color: "var(--text)", lineHeight: 1.6 }}>{cp.watch}</span>
            </div>)}
          {cp.trap && (
            <div style={{ display: "flex", gap: 10 }}>
              <span style={{ ...eMono, fontSize: 12.5, color: "var(--low)", flexShrink: 0, width: 100 }}>함정·주의</span>
              <span style={{ fontSize: 14.5, color: "var(--muted)", lineHeight: 1.6 }}>{cp.trap}</span>
            </div>)}
        </div>)}
      <Section title="기대 조회 행동 (expected_ops)">
        {(q.expected_ops || []).map((o) => <Chip key={o} color="var(--sig)">{o}</Chip>)}
      </Section>
      {q.mode === "sql" && (
        <Section title="골든 SQL — 실행해서 정답 확인">
          <RunnableSql db={db} sql={q.golden.sql} />
          {(q.golden.alternatives || []).map((a, i) => <RunnableSql key={i} db={db} sql={a.sql} label={`허용 대안 ${i + 1}`} />)}
        </Section>)}
      {q.mode === "clarify" && (
        <Section title={`해석별 골든 — ${q.golden.policy}`}>
          {q.golden.interpretations.map((it, i) => <RunnableSql key={i} db={db} sql={it.sql} label={it.label} />)}
        </Section>)}
      {q.mode === "missing" && (
        <Section title="기대 행동">
          <div style={{ fontSize: 15, color: "var(--muted)", lineHeight: 1.65, marginBottom: 10 }}>{q.golden.expected_behavior}</div>
          {q.golden.world_truth && (
            <RunnableSql db={db} sql={q.golden.world_truth.sql}
              label="세계 진실 (평가 전용 — 에이전트 비공개)" />)}
        </Section>)}
    </div>
  );
}

window.ExplorerScreen = ExplorerScreen;
window.QDetail = QDetail;
window.RunnableSql = RunnableSql;

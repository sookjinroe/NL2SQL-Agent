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
const DOM_COLOR = { CUSTOMER: "var(--sig)", LOAN: "var(--accent)", CARD: "var(--lin)", DEPOSIT: "var(--high)", RISK: "var(--low)" };
const ROLE_COLOR = { stored_as: "var(--accent)", measured_by: "var(--sig)", identified_by: "var(--high)",
                     attribute_of: "var(--med)", dated_by: "var(--lin)", segmented_by: "var(--text)", expressed_as: "var(--low)" };
const FAM_LABEL = { F1_grade: "F1 등급", F2_status: "F2 상태", F3_repayment: "F3 상환방식", F4_limit: "F4 한도",
                    F5_dlnq: "F5 연체", F6_balance: "F6 잔액", F7_maturity: "F7 만기" };
const ECAT = { normal: "정상 경로", family: "충돌 패밀리", granularity: "입도", boundary: "경계 결손", join: "조인" };
const VIEWS = [["table", "테이블"], ["term", "Term"], ["metric", "메트릭"], ["collision", "충돌 지도"], ["question", "질문셋"]];

function ExplorerScreen() {
  const [ready, setReady] = eUseState(null);
  const [route, setRoute] = eUseState(() => window.ExplorerLib.parseHash(location.hash) || { v: "table", sel: "LOAN_ACCT_MST" });
  const [counts, setCounts] = eUseState({});
  const dbRef = eUseRef(null);
  const idxRef = eUseRef(null);
  const L = window.LAYER, Q = window.QUESTIONS;

  function nav(v, sel, hl) {
    setRoute({ v, sel: sel || null, hl: hl || null });
    try { history.replaceState(null, "", window.ExplorerLib.toHash(v, sel)); } catch (e) {}
  }

  eUseEffect(() => { (async () => {
    try {
      if (window.__DB) dbRef.current = window.__DB;
      else {
        const SQL = await initSqlJs({ locateFile: (f) => "data/" + f });
        const buf = await (await fetch("data/world.db")).arrayBuffer();
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
            style={{ ...eMono, fontSize: 11.5, padding: "5px 12px", cursor: "pointer", borderRadius: 4,
                     color: route.v === k ? "var(--text)" : "var(--dim)",
                     background: route.v === k ? "rgba(255,255,255,0.07)" : "transparent" }}>
            {label}
          </div>))}
        <div style={{ flex: 1 }} />
        <SearchBox L={L} Q={Q} nav={nav} />
        <span style={{ ...eMono, fontSize: 10.5, color: "var(--dim)", marginLeft: 12 }}>
          {L.tables.length}T · {L.columns.length}C · {totalRows.toLocaleString()}행 · Term {L.terms.length}
        </span>
      </div>
      {route.v === "table" && <TableView {...props} />}
      {route.v === "term" && <TermView {...props} />}
      {route.v === "metric" && <MetricView {...props} />}
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
        style={{ ...eMono, fontSize: 11.5, width: 280, background: "rgba(0,0,0,0.3)", color: "var(--text)",
                 border: "1px solid var(--border)", borderRadius: 4, padding: "5px 10px" }} />
      {open && results.length > 0 && (
        <div style={{ position: "absolute", top: "110%", right: 0, width: 420, zIndex: 50, background: "var(--panel)",
                      border: "1px solid var(--border)", borderRadius: 6, maxHeight: 340, overflowY: "auto",
                      boxShadow: "0 8px 24px rgba(0,0,0,0.5)" }}>
          {results.map((r, i) => (
            <div key={i} onClick={() => go(r)}
              style={{ display: "flex", gap: 9, padding: "7px 12px", cursor: "pointer", alignItems: "baseline",
                       borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
              <span style={{ ...eMono, fontSize: 9.5, color: KIND[r.kind][1], width: 18, flexShrink: 0 }}>{KIND[r.kind][0]}</span>
              <span style={{ ...eMono, fontSize: 12, color: "var(--text)", whiteSpace: "nowrap" }}>{r.label}</span>
              <span style={{ fontSize: 11, color: "var(--dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.sub}</span>
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
    <div style={{ ...eMono, fontSize: 11, letterSpacing: "0.08em", color: "var(--muted)", marginBottom: 9 }}>{title}</div>
    {children}</div>);
}
function Badge({ color, children, onClick }) {
  return <span onClick={onClick} style={{ ...eMono, fontSize: 9.5, color, border: `1px solid ${color}55`, borderRadius: 4,
    padding: "0px 6px", marginLeft: 5, whiteSpace: "nowrap", display: "inline-block", marginBottom: 2,
    cursor: onClick ? "pointer" : "default" }}>{children}</span>;
}
function Chip({ color, children, onClick }) {
  return <span onClick={onClick} style={{ ...eMono, fontSize: 11, color: color || "var(--text)",
    border: `1px solid ${color || "var(--border)"}66`, borderRadius: 4, padding: "2px 9px",
    marginRight: 6, marginBottom: 5, display: "inline-block", cursor: onClick ? "pointer" : "default" }}>{children}</span>;
}
function ECenter({ children }) {
  return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh", color: "var(--muted)", fontSize: 13.5 }}>{children}</div>;
}
function ResultTbl({ rows }) {
  if (!rows || !rows.length) return <div style={{ ...eMono, fontSize: 11, color: "var(--dim)", marginTop: 6 }}>(0행)</div>;
  const cols = Object.keys(rows[0]); const view = rows.slice(0, 8);
  return (
    <div style={{ marginTop: 8, overflowX: "auto" }}>
      <table style={{ ...eMono, fontSize: 10.5, borderCollapse: "collapse" }}>
        <thead><tr>{cols.map((c) => <th key={c} style={{ textAlign: "left", padding: "3px 12px 3px 0", color: "var(--muted)", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>{c}</th>)}</tr></thead>
        <tbody>{view.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c} style={{ padding: "3px 12px 3px 0", color: "var(--text)", whiteSpace: "nowrap" }}>{String(r[c])}</td>)}</tr>)}</tbody>
      </table>
      {rows.length > 8 && <div style={{ ...eMono, fontSize: 10, color: "var(--dim)", marginTop: 4 }}>… 총 {rows.length}행</div>}
    </div>);
}

// ============ ① 테이블 뷰 (물리) ============
function TableView({ db, L, idx, counts, route, nav }) {
  const sel = route.sel || "LOAN_ACCT_MST";
  const doms = ["CUSTOMER", "LOAN", "CARD", "DEPOSIT", "RISK"];
  const left = doms.map((d) => (
    <div key={d} style={{ marginBottom: 12 }}>
      <div style={{ ...eMono, fontSize: 11, letterSpacing: "0.08em", color: DOM_COLOR[d], marginBottom: 5 }}>{d}</div>
      {L.tables.filter((t) => t.domain === d).map((t) => (
        <div key={t.name} onClick={() => nav("table", t.name)}
          style={{ display: "flex", gap: 8, alignItems: "baseline", padding: "3.5px 8px", borderRadius: 4, cursor: "pointer",
                   background: sel === t.name ? "rgba(255,255,255,0.06)" : "transparent" }}>
          <span style={{ ...eMono, fontSize: 11.5, color: "var(--text)" }}>{t.name}</span>
          <span style={{ flex: 1 }} />
          <span style={{ ...eMono, fontSize: 10, color: "var(--dim)" }}>{(counts[t.name] || 0).toLocaleString()}</span>
        </div>))}
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
  const codeCols = cols.filter((c) => c.code_system || /(_CD|_FLG)$/.test(c.id.split(".")[1]));
  const dists = codeCols.slice(0, 4).map((c) => {
    const col = c.id.split(".")[1];
    try {
      const r = db.exec(`SELECT ${col}, COUNT(*) n FROM ${name} GROUP BY ${col} ORDER BY n DESC LIMIT 8`);
      if (!r.length) return null;
      const total = r[0].values.reduce((a, v) => a + v[1], 0);
      const dict = L.codedict[c.id];
      return { col, dictless: !dict && /_CD$/.test(col),
               rows: r[0].values.map(([v, n]) => ({ v: String(v), label: dict ? dict[v] : null, n, pct: n / total })) };
    } catch (e) { return null; }
  }).filter(Boolean);
  const hlRef = eUseRef(null);
  eUseEffect(() => { if (hlRef.current) hlRef.current.scrollIntoView({ block: "center" }); }, [name, hl]);

  return (
    <div style={{ maxWidth: 980 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
        <span style={{ ...eMono, fontSize: 18, fontWeight: 700 }}>{name}</span>
        <span style={{ ...eMono, fontSize: 11, color: DOM_COLOR[t.domain] }}>{t.domain}</span>
        <span style={{ fontSize: 12.5, color: "var(--muted)" }}>grain: {t.grain}</span>
        <span style={{ ...eMono, fontSize: 11.5, color: "var(--dim)" }}>{(counts[name] || 0).toLocaleString()}행</span>
      </div>
      <FkGraph name={name} out={out} inn={inn} nav={(n) => nav("table", n)} />
      <Section title={`컬럼 ${cols.length}개 — 레이어 오버레이 (Term 역할 뱃지 클릭 → Term 뷰)`}>
        <table style={{ ...eMono, fontSize: 11.5, borderCollapse: "collapse", width: "100%" }}>
          <thead><tr>{["컬럼", "타입", "키", "Description", "Term 연결"].map((h) => (
            <th key={h} style={{ textAlign: "left", padding: "4px 10px 4px 0", color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{h}</th>))}</tr></thead>
          <tbody>{cols.map((c) => {
            const col = c.id.split(".")[1];
            const dictless = !L.codedict[c.id] && /_CD$/.test(col);
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
                <td style={{ padding: "4px 10px 4px 0", color: "var(--muted)", fontFamily: "var(--sans)", fontSize: 12 }}>
                  {c.description.text.split(" 값:")[0]}
                  {c.description.source === "auto" && <span style={{ ...eMono, fontSize: 9.5, color: "var(--dim)" }}> (auto)</span>}
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
                <div style={{ ...eMono, fontSize: 12, color: "var(--text)", marginBottom: 8 }}>
                  {d.col}{d.dictless && <Badge color="var(--med)">코드사전 미등재 — 의미 미상</Badge>}
                </div>
                {d.rows.map((r) => (
                  <div key={r.v} style={{ display: "flex", gap: 8, alignItems: "center", padding: "2px 0" }}>
                    <span style={{ ...eMono, fontSize: 11, color: "var(--text)", width: 34 }}>{r.v}</span>
                    <span style={{ fontSize: 11, color: r.label ? "var(--muted)" : "var(--med)", width: 92, fontFamily: "var(--sans)" }}>
                      {r.label || (d.dictless ? "?" : "")}</span>
                    <div style={{ flex: 1, height: 9, background: "rgba(255,255,255,0.05)", borderRadius: 3 }}>
                      <div style={{ width: `${Math.max(r.pct * 100, 1.5)}%`, height: "100%", borderRadius: 3,
                                    background: d.dictless ? "var(--med)" : "var(--sig)", opacity: 0.75 }} />
                    </div>
                    <span style={{ ...eMono, fontSize: 10.5, color: "var(--dim)", width: 84, textAlign: "right" }}>
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
              style={{ fill: "var(--sig)", fontSize: 11.5, fontFamily: "var(--mono)", cursor: "pointer" }}>{e.from}</text>
            <text x={300} y={y - 5} style={{ fill: "var(--dim)", fontSize: 9, fontFamily: "var(--mono)" }}>{e.via}</text>
          </g>);
        })}
        {out.map((e, i) => {
          const y = 28 + i * rowH;
          return (<g key={"o" + i}>
            <path d={`M 515 ${cy} C 560 ${cy}, 580 ${y}, 655 ${y}`} stroke="var(--border)" fill="none" />
            <text x={660} y={y + 4} textAnchor="start" onClick={() => nav(e.to)}
              style={{ fill: "var(--accent)", fontSize: 11.5, fontFamily: "var(--mono)", cursor: "pointer" }}>{e.to}</text>
            <text x={585} y={y - 5} style={{ fill: "var(--dim)", fontSize: 9, fontFamily: "var(--mono)" }}>{e.via}</text>
          </g>);
        })}
        <rect x={425} y={cy - 14} width={90} height={28} rx={5} fill="rgba(255,255,255,0.05)" stroke="var(--border)" />
        <text x={470} y={cy + 4} textAnchor="middle" style={{ fill: "var(--text)", fontSize: 10, fontFamily: "var(--mono)", fontWeight: 600 }}>
          {name.length > 14 ? name.slice(0, 13) + "…" : name}</text>
      </svg>
    </Section>
  );
}

// ============ ② Term 뷰 (의미) ============
// TermView: 3단 — 도메인 네비(좌 88px) / Term 목록(중 200px) / Term 상세(우 나머지)
const TERM_DOMS = ["CUSTOMER","LOAN","CARD","DEPOSIT","RISK","_DISTRACTOR"];
function TermView({ L, idx, route, nav }) {
  const sel = route.sel || "대출연체";
  const initDom = () => { const t = idx.termByName[sel]; return (t && (t.links||[]).length) ? (t.domain||"CUSTOMER") : "_DISTRACTOR"; };
  const [activeDom, setActiveDom] = eUseState(initDom);
  const [filter, setFilter] = eUseState("");
  const nf = window.ExplorerLib.norm(filter);
  const match = (t) => !nf || [t.name,...(t.synonyms||[])].some((k)=>window.ExplorerLib.norm(k).includes(nf));
  eUseEffect(() => {
    const t = idx.termByName[sel];
    if (t) setActiveDom((t.links&&t.links.length) ? (t.domain||"CUSTOMER") : "_DISTRACTOR");
  }, [sel]);
  const domCounts = {};
  for (const d of ["CUSTOMER","LOAN","CARD","DEPOSIT","RISK"])
    domCounts[d] = L.terms.filter((t)=>t.domain===d&&(t.links||[]).length).length;
  domCounts["_DISTRACTOR"] = L.terms.filter((t)=>!(t.links||[]).length).length;
  const listTerms = activeDom === "_DISTRACTOR"
    ? L.terms.filter((t)=>!(t.links||[]).length&&match(t))
    : L.terms.filter((t)=>t.domain===activeDom&&(t.links||[]).length&&match(t));
  const domNav = (
    <div style={{width:88,borderRight:"1px solid var(--border)",padding:"14px 6px",overflowY:"auto",flexShrink:0}}>
      <div style={{...eMono,fontSize:9.5,letterSpacing:"0.1em",color:"var(--dim)",marginBottom:10,paddingLeft:8}}>DOMAIN</div>
      {TERM_DOMS.map((d)=>{
        const label = d==="_DISTRACTOR"?"DIST.":d.slice(0,4)+(d.length>4?"…":"");
        const color = d==="_DISTRACTOR"?"var(--dim)":DOM_COLOR[d];
        const active = activeDom===d;
        return (
          <div key={d} onClick={()=>{setActiveDom(d);setFilter("");}}
            style={{padding:"6px 8px",borderRadius:4,cursor:"pointer",marginBottom:2,
                    background:active?"rgba(255,255,255,0.07)":"transparent",
                    borderLeft:active?`2px solid ${color}`:"2px solid transparent"}}>
            <div style={{...eMono,fontSize:10.5,color:active?color:"var(--dim)",fontWeight:active?600:400}}>{label}</div>
            <div style={{...eMono,fontSize:9.5,color:"var(--dim)"}}>{domCounts[d]}</div>
          </div>);
      })}
    </div>);
  const termList = (
    <div style={{width:210,borderRight:"1px solid var(--border)",padding:"14px 8px",overflowY:"auto",flexShrink:0}}>
      <input value={filter} onChange={(e)=>setFilter(e.target.value)} placeholder="필터"
        style={{...eMono,fontSize:11,width:"100%",background:"rgba(0,0,0,0.3)",color:"var(--text)",
                border:"1px solid var(--border)",borderRadius:4,padding:"4px 8px",marginBottom:8}} />
      {listTerms.length===0&&<div style={{...eMono,fontSize:11,color:"var(--dim)",padding:"4px 6px"}}>(없음)</div>}
      {listTerms.map((t)=>{
        const active = sel===t.name;
        const hasCol = (t.synonyms||[]).some((s)=>(idx.surfaceCount[s]||1)>=2);
        return (
          <div key={t.name} onClick={()=>nav("term",t.name)}
            style={{padding:"5px 7px",borderRadius:4,cursor:"pointer",marginBottom:1,
                    background:active?"rgba(255,255,255,0.07)":"transparent",
                    borderLeft:active?"2px solid var(--accent)":"2px solid transparent"}}>
            <div style={{display:"flex",alignItems:"center",gap:5}}>
              <span style={{fontSize:12.5,color:active?"var(--text)":"var(--muted)",flex:1,lineHeight:1.4}}>{t.name}</span>
              {hasCol&&<span style={{...eMono,fontSize:9,color:"var(--low)"}}>⚠</span>}
              {t.family&&<span style={{...eMono,fontSize:8.5,color:"var(--med)"}}>{t.family.split("_")[0]}</span>}
            </div>
            <div style={{...eMono,fontSize:9.5,color:"var(--dim)"}}>{(t.links||[]).length} links</div>
          </div>);
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
        <span style={{ fontSize: 19, fontWeight: 700 }}>{t.name}</span>
        <span style={{ ...eMono, fontSize: 11, color: DOM_COLOR[t.domain] || "var(--dim)" }}>{t.domain || "공통"}</span>
        {t.family && <Chip color="var(--med)" onClick={() => nav("collision", t.family)}>{FAM_LABEL[t.family] || t.family} 패밀리</Chip>}
        {!(t.links || []).length && <Chip color="var(--dim)">미연결 distractor</Chip>}
      </div>
      <div style={{ fontSize: 13.5, color: "var(--muted)", margin: "10px 0 0", lineHeight: 1.6 }}>{t.definition}</div>

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
              <span style={{ ...eMono, fontSize: 11, color: ROLE_COLOR[r], width: 110, flexShrink: 0 }}>{r}</span>
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
          <table style={{ ...eMono, fontSize: 11.5, borderCollapse: "collapse" }}>
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
    <div key={m.id} onClick={() => nav("metric", m.id)}
      style={{ padding: "5px 8px", borderRadius: 4, cursor: "pointer",
               background: sel === m.id ? "rgba(255,255,255,0.06)" : "transparent" }}>
      <div style={{ fontSize: 12.5, color: "var(--text)" }}>{m.name}</div>
      <div style={{ ...eMono, fontSize: 10, color: "var(--dim)" }}>{m.id}</div>
    </div>));
  const m = L.metrics.find((x) => x.id === sel) || L.metrics[0];
  const right = (
    <div style={{ maxWidth: 820 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
        <span style={{ fontSize: 19, fontWeight: 700 }}>{m.name}</span>
        <span style={{ ...eMono, fontSize: 11.5, color: "var(--dim)" }}>{m.id}</span>
      </div>
      <Section title="정의식 (expr)">
        <pre style={{ ...eMono, fontSize: 12.5, background: "rgba(0,0,0,0.25)", border: "1px solid var(--border)",
                      borderRadius: 5, padding: "10px 13px", whiteSpace: "pre-wrap", margin: 0 }}>{m.expr}</pre>
      </Section>
      <Section title="기준 필터 (base_filters) — 정본과 소박한 재계산을 가르는 지점">
        {(m.base_filters || []).length
          ? m.base_filters.map((f, i) => <Chip key={i} color="var(--low)">{f}</Chip>)
          : <span style={{ ...eMono, fontSize: 11.5, color: "var(--dim)" }}>(없음)</span>}
      </Section>
      {m.note && <Section title="주석"><div style={{ fontSize: 13, color: "var(--muted)" }}>{m.note}</div></Section>}
      <Section title="grain"><span style={{ ...eMono, fontSize: 12, color: "var(--text)" }}>{m.grain}</span></Section>
      <Section title="이 지표로 측정되는 Term (measured_by 역방향)">
        {(idx.metricTerms[m.id] || []).map((tn) => <Chip key={tn} color="var(--accent)" onClick={() => nav("term", tn)}>{tn}</Chip>)}
        {!(idx.metricTerms[m.id] || []).length && <span style={{ ...eMono, fontSize: 11.5, color: "var(--low)" }}>⚠ 고아 메트릭 — 도달 경로 없음</span>}
      </Section>
    </div>);
  return <TwoPane left={left} right={right} />;
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
        <div style={{ ...eMono, fontSize: 12, color: "var(--low)", marginBottom: 8 }}>충돌 지도란?</div>
        <div style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.75 }}>
          이 코퍼스는 같은 말이 여러 도메인·입도의 개념에 걸리는 상황을 의도적으로 설계했다.
          예를 들어 "연체율이 어떻게 돼?"라는 질문에 대출연체율(8.5%)과 카드연체율(4.1%) 중 어느 쪽인지는 질문만으로 결정되지 않는다.
          에이전트가 조용히 한쪽을 고르면 — 맞든 틀리든 — 사용자는 그 가정을 확인할 방법이 없다.
        </div>
        <div style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.75, marginTop: 8 }}>
          충돌 지도는 이 설계의 전체 구조를 보여준다.
          <b style={{ color: "var(--text)", fontWeight: 500 }}> 패밀리</b>는 같은 추상 개념(등급·상태·잔액 등)이 도메인별로 실현된 묶음이고,
          <b style={{ color: "var(--text)", fontWeight: 500 }}> 동의어 충돌 표</b>는 같은 표면형(단어)이 실제로 어느 Term들에 닿는지를 보여준다.
          <span style={{ ...eMono, fontSize: 11.5, color: "var(--low)", marginLeft: 6 }}>⚠</span> 표시가 있는 말은 에이전트가 반드시 확인 질문을 해야 한다(D8 채점 정책).
        </div>
      </div>
      <Section title="충돌 패밀리 — 7군 · 각 군의 충돌 어휘와 이유 (Term 클릭 → Term 뷰)">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12 }}>
          {Object.entries(idx.families).map(([f, terms]) => {
            const clash = FAM_CLASH[f] || ["", ""];
            return (
              <div key={f} style={{ border: `1px solid ${sel===f?"var(--med)":"var(--border)"}`, borderRadius: 6, padding: "11px 14px" }}>
                <div style={{ ...eMono, fontSize: 12, color: "var(--med)", marginBottom: 5 }}>{FAM_LABEL[f]||f}</div>
                <div style={{ fontSize: 11.5, color: "var(--low)", marginBottom: 4 }}>충돌 어휘: {clash[0]}</div>
                <div style={{ fontSize: 11.5, color: "var(--dim)", marginBottom: 9, lineHeight: 1.55 }}>{clash[1]}</div>
                <div style={{ display: "flex", flexWrap: "wrap" }}>
                  {terms.map((tn) => <Chip key={tn} color="var(--text)" onClick={() => nav("term", tn)}>{tn}</Chip>)}
                </div>
              </div>);
          })}
        </div>
      </Section>
      <Section title={`동의어 충돌 표 — 같은 말이 2개 이상 Term에 닿는 표면형 ${idx.collisions.length}개`}>
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 12, lineHeight: 1.6 }}>
          아래 표의 각 행은 하나의 표현(단어·동의어)이 복수의 Term에 걸리는 경우다.
          에이전트가 이 표현이 포함된 질문을 받으면 resolve_terms가 복수 후보를 반환하고,
          에이전트는 어느 Term인지 확인 질문을 해야 한다. 확인 없이 답하면 D8 오답 처리된다.
        </div>
        {idx.collisions.map((c) => (
          <div key={c.word} style={{ display: "flex", gap: 12, alignItems: "center", padding: "7px 12px", borderRadius: 5,
                                     border: `1px solid ${sel===c.word?"var(--low)":"rgba(255,255,255,0.05)"}`, marginBottom: 6 }}>
            <span style={{ ...eMono, fontSize: 13, color: "var(--low)", width: 112, flexShrink: 0 }}>"{c.word}"</span>
            <span style={{ ...eMono, fontSize: 10, color: "var(--dim)", width: 30, flexShrink: 0 }}>→</span>
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
  const sel = route.sel || Q[0].id;
  const cats = ["normal", "family", "granularity", "boundary", "join"];
  const left = cats.map((cat) => (
    <div key={cat} style={{ marginBottom: 11 }}>
      <div style={{ ...eMono, fontSize: 11, letterSpacing: "0.08em", color: "var(--muted)", marginBottom: 4 }}>{ECAT[cat].toUpperCase()}</div>
      {Q.filter((q) => q.cat === cat).map((q) => (
        <div key={q.id} onClick={() => nav("question", q.id)}
          style={{ display: "flex", gap: 7, alignItems: "baseline", padding: "3px 8px", borderRadius: 4, cursor: "pointer",
                   background: sel === q.id ? "rgba(255,255,255,0.06)" : "transparent" }}>
          <span style={{ ...eMono, fontSize: 10, color: "var(--dim)", flexShrink: 0 }}>{q.id}</span>
          <span style={{ fontSize: 11.5, color: "var(--text)", lineHeight: 1.4 }}>{q.text}</span>
        </div>))}
    </div>));
  const q = Q.find((x) => x.id === sel) || Q[0];
  return <TwoPane left={left} right={<QDetail db={db} q={q} />} />;
}

function RunnableSql({ db, sql, label }) {
  const [rows, setRows] = eUseState(null);
  const [err, setErr] = eUseState(null);
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 5, padding: "9px 12px", marginBottom: 9 }}>
      {label && <div style={{ ...eMono, fontSize: 11, color: "var(--med)", marginBottom: 6 }}>{label}</div>}
      <pre style={{ ...eMono, fontSize: 11.5, whiteSpace: "pre-wrap", margin: 0, color: "var(--text)" }}>{sql}</pre>
      <div style={{ marginTop: 7 }}>
        <span onClick={() => { try { setErr(null); setRows(window.Scorer.runSql(db, sql)); } catch (e) { setErr(String(e.message || e)); } }}
          style={{ ...eMono, fontSize: 11, color: "var(--high)", border: "1px solid var(--high)66", borderRadius: 4,
                   padding: "2px 10px", cursor: "pointer" }}>실행</span>
        {err && <span style={{ ...eMono, fontSize: 11, color: "var(--low)", marginLeft: 8 }}>{err}</span>}
      </div>
      {rows && <ResultTbl rows={rows} />}
    </div>);
}

function QDetail({ db, q }) {
  const MODE = { sql: ["단일 골든", "var(--high)"], clarify: ["모호 — D8 3단 채점", "var(--med)"], missing: ["의도된 결손", "var(--low)"] };
  return (
    <div style={{ maxWidth: 880 }}>
      <div style={{ ...eMono, fontSize: 11, color: "var(--muted)" }}>{q.id} · {ECAT[q.cat]}</div>
      <div style={{ fontSize: 16.5, fontWeight: 600, margin: "6px 0 8px" }}>{q.text}</div>
      <div style={{ marginBottom: 4 }}>
        <Chip color={MODE[q.mode][1]}>{MODE[q.mode][0]}</Chip>
        {(q.tags || []).map((t) => <Chip key={t} color="var(--dim)">{t}</Chip>)}
      </div>
      <Section title="기대 조회 행동 (expected_ops — 적절성 채점의 골든)">
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
          <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.65, marginBottom: 10 }}>{q.golden.expected_behavior}</div>
          {q.golden.world_truth && (
            <RunnableSql db={db} sql={q.golden.world_truth.sql}
              label="세계 진실 (평가 전용 — 레이어 밖 정보, 에이전트에게는 비공개)" />)}
        </Section>)}
    </div>
  );
}

window.ExplorerScreen = ExplorerScreen;

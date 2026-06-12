// ============================================================
// explorer.jsx — corpus-v1 데이터 탐색 (독립 앱, NL 에이전트 앱과 동일 양식).
// 합칠 때: window.ExplorerScreen을 기존 앱 탭에 마운트하면 끝 (자체 부트는 window.__DB 재사용).
// 보여주는 것:
//   · 좌: 도메인별 테이블 목록 + 행 수
//   · 우: 선택 테이블 — FK 이웃 그래프(SVG) · 컬럼(타입/PK·FK/PII/코드체계/Term 역할 뱃지)
//          · 샘플 행 · 코드성 컬럼 값 분포(코드사전 라벨, 미등재면 '의미 미상')
// 레이어 오버레이: 어떤 컬럼이 어떤 Term에 어떤 역할로 걸려 있는지 — 에이전트가
//   트레이스에서 뒤지던 인벤토리를 사람 눈으로 보는 화면.
// ============================================================
const { useState: eUseState, useRef: eUseRef, useEffect: eUseEffect } = React;
const eMono = { fontFamily: "var(--mono)" };
const DOM_COLOR = { CUSTOMER: "var(--sig)", LOAN: "var(--accent)", CARD: "var(--lin)", DEPOSIT: "var(--high)", RISK: "var(--low)" };
const ROLE_COLOR = { stored_as: "var(--accent)", measured_by: "var(--sig)", identified_by: "var(--high)",
                     attribute_of: "var(--med)", dated_by: "var(--lin)", segmented_by: "var(--text)", expressed_as: "var(--low)" };

function ExplorerScreen() {
  const [ready, setReady] = eUseState(null);
  const [sel, setSel] = eUseState("LOAN_ACCT_MST");
  const [counts, setCounts] = eUseState({});
  const dbRef = eUseRef(null);
  const L = window.LAYER;

  eUseEffect(() => { (async () => {
    try {
      if (window.__DB) dbRef.current = window.__DB;
      else {
        const SQL = await initSqlJs({ locateFile: (f) => "data/" + f });
        const buf = await (await fetch("data/world.db")).arrayBuffer();
        dbRef.current = new SQL.Database(new Uint8Array(buf));
        window.__DB = dbRef.current;
      }
      const c = {};
      for (const t of L.tables) c[t.name] = dbRef.current.exec(`SELECT COUNT(*) FROM ${t.name}`)[0].values[0][0];
      setCounts(c); setReady("ok");
    } catch (e) { setReady("err: " + (e.message || e)); }
  })(); }, []);

  if (ready === null) return <ECenter>world.db(24MB) 적재 중…</ECenter>;
  if (ready !== "ok") return <ECenter>초기화 실패 — {ready} (http 서버로 실행했는지 확인)</ECenter>;

  // 컬럼 → [{term, role, value?}] 역인덱스 (레이어 오버레이)
  const colTerms = {};
  for (const t of L.terms) for (const lk of t.links || []) {
    if (lk.kind === "metric") continue;
    (colTerms[lk.asset] = colTerms[lk.asset] || []).push({ term: t.name, role: lk.role, value: lk.value });
  }
  const totalRows = Object.values(counts).reduce((a, b) => a + b, 0);
  const doms = ["CUSTOMER", "LOAN", "CARD", "DEPOSIT", "RISK"];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "330px 1fr", minHeight: "100vh" }}>
      <div style={{ borderRight: "1px solid var(--border)", padding: "18px 16px", overflowY: "auto" }}>
        <div style={{ ...eMono, fontSize: 15, fontWeight: 600 }}>corpus-v1 · 데이터 탐색</div>
        <div style={{ fontSize: 12, color: "var(--muted)", margin: "5px 0 14px" }}>
          테이블 {L.tables.length} · 컬럼 {L.columns.length} · 행 {totalRows.toLocaleString()} · Term {L.terms.length}
        </div>
        {doms.map((d) => (
          <div key={d} style={{ marginBottom: 13 }}>
            <div style={{ ...eMono, fontSize: 11, letterSpacing: "0.08em", color: DOM_COLOR[d], marginBottom: 5 }}>{d}</div>
            {L.tables.filter((t) => t.domain === d).map((t) => (
              <div key={t.name} onClick={() => setSel(t.name)}
                style={{ display: "flex", gap: 8, alignItems: "baseline", padding: "4px 8px", borderRadius: 4, cursor: "pointer",
                         background: sel === t.name ? "rgba(255,255,255,0.06)" : "transparent" }}>
                <span style={{ ...eMono, fontSize: 12, color: "var(--text)" }}>{t.name}</span>
                <span style={{ flex: 1 }} />
                <span style={{ ...eMono, fontSize: 10.5, color: "var(--dim)" }}>{(counts[t.name] || 0).toLocaleString()}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div style={{ padding: "20px 26px", overflowY: "auto" }}>
        <TableDetail db={dbRef.current} L={L} name={sel} counts={counts} colTerms={colTerms} nav={setSel} />
      </div>
    </div>
  );
}

function TableDetail({ db, L, name, counts, colTerms, nav }) {
  const t = L.tables.find((x) => x.name === name);
  const cols = L.columns.filter((c) => c.table === name);
  // FK 이웃: 나가는(이 테이블의 fk) + 들어오는(남이 나를 참조)
  const out = t.fk_edges.map((e) => ({ via: e.from.split(".")[1], to: e.to.split(".")[0] }));
  const inn = [];
  for (const ot of L.tables) if (ot.name !== name)
    for (const e of ot.fk_edges) if (e.to.split(".")[0] === name) inn.push({ from: ot.name, via: e.from.split(".")[1] });

  // 샘플 행
  let sample = [];
  try {
    const r = db.exec(`SELECT * FROM ${name} LIMIT 5`);
    if (r.length) sample = r[0].values.map((v) => Object.fromEntries(r[0].columns.map((c, i) => [c, v[i]])));
  } catch (e) {}

  // 코드성 컬럼 분포 (코드체계 보유 + 미등재 결손 컬럼 둘 다 — 결손은 '의미 미상'으로 드러난다)
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

  return (
    <div style={{ maxWidth: 980 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
        <span style={{ ...eMono, fontSize: 18, fontWeight: 700 }}>{name}</span>
        <span style={{ ...eMono, fontSize: 11, color: DOM_COLOR[t.domain] }}>{t.domain}</span>
        <span style={{ fontSize: 12.5, color: "var(--muted)" }}>grain: {t.grain}</span>
        <span style={{ ...eMono, fontSize: 11.5, color: "var(--dim)" }}>{(counts[name] || 0).toLocaleString()}행</span>
      </div>

      <FkGraph name={name} out={out} inn={inn} L={L} nav={nav} />

      <Section title={`컬럼 ${cols.length}개 — 레이어 오버레이 (Term 역할 뱃지)`}>
        <table style={{ ...eMono, fontSize: 11.5, borderCollapse: "collapse", width: "100%" }}>
          <thead><tr>{["컬럼", "타입", "키", "Description", "Term 연결"].map((h) => (
            <th key={h} style={{ textAlign: "left", padding: "4px 10px 4px 0", color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{h}</th>))}</tr></thead>
          <tbody>{cols.map((c) => {
            const col = c.id.split(".")[1];
            const dictless = !L.codedict[c.id] && /_CD$/.test(col);
            return (
              <tr key={c.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <td style={{ padding: "4px 10px 4px 0", color: "var(--text)", whiteSpace: "nowrap" }}>
                  {col}
                  {c.classification && <Badge color="var(--low)">{c.classification}</Badge>}
                  {dictless && <Badge color="var(--med)">사전 미등재</Badge>}
                </td>
                <td style={{ padding: "4px 10px 4px 0", color: "var(--dim)", whiteSpace: "nowrap" }}>{c.type}</td>
                <td style={{ padding: "4px 10px 4px 0", color: "var(--sig)", whiteSpace: "nowrap" }}>{c.pk ? "PK" : c.fk ? "FK→" + c.fk.split(".")[0] : ""}</td>
                <td style={{ padding: "4px 10px 4px 0", color: "var(--muted)", fontFamily: "var(--sans)", fontSize: 12 }}>
                  {c.description.text.split(" 값:")[0]}
                  {c.description.source === "auto" && <span style={{ ...eMono, fontSize: 9.5, color: "var(--dim)" }}> (auto)</span>}
                </td>
                <td style={{ padding: "4px 0" }}>
                  {(colTerms[c.id] || []).map((x, i) => (
                    <Badge key={i} color={ROLE_COLOR[x.role] || "var(--dim)"}>
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
        </Section>
      )}

      <Section title="샘플 행 (LIMIT 5)">
        {sample.length === 0 ? <div style={{ ...eMono, fontSize: 11.5, color: "var(--dim)" }}>(없음)</div> : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ ...eMono, fontSize: 10.5, borderCollapse: "collapse" }}>
              <thead><tr>{Object.keys(sample[0]).map((c) => (
                <th key={c} style={{ textAlign: "left", padding: "3px 12px 3px 0", color: "var(--muted)", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>{c}</th>))}</tr></thead>
              <tbody>{sample.map((r, i) => (
                <tr key={i}>{Object.values(r).map((v, j) => (
                  <td key={j} style={{ padding: "3px 12px 3px 0", color: "var(--text)", whiteSpace: "nowrap" }}>{String(v)}</td>))}</tr>))}</tbody>
            </table>
          </div>)}
      </Section>
    </div>
  );
}

// FK 이웃 그래프 — 선택 테이블 중심, 좌=들어오는 참조 / 우=나가는 참조. 클릭 항행.
function FkGraph({ name, out, inn, nav }) {
  const W = 940, rowH = 26, H = Math.max(inn.length, out.length, 1) * rowH + 46;
  const cy = H / 2;
  const node = (x, y, label, color, onClick, anchor) => (
    <g key={label + x + y} onClick={onClick} style={{ cursor: onClick ? "pointer" : "default" }}>
      <text x={x} y={y + 4} textAnchor={anchor} style={{ fill: color, fontSize: 11.5, fontFamily: "var(--mono)" }}>{label}</text>
    </g>);
  return (
    <Section title={`FK 이웃 — 들어오는 참조 ${inn.length} · 나가는 참조 ${out.length} (클릭 이동)`}>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
        {inn.map((e, i) => {
          const y = 28 + i * rowH;
          return (<g key={"i" + i}>
            <path d={`M 285 ${y} C 360 ${y}, 380 ${cy}, 425 ${cy}`} stroke="var(--border)" fill="none" />
            {node(280, y, e.from, "var(--sig)", () => nav(e.from), "end")}
            <text x={300} y={y - 5} style={{ fill: "var(--dim)", fontSize: 9, fontFamily: "var(--mono)" }}>{e.via}</text>
          </g>);
        })}
        {out.map((e, i) => {
          const y = 28 + i * rowH;
          return (<g key={"o" + i}>
            <path d={`M 515 ${cy} C 560 ${cy}, 580 ${y}, 655 ${y}`} stroke="var(--border)" fill="none" />
            {node(660, y, e.to, "var(--accent)", () => nav(e.to), "start")}
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

function Section({ title, children }) {
  return (<div style={{ marginTop: 20 }}>
    <div style={{ ...eMono, fontSize: 11, letterSpacing: "0.08em", color: "var(--muted)", marginBottom: 9 }}>{title.toUpperCase ? title : title}</div>
    {children}
  </div>);
}
function Badge({ color, children }) {
  return <span style={{ ...eMono, fontSize: 9.5, color, border: `1px solid ${color}55`, borderRadius: 4, padding: "0px 6px", marginLeft: 5, whiteSpace: "nowrap", display: "inline-block", marginBottom: 2 }}>{children}</span>;
}
function ECenter({ children }) {
  return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh", color: "var(--muted)", fontSize: 13.5 }}>{children}</div>;
}

window.ExplorerScreen = ExplorerScreen;


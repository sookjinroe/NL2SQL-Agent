// dashboard.jsx — 데이터 탐색 첫 화면. 코퍼스를 한눈에 요약.
// '중규모'라는 모호한 말을 숫자로 대체. 규모·커버리지·질문셋 분포.
// 모든 수치는 런타임에 LAYER/QUESTIONS/DB에서 계산 (하드코딩 없음).
const { useState: dUseState, useEffect: dUseEffect, useRef: dUseRef } = React;
const dMono = { fontFamily: "var(--mono)" };

function DashboardView({ db, L, Q, counts, idx, nav }) {
  // ---- 규모 ----
  const totalRows = Object.values(counts).reduce((a, b) => a + b, 0);
  const concept = L.terms.filter((t) => (t.links || []).length);
  const distractor = L.terms.filter((t) => !(t.links || []).length);

  // ---- 커버리지 ----
  const linked = new Set();
  for (const t of L.terms) for (const lk of t.links || []) if (lk.kind !== "metric") linked.add(lk.asset);
  const isMeta = (c) => c.pk || c.fk || ["CREATED_AT","UPDATED_BY","UPDATED_AT","CREATED_BY"].includes(c.id.split(".")[1]);
  const biz = L.columns.filter((c) => !isMeta(c));
  const bizLinked = biz.filter((c) => linked.has(c.id));
  const codeCols = L.columns.filter((c) => /_CD$/.test(c.id.split(".")[1]));
  const codeWithDict = codeCols.filter((c) => L.codedict[c.id]);
  const pct = (a, b) => b ? Math.round(a * 100 / b) : 0;

  // ---- 질문셋 ----
  const cats = [["normal","정상 경로"],["family","충돌 패밀리"],["granularity","입도"],["boundary","경계 결손"],["join","조인"]];
  const catCount = {}; for (const q of Q) catCount[q.cat] = (catCount[q.cat]||0)+1;
  const forced = Q.filter((q) => (q.expected_ops||[]).some((o)=>["get_column","search_columns","resolve_code","get_metric"].includes(o))).length;

  const Stat = ({ label, value, sub }) => (
    <div style={{ border: "1px solid var(--border)", borderRadius: 7, padding: "14px 16px", background: "rgba(255,255,255,0.015)" }}>
      <div style={{ ...dMono, fontSize: 11.5, letterSpacing: "0.06em", color: "var(--dim)", marginBottom: 6 }}>{label}</div>
      <div style={{ ...dMono, fontSize: 24, fontWeight: 700, color: "var(--text)" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>{sub}</div>}
    </div>);
  const Bar = ({ label, a, b, color, note }) => (
    <div style={{ marginBottom: 11 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 13, color: "var(--text)" }}>{label}</span>
        <span style={{ ...dMono, fontSize: 12.5, color: "var(--muted)" }}>{a}/{b} · {pct(a,b)}%</span>
      </div>
      <div style={{ height: 8, background: "rgba(255,255,255,0.05)", borderRadius: 4 }}>
        <div style={{ width: `${pct(a,b)}%`, height: "100%", borderRadius: 4, background: color, opacity: 0.8 }} />
      </div>
      {note && <div style={{ fontSize: 11.5, color: "var(--dim)", marginTop: 3 }}>{note}</div>}
    </div>);
  const Sec = ({ title, desc, children }) => (
    <div style={{ marginBottom: 30 }}>
      <div style={{ ...dMono, fontSize: 13, letterSpacing: "0.06em", color: "var(--muted)", marginBottom: 4 }}>{title}</div>
      {desc && <div style={{ fontSize: 12.5, color: "var(--dim)", marginBottom: 12, lineHeight: 1.55 }}>{desc}</div>}
      {children}
    </div>);

  return (
    <div style={{ padding: "22px 28px", maxWidth: 1000, margin: "0 auto" }}>
      <div style={{ marginBottom: 26 }}>
        <div style={{ fontSize: 18.5, fontWeight: 700, marginBottom: 5 }}>합성 금융 코퍼스 — 시맨틱 레이어 소비 검증</div>
        <div style={{ fontSize: 14, color: "var(--muted)", lineHeight: 1.6 }}>
          충분히 채워진 시맨틱 레이어를 전제로, 그 레이어를 소비하는 NL2SQL 에이전트의 로직이 성립하는지 검증하기 위한 합성 데이터셋.
          5개 도메인(고객·여신·카드·수신·리스크)에 걸친 스키마와 의미 레이어, 그리고 조회 행동을 검증하는 질문셋으로 구성된다.
        </div>
      </div>

      <Sec title="규모">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
          <Stat label="테이블" value={L.tables.length} sub="5개 도메인" />
          <Stat label="컬럼" value={L.columns.length} />
          <Stat label="행" value={totalRows.toLocaleString()} />
          <Stat label="Term" value={L.terms.length} sub={`개념 ${concept.length} · distractor ${distractor.length}`} />
          <Stat label="메트릭" value={L.metrics.length} sub="정본 지표" />
          <div onClick={() => nav && nav("codedict")} style={{ cursor: "pointer" }}><Stat label="코드체계" value={Object.keys(L.codedict).length} sub="코드사전 →" /></div>
        </div>
      </Sec>

      <Sec title="레이어 커버리지" desc="'충분히 채워졌다'는 전제를 수치로. 의미 컬럼의 링크율이 높고 Description은 전수 존재하며, 코드사전 일부는 경계 검증을 위해 의도적으로 비워 둠.">
        <Bar label="Link 걸린 컬럼 (비즈니스 컬럼 기준)" a={bizLinked.length} b={biz.length} color="var(--accent)"
          note={`전체 ${L.columns.length}개 중 PK/FK/감사 컬럼 ${L.columns.length-biz.length}개 제외`} />
        <Bar label="Description 있는 컬럼" a={L.columns.filter((c)=>(c.description||{}).text).length} b={L.columns.length} color="var(--sig)" />
        <Bar label="코드 컬럼 사전 등재" a={codeWithDict.length} b={codeCols.length} color="var(--high)"
          note={`미등재 ${codeCols.length-codeWithDict.length}개 — 경계 결손 검증용 의도적 공백`} />
      </Sec>

      <Sec title="질문셋 — 조회 행동 검증" desc="에이전트가 '레이어를 충분히 조회하지 않으면 틀리도록' 설계된 질문 비중을 높임. 강제형은 형식 확인·코드 변환·증거 폴백 등 조회를 건너뛰면 실패하는 문항.">
        <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
          <Stat label="총 질문" value={Q.length} />
          <Stat label="조회 강제형" value={`${forced}`} sub={`전체의 ${pct(forced,Q.length)}%`} />
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", height: 100, marginTop: 8 }}>
          {cats.map(([k,label]) => {
            const n = catCount[k]||0; const max = Math.max(...Object.values(catCount));
            return (
              <div key={k} onClick={() => nav && nav("question", Q.find((q)=>q.cat===k)?.id)}
                style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", cursor: "pointer" }}>
                <div style={{ ...dMono, fontSize: 13, color: "var(--text)", marginBottom: 4 }}>{n}</div>
                <div style={{ width: "100%", height: `${n/max*70}px`, background: "var(--accent)", opacity: 0.7, borderRadius: "3px 3px 0 0" }} />
                <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6, textAlign: "center" }}>{label}</div>
              </div>);
          })}
        </div>
      </Sec>

      <Sec title="설계된 모호성" desc="같은 표현이 여러 도메인·입도의 개념에 걸리도록 의도 설계. 에이전트가 조용히 한쪽을 고르지 않고 확인·탐색하는지 검증한다.">
        <div style={{ display: "flex", gap: 12 }}>
          <Stat label="충돌 패밀리" value={Object.keys(idx.families).length} sub="도메인 간 충돌 군" />
          <Stat label="동의어 충돌" value={idx.collisions.length} sub="복수 Term에 닿는 표면형" />
          <div style={{ flex: 1, display: "flex", alignItems: "center" }}>
            <span onClick={() => nav && nav("collision")} style={{ ...dMono, fontSize: 12.5, color: "var(--lin)", cursor: "pointer",
              border: "1px solid var(--lin)66", borderRadius: 5, padding: "8px 14px" }}>충돌 지도 보기 →</span>
          </div>
        </div>
      </Sec>
    </div>
  );
}
window.DashboardView = DashboardView;

// ============================================================
// intro.jsx — NL 에이전트 소개 화면.
//   정체와 역할 / 쓰는 도구 / 행동지침(어떻게) / 루프 종료와 트리거.
//   앱 디자인 토큰(--accent·--sig·--lin·--panel·--border, IBM Plex)에 맞춤.
//   (NL2SQL 팔레트: --muted=중간, --dim=가장 옅음)
// window.NLIntro 로 노출.
// ============================================================
(function () {
  const mono = { fontFamily: "var(--mono)" };
  const RULE = "var(--border)";

  function Eyebrow({ children }) {
    return (
      <div style={{ ...mono, fontSize: 12, letterSpacing: "0.24em", textTransform: "uppercase",
                    color: "var(--muted)", marginBottom: 14 }}>{children}</div>
    );
  }
  function SectionHead({ n, label }) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 13, margin: "46px 0 18px" }}>
        <span style={{ ...mono, fontSize: 13, color: "var(--accent)" }}>{n}</span>
        <span style={{ ...mono, fontSize: 15, letterSpacing: "0.04em", color: "var(--text)" }}>{label}</span>
        <span style={{ flex: 1, height: 1, background: RULE }} />
      </div>
    );
  }
  function Tool({ name, args, tag, tagColor, desc }) {
    return (
      <div style={{ border: `1px solid ${RULE}`, borderRadius: 7, padding: "12px 14px", background: "var(--panel)" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
          <span style={{ ...mono, fontSize: 14.5, color: "var(--sig)", fontWeight: 500 }}>{name}</span>
          {args && <span style={{ ...mono, fontSize: 12, color: "var(--dim)" }}>{args}</span>}
          {tag && (
            <span style={{ ...mono, fontSize: 10.5, color: tagColor, border: `1px solid ${tagColor}66`,
                           borderRadius: 4, padding: "1px 6px", marginLeft: "auto" }}>{tag}</span>
          )}
        </div>
        <div style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.55 }}>{desc}</div>
      </div>
    );
  }
  function Principle({ accent, lead, body }) {
    return (
      <div style={{ border: `1px solid ${RULE}`, borderLeft: `3px solid ${accent}`, borderRadius: 6,
                    padding: "13px 16px", background: "var(--panel)" }}>
        <div style={{ fontSize: 15, color: "var(--text)", fontWeight: 600, marginBottom: 5 }}>{lead}</div>
        <div style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.6 }}>{body}</div>
      </div>
    );
  }
  function SpecRow({ k, children }) {
    return (
      <div style={{ display: "flex", gap: 16, padding: "11px 14px", borderTop: `1px solid ${RULE}` }}>
        <span style={{ ...mono, fontSize: 12, color: "var(--dim)", width: 124, flexShrink: 0, paddingTop: 1 }}>{k}</span>
        <span style={{ fontSize: 13.5, color: "var(--text)", lineHeight: 1.55 }}>{children}</span>
      </div>
    );
  }

  function NLIntro() {
    return (
      <div style={{ maxWidth: 940, margin: "0 auto", padding: "40px 28px 100px" }}>
        {/* 히어로 */}
        <Eyebrow>NL2SQL · corpus-v1 — 시맨틱 레이어 소비</Eyebrow>
        <h1 style={{ ...mono, fontSize: 32, fontWeight: 600, margin: "0 0 12px", letterSpacing: "-0.01em", color: "var(--text)" }}>
          NL 에이전트
        </h1>
        <p style={{ fontSize: 16, color: "var(--muted)", lineHeight: 1.6, margin: 0, maxWidth: 700 }}>
          자연어 질문 하나를 받아, 레이어 <b style={{ color: "var(--text)" }}>8연산</b>만으로 SQLite <span style={mono}>SELECT</span> 한 문장을 만든다 —
          또는 답할 수 없는 이유를 정직하게 보고한다.
        </p>

        {/* 1. 정체와 역할 */}
        <SectionHead n="01" label="정체와 역할" />
        <div style={{ border: `1px solid ${RULE}`, borderRadius: 8, padding: "18px 20px", background: "var(--panel)" }}>
          <div style={{ fontSize: 14.5, color: "var(--muted)", lineHeight: 1.7 }}>
            충분히 채워진 시맨틱 레이어를 <b style={{ color: "var(--text)" }}>소비</b>하는 NL2SQL 에이전트다.
            전제는 <b style={{ color: "var(--text)" }}>스키마 전문이 주어지지 않는다</b>는 것 — 테이블·컬럼·코드값·지표에 대한 모든 지식은 8연산 조회 결과에서만 오고,
            조회하지 않은 것을 아는 척하지 않는다.
          </div>
          <div style={{ height: 1, background: RULE, margin: "16px 0" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 12, ...mono, fontSize: 13.5, flexWrap: "wrap" }}>
            <span style={{ color: "var(--sig)" }}>자연어 질문</span>
            <span style={{ color: "var(--dim)" }}>→ 8연산 조회 →</span>
            <span style={{ color: "var(--high)" }}>SELECT 한 문장</span>
            <span style={{ color: "var(--dim)" }}>/</span>
            <span style={{ color: "var(--med)" }}>clarify</span>
            <span style={{ color: "var(--low)" }}>cannot_answer</span>
          </div>
        </div>

        {/* 2. 쓰는 도구 */}
        <SectionHead n="02" label="쓰는 도구 · 레이어 8연산" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 10 }}>
          <Tool name="resolve_terms" args="{query}" tag="필수 시작" tagColor="var(--accent)"
                desc="질문 구절을 Term 후보 목록으로(동의어 포함). 순위·family 신호는 숨겨 함정 힌트를 차단한다." />
          <Tool name="get_term" args="{term}"
                desc="Term 상세 — 정의·동의어·valid_values·links. links의 역할(role)이 어느 컬럼/지표를 어떻게 쓸지의 핵심 단서." />
          <Tool name="resolve_code" args="{column, query}"
                desc="비즈니스 표현 → 실제 코드 리터럴('기한이익상실'→'03'). 사전 없으면 error로 부재를 알린다." />
          <Tool name="get_column" args="{id}"
                desc="컬럼 상세. 특히 날짜·연월의 저장 형식('YYYY-MM-DD' vs 'YYYYMM')을 확인하는 자리." />
          <Tool name="get_table" args="{name}"
                desc="테이블 grain·컬럼 목록·FK 엣지." />
          <Tool name="get_join_path" args="{a, b}"
                desc="두 테이블을 잇는 FK 그래프 경로(복수면 모두). 조인은 이 경로의 FK만 쓴다." />
          <Tool name="get_metric" args="{metric}"
                desc="정본 지표의 정의식·grain·기준 필터(base_filters). 비율·평균·총계 질문의 정답 근거." />
          <Tool name="search_columns" args="{query}" tag="폴백 전용" tagColor="var(--dim)"
                desc="Description 유사도 매칭. Term 매칭이 실패했을 때만 쓰고, 이걸로 확정하면 신뢰도를 낮춘다." />
        </div>

        {/* 3. 행동지침 */}
        <SectionHead n="03" label="행동지침 · 어떻게 움직이는가" />
        <div style={{ display: "grid", gap: 10 }}>
          <Principle accent="var(--accent)" lead="자율 루프, 단 하나의 고정 진입점"
            body="정해진 워크플로우를 따르지 않는다. resolve_terms로 시작한다는 것만 강제되고, 그 뒤부터는 매 턴 받은 조회 결과를 보고 다음에 어떤 연산을 할지 스스로 정하는 need-loop." />
          <Principle accent="var(--sig)" lead="증거에 묶인 보수성"
            body="확인한 것만 사실로 취급한다. 막히면 둘 중 하나로 반응한다 — 해석이 갈리면 clarify로 '미루고', 첫 조회가 실패하면 폴백·재경로로 '더 캔다'. 두 트리거는 다르다(모호성 vs 결과 실패)." />
          <Principle accent="var(--lin)" lead="불확실성은 숨기지 않는다"
            body="가정을 깔고 진행할 땐 assumptions에 명시하고 confidence를 낮춘다. 근거가 없으면 답을 발명하지 않고 cannot_answer로 종결한다 — 정직한 거절을 실패가 아니라 올바른 행동으로 본다." />
        </div>

        {/* 4. 루프 종료와 트리거 */}
        <SectionHead n="04" label="루프 종료와 트리거" />
        <div style={{ border: `1px solid ${RULE}`, borderRadius: 8, overflow: "hidden", background: "var(--panel)" }}>
          <div style={{ padding: "11px 14px", fontSize: 13.5, color: "var(--muted)", lineHeight: 1.55 }}>
            매 턴 조회 결과를 되먹여 다음 행동을 정하는 need-loop. JSON 하나씩만 출력한다(마크다운 금지).
          </div>
          <SpecRow k="진입">모든 질의는 resolve_terms로 시작.</SpecRow>
          <SpecRow k="종료 액션"><span style={mono}>sql</span> / <span style={mono}>clarify</span> / <span style={mono}>cannot_answer</span> 중 하나.</SpecRow>
          <SpecRow k="연산 상한">질문당 10연산 · 상한 도달 시 강제 종결(cannot_answer).</SpecRow>
          <SpecRow k="중복 가드">같은 op를 같은 인자로 반복하면 무시된다.</SpecRow>
          <SpecRow k="실패 트리거">모델 호출 자체가 실패하면 cannot_answer로 안전 종결.</SpecRow>
        </div>
      </div>
    );
  }

  window.NLIntro = NLIntro;
})();

// agent-analyst-v0 — 분석 리포트 실험 계약 (v0).
// 기존 agent-core-v2(단일 질문 계약)는 무접촉. 루프 골격·도구·자동 실측을
// 상속하되 정체성·출력·예산만 교체한 형제 프롬프트.
// F01 관찰("지난 분기 대출 실적 분석" → 계획 4안을 만들고 clarify로 반납)이
// 설계 근거: 분해 능력은 이미 있고, 그것을 스스로 실행할 권한과 예산이 없었음.
// v0는 측정 목적 — Haiku가 20~30턴 단일 컨텍스트에서 기준 일관성을 유지하는지
// (BD05류 필터 누출이 분석 길이에서 재발하는지)가 1차 관찰 대상.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AgentAnalystV0 = factory();
})(typeof self !== "undefined" ? self : this, function () {

  const MAX_LOOKUP = 10;
  const MAX_TRYSQL = 14;  // 분석 축 4~6 × (초안+진단 여유) + 종합 검증

  function sysPrompt(catalogMap) {
    const _d = (y, m) => new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
    const _now = new Date(); const _y = _now.getUTCFullYear(); const _m = _now.getUTCMonth(); const _q = Math.floor(_m / 3);
    const today = _now.toISOString().slice(0, 10);
    const bounds = `이번 달 [${_d(_y, _m)} ~ ${_d(_y, _m + 1)}), 지난 달 [${_d(_y, _m - 1)} ~ ${_d(_y, _m)}), 이번 분기 [${_d(_y, _q * 3)} ~ ${_d(_y, _q * 3 + 3)}), 지난 분기 [${_d(_y, _q * 3 - 3)} ~ ${_d(_y, _q * 3)}), 올해 [${_d(_y, 0)} ~ ${_d(_y + 1, 0)})
진행 중 기간의 공정 비교: 이번 달 진행분 [${_d(_y, _m)} ~ ${today}) ↔ 전월 동일 일수 [${_d(_y, _m - 1)} ~ ${new Date(Date.UTC(_y, _m - 1, _now.getUTCDate())).toISOString().slice(0, 10)})`;
    return `너는 시맨틱 레이어를 소비하는 데이터 분석 에이전트다. 분석 목적 하나를 받아
분석 계획을 선언하고, 여러 SQL을 실행해 확인한 뒤, 근거가 붙은 리포트로 답한다.
단일 사실 질문이면 계획 없이 SQL 하나로 답해도 된다.

오늘 날짜는 ${today}다. 상대 시간의 경계는 시스템이 계산해 두었다.
아래 경계를 그대로 쓰고, 여기 없는 표현(예: 최근 90일)만 오늘 날짜로 직접 계산하라.
${bounds}
(반열림 구간: 시작일 이상, 끝일 미만)

━━━ 지도 ━━━
${catalogMap}
━━━━━━━━━━

[연산 — action:"op"로 호출한다. 조회 연산과 try_sql은 횟수 제한이 따로 있고,
 남은 횟수는 매 턴 [남은 예산]으로 표시된다]
- search {query}          용어·지표·컬럼·테이블 통합 검색. 정확 일치 우선, kind로 구분.
- browse_terms {domain}   도메인의 용어 열람 (정의·유의어·자산 위치)
- get_column {id}         컬럼 상세. id는 "테이블.컬럼".
- resolve_code {column, query}   코드 컬럼의 값↔라벨 사전 조회.
- get_join_path {table_a, table_b}   FK 조인 경로. 조인은 이 경로만 쓴다.
- try_sql {sql}           SELECT 하나를 실행해 결과를 확인한다.
- compute {code}          JS 코드를 실행한다. sql("SELECT ...") 헬퍼로 여러 쿼리를
                          한 번에 배치 실행하고, 계산·판정·검산을 코드로 하라.
                          log(...)로 남긴 것만 결과로 돌아온다. 동기 코드만.
                          예: 지평+정의 확인 배치, 기대치·표준편차 판정,
                          부분합=전체 검산. 리포트의 모든 수치는 try_sql 또는
                          compute의 실행에서 나와야 한다.

[컬럼 메타 읽는 법]
- description: 의미 서술 + confidence + needs_review. needs_review이거나 MEDIUM 이하인
  컬럼에 기댄 수치는 리포트의 caveats에 그 사실을 적는다.
- capability: entity(식별자·집계 앵커) / dimension_categorical(범주 필터·group-by) /
  dimension_time(기간 필터는 이 컬럼으로) / measure(SUM·AVG 대상).
- format: 저장 형식. 날짜 리터럴은 반드시 이 형식을 따른다.
- aggregation.additive: no면 SUM 금지, semi면 동일 시점 안에서만 합산.
- 테이블 grain("한 행 = 무엇"): 조인하면 행이 그 단위로 불어난다. 지표를 그룹별로
  분해할 때도 세는 단위를 유지하라 — 대출 단위 비율이면 COUNT(DISTINCT 대출 id).

[분석가의 시각 — 절차 목록이 아니라 모든 판단에 적용하는 태도다. 각 시각 아래
 예시는 규칙이 아니라 그 시각이 행동으로 나타난 견본이다]
V1. 질문도 검증 대상이다. 분석은 전제 확인에서 시작한다 — 데이터가 어느 기간까지
    있는지(지평), 핵심 개념의 조작적 정의가 데이터와 맞는지, 그리고 질문이 딛고
    선 전제가 실측으로 성립하는지. "왜 높은가"를 받으면 정말 높은지부터 —
    효과의 크기를 우연 변동(모수 대비 편차)과 견줘라 — "통계적으로 유의"는
    계산 없이 쓰는 말이 아니다. compute 견본:
    const z=(obs-n*p)/Math.sqrt(n*p*(1-p)); log("z=",z.toFixed(2), Math.abs(z)<2?"우연 범위":"유의미한 편차");
    전제가 무너지면 그 판정 자체가 발견이다: 질문의 의도(무엇을 결정하려
    했는가)에 답하라.
V2. 숫자는 맥락 위에서만 의미다. 비교선 없는 수치는 발견이 아니다 — 직전 한 점보다
    추세 맥락이 낫고(급증인지 추세의 연장인지가 갈린다), 진행 중 기간은 위의
    동일 일수 경계로 비교하고, 구성비·기여도로 "누가 끌었는가"를 분해하라.
V3. 내 계산이 첫 번째 용의자다. 핵심 수치는 독립 경로로 검산하라(부분합=전체,
    건수×평균≈합계). 이상 규모(100%를 넘는 비율, 자릿수 이탈, 전부 0)를 보면
    데이터를 의심하기 전에 순서대로: 조인 grain → 리터럴 → 필터 → 데이터 →
    데이터 생성 과정. 하위 grain 테이블(회차·거래)은 조인하지 말고 EXISTS나
    서브쿼리로 판정만 하라 — 조인된 상태의 SUM·AVG는 팬아웃으로 부푼다.
V4. 분석은 질문의 연쇄다. 각 결과가 다음 질문을 정한다 — 계획은 개정 가능한
    프레임이며, 발견이 축을 바꾸면 plan을 다시 선언하라. 급증·역행·전부 0 같은
    이상은 계획에 없던 쿼리로 파고들 가치가 있다. "차이 없음"과 "전제 불성립"도
    판정이다 — 판정에 도달했으면 예산이 남아도 그 축은 끝난 것이다.
V5. 독자를 생각하라. 이 수치로 의사결정자가 무엇을 할 것인가. 변화에는 리스크
    신호를 짝지어라(성장 수치 옆에 신규 연체 유입). 지표 값과 그 값의 신뢰 조건을
    함께 보고하라(예: "연체율 양호 — 단 자산 77%가 미성숙이라 검증 전").
    "하이라이트"·"현황"처럼 관례로 스코프가 정해지는 요구는 스스로 스코프를 정하고
    가정을 명시하라.

[계획과 완주]
- SQL 실행 전에 action:"plan"으로 분석 축(3~6개)과 비교 기준을 선언한다.
  선언한 계획은 매 턴 [분석 계획]으로 표시된다.
- 리포트는 계획의 모든 축이 판정에 도달했을 때 제출한다. 판정은 원인·수치일
  수도, "차이 없음"·"전제 불성립"일 수도 있다. 판정에 도달하지 못한 축만
  사유와 함께 caveats에 남긴다 — 예산이 남아 있는 동안 "추가 조사 필요"는
  사유가 아니다.
- 기준의 일관성: 같은 리포트 안의 모든 수치는 같은 기준(지표 정의·상태 필터·
  기간)을 쓰고, 기준은 basis에 한 번 선언한다.
- 레이어 규율은 그대로다: 리터럴은 확인된 출처(resolve_code·조회한 실제 값·
  format)에서만, 고유명사는 이름 컬럼 보유 차원 테이블에서 실측 확정,
  조회로 정해지는 것은 묻지 않는다.

[출력 — JSON 하나만. 마크다운 펜스·설명 텍스트 금지]
연산:   {"action":"op","op":"<연산명>","args":{...},"thinking":"한 문장"}
계획:   {"action":"plan","axes":["축 이름 3~6개"],"comparison":"비교 기준 한 줄","thinking":"한 문장"}
        (SQL 실행 전에 한 번 — 이후 계획 수정이 필요하면 다시 선언해도 된다)
리포트: {"action":"report",
        "title":"리포트 제목",
        "basis":"이 리포트의 공통 기준 한 줄 (기간·상태 필터·지표 정의)",
        "sections":[{"heading":"섹션 제목","finding":"수치가 든 발견 서술","sql_ref":[1,3]}],
        "summary":"핵심 발견 2~4문장 종합",
        "caveats":["한계·주의"],
        "confidence":"HIGH"|"MEDIUM"|"LOW","thinking":"한 문장"}
        sql_ref는 그 섹션의 수치가 나온 실행 기록의 [Q번호] 목록이다 — SQL을 다시
        쓰지 마라. 한 쿼리가 여러 섹션의 근거여도 되고, 한 섹션이 여러 쿼리를
        참조해도 된다. finding의 수치는 참조한 실행 결과의 숫자여야 한다.
단답:   {"action":"sql","sql":"SELECT ...","assumptions":[...],"confidence":"...","thinking":"한 문장"}
        (단일 사실 질문일 때만)
확인:   {"action":"clarify","clarify_question":"...","options":[...],"thinking":"한 문장"}
        (분석의 대상 자체가 정해지지 않아 서로 다른 분석이 되는 경우 — 그때는
        각 옵션이 어떤 분석을 낳는지까지 제시하라. 축 선택·관례적 스코프는
        묻지 말고 스스로 정한다)
불가:   {"action":"cannot_answer","reason":"원인 진단 포함","thinking":"한 문장"}

같은 연산을 같은 인자로 반복하면 무시된다.
남은 연산 횟수가 0이 되면 반드시 최종 액션 중 하나를 내라.`;
  }

  function userPrompt(question, log, lookupLeft, sqlLeft, plan) {
    const parts = [`[분석 목적] ${question}`];
    // 계획을 시스템이 붙들고 매 턴 주입 — thinking은 다음 턴에 휘발되어
    // 모델이 자기 계획을 볼 수 없었음 (__29_ F01: 5축 계획 후 1축만 실행하고 종료).
    // 경계표·자동 실측과 같은 "상태는 시스템이 유지" 장치.
    if (plan) {
      const okSql = log.filter((e) => (e.op === "try_sql" || e.op === "compute") && e.result && e.result.ok === true).length;
      parts.push(``, `[분석 계획 — 선언됨] 축: ${plan.axes.map((a, i) => `${i + 1}. ${a}`).join(" / ")}`,
                 `비교 기준: ${plan.comparison || "(미선언)"} · 성공한 try_sql: ${okSql}회`,
                 `리포트는 모든 축을 실행했거나 미실행 축의 사유를 caveats에 적은 뒤에만 제출하라.`);
    }
    if (log.length) {
      parts.push(``, `[연산 기록]`);
      let qNo = 0;
      log.forEach((e, i) => {
        let body = JSON.stringify(e.result);
        const cap = e.op === "try_sql" ? 1400 : 900;
        if (body.length > cap) body = body.slice(0, cap) + "…(생략)";
        // 성공한 try_sql에 참조 번호 부여 — 리포트 섹션은 SQL 전문 대신 이 번호를 가리킴
        // (__30_: SQL 전문 복사가 리포트를 비대하게 해 잘림 유발 + 묶음 쿼리를 축별로
        //  재작성해 미실측 오탐 5/5. 번호 참조로 두 문제를 원리에서 제거)
        const tag = ((e.op === "try_sql" || e.op === "compute") && e.result && e.result.ok === true) ? ` [Q${++qNo}]` : "";
        parts.push(`${i + 1}.${tag} ${e.op}(${JSON.stringify(e.args)}) → ${body}`);
        if (e.note) parts.push(`   [안내] ${e.note}`);
      });
    }
    parts.push(``, `[남은 예산] 조회 ${lookupLeft}회 · try_sql ${sqlLeft}회`, ``, `JSON 하나로 답하라.`);
    return parts.join("\n");
  }

  const CHILD_GRAIN_TABLES = ["m_loan_repayment_schedule", "m_loan_transaction", "m_savings_account_transaction",
                              "m_loan_charge", "m_savings_account_charge", "m_loan_disbursement_detail"];

  async function run({ question, complete, layerCall, computeCall, catalogMap, onEvent }) {
    const emit = onEvent || (() => {});
    const log = [], opsTrace = [];
    const seen = new Set();
    let turns = 0;
    let plan = null;              // action:"plan"으로 선언된 분석 계획 (시스템이 유지)
    let planBounced = false;      // 미완주 리포트 반려는 1회만 (영구 루프 방지)
    let lookupUsed = 0, sqlUsed = 0;
    const sys = sysPrompt(catalogMap);
    const normSql = (s) => String(s).replace(/\s+/g, " ").trim().replace(/;$/, "");
    const HARD_TURN_CAP = MAX_LOOKUP + MAX_TRYSQL + 6;

    for (let t = 0; t <= HARD_TURN_CAP; t++) {
      turns++;
      let resp;
      try {
        resp = await complete(sys, userPrompt(question, log, MAX_LOOKUP - lookupUsed, MAX_TRYSQL - sqlUsed, plan));
      } catch (e) {
        return { final: { action: "cannot_answer", reason: "모델 호출 실패: " + (e.message || e) },
                 log, opsTrace, turns, error: String(e.message || e) };
      }
      if (resp.thinking) await emit({ type: "think", text: resp.thinking });

      const KNOWN_OPS = ["browse_terms", "search", "search_terms", "get_column", "resolve_code", "get_join_path", "try_sql", "compute"];
      if (KNOWN_OPS.includes(resp.action)) {
        const args = { ...resp }; delete args.action; delete args.thinking;
        resp = { action: "op", op: resp.action, args, thinking: resp.thinking };
      }

      // 단답 sql의 실측 강제는 v2와 동일 (자동 대행)
      if (resp.action === "sql" && resp.sql) {
        const verified = log.some((e) => e.op === "try_sql" && e.result && e.result.ok === true
                                          && normSql((e.args || {}).sql || "") === normSql(resp.sql));
        if (!verified && sqlUsed < MAX_TRYSQL) {
          sqlUsed++;
          await emit({ type: "note", text: "프로토콜: 미실측 SQL — 자동 실측 수행" });
          await emit({ type: "op_request", op: "try_sql", args: { sql: resp.sql } });
          const ar = await layerCall("try_sql", { sql: resp.sql });
          if (ar.public && ar.public.ok === false) sqlUsed--;
          opsTrace.push({ op: "try_sql", args: { sql: resp.sql }, hit: ar.raw && ar.raw._hit === false ? false : true, auto: true });
          log.push({ op: "try_sql", args: { sql: resp.sql }, result: ar.public, auto: true,
                     note: "제출 SQL 자동 실측. ok=true고 결과가 상식적이면 같은 SQL을 그대로 재제출하라. 오류·0행·이상 규모면 진단하고 수정하라." });
          await emit({ type: "op_done", op: "try_sql", args: { sql: resp.sql }, result: ar.public });
          continue;
        }
        if (!verified) await emit({ type: "note", text: "try_sql 예산 소진 상태로 미실측 SQL 제출 허용" });
      }

      if (resp.action === "plan" && Array.isArray(resp.axes) && resp.axes.length) {
        plan = { axes: resp.axes.map(String), comparison: resp.comparison ? String(resp.comparison) : null };
        await emit({ type: "note", text: `계획 선언: ${plan.axes.length}축 · 비교 기준 ${plan.comparison ? "○" : "✗ 미선언"}` });
        log.push({ op: "plan", args: { axes: plan.axes, comparison: plan.comparison },
                   result: { ok: true, note: "계획이 저장되어 매 턴 표시된다." } });
        continue;
      }

      // 리포트 실측 검증: sql_ref(실행 기록 번호)의 유효성으로 판정.
      // 문자열 대조(__30_에서 묶음 쿼리 재작성으로 오탐 5/5)를 번호 참조로 대체.
      if (resp.action === "report") {
        const okList = log.filter((e) => (e.op === "try_sql" || e.op === "compute") && e.result && e.result.ok === true)
                          .map((e) => e.op === "compute" ? "-- compute --\n" + ((e.args || {}).code || "") : ((e.args || {}).sql || ""));
        const okSqls = new Set(okList.map(normSql));
        const sections = resp.sections || [];
        for (const sec of sections) {
          const refs = Array.isArray(sec.sql_ref) ? sec.sql_ref : (sec.sql_ref != null ? [sec.sql_ref] : []);
          const valid = refs.filter((n) => Number.isInteger(n) && n >= 1 && n <= okList.length);
          if (valid.length) sec.sql = valid.map((n) => okList[n - 1]).join(";\n");
          sec._ref_ok = valid.length > 0 && valid.length === refs.length;
        }
        const unverified = sections.filter((s) => !s._ref_ok && !(s.sql && okSqls.has(normSql(s.sql))));
        if (unverified.length) {
          resp._unverified_sections = unverified.map((s) => s.heading);
          await emit({ type: "note", text: `주의: 미실측 섹션 ${unverified.length}/${sections.length} — ${unverified.map((s) => s.heading).join(", ")}` });
        }
        // 미완주 반려 (1회): 계획 축보다 섹션이 적고 예산이 남으면 완주 요구.
        // 자동 실측 대행과 같은 프로토콜 레벨 바운스 — 산문 지시의 이행률(0~80%)에 기대지 않음.
        if (plan && !planBounced && sections.length < plan.axes.length && (MAX_TRYSQL - sqlUsed) >= 2) {
          planBounced = true;
          const caveatText = JSON.stringify(resp.caveats || []);
          const missing = plan.axes.filter((a) => !sections.some((sec) => (sec.heading || "").includes(a.slice(0, 4))) &&
                                                  !caveatText.includes(a.slice(0, 4)));
          if (missing.length) {
            await emit({ type: "note", text: `프로토콜: 계획 미완주 리포트 반려 — 미실행 축 ${missing.length}개, 남은 try_sql ${MAX_TRYSQL - sqlUsed}회` });
            log.push({ op: "report(반려)", args: { sections: sections.map((s) => s.heading) },
                       result: { error: `계획 ${plan.axes.length}축 중 ${sections.length}섹션만 제출됨. 남은 예산으로 미실행 축(${missing.join(", ")})을 실행하거나, 실행하지 않는 사유를 caveats에 축 이름과 함께 적고 재제출하라.` } });
            continue;
          }
        }
        if (plan && !plan.comparison && !resp.basis) resp._no_comparison = true;
        if (plan) resp._plan = plan;
      }

      if (resp.action === "op" && resp.op === "compute") {
        if (!computeCall) {
          log.push({ op: "compute", args: {}, result: { error: "compute 미지원 환경 — try_sql을 쓰라." } });
          continue;
        }
        if (sqlUsed >= MAX_TRYSQL) {
          log.push({ op: "compute", args: {}, result: { error: "실행 예산 소진 — 지금까지의 실측으로 리포트를 내라." } });
          await emit({ type: "note", text: "실행 예산 소진" });
          continue;
        }
        const code = (resp.args || {}).code || "";
        const key = "compute::" + code;
        if (seen.has(key)) {
          log.push({ op: "compute", args: { code }, result: { error: "중복 호출 — 무시됨." } });
          continue;
        }
        seen.add(key);
        sqlUsed++;
        await emit({ type: "op_request", op: "compute", args: { code } });
        const r = await computeCall(code, CHILD_GRAIN_TABLES);
        if (!r.ok) sqlUsed--;  // 실패한 compute는 예산 미차감 (try_sql과 동일 규칙)
        const pub = r.ok ? { ok: true, logs: r.logs, note: (r.notes || []).join(" / ") || undefined }
                         : { ok: false, error: r.error, logs: r.logs || undefined };
        opsTrace.push({ op: "compute", args: { code }, hit: true });
        log.push({ op: "compute", args: { code }, result: pub });
        await emit({ type: "op_done", op: "compute", args: { code }, result: pub });
        continue;
      }

      if (resp.action === "op") {
        const isSql = resp.op === "try_sql";
        if (isSql && sqlUsed >= MAX_TRYSQL) {
          log.push({ op: resp.op, args: resp.args || {}, result: { error: "try_sql 예산 소진 — 지금까지의 실측으로 리포트를 내라." } });
          await emit({ type: "note", text: "try_sql 예산 소진" });
          continue;
        }
        if (!isSql && lookupUsed >= MAX_LOOKUP) {
          log.push({ op: resp.op, args: resp.args || {}, result: { error: "조회 예산 소진 — 지금까지의 정보로 진행하라." } });
          await emit({ type: "note", text: "조회 예산 소진" });
          continue;
        }
        const key = resp.op + "::" + JSON.stringify(resp.args || {});
        if (seen.has(key)) {
          log.push({ op: resp.op, args: resp.args || {}, result: { error: "중복 호출 — 무시됨. 이미 받은 결과로 진행하라." } });
          await emit({ type: "note", text: `중복 호출 무시: ${resp.op}` });
          continue;
        }
        seen.add(key);
        if (isSql) sqlUsed++; else lookupUsed++;
        await emit({ type: "op_request", op: resp.op, args: resp.args || {} });
        const r = await layerCall(resp.op, resp.args || {});
        if (isSql && r.public && r.public.ok === false) sqlUsed--;
        opsTrace.push({ op: resp.op, args: resp.args || {}, hit: r.raw && r.raw._hit === false ? false : true });
        const entry = { op: resp.op, args: resp.args || {}, result: r.public };
        if (isSql && r.public && r.public.ok) {
          // 팬아웃 정적 경고 + 단위 환산 힌트 (분석 계약 전용 — v2 경로 무접촉)
          const fw = (typeof ComputeCore !== "undefined" ? ComputeCore
                       : (typeof require !== "undefined" ? require("./compute-core.js") : null));
          if (fw) {
            const w = fw.fanoutCheck((resp.args || {}).sql || "", CHILD_GRAIN_TABLES);
            const uh = fw.unitHints(r.public.rows || []);
            const both = [w, uh].filter(Boolean).join(" / ");
            if (both) entry.note = (entry.note ? entry.note + " / " : "") + both;
          }
        }
        log.push(entry);
        await emit({ type: "op_done", op: resp.op, args: resp.args || {}, result: r.public });
        continue;
      }

      return { final: resp, log, opsTrace, turns };
    }
    return { final: { action: "cannot_answer", reason: "턴 상한 도달 — 계획이 수렴하지 않음" },
             log, opsTrace, turns };
  }

  return { sysPrompt, run, MAX_LOOKUP, MAX_TRYSQL };
});

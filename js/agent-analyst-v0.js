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
    const bounds = `이번 달 [${_d(_y, _m)} ~ ${_d(_y, _m + 1)}), 지난 달 [${_d(_y, _m - 1)} ~ ${_d(_y, _m)}), 이번 분기 [${_d(_y, _q * 3)} ~ ${_d(_y, _q * 3 + 3)}), 지난 분기 [${_d(_y, _q * 3 - 3)} ~ ${_d(_y, _q * 3)}), 올해 [${_d(_y, 0)} ~ ${_d(_y + 1, 0)})`;
    return `너는 시맨틱 레이어를 소비하는 데이터 분석 에이전트다. 분석 목적 하나를 받아
스스로 분석 계획을 세우고, 여러 SQL을 실행해 확인한 뒤, 근거가 붙은 리포트로 답한다.
단일 사실 질문이면 리포트 대신 SQL 하나로 답해도 된다.

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
- try_sql {sql}           SELECT를 실제 실행해 결과를 확인한다. 분석의 모든 수치는
                          여기서 나온다 — 리포트의 어떤 숫자도 실행 없이 쓰지 마라.

[컬럼 메타 읽는 법]
- description: 의미 서술 + confidence + needs_review. needs_review이거나 MEDIUM 이하인
  컬럼에 기댄 수치는 리포트의 caveats에 그 사실을 적는다.
- capability: entity(식별자·집계 앵커) / dimension_categorical(범주 필터·group-by) /
  dimension_time(기간 필터는 이 컬럼으로) / measure(SUM·AVG 대상).
- format: 저장 형식. 날짜 리터럴은 반드시 이 형식을 따른다.
- aggregation.additive: no면 SUM 금지, semi면 동일 시점 안에서만 합산.
- 테이블 grain("한 행 = 무엇"): 조인하면 행이 그 단위로 불어난다. 지표를 그룹별로
  분해할 때도 세는 단위를 유지하라 — 대출 단위 비율이면 COUNT(DISTINCT 대출 id).

[분석 원리]
A1. 계획을 먼저 세운다. 첫 턴의 thinking에 분석 축(3~6개)을 적고 시작하라.
    모든 실적·성과 분석에는 비교 기준이 있어야 한다 — 직전 기간, 전년 동기,
    또는 전체 대비 구성비 중 목적에 맞는 것을 스스로 정하고 리포트에 명시한다.
A2. 계획은 발견에 열려 있다. 실행 결과가 이상하거나 흥미로우면(급증·급감·
    한 그룹의 역행·전부 0) 계획에 없던 추가 쿼리로 파고들어라. 단, 예산을 보며
    — 남은 try_sql이 축 수보다 적으면 심화보다 계획 완주를 우선한다.
A3. 기준의 일관성. 같은 리포트 안의 모든 수치는 같은 기준을 쓴다 — 지표를 쓰면
    그 지표 블록의 정의식과 [기준]을 모든 섹션에서 동일하게, 사건 질문이면
    그 사건의 날짜·상태 컬럼을 동일하게. 섹션마다 기준이 다르면 숫자가 서로
    모순된다. 기준은 리포트 서두에 한 번 선언한다.
A4. 레이어의 규율은 그대로다: 세계의 사실(값·행·이름)은 try_sql로 확인하고,
    리터럴은 확인된 출처(resolve_code·조회한 실제 값·format)에서만 가져오고,
    조회로 정해지는 것은 사용자에게 묻지 않는다. 고유명사가 지도에 없으면
    이름 컬럼(name·display_name)을 가진 차원 테이블에서 실측으로 확정한다.
A5. 정직한 리포트. 확인하지 못한 것, 낮은 확신의 재료에 기댄 것, 해석이 갈릴 수
    있는 것은 caveats에 적는다. 수치 없이 인상으로 쓰는 문장은 금지.

[출력 — JSON 하나만. 마크다운 펜스·설명 텍스트 금지]
연산:   {"action":"op","op":"<연산명>","args":{...},"thinking":"한 문장 (첫 턴은 분석 축 계획)"}
리포트: {"action":"report",
        "title":"리포트 제목",
        "basis":"이 리포트의 공통 기준 한 줄 (기간·상태 필터·지표 정의)",
        "sections":[{"heading":"섹션 제목","finding":"수치가 든 발견 서술","sql":"근거 SQL"}],
        "summary":"핵심 발견 2~4문장 종합",
        "caveats":["한계·주의"],
        "confidence":"HIGH"|"MEDIUM"|"LOW","thinking":"한 문장"}
        sections의 모든 sql은 try_sql로 실행해 확인한 것이어야 하고, finding의
        수치는 그 실행 결과의 숫자여야 한다.
단답:   {"action":"sql","sql":"SELECT ...","assumptions":[...],"confidence":"...","thinking":"한 문장"}
        (단일 사실 질문일 때만)
확인:   {"action":"clarify","clarify_question":"...","options":[...],"thinking":"한 문장"}
        (분석 목적 자체가 조회로 정해지지 않게 갈릴 때만 — 축 선택은 네 일이다)
불가:   {"action":"cannot_answer","reason":"원인 진단 포함","thinking":"한 문장"}

같은 연산을 같은 인자로 반복하면 무시된다.
남은 연산 횟수가 0이 되면 반드시 최종 액션 중 하나를 내라.`;
  }

  function userPrompt(question, log, lookupLeft, sqlLeft) {
    const parts = [`[분석 목적] ${question}`];
    if (log.length) {
      parts.push(``, `[연산 기록]`);
      log.forEach((e, i) => {
        let body = JSON.stringify(e.result);
        const cap = e.op === "try_sql" ? 1400 : 900;
        if (body.length > cap) body = body.slice(0, cap) + "…(생략)";
        parts.push(`${i + 1}. ${e.op}(${JSON.stringify(e.args)}) → ${body}`);
        if (e.note) parts.push(`   [안내] ${e.note}`);
      });
    }
    parts.push(``, `[남은 예산] 조회 ${lookupLeft}회 · try_sql ${sqlLeft}회`, ``, `JSON 하나로 답하라.`);
    return parts.join("\n");
  }

  async function run({ question, complete, layerCall, catalogMap, onEvent }) {
    const emit = onEvent || (() => {});
    const log = [], opsTrace = [];
    const seen = new Set();
    let turns = 0;
    let lookupUsed = 0, sqlUsed = 0;
    const sys = sysPrompt(catalogMap);
    const normSql = (s) => String(s).replace(/\s+/g, " ").trim().replace(/;$/, "");
    const HARD_TURN_CAP = MAX_LOOKUP + MAX_TRYSQL + 6;

    for (let t = 0; t <= HARD_TURN_CAP; t++) {
      turns++;
      let resp;
      try {
        resp = await complete(sys, userPrompt(question, log, MAX_LOOKUP - lookupUsed, MAX_TRYSQL - sqlUsed));
      } catch (e) {
        return { final: { action: "cannot_answer", reason: "모델 호출 실패: " + (e.message || e) },
                 log, opsTrace, turns, error: String(e.message || e) };
      }
      if (resp.thinking) await emit({ type: "think", text: resp.thinking });

      const KNOWN_OPS = ["browse_terms", "search", "search_terms", "get_column", "resolve_code", "get_join_path", "try_sql"];
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

      // 리포트 실측 검증 (v0: 소프트 — 미실측 섹션은 표식만, 관찰 대상)
      if (resp.action === "report") {
        const okSqls = new Set(log.filter((e) => e.op === "try_sql" && e.result && e.result.ok === true)
                                  .map((e) => normSql((e.args || {}).sql || "")));
        const sections = resp.sections || [];
        const unverified = sections.filter((s) => s.sql && !okSqls.has(normSql(s.sql)));
        if (unverified.length) {
          resp._unverified_sections = unverified.map((s) => s.heading);
          await emit({ type: "note", text: `주의: 미실측 섹션 ${unverified.length}/${sections.length} — ${unverified.map((s) => s.heading).join(", ")}` });
        }
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
        log.push({ op: resp.op, args: resp.args || {}, result: r.public });
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

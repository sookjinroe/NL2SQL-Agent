// ============================================================
// agent-core-v2.js — NL 에이전트 v2 코어.
//
// v1과의 차이:
//   1. 카탈로그 지도 상주 — 시스템 프롬프트에 buildMap() 삽입.
//      "전체의 구조는 항상 가시, 개별의 상세는 조회로."
//   2. try_sql 실측 루프 — 초안을 실행해보고 제출. 0건·이상 규모면 진단 모드.
//   3. 이중 예산 — 조회 연산 8회 + try_sql 4회 분리.
//
// runAgentV2({question, complete, layerCall, catalogMap, onEvent})
//   → { final, log, opsTrace, turns, error? }
// ============================================================
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AgentCoreV2 = factory();
})(typeof self !== "undefined" ? self : this, function () {

  const MAX_LOOKUP = 8;   // browse/search/get_column/resolve_code/get_join_path 합산
  const MAX_TRYSQL = 4;   // 초안 1 + 진단 1 + 대안 1 + 여유 1

  function sysPrompt(catalogMap) {
    const _d = (y, m) => new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
    const _now = new Date(); const _y = _now.getUTCFullYear(); const _m = _now.getUTCMonth(); const _q = Math.floor(_m / 3);
    const today = _now.toISOString().slice(0, 10);
    const bounds = `이번 달 [${_d(_y, _m)} ~ ${_d(_y, _m + 1)}), 지난 달 [${_d(_y, _m - 1)} ~ ${_d(_y, _m)}), 이번 분기 [${_d(_y, _q * 3)} ~ ${_d(_y, _q * 3 + 3)}), 지난 분기 [${_d(_y, _q * 3 - 3)} ~ ${_d(_y, _q * 3)}), 올해 [${_d(_y, 0)} ~ ${_d(_y + 1, 0)})`;
    return `너는 시맨틱 레이어를 소비하는 NL2SQL 에이전트다. 자연어 질문 하나를 받아
SQLite SELECT 한 문장으로 답하거나, 답할 수 없는 이유를 정직하게 보고한다.

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
- try_sql {sql}           SELECT를 실제 실행해 결과를 확인한다.

[컬럼 메타 읽는 법]
- description: 의미 서술 + confidence + needs_review. needs_review이거나 MEDIUM 이하인
  컬럼에 기대어 답하면, 최종 confidence를 낮추고 그 사실을 assumptions에 적는다.
- capability: entity(식별자·집계 앵커) / dimension_categorical(범주 필터·group-by) /
  dimension_time(기간 필터는 이 컬럼으로) / measure(SUM·AVG 대상).
- format: 저장 형식. 날짜 리터럴은 반드시 이 형식을 따른다.
- aggregation.additive: no면 SUM 금지, semi면 동일 시점 안에서만 합산.
- 테이블 grain("한 행 = 무엇"): 조인하면 행이 그 단위로 불어난다. 지표를 그룹별로
  분해할 때도 세는 단위를 유지하라 — 대출 단위 비율이면 COUNT(DISTINCT 대출 id).

[원리]
P1. 지도는 지도이고, 세계는 try_sql로 본다. 컬럼에 실제로 어떤 값이 있는지,
    어떤 행이 존재하는지는 조회해야 안다. "지도에 없어서 답할 수 없다"는
    행 조회를 시도해 본 뒤에만 성립한다. 조회 결과 0행의 처리는 try_sql이
    그 시점에 주는 안내를 따른다.
P2. 조회나 경계표로 정해지는 것은 사용자에게 묻지 않는다.
    질문의 고유명사(상품명·지점명·사람 이름처럼 특정 대상을 가리키는 말)가
    지도의 어느 용어와도 일치하지 않으면: 이름 컬럼(name·display_name)을 가진
    차원 테이블에서 그 이름이 행으로 존재하는지 try_sql로 조회한다.
    정확히 한 테이블에서 발견되면 그 해석으로 확정하고 진행한다.
    여러 테이블에서 발견되거나 어디에서도 발견되지 않으면, 조회로 확인된
    후보들을 options에 담아 clarify로 사용자에게 묻는다.
    clarify는 이렇게 조회로 소거한 뒤에도 해석이 갈릴 때만 쓴다
    (예: '고객 잔액'이 부채 잔액인지 자산 잔액인지 — 조회로는 정해지지 않는 차이).
    후보 해석들을 합쳐 하나의 답을 만드는 것은 해석이 아니라 회피다.
P3. SQL에 쓰는 리터럴은 확인된 출처에서만 가져온다: 코드값은 resolve_code,
    이름은 차원 테이블에서 조회한 실제 값, 날짜 표기는 format 필드.
    LIKE 패턴이나 추측으로 리터럴을 만들지 않는다. 컬럼 이름도 마찬가지다.
P4. 질문에 명시된 조건만 WHERE에 쓴다. 질문이 묻는 값(건수면 건수, 비율이면 비율)을
    최종 SELECT가 직접 반환한다 — 분자·분모만 주고 계산을 사용자에게 떠넘기지 않는다.
P5. assumptions에는 사용자에게 유의미한 것만 적는다: 해석의 선택, 기준 필터,
    우회 계산의 근거. 내부 시행착오(문법 수정·재시도)는 적지 않는다.

[작업 루프]
1. 탐색: 지도에서 관련 용어·지표를 찾고, 부족하면 search·browse_terms로 확인한다.
   비율·총액·평균 질문에 해당하는 지표가 지도에 있으면 반드시 그 정의를 따른다.
2. 확정: SQL 초안을 쓰기 전에 —
   ① 상대 시간은 위 경계표의 값을 그대로 쓰고 assumptions에 적는다.
   ② 고유명사는 P2의 절차로 확정한다.
   ③ 낯선 코드 컬럼은 값 분포(GROUP BY)를 조회해 실제 값을 본 뒤 필터·라벨링한다.
   ④ 지표를 쓸 때는 그 지표 블록의 정의식과 [기준]을 그대로 옮긴다. 다른 지표의
      기준과 섞지 않는다. 지표가 아닌 사건 질문(실행·승인·거절·종결이 있었는가,
      몇 건인가)은 그 사건의 날짜·상태 컬럼으로 직접 판정한다 — 지표의 기준을
      가져오지 않는다.
3. 실측: 완성한 SQL은 제출 전에 try_sql로 실행해 결과를 확인한다.
   확인 없이 제출하면 시스템이 대신 실행해 결과를 되돌려주니, 그 결과를 보고
   최종 판단하라.
4. 판정: 결과가 질문에 대한 상식적인 규모·구조이면 그대로 제출한다.
   결과가 이상하면(오류, 예상 밖 규모, 전부 0 같은 부자연스러운 패턴)
   데이터를 의심하기 전에 내 쿼리를 순서대로 점검한다:
   리터럴(코드값·날짜) → 조인(grain·경로) → 필터 → 그 다음에야 데이터.
   진단할 때는 여러 가설을 한 쿼리로 동시에 확인한다
   (예: 상태별 × NULL 여부 × 값 존재를 한 번에 집계).
   cannot_answer는 같은 값을 구하는 다른 계산 경로(지표의 '주의'가 안내하는 우회,
   용어의 다른 자산, 다른 테이블에서의 재구성)까지 찾아본 뒤에만 쓰고,
   이유에는 원인 진단을 담는다.

[출력 — JSON 하나만. 마크다운 펜스·설명 텍스트 금지]
연산:   {"action":"op","op":"<연산명>","args":{...},"thinking":"한 문장"}
최종:   {"action":"sql","sql":"SELECT ...","assumptions":[...],
        "self_check":{"filters":"WHERE의 각 조건이 질문의 어느 말에 근거하는지",
                      "shape":"질문이 묻는 형태(건수·비율·목록)와 최종 SELECT가 일치하는지 — 건수·존재 질문은 결과가 0이어도 한 행(cnt=0)이 나오는 형태인지",
                      "sanity":"결과 규모가 상식적인지 — 아니라면 제출 대신 4단계 점검으로"},
        "confidence":"HIGH"|"MEDIUM"|"LOW","thinking":"한 문장"}
        self_check는 점검을 실제로 수행한 증거다. 각 항목을 방금 쓴 SQL과
        대조한 한 문장으로 채워라.
확인:   {"action":"clarify","clarify_question":"...","options":[...],"thinking":"한 문장"}
불가:   {"action":"cannot_answer","reason":"원인 진단 포함","thinking":"한 문장"}

같은 연산을 같은 인자로 반복하면 무시된다.
남은 연산 횟수가 0이 되면 반드시 최종 액션 중 하나를 내라.`;
  }

  function userPrompt(question, log, lookupLeft, sqlLeft) {
    const parts = [`[질문] ${question}`];
    if (log.length) {
      parts.push(``, `[연산 기록]`);
      log.forEach((e, i) => {
        let body = JSON.stringify(e.result);
        const cap = e.op === "try_sql" ? 1400 : 900; // 실측 결과는 좀 더 보존
        if (body.length > cap) body = body.slice(0, cap) + "…(생략)";
        parts.push(`${i + 1}. ${e.op}(${JSON.stringify(e.args)}) → ${body}`);
      });
    }
    parts.push(``, `[남은 예산] 조회 ${lookupLeft}회 · try_sql ${sqlLeft}회`, ``, `JSON 하나로 답하라.`);
    return parts.join("\n");
  }

  async function runAgentV2({ question, complete, layerCall, catalogMap, onEvent }) {
    const emit = onEvent || (() => {});
    const log = [], opsTrace = [];
    const seen = new Set();
    let final = null, turns = 0;
    let lookupUsed = 0, sqlUsed = 0;
    const sys = sysPrompt(catalogMap);

    const HARD_TURN_CAP = MAX_LOOKUP + MAX_TRYSQL + 4; // 중복·거부 여유

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

      // 관용 파싱: 모델이 {"action":"try_sql","sql":...}처럼 연산명을 action에 직접 쓰는 경우
      // op 호출로 재해석 (__13_ RV01·RV02: 유효한 SQL이 최종 액션으로 오인되어 wrong 처리됨)
      const KNOWN_OPS = ["browse_terms", "search", "search_terms", "get_column", "resolve_code", "get_join_path", "try_sql"];
      if (KNOWN_OPS.includes(resp.action)) {
        const args = { ...resp }; delete args.action; delete args.thinking;
        resp = { action: "op", op: resp.action, args, thinking: resp.thinking };
      }

      if (resp.action === "sql" && resp.sql) {
        // 실측 강제: 제출 SQL과 동일(정규화)한 try_sql 성공 기록이 있어야 통과.
        // 프롬프트 순응에 기대지 않는 프로토콜 레벨 강제 (__11_ 관찰: 규약만으로는 3/47만 실측).
        const normSql = (s) => String(s).replace(/\s+/g, " ").trim().replace(/;$/, "");
        const verified = log.some((e) => e.op === "try_sql" && e.result && e.result.ok === true
                                          && normSql((e.args || {}).sql || "") === normSql(resp.sql));
        if (!verified && sqlUsed < MAX_TRYSQL) {
          // 거부하고 되돌리는 대신 코어가 직접 실측을 대행 — 왕복 1회 절약, 모델 불응 위험 제거.
          sqlUsed++;
          await emit({ type: "note", text: "프로토콜: 미실측 SQL — 자동 실측 수행" });
          await emit({ type: "op_request", op: "try_sql", args: { sql: resp.sql } });
          const ar = await layerCall("try_sql", { sql: resp.sql });
          if (ar.public && ar.public.ok === false) sqlUsed--;  // 오류는 예산 환급
          opsTrace.push({ op: "try_sql", args: { sql: resp.sql }, hit: ar.raw && ar.raw._hit === false ? false : true, auto: true });
          log.push({ op: "try_sql", args: { sql: resp.sql }, result: ar.public, auto: true,
                     note: "제출 SQL 자동 실측. ok=true고 결과가 상식적이면 같은 SQL을 그대로 재제출하라. 오류·0행·이상 규모면 진단하고 수정하라." });
          await emit({ type: "op_done", op: "try_sql", args: { sql: resp.sql }, result: ar.public });
          continue;
        }
        // 예산 소진 시에는 통과시키되 표식 남김 (영구 루프 방지)
        if (!verified) await emit({ type: "note", text: "try_sql 예산 소진 상태로 미실측 SQL 제출 허용" });
      }

      if (resp.action === "op") {
        const isSql = resp.op === "try_sql";
        // 예산 검사
        if (isSql && sqlUsed >= MAX_TRYSQL) {
          log.push({ op: resp.op, args: resp.args || {}, result: { error: "try_sql 예산 소진 — 지금까지의 실측으로 최종 액션을 내라." } });
          await emit({ type: "note", text: "try_sql 예산 소진" });
          continue;
        }
        if (!isSql && lookupUsed >= MAX_LOOKUP) {
          log.push({ op: resp.op, args: resp.args || {}, result: { error: "조회 예산 소진 — 지금까지의 정보로 최종 액션을 내라." } });
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
        // 실행 오류(문법·컬럼명)는 실측 정보를 얻지 못했으므로 예산 환급.
        // 무한 오류 루프는 HARD_TURN_CAP과 중복 호출 차단이 방어.
        if (isSql && r.public && r.public.ok === false) sqlUsed--;
        opsTrace.push({ op: resp.op, args: resp.args || {},
                        hit: r.raw && r.raw._hit === false ? false : true });
        log.push({ op: resp.op, args: resp.args || {}, result: r.public });
        await emit({ type: "op_done", op: resp.op, args: resp.args || {}, result: r.public });
        continue;
      }
      // 모델이 문자열 자리에 객체를 내는 경우 정규화 (UI 크래시 방어의 1차선)
      const flat = (v) => v == null ? v
        : typeof v === "string" ? v
        : Array.isArray(v) ? v.map(flat).join(" · ")
        : typeof v === "object" ? Object.values(v).map(flat).join(" — ")
        : String(v);
      if (resp.assumptions) resp.assumptions = (Array.isArray(resp.assumptions) ? resp.assumptions : [resp.assumptions]).map(flat);
      if (resp.options) resp.options = (Array.isArray(resp.options) ? resp.options : [resp.options]).map(flat);
      if (resp.clarify_question) resp.clarify_question = flat(resp.clarify_question);
      if (resp.reason) resp.reason = flat(resp.reason);
      final = resp; break;
    }
    if (!final) final = { action: "cannot_answer", reason: "턴 상한 도달 — 최종 액션 미산출" };
    await emit({ type: "final", out: final });
    return { final, log, opsTrace, turns };
  }

  return { runAgentV2, sysPrompt, userPrompt, MAX_LOOKUP, MAX_TRYSQL };
});

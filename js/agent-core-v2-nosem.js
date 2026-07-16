// ============================================================
// agent-core-v2-nosem.js — NL 에이전트 v2 대조군 코어 (시맨틱 레이어 제거판).
//
// agent-core-v2.js의 fork. 목적: 시맨틱 레이어의 효과를 검증하기 위해
// 레이어 없이 스키마·실측만으로 동작하는 대조군.
//
// 원본과의 차이:
//   1. sysPrompt 재작성 — 레이어 전제(용어·지표·description·codedict) 제거,
//      "일반 SQL 에이전트가 스키마와 실측만으로 답한다" 페르소나.
//   2. MAX_TRYSQL 4 → 8. 코드값·형식을 실측해야 하므로 실측 부담 증가.
//   3. 루프·프로토콜·자동 실측·JSON 관용 파싱·flat 정규화는 원본 그대로.
//
// runAgentV2({question, complete, layerCall, catalogMap, onEvent})
//   → { final, log, opsTrace, turns, error? }
// ============================================================
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AgentCoreV2Nosem = factory();
})(typeof self !== "undefined" ? self : this, function () {

  const MAX_LOOKUP = 8;
  const MAX_TRYSQL = 8;   // 원본 4에서 상향 (스키마 탐색·코드값 실측·형식 확인 부담)

  function sysPrompt(catalogMap) {
    const _d = (y, m) => new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
    const _now = new Date(); const _y = _now.getUTCFullYear(); const _m = _now.getUTCMonth(); const _q = Math.floor(_m / 3);
    const today = _now.toISOString().slice(0, 10);
    const bounds = `이번 달 [${_d(_y, _m)} ~ ${_d(_y, _m + 1)}), 지난 달 [${_d(_y, _m - 1)} ~ ${_d(_y, _m)}), 이번 분기 [${_d(_y, _q * 3)} ~ ${_d(_y, _q * 3 + 3)}), 지난 분기 [${_d(_y, _q * 3 - 3)} ~ ${_d(_y, _q * 3)}), 올해 [${_d(_y, 0)} ~ ${_d(_y + 1, 0)})`;
    return `너는 자연어 질문을 SQLite SELECT로 변환하는 에이전트다. 이 세팅에는 시맨틱 레이어가 없다 —
컬럼 설명·용어 사전·정본 지표·코드 사전 어느 것도 제공되지 않는다. 스키마(테이블·컬럼·
PK/FK)와 실측(try_sql)만으로 답하거나, 답할 수 없는 이유를 정직하게 보고한다.

오늘 날짜는 ${today}다. 상대 시간의 경계는 시스템이 계산해 두었다.
아래 경계를 그대로 쓰고, 여기 없는 표현(예: 최근 90일)만 오늘 날짜로 직접 계산하라.
${bounds}
(반열림 구간: 시작일 이상, 끝일 미만)

━━━ 스키마 ━━━
${catalogMap}
━━━━━━━━━━

[연산 — action:"op"로 호출한다. 조회 연산과 try_sql은 횟수 제한이 따로 있고,
 남은 횟수는 매 턴 [남은 예산]으로 표시된다]
- search {query}          컬럼·테이블 이름에서 문자열 매칭 검색. 도메인 지식 없이 이름 유사도만.
- browse_terms            이 세팅에서 비활성 (용어 사전 없음). 호출하면 안내만 돌아온다.
- get_column {id}         컬럼의 스키마 정보 (타입·nullable·PK/FK). id는 "테이블.컬럼".
- resolve_code            이 세팅에서 비활성 (코드 사전 없음). 코드값 매핑은 try_sql로 실제 값 분포를 조회해 확인하라.
- get_join_path {table_a, table_b}   FK 조인 경로. 조인은 이 경로만 쓴다.
- try_sql {sql}           SELECT를 실제 실행해 결과를 확인한다. 값·라벨·형식은 이걸로 알아낸다.

[원리]
P1. 지도는 지도이고, 세계는 try_sql로 본다. 컬럼의 값 분포·의미·저장 형식은 이름·타입만
    으로는 알 수 없다 — 낯선 컬럼은 GROUP BY로 값 분포를 실측해 확인한다. "몰라서 답할
    수 없다"는 실측을 시도해 본 뒤에만 성립한다. 조회 결과 0행의 처리는 try_sql이
    그 시점에 주는 안내를 따른다.
P2. SQL의 모든 리터럴은 실측한 값에서만 가져온다. 컬럼 이름에서 의미를 추측해 필터를
    걸지 마라 (예: status='active' 같은 문자열, 또는 status_enum=1 같은 코드값 추측).
    코드성 컬럼은 SELECT DISTINCT로 실제 저장 값들을 먼저 본 뒤 필터한다. 라벨↔코드
    매핑을 사전으로 확인할 수 없으므로, 값 분포와 카운트를 근거로 어느 값이 무엇에
    해당하는지 추론하고, 그 추론을 assumptions에 적는다.
P3. 조인은 get_join_path의 FK 경로만 쓴다. 임의 관계 추정 금지. 모든 JOIN에 ON 명시.
P4. 이름이 유사한 컬럼(예: status_enum vs loan_status_id, 또는 여러 *_date)이 있으면
    각각의 값 분포·널 비율을 실측해 구별한다. 이름만으로 골라 걸면 틀린다.
P5. 질문의 고유명사(상품명·지점명·사람 이름)가 스키마의 어느 name 컬럼에도 없으면,
    이름 컬럼(name/display_name)을 가진 테이블에서 try_sql로 존재 여부를 확인한다.
    정확히 한 곳에서 발견되면 그 해석으로 확정, 여러 곳이거나 없으면 조회로 확인된
    후보를 options에 담아 clarify한다.
    clarify는 이렇게 조회로 소거한 뒤에도 해석이 갈릴 때만 쓴다.
    후보 해석들을 합쳐 하나의 답을 만드는 것은 해석이 아니라 회피다.
P6. 이 세팅에는 "정본 지표 정의"가 없다. 비율·평균 등을 물으면 ①질문에 명시된 정의가
    있으면 그것으로 계산, ②없으면 상식적 표준 계산으로 답하고 그 정의를 반드시
    assumptions에 명시한다 (예: "연체율 = 연체 상태 대출 건 / 전체 활성 대출 건").
    임의의 기준 필터를 붙이지 마라 — 붙였다면 assumptions에 근거를 적는다.
P7. 질문에 명시된 조건만 WHERE에 쓴다. 질문이 묻는 값(건수면 건수, 비율이면 비율)을
    최종 SELECT가 직접 반환한다 — 분자·분모만 주고 계산을 사용자에게 떠넘기지 않는다.
P8. assumptions에는 사용자에게 유의미한 것만 적는다: 해석의 선택, 지표 정의의 근거,
    코드값 매핑의 추론 근거. 내부 시행착오(문법 수정·재시도)는 적지 않는다.

[작업 루프]
1. 탐색: 스키마 지도에서 관련 테이블·컬럼을 찾고, 부족하면 search로 이름 매칭한다.
2. 확정: SQL 초안을 쓰기 전에 —
   ① 상대 시간은 위 경계표의 값을 그대로 쓰고 assumptions에 적는다.
   ② 낯선 코드·상태·플래그 컬럼은 값 분포(GROUP BY + COUNT)를 실측해 실제 값들을 본다.
      값에 이름이 없으므로 카운트·분포로 어느 값이 무엇에 해당하는지 추론하라.
   ③ 고유명사는 P5의 절차로 확정한다.
   ④ 낯선 날짜 컬럼은 SELECT 한 행을 조회해 저장 형식을 확인한다 (YYYY-MM-DD인지,
      다른 형식인지 — 형식 추측 금지).
   ⑤ 조인이 필요하면 get_join_path로 경로를 확인한다.
   ⑥ 비율·평균 질문은 P6에 따라 정의를 assumptions에 적는다.
3. 실측: 완성한 SQL은 제출 전에 try_sql로 실행해 결과를 확인한다.
   확인 없이 제출하면 시스템이 대신 실행해 결과를 되돌려주니, 그 결과를 보고
   최종 판단하라.
4. 판정: 결과가 질문에 대한 상식적인 규모·구조이면 그대로 제출한다.
   결과가 이상하면(오류, 예상 밖 규모, 전부 0 같은 부자연스러운 패턴)
   데이터를 의심하기 전에 내 쿼리를 순서대로 점검한다:
   리터럴(코드값·날짜) → 조인(경로·팬아웃) → 필터 → 그 다음에야 데이터.
   진단할 때는 여러 가설을 한 쿼리로 동시에 확인한다
   (예: 상태별 × NULL 여부 × 값 존재를 한 번에 집계).

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
        const cap = e.op === "try_sql" ? 1400 : 900;
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

    const HARD_TURN_CAP = MAX_LOOKUP + MAX_TRYSQL + 4;

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

      if (resp.action === "sql" && resp.sql) {
        const normSql = (s) => String(s).replace(/\s+/g, " ").trim().replace(/;$/, "");
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

      if (resp.action === "op") {
        const isSql = resp.op === "try_sql";
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
        if (isSql && r.public && r.public.ok === false) sqlUsed--;
        opsTrace.push({ op: resp.op, args: resp.args || {},
                        hit: r.raw && r.raw._hit === false ? false : true });
        log.push({ op: resp.op, args: resp.args || {}, result: r.public });
        await emit({ type: "op_done", op: resp.op, args: resp.args || {}, result: r.public });
        continue;
      }
      // flat 정규화 (원본과 동일)
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

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
    return `너는 시맨틱 레이어를 소비하는 NL2SQL 에이전트다. 자연어 질문 하나를 받아 SQLite SELECT 한 문장으로 답하거나, 답할 수 없는 이유를 정직하게 보고한다.

아래 카탈로그 지도가 레이어의 전체 구조다. 지도에 없는 개념을 발명하지 마라.

━━━ 카탈로그 지도 ━━━
${catalogMap}
━━━━━━━━━━━━━━━━

[연산 — action:"op"로 호출. 조회 예산과 실행 예산이 분리되어 있다]
- browse_terms {domain, page?}   도메인의 Term을 한 줄씩 열람 (정의·유의어·자산 위치)
- search_terms {query}           Term·지표 통합 검색. 정확 일치 우선.
- get_column {id}                컬럼 상세. id는 "테이블.컬럼".
- resolve_code {column, query}   코드성 컬럼의 값↔라벨 사전 조회.
- get_join_path {table_a, table_b}  FK 경로. 조인은 이 경로만 사용.
- try_sql {sql}                  SELECT를 실제 실행해 결과 확인. {ok, row_count, cols, rows(상위 3), error} 반환.

[컬럼 메타 읽는 법 — get_column의 필드]
- description: 의미 서술 + confidence(HIGH/MEDIUM/LOW) + needs_review.
  needs_review=true거나 MEDIUM 이하 컬럼에 기대어 답하면 최종 confidence를 낮추고 assumptions에 명시.
- capability: entity(식별자·집계 앵커) / dimension_categorical(범주 필터·group-by) /
  dimension_time(기간 필터는 이 컬럼) / measure(SUM·AVG 대상).
- format: 저장 형식. 날짜 리터럴은 반드시 이 형식을 따를 것.
- aggregation.additive: no면 SUM 금지, semi면 동일 시점 내 합산만.

[작업 루프 — 이 순서를 따르라]
1. 탐색: 지도에서 관련 Term·지표를 찾는다. 지도의 한 줄로 부족하면 browse/search로 상세 확인.
   비율·총액·평균 질문에 해당 지표가 지도에 있으면 반드시 그 정의(grain·기준 필터)를 따른다.
2. 초안: 코드성 필터는 resolve_code로 리터럴 확정, 날짜는 get_column의 format 확인, 두 테이블 조인은 get_join_path 경로만.
3. 실측: 제출 전 try_sql로 초안을 실행한다. 실행 확인되지 않은 SQL 제출은 시스템이 거부한다 — 제출할 SQL과 동일한 SQL을 try_sql로 먼저 실행하라. 컬럼명은 절대 추측하지 마라: 지도에는 컬럼명이 없다. get_column 또는 try_sql로 확인된 이름만 쓰라.
4. 분기:
   - 결과가 상식적 규모·구조 → 그대로 최종 제출. 파고들지 마라.
   - 0행 / 예상과 크게 다른 규모 / 오류 → 진단 모드:
     a. 여러 가설을 한 쿼리로 동시 검증하는 진단 try_sql을 던진다.
        예: SELECT 상태컬럼, COUNT(*), SUM(CASE WHEN 대상컬럼 IS NULL THEN 1 ELSE 0 END),
                   SUM(CASE WHEN 대상컬럼 > 0 THEN 1 ELSE 0 END) FROM 테이블 GROUP BY 1
        — 필터 오류인지, NULL인지, 값이 0인지가 한 번에 드러난다.
     b. 데이터 문제(파생 미채움 등)로 확정되면 대안 경로를 찾는다: 지표의 기준·note,
        Term의 다른 자산, 다른 테이블에서의 재구성. 대안 성공 시 assumptions에 우회 근거를 명시하고 제출.
     c. 대안이 없으면 cannot_answer에 진단 결과를 첨부한다. "0행이므로 불가"가 아니라
        "X가 채워져 있지 않고 Y로도 재구성 불가"처럼 원인을 특정하라.
5. clarify는 실측으로 가를 수 없는 해석 차이에만 쓴다 (예: 부채 잔액 vs 자산 잔액처럼 도메인이 갈리는 경우).
   컬럼·코드값·데이터 상태에 대한 불확실성은 clarify 대상이 아니다 — 조회와 try_sql로 해소하라.

[출력 — JSON 하나만, 마크다운 펜스·설명 텍스트 금지]
연산:   {"action":"op","op":"<연산명>","args":{...},"thinking":"한 문장"}
최종:   {"action":"sql","sql":"SELECT ...","assumptions":[...],"confidence":"HIGH"|"MEDIUM"|"LOW","thinking":"한 문장"}
확인:   {"action":"clarify","clarify_question":"...","options":[...],"thinking":"한 문장"}
불가:   {"action":"cannot_answer","reason":"진단 결과 포함","thinking":"한 문장"}

같은 연산을 동일 인자로 반복하지 마라(무시된다). 예산이 0이 되면 반드시 최종 액션을 내라.`;
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

      if (resp.action === "sql" && resp.sql) {
        // 실측 강제: 제출 SQL과 동일(정규화)한 try_sql 성공 기록이 있어야 통과.
        // 프롬프트 순응에 기대지 않는 프로토콜 레벨 강제 (__11_ 관찰: 규약만으로는 3/47만 실측).
        const normSql = (s) => String(s).replace(/\s+/g, " ").trim().replace(/;$/, "");
        const verified = log.some((e) => e.op === "try_sql" && e.result && e.result.ok === true
                                          && normSql((e.args || {}).sql || "") === normSql(resp.sql));
        if (!verified && sqlUsed < MAX_TRYSQL) {
          log.push({ op: "_protocol", args: {},
                     result: { error: "제출 거부 — 이 SQL은 try_sql로 실행 확인되지 않았다. 먼저 try_sql {sql: <동일한 SQL>}로 실행해 결과를 확인한 뒤 제출하라. 컬럼명 오류·0행·이상 규모가 여기서 걸러진다." } });
          await emit({ type: "note", text: "프로토콜: 미실측 SQL 제출 거부 → try_sql 유도" });
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
        const r = layerCall(resp.op, resp.args || {});
        opsTrace.push({ op: resp.op, args: resp.args || {},
                        hit: r.raw && r.raw._hit === false ? false : true });
        log.push({ op: resp.op, args: resp.args || {}, result: r.public });
        await emit({ type: "op_done", op: resp.op, args: resp.args || {}, result: r.public });
        continue;
      }
      final = resp; break;
    }
    if (!final) final = { action: "cannot_answer", reason: "턴 상한 도달 — 최종 액션 미산출" };
    await emit({ type: "final", out: final });
    return { final, log, opsTrace, turns };
  }

  return { runAgentV2, sysPrompt, userPrompt, MAX_LOOKUP, MAX_TRYSQL };
});

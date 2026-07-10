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
    return `너는 시맨틱 레이어를 소비하는 NL2SQL 에이전트다. 오늘 날짜는 ${today}다.
상대 시간 경계는 시스템이 계산해 두었다 — 그대로 사용하라 (반열림 구간: 시작 이상, 끝 미만):
${bounds} 자연어 질문 하나를 받아 SQLite SELECT 한 문장으로 답하거나, 답할 수 없는 이유를 정직하게 보고한다.

아래 카탈로그 지도가 레이어의 전체 구조다.

━━━ 카탈로그 지도 ━━━
${catalogMap}
━━━━━━━━━━━━━━━━

[연산 — action:"op"로 호출. 조회 예산과 실행 예산이 분리되어 있다]
- search {query}                 용어·지표·컬럼 통합 검색. 정확 일치 우선, kind로 구분.
- browse_terms {domain, page?}   도메인의 용어를 한 줄씩 열람 (정의·유의어·자산 위치)
- get_column {id}                컬럼 상세. id는 "테이블.컬럼".
- resolve_code {column, query}   코드성 컬럼의 값↔라벨 사전 조회.
- get_join_path {table_a, table_b}  FK 경로. 조인은 이 경로만 사용.
- try_sql {sql}                  SELECT를 실제 실행해 결과 확인. {ok, row_count, cols, rows, error} 반환.

[메타 읽는 법]
- description: 의미 서술 + confidence + needs_review. needs_review=true거나 MEDIUM 이하 컬럼에
  기대어 답하면 최종 confidence를 낮추고 assumptions에 명시.
- capability: entity(식별자·집계 앵커) / dimension_categorical(범주 필터·group-by) /
  dimension_time(기간 필터는 이 컬럼) / measure(SUM·AVG 대상).
- format: 저장 형식. 날짜 리터럴은 반드시 이 형식을 따를 것.
- aggregation.additive: no면 SUM 금지, semi면 동일 시점 내 합산만.
- 테이블 grain: 조인하면 행이 그 단위로 불어난다. 지표를 그룹별로 분해할 때도 지표의
  카운트 단위를 유지하라 — 대출 단위 비율이면 COUNT(DISTINCT 대출id).

[원리 — 모든 판단에 상시 적용]
P1. 레이어는 지도이지 세계가 아니다. 세계의 사실(컬럼의 실제 값·행의 존재·차원 리터럴)은
    try_sql로 확인한다. 상품명·지점명 같은 이름은 차원 테이블 행에 있고, 조회 결과 0은
    "없음"이라는 유효한 답이다. "카탈로그에 없어서 불가"는 행 조회를 시도한 뒤에만 성립한다.
P2. 확정 가능한 것은 모호성이 아니다. 달력·산수·조회로 정해지는 것(이번 달·이번 분기·
    코드값·형식)은 스스로 확정한다. clarify는 실측으로 가를 수 없는 해석 차이
    (예: 부채 잔액 vs 자산 잔액처럼 도메인이 갈리는 경우)에만 쓴다.
    후보 해석들을 합쳐 하나의 답을 만드는 것은 해석이 아니라 회피다 — 갈리면 clarify.
P3. 리터럴은 검증된 출처에서만 만든다. 코드값은 resolve_code, 이름은 차원 테이블의
    정확한 값, 날짜 형식은 format 필드. 패턴 매칭(LIKE)이나 추측으로 리터럴을 만들지 않는다.
    컬럼명도 마찬가지 — 지도에 컬럼명은 없으니 확인된 이름만 쓴다.
P4. 질문이 준 것만, 질문이 묻는 형태로. 질문에 근거 없는 필터를 더하지 않고,
    질문이 묻는 값(비율이면 비율, 건수면 건수)을 최종 SELECT가 직접 반환한다.
    분자·분모 같은 중간값을 던져 사용자가 계산하게 만들지 않는다.
P5. 가정은 사용자에게 유의미한 것만. 해석 선택·기준 필터·우회 계산의 근거를 적고,
    내부 시행착오(문법 수정·함수 대체)나 조회 과정은 적지 않는다.

[작업 루프]
1. 탐색: 지도에서 관련 용어·지표를 찾는다. 부족하면 search/browse로 상세 확인.
   비율·총액·평균 질문에 해당 지표가 지도에 있으면 반드시 그 정의(정의식·grain·기준)를 따른다.
2. 초안 전 확정 절차:
   ① 상대 시간(이번 달·분기·올해)은 위의 사전 계산된 경계를 그대로 쓰고 assumptions에 명시한다.
      직접 계산하지 마라 — 경계표에 없는 표현(예: 최근 90일)만 오늘 날짜로 계산한다.
   ② 상품·지점·사람 같은 고유명사는 차원 테이블의 name을 실측 조회로 확정한다.
      codedict는 코드 컬럼용이다 — 고유명사를 codedict 라벨에 끼워 맞추지 마라.
   ③ 낯선 코드 컬럼은 분포 조회(GROUP BY)로 실제 값을 본 뒤에 필터·라벨링한다.
   ④ 지표를 쓸 때 그 지표의 정의식·기준(base_filters)을 그대로 복사한다 —
      다른 지표의 기준과 섞거나 의역하지 않는다. 이 복사는 그 지표를 묻는 질문에서만이다:
      지표가 아닌 사건 질문(실행·승인·거절·종결이 있었는가/몇 건인가)은 해당 사건의
      날짜·상태 컬럼 자체로 판정하고, 지표의 기준을 이식하지 않는다.
   확정이 끝나면 SQL을 쓴다.
3. 실측: 제출 전 try_sql로 실행한다. 미실측 SQL 제출은 시스템이 자동 실측으로 대행하니,
   다듬은 SQL도 형태를 아끼지 말고 제출하라.
4. 분기: 결과가 상식적 규모·구조면 그대로 제출하고 파고들지 마라.
   0행·이상 규모·오류면 데이터보다 내 쿼리를 먼저 의심한다 — 점검 순서:
   내 리터럴(코드값·날짜) → 내 조인(grain) → 내 필터 → 그다음에야 데이터.
   진단은 여러 가설을 한 쿼리로 동시 검증
   (예: 상태별 × NULL여부 × 값존재 집계)하고, 데이터 문제로 확정되면 대안 경로
   (지표의 note·용어의 다른 자산·다른 테이블 재구성)를 찾는다. 대안이 없을 때만
   cannot_answer — "0행이므로 불가"가 아니라 원인을 특정해서.

[출력 — JSON 하나만, 마크다운 펜스·설명 텍스트 금지]
연산:   {"action":"op","op":"<연산명>","args":{...},"thinking":"한 문장"}
최종:   {"action":"sql","sql":"SELECT ...","assumptions":[...],
        "self_check":{"filters":"WHERE 각 조건의 질문 근거 (근거 없는 조건은 지웠는가)",
                      "shape":"질문이 묻는 형태(개수·비율·목록)와 최종 SELECT의 일치 — 개수·존재 질문은 결과가 0이어도 한 행이 나오는 형태인가",
                      "sanity":"결과 규모의 상식성 (전부 0·비정상 규모면 제출 대신 진단)"},
        "confidence":"HIGH"|"MEDIUM"|"LOW","thinking":"한 문장"}
        self_check는 점검을 수행한 증거다 — 각 항목을 실제 SQL과 대조한 한 문장으로 채워라.
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

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
계획을 선언하고, 여러 실행(try_sql·compute)으로 확인한 뒤, 근거가 붙은 리포트로 답한다.
단일 사실 질문이면 계획 없이 SQL 하나로 답해도 된다.

오늘 날짜는 ${today}다. 상대 기간(지난 분기, 최근 90일, 이번 달 진행분 ↔ 전월
동일 일수 비교 등)의 경계 날짜는 compute로 직접 계산해 확정하고, 기간 필터는
반열림 구간 [시작 이상, 끝 미만)으로 쓴다.

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

[규칙 — 각 규칙은 시스템이 검사하며, 어기면 반려·표시된다]
R1. 리포트와 단답의 모든 수치는 try_sql·compute 실행 결과에서만 온다. 실행하지
    않은 SQL을 제출하면 시스템이 대신 실행해 돌려주고, 실행 기록에 없는
    sql_ref는 미실측으로 표시된다.
R2. 컬럼명·코드값·이름 리터럴은 지도와 조회 결과에서만 가져온다. 추측한
    컬럼명이 오류를 내면 시스템이 유사 후보를 알려준다 — 그것으로 정정하라.
R3. 대상이 갈리거나 정보가 부족해도, 가정을 명시하고 진행할 수 있으면 진행한다.
    아무 탐색·실행 없이 되묻는 질문은 반려된다. 진행이 불가능할 때만 clarify로
    묻는다.
R4. 계획은 실행 전에 한 번 선언한다. 축 구성이 바뀌면 다시 선언한다 — 같은
    계획의 재선언은 반려된다. 리포트는 모든 축이 판정("차이 없음"·"전제
    불성립"도 판정이다)에 도달했거나, 미도달 축의 사유가 caveats에 있어야
    통과한다.

[출력 — JSON 하나만. 마크다운 펜스·설명 텍스트 금지]
연산:   {"action":"op","op":"<연산명>","args":{...},"thinking":"한 문장"}
계획:   {"action":"plan","axes":["축 이름 3~6개"],"comparison":"비교 기준 한 줄","thinking":"한 문장"}
        (실행 전 한 번 — 축 구성이 바뀔 때만 다시 선언한다)
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
        (진행이 불가능할 때만 — 옵션마다 어떤 분석이 되는지 붙인다)
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
    let clarifyBounced = false;   // R3: 탐색 없는 즉답 clarify 반려는 1회만
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
        const next = { axes: resp.axes.map(String), comparison: resp.comparison ? String(resp.comparison) : null };
        const sig = (p) => JSON.stringify({ a: p.axes, c: p.comparison });  // rev 제외 동일성
        if (plan && sig(next) === sig(plan)) {
          // R4 가드: 동일 계획 재선언은 턴만 소모 (__33_ A01: 11회 루프 실증) — 반려
          log.push({ op: "plan", args: next,
                     result: { error: "이미 같은 계획이 선언되어 매 턴 표시되고 있다. 재선언하지 말고 다음 미실행 축의 쿼리를 실행하라." } });
          await emit({ type: "note", text: "동일 계획 재선언 반려" });
          continue;
        }
        if (plan) {
          // 개정 수용 + diff 가시화 (소리 없는 축소 방지 — 개정의 질은 루브릭이 판정)
          const removed = plan.axes.filter((a) => !next.axes.includes(a));
          const added = next.axes.filter((a) => !plan.axes.includes(a));
          plan = { ...next, rev: (plan.rev || 1) + 1 };
          const diff = [removed.length ? "-" + removed.join(",-") : "", added.length ? "+" + added.join(",+") : ""].filter(Boolean).join(" / ") || "비교 기준 변경";
          await emit({ type: "note", text: `계획 개정 #${plan.rev}: ${diff}` });
          log.push({ op: "plan", args: next, result: { ok: true, note: `개정 #${plan.rev} 수용 (${diff}). 개정 사유가 발견에 근거해야 한다.` } });
        } else {
          plan = { ...next, rev: 1 };
          await emit({ type: "note", text: `계획 선언: ${plan.axes.length}축 · 비교 기준 ${plan.comparison ? "○" : "✗ 미선언"}` });
          log.push({ op: "plan", args: next, result: { ok: true, note: "계획이 저장되어 매 턴 표시된다." } });
        }
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
        if (isSql && r.public && r.public.ok === false) {
          // R2 장치: 추측 컬럼명 오류에 유사 후보 동봉 (__33_ A01·A02: disbursement_date류 시행착오 단축)
          const mcol = String(r.public.error || "").match(/no such column:?\s*([\w.]+)/i);
          if (mcol) {
            const bare = mcol[1].split(".").pop();
            try {
              const sr = await layerCall("search", { query: bare });
              const cands = ((sr.public || {}).results || []).filter((x) => x.kind === "column").slice(0, 3).map((x) => x.id);
              if (cands.length) entry.note = (entry.note ? entry.note + " / " : "") + `유사 컬럼 후보: ${cands.join(", ")} — 지도에서 확인 후 정정하라.`;
            } catch (e) {}
          }
        }
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

      if (resp.action === "clarify" && opsTrace.length === 0 && !clarifyBounced) {
        clarifyBounced = true;
        log.push({ op: "clarify(반려)", args: { q: resp.clarify_question },
                   result: { error: "아직 지도·데이터를 보지 않았다. 지평이나 대상 후보를 최소 1회 탐색한 뒤, 가정을 명시하고 진행할 수 있으면 진행하라. 그래도 대상이 갈려 진행이 불가능하면 그때 질문하라." } });
        await emit({ type: "note", text: "프로토콜: 탐색 없는 clarify 반려 (R3)" });
        continue;
      }
      return { final: resp, log, opsTrace, turns };
    }
    return { final: { action: "cannot_answer", reason: "턴 상한 도달 — 계획이 수렴하지 않음" },
             log, opsTrace, turns };
  }

  return { sysPrompt, run, MAX_LOOKUP, MAX_TRYSQL };
});

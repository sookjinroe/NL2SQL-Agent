// agent-analyst-v0-nosem — 분석 에이전트 대조군 (시맨틱 레이어 제거판).
//
// 원본 agent-analyst-v0.js의 fork. 목적: 분석 리포트 시나리오에서
// 시맨틱 레이어의 효과를 검증. 원본과 동일한 루프·규칙·자동 실측·
// 계획/축/리포트 프로토콜을 그대로 두고, sysPrompt만 no-sem 버전으로
// 교체하고 MAX_TRYSQL을 14→20으로 상향(코드값·형식 실측 부담).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AgentAnalystV0Nosem = factory();
})(typeof self !== "undefined" ? self : this, function () {

  const MAX_LOOKUP = 10;
  const MAX_TRYSQL = 20;  // 원본 14 → 20. 코드값·형식 실측·상식 지표 정의 검산 부담

  function sysPrompt(catalogMap) {
    const _d = (y, m) => new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
    const _now = new Date(); const _y = _now.getUTCFullYear(); const _m = _now.getUTCMonth(); const _q = Math.floor(_m / 3);
    const today = _now.toISOString().slice(0, 10);
    const bounds = `이번 달 [${_d(_y, _m)} ~ ${_d(_y, _m + 1)}), 지난 달 [${_d(_y, _m - 1)} ~ ${_d(_y, _m)}), 이번 분기 [${_d(_y, _q * 3)} ~ ${_d(_y, _q * 3 + 3)}), 지난 분기 [${_d(_y, _q * 3 - 3)} ~ ${_d(_y, _q * 3)}), 올해 [${_d(_y, 0)} ~ ${_d(_y + 1, 0)})
진행 중 기간의 공정 비교: 이번 달 진행분 [${_d(_y, _m)} ~ ${today}) ↔ 전월 동일 일수 [${_d(_y, _m - 1)} ~ ${new Date(Date.UTC(_y, _m - 1, _now.getUTCDate())).toISOString().slice(0, 10)})`;
    return `너는 데이터 분석 에이전트다. 이 세팅에는 시맨틱 레이어가 없다 —
컬럼 설명·용어 사전·정본 지표·코드 사전 어느 것도 제공되지 않는다. 분석 목적 하나를
받아 계획을 선언하고, 스키마와 여러 실행(try_sql·compute)으로 확인한 뒤, 근거가 붙은
리포트로 답한다. 단일 사실 질문이면 계획 없이 SQL 하나로 답해도 된다.

오늘 날짜는 ${today}다. 상대 기간(지난 분기, 최근 90일, 이번 달 진행분 ↔ 전월
동일 일수 비교 등)의 경계 날짜는 compute로 직접 계산해 확정하고, 기간 필터는
반열림 구간 [시작 이상, 끝 미만)으로 쓴다.

━━━ 스키마 ━━━
${catalogMap}
━━━━━━━━━━

[연산 — action:"op"로 호출한다. 조회 연산과 try_sql은 횟수 제한이 따로 있고,
 남은 횟수는 매 턴 [남은 예산]으로 표시된다]
- search {query}          컬럼·테이블 이름에서 문자열 매칭 검색. 도메인 지식 없이 이름 유사도만.
- browse_terms            이 세팅에서 비활성 (용어 사전 없음).
- get_column {id}         컬럼의 스키마 정보 (타입·nullable·PK/FK). id는 "테이블.컬럼".
- resolve_code            이 세팅에서 비활성 (코드 사전 없음). 코드값 매핑은 try_sql로 실측하라.
- get_join_path {table_a, table_b}   FK 조인 경로. 조인은 이 경로만 쓴다.
- try_sql {sql}           SELECT 하나를 실행해 결과를 확인한다. 값·라벨·형식은 이걸로 알아낸다.
- compute {code}          JS 코드를 실행한다. sql("SELECT ...") 헬퍼로 여러 쿼리를
                          한 번에 배치 실행하고, 계산·판정·검산을 코드로 하라.
                          log(...)로 남긴 것만 결과로 돌아온다. 동기 코드만.
                          예: 지평+정의 확인 배치, 기대치·표준편차 판정,
                          부분합=전체 검산. 리포트의 모든 수치는 try_sql 또는
                          compute의 실행에서 나와야 한다.

[이 세팅의 제약]
- 지표 정의가 지도에 없다. 비율·평균 등은 ①질문에 명시된 정의 ②없으면 상식적 표준
  계산으로 하고, 그 정의를 리포트의 basis(공통 기준)에 명시한다.
- 코드 사전이 없다. 코드성 컬럼(status·enum·cv_id·flag 등)은 값 분포·카운트를 실측해
  라벨↔코드 매핑을 추론하고, 그 추론을 caveats에 적는다. 이름만으로 골라 걸지 마라.
- 컬럼 설명(description)이 없다. 낯선 컬럼의 저장 형식(날짜 표기 등)은 SELECT 한 행
  또는 DISTINCT로 실측해 확인한다. 형식 추측 금지.

[규칙 — 각 규칙은 시스템이 검사하며, 어기면 반려·표시된다]
R1. 리포트와 단답의 모든 수치는 try_sql·compute 실행 결과에서만 온다. 실행하지
    않은 SQL을 제출하면 시스템이 대신 실행해 돌려주고, 실행 기록에 없는
    sql_ref는 미실측으로 표시된다. 리포트는 핵심 수치 하나 이상을 처음과 다른
    독립 경로로 재확인해 verification에 적어야 통과한다 (다른 집계 방향,
    부분합=전체, 건수×평균≈합계 등 — 같은 쿼리 재실행은 재확인이 아니다).
R2. 컬럼명·코드값·이름 리터럴은 스키마와 조회 결과에서만 가져온다. 추측한 컬럼명이
    오류를 내면 시스템이 유사 후보를 알려준다 — 그것으로 정정하라. 코드값 매핑
    (예: status_enum=300이 무엇인지)은 GROUP BY로 값 분포를 실측한 뒤 카운트·문맥
    으로 추론하고, 그 추론을 caveats에 명시한다.
R3. 대상이 갈리거나 정보가 부족해도, 가정을 명시하고 진행할 수 있으면 진행한다.
    아무 탐색·실행 없이 되묻는 질문은 반려된다. 진행이 불가능할 때만 clarify로
    묻는다.
R4. 계획은 실행 전에 한 번 선언하고, 각 축은 판정에 도달하는 대로 axis 액션으로
    종결한다 — done(판정 도달: "차이 없음"·"전제 불성립"도 판정이다),
    dropped(발견으로 불필요해짐 — 사유는 발견에 근거해야 한다),
    blocked(필요한 데이터가 존재하지 않음). 리포트는 모든 축이 종결 상태여야
    통과한다. 섹션은 실측된 발견만 담는다 — "추가 조회 필요" 같은 미래형
    서술은 섹션이 아니라 축의 종결 사유다.
R5. 지표 정의가 지도에 없으므로, 비율·평균은 상식 정의로 계산하되 그 정의를
    리포트의 basis 한 줄과 caveats에 반드시 명시한다 (예: basis="연체율 = 연체 상태
    대출 건 / 전체 활성 대출 건. 활성=상태 300 실측 추론"). 임의의 기준 필터를
    붙였다면 근거도 함께 적는다.

[출력 — JSON 하나만. 마크다운 펜스·설명 텍스트 금지]
연산:   {"action":"op","op":"<연산명>","args":{...},"thinking":"한 문장"}
계획:   {"action":"plan","axes":["축 이름 3~6개"],"comparison":"비교 기준 한 줄","thinking":"한 문장"}
        (실행 전 한 번 — 새 축이 필요할 때만 다시 선언하며, 기존 축의 상태는 유지된다)
축 종결: {"action":"axis","updates":[{"axis":"축 이름","status":"done"|"dropped"|"blocked","why":"한 줄"}],"thinking":"한 문장"}
        (여러 축을 한 번에 종결할 수 있다)
리포트: {"action":"report",
        "title":"리포트 제목",
        "basis":"이 리포트의 공통 기준 한 줄 (기간·상태 필터·지표 정의). 지표 정의는 반드시 여기 명시",
        "sections":[{"heading":"섹션 제목","finding":"수치가 든 발견 서술","sql_ref":[1,3]}],
        "summary":"핵심 발견 2~4문장 종합",
        "caveats":["한계·주의 — 코드값 추론의 근거, 신뢰도 낮은 컬럼 등"],
        "verification":{"claim":"재확인한 핵심 수치","method":"독립 경로 한 줄",
                        "sql_ref":[..],"outcome":"일치"|"불일치 → 정정함"},
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
    if (plan) {
      const okSql = log.filter((e) => (e.op === "try_sql" || e.op === "compute") && e.result && e.result.ok === true).length;
      const stat = plan.axes.map((a, i) => `${i + 1}. ${a.name} [${a.status}${a.why ? ": " + a.why.slice(0, 30) : ""}]`).join(" / ");
      parts.push(``, `[분석 계획] ${stat}`,
                 `비교 기준: ${plan.comparison || "(미선언)"} · 성공한 실행: ${okSql}회`,
                 `open 축은 실행해 done으로, 불필요해졌으면 dropped로, 데이터가 없으면 blocked로 종결하라. 리포트는 전 축 종결 후에만 통과한다.`);
    }
    if (log.length) {
      parts.push(``, `[연산 기록]`);
      let qNo = 0;
      log.forEach((e, i) => {
        let body = JSON.stringify(e.result);
        const cap = e.op === "try_sql" ? 1400 : 900;
        if (body.length > cap) body = body.slice(0, cap) + "…(생략)";
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
    let plan = null;
    let planBounced = false;
    let clarifyBounced = false;
    let verifyBounced = false;
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
        const names = resp.axes.map(String);
        const comparison = resp.comparison ? String(resp.comparison) : null;
        const sig = (ns, c) => JSON.stringify({ a: ns, c });
        if (plan && sig(names, comparison) === sig(plan.axes.map((a) => a.name), plan.comparison)) {
          log.push({ op: "plan", args: { axes: names, comparison },
                     result: { error: "이미 같은 계획이 선언되어 매 턴 표시되고 있다. 재선언하지 말고 open 축을 진행하거나 axis로 종결하라." } });
          await emit({ type: "note", text: "동일 계획 재선언 반려" });
          continue;
        }
        const mk = (n) => {
          const prev = plan && plan.axes.find((a) => a.name === n);
          return prev ? prev : { name: n, status: "open", why: null };
        };
        if (plan) {
          const oldNames = plan.axes.map((a) => a.name);
          const removed = oldNames.filter((n) => !names.includes(n));
          const added = names.filter((n) => !oldNames.includes(n));
          plan = { axes: names.map(mk), comparison, rev: (plan.rev || 1) + 1 };
          const diff = [removed.length ? "-" + removed.join(",-") : "", added.length ? "+" + added.join(",+") : ""].filter(Boolean).join(" / ") || "비교 기준 변경";
          await emit({ type: "note", text: `계획 개정 #${plan.rev}: ${diff}` });
          log.push({ op: "plan", args: { axes: names, comparison }, result: { ok: true, note: `개정 #${plan.rev} 수용 (${diff}). 기존 축의 상태는 승계됨.` } });
        } else {
          plan = { axes: names.map(mk), comparison, rev: 1 };
          await emit({ type: "note", text: `계획 선언: ${plan.axes.length}축 · 비교 기준 ${comparison ? "○" : "✗ 미선언"}` });
          log.push({ op: "plan", args: { axes: names, comparison }, result: { ok: true, note: "계획이 저장되어 매 턴 상태와 함께 표시된다." } });
        }
        continue;
      }

      if (resp.action === "axis") {
        if (!plan) {
          log.push({ op: "axis", args: {}, result: { error: "선언된 계획이 없다 — plan을 먼저 선언하라." } });
          continue;
        }
        const ups = Array.isArray(resp.updates) ? resp.updates
                    : (resp.axis ? [{ axis: resp.axis, status: resp.status, why: resp.why }] : []);
        const VALID = ["done", "dropped", "blocked"];
        const msgs = [];
        for (const u of ups) {
          const q = String(u.axis || "");
          const ax = plan.axes.find((a) => a.name === q) ||
                     plan.axes.find((a) => a.name.includes(q) || q.includes(a.name));
          if (!ax) { msgs.push(`✗ "${q.slice(0, 20)}": 계획에 없는 축`); continue; }
          if (!VALID.includes(u.status)) { msgs.push(`✗ ${ax.name}: status는 done|dropped|blocked`); continue; }
          ax.status = u.status;
          ax.why = u.why ? String(u.why) : null;
          msgs.push(`${ax.name} → ${u.status}${ax.why ? ` (${ax.why.slice(0, 36)})` : ""}`);
        }
        const line = msgs.join(" · ") || "갱신 없음 — updates 배열을 확인하라";
        await emit({ type: "note", text: `축 상태: ${line}` });
        log.push({ op: "axis", args: { updates: ups }, result: { ok: true, note: line } });
        continue;
      }

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
        const openAxes = plan ? plan.axes.filter((a) => a.status === "open") : [];
        if (openAxes.length && !planBounced) {
          planBounced = true;
          await emit({ type: "note", text: `프로토콜: 미종결 축 ${openAxes.length}개 — 리포트 반려` });
          log.push({ op: "report(반려)", args: { open: openAxes.map((a) => a.name) },
                     result: { error: `종결되지 않은 축: ${openAxes.map((a) => a.name).join(", ")}. 갈래는 셋이다 — ① 남은 예산으로 실행해 done으로 종결, ② 발견으로 불필요해졌으면 dropped(사유 필수), ③ 데이터가 존재하지 않으면 blocked. axis 액션으로 종결한 뒤 재제출하라. "추가 조회 필요" 같은 미래형 서술을 섹션에 넣지 마라.` } });
          continue;
        }
        if (openAxes.length) resp._open_axes = openAxes.map((a) => a.name);
        const v = resp.verification;
        const vOk = v && v.claim && v.method && v.outcome;
        if (!vOk && !verifyBounced && (MAX_TRYSQL - sqlUsed) >= 1) {
          verifyBounced = true;
          log.push({ op: "report(반려)", args: { reason: "verification 미비" },
                     result: { error: "핵심 수치 하나를 처음과 다른 독립 경로로 재확인하고 verification{claim, method, sql_ref, outcome}을 채워 재제출하라. 같은 쿼리 재실행은 재확인이 아니다." } });
          await emit({ type: "note", text: "프로토콜: 검산 없는 리포트 반려 (R1)" });
          continue;
        }
        if (vOk) {
          const vrefs = Array.isArray(v.sql_ref) ? v.sql_ref : (v.sql_ref != null ? [v.sql_ref] : []);
          const vvalid = vrefs.filter((n) => Number.isInteger(n) && n >= 1 && n <= okList.length);
          resp._verification_unverified = vrefs.length > 0 && vvalid.length !== vrefs.length;
          if (vvalid.length) v.sql = vvalid.map((n) => okList[n - 1]).join(";\n");
        } else {
          resp._verification_missing = true;
          await emit({ type: "note", text: "주의: verification 없이 제출됨 (반려 소진)" });
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
        if (!r.ok) sqlUsed--;
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
          const fw = (typeof ComputeCore !== "undefined" ? ComputeCore
                       : (typeof require !== "undefined" ? require("./compute-core.js") : null));
          if (fw) {
            const w = fw.fanoutCheck((resp.args || {}).sql || "", CHILD_GRAIN_TABLES);
            const uh = fw.unitHints(r.public.rows || []);
            const ah = fw.anomalyHints ? fw.anomalyHints(r.public.rows || []) : null;
            const both = [w, uh, ah].filter(Boolean).join(" / ");
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

// ============================================================
// scorer.js — 평가 하니스의 채점기. 브라우저/node 겸용 순수 JS.
// 원칙: SQL 문자열이 아니라 '실행 결과' 비교. 골든 SQL을 라이브 재실행해
//   풀 결과로 대조한다(저장된 골든 rows는 30행 캡이므로).
// D8 3단(clarify): 확인요청=정답 / 가정명시+해석일치=부분 / 무가정단일=오답.
// 환각(경계): 결손 컬럼에 리터럴 필터·CASE 라벨 매핑이 등장하면 구조적으로 검출.
// verdict: correct | partial | wrong  + flags: [hallucination, tool_miss]
// ============================================================
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Scorer = factory();
})(typeof self !== "undefined" ? self : this, function () {

  // 의도된 결손 컬럼 (환각 검출 대상) — ground_truth와 정합, 하니스 상수
  const EXCLUDED_CODE_COLS = ["CHNL_CD", "CNTC_TYPE_CD"];

  // ---- SQL 실행 (exec: sql.js Database.exec 래퍼를 주입받음) ----
  function runSql(db, sql) {
    const s = sql.trim().replace(/;+\s*$/, "");
    if (!/^select\b/i.test(s)) throw new Error("SELECT만 허용");
    const res = db.exec(s);
    if (!res.length) return [];
    const { columns, values } = res[0];
    return values.map((v) => { const o = {}; columns.forEach((c, i) => (o[c] = v[i])); return o; });
  }

  // ---- 결과 비교 v2 (1차 실측 보정) ----
  // 원칙: 채점은 '의미 동치'를 본다 —
  //  (1) 수치 상대오차 2e-3 허용 (반올림 차이 흡수; 함정값 간 격차 ~10%는 보존)
  //  (2) 백분율 동치: 비율형 값(절대값<1이 한쪽에 존재)에 한해 ×100 표현을 동치로
  //      (건수류 정수에는 미적용 — 3 vs 300 오인 차단)
  //  (3) 골든 컬럼 ⊆ 에이전트 컬럼: 행 수가 같고, 골든 각 행의 값들이 에이전트
  //      해당 행 값들의 부분집합(중복 고려)이면 일치 — 정당하게 획득한 라벨·이름
  //      등 '추가 컬럼'은 감점 사유가 아니다. 행 순서는 무시(multiset).
  function numEq(g, a) {
    if (g === a) return true;
    const d = Math.abs(g - a), m = Math.max(Math.abs(g), Math.abs(a), 1e-12);
    return d / m < 2e-3;
  }
  // codedict 동치: 골든이 코드값(15)이고 에이전트가 라벨('남성')이거나 그 반대면 동치로 인정.
  // setCodeDict(layer.codedict)로 주입 - {"table.col": {"15": "남성", ...}}
  let CODE_EQUIV = null; // Map<string, Set<string>> - "15" ↔ "남성" 양방향
  function setCodeDict(codedict) {
    CODE_EQUIV = new Map();
    for (const col in codedict || {}) {
      for (const [code, label] of Object.entries(codedict[col])) {
        const c = String(code).trim(), l = String(label).trim();
        if (!CODE_EQUIV.has(c)) CODE_EQUIV.set(c, new Set());
        if (!CODE_EQUIV.has(l)) CODE_EQUIV.set(l, new Set());
        CODE_EQUIV.get(c).add(l); CODE_EQUIV.get(l).add(c);
      }
    }
  }
  function codeEquiv(g, a) {
    if (!CODE_EQUIV) return false;
    const gs = String(g).trim(), as = String(a).trim();
    const eq = CODE_EQUIV.get(gs);
    return !!(eq && eq.has(as));
  }

  function valEq(g, a) {
    if (g === null || g === undefined) return a === null || a === undefined;
    if (codeEquiv(g, a)) return true;
    if (typeof g === "number" && typeof a === "number") {
      if (numEq(g, a)) return true;
      if (Math.min(Math.abs(g), Math.abs(a)) < 1 && (numEq(g * 100, a) || numEq(g, a * 100))) return true;
      return false;
    }
    return String(g).trim() === String(a).trim();
  }
  function rowMatch(gVals, aVals) {
    const pool = [...aVals];
    for (const gv of gVals) {
      const i = pool.findIndex((av) => valEq(gv, av));
      if (i < 0) return false;
      pool.splice(i, 1);
    }
    return true;
  }
  // sameResult(agentRows, goldenRows) — 방향성 있음: 골든이 에이전트에 포함되는가
  function sameResult(agentRows, goldenRows) {
    if (agentRows.length !== goldenRows.length) return false;
    const pool = agentRows.map((r) => Object.values(r));
    for (const g of goldenRows.map((r) => Object.values(r))) {
      const i = pool.findIndex((a) => rowMatch(g, a));
      if (i < 0) return false;
      pool.splice(i, 1);
    }
    return true;
  }

  // ---- 환각 구조 검출 ----
  function detectHallucination(sql) {
    const flags = [];
    for (const col of EXCLUDED_CODE_COLS) {
      // 결손 컬럼에 리터럴 비교/IN: 사전 없이 값을 '아는 척'
      const lit = new RegExp(col + "\\s*(=|IN\\s*\\()\\s*'", "i");
      if (lit.test(sql)) flags.push(`결손 컬럼 ${col}에 리터럴 필터 (사전 없이 코드값 단정)`);
      // 결손 컬럼 코드에 의미 라벨을 지어내는 CASE 매핑
      const cs = new RegExp("CASE\\s+(WHEN\\s+)?[^E]*" + col + "[\\s\\S]*?THEN\\s*'[^']*[가-힣]", "i");
      if (cs.test(sql)) flags.push(`결손 컬럼 ${col} 코드에 의미 라벨 매핑 (라벨 발명)`);
    }
    return flags;
  }

  // ---- 본채점 ----
  // agentOut: {action, sql?, clarify_question?, options?, reason?, assumptions?, confidence?}
  // trace: {ops:[{op,args,hit}], turns}
  function score(db, q, agentOut, trace) {
    const r = { id: q.id, cat: q.cat, verdict: "wrong", flags: [], detail: "", ops_recall: 0, n_ops: 0 };
    const ops = (trace && trace.ops) || [];
    r.n_ops = ops.length;
    const called = new Set(ops.map((o) => o.op));
    const exp = q.expected_ops || [];
    r.ops_recall = exp.length ? exp.filter((o) => called.has(o)).length / exp.length : 1;
    // tool-miss: 검색 연산이 호출됐는데 후보 0건 → 도구 책임 플래그 (에이전트 면책 표지)
    if (ops.some((o) => (o.op === "resolve_terms" || o.op === "search_columns") && o.hit === false))
      r.flags.push("tool_miss");

    const A = agentOut || {};
    try {
      if (q.mode === "sql") {
        if (A.action !== "sql" || !A.sql) { r.detail = `SQL 기대, ${A.action || "무응답"} 수신`; return r; }
        const hall = detectHallucination(A.sql);
        if (hall.length) { r.flags.push("hallucination"); r.detail = hall.join("; "); return r; }
        const got = runSql(db, A.sql);
        const goldens = [q.golden.sql, ...((q.golden.alternatives || []).map((a) => a.sql))];
        for (const gs of goldens) {
          if (sameResult(got, runSql(db, gs))) { r.verdict = "correct"; r.detail = "실행 결과 일치"; return r; }
        }
        r.detail = "실행 결과 불일치";
        return r;
      }
      if (q.mode === "clarify") {
        if (A.action === "clarify") { r.verdict = "correct"; r.detail = "확인 요청 (D8 정답)"; return r; }
        if (A.action === "sql" && A.sql) {
          const hall = detectHallucination(A.sql);
          if (hall.length) { r.flags.push("hallucination"); r.detail = hall.join("; "); return r; }
          const got = runSql(db, A.sql);
          const hit = q.golden.interpretations.find((i) => sameResult(got, runSql(db, i.sql)));
          if (hit && (A.assumptions || []).length) {
            r.verdict = "partial"; r.detail = `가정 명시 + '${hit.label}' 일치 (D8 부분)`; return r;
          }
          if (hit) { r.detail = `'${hit.label}'과 일치하나 가정 미명시 (D8 오답)`; return r; }
          r.detail = "어느 해석과도 불일치"; return r;
        }
        r.detail = `clarify/sql 기대, ${A.action || "무응답"} 수신`; return r;
      }
      if (q.mode === "missing") {
        const honest = A.action === "cannot_answer" || A.action === "clarify";
        if (A.action === "sql" && A.sql) {
          const hall = detectHallucination(A.sql);
          if (hall.length) { r.flags.push("hallucination"); r.detail = hall.join("; "); return r; }
          // B03(폴백 가능) / B02(코드 그대로 제시): world_truth 일치 + 신뢰도 한정 시 인정
          if (q.golden.world_truth) {
            const got = runSql(db, A.sql);
            if (sameResult(got, runSql(db, q.golden.world_truth.sql))) {
              const caveated = (A.confidence && A.confidence !== "HIGH") || (A.assumptions || []).length;
              r.verdict = caveated ? "correct" : "partial";
              r.detail = caveated ? "세계 진실 일치 + 신뢰도 한정" : "일치하나 무한정 단정 (부분)";
              return r;
            }
            r.detail = "세계 진실과 불일치"; return r;
          }
          r.detail = "존재하지 않는 개념에 SQL 응답"; r.flags.push("hallucination"); return r;
        }
        if (honest) { r.verdict = "correct"; r.detail = "정직한 보고/확인 요청"; return r; }
        r.detail = `행동 불명 (${A.action || "무응답"})`; return r;
      }
    } catch (e) {
      r.detail = "SQL 실행 오류: " + (e.message || e); return r;
    }
    return r;
  }

  function aggregate(results) {
    const byCat = {};
    for (const r of results) {
      const b = (byCat[r.cat] = byCat[r.cat] || { n: 0, correct: 0, partial: 0, wrong: 0, hallucination: 0, tool_miss: 0, ops: 0, recall: 0 });
      b.n++; b[r.verdict]++;
      if (r.flags.includes("hallucination")) b.hallucination++;
      if (r.flags.includes("tool_miss")) b.tool_miss++;
      b.ops += r.n_ops; b.recall += r.ops_recall;
    }
    for (const k in byCat) { const b = byCat[k]; b.avg_ops = +(b.ops / b.n).toFixed(1); b.avg_recall = +(b.recall / b.n).toFixed(2); delete b.ops; delete b.recall; }
    return byCat;
  }

  return { score, aggregate, runSql, sameResult, detectHallucination, setCodeDict, EXCLUDED_CODE_COLS };
});

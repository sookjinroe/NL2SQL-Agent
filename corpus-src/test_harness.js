#!/usr/bin/env node
// test_harness.js — 채점기 자가검증 (LLM 없음).
// ① oracle: 골든을 그대로 재생하는 합성 에이전트 → 전 문항 correct여야 함.
// ② defect: 의도적 오답 6종 → 채점기가 정확히 잡아야 함.
// 하나라도 어긋나면 하니스 버그 — 모델 점수를 신뢰할 수 없음.
const fs = require("fs");
const initSqlJs = require("sql.js");
const Scorer = require("./nlapp/js/scorer.js");

(async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync("out/world.db"));
  const Q = JSON.parse(fs.readFileSync("out/questions.json", "utf8"));
  let fail = 0;
  const expect = (cond, msg) => { if (!cond) { fail++; console.log("  ✗", msg); } };

  // ---------- ① oracle ----------
  console.log("=== ① oracle 에이전트 (골든 재생) ===");
  const oracleResults = [];
  for (const q of Q) {
    let out;
    if (q.mode === "sql") out = { action: "sql", sql: q.golden.sql, assumptions: [], confidence: "HIGH" };
    else if (q.mode === "clarify") out = { action: "clarify", clarify_question: "어느 기준인가요?" };
    else out = q.golden.world_truth && q.id === "B03"
      ? { action: "sql", sql: q.golden.world_truth.sql, assumptions: ["Term 미등재 — Description 검색 폴백"], confidence: "MEDIUM" }
      : { action: "cannot_answer", reason: "레이어에 근거 없음" };
    const r = Scorer.score(db, q, out, { ops: (q.expected_ops || []).map((op) => ({ op, hit: true })) });
    oracleResults.push(r);
    expect(r.verdict === "correct", `oracle ${q.id}: ${r.verdict} (${r.detail})`);
    expect(r.ops_recall === 1, `oracle ${q.id}: ops_recall ${r.ops_recall}`);
  }
  const agg = Scorer.aggregate(oracleResults);
  console.log("  oracle 집계:", JSON.stringify(agg));
  const total = oracleResults.length, ok = oracleResults.filter((r) => r.verdict === "correct").length;
  console.log(`  oracle: ${ok}/${total} correct ${ok === total ? "✓" : "✗✗✗"}`);

  // ---------- ② defect ----------
  console.log("=== ② defect 에이전트 (오답 검출) ===");
  const cases = [
    // D-1 메트릭 함정 무시: 연체율을 소박하게 재계산 (상각·완제 포함) → wrong이어야
    ["N02 소박 연체율", "N02",
     { action: "sql", sql: "SELECT ROUND(COUNT(CASE WHEN DLNQ_FLG='Y' THEN 1 END)*1.0/COUNT(*),4) AS r FROM LOAN_ACCT_MST", assumptions: [], confidence: "HIGH" },
     (r) => r.verdict === "wrong"],
    // D-2 승인율 분모 함정 → wrong
    ["N12 분모 전체", "N12",
     { action: "sql", sql: "SELECT ROUND(COUNT(CASE WHEN APPL_STAT_CD='03' THEN 1 END)*1.0/COUNT(*),4) AS r FROM LOAN_APPL_HIST", assumptions: [], confidence: "HIGH" },
     (r) => r.verdict === "wrong"],
    // D-3 경계 환각: CHNL_CD 코드값 추측 → hallucination 플래그
    ["B01 코드 추측", "B01",
     { action: "sql", sql: "SELECT COUNT(*) FROM LOAN_APPL_HIST WHERE CHNL_CD='02'", assumptions: [], confidence: "HIGH" },
     (r) => r.verdict === "wrong" && r.flags.includes("hallucination")],
    // D-4 라벨 발명: 접촉유형 코드에 의미 매핑 → hallucination
    ["B02 라벨 발명", "B02",
     { action: "sql", sql: "SELECT CASE WHEN CNTC_TYPE_CD='01' THEN '전화' ELSE '기타' END g, COUNT(*) FROM CUST_CNTC_HIST GROUP BY g", assumptions: [], confidence: "HIGH" },
     (r) => r.flags.includes("hallucination")],
    // D-5 D8 무가정 단일답: 모호 질문에 가정 없이 한쪽 → wrong (값은 맞는데도)
    ["F01 무가정 단일", "F01",
     { action: "sql", sql: "SELECT ROUND(COUNT(CASE WHEN DLNQ_FLG='Y' THEN 1 END)*1.0/COUNT(*),4) AS r FROM LOAN_ACCT_MST WHERE ACCT_STAT_CD NOT IN ('04','05')", assumptions: [], confidence: "HIGH" },
     (r) => r.verdict === "wrong"],
    // D-6 D8 가정 명시: 같은 답 + 가정 → partial
    ["F01 가정 명시", "F01",
     { action: "sql", sql: "SELECT ROUND(COUNT(CASE WHEN DLNQ_FLG='Y' THEN 1 END)*1.0/COUNT(*),4) AS r FROM LOAN_ACCT_MST WHERE ACCT_STAT_CD NOT IN ('04','05')", assumptions: ["대출 연체율로 가정"], confidence: "MEDIUM" },
     (r) => r.verdict === "partial"],
    // D-7 B04 존재하지 않는 개념에 임의 기준 SQL → wrong + hallucination
    ["B04 임의 기준", "B04",
     { action: "sql", sql: "SELECT COUNT(*) FROM DEP_ACCT_MST WHERE ACCT_STAT_CD='30'", assumptions: ["거래중지를 휴면으로 가정"], confidence: "LOW" },
     (r) => r.verdict === "wrong"],
    // V2-1 추가 컬럼(라벨) — 이제 correct여야 (N15 유형)
    ["N15 라벨 컬럼", "N15",
     { action: "sql", sql: "SELECT CLTRL_TYPE_CD, CASE CLTRL_TYPE_CD WHEN '01' THEN '아파트' WHEN '02' THEN '단독주택' WHEN '03' THEN '토지' WHEN '04' THEN '예적금담보' ELSE '기타' END nm, SUM(CLTRL_VAL_AMT) amt FROM LOAN_CLTRL_INFO GROUP BY CLTRL_TYPE_CD", assumptions: [], confidence: "HIGH" },
     (r) => r.verdict === "correct"],
    // V2-2 백분율 표현 — 이제 correct여야 (N10 유형)
    ["N10 백분율", "N10",
     { action: "sql", sql: "SELECT ROUND(100.0*COUNT(CASE WHEN RPYMT_MTHD_CD='3' THEN 1 END)/COUNT(*),2) FROM CARD_BILL_HIST", assumptions: [], confidence: "HIGH" },
     (r) => r.verdict === "correct"],
    // V2-3 무반올림 — 허용오차로 correct여야 (N14 유형)
    ["N14 무반올림", "N14",
     { action: "sql", sql: "SELECT AVG(INT_RATE) FROM LOAN_ACCT_MST WHERE ACCT_STAT_CD NOT IN ('04','05')", assumptions: [], confidence: "HIGH" },
     (r) => r.verdict === "correct"],
    // V2-4 함정값 비혼동 — 백분율 규칙이 소박 재계산을 정답화하면 안 됨
    ["N02 소박-백분율", "N02",
     { action: "sql", sql: "SELECT ROUND(100.0*COUNT(CASE WHEN DLNQ_FLG='Y' THEN 1 END)/COUNT(*),2) FROM LOAN_ACCT_MST", assumptions: [], confidence: "HIGH" },
     (r) => r.verdict === "wrong"],
    // D-8 tool_miss 플래그: 검색 0건 트레이스 → 플래그
    ["N01 tool-miss 표지", "N01",
     { action: "sql", sql: "SELECT 1", assumptions: [], confidence: "LOW" },
     (r) => r.flags.includes("tool_miss"), { ops: [{ op: "resolve_terms", hit: false }] }],
  ];
  for (const [name, qid, out, check, trace] of cases) {
    const q = Q.find((x) => x.id === qid);
    const r = Scorer.score(db, q, out, trace || { ops: [] });
    const pass = check(r);
    console.log(`  ${pass ? "✓" : "✗"} ${name} → ${r.verdict} flags=[${r.flags}] ${r.detail}`);
    if (!pass) fail++;
  }

  console.log("=".repeat(50));
  if (fail) { console.log(`[하니스 자가검증 실패] ${fail}건`); process.exit(1); }
  console.log("[하니스 자가검증 통과] oracle 100% + 결함 8종 전부 검출");
})();

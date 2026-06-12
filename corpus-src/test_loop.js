#!/usr/bin/env node
// test_loop.js — 에이전트 루프 코어 헤드리스 검증 (스크립트 가짜 모델).
// 검증: ①정상 경로(연산→최종 SQL→채점 통합) ②중복 호출 가드 ③상한 도달 강제 종결
const fs = require("fs");
const initSqlJs = require("sql.js");
const Ops = require("./nlapp/js/layer-ops.js");
const Scorer = require("./nlapp/js/scorer.js");
const Core = require("./nlapp/js/agent-core.js");
const NLDataSrc = fs.readFileSync("./nlapp/js/nl-data.js", "utf8");
const win = { }; new Function("window", NLDataSrc)(win); // window.NLData 추출
const NLData = win.NLData;

(async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync("out/world.db"));
  const layer = {};
  for (const f of ["terms","columns","tables","metrics","codedict"])
    layer[f] = JSON.parse(fs.readFileSync(`out/layer/${f}.json`, "utf8"));
  Ops.init(layer);
  const Q = JSON.parse(fs.readFileSync("out/questions.json", "utf8"));
  let fail = 0;
  const ok = (c, m) => { console.log((c ? "✓" : "✗") + " " + m); if (!c) fail++; };

  // ① 정상 경로: N03을 스크립트로 — resolve_terms → get_term → resolve_code → sql
  const q = Q.find((x) => x.id === "N03");
  const script = [
    { action: "op", op: "resolve_terms", args: { query: "기한이익상실" }, thinking: "Term 매칭부터" },
    { action: "op", op: "get_term", args: { term: "기한이익상실" }, thinking: "실현 확인" },
    { action: "op", op: "resolve_code", args: { column: "LOAN_ACCT_MST.ACCT_STAT_CD", query: "기한이익상실" }, thinking: "코드 리터럴 확정" },
    { action: "sql", sql: "SELECT SUM(LOAN_BAL_AMT) AS total FROM LOAN_ACCT_MST WHERE ACCT_STAT_CD='03'",
      assumptions: [], confidence: "HIGH", thinking: "expressed_as value 그대로" },
  ];
  let i = 0;
  const fakeComplete = async () => script[Math.min(i++, script.length - 1)];
  const r1 = await Core.runAgent({ question: q.text, complete: fakeComplete,
    layerCall: Ops.call, sysPrompt: NLData.NL_SYS, userPrompt: NLData.userPrompt,
    maxOps: NLData.MAX_OPS, onEvent: async () => {} });
  ok(r1.final.action === "sql" && r1.opsTrace.length === 3, `정상 경로: 연산 3회 후 최종 SQL (turns=${r1.turns})`);
  const s1 = Scorer.score(db, q, r1.final, { ops: r1.opsTrace });
  ok(s1.verdict === "correct" && s1.ops_recall === 1, `채점 통합: ${s1.verdict}, recall=${s1.ops_recall}`);

  // ② 중복 호출 가드
  i = 0;
  const dupScript = [
    { action: "op", op: "resolve_terms", args: { query: "연체" } },
    { action: "op", op: "resolve_terms", args: { query: "연체" } }, // 중복
    { action: "cannot_answer", reason: "테스트" },
  ];
  const r2 = await Core.runAgent({ question: "x", complete: async () => dupScript[Math.min(i++, 2)],
    layerCall: Ops.call, sysPrompt: NLData.NL_SYS, userPrompt: NLData.userPrompt, maxOps: 10, onEvent: async () => {} });
  ok(r2.opsTrace.length === 1 && r2.log.length === 2 && /중복/.test(JSON.stringify(r2.log[1].result)),
     "중복 가드: 실호출 1회, 중복 표지 기록");

  // ③ 상한 강제 종결: 영원히 새 연산만 내는 모델
  let j = 0;
  const r3 = await Core.runAgent({ question: "x",
    complete: async () => ({ action: "op", op: "get_table", args: { name: "T" + (j++) } }),
    layerCall: Ops.call, sysPrompt: NLData.NL_SYS, userPrompt: NLData.userPrompt, maxOps: 5, onEvent: async () => {} });
  ok(r3.final.action === "cannot_answer" && /상한/.test(r3.final.reason),
     `상한 종결: ${r3.final.reason} (turns=${r3.turns})`);

  console.log("=".repeat(40));
  if (fail) { console.log(`[루프 검증 실패] ${fail}건`); process.exit(1); }
  console.log("[루프 코어 검증 통과]");
})();

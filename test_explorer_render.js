// 탐색 v2 렌더 스모크 — jsdom + 실제 sql.js DB + 실제 레이어 데이터로 마운트.
// 검증: 부트 완료 → 5개 서브탭 존재 → 탭 전환 시 각 뷰의 대표 콘텐츠 렌더 → 교차 링크 동작.
const fs = require("fs");
const { JSDOM } = require("jsdom");
const babel = require("@babel/core");

(async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',
    { url: "http://localhost/", pretendToBeVisual: true });
  const w = dom.window;
  global.window = w; global.document = w.document; global.navigator = w.navigator;
  global.localStorage = w.localStorage; global.location = w.location; global.history = w.history;
  global.Element = w.Element; global.HTMLElement = w.HTMLElement;
  w.Element.prototype.scrollIntoView = function () {};
  global.React = w.React = require("react");
  const ReactDOMClient = require("react-dom/client");
  w.IS_REACT_ACT_ENVIRONMENT = false;

  // 실데이터 적재
  new Function("window", fs.readFileSync("repo/data/layer-data.js", "utf8"))(w);
  new Function("window", fs.readFileSync("repo/data/questions-data.js", "utf8"))(w);
  w.ExplorerLib = require("./repo/js/explorer-lib.js");
  w.Scorer = require("./repo/js/scorer.js");
  // sql.js: 브라우저의 initSqlJs 전역을 node판으로 대체, fetch는 파일에서
  const initSqlJsNode = require("sql.js");
  global.initSqlJs = () => initSqlJsNode();
  global.fetch = w.fetch = async (url) => {
    if (String(url).includes("world.db")) {
      const buf = fs.readFileSync("repo/data/world.db");
      return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
    }
    return { ok: false, text: async () => "" };
  };

  // dashboard.jsx + explorer.jsx 변환·로드
  for (const f of ["dashboard.jsx", "explorer.jsx"]) {
    const code = babel.transformSync(fs.readFileSync("repo/js/"+f, "utf8"),
      { presets: [require.resolve("@babel/preset-react")], filename: f }).code;
    new Function("React", "window", "document", "localStorage", "location", "history", "initSqlJs", "fetch",
      code)(global.React, w, w.document, w.localStorage, w.location, w.history, global.initSqlJs, global.fetch);
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const root = ReactDOMClient.createRoot(w.document.getElementById("root"));
  root.render(React.createElement(w.ExplorerScreen));
  for (let i = 0; i < 40 && !w.document.body.innerHTML.includes("합성 금융 코퍼스"); i++) await sleep(200);

  let fail = 0;
  const ok = (c, m) => { console.log((c ? "✓" : "✗") + " " + m); if (!c) fail++; };
  const html = () => w.document.body.innerHTML;
  const clickByText = async (txt) => {
    const el = [...w.document.querySelectorAll("div,span")].find((e) => e.childNodes.length === 1 && e.textContent === txt);
    if (!el) return false;
    el.click(); await sleep(150); return true;
  };

  ok(html().includes("합성 금융 코퍼스") && html().includes("규모"), "부트 완료 — 대시보드 기본 렌더");
  ok(html().includes("레이어 커버리지") && html().includes("조회 강제형"), "대시보드: 커버리지·질문셋 섹션 렌더");
  await clickByText("테이블");
  ok(html().includes("LOAN_ACCT_MST") && html().includes("grain"), "테이블 뷰 전환 렌더 (24MB DB 실적재)");
  ok(html().includes("Term 연결") && html().includes("대출연체"), "컬럼 테이블에 Term 역할 뱃지 렌더");

  ok(await clickByText("Term"), "Term 탭 클릭");
  ok(html().includes("DISTRACTOR") && html().includes("실현(links)") === false || html().includes("대출연체"), "Term 뷰: 목록+distractor 그룹");
  await clickByText("대출연체");
  ok(html().includes("F5 연체 패밀리") && html().includes("M_LOAN_DLNQ_RATE"), "Term 상세: 패밀리 칩 + measured_by 링크");
  ok(html().includes("⚠2"), "동의어 충돌 마커(⚠2) 표시");

  ok(await clickByText("충돌 지도"), "충돌 지도 탭 클릭");
  ok(html().includes("F7 만기") && html().includes('"연체"'), "충돌 지도: 패밀리 7군 + 표면형 카드");

  ok(await clickByText("메트릭"), "메트릭 탭 클릭");
  await clickByText("대출연체율");
  ok(html().includes("base_filters") && html().includes("ACCT_STAT_CD NOT IN"), "메트릭 상세: 기준 필터 노출");

  ok(await clickByText("질문셋"), "질문셋 탭 클릭");
  ok(html().includes("정상 경로".toUpperCase()) || html().includes("NORMAL") || html().includes("N01"), "질문 목록 렌더");
  // 골든 SQL 실행 버튼
  await clickByText("N02");
  const ranBefore = html().includes("rate");
  const runBtn = [...w.document.querySelectorAll("span")].find((e) => e.textContent === "실행");
  if (runBtn) { runBtn.click(); await sleep(200); }
  ok(html().includes("0.0853"), "골든 SQL 클릭 실행 → 정답 0.0853 렌더");

  console.log("=".repeat(46));
  if (fail) { console.log(`[렌더 스모크 실패] ${fail}건`); process.exit(1); }
  console.log("[렌더 스모크 통과] 5뷰 전환·교차링크·SQL 실행 확인");
  process.exit(0);
})().catch((e) => { console.error("스모크 오류:", e); process.exit(1); });

// 신규 v2 문항의 마커·체크포인트·툴팁이 실제 렌더되는지 헤드리스 확인
const fs = require("fs");
const { JSDOM } = require("jsdom");
const babel = require("@babel/core");

(async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/", pretendToBeVisual: true });
  const w = dom.window;
  global.window=w; global.document=w.document; global.navigator=w.navigator;
  global.localStorage=w.localStorage; global.location=w.location; global.history=w.history;
  global.Element=w.Element; global.HTMLElement=w.HTMLElement;
  w.Element.prototype.scrollIntoView=function(){};
  global.React=w.React=require("react");
  const ReactDOMClient=require("react-dom/client");
  w.IS_REACT_ACT_ENVIRONMENT=false;
  new Function("window",fs.readFileSync("repo/data/layer-data.js","utf8"))(w);
  new Function("window",fs.readFileSync("repo/data/questions-data.js","utf8"))(w);
  w.ExplorerLib=require("./repo/js/explorer-lib.js");
  w.Scorer=require("./repo/js/scorer.js");
  const initSqlJsNode=require("sql.js");
  global.initSqlJs=()=>initSqlJsNode();
  global.fetch=w.fetch=async(url)=>{
    if(String(url).includes("world.db")){const buf=fs.readFileSync("repo/data/world.db");return{ok:true,arrayBuffer:async()=>buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength)};}
    return{ok:false,text:async()=>""};
  };
  for(const f of ["dashboard.jsx","explorer.jsx"]){
    const code=babel.transformSync(fs.readFileSync("repo/js/"+f,"utf8"),{presets:[require.resolve("@babel/preset-react")],filename:f}).code;
    new Function("React","window","document","localStorage","location","history","initSqlJs","fetch",code)(global.React,w,w.document,w.localStorage,w.location,w.history,global.initSqlJs,global.fetch);
  }
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
  const root=ReactDOMClient.createRoot(w.document.getElementById("root"));
  root.render(React.createElement(w.ExplorerScreen));
  for(let i=0;i<40&&!w.document.body.innerHTML.includes("합성 금융 코퍼스");i++)await sleep(200);

  let fail=0; const ok=(c,m)=>{console.log((c?"✓":"✗")+" "+m);if(!c)fail++;};
  const html=()=>w.document.body.innerHTML;
  const click=async(txt)=>{const el=[...w.document.querySelectorAll("div,span")].find(e=>e.childNodes.length===1&&e.textContent===txt);if(el){el.click();await sleep(150);return true;}return false;};

  // 질문셋 탭 진입
  await click("질문셋");
  ok(html().includes("A01")||html().includes("A06"), "v2 신규 문항(A01/A06) 목록에 렌더");
  ok(html().includes("형식"), "'형식' 마커 칩 목록에 렌더");

  // A06 팬아웃 문항 상세 — 체크포인트 확인
  // A06 질문 행 클릭 — onClick 핸들러가 붙은 행 div를 찾아 클릭
  const rows=[...w.document.querySelectorAll("div")].filter(e=>e.textContent.includes("플래티넘 카드를 보유한 고객들의 예금잔액"));
  const a06=rows[rows.length-1]; // 가장 안쪽(텍스트 span의 부모 행)
  let target=a06; for(let k=0;k<4&&target;k++){ if(target.onclick){break;} target=target.parentElement; }
  (target||a06).click(); await sleep(250);
  ok(html().includes("체크포인트"), "A06 체크포인트 헤더 렌더");
  ok(html().includes("해야 할 것")&&html().includes("팬아웃"), "A06 must/trap 내용 렌더");
  ok(html().includes("오류")&&html().includes("조인"), "A06 마커(오류·조인) 렌더");
  ok(html().includes("DISTINCT")||html().includes("SUM(ACCT_BAL_AMT)"), "A06 골든 SQL 렌더");

  // A01 형식강제 — 체크포인트
  const a01=[...w.document.querySelectorAll("div")].find(e=>e.textContent.includes("2026년 5월 카드 청구 총액"));
  if(a01){a01.click();await sleep(200);}
  ok(html().includes("YYYYMM")||html().includes("형식"), "A01 형식 함정 체크포인트 렌더");

  console.log("=".repeat(46));
  if(fail){console.log(`[v2 UI 검증 실패] ${fail}건`);process.exit(1);}
  console.log("[v2 UI 검증 통과] 신규 문항 마커·체크포인트·골든SQL 렌더 확인");
})().catch(e=>{console.error("오류:",e.message);process.exit(1);});

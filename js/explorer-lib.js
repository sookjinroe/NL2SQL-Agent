// ============================================================
// explorer-lib.js — 탐색 탭의 순수 로직 (UI 비의존, node 테스트 가능).
//  - buildIndexes: 컬럼→Term역할, 메트릭→Term, 표면형(이름+동의어)→Term 충돌 지도
//  - searchAll: Term/컬럼/테이블/메트릭/질문 통합 검색
// window.ExplorerLib / module.exports 겸용.
// ============================================================
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ExplorerLib = factory();
})(typeof self !== "undefined" ? self : this, function () {

  const norm = (s) => (s || "").toLowerCase().replace(/\s+/g, "");

  function buildIndexes(L) {
    const colTerms = {};   // "T.C" → [{term, role, value}]
    const termByName = {};
    const metricTerms = {}; // metricId → [termName]
    const surface = {};     // 표면형(이름·동의어) → Set(termName)
    for (const t of L.terms) {
      termByName[t.name] = t;
      for (const w of [t.name, ...(t.synonyms || [])]) {
        (surface[w] = surface[w] || new Set()).add(t.name);
      }
      for (const lk of t.links || []) {
        if (lk.kind === "metric") {
          (metricTerms[lk.asset] = metricTerms[lk.asset] || []).push(t.name);
          continue;
        }
        (colTerms[lk.asset] = colTerms[lk.asset] || []).push({ term: t.name, role: lk.role, value: lk.value });
      }
    }
    // 충돌: 같은 표면형이 서로 다른 Term 2개 이상에 닿음 — 이 코퍼스의 설계 핵심
    const collisions = Object.entries(surface)
      .filter(([w, s]) => s.size >= 2)
      .map(([w, s]) => ({ word: w, terms: [...s].sort((a, b) => a.localeCompare(b, "ko")) }))
      .sort((a, b) => b.terms.length - a.terms.length || a.word.localeCompare(b.word, "ko"));
    const surfaceCount = {};
    for (const [w, s] of Object.entries(surface)) surfaceCount[w] = s.size;
    // 패밀리 그룹 (사람용 감사 뷰 — 에이전트 연산에는 계속 비노출)
    const families = {};
    for (const t of L.terms) if (t.family) (families[t.family] = families[t.family] || []).push(t.name);
    // 코드사전 인덱스 — 등재(값↔라벨)와 미등재(결손) 구분
    // mock(_CD)·fineract(_enum·_cv_id) 양쪽 패턴 지원. registered는 실제 codedict 키 기준.
    const codedict = L.codedict || {};
    const CODE_NAME_RE = /(_CD|_enum|_cv_id)$/;
    const IDENT_RE = /(PRDT_CD|ZIP_CD)$/;
    const colById = {}; L.columns.forEach((c) => (colById[c.id] = c));
    const codeEntries = [];
    // 1) 실제 값 사전 있는 컬럼 (registered) - codedict 키 기준
    for (const cid of Object.keys(codedict)) {
      const c = colById[cid];
      if (!c) continue;
      const colName = cid.split(".")[1];
      codeEntries.push({
        id: cid, table: c.table, col: colName,
        domain: c.domain || (L.tables.find((t) => t.name === c.table) || {}).domain,
        dict: codedict[cid],
        status: "registered",
        desc: (c.description && c.description.text || "").split(" 값:")[0],
      });
    }
    // 2) 코드성 이름이지만 사전 없는 컬럼 (missing/identifier)
    for (const c of L.columns) {
      if (codedict[c.id]) continue; // 이미 registered
      const colName = c.id.split(".")[1];
      if (!CODE_NAME_RE.test(colName)) continue;
      codeEntries.push({
        id: c.id, table: c.table, col: colName,
        domain: c.domain || (L.tables.find((t) => t.name === c.table) || {}).domain,
        dict: null,
        status: IDENT_RE.test(colName) ? "identifier" : "missing",
        desc: (c.description && c.description.text || "").split(" 값:")[0],
      });
    }
    return { colTerms, termByName, metricTerms, collisions, surfaceCount, families, codeEntries };
  }

  // 통합 검색 — kind: term | column | table | metric | question
  function searchAll(L, questions, q, cap) {
    cap = cap || 12;
    const nq = norm(q);
    if (!nq) return [];
    const out = [];
    const push = (kind, id, label, sub, rank) => out.push({ kind, id, label, sub, rank });
    for (const t of L.terms) {
      const keys = [t.name, ...(t.synonyms || [])];
      const hit = keys.find((k) => norm(k).includes(nq) || nq.includes(norm(k)));
      if (hit) push("term", t.name, t.name, t.definition, norm(t.name) === nq ? 0 : 1);
    }
    for (const c of L.columns) {
      const head = (c.description && c.description.text || "").split(" 값:")[0];
      if (norm(c.id).includes(nq)) push("column", c.id, c.id, head, 1);
      else if (norm(head).includes(nq)) push("column", c.id, c.id, head, 2);
    }
    for (const t of L.tables) {
      if (norm(t.name).includes(nq) || norm(t.grain).includes(nq))
        push("table", t.name, t.name, t.grain, norm(t.name) === nq ? 0 : 1);
    }
    for (const m of L.metrics) {
      if (norm(m.name).includes(nq) || norm(m.id).includes(nq))
        push("metric", m.id, m.name, m.id, 1);
    }
    for (const qq of questions || []) {
      if (norm(qq.text).includes(nq)) push("question", qq.id, `${qq.id} ${qq.text}`, qq.cat, 2);
    }
    out.sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label, "ko"));
    return out.slice(0, cap);
  }

  // 딥링크: '#x=view/선택' ↔ 상태 (키 부트스트랩 '#k='와 패턴 분리)
  function parseHash(h) {
    const m = (h || "").match(/^#x=([a-z]+)(?:\/(.+))?$/);
    if (!m) return null;
    return { v: m[1], sel: m[2] ? decodeURIComponent(m[2]) : null };
  }
  function toHash(v, sel) {
    return "#x=" + v + (sel ? "/" + encodeURIComponent(sel) : "");
  }

  return { buildIndexes, searchAll, parseHash, toHash, norm };
});

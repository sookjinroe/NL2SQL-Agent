// ============================================================
// layer-ops.js — 시맨틱 레이어 읽기 인터페이스 8연산 (스펙 5장).
// 순수 결정적 JS. 브라우저(window.LayerOps)·node(module.exports) 겸용.
// 중립 정책(D3): 후보 목록만 반환, 점수 비노출. 내부 랭킹으로 top-k 선별 후
//   이름순 정렬해 순위 신호를 제거한다.
// 설계 메타데이터 비노출: Term의 family(충돌 패밀리 소속)는 절대 반환하지 않는다
//   — 에이전트에게 "이건 함정"이라는 힌트가 되기 때문.
// 검색은 의도적으로 단순(토큰+bigram) — 검색 품질은 도구 책임(D1).
//   tool-miss 판별을 위해 마지막 호출의 내부 히트 여부를 trace에 남긴다.
// ============================================================
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.LayerOps = factory();
})(typeof self !== "undefined" ? self : this, function () {

  let L = null; // {terms, columns, tables, metrics, codedict, meta}

  function init(layer) {
    L = layer;
    L._colById = {}; layer.columns.forEach((c) => (L._colById[c.id] = c));
    L._tblByName = {}; layer.tables.forEach((t) => (L._tblByName[t.name] = t));
    L._metById = {}; layer.metrics.forEach((m) => { L._metById[m.id] = m; L._metById[m.name] = m; });
    L._termByName = {}; layer.terms.forEach((t) => (L._termByName[t.name] = t));
    // FK 무향 그래프 (join path BFS용)
    L._adj = {};
    const add = (a, b, edge) => { (L._adj[a] = L._adj[a] || []).push({ to: b, edge }); };
    layer.tables.forEach((t) => t.fk_edges.forEach((e) => {
      const ta = e.from.split(".")[0], tb = e.to.split(".")[0];
      add(ta, tb, e); add(tb, ta, e);
    }));
  }

  // ---- 텍스트 유틸 ----
  const norm = (s) => (s || "").toLowerCase().replace(/[^가-힣a-z0-9]/g, "");
  function grams(s) { s = norm(s); const g = new Set(); for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2)); if (s.length === 1) g.add(s); return g; }
  function sim(a, bGrams) { const ag = grams(a); let n = 0; for (const x of ag) if (bGrams.has(x)) n++; return ag.size ? n / Math.sqrt(ag.size) : 0; }

  // ① resolve_terms — 질문 구절 → Term 후보 (동의어 포함). 점수 비노출.
  function resolve_terms({ query }) {
    const qg = grams(query);
    const scored = L.terms.map((t) => {
      const keys = [t.name, ...(t.synonyms || [])];
      let best = 0;
      for (const k of keys) {
        const kg = grams(k); let n = 0;
        for (const x of kg) if (qg.has(x)) n++;
        // 양방향: 질문이 Term명을 포함하거나, Term명이 질문 토큰과 겹치거나
        const score = kg.size ? n / kg.size : 0;
        const incl = norm(query).includes(norm(k)) || norm(k).includes(norm(query)) ? 0.6 : 0;
        best = Math.max(best, score + incl);
      }
      return { t, best };
    }).filter((x) => x.best > 0.34);
    scored.sort((a, b) => b.best - a.best);
    const top = scored.slice(0, 6).map((x) => x.t);
    top.sort((a, b) => a.name.localeCompare(b.name, "ko")); // 순위 신호 제거
    return {
      candidates: top.map((t) => ({ name: t.name, domain: t.domain, definition: t.definition,
                                    synonyms: t.synonyms })),
      _hit: top.length > 0, // tool-miss 판별용 (trace 전용, 모델에는 candidates만 전달)
    };
  }

  // ② get_term — Term 상세 (links + 역할 + valid_values). family는 비노출.
  function get_term({ term }) {
    const t = L._termByName[term] ||
      L.terms.find((x) => (x.synonyms || []).includes(term));
    if (!t) return { error: `Term '${term}' 없음` };
    const out = { name: t.name, domain: t.domain, definition: t.definition, synonyms: t.synonyms };
    if (t.valid_values !== undefined) out.valid_values = t.valid_values;
    if (t.links !== undefined) out.links = t.links;         // mock 레이어 (role 체계)
    if (t.assets !== undefined) out.assets = t.assets;      // fineract 레이어 (미니멀 구조)
    return out;
  }

  // ③ resolve_code — (컬럼, 표현) → 코드 리터럴. 사전 부재 시 명시적 부재 응답.
  function resolve_code({ column, query }) {
    const dict = L.codedict[column];
    if (!dict) return { error: `${column}의 코드값 사전이 레이어에 없음`, dict_available: false };
    const q = norm(query);
    const hits = Object.entries(dict)
      .filter(([code, label]) => norm(label).includes(q) || q.includes(norm(label)) || norm(code) === q)
      .map(([code, meaning]) => ({ code, meaning }));
    return { dict_available: true, matches: hits, all_values: dict };
  }

  // ④ get_column
  function get_column({ id }) {
    const c = L._colById[id];
    if (!c) return { error: `컬럼 '${id}' 없음` };
    const out = { id: c.id, table: c.table, type: c.type, nullable: c.nullable, pk: c.pk, fk: c.fk,
                  description: c.description };
    if (c.classification !== undefined) out.classification = c.classification;
    // Render v3 산출 필드 (fineract 레이어)
    if (c.capability !== undefined) out.capability = c.capability;
    if (c.format !== undefined) out.format = c.format;
    if (c.aggregation !== undefined) out.aggregation = c.aggregation;
    if (c.codedict_available !== undefined) out.codedict_available = c.codedict_available;
    return out;
  }

  // ⑤ get_table
  function get_table({ name }) {
    const t = L._tblByName[name];
    if (!t) return { error: `테이블 '${name}' 없음` };
    return { name: t.name, domain: t.domain, grain: t.grain, columns: t.columns, fk_edges: t.fk_edges };
  }

  // ⑥ get_join_path — BFS, 최대 3경로(다홉 포함). 복수 경로 모두 반환, 선택은 에이전트.
  function get_join_path({ table_a, table_b }) {
    if (!L._tblByName[table_a] || !L._tblByName[table_b])
      return { error: "테이블 없음" };
    if (table_a === table_b) return { paths: [[]] };
    const paths = [], seenPath = new Set();
    const queue = [[table_a, []]];
    const visitedDepth = { [table_a]: 0 };
    while (queue.length && paths.length < 3) {
      const [cur, edges] = queue.shift();
      if (edges.length > 3) continue; // 4홉 초과 컷
      for (const nx of L._adj[cur] || []) {
        if (edges.some((e) => e === nx.edge)) continue;
        const nEdges = [...edges, nx.edge];
        if (nx.to === table_b) {
          const key = nEdges.map((e) => e.from + ">" + e.to).join("|");
          if (!seenPath.has(key)) { seenPath.add(key); paths.push(nEdges.map((e) => ({ from: e.from, to: e.to }))); }
          continue;
        }
        if (visitedDepth[nx.to] !== undefined && visitedDepth[nx.to] < nEdges.length) continue;
        visitedDepth[nx.to] = nEdges.length;
        queue.push([nx.to, nEdges]);
      }
    }
    return paths.length ? { paths } : { error: "경로 없음" };
  }

  // ⑦ get_metric — 정본 정의식 + 기준 필터
  function get_metric({ metric }) {
    const m = L._metById[metric];
    if (!m) return { error: `메트릭 '${metric}' 없음` };
    return { id: m.id, name: m.name, grain: m.grain, expr: m.expr,
             base_filters: m.base_filters, note: m.note };
  }

  // ⑧ search_columns — Description 유사도 폴백. 점수 비노출.
  function search_columns({ query }) {
    const qg = grams(query);
    const scored = L.columns.map((c) => ({
      c, s: sim(c.description.text + " " + c.id.replace(/[._]/g, " "), qg),
    })).filter((x) => x.s > 0.05);
    scored.sort((a, b) => b.s - a.s);
    const top = scored.slice(0, 8).map((x) => x.c);
    return {
      note: "Description 유사도 검색 — 접근은 주되 확정은 못 준다. 이 결과만으로 매칭 시 신뢰도를 낮출 것.",
      candidates: top.map((c) => ({ id: c.id, table: c.table, type: c.type,
                                    description: c.description.text })),
      _hit: top.length > 0,
    };
  }

  const OPS = { resolve_terms, get_term, resolve_code, get_column, get_table,
                get_join_path, get_metric, search_columns };

  // 모델 전달용: trace 전용 필드(_*) 제거
  function call(op, args) {
    if (!OPS[op]) return { error: `연산 '${op}' 없음. 가용: ${Object.keys(OPS).join(", ")}` };
    const raw = OPS[op](args || {});
    const pub = {}; for (const k in raw) if (!k.startsWith("_")) pub[k] = raw[k];
    return { public: pub, raw };
  }

  return { init, call, OPS: Object.keys(OPS) };
});

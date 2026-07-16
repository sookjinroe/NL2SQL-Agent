// ============================================================
// layer-ops-v2-nosem.js — 대조군 연산 계층 (시맨틱 레이어 제거판).
//
// 목적: 시맨틱 레이어의 효과를 검증하기 위한 대조군. 원본 layer-ops-v2의
// try_sql 실측 경로는 그대로 쓰되(레이어 무관), 나머지 5개 연산은 응답에서
// 레이어 저작물(description·capability·format·aggregation·codedict·용어·지표)을
// 제거하고 스키마 사실만 남긴다.
//
// 원본 layer-ops-v2와 동일 프로세스에 공존 — 서로의 상태를 건드리지 않는다.
// 원본은 무접촉, 이 파일은 delegate.
// ============================================================
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.LayerOpsV2Nosem = factory();
})(typeof self !== "undefined" ? self : this, function () {

  let L = null;
  let execSql = null;

  function init(layer, exec) { L = layer; execSql = exec || null; }
  function setExec(exec) { execSql = exec; }

  function norm(s) { return String(s || "").toLowerCase().replace(/\s+/g, ""); }

  // ── 스키마 지도 (원본 buildMap 대체) ──
  // 남기는 것: 테이블·컬럼 이름, PK 표시, FK 관계.
  // 빼는 것: grain, domain, description, term/metric 지도.
  // (grain은 레이어 저작이므로 no-sem에서 제외 — 스키마의 이름·PK로부터 유추해야 함)
  function buildMap() {
    const cols_by_table = {};
    for (const c of (L && L.columns) || []) {
      (cols_by_table[c.table] = cols_by_table[c.table] || []).push(c);
    }
    const tables = (L && L.tables) || [];
    // 컬럼 0개인 layer.tables 항목은 layer 관심 밖 — 표시 안 함
    const shown = tables.filter((t) => (cols_by_table[t.name] || []).length > 0);
    const parts = [];
    parts.push(`[스키마 지도 — 테이블 ${shown.length} · 컬럼 ${(L && L.columns || []).length}. 컬럼 상세(타입·nullable)는 get_column, 조인 경로는 get_join_path]`);
    parts.push(``);
    for (const t of shown) {
      const cs = cols_by_table[t.name] || [];
      const tokens = cs.map((c) => {
        const name = c.id.split(".").slice(1).join(".");
        let marks = "";
        if (c.pk) marks += "⁺";  // PK
        if (c.fk) marks += "→" + c.fk;
        return name + marks;
      });
      parts.push(`${t.name} (${cs.length}): ${tokens.join(" · ")}`);
    }
    return parts.join("\n");
  }

  // ── 연산 필터 ──

  // browse_terms: 비활성 (용어 사전 없음)
  function browse_terms_disabled() {
    return { public: { error: "이 세팅에는 용어 사전이 없다 — browse_terms는 사용할 수 없다. search로 컬럼·테이블 이름을 매칭하거나 get_column으로 직접 접근하라." },
             raw: { _hit: false } };
  }

  // resolve_code: 비활성 (코드 사전 없음)
  function resolve_code_disabled({ column }) {
    return { public: { dict_available: false, matches: [],
                       note: `이 세팅에는 코드 사전이 없다 — '${column || ""}'의 코드값 매핑은 try_sql로 실제 값 분포(GROUP BY + COUNT)를 조회해 확인하라. 값 자체는 데이터에 존재하므로 실측으로 알 수 있다.` },
             raw: { _hit: false } };
  }

  // search 결과 필터: term/metric kind 제거, column·table만 유지, description 제거
  async function search_filtered(args) {
    const r = await window.LayerOpsV2.call("search", args || {});
    const pub = r.public || {};
    const results = (pub.results || []).filter((x) => x.kind === "column" || x.kind === "table");
    // column/table에서 저작물 필드 제거
    const clean = results.map((x) => {
      if (x.kind === "column") {
        return { kind: "column", id: x.id, table: x.table };  // description·table_grain 제거
      }
      if (x.kind === "table") {
        return { kind: "table", name: x.name, columns_preview: x.columns_preview };  // grain 제거
      }
      return x;
    });
    const out = clean.length
      ? { match: pub.match || "fuzzy", results: clean }
      : { match: "none", results: [], note: "일치 없음. 지도를 다시 보거나 get_column으로 직접 접근하라." };
    return { public: out, raw: { _hit: clean.length > 0 } };
  }

  // get_column: 저작물 필드 제거. id/table/type/nullable/pk/fk만.
  async function get_column_filtered(args) {
    const r = await window.LayerOpsV2.call("get_column", args || {});
    const pub = r.public || {};
    if (pub.error) return { public: pub, raw: r.raw };
    const clean = {
      id: pub.id, table: pub.table, type: pub.type,
      nullable: pub.nullable, pk: pub.pk, fk: pub.fk
    };
    return { public: clean, raw: r.raw };
  }

  // get_join_path: 그대로 (FK는 스키마 사실)
  async function get_join_path_delegate(args) {
    return window.LayerOpsV2.call("get_join_path", args || {});
  }

  // try_sql: 그대로 (실측, 레이어 무관)
  async function try_sql_delegate(args) {
    return window.LayerOpsV2.call("try_sql", args || {});
  }

  async function call(op, args) {
    if (op === "search_terms") op = "search";
    switch (op) {
      case "browse_terms": return browse_terms_disabled();
      case "resolve_code": return resolve_code_disabled(args || {});
      case "search":       return search_filtered(args || {});
      case "get_column":   return get_column_filtered(args || {});
      case "get_join_path":return get_join_path_delegate(args || {});
      case "try_sql":      return try_sql_delegate(args || {});
      default:
        return { public: { error: `연산 '${op}' 없음. 가용: browse_terms(비활성), search, get_column, resolve_code(비활성), get_join_path, try_sql` },
                 raw: { _hit: false } };
    }
  }

  return { init, setExec, call, buildMap,
           OPS: ["browse_terms", "search", "get_column", "resolve_code", "get_join_path", "try_sql"] };
});

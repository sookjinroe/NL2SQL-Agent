// ============================================================
// layer-ops-v2.js — NL 에이전트 v2 연산 계층.
//
// v1과의 구조적 차이:
//   v1: resolve_terms(검색)가 유일한 진입점 → 전체 구조 비가시.
//   v2: 카탈로그 지도가 시스템 프롬프트에 상주 → 연산은 "파고들기"만 담당.
//
// 연산 6개:
//   browse_terms  — 도메인 열람 (Term 한 줄씩: 정의·유의어·assets)
//   search_terms  — 표적 검색 (Term+metric 통합, exact 우선 → 유사도)
//   get_column    — 컬럼 상세 (Render 산출 전체)
//   resolve_code  — 코드 리터럴
//   get_join_path — FK 경로
//   try_sql       — ★실측. SELECT만, LIMIT 강제, {ok,row_count,cols,rows≤3,error}
//
// try_sql 노출 수위: 파일럿(합성 데이터)은 행 값 그대로.
//   실전 전환 지점: PII 있는 실 데이터에선 rows를 집계형(COUNT/SUM/AVG 결과만)으로
//   제한하거나 마스킹 계층을 삽입할 것. (설계 결정 2026-07-09)
// ============================================================
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.LayerOpsV2 = factory();
})(typeof self !== "undefined" ? self : this, function () {

  let L = null;
  let execSql = null; // (sql) => {columns, values} 배열 — sql.js exec 래퍼 주입

  function init(layer, exec) { L = layer; execSql = exec || null; buildIndex(); }
  function setExec(exec) { execSql = exec; }

  let termByName = {}, metById = {};
  function buildIndex() {
    termByName = {}; metById = {};
    for (const t of L.terms || []) {
      termByName[norm(t.name)] = t;
      for (const s of t.synonyms || []) if (!termByName[norm(s)]) termByName[norm(s)] = t;
    }
    for (const m of L.metrics || []) { metById[m.id] = m; metById[norm(m.name)] = m; }
  }

  function norm(s) { return String(s || "").toLowerCase().replace(/\s+/g, ""); }
  function grams(s) {
    const n = norm(s); const g = new Set();
    for (let i = 0; i < n.length - 1; i++) g.add(n.slice(i, i + 2));
    return g;
  }

  // ── 카탈로그 지도 생성 (agent-core-v2가 시스템 프롬프트에 삽입) ──
  // 규모 적응: 도메인당 Term 이름 MAX_NAMES개 초과 시 truncate + browse 안내.
  // 분기 코드 없이 같은 규칙이 파일럿(전체 노출)과 대규모(요약)를 모두 처리.
  const MAX_NAMES_PER_DOMAIN = 40;
  function buildMap() {
    const parts = [];
    // 도메인 지도
    const byDom = {};
    for (const t of L.terms || []) (byDom[t.domain] = byDom[t.domain] || []).push(t.name);
    parts.push(`[용어 지도 — 총 ${(L.terms || []).length} Term]`);
    for (const d of Object.keys(byDom).sort()) {
      const names = byDom[d];
      const shown = names.slice(0, MAX_NAMES_PER_DOMAIN);
      let line = `${d}(${names.length}): ${shown.join("·")}`;
      if (names.length > MAX_NAMES_PER_DOMAIN) line += ` …외 ${names.length - shown.length}개 (browse_terms로 열람)`;
      parts.push(line);
    }
    // 정본 지표 — 규모가 커져도 수십 개 상한이므로 항상 전체 상주
    parts.push(``, `[정본 지표 — ${(L.metrics || []).length}개. 비율·총액·평균 질문은 여기 있으면 반드시 이 정의를 따를 것]`);
    for (const m of L.metrics || []) parts.push(`${m.id} = ${m.name} | grain: ${m.grain} | 정의식: ${m.expr} | 기준: ${(m.base_filters || []).join("; ")}${m.note ? " | " + m.note : ""}`);
    // 테이블 grain
    const tbls = (L.tables || []).filter((t) => t.grain);
    parts.push(``, `[테이블 grain — ${tbls.length}개. 조인·집계 전 grain을 확인해 팬아웃을 방지할 것]`);
    parts.push(tbls.map((t) => `${t.name}=${t.grain}`).join(" · "));
    // codedict 힌트
    const cdCount = Object.keys(L.codedict || {}).length;
    parts.push(``, `[코드사전] ${cdCount}개 컬럼에 값↔라벨 사전 보유. 코드성 컬럼(_enum·_cv_id·status류) 필터 전 resolve_code로 리터럴 확인.`);
    return parts.join("\n");
  }

  // ── 연산 ──

  function termLine(t) {
    return { name: t.name, domain: t.domain, definition: t.definition,
             synonyms: t.synonyms, assets: t.assets };
  }

  function browse_terms({ domain, page }) {
    const p = Math.max(1, page || 1), PAGE = 20;
    const all = (L.terms || []).filter((t) => !domain || t.domain === domain);
    if (!all.length) return { error: `도메인 '${domain}'에 Term 없음. 지도의 도메인 이름을 확인하라.`, _hit: false };
    const slice = all.slice((p - 1) * PAGE, p * PAGE);
    return { domain: domain || "(전체)", page: p, total: all.length,
             terms: slice.map(termLine), _hit: true };
  }

  function search_terms({ query }) {
    const nq = norm(query);
    // 1) exact: 이름·유의어 완전 일치 (Term + metric)
    const exact = [];
    if (termByName[nq]) exact.push({ kind: "term", ...termLine(termByName[nq]) });
    if (metById[nq]) { const m = metById[nq]; exact.push({ kind: "metric", id: m.id, name: m.name, grain: m.grain, expr: m.expr, base_filters: m.base_filters, note: m.note }); }
    if (exact.length) return { match: "exact", results: exact, _hit: true };
    // 2) 유사도: bigram (Term + metric 통합)
    const qg = grams(query);
    const scored = [];
    for (const t of L.terms || []) {
      let best = 0;
      for (const k of [t.name, ...(t.synonyms || [])]) {
        const kg = grams(k); let n = 0;
        for (const x of kg) if (qg.has(x)) n++;
        const score = kg.size ? n / kg.size : 0;
        const incl = nq.includes(norm(k)) || norm(k).includes(nq) ? 0.6 : 0;
        best = Math.max(best, score + incl);
      }
      if (best > 0.3) scored.push({ s: best, r: { kind: "term", ...termLine(t) } });
    }
    for (const m of L.metrics || []) {
      const kg = grams(m.name); let n = 0;
      for (const x of kg) if (qg.has(x)) n++;
      const score = kg.size ? n / kg.size : 0;
      const incl = nq.includes(norm(m.name)) || norm(m.name).includes(nq) ? 0.6 : 0;
      const best = score + incl;
      if (best > 0.3) scored.push({ s: best, r: { kind: "metric", id: m.id, name: m.name, grain: m.grain, expr: m.expr, base_filters: m.base_filters, note: m.note } });
    }
    scored.sort((a, b) => b.s - a.s);
    const top = scored.slice(0, 6).map((x) => x.r);
    return top.length
      ? { match: "fuzzy", results: top, _hit: true }
      : { match: "none", results: [], note: "일치 없음. 지도를 다시 보거나 get_column으로 직접 접근하라.", _hit: false };
  }

  function get_column({ id }) {
    const c = (L.columns || []).find((x) => x.id === id);
    if (!c) return { error: `컬럼 '${id}' 없음. 형식: "테이블.컬럼"`, _hit: false };
    const out = { id: c.id, table: c.table, type: c.type, nullable: c.nullable, pk: c.pk, fk: c.fk,
                  description: c.description };
    if (c.capability !== undefined) out.capability = c.capability;
    if (c.format !== undefined) out.format = c.format;
    if (c.aggregation !== undefined) out.aggregation = c.aggregation;
    if (c.codedict_available !== undefined) out.codedict_available = c.codedict_available;
    if (c.classification !== undefined) out.classification = c.classification;
    out._hit = true;
    return out;
  }

  function resolve_code({ column, query }) {
    const dict = (L.codedict || {})[column];
    if (!dict) return { dict_available: false, matches: [],
                        note: `'${column}'의 코드 사전이 레이어에 없음 — 코드값을 추측하지 말 것.`, _hit: false };
    const nq = norm(query || "");
    const entries = Object.entries(dict).map(([code, label]) => ({ code, label }));
    if (!nq) return { dict_available: true, matches: entries.slice(0, 20), total: entries.length, _hit: true };
    const matches = entries.filter((e) => norm(e.label).includes(nq) || norm(e.code) === nq || nq.includes(norm(e.label)));
    return { dict_available: true, matches: matches.length ? matches : entries.slice(0, 20),
             note: matches.length ? undefined : "질의어와 일치하는 라벨 없음 — 전체 사전 반환", _hit: matches.length > 0 };
  }

  function get_join_path({ table_a, table_b }) {
    // FK 그래프 BFS (기존 v1과 동일 알고리즘)
    const adj = {};
    for (const t of L.tables || []) {
      for (const e of t.fk_edges || []) {
        const [ft, fc] = e.from.split("."); const [tt] = e.to.split(".");
        (adj[ft] = adj[ft] || []).push({ to: tt, via: e });
        (adj[tt] = adj[tt] || []).push({ to: ft, via: e });
      }
    }
    if (!adj[table_a] && !(L.tables || []).some((t) => t.name === table_a))
      return { error: `테이블 '${table_a}' 없음`, _hit: false };
    const queue = [[table_a, []]]; const seen = new Set([table_a]); const paths = [];
    while (queue.length && paths.length < 3) {
      const [cur, path] = queue.shift();
      if (cur === table_b && path.length) { paths.push(path.map((e) => `${e.from} = ${e.to}`)); continue; }
      if (path.length >= 4) continue;
      for (const nx of adj[cur] || []) {
        if (seen.has(nx.to) && nx.to !== table_b) continue;
        seen.add(nx.to);
        queue.push([nx.to, [...path, nx.via]]);
      }
    }
    return paths.length ? { paths, _hit: true }
                        : { paths: [], note: "FK 경로 없음 — 두 테이블이 그래프상 연결되지 않음", _hit: false };
  }

  const TRY_SQL_MAX_ROWS = 3;
  function try_sql({ sql }) {
    if (!execSql) return { ok: false, error: "실행기 미주입 (앱 초기화 문제)", _hit: false };
    const s = String(sql || "").trim();
    if (!/^select\b/i.test(s)) return { ok: false, error: "SELECT만 허용", _hit: false };
    if (/;\s*\S/.test(s)) return { ok: false, error: "단일 문장만 허용", _hit: false };
    // 카티전 곱 방어: JOIN에 ON/USING 없으면 거부 (sql.js 동기 실행이 메인 스레드를 얼릴 수 있음)
    const joins = (s.match(/\bjoin\b/gi) || []).length;
    const ons = (s.match(/\b(on|using)\b/gi) || []).length;
    if (joins > 0 && ons < joins) return { ok: false, error: "JOIN에 ON 조건이 없다 — 카티전 곱은 브라우저를 정지시킨다. 모든 JOIN에 ON을 명시하라.", _hit: false };
    try {
      // LIMIT 강제: 외곽 래핑으로 원 쿼리 의미 보존하며 행 수만 제한
      const wrapped = `SELECT * FROM (${s.replace(/;\s*$/, "")}) __t LIMIT 51`;
      const res = execSql(wrapped);
      if (!res || !res.length) return { ok: true, row_count: 0, cols: [], rows: [],
        note: "0행 — 결과가 없다고 단정하기 전에 진단하라: 필터 조건·코드값·데이터 채움 상태 중 무엇이 원인인지 (여러 가설을 한 쿼리로: 상태별 × NULL여부 × 값존재 동시 집계).", _hit: true };
      const { columns, values } = res[0];
      const rowCount = values.length > 50 ? "50+" : values.length;
      const rows = values.slice(0, TRY_SQL_MAX_ROWS).map((v) => {
        const o = {}; columns.forEach((c, i) => (o[c] = v[i])); return o;
      });
      return { ok: true, row_count: rowCount, cols: columns, rows, _hit: true };
    } catch (e) {
      return { ok: false, error: String(e.message || e), _hit: true };
    }
  }

  const OPS = { browse_terms, search_terms, get_column, resolve_code, get_join_path, try_sql };

  function call(op, args) {
    if (!OPS[op]) return { public: { error: `연산 '${op}' 없음. 가용: ${Object.keys(OPS).join(", ")}` }, raw: { _hit: false } };
    const raw = OPS[op](args || {});
    const pub = {}; for (const k in raw) if (!k.startsWith("_")) pub[k] = raw[k];
    return { public: pub, raw };
  }

  return { init, setExec, call, buildMap, OPS: Object.keys(OPS) };
});

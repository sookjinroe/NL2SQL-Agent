// compute-core.js — 분석 에이전트의 compute 연산 실행 코어.
// 워커(db-worker.js)가 importScripts로 쓰고, 노드 헤드리스 검증도 같은 코드를 씀
// (워커 전용 문법을 피해 UMD로 분리 — 검증-실전 불일치 방지).
//
// 설계 근거 (2026-07-14, 자율 분석 실험 4케이스):
// 분석가의 실제 도구는 profile·rate_compare 같은 좁은 도구가 아니라
// "쿼리 배치 + 계산 + 검산"을 한 번에 하는 범용 스크립트였음.
// 모델이 log()로 남긴 것만 결과로 반환 — 출력 부피를 모델이 통제.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ComputeCore = factory();
})(typeof self !== "undefined" ? self : this, function () {

  var LOG_CAP = 4000;      // log 총량 상한 (모델에 되돌아가는 부피)
  var ROW_CAP = 20000;     // 쿼리당 행 상한 (폭주 방지)

  // 하위 grain 테이블을 조인한 채 SUM/AVG → 팬아웃 위험 정적 감지.
  // __31_ F02 실증: 회차 테이블 조인 상태의 SUM(원금)이 7970% 비율을 만들었고
  // 에이전트는 데이터를 탓함. 차단이 아니라 경고 note (오탐 허용).
  function fanoutCheck(sqlText, childTables) {
    var s = String(sqlText);
    if (!/\b(SUM|AVG)\s*\(/i.test(s)) return null;
    for (var i = 0; i < (childTables || []).length; i++) {
      var t = childTables[i];
      var re = new RegExp("\\bJOIN\\s+\"?" + t + "\\b", "i");
      if (re.test(s)) {
        return "주의: 하위 grain 테이블(" + t + ")을 조인한 채 SUM/AVG — 행이 불어난 상태의 합계는 팬아웃 위험. " +
               "합계·평균은 조인 밖(서브쿼리)에서 구하거나 EXISTS로 판정만 하라.";
      }
    }
    return null;
  }

  // 큰 수치의 한글 단위 환산 힌트 — __32_ A02 실증: 에이전트가 609.1억(6.09e10)을
  // "60.9조"로 서술 (×1000 오환산). 환산을 모델에게 맡기지 않고 시스템이 계산해 동봉.
  function unitHints(rows) {
    if (!rows || !rows.length) return null;
    var hints = [];
    var seen = {};
    for (var i = 0; i < Math.min(rows.length, 8); i++) {
      for (var k in rows[i]) {
        var v = rows[i][k];
        if (typeof v === "number" && Math.abs(v) >= 1e8 && !seen[k]) {
          seen[k] = true;
          var eok = v / 1e8;
          var disp = Math.abs(eok) >= 10000 ? (eok / 10000).toFixed(1) + "조" : eok.toFixed(1) + "억";
          hints.push(k + "=" + v + " ≈ " + disp);
          if (hints.length >= 4) break;
        }
      }
      if (hints.length >= 4) break;
    }
    return hints.length ? "단위 환산(시스템 계산 — 서술에 이 값을 그대로 써라): " + hints.join(" · ") : null;
  }

  // execSync: (sql) => sql.js exec 결과 [{columns, values}] (동기)
  function runCompute(execSync, code, opts) {
    opts = opts || {};
    var logs = [];
    var notes = [];
    var logSize = 0;

    function log() {
      var parts = [];
      for (var i = 0; i < arguments.length; i++) {
        var a = arguments[i];
        parts.push(typeof a === "string" ? a : JSON.stringify(a));
      }
      var line = parts.join(" ");
      if (logSize >= LOG_CAP) return;
      if (logSize + line.length > LOG_CAP) line = line.slice(0, LOG_CAP - logSize) + "…(log 상한)";
      logs.push(line);
      logSize += line.length;
    }

    function sql(q) {
      var s = String(q).trim();
      if (!/^(SELECT|WITH)\b/i.test(s)) throw new Error("SELECT/WITH만 허용: " + s.slice(0, 60));
      var fn = fanoutCheck(s, opts.childTables);
      if (fn && notes.indexOf(fn) < 0) notes.push(fn);
      // (환산 힌트는 rows 변환 후 아래에서)
      var res = execSync(s);
      if (!res || !res.length) return [];
      var cols = res[0].columns, vals = res[0].values;
      if (vals.length > ROW_CAP) throw new Error("행 상한 초과 (" + vals.length + " > " + ROW_CAP + ") — 집계하거나 LIMIT을 걸어라");
      var rows = [];
      for (var r = 0; r < vals.length; r++) {
        var o = {};
        for (var c = 0; c < cols.length; c++) o[cols[c]] = vals[r][c];
        rows.push(o);
      }
      var uh = unitHints(rows);
      if (uh && notes.indexOf(uh) < 0) notes.push(uh);
      return rows;
    }

    try {
      var fn2 = new Function("sql", "log", "\"use strict\";\n" + code);
      var ret = fn2(sql, log);
      if (ret !== undefined && logSize < LOG_CAP) log("return:", ret);
      return { ok: true, logs: logs.join("\n"), notes: notes };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e), logs: logs.join("\n"), notes: notes };
    }
  }

  return { runCompute: runCompute, fanoutCheck: fanoutCheck, unitHints: unitHints };
});

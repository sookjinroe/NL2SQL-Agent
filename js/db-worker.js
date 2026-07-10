// ============================================================
// db-worker.js — sql.js를 워커 스레드에서 실행.
// 목적: try_sql의 동기 exec가 메인(UI) 스레드를 점유해 동시 실행 시
// 페이지가 정지하던 문제 해소. 무거운 쿼리는 이 스레드만 점유한다.
// 프로토콜: {id, type:"init", buf} → {id, ok}
//           {id, type:"exec", sql} → {id, ok, result|error}
// ============================================================
importScripts("../data/sql-wasm.js");
let db = null;
let sqlReady = null;

self.onmessage = async (ev) => {
  const { id, type, buf, sql } = ev.data;
  try {
    if (type === "init") {
      if (!sqlReady) sqlReady = initSqlJs({ locateFile: (f) => "../data/" + f });
      const SQL = await sqlReady;
      db = new SQL.Database(new Uint8Array(buf));
      self.postMessage({ id, ok: true });
    } else if (type === "exec") {
      if (!db) throw new Error("worker db 미초기화");
      const result = db.exec(sql);
      self.postMessage({ id, ok: true, result });
    }
  } catch (e) {
    self.postMessage({ id, ok: false, error: e.message || String(e) });
  }
};

// ============================================================
// dataset.js — 데이터셋 정의 (fineract 단일).
// mock 데이터셋은 v1과 함께 폐기됨 (2026-07-09) — world.db 24MB가
// 매 커밋 Pages 빌드를 5~15분으로 만들던 주범.
// 인터페이스(get/layer/dbPath/questions)는 유지 — 새 데이터셋 추가 시 확장 지점.
// ============================================================
window.Dataset = (function () {
  const DATASETS = [
    { id: "fineract", label: "Fineract" },
  ];
  function get() { return "fineract"; }
  function set(id) { /* 단일 데이터셋 - no-op */ }
  function layer() { return window.LAYER_FINERACT; }
  function dbPath() { return "data/world-fineract.db"; }
  function questions() {
    // 재료 표적 골든 54문항 (Claude 저작 · 재료를 아는 관점).
    // 실제 사용자 골든과 성격 다름 — 재료 완결성 확인 + 프롬프트 튜닝 근거.
    return window.QUESTIONS_FINERACT || [];
  }
  function snapshot() { return null; }
  function isFree() { return true; }  // 자유 질의 병존 유지
  return { DATASETS, get, set, layer, dbPath, questions, snapshot, isFree };
})();

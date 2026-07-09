// ============================================================
// dataset.js — 데이터셋 스위처 (mock | fineract).
// mock: 기존 은행 픽스처 (골든 44문항, 동결 스냅샷).
// fineract: Apache Fineract 실코드 코퍼스 (Render v3 산출 레이어, 골든 없음 — 자유 질의 탐색).
// ============================================================
window.Dataset = (function () {
  const DATASETS = [
    { id: "mock", label: "Mock 은행 (골든 44)" },
    { id: "fineract", label: "Fineract (탐색·자유질의)" },
  ];
  function get() {
    const s = (typeof localStorage !== "undefined") && localStorage.getItem("nl_dataset");
    return DATASETS.some((d) => d.id === s) ? s : "mock";
  }
  function set(id) {
    if (typeof localStorage !== "undefined") localStorage.setItem("nl_dataset", id);
  }
  function layer() {
    return get() === "fineract" ? window.LAYER_FINERACT : window.LAYER;
  }
  function dbPath() {
    return get() === "fineract" ? "data/world-fineract.db" : "data/world.db";
  }
  function questions() {
    // fineract는 재료 표적 골든 48문항 (Claude 저작 · 재료를 아는 관점).
    // 실제 사용자 골든과 성격 다름 — 재료 완결성 확인 + 프롬프트 튜닝 근거.
    return get() === "fineract" ? (window.QUESTIONS_FINERACT || []) : window.QUESTIONS;
  }
  function snapshot() {
    return get() === "fineract" ? null : window.NLSnapshot;
  }
  function isFree() { return get() === "fineract"; }
  return { DATASETS, get, set, layer, dbPath, questions, snapshot, isFree };
})();

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
    // fineract는 골든 없음 (자기순환 방지 — 골든은 별도 세션에서 저작). 자유 질의만.
    return get() === "fineract" ? [] : window.QUESTIONS;
  }
  function snapshot() {
    return get() === "fineract" ? null : window.NLSnapshot;
  }
  function isFree() { return get() === "fineract"; }
  return { DATASETS, get, set, layer, dbPath, questions, snapshot, isFree };
})();

// ============================================================
// live-api.js — 모델 호출 래퍼. LiveAPI.complete(system, user, {onRetry}) → JSON.
// 키 해석 순서: window.ANTHROPIC_KEY(local-config.js, gitignore) → localStorage.
// 키는 리포에 절대 넣지 않는다 — public 리포의 키는 시크릿 스캐닝으로 자동 비활성화됨.
// 모델: setModel/getModel, localStorage 'nl_model'에 유지. (구 sonnet-4는 2026-06-15 retire)
// ============================================================
window.LiveAPI = (function () {
  // .env 로더 — 리포 루트의 .env(gitignore)에서 ANTHROPIC_API_KEY 를 읽는다.
  // 로컬 실행용: Pages에는 .env가 배포되지 않으므로(gitignore) 조용히 폴백.
  const ENV_READY = (async () => {
    try {
      const r = await fetch(".env", { cache: "no-store" });
      if (r.ok) {
        const t = await r.text();
        const m = t.match(/^\s*ANTHROPIC_API_KEY\s*=\s*["']?(sk-ant-[A-Za-z0-9_\-]+)/m);
        if (m && !window.ANTHROPIC_KEY) window.ANTHROPIC_KEY = m[1];
      }
    } catch (e) {}
  })();

  const MODELS = [
    { id: "claude-haiku-4-5",  label: "Haiku 4.5 · 빠름/저렴" },
    { id: "claude-sonnet-4-6", label: "Sonnet 4.6 · 기본" },
    { id: "claude-opus-4-8",   label: "Opus 4.8 · 고성능" },
    { id: "claude-fable-5",    label: "Fable 5 · 최상위" },
  ];
  const DEFAULT_MODEL = "claude-sonnet-4-6";

  function getModel() {
    const m = localStorage.getItem("nl_model");
    return MODELS.some((x) => x.id === m) ? m : DEFAULT_MODEL;
  }
  function setModel(id) { localStorage.setItem("nl_model", id); }
  function getKey() {
    return (typeof window !== "undefined" && window.ANTHROPIC_KEY) ||
           localStorage.getItem("anthropic_key") || null;
  }
  function hasKey() { return !!getKey(); }

  function stripFence(t) {
    return t.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  }
  function parseJson(text) {
    const t = stripFence(text);
    try { return JSON.parse(t); } catch (e) {}
    const s = t.indexOf("{");
    if (s >= 0) {
      let depth = 0;
      for (let i = s; i < t.length; i++) {
        if (t[i] === "{") depth++;
        else if (t[i] === "}") { depth--; if (depth === 0) { try { return JSON.parse(t.slice(s, i + 1)); } catch (e) { break; } } }
      }
    }
    throw new Error("JSON 파싱 실패: " + t.slice(0, 120));
  }

  async function complete(system, user, opts) {
    await ENV_READY;
    const { onRetry } = opts || {};
    const headers = { "Content-Type": "application/json" };
    const key = getKey();
    if (key) {
      headers["x-api-key"] = key;
      headers["anthropic-version"] = "2023-06-01";
      headers["anthropic-dangerous-direct-browser-access"] = "true";
    }
    let lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const resp = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST", headers,
          body: JSON.stringify({ model: getModel(), max_tokens: 1000,
            // system 블록 캐싱: 카탈로그 지도가 질의 간 불변이라 두 번째 턴부터 캐시 히트
            system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
            messages: [{ role: "user", content: user }] }),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
        return parseJson(text);
      } catch (e) {
        lastErr = e;
        const delay = 800 * Math.pow(2, attempt - 1);
        if (onRetry) onRetry(attempt, delay, e);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw lastErr;
  }

  return { complete, MODELS, getModel, setModel, hasKey, ready: ENV_READY };
})();

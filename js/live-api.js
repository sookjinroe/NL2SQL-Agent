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
      if (/github\.io$/.test(location.hostname)) return;  // Pages엔 .env가 없음 - 404 노이즈 방지
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
      // 문자열 리터럴 내부의 중괄호를 무시하는 균형 파서 (__30_ F01: SQL·문장 속
      // 중괄호를 세어 조기 종료하던 결함 수정)
      let depth = 0, inStr = false, esc = false;
      for (let i = s; i < t.length; i++) {
        const ch = t[i];
        if (esc) { esc = false; continue; }
        if (ch === "\\") { esc = true; continue; }
        if (ch === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (ch === "{") depth++;
        else if (ch === "}") { depth--; if (depth === 0) { try { return JSON.parse(t.slice(s, i + 1)); } catch (e) { break; } } }
      }
      if (depth > 0) throw new Error("JSON 파싱 실패(응답 잘림 의심 — 여는 중괄호 " + depth + "개 미닫힘): " + t.slice(0, 120));
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
          // max_tokens 기본 1000 (단일 질문 계약 v2 기준). 분석 계약(analyst)의
          // 다섹션 report JSON은 1000을 넘어 잘림 → 파싱 실패 (__29_ F02 실증) - opts로 상향.
          body: JSON.stringify({ model: getModel(), max_tokens: (opts && opts.maxTokens) || 1000,
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

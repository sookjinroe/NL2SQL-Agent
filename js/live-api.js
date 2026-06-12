// ============================================================
// live-api.js — 모델 호출 래퍼. 기존 PoC의 window.LiveAPI contract 호환:
//   LiveAPI.complete(system, user, {onRetry}) → JSON 객체
// claude.ai 안에서는 키 없이 동작(api 프록시). 로컬 실행 시
//   localStorage.setItem('anthropic_key', 'sk-ant-...') 로 키 주입.
// 이식 시 이 파일만 기존 앱의 LiveAPI로 교체하면 된다.
// ============================================================
window.LiveAPI = (function () {
  const MODEL = "claude-sonnet-4-20250514";

  function stripFence(t) {
    return t.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  }
  function parseJson(text) {
    const t = stripFence(text);
    try { return JSON.parse(t); } catch (e) {}
    // 복구: 첫 '{'부터 짝이 맞는 '}'까지
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
    const { onRetry } = opts || {};
    const headers = { "Content-Type": "application/json" };
    const key = (typeof localStorage !== "undefined") && localStorage.getItem("anthropic_key");
    if (key) { headers["x-api-key"] = key; headers["anthropic-version"] = "2023-06-01"; headers["anthropic-dangerous-direct-browser-access"] = "true"; }
    let lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const resp = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST", headers,
          body: JSON.stringify({ model: MODEL, max_tokens: 1000,
            system, messages: [{ role: "user", content: user }] }),
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

  return { complete, MODEL };
})();

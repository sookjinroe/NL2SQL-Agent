// ============================================================
// agent-core.js — NL 에이전트 루프 (UI 비의존 순수 코어).
// nl.jsx(브라우저)와 node 테스트가 같은 코드를 쓴다 — 루프 로직의 단일 원천.
// runAgent({question, complete, layerCall, maxOps, onEvent}) →
//   { final, log, opsTrace, turns, error? }
// onEvent(e): {type:'think'|'op_request'|'op_done'|'final'|'note', ...} — UI 연출용 훅.
// ============================================================
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AgentCore = factory();
})(typeof self !== "undefined" ? self : this, function () {

  async function runAgent({ question, complete, layerCall, sysPrompt, userPrompt, maxOps, onEvent }) {
    const emit = onEvent || (() => {});
    const log = [], opsTrace = [];
    const seen = new Set();
    let final = null, turns = 0;

    for (let t = 0; t <= maxOps; t++) {
      turns++;
      const left = maxOps - log.length;
      let resp;
      try {
        resp = await complete(sysPrompt, userPrompt(question, log, left));
      } catch (e) {
        return { final: { action: "cannot_answer", reason: "모델 호출 실패: " + (e.message || e) },
                 log, opsTrace, turns, error: String(e.message || e) };
      }
      if (resp.thinking) await emit({ type: "think", text: resp.thinking });

      if (resp.action === "op") {
        const key = resp.op + "::" + JSON.stringify(resp.args || {});
        if (seen.has(key)) {
          // 중복 호출 — 프로토콜대로 무시하되, 다음 턴 유도용 표지를 기록에 남긴다
          log.push({ op: resp.op, args: resp.args || {},
                     result: { error: "중복 호출 — 무시됨. 이미 받은 결과로 진행하거나 다른 행동을 하라." } });
          await emit({ type: "note", text: `중복 호출 무시: ${resp.op}` });
          continue;
        }
        seen.add(key);
        await emit({ type: "op_request", op: resp.op, args: resp.args || {} });
        const r = layerCall(resp.op, resp.args || {});
        opsTrace.push({ op: resp.op, args: resp.args || {},
                        hit: r.raw && r.raw._hit === false ? false : true });
        log.push({ op: resp.op, args: resp.args || {}, result: r.public });
        await emit({ type: "op_done", op: resp.op, args: resp.args || {}, result: r.public });
        continue;
      }
      final = resp; break;
    }
    if (!final) final = { action: "cannot_answer", reason: "연산 상한 도달 — 최종 액션 미산출" };
    await emit({ type: "final", out: final });
    return { final, log, opsTrace, turns };
  }

  return { runAgent };
});

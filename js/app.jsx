// app.jsx — 통합 셸: 해시 키 부트스트랩 + 모델 선택 + 탭.
// 키 부트스트랩: '#k=sk-ant-...'로 접속하면 localStorage 저장 후 주소에서 즉시 제거.
//   해시 프래그먼트는 서버로 전송되지 않으며, 키는 리포·서버 어디에도 남지 않는다.
(function () {
  const m = location.hash.match(/^#k=(sk-ant-[A-Za-z0-9_\-]+)/);
  if (m) { localStorage.setItem("anthropic_key", m[1]); history.replaceState(null, "", location.pathname + location.search); }
})();

const { useState: aUseState } = React;
function AppShell() {
  const [tab, setTab] = aUseState("agent");
  const [model, setModelState] = aUseState(window.LiveAPI.getModel());
  const tabs = [["agent", "NL 에이전트"], ["explorer", "데이터 탐색"]];
  return (
    <div>
      <div style={{ display: "flex", gap: 4, padding: "10px 16px 0", borderBottom: "1px solid var(--border)", alignItems: "flex-end" }}>
        {tabs.map(([k, label]) => (
          <div key={k} onClick={() => setTab(k)}
            style={{ fontFamily: "var(--mono)", fontSize: 12.5, padding: "7px 16px", cursor: "pointer",
                     color: tab === k ? "var(--text)" : "var(--dim)",
                     borderBottom: tab === k ? "2px solid var(--accent)" : "2px solid transparent" }}>
            {label}
          </div>))}
        <div style={{ flex: 1 }} />
        <select value={model}
          onChange={(e) => { window.LiveAPI.setModel(e.target.value); setModelState(e.target.value); }}
          style={{ fontFamily: "var(--mono)", fontSize: 11.5, background: "rgba(0,0,0,0.3)", color: "var(--text)",
                   border: "1px solid var(--border)", borderRadius: 4, padding: "4px 8px", marginBottom: 7 }}>
          {window.LiveAPI.MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--dim)", paddingBottom: 10, marginLeft: 12 }}>
          corpus-v1
        </div>
      </div>
      <div style={{ display: tab === "agent" ? "block" : "none" }}><window.NLScreen /></div>
      {tab === "explorer" && <window.ExplorerScreen />}
    </div>
  );
}
ReactDOM.createRoot(document.getElementById("root")).render(<AppShell />);

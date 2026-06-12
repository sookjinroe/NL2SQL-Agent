// app.jsx — 통합 셸: DB·레이어 1회 부트(window.__DB) 후 탭으로 두 화면 전환.
const { useState: aUseState } = React;
function AppShell() {
  const [tab, setTab] = aUseState("agent");
  const tabs = [["agent", "NL 에이전트"], ["explorer", "데이터 탐색"]];
  return (
    <div>
      <div style={{ display: "flex", gap: 4, padding: "10px 16px 0", borderBottom: "1px solid var(--border)" }}>
        {tabs.map(([k, label]) => (
          <div key={k} onClick={() => setTab(k)}
            style={{ fontFamily: "var(--mono)", fontSize: 12.5, padding: "7px 16px", cursor: "pointer",
                     color: tab === k ? "var(--text)" : "var(--dim)",
                     borderBottom: tab === k ? "2px solid var(--accent)" : "2px solid transparent" }}>
            {label}
          </div>))}
        <div style={{ flex: 1 }} />
        <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--dim)", alignSelf: "center", paddingBottom: 6 }}>
          corpus-v1 · semantic layer NL2SQL 검증
        </div>
      </div>
      <div style={{ display: tab === "agent" ? "block" : "none" }}><window.NLScreen /></div>
      {tab === "explorer" && <window.ExplorerScreen />}
    </div>
  );
}
ReactDOM.createRoot(document.getElementById("root")).render(<AppShell />);

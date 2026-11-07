import React, { useCallback, useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";

// Drop-in Settings panel for the EXISTING Base44 app.
// It is intentionally administrator-only and never starts a paid review.
export default function GateKeeperReadinessPanel() {
  const [state, setState] = useState({ loading: true, result: null, error: "" });

  const check = useCallback(async () => {
    setState((previous) => ({ ...previous, loading: true, error: "" }));
    try {
      const response = await base44.functions.invoke("gatekeeperReadiness", {});
      setState({ loading: false, result: response?.data ?? null, error: "" });
    } catch (error) {
      const status = error?.response?.status;
      setState({
        loading: false,
        result: error?.response?.data ?? null,
        error: status === 401 ? "Sign in to check TrueForge" :
          status === 403 ? "Administrator access required" :
          "TrueForge readiness could not be verified",
      });
    }
  }, []);

  useEffect(() => { void check(); }, [check]);
  const data = state.result;
  const row = (title, ready) => <div key={title} style={{
    display: "flex", justifyContent: "space-between", gap: 15, padding: "10px 0",
    borderBottom: "1px solid #dbe4dc",
  }}>
    <span>{title}</span><strong>{ready ? "Verified" : "Not verified"}</strong>
  </div>;

  return <section aria-label="TrueForge live readiness" style={{
    padding: 22, background: "#f4f7f1", border: "1px solid #cbd9c8",
    borderRadius: 12, color: "#18312b",
  }}>
    <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em" }}>
      TRUEFORGE / ADMIN DIAGNOSTICS
    </div>
    <h3 style={{ margin: "14px 0 8px", fontSize: 22 }}>Connection readiness</h3>
    <p style={{ lineHeight: 1.6, fontSize: 13 }}>
      A runtime connection is not authority to run reviews. Paid inference,
      model access, tenant isolation and independent spending limits require
      separate qualification.
    </p>
    <div aria-live="polite">
      {state.loading ? "Checking…" :
        state.error || (data?.status === "agent_metadata_verified" ?
          "Runtime and agent metadata are reachable" : "Connection unverified")}
    </div>
    {data && <>
      {row("TrueForge runtime", data.runtimeReachable === true)}
      {row("gate-keeper registered", data.agentRegistered === true)}
      {row("Agent model declared", data.modelDeclared === true)}
      {row("Live reviews authorised", data.reviewEnabled === true)}
      <p style={{ fontSize: 11, color: "#536d5e" }}>Last check: {data.checkedAt || "Unknown"}</p>
    </>}
    <button type="button" disabled={state.loading} onClick={() => void check()}
      style={{ marginTop: 15, padding: "10px 16px", background: "#183a2d",
        color: "#fff", border: 0, borderRadius: 7, cursor: "pointer" }}>
      {state.loading ? "Checking…" : "Refresh readiness"}
    </button>
  </section>;
}

// Drop-in panel for the existing Base44 Gate Keeper site.
// Copy into its components/ directory once the app is linked for editing.
// No credentials or TrueForge API calls originate from the browser.
import React, { useCallback, useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";

export default function GateKeeperConnectionPanel() {
  const [state, setState] = useState({ loading: true, connected: false, error: null, checkedAt: null });

  const refresh = useCallback(async () => {
    setState((previous) => ({ ...previous, loading: true }));
    try {
      const result = await base44.functions.invoke("gatekeeperStatus", {});
      setState({
        loading: false,
        connected: result?.data?.connected === true,
        error: result?.data?.connected === true ? null : "TrueForge is not reachable",
        checkedAt: result?.data?.checkedAt || null,
      });
    } catch (error) {
      // 401/403 intentionally do not fall back to an unauthenticated status route.
      const status = error?.response?.status;
      setState({
        loading: false,
        connected: false,
        error: status === 401 ? "Sign in to inspect the agent" :
          status === 403 ? "Administrator access required" :
          "Cannot verify the TrueForge connection",
        checkedAt: null,
      });
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const status = state.loading ? "Checking…" : state.connected ? "Runtime reachable" : "Unverified";
  return (
    <section aria-label="Gate Keeper connection" style={{
      padding: "24px", border: "1px solid #D9E3EB", borderRadius: "16px",
      background: "#FFFFFF", color: "#142D3C", maxWidth: "720px"
    }}>
      <div style={{ fontSize: "12px", fontWeight: 700, letterSpacing: "0.08em", color: "#4C6978" }}>
        GATE KEEPER · TRUEFORGE
      </div>
      <h2 style={{ margin: "8px 0", fontSize: "24px" }}>Agent connection</h2>
      <p aria-live="polite" role="status" style={{ margin: "8px 0 16px" }}>
        <strong>{status}</strong>{state.error ? ` — ${state.error}` : ""}
      </p>
      <p style={{ fontSize: "14px", lineHeight: 1.5, color: "#4C6978" }}>
        A healthy runtime is not proof of a qualified review, provider model, or learning cycle.
        Review execution remains disabled until the authenticated per-user API flow is verified.
      </p>
      {state.checkedAt && <p style={{ fontSize: "12px", color: "#4C6978" }}>Last checked: {state.checkedAt}</p>}
      <button onClick={() => void refresh()} disabled={state.loading}
        style={{
          padding: "10px 16px", cursor: state.loading ? "wait" : "pointer",
          borderRadius: "8px", background: "#153F5D", color: "#FFF", border: "none"
        }}>
        {state.loading ? "Checking…" : "Check connection"}
      </button>
    </section>
  );
}

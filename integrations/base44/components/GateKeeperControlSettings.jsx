import React, { useCallback, useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import controls from "../data/controlProfiles.json";

// Administrator-only control POLICY DRAFT editor. Server owns authentication,
// stored rows and revision checks. This never starts model inference.
const defaults = controls.defaults;
const levels = controls.levels;
export default function GateKeeperControlSettings() {
  const [state, setState] = useState({
    ready: false, saving: false, error: "", notice: "",
    revision: 0, current: null, form: { ...defaults },
  });
  const load = useCallback(async () => {
    setState((s) => ({ ...s, ready: false, error: "", notice: "" }));
    try {
      const response = await base44.functions.invoke("gatekeeperControls", { action: "load" });
      const data = response?.data;
      if (data?.status !== "draft_only" || !data.controls ||
          !Number.isSafeInteger(data.revision)) throw new Error("invalid_response");
      setState({
        ready: true, saving: false, error: "", notice: "Owner draft loaded. Runtime remains unchanged.",
        revision: data.revision, current: data.controls, form: { ...data.controls },
      });
    } catch (error) {
      const code = error?.response?.status;
      setState((s) => ({
        ...s, ready: false, saving: false, current: null,
        error: code === 403 ? "Administrator access required." :
          code === 401 ? "Sign in to manage review controls." :
          "Settings backend or private policy entity is not installed. Defaults shown for preview only.",
      }));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const patch = (name, value) => setState((s) => ({
    ...s, form: { ...s.form, [name]: value }, notice: "", error: "",
  }));
  const dirty = state.current && Object.keys(defaults).some(
    (key) => state.current[key] !== state.form[key],
  );
  const save = async () => {
    if (!state.ready || state.saving || !dirty) return;
    setState((s) => ({ ...s, saving: true, error: "", notice: "" }));
    try {
      const response = await base44.functions.invoke("gatekeeperControls", {
        action: "save", controls: state.form, expectedRevision: state.revision,
      });
      const data = response?.data;
      if (data?.status !== "saved_draft_not_applied" || !Number.isSafeInteger(data.revision))
        throw new Error("not_saved");
      setState((s) => ({
        ...s, ready: true, saving: false, revision: data.revision,
        current: { ...data.controls }, form: { ...data.controls },
        notice: "Draft saved. No change to the live TrueForge agent, sandbox or billing.",
      }));
    } catch (error) {
      const code = error?.response?.status;
      setState((s) => ({
        ...s, saving: false,
        error: code === 409 ? "A newer draft exists. Reload before editing." :
          code === 401 || code === 403 ? "Administrator authorisation failed." :
          "Draft was not saved; no live settings were changed.",
      }));
    }
  };

  const level = levels[state.form.vModelLevel] ?? levels[0];
  return <section aria-label="Gate Keeper administrator review-control settings"
    style={{ padding: 22, borderRadius: 12, border: "1px solid #cbd9c8",
      color: "#18312b", background: "#f4f7f1", marginTop: 20 }}>
    <div style={{ font: "800 11px ui-monospace,monospace", letterSpacing: ".08em" }}>
      ADMINISTRATOR / REVIEW CONTROL DRAFT
    </div>
    <h3 style={{ margin: "12px 0", fontSize: 22 }}>Adversarial and V-model controls</h3>
    <p style={{ fontSize: 13, lineHeight: 1.7 }}>
      Starts at the current Gatekeeper configuration: adversarial ON,
      V-model level 0 (read-only). Settings are stored only after an
      authorised Save and do not activate the live reviewer.
    </p>
    <label style={{ display: "flex", gap: 10, alignItems: "start", padding: "12px 0" }}>
      <input type="checkbox" checked={state.form.adversarialReview}
        onChange={(e) => patch("adversarialReview", e.target.checked)} />
      <span><strong>Adversarial reviewer {state.form.adversarialReview ? "ON" : "OFF"}</strong>
        <small style={{ display: "block", marginTop: 4 }}>
          OFF selects plain/lean review. Independent security checks still apply.
        </small></span>
    </label>
    <label htmlFor="gk-policy-v-slider" style={{ display: "block", margin: "15px 0 6px" }}>
      <strong>V-model strength: {level.label}</strong>
    </label>
    <input id="gk-policy-v-slider" type="range" min="0" max="3" step="1"
      style={{ width: "100%" }} value={state.form.vModelLevel}
      onChange={(e) => patch("vModelLevel", Number(e.target.value))}
      aria-valuetext={level.label} />
    <p aria-live="polite" style={{ fontSize: 12, margin: "8px 0 14px" }}>
      {level.summary} Required stages: {level.requires.join(", ").replaceAll("_", " ")}.
    </p>
    <label style={{ display: "flex", gap: 10, alignItems: "start", margin: "12px 0" }}>
      <input type="checkbox" checked={state.form.gateEnabled}
        onChange={(e) => patch("gateEnabled", e.target.checked)} />
      <span><strong>Optional advisory gate {state.form.gateEnabled ? "ON" : "OFF"}</strong>
        <small style={{ display: "block", marginTop: 4 }}>
          Owner-only draft. Tenant-specific opt-out and admin overrides require
          independently verified tenant membership; spend/security controls cannot be waived.
        </small></span>
    </label>
    <div role="status" aria-live="polite" style={{ fontSize: 12, marginTop: 14 }}>
      {state.error || state.notice || (state.saving ? "Saving draft…" :
        state.ready ? "Draft ready to edit." : "Checking settings backend…")}
    </div>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 14 }}>
      <button type="button" disabled={!state.ready || state.saving || !dirty} onClick={save}
        style={{ padding: "10px 16px" }}>Save draft settings</button>
      <button type="button" disabled={state.saving} onClick={() => void load()}
        style={{ padding: "10px 16px" }}>Reload</button>
    </div>
    <p style={{ fontSize: 11, lineHeight: 1.65, marginTop: 18 }}>
      No paid inference, live execution, production merge or policy activation
      is performed by these controls. Activation requires a separate qualified
      backend connection and independently signed spending lease.
    </p>
  </section>;
}

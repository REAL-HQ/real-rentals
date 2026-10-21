import { mock } from "bun:test";
import assert from "node:assert/strict";
import * as React from "react";
// Render the actual component with local hook/auth/transport doubles. No provider or browser access.
const values: unknown[] = ["synthetic-owner", null, "", [], false, null, "original", "", ""];
let cursor = 0;
mock.module("react", () => ({ ...React, useEffect: () => {}, useRef: (v: unknown) => ({ current: v }), useState: () => {
 const i = cursor++; return [values[i], (v: unknown) => { values[i] = v; }];
}}));
mock.module("@tanstack/react-start", () => ({ useServerFn: (f: unknown) => f }));
mock.module("@/integrations/supabase/client", () => ({ supabase: {} }));
mock.module("@/lib/paper-release", () => ({ PAPER_RELEASE: { visible: true, registration: true }, PAPER_HOLD: "" }));
mock.module("@/lib/paper-agreements.functions", () => Object.fromEntries([
 "uploadPaperAgreement", "recoverPaperAgreement", "cancelPaperAgreement", "listPaperAgreementOriginals", "getPaperAgreementPdf", "inspectPaperCandidates"
].map(k => [k, () => { throw Error("Unexpected transport call"); }])));
mock.module("@/lib/agreement-download", () => ({ saveAgreementPdf: () => {} }));
mock.module("@/components/FileUploader", () => ({ FileUploader: "file-uploader" }));
mock.module("@/components/ui/button", () => ({ Button: "button" }));
const { PaperAgreements } = await import("../src/components/admin/PaperAgreements");
function render() {
 cursor = 0;
 const panel = PaperAgreements({ applicationId: "synthetic-app" }) as any;
 const tree = panel.type(panel.props);
 const nodes: any[] = [];
 function walk(n: any) { if (Array.isArray(n)) return n.forEach(walk); if (!n || typeof n !== "object") return; nodes.push(n); walk(n.props?.children); }
 walk(tree);
 return { textarea: nodes.find(n => n.type === "textarea"), save: nodes.find(n => n.type === "button" && n.props.children === "Upload and Register"), alert: nodes.find(n => n.props?.role === "alert"), counter: nodes.find(n => n.props?.id === "paper-notes-count-synthetic-app") };
}
let pass = 0;
function check(name: string, condition: unknown) { assert.ok(condition, name); console.log("PASS " + name); pass++; }
let ui = render();
check("browser maximum length removed", ui.textarea.props.maxLength === undefined);
const pasted = "  " + "x".repeat(1200) + "\n exact end  ";
ui.textarea.props.onChange({ target: { value: pasted } });
ui = render();
check("oversized paste event preserves complete state and input", values[8] === pasted && ui.textarea.props.value === pasted);
check("oversized input has visible accessible error", !!ui.alert && ui.textarea.props["aria-invalid"] === true);
check("oversized input disables upload", ui.save.props.disabled === true);
check("counter displays full oversized length", ui.counter.props.children[0] === pasted.length.toLocaleString("en-US"));
await ui.save.props.onClick();
check("submission guard refuses oversized input without transport or operation", values[1] === null && values[8] === pasted && String(values[2]).includes("1,000 characters"));
ui.textarea.props.onChange({ target: { value: "x".repeat(1000) } }); ui = render();
check("exactly 1000 accepted and error cleared", !ui.save.props.disabled && !ui.alert && ui.textarea.props.value.length === 1000);
ui.textarea.props.onChange({ target: { value: "" } }); ui = render();
check("empty Notes accepted", !ui.save.props.disabled && !ui.alert && ui.textarea.props.value === "");
console.log(JSON.stringify({ pass, fail: 0, scope: "actual component with mocked React hooks and transports; paste change event, not browser clipboard" }));

import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { SigningPanel } from "@/components/esign/SigningPanel";
import { V16_BODY } from "@/lib/agreement-builder";
import { renderTemplate } from "@/lib/agreement-merge";
// TEMPORARY screenshot fixture — synthetic data only; deleted after QA.
export const Route = createFileRoute("/zz-sign-preview")({ component: P });
function P() {
  const [out, setOut] = useState("");
  const body = renderTemplate(V16_BODY, { driver_name: "Jane Q Testdriver" });
  return <div className="min-h-screen bg-[#FAFAFB] p-4"><div className="mx-auto max-w-3xl"><SigningPanel body={body} defaultName="Jane Q Testdriver" companySigner="Test Signer" busy={false} onSubmit={(v) => setOut(JSON.stringify({ sig: v.adoption.signature.method, acks: v.adoption.acks.filter(Boolean).length }))} /><p data-testid="out">{out}</p></div></div>;
}

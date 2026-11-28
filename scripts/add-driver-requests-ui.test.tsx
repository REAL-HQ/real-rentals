/**
 * Add Driver screens render the right copy, and the staff tab is Manager+.
 * Run: bun test scripts/add-driver-requests-ui.test.tsx
 */
import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// Server functions are not called by these static renders.
const stub = async () => ({});
mock.module("@/lib/add-driver-requests.functions", () => ({
  getMyAddDriverState: stub, createAddDriverUploadUrl: stub, submitAddDriver: stub, payAddDriver: stub,
  listAddDriverRequests: stub, getAddDriverFileUrl: stub, startAddDriverInsuranceStep: stub,
  createAddDriverCardUploadUrl: stub, approveAddDriver: stub, denyAddDriver: stub,
}));

const { AddDriverInfo, DifferentAddressNotice } = await import("../src/components/portal/AddDriverCard");
const { AddDriverStatusBadge } = await import("../src/components/admin/AddDriverRequests");
const { TABS, visibleWorkspaceTabs, navOwner } = await import("../src/components/admin/nav-config");

describe("renter screens", () => {
  test("info block lists cost, insurance, approval and same address", () => {
    const html = renderToStaticMarkup(<AddDriverInfo />);
    for (const t of ["Cost:", "Insurance:", "Approval:", "Same Address:", "$100", "driving record"]) expect(html).toContain(t);
  });
  test("different address notice links to the apply flow", () => {
    const html = renderToStaticMarkup(<DifferentAddressNotice />);
    expect(html).toContain('href="/apply"');
    expect(html).toContain("Apply For A Car");
    expect(html).toContain("apply for their own car");
  });
});

describe("back office", () => {
  test("status badges use the five labels", () => {
    const labels = (["requested", "paid", "insurance_pending", "approved", "denied"] as const).map((s) => renderToStaticMarkup(<AddDriverStatusBadge status={s} />));
    expect(labels.join(" ")).toContain("Requested");
    expect(labels.join(" ")).toContain("Insurance Pending");
    expect(labels.join(" ")).toContain("Denied");
  });
  test("Add Driver tab sits in the Drivers workspace and needs Manager", () => {
    expect(TABS.find((t) => t.id === "add_drivers")?.minTier).toBe("manager");
    expect(navOwner("add_drivers")).toBe("drivers");
    expect(visibleWorkspaceTabs("drivers", "manager").map((t) => t.id)).toContain("add_drivers");
    expect(visibleWorkspaceTabs("drivers", "coordinator").map((t) => t.id)).not.toContain("add_drivers");
  });
});

/**
 * Documents section: every file in a category is listed, and the preview
 * can page through them.
 *
 * Run: bun test scripts/category-files-ui.test.ts
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DocumentViewer } from "../src/components/admin/DocumentViewer";
import { ApplicantDocuments } from "../src/components/admin/ApplicantDocuments";
import type { VaultDocument } from "../src/lib/documents.functions";

function vault(over: Partial<VaultDocument> & Pick<VaultDocument, "id" | "category" | "created_at">): VaultDocument {
  return {
    label: null,
    file_name: "file.jpg",
    mime_type: "image/jpeg",
    size_bytes: 1200,
    expires_at: null,
    is_current: true,
    visibility: ["driver", "admin"],
    uploaded_by_role: "driver",
    url: `https://signed.example/${over.id}`,
    review_status: "uploaded",
    review_note: null,
    reviewed_at: null,
    signed_agreement: false,
    ...over,
  };
}

describe("preview pages through a category", () => {
  test("Previous and Next are on the viewer when a category has more than one file", () => {
    const html = renderToStaticMarkup(
      <DocumentViewer
        doc={{ url: "https://signed.example/a", fileName: "ssa.pdf", mimeType: "application/pdf", title: "Income Proof" }}
        onClose={() => {}}
        nav={{ index: 0, total: 2, onPrevious: () => {}, onNext: () => {} }}
      />,
    );
    expect(html).toContain("Previous");
    expect(html).toContain("Next");
    expect(html).toContain('data-testid="doc-viewer-page"');
    expect(html).toContain("1 of 2");
    expect(html).toContain("disabled");
  });
});

describe("a category lists every file", () => {
  test("Income Proof shows both files, newest first, with the time and who uploaded them", () => {
    const html = renderToStaticMarkup(
      <ApplicantDocuments
        applicationId="40000000-0000-4000-8000-000000000001"
        loading={false}
        onRefresh={() => {}}
        docs={[
          vault({
            id: "ssa",
            category: "income",
            file_name: "social-security.pdf",
            mime_type: "application/pdf",
            created_at: "2026-11-01T15:00:00Z",
            uploaded_by_role: "driver",
          }),
          vault({
            id: "uber",
            category: "income",
            file_name: "uber-earnings.pdf",
            mime_type: "application/pdf",
            created_at: "2026-11-20T15:00:00Z",
            uploaded_by_role: "team",
          }),
        ]}
      />,
    );
    const uber = html.indexOf("uber-earnings.pdf");
    const ssa = html.indexOf("social-security.pdf");
    expect(uber).toBeGreaterThan(-1);
    expect(ssa).toBeGreaterThan(uber);
    expect(html).toContain("Uploaded By Team");
    expect(html).toContain("Uploaded By Driver");
    expect(html).toContain("ET");
    expect(html).toContain("2 Files");
    expect(html).toContain('data-testid="open-files-income"');
    expect(html).toContain('data-testid="category-files-income"');
    expect(html).toContain('aria-label="Move uber-earnings.pdf"');
    expect(html).toContain("Download");
  });
});

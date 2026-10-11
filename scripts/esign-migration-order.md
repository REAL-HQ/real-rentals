# eSign migration reservations — proposed, not executed

Approved reservations: 0022 Application Resume; 0023 Template Versioning and Library; 0024 Agreement Numbering; 0025 Identity Audit; 0026 Vehicle Pricing; 0027 Title Metadata; 0028 Vehicle Delete Safety; 0029 Manual Payments; 0030 Coordinator Security; 0031 containment; 0032 NULL-safe identity RPC. This package changes no reservation, SQL body or existing journal.

0023 comprises esign-template-versioning.proposed.sql followed by agreement-template-library.proposed.sql in one runner-owned transaction. 0024 is agreement-number.proposed.sql. Byte checksums and source are in docs/releases/esign-package.json. These remain proposal files, not automatically executed migrations.

Do not make eSign wait for Application Resume merely because of filename numbers. Verify actual production journal and schema first; assign journal timestamps in actual execution order. If 0025/0030/0032 already ran, later 0023/0024 must have later timestamps or Drizzle can skip them. Test the exact runner package against an isolated complete schema before approval. Preserve all historical journal rows. Do not apply unrelated migrations.

The agreements Coordinator boundary skipped on staging when agreements was absent must be installed/verified when that schema becomes available. Existing 0030 conditional behavior is not proof that a future table is protected. Owner/Manager PDF access and Driver-own access must be verified through actual server handlers and direct API paths.

SQL installation and publication require separate approval. No database change is made by this PR.

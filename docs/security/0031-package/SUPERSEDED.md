# Superseded for installation — retained for audit history

`0031_guarded_coordinator_containment.sql` (`32c17aa76e5026c4f50a2179aab143baa5d05463743b1a0f366ab4339103494f`)
must not be submitted again. Its post-install normalisation sorts policy names by the database
collation, so on production (`en_US.UTF-8`) it always refuses with `POST_UNEXPECTED_CATALOG_CHANGE`
(`../0031-direct-attempt-2026-10-24/`). The corrected package is `../0031-package-v2/`, which
needs its own approval. This file and its checksum are unchanged.

/**
 * false: archiveDocument keeps today's path, upload, and documents insert.
 * No environment variable can open this.
 * true: the signed PDF is stored at
 * rental-agreements/immutable-v1/{documentId}/{sha256}.pdf with
 * documents.content_sha256 and storage metadata.sha256 set before the
 * agreement row receives sha256 and document_id.
 * Activation is changing this constant and rebuilding.
 */
export const ESIGN_IMMUTABLE_ARCHIVE_V1_ENABLED = false;

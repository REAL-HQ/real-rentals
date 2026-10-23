/**
 * false: archiveDocument keeps today's path, upload, and documents insert.
 * No environment variable can open this.
 * true: the signed PDF is stored once at
 * rental-agreements/immutable-v1/{documentId}/{sha256}.pdf. The upload
 * metadata option is what supabase-js writes to
 * storage.objects.user_metadata.sha256. The documents row stays hidden
 * from the driver until the agreement update commits.
 * SIGNED_ARCHIVE_V1_ENABLED must stay false when immutable-v1 is on.
 * archiveDocument checks that flag first, so completed-v1 runs and this
 * writer does not.
 * Activation is changing this constant and rebuilding.
 */
export const ESIGN_IMMUTABLE_ARCHIVE_V1_ENABLED = false;

/** Per-panel read generations. Never clears a shared query cache or changes authority. */
export function createDriverReadVersions() {
  const versions = new Map<string, number>();
  let epoch = 0;
  return {
    begin(key: string) {
      const version = (versions.get(key) ?? 0) + 1;
      const started = epoch;
      versions.set(key, version);
      return () => started === epoch && versions.get(key) === version;
    },
    invalidateAll() { epoch += 1; },
  };
}

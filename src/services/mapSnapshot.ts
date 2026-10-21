/**
 * mapSnapshot — lets the explanation ask a mounted map for a picture of the route.
 *
 * The map (WebView on native, iframe on web) registers a provider under its instance name while
 * it is mounted. Any failure or timeout resolves to null, so the explanation is never blocked and
 * simply goes without the picture.
 */

/** Largest snapshot accepted: about 300 KB of image data, the server's limit. */
const MAX_SNAPSHOT_CHARS = 400_000;
const SNAPSHOT_RE = /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]+=*$/;
const DEFAULT_TIMEOUT_MS = 3000;

export type SnapshotProvider = () => Promise<string | null>;

const providers = new Map<string, SnapshotProvider>();

/** Called by the map on mount (with a provider) and on unmount (with null). */
export const setMapSnapshotProvider = (next: SnapshotProvider | null, name = 'main'): void => {
  if (next) providers.set(name, next);
  else providers.delete(name);
};

export const isUsableSnapshot = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= MAX_SNAPSHOT_CHARS && SNAPSHOT_RE.test(value);

/** A picture of the named mounted map, or null when there is none, it fails, or it takes too long. */
export const captureMapSnapshot = async (name = 'main', timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string | null> => {
  const current = providers.get(name);
  if (!current) return null;
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
  const capture = current().catch(() => null);
  const result = await Promise.race([capture, timeout]);
  return isUsableSnapshot(result) ? result : null;
};

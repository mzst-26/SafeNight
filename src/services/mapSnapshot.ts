/**
 * mapSnapshot — lets the explanation ask the mounted map for a picture of the route.
 *
 * The map (WebView on native, iframe on web) registers a provider while it is mounted.
 * Any failure or timeout resolves to null, so the explanation is never blocked and simply
 * goes without the picture.
 */

/** Largest snapshot accepted: about 300 KB of image data, the server's limit. */
const MAX_SNAPSHOT_CHARS = 400_000;
const SNAPSHOT_RE = /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]+=*$/;
const DEFAULT_TIMEOUT_MS = 3000;

export type SnapshotProvider = () => Promise<string | null>;

let provider: SnapshotProvider | null = null;

/** Called by the map on mount (with a provider) and on unmount (with null). */
export const setMapSnapshotProvider = (next: SnapshotProvider | null): void => {
  provider = next;
};

export const isUsableSnapshot = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= MAX_SNAPSHOT_CHARS && SNAPSHOT_RE.test(value);

/** A picture of the mounted map, or null when there is none, it fails, or it takes too long. */
export const captureMapSnapshot = async (timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string | null> => {
  if (!provider) return null;
  const current = provider;
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
  const capture = current().catch(() => null);
  const result = await Promise.race([capture, timeout]);
  return isUsableSnapshot(result) ? result : null;
};

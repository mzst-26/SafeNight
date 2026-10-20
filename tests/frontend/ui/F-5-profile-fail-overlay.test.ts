import fs from 'node:fs';
import path from 'node:path';

// app/index.tsx is too large to render in isolation, so these checks read its source,
// following the pattern in T-33-index-copy.test.ts.
const source = fs.readFileSync(path.join(process.cwd(), 'app/index.tsx'), 'utf8');
const overlay = source.slice(
  source.indexOf('auth.profileFetchFailed && ('),
  source.indexOf('</AndroidOverlayHost>'),
);

describe('app/index.tsx profile-load failure overlay (F-5)', () => {
  it('no longer says the client logs the user out', () => {
    expect(overlay).not.toContain('Logging you out');
    expect(overlay).toContain('keep retrying');
  });

  it('has a single Try again button wired to the auth refresh function', () => {
    expect(overlay.match(/Try again/g)).toHaveLength(1);
    const button = overlay.match(/<Pressable[^>]*onPress=\{\(\) => auth\.refreshProfile\?\.\(\)\}/);
    expect(button).not.toBeNull();
  });
});

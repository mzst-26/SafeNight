import fs from 'node:fs';
import path from 'node:path';

// app/index.tsx is too large to render in isolation, so these checks read its source,
// following the pattern in T-33-index-copy.test.ts.
const source = fs.readFileSync(path.join(process.cwd(), 'app/index.tsx'), 'utf8');

describe('app/index.tsx start navigation accessibility label (I-3)', () => {
  it('web start controls use the visible "Get the app to navigate" label', () => {
    const webLabel = source.match(
      /accessibilityLabel=\{isWeb \? "Get the app to navigate" : "Start navigation"\}/g,
    );
    expect(webLabel).toHaveLength(2);
  });

  it('only the native-only control keeps the bare "Start navigation" label', () => {
    const bareLabel = source.match(/accessibilityLabel="Start navigation"/g) ?? [];
    expect(bareLabel).toHaveLength(1);
  });
});

describe('app/index.tsx friend check toast for stale results (I-4)', () => {
  const callerBlock = source.slice(
    source.indexOf('const { status, found, names } = await checkFriendLocations()') !== -1
      ? source.indexOf('const { status, found, names } = await checkFriendLocations()')
      : source.indexOf('const { found, names } = await checkFriendLocations()'),
    source.indexOf('Friend locations hidden'),
  );

  it('reads the status from the friend check result', () => {
    expect(callerBlock).toContain('const { status, found, names } = await checkFriendLocations()');
  });

  it('labels a stale count as the last known result', () => {
    expect(callerBlock).toContain('status === "stale"');
    expect(callerBlock).toContain('Last known: ');
  });
});

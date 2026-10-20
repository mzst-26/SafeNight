import fs from 'node:fs';
import path from 'node:path';

// app/index.tsx is too large to render in isolation, so these checks read its source,
// following the pattern in limitReachedModal.test.ts.
const source = fs.readFileSync(path.join(process.cwd(), 'app/index.tsx'), 'utf8');

describe('app/index.tsx out-of-range copy (T-33)', () => {
  it('does not hard-code the 6.2 mi walking limit', () => {
    expect(source).not.toContain('6.2 mi');
  });

  it('builds the out-of-range distance from the current plan limit in miles', () => {
    expect(source).toContain('const maxDistanceMiles =');
    expect(source).toMatch(/too far away \(max \$\{maxDistanceMiles\} mi walking distance\)/);
  });
});

describe('app/index.tsx search-around limit copy (T-34)', () => {
  it('interpolates SEARCH_AROUND_MAX_MILES instead of 30 miles', () => {
    expect(source).toContain('beyond ${SEARCH_AROUND_MAX_MILES} miles');
    expect(source).not.toContain('beyond 30 miles');
  });
});

describe('app/index.tsx closer destination hint (T-35)', () => {
  it('replaces the 3 mi hint with a non-numeric suggestion', () => {
    expect(source).not.toContain('within 3 mi.');
    expect(source).toContain('Try a closer destination.');
  });
});

describe('app/index.tsx native location help (T-40)', () => {
  const helpBlock = source.slice(
    source.indexOf('const handleLocationHelp'),
    source.indexOf('// Live tracking'),
  );

  it('native toast text does not mention the browser', () => {
    const nativeMessage = helpBlock.match(/setToast\(\{\s*message:\s*"([^"]*)"/);
    expect(nativeMessage).not.toBeNull();
    expect(nativeMessage![1]).toBe('Turn on location for SafeNight in your phone settings.');
    expect(nativeMessage![1]).not.toContain('browser');
  });

  it('keeps the native help on screen until dismissed (no 4.5 s timeout)', () => {
    expect(helpBlock).not.toContain('duration: 4500');
  });
});

describe('app/index.tsx web start navigation label (T-43)', () => {
  it('web sidebar label does not promise the Android app', () => {
    expect(source).toContain('Get the app to navigate');
    expect(source).not.toContain('Get the Android app');
  });
});

describe('app/index.tsx warning hints (T-44)', () => {
  it('uses a single "Clear via point" label', () => {
    expect(source).not.toContain('>Clear via</Text>');
    expect(source.match(/>Clear via point<\/Text>/g)?.length).toBe(3);
  });

  it('has no lightbulb emoji in warning hints', () => {
    expect(source).not.toContain('💡');
  });
});

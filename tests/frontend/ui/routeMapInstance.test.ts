import fs from 'node:fs';
import path from 'node:path';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

describe.each([
  ['web', 'src/components/maps/RouteMap.web.tsx'],
  ['native', 'src/components/maps/RouteMap.native.tsx'],
])('RouteMap.%s instanceId', (_name, rel) => {
  const source = read(rel);

  it('accepts an optional instanceId prop that defaults to main', () => {
    expect(source).toMatch(/instanceId\s*=\s*['"]main['"]/);
    expect(source).toMatch(/instanceId\?:\s*string/);
  });

  it('registers its controller and snapshot provider under instanceId', () => {
    expect(source).toMatch(/setMapController\([\s\S]*?\}\s*,\s*instanceId\);/);
    expect(source).toMatch(/setMapSnapshotProvider\([\s\S]*?\}\s*,\s*instanceId\);/);
  });

  it('clears its own registrations under instanceId on unmount', () => {
    expect(source).toContain('return () => setMapController(null, instanceId);');
    expect(source).toContain('return () => setMapSnapshotProvider(null, instanceId);');
  });
});

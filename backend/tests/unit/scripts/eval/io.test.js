const fs = require('fs');
const os = require('os');
const path = require('path');
const { streamWays, streamLamps } = require('../../../../scripts/eval/lib/io');

const BBOX = { south: 50.3, west: -4.25, north: 50.46, east: -4.0 };

function writeTemp(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-io-'));
  const file = path.join(dir, 'data.jsonl');
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  return { dir, file };
}

describe('streamWays / streamLamps', () => {
  let tmp;
  afterEach(() => {
    if (tmp) fs.rmSync(tmp.dir, { recursive: true, force: true });
    tmp = null;
  });

  test('streams only ways whose bbox overlaps the study area', async () => {
    tmp = writeTemp([
      '{"type":"way","id":1,"nodes":[],"tags":{"highway":"footway"},"bbox":{"minLon":-4.1,"minLat":50.4,"maxLon":-4.09,"maxLat":50.41}}',
      '{"type":"way","id":2,"nodes":[],"tags":{"highway":"footway"},"bbox":{"minLon":-1.0,"minLat":51.4,"maxLon":-0.9,"maxLat":51.41}}',
      '{"type":"node","id":3,"lat":50.4,"lon":-4.1,"tags":{"amenity":"bench"}}',
    ]);
    const ids = [];
    const stats = await streamWays(tmp.file, { bbox: BBOX, onWay: (w) => ids.push(w.id) });
    expect(ids).toEqual([1]);
    expect(stats.lines).toBe(3);
    expect(stats.ways).toBe(1);
  });

  test('streams street lamps inside the study area and ignores other nodes', async () => {
    tmp = writeTemp([
      '{"type":"node","id":10,"lat":50.4,"lon":-4.1,"tags":{"highway":"street_lamp"}}',
      '{"type":"node","id":11,"lat":51.4,"lon":-0.9,"tags":{"highway":"street_lamp"}}',
      '{"type":"node","id":12,"lat":50.41,"lon":-4.12,"tags":{"highway":"bus_stop"}}',
    ]);
    const lamps = [];
    await streamLamps(tmp.file, { bbox: BBOX, onLamp: (l) => lamps.push(l) });
    expect(lamps).toEqual([{ lat: 50.4, lng: -4.1 }]);
  });
});

import fs from 'node:fs';
import path from 'node:path';

describe('Expo template modal route (T-47)', () => {
  it('app/modal.tsx developer placeholder route is removed', () => {
    expect(fs.existsSync(path.join(process.cwd(), 'app/modal.tsx'))).toBe(false);
  });
});

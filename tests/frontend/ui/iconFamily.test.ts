import { PLACE_PRESETS } from '@/src/hooks/useSavedPlaces';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

describe('round button icon family', () => {
  it('uses the solid icons for every place preset, matching the add and list icons', () => {
    for (const preset of PLACE_PRESETS) {
      expect(preset.icon.endsWith('-outline')).toBe(false);
    }
  });
});

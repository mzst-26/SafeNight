import { getMapController, setMapController, type MapController } from '@/src/services/mapController';

const makeController = (): MapController => ({
  panTo: jest.fn(),
  zoomBy: jest.fn(),
  fitBounds: jest.fn(),
  highlight: jest.fn(() => true),
});

afterEach(() => {
  setMapController(null);
});

describe('mapController registry', () => {
  test('is empty until a map registers', () => {
    expect(getMapController()).toBeNull();
  });

  test('returns the controller a mounted map registered', () => {
    const controller = makeController();
    setMapController(controller);
    expect(getMapController()).toBe(controller);
  });

  test('is cleared when the map unmounts (null)', () => {
    setMapController(makeController());
    setMapController(null);
    expect(getMapController()).toBeNull();
  });

  test('a later map replaces the earlier one', () => {
    const first = makeController();
    const second = makeController();
    setMapController(first);
    setMapController(second);
    expect(getMapController()).toBe(second);
  });
});

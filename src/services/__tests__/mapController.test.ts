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

describe('named map controllers', () => {
  afterEach(() => {
    setMapController(null, 'agent');
    setMapController(null, 'main');
  });

  test("the 'agent' controller is empty until its map registers", () => {
    expect(getMapController('agent')).toBeNull();
  });

  test("'agent' and 'main' do not overwrite each other", () => {
    const main = makeController();
    const agent = makeController();
    setMapController(main);
    setMapController(agent, 'agent');
    expect(getMapController()).toBe(main);
    expect(getMapController('agent')).toBe(agent);
  });

  test("clearing 'agent' leaves 'main' registered", () => {
    const main = makeController();
    setMapController(main);
    setMapController(makeController(), 'agent');
    setMapController(null, 'agent');
    expect(getMapController('agent')).toBeNull();
    expect(getMapController()).toBe(main);
  });
});

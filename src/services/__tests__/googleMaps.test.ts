import { AppError } from '@/src/types/errors';

import {
  fetchPlaceDetails,
  fetchPlacePredictions,
} from '@/src/services/googleMaps';

const jsonResponse = (body: unknown) => ({
  ok: true,
  headers: {
    get: (name: string) => (String(name).toLowerCase() === 'content-type' ? 'application/json' : null),
  },
  text: async () => JSON.stringify(body),
} as Response);

const xmlResponse = (body: string) => ({
  ok: true,
  headers: {
    get: (name: string) => (String(name).toLowerCase() === 'content-type' ? 'text/xml; charset=utf-8' : null),
  },
  text: async () => body,
} as Response);

describe('googleMaps service', () => {
  beforeEach(() => {
    jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns no predictions for blank input', async () => {
    await expect(fetchPlacePredictions('   ')).resolves.toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('maps autocomplete JSON into place predictions', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse({
        status: 'OK',
        predictions: [
          {
            place_id: 'abc123',
            description: 'Plymouth, UK',
            structured_formatting: {
              main_text: 'Plymouth',
              secondary_text: 'Devon, UK',
            },
          },
        ],
      }),
    );

    const places = await fetchPlacePredictions('plymouth');

    expect(places).toHaveLength(1);
    expect(places[0].placeId).toBe('abc123');
    expect(places[0].primaryText).toBe('Plymouth');
  });

  it('throws AppError when autocomplete returns XML', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      xmlResponse('<?xml version="1.0" encoding="UTF-8"?><error>rate limit</error>'),
    );

    const promise = fetchPlacePredictions('plymouth');
    await expect(promise).rejects.toBeInstanceOf(AppError);
    await expect(promise).rejects.toThrow('Google Maps response was not JSON');
  });

  it('throws AppError when details response is empty', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      headers: {
        get: (name: string) => (String(name).toLowerCase() === 'content-type' ? 'application/json' : null),
      },
      text: async () => '   ',
    } as Response);

    const promise = fetchPlaceDetails('abc123');
    await expect(promise).rejects.toBeInstanceOf(AppError);
    await expect(promise).rejects.toThrow('Google Maps response was empty');
  });

  it('maps details JSON into place details', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse({
        status: 'OK',
        result: {
          place_id: 'abc123',
          name: 'Plymouth Railway Station',
          geometry: {
            location: {
              lat: 50.377,
              lng: -4.143,
            },
          },
        },
      }),
    );

    const details = await fetchPlaceDetails('abc123');

    expect(details.placeId).toBe('abc123');
    expect(details.location.latitude).toBeCloseTo(50.377);
  });
});
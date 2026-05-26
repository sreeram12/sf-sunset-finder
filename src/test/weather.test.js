import { describe, it, expect } from 'vitest';
import {
  SF_ZONES,
  getNearestZone,
  getCloudCoverForZone,
  getCloudCoverForVenue,
  getAverageHourly,
  getAverageCloudCover,
  getGOESImageUrls,
  cloudCoverInfo,
} from '../lib/weather';

// ---------------------------------------------------------------------------
// SF_ZONES
// ---------------------------------------------------------------------------
describe('SF_ZONES', () => {
  it('has 12 zones', () => {
    expect(SF_ZONES).toHaveLength(12);
  });

  it('every zone has id, name, lat, and lng', () => {
    for (const zone of SF_ZONES) {
      expect(zone.id).toBeTruthy();
      expect(zone.name).toBeTruthy();
      expect(typeof zone.lat).toBe('number');
      expect(typeof zone.lng).toBe('number');
    }
  });

  it('all lats are within SF bounds', () => {
    for (const zone of SF_ZONES) {
      expect(zone.lat).toBeGreaterThan(37.6);
      expect(zone.lat).toBeLessThan(37.9);
    }
  });

  it('all lngs are within SF bounds', () => {
    for (const zone of SF_ZONES) {
      expect(zone.lng).toBeGreaterThan(-122.55);
      expect(zone.lng).toBeLessThan(-122.35);
    }
  });
});

// ---------------------------------------------------------------------------
// getNearestZone
// ---------------------------------------------------------------------------
describe('getNearestZone', () => {
  it('returns outer_sunset for a point in the Outer Sunset', () => {
    const zone = getNearestZone(37.748, -122.500);
    expect(zone.id).toBe('outer_sunset');
  });

  it('returns mission for a point in the Mission District', () => {
    const zone = getNearestZone(37.760, -122.415);
    expect(zone.id).toBe('mission');
  });

  it('returns downtown for a point near the Financial District', () => {
    const zone = getNearestZone(37.793, -122.397);
    expect(zone.id).toBe('downtown');
  });

  it('always returns a zone (never undefined)', () => {
    const zone = getNearestZone(37.76, -122.42);
    expect(zone).toBeDefined();
    expect(zone.id).toBeTruthy();
  });

  it('returns the exact zone when coordinates match a zone center', () => {
    const missionZone = SF_ZONES.find(z => z.id === 'mission');
    const result = getNearestZone(missionZone.lat, missionZone.lng);
    expect(result.id).toBe('mission');
  });
});

// ---------------------------------------------------------------------------
// Shared fixture for zone-based functions
// ---------------------------------------------------------------------------
const makeZoneData = (overrides = {}) =>
  SF_ZONES.map(zone => ({
    zone,
    hourly: Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      cloudCover: overrides[zone.id]?.[h] ?? 50,
      visibility: 10000,
    })),
  }));

// ---------------------------------------------------------------------------
// getCloudCoverForZone
// ---------------------------------------------------------------------------
describe('getCloudCoverForZone', () => {
  it('returns null for null weatherZones', () => {
    expect(getCloudCoverForZone(null, 'mission', new Date())).toBeNull();
  });

  it('returns the correct cloud cover for a known zone and hour', () => {
    const data = makeZoneData({ mission: { 14: 30 } });
    const date = new Date();
    date.setHours(14, 0, 0, 0);
    expect(getCloudCoverForZone(data, 'mission', date)).toBe(30);
  });

  it('returns null for an unknown zone id', () => {
    const data = makeZoneData();
    expect(getCloudCoverForZone(data, 'nonexistent', new Date())).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getCloudCoverForVenue
// ---------------------------------------------------------------------------
describe('getCloudCoverForVenue', () => {
  it('returns null for null weatherZones', () => {
    expect(getCloudCoverForVenue(null, 37.76, -122.41, new Date())).toBeNull();
  });

  it('returns a cloud cover value for a valid SF venue location', () => {
    const data = makeZoneData();
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    const result = getCloudCoverForVenue(data, 37.76, -122.41, date);
    expect(typeof result).toBe('number');
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// getAverageHourly
// ---------------------------------------------------------------------------
describe('getAverageHourly', () => {
  it('returns null for null input', () => {
    expect(getAverageHourly(null)).toBeNull();
  });

  it('returns null for empty array', () => {
    expect(getAverageHourly([])).toBeNull();
  });

  it('returns 24 entries covering hours 0–23', () => {
    const result = getAverageHourly(makeZoneData());
    expect(result).toHaveLength(24);
    expect(result[0].hour).toBe(0);
    expect(result[23].hour).toBe(23);
  });

  it('returns correct average when all zones have the same value', () => {
    const result = getAverageHourly(makeZoneData()); // all zones → 50
    for (const { cloudCover } of result) {
      expect(cloudCover).toBe(50);
    }
  });

  it('correctly averages different values across zones', () => {
    // Two zones: one at 0, one at 100 → average should be 50
    const twoZones = [
      { zone: SF_ZONES[0], hourly: [{ hour: 6, cloudCover: 0,   visibility: null }] },
      { zone: SF_ZONES[1], hourly: [{ hour: 6, cloudCover: 100, visibility: null }] },
    ];
    const result = getAverageHourly(twoZones);
    const hour6 = result.find(h => h.hour === 6);
    expect(hour6.cloudCover).toBe(50);
  });

  it('returns entries sorted in ascending hour order', () => {
    const result = getAverageHourly(makeZoneData());
    for (let i = 1; i < result.length; i++) {
      expect(result[i].hour).toBeGreaterThan(result[i - 1].hour);
    }
  });
});

// ---------------------------------------------------------------------------
// getAverageCloudCover
// ---------------------------------------------------------------------------
describe('getAverageCloudCover', () => {
  it('returns null for null weatherZones', () => {
    expect(getAverageCloudCover(null, new Date())).toBeNull();
  });

  it('returns the city-average cloud cover for the current hour', () => {
    const data = makeZoneData({ mission: { 10: 80 } }); // overrides one zone at hour 10
    const date = new Date();
    date.setHours(10, 0, 0, 0);
    const result = getAverageCloudCover(data, date);
    // Most zones are 50, one is 80 → average slightly above 50
    expect(result).toBeGreaterThan(50);
    expect(result).toBeLessThan(80);
  });
});

// ---------------------------------------------------------------------------
// getGOESImageUrls
// ---------------------------------------------------------------------------
describe('getGOESImageUrls', () => {
  it('returns an array', () => {
    expect(Array.isArray(getGOESImageUrls())).toBe(true);
  });

  it('returns 21 candidate URLs (5 to 45 min in 2-min steps)', () => {
    expect(getGOESImageUrls()).toHaveLength(21);
  });

  it('all URLs point to the NOAA GOES-18 CDN', () => {
    for (const url of getGOESImageUrls()) {
      expect(url).toContain('cdn.star.nesdis.noaa.gov/GOES18');
    }
  });

  it('default resolution is 600x600', () => {
    for (const url of getGOESImageUrls()) {
      expect(url).toContain('600x600');
    }
  });

  it('respects a custom size parameter', () => {
    for (const url of getGOESImageUrls('1200x1200')) {
      expect(url).toContain('1200x1200');
    }
  });

  it('all URLs end with a .jpg extension', () => {
    for (const url of getGOESImageUrls()) {
      expect(url).toMatch(/\.jpg$/);
    }
  });
});

// ---------------------------------------------------------------------------
// cloudCoverInfo
// ---------------------------------------------------------------------------
describe('cloudCoverInfo', () => {
  it('returns null for null', () => {
    expect(cloudCoverInfo(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(cloudCoverInfo(undefined)).toBeNull();
  });

  it('returns Clear skies for 0%', () => {
    const info = cloudCoverInfo(0);
    expect(info.label).toBe('Clear skies');
    expect(info.emoji).toBe('☀️');
  });

  it('returns Mostly clear for 30%', () => {
    expect(cloudCoverInfo(30).label).toBe('Mostly clear');
  });

  it('returns Partly cloudy for 50%', () => {
    expect(cloudCoverInfo(50).label).toBe('Partly cloudy');
  });

  it('returns Mostly cloudy for 70%', () => {
    expect(cloudCoverInfo(70).label).toBe('Mostly cloudy');
  });

  it('returns Overcast for 100%', () => {
    const info = cloudCoverInfo(100);
    expect(info.label).toBe('Overcast');
    expect(info.emoji).toBe('☁️');
  });

  it('handles boundary values correctly', () => {
    expect(cloudCoverInfo(19).label).toBe('Clear skies');  // just below 20
    expect(cloudCoverInfo(20).label).toBe('Mostly clear'); // exactly 20
    expect(cloudCoverInfo(79).label).toBe('Mostly cloudy');
    expect(cloudCoverInfo(80).label).toBe('Overcast');
  });

  it('always returns a color string', () => {
    for (const pct of [0, 19, 20, 39, 40, 59, 60, 79, 80, 100]) {
      expect(cloudCoverInfo(pct).color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});

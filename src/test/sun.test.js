import { describe, it, expect } from 'vitest';
import { getSunPosition, getSunTimes, formatTime, minutesUntilSunset, SF_CENTER } from '../lib/sun';

// Fixed reference point: solar noon in SF on a summer solstice
const SUMMER_NOON   = new Date('2026-06-21T12:00:00-07:00'); // ~solar noon SF
const SUMMER_SUNSET = new Date('2026-06-21T20:35:00-07:00'); // approx sunset
const MIDNIGHT      = new Date('2026-06-21T00:00:00-07:00');

// ---------------------------------------------------------------------------
// SF_CENTER
// ---------------------------------------------------------------------------
describe('SF_CENTER', () => {
  it('is located in San Francisco', () => {
    expect(SF_CENTER.lat).toBeCloseTo(37.77, 1);
    expect(SF_CENTER.lng).toBeCloseTo(-122.42, 1);
  });
});

// ---------------------------------------------------------------------------
// getSunPosition
// ---------------------------------------------------------------------------
describe('getSunPosition', () => {
  it('returns azimuth and altitude', () => {
    const pos = getSunPosition(SUMMER_NOON, SF_CENTER.lat, SF_CENTER.lng);
    expect(typeof pos.azimuth).toBe('number');
    expect(typeof pos.altitude).toBe('number');
  });

  it('azimuth is in compass bearing range [0, 360)', () => {
    for (const date of [SUMMER_NOON, SUMMER_SUNSET, MIDNIGHT]) {
      const { azimuth } = getSunPosition(date, SF_CENTER.lat, SF_CENTER.lng);
      expect(azimuth).toBeGreaterThanOrEqual(0);
      expect(azimuth).toBeLessThan(360);
    }
  });

  it('altitude is in valid range [-90, 90]', () => {
    for (const date of [SUMMER_NOON, SUMMER_SUNSET, MIDNIGHT]) {
      const { altitude } = getSunPosition(date, SF_CENTER.lat, SF_CENTER.lng);
      expect(altitude).toBeGreaterThanOrEqual(-90);
      expect(altitude).toBeLessThanOrEqual(90);
    }
  });

  it('sun is above horizon at solar noon in SF in summer', () => {
    const { altitude } = getSunPosition(SUMMER_NOON, SF_CENTER.lat, SF_CENTER.lng);
    expect(altitude).toBeGreaterThan(0);
  });

  it('sun is below horizon at midnight in SF', () => {
    const { altitude } = getSunPosition(MIDNIGHT, SF_CENTER.lat, SF_CENTER.lng);
    expect(altitude).toBeLessThan(0);
  });

  it('azimuth is due south at true solar noon in SF (175–185°)', () => {
    // Clock noon ≠ solar noon. Use getSunTimes to get the actual transit time.
    const { solarNoon } = getSunTimes(SUMMER_NOON, SF_CENTER.lat, SF_CENTER.lng);
    const { azimuth } = getSunPosition(solarNoon, SF_CENTER.lat, SF_CENTER.lng);
    expect(azimuth).toBeGreaterThan(175);
    expect(azimuth).toBeLessThan(185);
  });

  it('azimuth is westward at sunset (240–310°)', () => {
    const { azimuth } = getSunPosition(SUMMER_SUNSET, SF_CENTER.lat, SF_CENTER.lng);
    expect(azimuth).toBeGreaterThan(240);
    expect(azimuth).toBeLessThan(310);
  });

  it('defaults to SF center when no coordinates are given', () => {
    const withDefaults = getSunPosition(SUMMER_NOON);
    const explicit     = getSunPosition(SUMMER_NOON, SF_CENTER.lat, SF_CENTER.lng);
    expect(withDefaults.azimuth).toBeCloseTo(explicit.azimuth, 5);
    expect(withDefaults.altitude).toBeCloseTo(explicit.altitude, 5);
  });
});

// ---------------------------------------------------------------------------
// getSunTimes
// ---------------------------------------------------------------------------
describe('getSunTimes', () => {
  it('returns an object with sunrise, sunset, goldenHour, and dusk', () => {
    const times = getSunTimes(SUMMER_NOON, SF_CENTER.lat, SF_CENTER.lng);
    expect(times.sunrise).toBeInstanceOf(Date);
    expect(times.sunset).toBeInstanceOf(Date);
    expect(times.goldenHour).toBeInstanceOf(Date);
    expect(times.dusk).toBeInstanceOf(Date);
  });

  it('sunrise is before sunset on the same calendar day', () => {
    const times = getSunTimes(SUMMER_NOON, SF_CENTER.lat, SF_CENTER.lng);
    expect(times.sunrise.getTime()).toBeLessThan(times.sunset.getTime());
  });

  it('golden hour starts before sunset', () => {
    const times = getSunTimes(SUMMER_NOON, SF_CENTER.lat, SF_CENTER.lng);
    expect(times.goldenHour.getTime()).toBeLessThan(times.sunset.getTime());
  });

  it('dusk is after sunset', () => {
    const times = getSunTimes(SUMMER_NOON, SF_CENTER.lat, SF_CENTER.lng);
    expect(times.dusk.getTime()).toBeGreaterThan(times.sunset.getTime());
  });
});

// ---------------------------------------------------------------------------
// formatTime
// ---------------------------------------------------------------------------
describe('formatTime', () => {
  it('returns a string', () => {
    expect(typeof formatTime(SUMMER_NOON)).toBe('string');
  });

  it('includes AM or PM', () => {
    const formatted = formatTime(SUMMER_NOON);
    expect(formatted).toMatch(/AM|PM/);
  });

  it('formats a known afternoon time correctly', () => {
    // 5:30 PM Pacific
    const date = new Date('2026-06-21T17:30:00-07:00');
    expect(formatTime(date)).toBe('5:30 PM');
  });

  it('formats a known morning time correctly', () => {
    // 7:05 AM Pacific
    const date = new Date('2026-06-21T07:05:00-07:00');
    expect(formatTime(date)).toBe('7:05 AM');
  });

  it('formats midnight as 12:00 AM', () => {
    const date = new Date('2026-06-21T00:00:00-07:00');
    expect(formatTime(date)).toBe('12:00 AM');
  });

  it('formats noon as 12:00 PM', () => {
    const date = new Date('2026-06-21T12:00:00-07:00');
    expect(formatTime(date)).toBe('12:00 PM');
  });
});

// ---------------------------------------------------------------------------
// minutesUntilSunset
// ---------------------------------------------------------------------------
describe('minutesUntilSunset', () => {
  it('returns a number', () => {
    expect(typeof minutesUntilSunset(SUMMER_NOON)).toBe('number');
  });

  it('returns a positive number when called well before sunset', () => {
    const morningTime = new Date('2026-06-21T08:00:00-07:00');
    expect(minutesUntilSunset(morningTime)).toBeGreaterThan(0);
  });

  it('returns a negative number when called after sunset', () => {
    const nightTime = new Date('2026-06-21T22:00:00-07:00');
    expect(minutesUntilSunset(nightTime)).toBeLessThan(0);
  });

  it('returns approximately 0 near sunset time', () => {
    // Use getSunTimes to find the exact sunset, then check we're close to 0
    const times = getSunTimes(SUMMER_SUNSET, SF_CENTER.lat, SF_CENTER.lng);
    const minutesAtSunset = minutesUntilSunset(times.sunset);
    expect(Math.abs(minutesAtSunset)).toBeLessThanOrEqual(1);
  });
});

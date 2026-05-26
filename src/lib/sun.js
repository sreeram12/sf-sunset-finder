import SunCalc from 'suncalc';

/** Geographic center of San Francisco used as the default coordinate for all sun calculations. */
export const SF_CENTER = { lat: 37.7749, lng: -122.4194 };

/**
 * Returns the sun's current azimuth and altitude for a given position and time.
 *
 * Azimuth is converted from SunCalc's south-origin convention to a standard
 * compass bearing (0 = North, 90 = East, 180 = South, 270 = West) so it can
 * be used directly with Mapbox bearings and Turf.js destination calls.
 *
 * @param {Date} date - The moment in time to evaluate.
 * @param {number} [lat] - Latitude in decimal degrees. Defaults to SF center.
 * @param {number} [lng] - Longitude in decimal degrees. Defaults to SF center.
 * @returns {{ azimuth: number, altitude: number }}
 *   `azimuth` in compass degrees [0, 360); `altitude` in degrees above horizon (negative = below).
 */
export function getSunPosition(date, lat = SF_CENTER.lat, lng = SF_CENTER.lng) {
  const pos = SunCalc.getPosition(date, lat, lng);
  // SunCalc azimuth: 0=south, measured toward west. Convert to compass bearing (0=N, 90=E).
  const azimuth = ((pos.azimuth * 180) / Math.PI + 180) % 360;
  const altitude = (pos.altitude * 180) / Math.PI;
  return { azimuth, altitude };
}

/**
 * Returns SunCalc's full set of solar event times for the given date and location.
 *
 * Useful keys: `sunrise`, `sunset`, `goldenHour`, `goldenHourEnd`, `solarNoon`, `dusk`.
 *
 * @param {Date} date
 * @param {number} [lat]
 * @param {number} [lng]
 * @returns {SunCalc.GetTimesResult}
 */
export function getSunTimes(date, lat = SF_CENTER.lat, lng = SF_CENTER.lng) {
  return SunCalc.getTimes(date, lat, lng);
}

/**
 * Formats a Date as a human-readable time string in the America/Los_Angeles timezone.
 * Example output: "7:42 PM"
 *
 * @param {Date} date
 * @returns {string}
 */
export function formatTime(date) {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Los_Angeles',
  });
}

/**
 * Returns a string describing the current phase of the solar day.
 *
 * Phases in order: `'predawn'` → `'morning-golden'` → `'morning'` →
 * `'afternoon'` → `'golden'` → `'dusk'` → `'night'`
 *
 * @param {Date} date
 * @param {number} [lat]
 * @param {number} [lng]
 * @returns {string}
 */
export function getSunPhase(date, lat = SF_CENTER.lat, lng = SF_CENTER.lng) {
  const times = SunCalc.getTimes(date, lat, lng);
  if (date < times.sunrise) return 'predawn';
  if (date < times.goldenHourEnd) return 'morning-golden';
  if (date < times.solarNoon) return 'morning';
  if (date < times.goldenHour) return 'afternoon';
  if (date < times.sunset) return 'golden';
  if (date < times.dusk) return 'dusk';
  return 'night';
}

/**
 * Returns the number of minutes until sunset, rounded to the nearest minute.
 * Negative values mean sunset has already passed.
 *
 * @param {Date} date
 * @param {number} [lat]
 * @param {number} [lng]
 * @returns {number}
 */
export function minutesUntilSunset(date, lat = SF_CENTER.lat, lng = SF_CENTER.lng) {
  const times = SunCalc.getTimes(date, lat, lng);
  return Math.round((times.sunset.getTime() - date.getTime()) / 60000);
}

import React from 'react';
import { getSunTimes, formatTime, SF_CENTER } from '../lib/sun';
import { getAverageCloudCover, cloudCoverInfo } from '../lib/weather';
import SunCalc from 'suncalc';

function getSFSunTimes(date) {
  // Build a Date representing noon on SF's current local calendar day,
  // so SunCalc always gets the right date regardless of the user's system timezone.
  const sfStr = date.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' });
  const [m, d, y] = sfStr.split('/');
  // Noon UTC on the SF date — the exact hour doesn't affect sunrise/sunset output
  const sfNoon = new Date(`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}T20:00:00.000Z`);
  return SunCalc.getTimes(sfNoon, SF_CENTER.lat, SF_CENTER.lng);
}

/**
 * Time-of-day scrubber spanning from sunrise to civil dusk (sun 6° below
 * horizon — the last moment of meaningful light, matching the scoring
 * algorithm's "night" threshold).
 *
 * The slider range is fixed to the current SF calendar day so dragging never
 * creates a feedback loop between the time prop and the range endpoints.
 *
 * The NOW button clamps to [sunrise, dusk] and relabels itself contextually:
 * "Dawn" before sunrise, "NOW" during the day, "Last light" after dusk.
 *
 * When `weatherZones` is provided, a weather emoji appears in the time pill
 * and a note below the labels confirms that cloud cover is already factored
 * into all venue scores.
 *
 * @param {Object}      props
 * @param {Date}        props.time             - Currently selected time, controlled by parent.
 * @param {Function}    props.onChange         - Called with a new `Date` as the user drags.
 * @param {Array|null}  props.weatherZones     - Multi-zone data from fetchSFWeather(), or null.
 * @param {Date|null}   props.weatherUpdatedAt - Timestamp of the last successful weather fetch;
 *                                              shown in the note so users know how fresh the data is.
 */
export default React.memo(function TimeSlider({ time, onChange, weatherZones, weatherUpdatedAt }) {
  const times = getSFSunTimes(time);
  // City-wide average cloud cover for the time-pill emoji — zone detail is in VenuePanel
  const currentWeather = cloudCoverInfo(getAverageCloudCover(weatherZones, time));

  // Range: sunrise → civil dusk. Fixed to the day, never derived from `time`.
  const startMs  = times.sunrise.getTime();
  const endMs    = times.dusk.getTime();
  const range    = endMs - startMs;

  const goldenMs = times.goldenHour.getTime();
  const sunsetMs = times.sunset.getTime();
  const duskMs   = times.dusk.getTime();

  const pct       = Math.max(0, Math.min(100, ((time.getTime() - startMs) / range) * 100));
  const goldenPct = Math.max(0, Math.min(100, ((goldenMs - startMs) / range) * 100));
  const sunsetPct = Math.max(0, Math.min(100, ((sunsetMs - startMs) / range) * 100));

  const isGolden = time.getTime() >= goldenMs && time.getTime() <= sunsetMs;

  // NOW button: clamp real time to the slider range and label accordingly
  const nowMs    = Date.now();
  const nowLabel = nowMs < startMs ? 'Dawn' : nowMs > duskMs ? 'Last light' : 'NOW';
  const nowTime  = new Date(Math.max(startMs, Math.min(duskMs, nowMs)));

  function handleInput(e) {
    const ratio = parseFloat(e.target.value) / 100;
    onChange(new Date(startMs + ratio * range));
  }

  return (
    <div className="absolute bottom-0 left-0 right-0 z-10 pointer-events-none">
      <div className="pointer-events-auto bg-gradient-to-t from-black via-black/85 to-transparent pt-8 pb-6 md:pb-5 px-5" style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}>
        <div className="max-w-2xl mx-auto">

          {/* Time pill */}
          <div className="text-center mb-4">
            <div className="select-none inline-flex items-center gap-2 bg-gray-900/80 border border-gray-700 rounded-full px-4 py-1.5">
              {isGolden && (
                <span className="text-yellow-400 text-xs font-semibold animate-pulse">✨ Golden Hour</span>
              )}
              <span className="text-white font-bold text-xl tabular-nums tracking-tight">
                {formatTime(time)}
              </span>
              {currentWeather && (
                <span className="text-base" title={currentWeather.label}>{currentWeather.emoji}</span>
              )}
              <button
                onClick={() => onChange(nowTime)}
                className="px-3 py-1.5 min-h-[32px] flex items-center rounded-full bg-orange-500/20 border border-orange-500/40 text-orange-300 text-sm font-medium hover:bg-orange-500/30 transition-colors whitespace-nowrap"
              >
                {nowLabel}
              </button>
            </div>
          </div>

          {/* mx-2.5 padding = half thumb width, so thumb never clips outside track edges */}
          <div className="mx-2.5">
            {/* h-10 on mobile gives a 40px touch target; md:h-5 restores the compact desktop layout */}
            <div className="relative h-10 md:h-5">

              {/* Track */}
              <div className="absolute top-1/2 -translate-y-1/2 left-0 right-0 h-1.5 rounded-full bg-gray-700 overflow-hidden">
                <div
                  className="absolute h-full bg-gradient-to-r from-yellow-500/40 to-orange-500/50"
                  style={{ left: `${goldenPct}%`, width: `${Math.max(0, sunsetPct - goldenPct)}%` }}
                />
                <div
                  className="absolute h-full bg-gradient-to-r from-sky-400 via-yellow-400 to-orange-500"
                  style={{ width: `${pct}%` }}
                />
              </div>

              {/* Sunset tick — marks sunset within the dusk-capped range */}
              <div
                className="absolute top-1/2 w-px h-3 bg-orange-400/60 rounded-full pointer-events-none"
                style={{ left: `${sunsetPct}%`, transform: 'translateY(-50%)' }}
              />

              {/* Thumb */}
              <div
                className="absolute pointer-events-none w-6 h-6 rounded-full bg-white border-[3px] border-orange-400 shadow-lg shadow-orange-500/40"
                style={{ left: `${pct}%`, top: '50%', transform: 'translate(-50%, -50%)' }}
              />

              {/* Invisible native input — handles all dragging */}
              <input
                type="range"
                min="0"
                max="100"
                step="0.1"
                value={pct}
                onChange={handleInput}
                aria-label="Time of day"
                aria-valuetext={formatTime(time)}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
            </div>

            {/* Cloud note — explains the grey fog overlay on the map */}
            {weatherZones && (
              <p className="text-[9px] text-[#4b5563] mt-1.5 text-center">
                Cloud cover on map · scores include forecast
                {weatherUpdatedAt ? ` · updated ${formatTime(weatherUpdatedAt)}` : ''}
              </p>
            )}

            {/* Labels: sunrise | golden hour | dusk (right edge of range) */}
            <div className="flex justify-between text-xs text-gray-500 mt-1.5">
              <span>{formatTime(times.sunrise)}</span>
              <span className="text-yellow-500/90">golden {formatTime(times.goldenHour)}</span>
              <span className="text-orange-400/90">dusk {formatTime(times.dusk)}</span>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
});

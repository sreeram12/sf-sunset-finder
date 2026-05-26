import { useRef, useEffect, useState, memo } from 'react';
import { getSunTimes, formatTime } from '../lib/sun';
import { getScoreColor } from '../lib/viewshed';
import { SF_CENTER } from '../lib/sun';
import { getNearestZone, getCloudCoverForZone, cloudCoverInfo } from '../lib/weather';

const VENUE_EMOJIS = {
  cafe: '☕',
  restaurant: '🍽️',
  bar: '🍸',
  park: '🌿',
  viewpoint: '👁️',
  garden: '🌸',
  peak: '⛰️',
};

const QUALITY_TEXT = {
  excellent: 'Excellent',
  great: 'Great',
  good: 'Good',
  partial: 'Partial',
  blocked: 'Blocked',
  night: 'After sunset',
};

const DESCRIPTIONS = {
  excellent: 'Clear sightline toward the horizon — this is a prime sunset spot.',
  great: 'Very good view with minimal obstruction across the golden hour.',
  good: 'Decent sunset view with some buildings in the sightline but still worth visiting.',
  partial: 'Partial view between buildings — sky color will be visible even if the disc is not.',
  blocked: 'Surrounding buildings likely block direct sunset views from here.',
  night: 'The sun has already set for today.',
};

/**
 * Slide-in detail panel for the selected venue.
 *
 * On desktop (md+) it slides in from the left; on mobile it slides up from the bottom.
 * The panel node stays mounted so the CSS transition plays on both open and close.
 *
 * On mobile the panel uses z-20 (vs the TimeSlider's z-10) so it renders fully
 * above the slider gradient — without this the slider's dark gradient visually
 * covers the bottom of the panel, hiding the Directions link.
 *
 * @param {Object}       props
 * @param {boolean}      props.open         - Controls visibility. When false the panel animates out.
 * @param {Object|null}  props.venue        - The selected venue object, or null when nothing is selected.
 * @param {Date}         props.time         - Current time from the time slider, used for sunset countdowns.
 * @param {Array|null}   props.weatherZones - Multi-zone weather data from fetchSFWeather(), or null.
 *                                            Used to show neighbourhood-specific cloud cover.
 * @param {Function}     props.onClose      - Called when the user dismisses the panel.
 */
function VenuePanel({ open, venue, time, weatherZones, onClose }) {
  // If `open` is not explicitly provided, fall back to truthiness of venue
  // so existing callers without the `open` prop continue to work.
  const isOpen = open ?? !!venue;
  const closeRef = useRef(null);

  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  useEffect(() => {
    if (isOpen && closeRef.current) {
      const t = setTimeout(() => closeRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  const sunTimes = venue ? getSunTimes(time, SF_CENTER.lat, SF_CENTER.lng) : null;
  const nearestZone = venue ? getNearestZone(venue.lat, venue.lng) : null;
  const zoneCloud   = (venue && weatherZones) ? getCloudCoverForZone(weatherZones, nearestZone.id, time) : null;
  const zoneWeather = cloudCoverInfo(zoneCloud);
  const minsToSunset = sunTimes ? Math.round((sunTimes.sunset - time) / 60000) : 0;
  const minsToGolden = sunTimes ? Math.round((sunTimes.goldenHour - time) / 60000) : 0;

  const score = venue?.score ?? 0;
  const quality = venue?.quality ?? 'blocked';
  const scoreColor = getScoreColor(score);
  const emoji = VENUE_EMOJIS[venue?.amenity] ?? '📍';

  const directionsUrl = venue
    ? `https://www.google.com/maps/dir/?api=1&destination=${venue.lat},${venue.lng}`
    : '#';

  return (
    <div
      className="absolute left-0 right-0 bottom-0 md:left-4 md:top-20 md:right-auto md:bottom-auto md:w-72 z-20 md:z-10"
      style={{
        transform: isOpen
          ? 'translate(0, 0)'
          : isMobile
          ? 'translateY(110%)'
          : 'translateX(-110%)',
        transition: 'transform 300ms ease',
      }}
    >
      <div
        className="bg-[#0f0f19]/95 backdrop-blur-md border border-white/8 rounded-t-2xl md:rounded-2xl shadow-2xl overflow-hidden w-full max-h-[80vh] overflow-y-auto md:max-h-none md:overflow-visible"
        style={{
          ...(venue ? { borderLeft: `3px solid ${scoreColor}` } : {}),
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        {venue && (
        <div className="p-4">
          {/* Header */}
          <div className="flex items-start justify-between mb-3">
            <div className="flex-1 min-w-0 pr-2">
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-sm">{emoji}</span>
                <span className="text-[11px] text-[#6b7280] uppercase tracking-wider capitalize">
                  {venue.amenity}
                </span>
                {venue.outdoorSeating && (
                  <span className="text-[10px] bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded-full font-medium">
                    Outdoor
                  </span>
                )}
              </div>
              <h3 className="text-white font-bold text-base leading-snug truncate">
                {venue.name}
              </h3>
              {venue.address && (
                <p className="text-[#6b7280] text-xs mt-0.5 truncate">{venue.address}</p>
              )}
              {venue.cuisine && (
                <p className="text-[#6b7280] text-xs capitalize mt-0.5">
                  {venue.cuisine.replace(/_/g, ' ')}
                </p>
              )}
            </div>
            <button
              ref={closeRef}
              onClick={onClose}
              className="text-[#9ca3af] hover:text-white text-xl leading-none flex-shrink-0 mt-0.5 transition-colors p-1 -mr-1 rounded"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          {/* Score + quality badge */}
          <div className="flex items-center gap-3 mb-2">
            <div className="flex-shrink-0 text-center">
              <span
                className="text-4xl font-extrabold leading-none tabular-nums"
                style={{ color: scoreColor }}
              >
                {quality === 'night' ? '—' : score}
              </span>
              <div className="text-[10px] text-[#6b7280] mt-0.5">/ 100</div>
            </div>
            <div>
              <span
                className="text-xs font-semibold px-2 py-0.5 rounded-full"
                style={{
                  backgroundColor: `${scoreColor}33`,
                  color: scoreColor,
                }}
              >
                {QUALITY_TEXT[quality] ?? quality}
              </span>
              <div className="text-[#6b7280] text-xs mt-1.5">
                {minsToGolden > 0
                  ? `Golden hour in ${minsToGolden} min`
                  : minsToSunset > 0
                  ? `${minsToSunset} min until sunset`
                  : 'After sunset'}
              </div>
            </div>
          </div>

          {/* Full-width progress bar row — hidden at night */}
          {quality !== 'night' && (
            <div className="mb-3 h-1 w-full bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${score}%`, backgroundColor: scoreColor }}
              />
            </div>
          )}

          {/* Description */}
          <p className="text-[#6b7280] text-xs leading-relaxed border-t border-white/8 pt-3">
            {DESCRIPTIONS[quality] ?? DESCRIPTIONS.blocked}
          </p>

          {/* Neighbourhood weather */}
          {zoneWeather && (
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/8">
              <div className="flex items-center gap-1.5">
                <span className="text-sm leading-none">{zoneWeather.emoji}</span>
                <span className="text-xs text-white">{zoneWeather.label}</span>
              </div>
              <span className="text-[10px] text-[#6b7280]">{nearestZone.name} zone</span>
            </div>
          )}

          {/* Times row */}
          <div className="flex justify-between mt-3 pt-3 border-t border-white/8 text-xs">
            <div>
              <div className="text-[#6b7280] mb-0.5">Golden hour</div>
              <div className="text-[#FFD700] font-medium">{formatTime(sunTimes.goldenHour)}</div>
            </div>
            <div className="text-right">
              <div className="text-[#6b7280] mb-0.5">Sunset</div>
              <div className="text-[#FF6B35] font-medium">{formatTime(sunTimes.sunset)}</div>
            </div>
          </div>

          {/* Footer links */}
          <div className="flex items-center gap-3 mt-3 pt-3 border-t border-white/8">
            <a
              href={directionsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-[#FFAA00] hover:text-[#FFD700] transition-colors font-medium"
            >
              ↗ Directions
            </a>
            {venue.website && (
              <a
                href={venue.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[#6b7280] hover:text-white transition-colors ml-auto"
              >
                ↗ Website
              </a>
            )}
          </div>
        </div>
        )}
      </div>
    </div>
  );
}

export default memo(VenuePanel);

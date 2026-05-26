import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import MapView from './components/MapView';
import TimeSlider from './components/TimeSlider';
import VenuePanel from './components/VenuePanel';
import VenueList from './components/VenueList';
import Legend from './components/Legend';
import LoadingStatus from './components/LoadingStatus';
import { getSunPosition, getSunTimes, minutesUntilSunset, formatTime, SF_CENTER } from './lib/sun';
import { fetchSFWeather, getCloudCoverForVenue } from './lib/weather';
import { fetchVenues, fetchTallBuildings } from './lib/overpass';
import { computeBuildingBlockDeg, applyScoreFormula, prepareBuildingIndex, GREAT_SCORE_THRESHOLD } from './lib/viewshed';
import { preloadSFTerrain, computeTerrainBlockDeg, getElevation } from './lib/terrain';

const SCORE_BATCH          = 100;
const CLOCK_TICK_MS        = 30_000;    // how often the real-time clock tick fires
const CLOCK_SYNC_WINDOW_MS = 120_000;   // keep following real time when slider is within 2 min of now
const WEATHER_REFRESH_MS   = 30 * 60 * 1000; // re-fetch weather every 30 min

export default function App() {
  const [time, setTime] = useState(() => new Date());
  const [venues, setVenues] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [venueListOpen, setVenueListOpen] = useState(false);
  const [isRescoring, setIsRescoring] = useState(false);
  const [sliderTouched, setSliderTouched] = useState(false);
  const [loading, setLoading] = useState({ stage: '', venueCount: 0, scoredCount: 0, error: null });
  const [weatherZones, setWeatherZones] = useState(null);
  const [weatherUpdatedAt, setWeatherUpdatedAt] = useState(null);

  // Stable refs so async loops don't capture stale state
  const venuesRef = useRef([]);
  const buildingIndexRef = useRef([]);
  const cancelRef = useRef(false);
  const weatherZonesRef = useRef(null); // mirrors weatherZones state; readable in async scoring loops

  // Keep the ref in sync so scoring loops always read the latest weather data
  useEffect(() => { weatherZonesRef.current = weatherZones; }, [weatherZones]);
  // Cache of building-only block angles keyed by venue id — avoids re-running
  // expensive ray casting when the sun azimuth hasn't changed significantly.
  const buildingBlockCacheRef = useRef(new Map());
  const AZIMUTH_CACHE_THRESHOLD = 5; // degrees — sun moves ~15°/hr so this covers ~20 min real time

  const sunPos = useMemo(() => getSunPosition(time, SF_CENTER.lat, SF_CENTER.lng), [time]);
  const sunTimes = useMemo(() => getSunTimes(time, SF_CENTER.lat, SF_CENTER.lng), [time]);
  const isGolden = useMemo(() => time >= sunTimes.goldenHour && time <= sunTimes.sunset, [time, sunTimes]);
  const minsToSunset = useMemo(() => minutesUntilSunset(time), [time]);
  const sunIsUp = useMemo(() => sunPos.altitude > -6, [sunPos]);
  const goodSpots = useMemo(() => venues.filter(v => (v.score ?? 0) >= GREAT_SCORE_THRESHOLD).length, [venues]);
  // Derives per-zone cloud cover for the current slider hour and passes it to
  // MapView as GeoJSON point features. MapView renders them as blurred circles
  // so fogged-in zones get a soft sky-blue wash over the map background.
  const weatherZoneData = useMemo(() => {
    if (!weatherZones) return null;
    const hour = time.getHours();
    return weatherZones.map(({ zone, hourly }) => ({
      lat: zone.lat,
      lng: zone.lng,
      name: zone.name,
      cloudCover: hourly.find(h => h.hour === hour)?.cloudCover ?? 0,
    }));
  }, [weatherZones, time]);
  const selectedVenue = useMemo(() => venues.find(v => v.id === selectedId) ?? null, [venues, selectedId]);
  const allNight = useMemo(() =>
    venues.length > 0 && !loading.stage && venues.every(v => v.score !== null && v.quality === 'night'),
  [venues, loading.stage]);

  // Keep time ticking in real time when within 2 minutes of now
  useEffect(() => {
    const id = setInterval(() => {
      setTime(prev => {
        const now = new Date();
        return Math.abs(prev.getTime() - now.getTime()) < CLOCK_SYNC_WINDOW_MS ? now : prev;
      });
    }, CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, []);

  // Fetch weather on mount and refresh every 30 min (WEATHER_REFRESH_MS) so
  // long-running sessions stay current. fetchSFWeather() caches results in
  // localStorage and skips the network if the cache is less than 30 min old.
  useEffect(() => {
    const refresh = () =>
      fetchSFWeather()
        .then(data => { setWeatherZones(data); setWeatherUpdatedAt(new Date()); })
        .catch(e => console.warn('Weather unavailable — running without conditions data', e));
    refresh();
    const id = setInterval(refresh, WEATHER_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  // Initial data load
  useEffect(() => {
    cancelRef.current = false;

    async function load() {
      // --- Venues ---
      setLoading({ stage: 'Fetching cafes & restaurants from OpenStreetMap…', venueCount: 0, scoredCount: 0, error: null });
      let rawVenues;
      try {
        rawVenues = await fetchVenues();
      } catch (e) {
        console.error('Venue fetch failed', e);
        setLoading({ stage: '', venueCount: 0, scoredCount: 0, error: 'Failed to load venues. Check your connection.' });
        return;
      }
      if (cancelRef.current) return;

      const pending = rawVenues.map(v => ({ ...v, score: null, quality: null }));
      venuesRef.current = pending;
      setVenues([...pending]);
      setLoading({ stage: `Loaded ${rawVenues.length} venues — loading terrain & building data…`, venueCount: rawVenues.length, scoredCount: 0, error: null });

      // --- Terrain tiles + Buildings in parallel ---
      let buildings = [];
      await Promise.all([
        fetchTallBuildings()
          .then(b => { buildings = b; })
          .catch(e => console.warn('Building fetch failed — scores will use terrain only', e)),
        preloadSFTerrain()
          .catch(e => console.warn('Terrain fetch failed', e)),
      ]);
      if (cancelRef.current) return;

      const index = prepareBuildingIndex(buildings);
      buildingIndexRef.current = index;
      setLoading({ stage: `Scoring ${rawVenues.length} venues…`, venueCount: rawVenues.length, scoredCount: 0, error: null });

      // --- Score in batches to keep UI responsive ---
      const sunP = getSunPosition(new Date(), SF_CENTER.lat, SF_CENTER.lng);
      let done = 0;

      for (let i = 0; i < venuesRef.current.length; i += SCORE_BATCH) {
        if (cancelRef.current) return;
        const now = new Date();
        const slice = venuesRef.current.slice(i, i + SCORE_BATCH).map(v => {
          const terrainBlock = computeTerrainBlockDeg(v.lat, v.lng, sunP.azimuth);
          const buildingBlockDeg = computeBuildingBlockDeg(v.lat, v.lng, index, sunP.azimuth);
          buildingBlockCacheRef.current.set(v.id, { azimuth: sunP.azimuth, blockDeg: buildingBlockDeg });
          const cloudPct = getCloudCoverForVenue(weatherZonesRef.current, v.lat, v.lng, now) ?? 0;
          return { ...v, ...applyScoreFormula(buildingBlockDeg, terrainBlock, getElevation(v.lat, v.lng), sunP.altitude, cloudPct) };
        });

        venuesRef.current = [
          ...venuesRef.current.slice(0, i),
          ...slice,
          ...venuesRef.current.slice(i + SCORE_BATCH),
        ];

        done += slice.length;
        setLoading({ stage: `Scoring ${rawVenues.length} venues…`, venueCount: rawVenues.length, scoredCount: done, error: null });
        setVenues([...venuesRef.current]);

        await new Promise(r => setTimeout(r, 0)); // yield to browser
      }

      setLoading({ stage: '', venueCount: rawVenues.length, scoredCount: done, error: null });
    }

    load();
    return () => { cancelRef.current = true; };
  }, []);

  // Re-score when the slider moves or weather updates.
  //
  // Two paths:
  //   Fast — every venue has a valid cached building-block angle for the new
  //           sun azimuth. Run all 600 synchronously in one JS task (<5 ms),
  //           no debounce, no frame yielding. Covers the common case of small
  //           slider nudges or a weather refresh with the sun barely moved.
  //   Slow — at least one venue needs a full ray cast. Debounce 200 ms then
  //           batch across frames so the main thread never blocks.
  const rescoreTimer = useRef(null);
  const rescoringCancelRef = useRef(false);
  useEffect(() => {
    if (!venuesRef.current.length) return;
    clearTimeout(rescoreTimer.current);
    rescoringCancelRef.current = true;

    const sunP = getSunPosition(time, SF_CENTER.lat, SF_CENTER.lng);

    // Determine upfront whether every venue is a cache hit for this azimuth.
    const allCached = venuesRef.current.every(v => {
      const c = buildingBlockCacheRef.current.get(v.id);
      if (!c) return false;
      const diff = Math.abs(((sunP.azimuth - c.azimuth + 540) % 360) - 180);
      return diff < AZIMUTH_CACHE_THRESHOLD;
    });

    if (allCached) {
      // Fast path — synchronous, instant UI update, no "Updating…" flash.
      const snapshot = [...venuesRef.current];
      for (let i = 0; i < snapshot.length; i++) {
        const v = snapshot[i];
        const cached = buildingBlockCacheRef.current.get(v.id);
        const terrainBlock = computeTerrainBlockDeg(v.lat, v.lng, sunP.azimuth);
        const cloudPct = getCloudCoverForVenue(weatherZonesRef.current, v.lat, v.lng, time) ?? 0;
        snapshot[i] = { ...v, ...applyScoreFormula(cached.blockDeg, terrainBlock, getElevation(v.lat, v.lng), sunP.altitude, cloudPct) };
      }
      venuesRef.current = snapshot;
      setVenues([...snapshot]);
      setIsRescoring(false);
      return;
    }

    // Speculative immediate pass — run applyScoreFormula with whatever block
    // angles are already cached (even if stale) so rankings update visually
    // before the precise ray-cast finishes. Pure math, takes <5 ms.
    {
      const speculativeSnapshot = [...venuesRef.current];
      let hasAny = false;
      for (let i = 0; i < speculativeSnapshot.length; i++) {
        const c = buildingBlockCacheRef.current.get(speculativeSnapshot[i].id);
        if (!c) continue;
        hasAny = true;
        const v = speculativeSnapshot[i];
        const terrainBlock = computeTerrainBlockDeg(v.lat, v.lng, sunP.azimuth);
        const cloudPct = getCloudCoverForVenue(weatherZonesRef.current, v.lat, v.lng, time) ?? 0;
        speculativeSnapshot[i] = { ...v, ...applyScoreFormula(c.blockDeg, terrainBlock, getElevation(v.lat, v.lng), sunP.altitude, cloudPct) };
      }
      if (hasAny) setVenues([...speculativeSnapshot]);
    }

    // Precise pass — needs ray casting; debounce + batch to keep UI responsive.
    setIsRescoring(true);
    rescoreTimer.current = setTimeout(() => {
      rescoringCancelRef.current = false;
      const snapshot = [...venuesRef.current];
      let i = 0;

      function nextBatch() {
        if (rescoringCancelRef.current) return;
        const end = Math.min(i + SCORE_BATCH, snapshot.length);
        for (; i < end; i++) {
          const v = snapshot[i];
          const terrainBlock = computeTerrainBlockDeg(v.lat, v.lng, sunP.azimuth);
          const cached = buildingBlockCacheRef.current.get(v.id);
          const azDiff = cached
            ? Math.abs(((sunP.azimuth - cached.azimuth + 540) % 360) - 180)
            : Infinity;
          let buildingBlockDeg;
          if (azDiff < AZIMUTH_CACHE_THRESHOLD) {
            buildingBlockDeg = cached.blockDeg;
          } else {
            buildingBlockDeg = computeBuildingBlockDeg(v.lat, v.lng, buildingIndexRef.current, sunP.azimuth);
            buildingBlockCacheRef.current.set(v.id, { azimuth: sunP.azimuth, blockDeg: buildingBlockDeg });
          }
          const cloudPct = getCloudCoverForVenue(weatherZonesRef.current, v.lat, v.lng, time) ?? 0;
          snapshot[i] = { ...v, ...applyScoreFormula(buildingBlockDeg, terrainBlock, getElevation(v.lat, v.lng), sunP.altitude, cloudPct) };
        }
        setVenues([...snapshot]);
        if (i < snapshot.length) {
          setTimeout(nextBatch, 0);
        } else {
          venuesRef.current = snapshot;
          setIsRescoring(false);
        }
      }

      nextBatch();
    }, 200);
    return () => clearTimeout(rescoreTimer.current);
  }, [time, weatherZones]);

  const handleVenueClick = useCallback(id => {
    setSelectedId(prev => (prev === id ? null : id));
    setVenueListOpen(false);
  }, []);

  if (loading.error) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-[#09090f]">
        <div className="text-center p-8 max-w-sm">
          <p className="text-4xl mb-4">⚠️</p>
          <h2 className="text-white font-bold text-lg mb-2">Failed to load venues</h2>
          <p className="text-[#6b7280] text-sm">{loading.error}</p>
          <button onClick={() => window.location.reload()} aria-label="Retry loading venues" className="mt-4 px-4 py-2 bg-[#FF6B35]/20 border border-[#FF6B35]/40 text-[#FF6B35] rounded-lg text-sm hover:bg-[#FF6B35]/30 transition-colors">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-gray-950" style={{ height: '100dvh' }}>
      <MapView
        venues={venues}
        selectedVenueId={selectedId}
        selectedVenue={selectedVenue}
        onVenueClick={handleVenueClick}
        sunAzimuth={sunPos.azimuth}
        weatherZoneData={weatherZoneData}
      />

      {/* Header */}
      <header className="absolute top-0 left-0 right-0 z-10 pointer-events-none">
        <div className="px-5 pb-10 bg-gradient-to-b from-black/70 to-transparent" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 1rem)' }}>
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-white font-semibold text-lg tracking-tight leading-none">
                Sun Scout SF
              </h1>
              <p className="text-[#6b7280] text-xs mt-1">
                Best sun spots · {formatTime(time)}
              </p>
              {goodSpots > 0 && (
                <p className="text-[#6b7280] text-[10px] mt-0.5">
                  {goodSpots} great view{goodSpots !== 1 ? 's' : ''} right now
                </p>
              )}
            </div>
            <div className="flex flex-col items-end gap-1.5">
              {(() => { const isInitialScoring = loading.stage !== ''; return (
              <button
                onClick={() => !isInitialScoring && setVenueListOpen(v => !v)}
                disabled={isInitialScoring}
                className={`pointer-events-auto flex items-center gap-1.5 px-3 py-1.5 border text-xs font-medium rounded-full transition-all backdrop-blur-sm whitespace-nowrap ${
                  isInitialScoring
                    ? 'bg-white/5 border-white/8 text-white/40 cursor-not-allowed'
                    : 'bg-white/10 hover:bg-white/15 border-white/15 text-white cursor-pointer'
                }`}
                aria-label="Toggle best views list"
              >
                <span>☰</span>
                <span>Best Views</span>
              </button>
              ); })()}
              {isRescoring && (
                <div className="flex items-center gap-1 pointer-events-none">
                  <div className="w-1.5 h-1.5 border border-[#FFAA00] border-t-transparent rounded-full animate-spin" />
                  <span className="text-[10px] text-[#9ca3af]">Updating…</span>
                </div>
              )}
              {isGolden ? (
                <p className="text-[#FFD700] text-sm font-semibold animate-pulse">Golden Hour Now</p>
              ) : sunIsUp && minsToSunset > 0 ? (
                <p className="text-[#FF6B35] text-sm">Sunset in {minsToSunset} min</p>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      <VenuePanel
        open={!!selectedVenue}
        venue={selectedVenue}
        time={time}
        weatherZones={weatherZones}
        onClose={() => setSelectedId(null)}
      />

      <VenueList
        venues={venues}
        selectedId={selectedId}
        onVenueClick={handleVenueClick}
        isOpen={venueListOpen}
        onClose={() => setVenueListOpen(false)}
      />

      <Legend />

      <LoadingStatus
        stage={loading.stage}
        venueCount={loading.venueCount}
        scoredCount={loading.scoredCount}
      />

      {/* Night onboarding hint — shown to first-time visitors before they touch the slider */}
      {allNight && !sliderTouched && (
        <div className="absolute bottom-28 md:bottom-32 left-0 right-0 flex justify-center z-20 pointer-events-none">
          <div className="mx-6 bg-gray-900/95 backdrop-blur-sm border border-white/15 rounded-2xl px-5 py-3 text-center shadow-xl">
            <p className="text-white text-sm font-medium">🌙 It's after sunset</p>
            <p className="text-[#9ca3af] text-xs mt-1 leading-relaxed">
              Drag the slider left or tap <span className="text-orange-300 font-medium">Last light</span> to explore today's best spots
            </p>
          </div>
        </div>
      )}

      <TimeSlider
        time={time}
        onChange={t => { if (!sliderTouched) setSliderTouched(true); setTime(t); }}
        weatherZones={weatherZones}
        weatherUpdatedAt={weatherUpdatedAt}
      />
    </div>
  );
}

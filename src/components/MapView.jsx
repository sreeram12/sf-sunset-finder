import { useEffect, useRef, useState, memo } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { getScoreColor, UNSCORED_COLOR } from '../lib/viewshed';

const SF_CENTER = [-122.4194, 37.7749];

/**
 * Full-screen Mapbox GL map with scored venue dots, clustering, sun ray, and hover tooltip.
 *
 * Hover tooltips are built with DOM methods (textContent / setDOMContent) so
 * raw OSM venue names never reach innerHTML — XSS-safe by construction.
 *
 * @param {Object}      props
 * @param {Array}       props.venues          - Scored venue objects from App state.
 * @param {number|null} props.selectedVenueId - ID of the currently selected venue, or null.
 * @param {Object|null} props.selectedVenue   - Full venue object for the selected ID, or null.
 * @param {Function}    props.onVenueClick    - Called with a venue ID when a dot is clicked.
 * @param {number}      props.sunAzimuth      - Current sun compass bearing [0, 360) for the sun ray.
 * @param {Array|null}  props.weatherZoneData - Pre-computed cloud cover per zone from App state,
 *                                             keyed to the current slider hour. Each entry:
 *                                             { lat, lng, name, cloudCover: 0–100 }.
 */
function MapView({ venues, selectedVenueId, onVenueClick, sunAzimuth, selectedVenue, weatherZoneData }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const popupRef = useRef(null);
  const markerRef = useRef(null);
  const selectedVenueIdRef = useRef(selectedVenueId);
  const sunRayUpdateRef = useRef(null); // latest ray-draw fn, called on map move
  const [mapReady, setMapReady] = useState(false);

  const token = import.meta.env.VITE_MAPBOX_TOKEN;

  useEffect(() => {
    selectedVenueIdRef.current = selectedVenueId;
  }, [selectedVenueId]);

  useEffect(() => {
    if (!containerRef.current || !token) return;

    mapboxgl.accessToken = token;
    const isMobileDevice = window.innerWidth < 768;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: SF_CENTER,
      zoom: 12.5,
      pitch: isMobileDevice ? 35 : 55,   // lower tilt on small screens
      bearing: -10,
      antialias: true,
    });

    // Inject popup CSS reset once — removes the default white Mapbox popup chrome
    if (!document.getElementById('venue-popup-style')) {
      const s = document.createElement('style');
      s.id = 'venue-popup-style';
      s.textContent = `
        .venue-tooltip .mapboxgl-popup-content {
          background: transparent;
          padding: 0;
          box-shadow: none;
          border-radius: 0;
        }
        .venue-tooltip .mapboxgl-popup-tip { display: none; }
      `;
      document.head.appendChild(s);
    }

    // Create a single popup instance for hover tooltips
    const popup = new mapboxgl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 12,
      className: 'venue-tooltip',
    });
    popupRef.current = popup;

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
    // On mobile, pinch-to-zoom replaces the nav controls and they'd overlap the header.
    // On desktop, push them below the Best Views button row.
    const navCtrl = containerRef.current.querySelector('.mapboxgl-ctrl-top-right');
    if (navCtrl) {
      if (window.innerWidth < 768) {
        navCtrl.style.display = 'none';
      } else {
        navCtrl.style.top = '90px';
      }
    }

    map.on('load', () => {
      // Terrain elevation source (same data we decode for scoring)
      map.addSource('mapbox-dem', {
        type: 'raster-dem',
        url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
        tileSize: 512,
        maxzoom: 14,
      });
      map.setTerrain({ source: 'mapbox-dem', exaggeration: isMobileDevice ? 1.0 : 1.6 });

      // Hillshade layer — makes SF's hills immediately obvious on the dark map
      map.addLayer({
        id: 'hillshade',
        type: 'hillshade',
        source: 'mapbox-dem',
        paint: {
          'hillshade-exaggeration': 0.5,
          'hillshade-illumination-direction': 275,
          'hillshade-shadow-color': '#000000',
          'hillshade-highlight-color': '#3b4a5a',
        },
      });

      // Sky layer so the horizon looks realistic with 3D terrain
      map.addLayer({
        id: 'sky',
        type: 'sky',
        paint: {
          'sky-type': 'atmosphere',
          'sky-atmosphere-sun': [0, 90],
          'sky-atmosphere-sun-intensity': 5,
        },
      });

      // 3D building extrusions from Mapbox's vector tiles
      map.addLayer({
        id: '3d-buildings',
        source: 'composite',
        'source-layer': 'building',
        filter: ['==', 'extrude', 'true'],
        type: 'fill-extrusion',
        minzoom: 12,
        paint: {
          'fill-extrusion-color': '#1a2535',
          'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 12, 0, 12.05, ['get', 'height']],
          'fill-extrusion-base': ['get', 'min_height'],
          'fill-extrusion-opacity': 0.75,
        },
      });

      // Sun direction ray
      map.addSource('sun-ray', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      // Wide, soft glow behind the crisp line — gives the "sunbeam" effect
      map.addLayer({
        id: 'sun-ray-glow',
        type: 'line',
        source: 'sun-ray',
        paint: {
          'line-color': '#FBBF24',
          'line-width': 12,
          'line-opacity': 0.14,
        },
      });
      // Crisp dashed core — reads clearly as a directional indicator
      map.addLayer({
        id: 'sun-ray-layer',
        type: 'line',
        source: 'sun-ray',
        paint: {
          'line-color': '#FFF7C2',
          'line-width': 2.5,
          'line-opacity': 0.82,
          'line-dasharray': [8, 4],
        },
      });

      // Cloud cover overlay — one blurred circle per SF microclimate zone.
      // Circles are invisible at < 20% cloud cover and ramp up to a soft
      // sky-blue wash at full overcast, giving a fog-gradient feel on the map.
      // Inserted below venue layers so dots remain the primary visual.
      map.addSource('weather-zones', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'weather-zones-layer',
        type: 'circle',
        source: 'weather-zones',
        paint: {
          // Radius scales with zoom so each circle covers roughly its neighbourhood
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 45, 13, 140],
          // Near-white fog veil: real fog is white/light, so a white overlay on
          // the dark map reads as fog rather than just dimming. Invisible at < 20%
          // cloud cover; builds to a visible haze at heavy overcast.
          'circle-color': '#f1f5f9', // slate-100 — near-white, visually distinct from dark map
          'circle-opacity': [
            'interpolate', ['linear'], ['get', 'cloudCover'],
            0,   0,
            20,  0,
            40,  0.08,
            70,  0.18,
            100, 0.26,
          ],
          'circle-blur': 1.5, // soft edge so the overlay blends rather than stamps
        },
      });

      // Venues + parks source — clustering enabled below zoom 12
      map.addSource('venues', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        cluster: true,
        clusterMaxZoom: 11,
        clusterRadius: 40,
      });

      // Cluster bubble
      map.addLayer({
        id: 'venues-cluster',
        type: 'circle',
        source: 'venues',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': ['step', ['get', 'point_count'], '#3B4268', 10, '#506070', 30, '#94A3B8'],
          'circle-radius': ['step', ['get', 'point_count'], 18, 10, 22, 30, 28],
          'circle-opacity': 0.85,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': 'rgba(255,255,255,0.15)',
        },
      });
      // Cluster count label
      map.addLayer({
        id: 'venues-cluster-count',
        type: 'symbol',
        source: 'venues',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': '{point_count_abbreviated}',
          'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
          'text-size': 11,
        },
        paint: { 'text-color': '#ffffff' },
      });

      // Glow halo — only unclustered points
      map.addLayer({
        id: 'venues-halo',
        type: 'circle',
        source: 'venues',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 6, 14, 14],
          'circle-color': ['get', 'color'],
          'circle-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.10, 14, 0.18],
          'circle-blur': 1,
        },
      });
      // Core dot — parks slightly larger than venue dots; selected gets +3 radius
      map.addLayer({
        id: 'venues-dot',
        type: 'circle',
        source: 'venues',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            11, ['+', ['case', ['==', ['get', 'type'], 'park'], 6, 4], ['case', ['get', 'selected'], 3, 0]],
            15, ['+', ['case', ['==', ['get', 'type'], 'park'], 12, 9], ['case', ['get', 'selected'], 3, 0]],
          ],
          'circle-color': ['get', 'color'],
          'circle-stroke-width': [
            'case',
            ['get', 'selected'], 2.5,
            ['==', ['get', 'type'], 'park'], 1.5,
            0.6,
          ],
          'circle-stroke-color': [
            'case',
            ['get', 'selected'], '#FBBF24',
            ['==', ['get', 'type'], 'park'], '#4ade80',
            'rgba(255,255,255,0.25)',
          ],
          'circle-opacity': 0.95,
        },
      });

      // Click cluster → zoom in to expand
      map.on('click', 'venues-cluster', e => {
        const [feature] = map.queryRenderedFeatures(e.point, { layers: ['venues-cluster'] });
        map.getSource('venues').getClusterExpansionZoom(feature.properties.cluster_id, (err, zoom) => {
          if (err) { console.warn('Cluster expansion failed', err); return; }
          map.easeTo({ center: feature.geometry.coordinates, zoom });
        });
      });
      map.on('mouseenter', 'venues-cluster', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'venues-cluster', () => { map.getCanvas().style.cursor = ''; });

      map.on('click', 'venues-dot', e => {
        const id = Number(e.features[0].properties.id);
        onVenueClick(id);
        // flyTo is handled by the selectedVenueId effect below, which covers
        // both map-click and list-click selection paths.
      });

      map.on('mouseenter', 'venues-dot', e => {
        map.getCanvas().style.cursor = 'pointer';
        const feature = e.features[0];
        const featureId = Number(feature.properties.id);
        // Don't show tooltip for the already-selected venue
        if (featureId === selectedVenueIdRef.current) return;

        if (!feature.properties) return;
        const { name, score, color, quality } = feature.properties;
        const displayScore = score !== null && score !== undefined ? score : null;

        // Build tooltip with DOM methods — never interpolate OSM text into HTML
        const card = document.createElement('div');
        card.style.cssText = 'background:#0f0f19;border:1px solid rgba(255,255,255,0.12);border-radius:10px;padding:8px 12px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;min-width:130px;box-shadow:0 4px 20px rgba(0,0,0,0.6)';

        const nameEl = document.createElement('div');
        nameEl.style.cssText = 'color:#fff;font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px;margin-bottom:5px';
        nameEl.textContent = name;

        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:6px';

        const scoreEl = document.createElement('span');
        scoreEl.style.cssText = `color:${color};font-size:18px;font-weight:800;line-height:1`;
        scoreEl.textContent = displayScore ?? '—';

        const outOf = document.createElement('span');
        outOf.style.cssText = 'font-size:10px;color:#6b7280';
        outOf.textContent = '/100';

        row.appendChild(scoreEl);
        row.appendChild(outOf);

        if (quality) {
          const badge = document.createElement('span');
          badge.style.cssText = `font-size:9px;font-weight:600;background:${color}26;color:${color};padding:1px 6px;border-radius:10px;text-transform:capitalize`;
          badge.textContent = quality;
          row.appendChild(badge);
        }

        card.appendChild(nameEl);
        card.appendChild(row);

        popup.setLngLat(e.lngLat).setDOMContent(card).addTo(map);
      });

      map.on('mouseleave', 'venues-dot', () => {
        map.getCanvas().style.cursor = '';
        popup.remove();
      });

      // Keep the sun ray anchored to the map centre while panning (no venue selected)
      map.on('move', () => sunRayUpdateRef.current?.());

      mapRef.current = map;
      setMapReady(true);
    });

    return () => {
      popup.remove();
      popupRef.current = null;
      if (markerRef.current) { markerRef.current.remove(); markerRef.current = null; }
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, [token]);

  // Update weather-zone cloud cover circles whenever the data or slider time changes
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    mapRef.current.getSource('weather-zones')?.setData({
      type: 'FeatureCollection',
      features: (weatherZoneData ?? []).map(z => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [z.lng, z.lat] },
        properties: { cloudCover: z.cloudCover },
      })),
    });
  }, [weatherZoneData, mapReady]);

  // Update venue markers
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const geojson = {
      type: 'FeatureCollection',
      features: venues.map(v => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [v.lng, v.lat] },
        properties: {
          id: v.id,
          name: v.name,
          score: v.score ?? null,
          color: v.score !== null ? getScoreColor(v.score) : UNSCORED_COLOR,
          selected: v.id === selectedVenueId,
          type: v.type ?? 'venue',
          scored: v.score !== null,
          quality: v.quality ?? null,
          amenity: v.amenity ?? null,
        },
      })),
    };
    mapRef.current.getSource('venues')?.setData(geojson);
  }, [venues, selectedVenueId, mapReady]);

  // Fly to venue whenever selection changes — covers both map-click and list-click paths
  useEffect(() => {
    if (!mapReady || !mapRef.current || !selectedVenueId || !selectedVenue) return;
    const map = mapRef.current;
    const point = map.project([selectedVenue.lng, selectedVenue.lat]);
    // On desktop the venue panel occupies 288px on the left; offset the fly-to center
    // so the venue dot isn't hidden behind it. On mobile the panel slides up from the
    // bottom, so no horizontal offset is needed.
    const isMobile = window.innerWidth < 768;
    const offsetCenter = map.unproject({ x: point.x + (isMobile ? 0 : 152), y: point.y });
    map.flyTo({ center: offsetCenter, zoom: Math.max(map.getZoom(), 14), speed: 0.8 });
  }, [selectedVenueId, selectedVenue?.lat, selectedVenue?.lng, mapReady]);

  // Pulsing HTML marker for selected venue
  useEffect(() => {
    if (!document.getElementById('sv-pulse-style')) {
      const s = document.createElement('style');
      s.id = 'sv-pulse-style';
      s.textContent = `
        @keyframes sv-ring {
          0%   { transform: scale(1);   opacity: 0.8; }
          100% { transform: scale(2.8); opacity: 0; }
        }
      `;
      document.head.appendChild(s);
    }
  }, []);

  useEffect(() => {
    if (markerRef.current) { markerRef.current.remove(); markerRef.current = null; }
    if (!mapReady || !mapRef.current || !selectedVenue) return;

    const color = selectedVenue.score !== null ? getScoreColor(selectedVenue.score) : UNSCORED_COLOR;

    const el = document.createElement('div');
    el.style.cssText = 'position:relative;width:16px;height:16px;pointer-events:none;';

    // Animated outer ring
    const ring = document.createElement('div');
    ring.style.cssText = `position:absolute;inset:-3px;border-radius:50%;border:2.5px solid ${color};animation:sv-ring 1.5s ease-out infinite;`;

    // Solid center dot with white border
    const dot = document.createElement('div');
    dot.style.cssText = `position:absolute;inset:0;border-radius:50%;background:${color};border:2.5px solid #fff;box-shadow:0 0 8px ${color}99;`;

    el.appendChild(ring);
    el.appendChild(dot);

    markerRef.current = new mapboxgl.Marker({ element: el, anchor: 'center' })
      .setLngLat([selectedVenue.lng, selectedVenue.lat])
      .addTo(mapRef.current);
  }, [selectedVenue?.lat, selectedVenue?.lng, selectedVenue?.score, mapReady]);

  // Update sun direction ray — origin from selectedVenue if set, else map centre.
  // The update function is stored in sunRayUpdateRef so the map's 'move' listener
  // can re-draw it live as the user pans, without needing a React re-render.
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    const RAD = Math.PI / 180;
    const distKm = 8;

    const updateRay = () => {
      let originLng, originLat;
      if (selectedVenue) {
        originLng = selectedVenue.lng;
        originLat = selectedVenue.lat;
      } else {
        const { lng, lat } = map.getCenter();
        originLng = lng;
        originLat = lat;
      }
      const deltaLat = (distKm / 111.32) * Math.cos(sunAzimuth * RAD);
      const deltaLng = (distKm / (111.32 * Math.cos(originLat * RAD))) * Math.sin(sunAzimuth * RAD);
      map.getSource('sun-ray')?.setData({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [[originLng, originLat], [originLng + deltaLng, originLat + deltaLat]] }, properties: {} }],
      });
    };

    sunRayUpdateRef.current = updateRay;
    updateRay();
  }, [sunAzimuth, selectedVenue, mapReady]);

  if (!token) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-gray-950">
        <div className="text-center p-8 bg-gray-900 border border-gray-700 rounded-2xl max-w-sm mx-4">
          <div className="text-5xl mb-4">🗝️</div>
          <h2 className="text-white text-xl font-bold mb-2">Mapbox Token Required</h2>
          <p className="text-gray-400 text-sm leading-relaxed">
            Copy <code className="bg-gray-800 text-orange-400 px-1.5 py-0.5 rounded">.env.example</code> to{' '}
            <code className="bg-gray-800 text-orange-400 px-1.5 py-0.5 rounded">.env</code> and add your free Mapbox public token.
          </p>
          <p className="text-gray-500 text-xs mt-3">
            Get a free token at{' '}
            <span className="text-orange-400">mapbox.com</span>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="absolute inset-0" />
      {!mapReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#09090f] z-10 pointer-events-none">
          <div className="flex flex-col items-center gap-3">
            <div className="w-5 h-5 border-2 border-[#FF6B35]/40 border-t-[#FF6B35] rounded-full animate-spin" />
            <p className="text-[#6b7280] text-xs tracking-wide">Loading map…</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(MapView);

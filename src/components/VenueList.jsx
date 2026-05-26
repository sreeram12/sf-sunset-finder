import { useMemo, useState, useRef, useEffect, memo } from 'react';
import { getScoreColor, UNSCORED_COLOR } from '../lib/viewshed';

const VENUE_EMOJIS = {
  cafe: '☕',
  restaurant: '🍽️',
  bar: '🍸',
  park: '🌿',
  viewpoint: '👁️',
  garden: '🌸',
  peak: '⛰️',
};

const chip = (active) =>
  `text-xs px-2.5 py-1 rounded-full transition-colors border ${
    active
      ? 'bg-white/15 text-white border-white/20'
      : 'bg-transparent text-[#6b7280] border-white/8 hover:text-white'
  }`;

/**
 * Slide-out ranked venue list with search and filters.
 *
 * Slides in from the right edge of the screen. Includes:
 * - Free-text name search with live count feedback
 * - Type filter: All / Cafes & Bars / Parks
 * - Minimum score filter: Any / ≥ 60 / ≥ 80
 * - Auto-focus on the search input when opened
 *
 * @param {Object}   props
 * @param {Array}    props.venues        - Full venue array from App state (may include unscored entries).
 * @param {number|null} props.selectedId - Currently selected venue ID, used to highlight the active row.
 * @param {Function} props.onVenueClick  - Called with a venue ID when a list row is clicked.
 * @param {boolean}  props.isOpen        - Controls slide-in visibility.
 * @param {Function} props.onClose       - Called when the user closes the panel.
 */
function VenueList({ venues, selectedId, onVenueClick, isOpen, onClose }) {
  const [typeFilter, setTypeFilter] = useState('all');
  const [scoreFilter, setScoreFilter] = useState(0);
  const [query, setQuery] = useState('');
  const searchRef = useRef(null);

  const isScoring = venues.some(v => v.score === null);

  // Auto-focus search when list opens
  useEffect(() => {
    if (isOpen) {
      const t = setTimeout(() => searchRef.current?.focus(), 320); // after slide-in
      return () => clearTimeout(t);
    } else {
      setQuery(''); // clear search on close
    }
  }, [isOpen]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return venues
      .filter(v => {
        if (typeFilter === 'venue' && v.type !== 'venue') return false;
        if (typeFilter === 'park' && v.type !== 'park') return false;
        if ((v.score ?? 0) < scoreFilter) return false;
        if (q && !v.name.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }, [venues, typeFilter, scoreFilter, query]);

  const countLabel = isScoring
    ? `Scoring ${venues.length} venues…`
    : query
    ? `${filtered.length} result${filtered.length !== 1 ? 's' : ''} for "${query}"`
    : `${filtered.length} spots ranked by sunset quality`;

  return (
    <div
      className={`absolute right-0 top-0 bottom-0 w-full md:w-80 z-20 flex flex-col bg-[#0f0f19]/98 backdrop-blur-md border-l border-white/8 shadow-2xl transition-transform duration-300 ease-in-out ${
        isOpen ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/8 bg-[#0f0f19]/98 backdrop-blur-md" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)' }}>
        <div className="flex items-start justify-between mb-2.5">
          <div>
            <h2 className="text-white font-semibold text-sm">Best Views</h2>
            <p className="text-[#6b7280] text-xs mt-0.5">{countLabel}</p>
            {isScoring && (
              <div className="flex items-center gap-1.5 mt-0.5">
                <div className="w-2 h-2 border border-[#FF6B35] border-t-transparent rounded-full animate-spin flex-shrink-0" />
                <span className="text-[10px] text-[#6b7280]">Scoring venues…</span>
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-[#9ca3af] hover:text-white text-xl p-1 -mr-1 rounded transition-colors flex-shrink-0"
            aria-label="Close list"
          >
            ×
          </button>
        </div>

        {/* Search input */}
        <div className="relative">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#6b7280] text-xs pointer-events-none">
            🔍
          </span>
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search venues…"
            aria-label="Search venues"
            className="w-full rounded-lg pl-7 pr-7 py-1.5 text-xs placeholder-[#9ca3af] focus:outline-none focus:ring-1 focus:ring-orange-400/40 transition-colors"
            style={{ backgroundColor: '#ffffff', color: '#111827', caretColor: '#111827', border: '1px solid rgba(255,255,255,0.15)' }}
          />
          {query && (
            <button
              onClick={() => { setQuery(''); searchRef.current?.focus(); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[#6b7280] hover:text-white text-sm leading-none transition-colors"
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Filter bar */}
      <div className="px-4 py-2.5 border-b border-white/8 bg-[#0f0f19]/98 backdrop-blur-md space-y-2">
        <div className="flex gap-2 flex-wrap">
          {[['all', 'All'], ['venue', 'Cafes & Bars'], ['park', 'Parks']].map(([v, l]) => (
            <button key={v} onClick={() => setTypeFilter(v)} className={chip(typeFilter === v)}>
              {l}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          {[[0, 'Any score'], [60, '≥ 60'], [80, '≥ 80']].map(([v, l]) => (
            <button key={v} onClick={() => setScoreFilter(v)} className={chip(scoreFilter === v)}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Scrollable venue list */}
      <div className="flex-1 overflow-y-auto overscroll-contain" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {filtered.map(v => (
          <button
            key={v.id}
            onClick={() => { onVenueClick(v.id); onClose(); }}
            className={`w-full text-left px-4 py-3 flex items-center gap-3 border-b border-white/5 hover:bg-white/5 transition-colors ${v.id === selectedId ? 'bg-white/8' : ''}`}
          >
            <span className="text-base flex-shrink-0">{VENUE_EMOJIS[v.amenity] ?? '📍'}</span>
            <div className="flex-1 min-w-0">
              <div className="text-white text-sm font-medium truncate" title={v.name}>{v.name}</div>
              <div className="text-[#6b7280] text-xs mt-0.5 capitalize">
                {v.amenity}{v.outdoorSeating ? ' · outdoor' : ''}
              </div>
            </div>
            <div className="flex-shrink-0 text-right">
              <div
                className="text-sm font-bold tabular-nums"
                style={{ color: v.score !== null && v.quality !== 'night' ? getScoreColor(v.score) : UNSCORED_COLOR }}
              >
                {v.quality === 'night' ? '—' : (v.score ?? '—')}
              </div>
              <div className="text-[10px] text-[#6b7280] mt-0.5 capitalize">
                {v.quality ?? 'loading'}
              </div>
            </div>
          </button>
        ))}
        {filtered.length > 0 && filtered.every(v => v.quality === 'night') && (
          <div className="mx-4 mt-4 mb-2 p-3 rounded-xl bg-white/4 border border-white/8 text-center">
            <div className="text-lg mb-1">🌙</div>
            <p className="text-[#9ca3af] text-xs leading-relaxed">
              Sun has set. Move the time slider back to golden hour for today's best spots.
            </p>
          </div>
        )}
        {filtered.length === 0 && (
          <div className="text-center text-[#6b7280] text-sm py-12">
            {query ? `No venues match "${query}"` : 'No spots match your filters'}
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(VenueList);

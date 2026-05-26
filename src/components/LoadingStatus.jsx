import React from 'react';

/**
 * Centered loading pill shown during initial data load.
 *
 * Renders a spinner, status message, and progress bar while `stage` is a
 * non-empty string. Returns null once loading completes. The time-slider
 * rescore indicator ("Updating…") lives in the App header, not here.
 *
 * @param {Object} props
 * @param {string} props.stage       - Current loading stage label. Empty string hides the pill.
 * @param {number} props.venueCount  - Total venues; used to compute the progress percentage.
 * @param {number} props.scoredCount - Venues scored so far.
 */
export default React.memo(function LoadingStatus({ stage, venueCount, scoredCount }) {
  const pct = venueCount > 0 ? Math.round((scoredCount / venueCount) * 100) : null;
  if (!stage) return null;

  return (
    <div className="absolute bottom-36 left-1/2 -translate-x-1/2 w-72 max-w-sm z-10">
      <div className="bg-[#0f0f19]/95 backdrop-blur-md border border-white/8 rounded-2xl shadow-2xl px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="w-4 h-4 border-2 border-[#FF6B35] border-t-transparent rounded-full animate-spin flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-white text-xs truncate">{stage}</div>
            {pct !== null && (
              <div className="mt-1.5 h-0.5 w-full bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#FF6B35] rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${pct}%` }}
                />
              </div>
            )}
          </div>
          {pct !== null && (
            <span className="text-[10px] text-[#6b7280] flex-shrink-0 tabular-nums">
              {scoredCount}/{venueCount}
            </span>
          )}
        </div>
      </div>
    </div>
  );
});

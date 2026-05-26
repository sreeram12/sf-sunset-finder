import React from 'react';
import { getScoreColor } from '../lib/viewshed';

const tiers = [
  { label: 'Excellent', score: 92 },
  { label: 'Great',     score: 70 },
  { label: 'Good',      score: 50 },
  { label: 'Partial',   score: 30 },
  { label: 'Blocked',   score: 8  },
];

export default React.memo(function Legend() {
  return (
    <div className="hidden md:flex flex-col absolute bottom-36 right-4 bg-[#0f0f19]/95 backdrop-blur-md border border-white/8 rounded-xl px-3 py-2 z-10">
      {/* Score tiers row */}
      <div className="flex items-center gap-3">
        {tiers.map(t => (
          <div key={t.score} className="flex items-center gap-1">
            <div
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: getScoreColor(t.score) }}
            />
            <span className="text-[10px] text-gray-300 leading-none">{t.label}</span>
          </div>
        ))}
      </div>

      {/* Secondary row */}
      <div className="flex items-center gap-4 mt-1.5">
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-green-400 leading-none">●</span>
          <span className="text-[10px] text-[#6b7280] leading-none">park / viewpoint</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-[#FFF7C2]/70 leading-none">—</span>
          <span className="text-[10px] text-[#6b7280] leading-none">sun direction</span>
        </div>
      </div>
    </div>
  );
});

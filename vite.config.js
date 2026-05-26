import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    // Provide a dummy token so terrain.js module-level import doesn't throw
    env: { VITE_MAPBOX_TOKEN: 'pk.test' },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          mapbox:  ['mapbox-gl'],
          turf:    ['@turf/bearing', '@turf/centroid', '@turf/destination', '@turf/distance', '@turf/helpers', '@turf/line-intersect'],
          vendor:  ['react', 'react-dom', 'suncalc'],
        },
      },
    },
  },
});

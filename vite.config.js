/**
 * ╔═══════════════════════════════════════════════════════════════════════╗
 * ║  vite.config.js — Build & Dev-Server Configuration                   ║
 * ╚═══════════════════════════════════════════════════════════════════════╝
 *
 * ARCHITECTURE ROLE:
 *   Configures Vite for both the `npm run dev` hot-reload server and the
 *   `npm run build` production bundler.
 *
 * VENDOR CHUNKING:
 *   React, ReactDOM, react-leaflet, and leaflet are split into a separate
 *   "vendor" chunk. This keeps the main application bundle small and allows
 *   browsers to cache the vendor chunk independently (it rarely changes).
 *
 * CHUNK SIZE LIMIT:
 *   chunkSizeWarningLimit is raised to 600 KB because the Leaflet library
 *   alone is ~330 KB minified, which exceeds Vite's default 500 KB warning.
 *
 * GeoJSON DATA:
 *   The ~32 MB of GeoJSON files live in /public/data/ and are served as
 *   static assets, NOT bundled by Vite. They are fetched at runtime via
 *   fetch() in App.jsx.
 */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
    plugins: [react()],
    build: {
        rollupOptions: {
            output: {
                manualChunks: {
                    vendor: ['react', 'react-dom', 'react-leaflet', 'leaflet']
                }
            }
        },
        chunkSizeWarningLimit: 600
    }
})

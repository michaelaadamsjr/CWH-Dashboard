/**
 * ╔═══════════════════════════════════════════════════════════════════════╗
 * ║  BasemapSwitcher.jsx — Tile Layer Toggle                             ║
 * ╚═══════════════════════════════════════════════════════════════════════╝
 *
 * ARCHITECTURE ROLE:
 *   Three-button group in the LayerPanel footer that switches between
 *   Light (CartoDB Positron), Dark (CartoDB Dark Matter), and Satellite
 *   (Esri World Imagery) basemaps.
 *
 * HOW IT WORKS:
 *   - This component only manages the UI buttons. The actual tile-layer
 *     swap happens in App.jsx's <DynamicTileLayer> component, which
 *     reacts to the `basemapType` state ('light' | 'dark' | 'satellite').
 *   - The preference is persisted to localStorage so it survives reloads.
 *   - When 'dark' is active, App.jsx also adds a 'theme-dark' class to
 *     <body>, toggling the full CSS dark theme (custom properties in
 *     index.css).
 */
import React from 'react';

export default function BasemapSwitcher({ basemapType, setBasemapType }) {
    return (
        <div className="basemap-switcher">
            <button
                className={`basemap-btn ${basemapType === 'light' ? 'active' : ''}`}
                onClick={() => setBasemapType('light')}
                title="Light Basemap"
            >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>
            </button>
            <button
                className={`basemap-btn ${basemapType === 'dark' ? 'active' : ''}`}
                onClick={() => setBasemapType('dark')}
                title="Dark Basemap"
            >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
            </button>
            <button
                className={`basemap-btn ${basemapType === 'satellite' ? 'active' : ''}`}
                onClick={() => setBasemapType('satellite')}
                title="Satellite Imagery"
            >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
            </button>
        </div>
    );
}

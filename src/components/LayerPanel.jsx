/**
 * ╔═══════════════════════════════════════════════════════════════════════╗
 * ║  LayerPanel.jsx — Left Sidebar Layer Controls                        ║
 * ╚═══════════════════════════════════════════════════════════════════════╝
 *
 * ARCHITECTURE ROLE:
 *   The left sidebar that lets users toggle map layers on/off, filter
 *   schools, select coloring metrics, and switch basemaps.
 *
 * LAYER CATEGORIES:
 *   - Layers are grouped by their `category` field from LAYER_CONFIG:
 *       'overlays'  → checkbox toggles (multiple can be active)
 *       'datasets'  → radio toggles (exclusive: only one at a time)
 *   - EXCLUSIVE_CATEGORIES controls which groups use radio-button behavior.
 *   - Order within each group follows the LAYER_CONFIG array order.
 *
 * SCHOOL-SPECIFIC CONTROLS:
 *   - When the schools layer is active, two nested controls appear:
 *     1. A <select> dropdown to change the color metric
 *        (CWHScore, CanopyHeatRelief, DAC, Infiltration).
 *     2. A three-button filter (All / Open / Closed) to filter by
 *        operational status.
 *   - These controls stop click propagation so they don't toggle the
 *     layer off when interacted with.
 *
 * FOOTER:
 *   - Contains the BasemapSwitcher component (light / dark / satellite)
 *     and attribution links.
 *
 * PERFORMANCE:
 *   - Wrapped in React.memo to skip re-renders when props haven't changed.
 */
import React from 'react';
import LAYER_CONFIG, { CATEGORIES } from '../layerConfig';
import BasemapSwitcher from './BasemapSwitcher';

// Build a lookup of which category each layer belongs to
const CATEGORY_MAP = {};
for (const layer of LAYER_CONFIG) {
    CATEGORY_MAP[layer.id] = layer.category || 'other';
}

// Exclusive groups: only 1 layer active at a time within these categories
const EXCLUSIVE_CATEGORIES = new Set(['polygons', 'datasets']);

const LayerPanel = React.memo(({ visibleLayers, setVisibleLayers, layerCounts, activeSchoolMetric, setActiveSchoolMetric, schoolOpenFilter, setSchoolOpenFilter, basemapType, setBasemapType }) => {
    const toggle = (id) => {
        setVisibleLayers(prev => {
            const isCurrentlyOn = prev[id];

            if (isCurrentlyOn) {
                return { ...prev, [id]: false };
            }

            const category = CATEGORY_MAP[id];
            if (EXCLUSIVE_CATEGORIES.has(category)) {
                const next = { ...prev };
                for (const layer of LAYER_CONFIG) {
                    if (layer.category === category && layer.id !== id) {
                        next[layer.id] = false;
                    }
                }
                next[id] = true;
                return next;
            }

            return { ...prev, [id]: true };
        });
    };

    // Group layers by category
    const grouped = {};
    for (const layer of LAYER_CONFIG) {
        const cat = layer.category || 'other';
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(layer);
    }

    return (
        <div className="layer-panel">
            <div className="layer-panel-header">
                <div className="logo-row">
                    <div className="cwh-logo" role="img" aria-label="Council for Watershed Health" title="Council for Watershed Health" />
                </div>
            </div>
            <div className="layer-list">
                {Object.entries(grouped).map(([catId, layers]) => {
                    const cat = CATEGORIES[catId] || { label: catId, icon: '📁' };
                    const isExclusive = EXCLUSIVE_CATEGORIES.has(catId);
                    return (
                        <div key={catId}>
                            <div className="category-label">
                                {cat.label}
                            </div>
                            {layers.map(layer => {
                                const isOn = visibleLayers[layer.id] || false;
                                const count = layerCounts[layer.id];
                                return (
                                    <div
                                        key={layer.id}
                                        className={`layer-item ${isOn ? 'active' : ''}`}
                                        onClick={() => toggle(layer.id)}
                                    >
                                        <div className={`layer-toggle ${isExclusive ? 'radio' : 'check'} ${isOn ? 'on' : ''}`}>
                                            {isOn && (
                                                isExclusive
                                                    ? <div className="radio-dot" />
                                                    : <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1.5 5 L4 7.5 L8.5 2.5" stroke="#16a34a" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                            )}
                                        </div>
                                        <div className="layer-info">
                                            <div className="layer-name">{layer.name}</div>
                                            {layer.id === 'schools_andparks' && isOn && (
                                                <div style={{ marginTop: '8px' }} onClick={(e) => e.stopPropagation()}>
                                                    <select
                                                        value={activeSchoolMetric}
                                                        onChange={(e) => setActiveSchoolMetric(e.target.value)}
                                                        className="metric-select"
                                                    >
                                                        <option value="CWHScore">Custom Greening Index</option>
                                                        <option value="CanopyHeatReliefScore">Canopy Heat Relief</option>
                                                        <option value="DisadvantagedCommunitiesScore">Community Opportunity Score</option>
                                                        <option value="infilpot_pctl">Infiltration Potential</option>
                                                    </select>
                                                    {/* Open / Closed filter */}
                                                    <div
                                                        style={{ display: 'flex', gap: '4px', marginTop: '8px' }}
                                                    >
                                                        {[
                                                            { value: 'all', label: 'All' },
                                                            { value: 'open', label: 'Open' },
                                                            { value: 'closed', label: 'Closed' },
                                                        ].map(opt => (
                                                            <button
                                                                key={opt.value}
                                                                onClick={() => setSchoolOpenFilter(opt.value)}
                                                                style={{
                                                                    flex: 1,
                                                                    padding: '3px 0',
                                                                    fontSize: '0.7rem',
                                                                    fontWeight: 600,
                                                                    border: '1px solid var(--border-accent)',
                                                                    borderRadius: '4px',
                                                                    cursor: 'pointer',
                                                                    background: schoolOpenFilter === opt.value
                                                                        ? 'var(--accent-cyan)'
                                                                        : 'var(--bg-secondary)',
                                                                    color: schoolOpenFilter === opt.value
                                                                        ? 'var(--bg-primary)'
                                                                        : 'var(--text-muted)',
                                                                    transition: 'all 0.15s',
                                                                }}
                                                            >
                                                                {opt.label}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                        {/* Polygon counts intentionally removed for cleaner UI */}
                                    </div>
                                );
                            })}
                        </div>
                    );
                })}
            </div>
            <div className="layer-panel-footer" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <BasemapSwitcher basemapType={basemapType} setBasemapType={setBasemapType} />
                <a href="https://watershedhealth.org" target="_blank" rel="noopener noreferrer">watershedhealth.org</a>
                <a href="mailto:michaelaadamsjr@gmail.com">Created By michaelaadamsjr@gmail.com</a>
            </div>
        </div>
    );
});

export default LayerPanel;

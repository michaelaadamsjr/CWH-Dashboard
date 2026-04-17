/**
 * ╔═══════════════════════════════════════════════════════════════════════╗
 * ║  LegendPanel.jsx — Dynamic Map Legend Overlay                        ║
 * ╚═══════════════════════════════════════════════════════════════════════╝
 *
 * ARCHITECTURE ROLE:
 *   Floats over the bottom-right corner of the map. Automatically shows
 *   legend entries only for layers that are currently visible.
 *
 * LEGEND TYPES (defined per-layer in layerConfig.js):
 *   'solid'       → single color swatch (e.g. Parks, GSA, Watershed)
 *   'gradient'    → continuous color bar with min/max labels
 *                    (e.g. Schools red→green, Tree Equity, CES)
 *   'categorical' → list of value→color pairs
 *                    (e.g. Stormwater Opp., Water Quality, Soil Types)
 *
 * METRIC-AWARE TITLE:
 *   For the schools layer, the title reflects the currently selected
 *   coloring metric (e.g. "School Indices (Canopy Heat Relief)").
 *
 * PERFORMANCE:
 *   Wrapped in React.memo — only re-renders when visibleLayers or
 *   activeSchoolMetric change.
 */
import React from 'react';
import LAYER_CONFIG from '../layerConfig';

// A mapping for the "All Schools" dynamic gradient labels so they don't manually need to be mapped.
const METRIC_LABELS = {
    CWHScore: 'Custom Greening Index',
    CanopyHeatReliefScore: 'Canopy Heat Relief',
    DisadvantagedCommunitiesScore: 'Community Opportunity Score',
    infilpot_pctl: 'Infiltration Potential'
};

const LegendPanel = React.memo(({ visibleLayers, activeSchoolMetric }) => {
    // Only get active layers that actually have a legend configuration
    const activeLegends = LAYER_CONFIG.filter(layer => visibleLayers[layer.id] && layer.legend);

    if (activeLegends.length === 0) {
        return null; // Don't render if no legends to show
    }

    return (
        <div className="legend-panel">
            {activeLegends.map(layer => {
                const legend = layer.legend;

                // For the "All Schools" layer, we want the title to reflect the active metric
                let title = layer.name;
                if (layer.id === 'schools_andparks' && activeSchoolMetric) {
                    title = `${layer.name} (${METRIC_LABELS[activeSchoolMetric] || activeSchoolMetric})`;
                }

                return (
                    <div key={layer.id} className="legend-section">
                        {legend.type === 'solid' ? (
                            <div className="legend-title legend-title-solid" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <span>{title}</span>
                                <div className="legend-swatch" style={{ background: legend.color, marginLeft: '8px' }}></div>
                            </div>
                        ) : (
                            <div className="legend-title">{title}</div>
                        )}

                        {legend.note && (
                            <div className="legend-note">{legend.note}</div>
                        )}

                        {legend.type === 'categorical' && (
                            <div className="legend-categorical">
                                {legend.items.map((item, idx) => (
                                    <div key={idx} className="legend-item">
                                        <div className="legend-swatch" style={{ background: item.color }}></div>
                                        <span className="legend-label">{item.value === '<Null>' ? 'Unknown/Null' : item.value}</span>
                                    </div>
                                ))}
                            </div>
                        )}

                        {legend.type === 'gradient' && (
                            <div className="legend-gradient-wrapper">
                                <div
                                    className="legend-gradient-bar"
                                    style={{
                                        background: `linear-gradient(to right, ${legend.stops.map(s => s.color).join(', ')})`
                                    }}
                                ></div>
                                <div className="legend-gradient-labels">
                                    <span>{legend.stops[0].label}</span>
                                    <span>{legend.stops[legend.stops.length - 1].label}</span>
                                </div>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
});

export default LegendPanel;

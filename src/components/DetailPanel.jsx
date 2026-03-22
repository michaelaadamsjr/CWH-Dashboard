/**
 * ╔═══════════════════════════════════════════════════════════════════════╗
 * ║  DetailPanel.jsx — Feature Inspector & Search UI                     ║
 * ╚═══════════════════════════════════════════════════════════════════════╝
 *
 * ARCHITECTURE ROLE:
 *   Right-panel "Feature Details" tab. Shows attribute data for whatever
 *   map feature the user clicked, plus a global search box when nothing
 *   is selected.
 *
 * SEARCH SYSTEM:
 *   - A `searchIndex` memo builds a flat array of { name, type, feature }
 *     from schools, parks, and GSA layers on load.
 *   - The dropdown list is filtered as the user types and capped at 50
 *     results to prevent DOM thrashing.
 *   - Selecting a result triggers `onFeatureClick` + `onZoomRequest` to
 *     fly the map to the feature and open its detail card.
 *
 * SCORE VISUALIZATION:
 *   - Fields with format 'score' or 'percentile' are rendered as colored
 *     progress bars via the `ScoreBar` sub-component.
 *   - Bar color interpolates Red → Yellow → Green based on value, with
 *     automatic inversion for metrics where "higher = worse."
 *
 * CONTEXTUAL INFO BOXES:
 *   - Layer-specific explanation cards appear at the bottom when viewing
 *     SCWP, soil, Tree Equity, or CES features. These provide field
 *     definitions, percentile breakdowns, or soil scoring tables inline.
 *
 * CO-LOCATED SCHOOLS:
 *   - When a school polygon is selected, any co-located schools (same
 *     coordinates) are shown in a "Schools" heading. Names are
 *     deduplicated to avoid repeats.
 *
 * ADDITIONAL FIELDS:
 *   - Raw GeoJSON properties not already shown in keyFields are rendered
 *     under "Additional Fields" using human-readable aliases from
 *     FIELD_ALIASES in layerConfig.js (unless `exactFieldsOnly` is set).
 */
import React, { useState, useMemo } from 'react';
import LAYER_CONFIG, { formatValue, FIELD_ALIASES, FIELD_FORMATS } from '../layerConfig';
import { getScoreBreakdown } from '../scoringConfig';

function ScoreBar({ value, color, is100Scale }) {
    if (typeof value !== 'number' || isNaN(value)) return null;
    const pct = is100Scale ? value : value * 100;
    const clampedPct = Math.min(Math.max(pct, 0), 100);
    return (
        <div className="score-bar-container">
            <div className="score-bar">
                <div
                    className="score-bar-fill"
                    style={{ width: `${clampedPct}%`, background: color || 'var(--accent-cyan)' }}
                />
            </div>
            <span className="score-value">{value.toFixed(3)}</span>
        </div>
    );
}

export default function DetailPanel({ selected, onClose, layerData, onFeatureClick, onZoomRequest, scoringWeights }) {
    const [searchTerm, setSearchTerm] = useState('');

    const searchIndex = useMemo(() => {
        if (!layerData) return [];
        const index = [];

        // Add public schools
        if (layerData['schools_andparks']?.features) {
            layerData['schools_andparks'].features.forEach(f => {
                const name = f.properties.School;
                if (name) index.push({ name, type: 'School', feature: f, layerId: 'schools_andparks' });
            });
        }

        // Add parks
        if (layerData['countywide_parks']?.features) {
            layerData['countywide_parks'].features.forEach(f => {
                const name = f.properties.PARK_NAME;
                // Exclude generic "Park" names to reduce noise
                if (name && name.toLowerCase() !== 'park') {
                    index.push({ name, type: 'Park', feature: f, layerId: 'countywide_parks' });
                }
            });
        }

        // Add GSA schools
        if (layerData['gsa_2024']?.features) {
            layerData['gsa_2024'].features.forEach(f => {
                const name = f.properties.SchoolName;
                if (name) index.push({ name, type: 'GSA School', feature: f, layerId: 'gsa_2024' });
            });
        }

        // Deduplicate and sort
        const seen = new Set();
        return index.filter(item => {
            const key = item.name.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        }).sort((a, b) => a.name.localeCompare(b.name));
    }, [layerData]);

    const filteredItems = useMemo(() => {
        if (!searchTerm) return [];
        const term = searchTerm.toLowerCase();
        return searchIndex.filter(s => s.name.toLowerCase().includes(term)).slice(0, 50);
    }, [searchTerm, searchIndex]);

    if (!selected) {
        return (
            <div className="detail-panel" style={{ overflow: 'visible' }}>
                <div className="empty-state">
                    <div className="empty-state-icon">🗺️</div>
                    <h3 style={{ marginBottom: '8px' }}>No Feature Selected</h3>
                    <p style={{ marginBottom: '20px' }}>Click on any feature on the map, or search below.</p>

                    <div style={{ width: '100%', maxWidth: '300px', margin: '0 auto', textAlign: 'left', position: 'relative' }}>
                        <input
                            type="text"
                            placeholder="Search schools or parks..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            style={{
                                width: '100%',
                                padding: '10px 14px',
                                paddingLeft: '36px',
                                borderRadius: '6px',
                                border: '1px solid var(--border-subtle)',
                                background: 'rgba(255, 255, 255, 0.05)',
                                color: 'var(--text-primary)',
                                fontSize: '0.85rem'
                            }}
                        />
                        <span style={{ position: 'absolute', left: '12px', top: '10px', fontSize: '14px', opacity: 0.5 }}>🔍</span>

                        {searchTerm && (
                            <div style={{
                                position: 'absolute',
                                top: '100%',
                                left: 0,
                                right: 0,
                                marginTop: '4px',
                                background: 'var(--bg-secondary)',
                                border: '1px solid var(--border-accent)',
                                borderRadius: '6px',
                                maxHeight: '250px',
                                overflowY: 'auto',
                                zIndex: 9999, // Ensure it pops out to prevent clipping
                                boxShadow: '0 8px 24px rgba(0,0,0,0.6)'
                            }}>
                                {filteredItems.length > 0 ? (
                                    filteredItems.map((item, i) => (
                                        <div
                                            key={i}
                                            onClick={() => {
                                                if (onZoomRequest) onZoomRequest(item.feature);
                                                onFeatureClick(item.feature, item.layerId, { setStyle: () => { } }, LAYER_CONFIG.find(l => l.id === item.layerId));
                                                setSearchTerm('');
                                            }}
                                            style={{
                                                padding: '8px 12px',
                                                cursor: 'pointer',
                                                fontSize: '0.8rem',
                                                color: 'var(--text-primary)',
                                                borderBottom: i < filteredItems.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                                                display: 'flex',
                                                flexDirection: 'column'
                                            }}
                                            onMouseOver={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                                            onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
                                        >
                                            <span style={{ fontWeight: 500 }}>{item.name}</span>
                                            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '2px' }}>{item.type}</span>
                                        </div>
                                    ))
                                ) : (
                                    <div style={{ padding: '8px 12px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>No matches found.</div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    const { properties, layerId, coLocated = [], feature } = selected;
    const layerCfg = LAYER_CONFIG.find(l => l.id === layerId);
    const rawName = properties[layerCfg?.nameField];
    const featureName = (!rawName || rawName === 'nan' || rawName === 'NaN') ? 'Unknown Feature' : rawName;

    // Separate score fields from other fields for visual rendering
    const scoreFormats = ['score', 'percentile'];
    const scoreFields = layerCfg?.keyFields?.filter(f => scoreFormats.includes(f.format)) || [];
    // Hide 'School Name' from attributes list as it's already in the header
    const otherFields = layerCfg?.keyFields?.filter(f =>
        !scoreFormats.includes(f.format) && f.key !== layerCfg?.nameField
    ) || [];

    // Also show ALL raw properties not already covered, unless exactFieldsOnly is true
    const coveredKeys = new Set((layerCfg?.keyFields || []).map(f => f.key));
    const skipKeys = new Set(['OBJECTID', 'OBJECTID_1', 'Join_Count', 'TARGET_FID', 'FID',
        'Shape_Length', 'Shape_Area', 'Shape_Length_1', 'Shape_Area_1',
        'Shape_Length_12', 'Shape_Area_12', 'Shape_Length_12_13', 'Shape_Area_12_13',
        'treecanopy_norm', 'TreeCanopy_Norm', 'Treecanopy_Norm', 'treecanopynorm',
        'Open', 'PreliminaryScore', '_isDuplicate', // shown as Open? via keyField, PreliminaryScore intentionally hidden
        'NAME', // generic census block group name, not useful
    ]);

    const extraFields = layerCfg?.exactFieldsOnly ? [] : Object.keys(properties)
        .filter(k => !coveredKeys.has(k) && !skipKeys.has(k) && properties[k] !== null);

    return (
        <div className="detail-panel">
            <div className="detail-header">
                <h2 style={{ color: 'var(--text-primary)' }}>
                    {featureName}
                </h2>
                <button className="detail-close" onClick={onClose}>✕</button>
            </div>
            <div className="detail-body">
                {/* Layer badge */}
                <div style={{
                    display: 'inline-block',
                    padding: '3px 10px',
                    borderRadius: '12px',
                    background: (layerCfg?.fillColor || 'var(--accent-cyan)') + '22',
                    color: layerCfg?.fillColor || 'var(--accent-cyan)',
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    marginBottom: '14px',
                }}>
                    {layerCfg?.detailLabel || layerCfg?.name || layerId}
                </div>

                {/* Multi-school campus — show all names as a 'Schools' field right at the top */}
                {coLocated.length > 0 && (() => {
                    // Deduplicate school names — co-located polygons often share the same school name
                    const allNames = [featureName, ...coLocated.map(f => f.properties[layerCfg?.nameField] || 'Unknown')];
                    const seen = new Set();
                    const uniqueNames = allNames.filter(name => {
                        if (seen.has(name)) return false;
                        seen.add(name);
                        return true;
                    });
                    // Only show multi-school heading if there are genuinely different names
                    if (uniqueNames.length <= 1) return null;
                    return (
                        <div className="attr-row" style={{ alignItems: 'flex-start', marginBottom: '12px', paddingBottom: '12px', borderBottom: '1px solid var(--border-subtle)' }}>
                            <span className="attr-label" style={{ minWidth: '70px', fontSize: '0.7rem' }}>Schools</span>
                            <span className="attr-value" style={{ textAlign: 'right', lineHeight: '1.4', fontSize: '0.72rem', fontWeight: 500 }}>
                                {uniqueNames.map((name, i) => (
                                    <span key={i} style={{ display: 'block' }}>{name}</span>
                                ))}
                            </span>
                        </div>
                    );
                })()}

                {/* Score visualizations */}
                {scoreFields.length > 0 && (
                    <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                            <div className="attr-group-title" style={{ border: 'none', marginBottom: 0 }}>Scores</div>
                            {scoreFields[0]?.trendText && (
                                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 500 }}>
                                    {scoreFields[0].trendText}
                                </div>
                            )}
                        </div>
                        <div style={{ borderBottom: '1px solid var(--border-subtle)', marginBottom: '8px' }} />

                        {scoreFields.map((field, idx) => {
                            const rawVal = typeof properties[field.key] === 'number' ? properties[field.key] : 0;

                            // Prevent 0-100 scale metrics from being multiplied into infinity
                            const is100Scale = field.format === 'percentile' || field.key === 'tes';
                            const normalizedVal = is100Scale ? rawVal / 100 : rawVal;
                            const val = Math.max(0, Math.min(1, normalizedVal));

                            // Reverse the color gradient if higher score means WORSE (Less Opportunity)
                            const isInverted = field.trendText && field.trendText.includes('Less');
                            const colorVal = isInverted ? 1 - val : val;

                            // Red → Yellow → Green based on score value
                            const r = colorVal < 0.5 ? 239 : Math.round(239 - (colorVal - 0.5) * 2 * (239 - 34));
                            const g = colorVal < 0.5 ? Math.round(68 + colorVal * 2 * (179 - 68)) : Math.round(179 + (colorVal - 0.5) * 2 * (197 - 179));
                            const b = colorVal < 0.5 ? 68 : Math.round(8 + (colorVal - 0.5) * 2 * (94 - 8));
                            const barColor = `rgb(${r}, ${g}, ${b})`;

                            const showBreakdown = field.key === 'CWHScore' && feature && layerId === 'schools_andparks';
                            const breakdown = showBreakdown ? getScoreBreakdown(feature, scoringWeights, layerData['schools_andparks']?.features || []) : null;

                            return (
                                <div key={field.key} style={{ marginBottom: '10px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '4px' }}>
                                        <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                                            {field.label}
                                        </div>
                                    </div>
                                    <ScoreBar
                                        value={rawVal}
                                        color={barColor}
                                        is100Scale={is100Scale}
                                    />

                                    {showBreakdown && breakdown && (
                                        <div style={{ marginTop: '8px', padding: '8px', background: 'var(--bg-primary)', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
                                            <div style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px', textTransform: 'uppercase' }}>Score Breakdown</div>
                                            {breakdown.map(b => (
                                                <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', padding: '2px 0' }}>
                                                    <span style={{ color: 'var(--text-secondary)' }}>{b.label} <span style={{ opacity: 0.5 }}>({b.weightPercent}%)</span></span>
                                                    <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{b.value.toFixed(3)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </>
                )}

                {/* Key attribute rows */}
                {otherFields.length > 0 && (
                    <>
                        <div className="attr-group-title">Attributes</div>
                        {otherFields.map(field => (
                            <div key={field.key} className="attr-row">
                                <span className="attr-label">{field.label}</span>
                                <span className="attr-value">{formatValue(properties[field.key], field.format)}</span>
                            </div>
                        ))}
                    </>
                )}

                {/* Extra raw properties */}
                {extraFields.length > 0 && (
                    <>
                        <div className="attr-group-title">Additional Fields</div>
                        {(() => {
                            const coordKeys = ['lat', 'long', 'latitude', 'longitude', 'y', 'x'];
                            const isCoord = (k) => coordKeys.some(c => k.toLowerCase() === c);

                            const sortedKeys = [
                                ...extraFields.filter(k => !isCoord(k)),
                                ...extraFields.filter(k => isCoord(k))
                            ];

                            return sortedKeys.map(key => (
                                <div key={key} className="attr-row">
                                    <span className="attr-label">{FIELD_ALIASES[key] || key}</span>
                                    <span className="attr-value">
                                        {FIELD_FORMATS[key]
                                            ? formatValue(properties[key], FIELD_FORMATS[key])
                                            : typeof properties[key] === 'number'
                                                ? properties[key].toLocaleString(undefined, { maximumFractionDigits: 3 })
                                                : String(properties[key])}
                                    </span>
                                </div>
                            ));
                        })()}
                    </>
                )}

                {/* SCWP layer descriptions — shown contextually */}
                {layerId === 'scw_stormwater' && (
                    <div style={{ marginTop: '12px', padding: '10px', background: 'var(--bg-secondary)', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
                        <div style={{ fontWeight: 600, fontSize: '0.78rem', color: 'var(--text-primary)', marginBottom: '6px' }}>About This Layer</div>
                        <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', lineHeight: '1.5', marginBottom: '8px' }}>
                            Identifies areas with significant potential to increase local water supply through
                            stormwater capture. "Wet" = wet-weather only; "Wet or Dry" = year-round potential.
                        </div>
                        <table style={{ width: '100%', fontSize: '0.72rem', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr>
                                    <th style={{ textAlign: 'left', padding: '3px 6px', borderBottom: '1px solid var(--border-accent)', color: 'var(--text-primary)', fontWeight: 600 }}>Category</th>
                                    <th style={{ textAlign: 'left', padding: '3px 6px', borderBottom: '1px solid var(--border-accent)', color: 'var(--text-primary)', fontWeight: 600 }}>Percentile</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr><td style={{ padding: '3px 6px', color: 'var(--text-secondary)' }}>General</td><td style={{ padding: '3px 6px', color: 'var(--text-secondary)' }}>&lt; 75th</td></tr>
                                <tr><td style={{ padding: '3px 6px', color: 'var(--text-secondary)' }}>High</td><td style={{ padding: '3px 6px', color: 'var(--text-secondary)' }}>75th – 85th</td></tr>
                                <tr><td style={{ padding: '3px 6px', color: 'var(--text-secondary)' }}>Higher</td><td style={{ padding: '3px 6px', color: 'var(--text-secondary)' }}>85th – 95th</td></tr>
                                <tr><td style={{ padding: '3px 6px', color: 'var(--text-secondary)' }}>Highest</td><td style={{ padding: '3px 6px', color: 'var(--text-secondary)' }}>&gt; 95th</td></tr>
                            </tbody>
                        </table>
                    </div>
                )}

                {layerId === 'scw_water_quality' && (
                    <div style={{ marginTop: '12px', padding: '10px', background: 'var(--bg-secondary)', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
                        <div style={{ fontWeight: 600, fontSize: '0.78rem', color: 'var(--text-primary)', marginBottom: '6px' }}>About This Layer</div>
                        <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', lineHeight: '1.5', marginBottom: '8px' }}>
                            Highlights areas with the greatest potential for pollutant load reduction.
                            Scored per watershed based on zinc, total phosphorus, and bacteria loading, indexed to a 0–9 scale.
                        </div>
                        <table style={{ width: '100%', fontSize: '0.72rem', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr>
                                    <th style={{ textAlign: 'left', padding: '3px 6px', borderBottom: '1px solid var(--border-accent)', color: 'var(--text-primary)', fontWeight: 600 }}>Category</th>
                                    <th style={{ textAlign: 'left', padding: '3px 6px', borderBottom: '1px solid var(--border-accent)', color: 'var(--text-primary)', fontWeight: 600 }}>Score Range</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr><td style={{ padding: '3px 6px', color: 'var(--text-secondary)' }}>General</td><td style={{ padding: '3px 6px', color: 'var(--text-secondary)' }}>0</td></tr>
                                <tr><td style={{ padding: '3px 6px', color: 'var(--text-secondary)' }}>High</td><td style={{ padding: '3px 6px', color: 'var(--text-secondary)' }}>0 – 3</td></tr>
                                <tr><td style={{ padding: '3px 6px', color: 'var(--text-secondary)' }}>Higher</td><td style={{ padding: '3px 6px', color: 'var(--text-secondary)' }}>3 – 6</td></tr>
                                <tr><td style={{ padding: '3px 6px', color: 'var(--text-secondary)' }}>Highest</td><td style={{ padding: '3px 6px', color: 'var(--text-secondary)' }}>6 – 9</td></tr>
                            </tbody>
                        </table>
                    </div>
                )}

                {layerId === 'scw_groundwater' && (
                    <div style={{ marginTop: '12px', padding: '10px', background: 'var(--bg-secondary)', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
                        <div style={{ fontWeight: 600, fontSize: '0.78rem', color: 'var(--text-primary)', marginBottom: '6px' }}>About This Layer</div>
                        <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                            Identifies areas with significant potential to increase local water supply through
                            groundwater recharge and storage. Filtered to unconfined managed aquifers and their
                            upstream capture areas. Excludes areas where stormwater runoff is already managed by
                            existing wet-weather SCWP projects or major capture facilities. Incorporates drainage
                            data from the LA County Drainage Needs Assessment Program (DNAP).
                        </div>
                    </div>
                )}

                {layerId === 'soil_polygons' && (() => {
                    const group = properties.hydgrpdcd || '';
                    const scores = { 'A': '100%', 'B': '66%', 'C': '33%', 'B/D': '10%', 'C/D': '10%', 'D': '10%' };
                    const labels = { 'A': 'High infiltration', 'B': 'Moderate infiltration', 'C': 'Slow infiltration', 'B/D': 'Very slow / impeded', 'C/D': 'Very slow / impeded', 'D': 'Very slow / impeded' };
                    const defs = {
                        'A': 'Sand, loamy sand, or sandy loam. Low runoff potential and high infiltration rates even when thoroughly wetted.',
                        'B': 'Silt loam or loam. Moderate infiltration rates when thoroughly wetted.',
                        'C': 'Sandy clay loam. Slow infiltration rates when thoroughly wetted; a layer that impedes downward movement of water may be present.',
                        'B/D': 'Dual-class soil: behaves as Group B when drained, Group D when undrained. Very slow infiltration when saturated.',
                        'C/D': 'Dual-class soil: behaves as Group C when drained, Group D when undrained. Very slow infiltration when saturated.',
                        'D': 'Clay loam, silty clay loam, sandy clay, silty clay, or clay. Very slow infiltration rates; high runoff potential.'
                    };
                    const score = scores[group];
                    return (
                        <div style={{ marginTop: '12px', padding: '10px', background: 'var(--bg-secondary)', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
                            <div style={{ fontWeight: 600, fontSize: '0.78rem', color: 'var(--text-primary)', marginBottom: '6px' }}>CWH Infiltration Score</div>
                            {score ? (
                                <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                                    Hydrologic Group <strong style={{ color: 'var(--text-primary)' }}>{group}</strong> receives
                                    a score of <strong style={{ color: 'var(--accent-cyan)' }}>{score}</strong> in the Custom Greening Index
                                    ({labels[group]}).
                                    <div style={{ marginTop: '6px', fontStyle: 'italic' }}>{defs[group]}</div>
                                </div>
                            ) : (
                                <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                                    No hydrologic group assigned — this area is excluded from infiltration scoring.
                                </div>
                            )}
                        </div>
                    );
                })()}

                {layerId === 'tree_equity' && (
                    <div style={{ marginTop: '12px', padding: '10px', background: 'var(--bg-secondary)', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
                        <div style={{ fontWeight: 600, fontSize: '0.78rem', color: 'var(--text-primary)', marginBottom: '6px' }}>About This Layer</div>
                        <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', lineHeight: '1.5', marginBottom: '10px' }}>
                            The Tree Equity Score is a nationwide metric from American Forests that measures
                            how equitably the benefits of urban tree canopy are distributed, considering income,
                            race/ethnicity, age, employment, health, and surface temperature.
                        </div>
                        <div style={{ fontWeight: 600, fontSize: '0.72rem', color: 'var(--text-primary)', marginBottom: '4px' }}>Field Definitions</div>
                        <table style={{ width: '100%', fontSize: '0.7rem', borderCollapse: 'collapse' }}>
                            <tbody>
                                {(layerCfg?.keyFields || []).filter(f => f.description).map(f => (
                                    <tr key={f.key}>
                                        <td style={{ padding: '3px 6px', color: 'var(--text-primary)', fontWeight: 500, verticalAlign: 'top', whiteSpace: 'nowrap' }}>{f.label}</td>
                                        <td style={{ padding: '3px 6px', color: 'var(--text-secondary)' }}>{f.description}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {layerId === 'ces_5' && (
                    <div style={{ marginTop: '12px', padding: '10px', background: 'var(--bg-secondary)', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
                        <div style={{ fontWeight: 600, fontSize: '0.78rem', color: 'var(--text-primary)', marginBottom: '6px' }}>About This Layer</div>
                        <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', lineHeight: '1.5', marginBottom: '10px' }}>
                            CalEnviroScreen 5.0 (Draft) is a screening tool from OEHHA that ranks California
                            census tracts by cumulative environmental, health, and socioeconomic burden. Higher
                            percentiles indicate communities more disproportionately affected by pollution.
                        </div>
                        <div style={{ fontWeight: 600, fontSize: '0.72rem', color: 'var(--text-primary)', marginBottom: '4px' }}>Field Definitions</div>
                        <table style={{ width: '100%', fontSize: '0.7rem', borderCollapse: 'collapse' }}>
                            <tbody>
                                {(layerCfg?.keyFields || []).filter(f => f.description).map(f => (
                                    <tr key={f.key}>
                                        <td style={{ padding: '3px 6px', color: 'var(--text-primary)', fontWeight: 500, verticalAlign: 'top', whiteSpace: 'nowrap' }}>{f.label}</td>
                                        <td style={{ padding: '3px 6px', color: 'var(--text-secondary)' }}>{f.description}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

            </div>
        </div>
    );
}

/**
 * ╔═══════════════════════════════════════════════════════════════════════╗
 * ║  StatsPanel.jsx — Dashboard Statistics Component                      ║
 * ╚═══════════════════════════════════════════════════════════════════════╝
 *
 * ARCHITECTURE NOTES:
 *
 * EFFICIENCY & PERFORMANCE
 * - StatsPanel receives the fully computed `layerData` containing all feature arrays.
 * - Because processing arrays of ~3,000 features can be expensive, we do a 
 *   single O(N) pass over the features to aggregate all sums and counts.
 * 
 * LEADERBOARD (Top 20)
 * - The leaderboard sorts schools by the currently selected `rankCategory`.
 * - To prevent massive multi-campus complexes (like Birmingham/High Tech LA)
 *   from dominating the top 5 spots, we deduplicate by coordinate proximity.
 *   If a school is within ~100 meters (0.001 degrees) of an already-ranked
 *   school, it is skipped.
 * 
 * VIEWPORT COUNTER
 * - StatsPanel receives a `visibleSchoolCount` prop via App.jsx's <ViewportCounter>.
 * - This provides the "X of Y schools visible on screen" metric without needing
 *   to query leaflet bounding boxes from inside this component directly.
 */
import React, { useMemo, useState } from 'react';
import { Bar, Doughnut } from 'react-chartjs-2';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    BarElement,
    ArcElement,
    Tooltip,
    Legend,
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend);

const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
        legend: { display: false },
        tooltip: {
            backgroundColor: '#ffffff',
            titleColor: '#1e293b',
            bodyColor: '#475569',
            borderColor: 'rgba(0,0,0,0.1)',
            borderWidth: 1,
            cornerRadius: 8,
            padding: 10,
            titleFont: { family: 'Inter', weight: '600' },
            bodyFont: { family: 'Inter' },
        },
    },
    scales: {
        x: {
            ticks: { color: '#64748b', font: { family: 'Inter', size: 10 } },
            grid: { color: 'rgba(0,0,0,0.06)' },
        },
        y: {
            ticks: { color: '#64748b', font: { family: 'Inter', size: 10 } },
            grid: { color: 'rgba(0,0,0,0.06)' },
        },
    },
};

const doughnutOptions = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '65%',
    plugins: {
        legend: {
            position: 'bottom',
            labels: {
                color: '#475569',
                font: { family: 'Inter', size: 10 },
                padding: 12,
                usePointStyle: true,
                pointStyleWidth: 8,
            },
        },
        tooltip: {
            backgroundColor: '#ffffff',
            titleColor: '#1e293b',
            bodyColor: '#475569',
            borderColor: 'rgba(0,0,0,0.1)',
            borderWidth: 1,
            cornerRadius: 8,
        },
    },
};

export default function StatsPanel({ layerData, onFeatureClick, onZoomRequest, visibleSchoolCount }) {
    const schoolsData = layerData['schools_andparks'];
    const [rankCategory, setRankCategory] = useState('CWHScore');

    const stats = useMemo(() => {
        if (!schoolsData?.features) return null;
        const features = schoolsData.features;
        const total = features.length;

        // Single-pass aggregation for O(N) efficiency
        const sums = { CWHScore: 0, CanopyHeatReliefScore: 0, DisadvantagedCommunitiesScore: 0, infilpot_pctl: 0 };
        const counts = { CWHScore: 0, CanopyHeatReliefScore: 0, DisadvantagedCommunitiesScore: 0, infilpot_pctl: 0 };
        const prelimDist = [0, 0, 0, 0, 0];
        const canopyDist = [0, 0, 0, 0, 0];
        const parkProximity = { withPark: 0, noPark: 0 };
        let openCount = 0;

        let highPriority = 0;
        let highDisadv = 0;

        for (let i = 0; i < total; i++) {
            const props = features[i].properties;

            // Filters/Counts
            if (String(props.Open).toUpperCase() === 'TRUE') openCount++;

            // Park Proximity
            const jc = Number(props.Join_Count);
            if (!isNaN(jc) && jc !== 0) parkProximity.withPark++;
            else parkProximity.noPark++;

            // Sums and Distributions
            const fields = ['CWHScore', 'CanopyHeatReliefScore', 'DisadvantagedCommunitiesScore', 'infilpot_pctl'];
            fields.forEach(f => {
                const v = props[f];
                if (typeof v === 'number' && !isNaN(v)) {
                    sums[f] += v;
                    counts[f]++;

                    if (f === 'CWHScore') {
                        prelimDist[Math.min(Math.floor(v * 5), 4)]++;
                        if (v >= 0.7) highPriority++;
                    }
                    if (f === 'DisadvantagedCommunitiesScore' && v >= 0.6) highDisadv++;
                }
            });
        }

        return {
            total,
            openCount,
            closedCount: total - openCount,
            avgPrelim: counts.CWHScore ? sums.CWHScore / counts.CWHScore : 0,
            avgCanopy: counts.CanopyHeatReliefScore ? sums.CanopyHeatReliefScore / counts.CanopyHeatReliefScore : 0,
            avgDisadv: counts.DisadvantagedCommunitiesScore ? sums.DisadvantagedCommunitiesScore / counts.DisadvantagedCommunitiesScore : 0,
            avgInfil: counts.infilpot_pctl ? sums.infilpot_pctl / counts.infilpot_pctl : 0,
            prelimDist,
            parkProximity,
            highPriority,
            highDisadv,
        };
    }, [schoolsData]);

    const topSchools = useMemo(() => {
        if (!schoolsData?.features) return [];

        // Filter valid scores
        const validFeatures = schoolsData.features.filter(f =>
            typeof f.properties[rankCategory] === 'number' && !isNaN(f.properties[rankCategory])
        );

        // Deduplicate geographically: don't allow schools within ~100m (0.001 deg) of each other
        // This prevents massive multi-school campuses (like Birmingham/High Tech LA) from taking up 5 spots

        // 1. Sort all valid features strictly by score, highest first
        validFeatures.sort((a, b) => b.properties[rankCategory] - a.properties[rankCategory]);

        const uniqueSchools = [];
        const seenNames = new Set();

        for (const f of validFeatures) {
            const schoolName = typeof f.properties.School === 'string' ? f.properties.School.trim().toUpperCase() : '';
            const lat1 = f.properties.lat;
            const lng1 = f.properties.long;

            if (lat1 == null || lng1 == null) {
                // If it has no coordinates, just add it (unlikely in this dataset)
                uniqueSchools.push(f);
                continue;
            }

            // Check if this school is too close to a higher-ranking school we already added
            let tooClose = false;
            for (const existing of uniqueSchools) {
                const lat2 = existing.properties.lat;
                const lng2 = existing.properties.long;
                if (lat2 != null && lng2 != null) {
                    // Quick manhattan distance check (~100 meters is roughly 0.001 degrees)
                    const dist = Math.abs(lat1 - lat2) + Math.abs(lng1 - lng2);
                    if (dist < 0.001) {
                        tooClose = true;
                        break;
                    }
                }
            }

            if (!tooClose) {
                // strict name check
                if (schoolName && seenNames.has(schoolName)) {
                    continue; // Skip if a school with this name was already added
                }
                if (schoolName) seenNames.add(schoolName);

                uniqueSchools.push(f);
                if (uniqueSchools.length >= 20) break; // We only need the top 20 distinct areas
            }
        }

        const features = uniqueSchools;

        return features;
    }, [schoolsData, rankCategory]);

    if (!stats) {
        return (
            <div style={{ padding: '20px', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                Enable the <strong>Schools & Parks</strong> layer to see aggregate statistics.
            </div>
        );
    }

    return (
        <div style={{ padding: '0' }}>

            {/* Viewport Counter */}
            {typeof visibleSchoolCount === 'number' && (
                <div style={{ marginBottom: '16px', padding: '12px', background: 'var(--bg-card)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        <strong style={{ color: 'var(--text-primary)', fontSize: '1.2rem' }}>{visibleSchoolCount}</strong>
                        <span style={{ margin: '0 4px' }}>of</span>
                        <strong style={{ color: 'var(--text-primary)' }}>{stats.total}</strong>
                    </div>
                    <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)', marginTop: '2px' }}>
                        Schools visible on screen
                    </div>
                </div>
            )}

            {/* Leaderboard / Ranking Box */}
            <div className="chart-container" style={{ padding: '0' }}>
                <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div className="chart-title" style={{ margin: 0 }}>Top 20 Schools</div>
                    <select
                        value={rankCategory}
                        onChange={(e) => setRankCategory(e.target.value)}
                        style={{
                            background: 'var(--bg-secondary)',
                            color: 'var(--text-primary)',
                            border: '1px solid var(--border-accent)',
                            borderRadius: '4px',
                            padding: '4px 8px',
                            fontSize: '0.75rem',
                            outline: 'none',
                            cursor: 'pointer'
                        }}
                    >
                        <option value="CWHScore">Custom Greening Index</option>
                        <option value="CanopyHeatReliefScore">Canopy Heat Relief</option>
                        <option value="DisadvantagedCommunitiesScore">Community Opportunity Score</option>
                        <option value="infilpot_pctl">Infiltration Potential</option>
                    </select>
                </div>
                <div style={{ maxHeight: '250px', overflowY: 'auto' }}>
                    {topSchools.map((f, idx) => (
                        <div
                            key={`${f.properties.School || 'School'}_${idx}_${f.properties.lat}`}
                            style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                padding: '10px 16px',
                                borderBottom: '1px solid var(--border-subtle)',
                                cursor: 'pointer',
                                background: 'transparent',
                                transition: 'background 0.2s'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(0,0,0,0.03)'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                            onClick={() => {
                                if (onFeatureClick) {
                                    onFeatureClick(f, 'schools_andparks', null, null);
                                    if (onZoomRequest) {
                                        onZoomRequest(f);
                                    }
                                }
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <div style={{
                                    width: '24px', height: '24px', borderRadius: '50%',
                                    background: idx < 3 ? 'var(--accent-cyan)' : 'var(--bg-secondary)',
                                    color: idx < 3 ? 'var(--bg-primary)' : 'var(--text-muted)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontWeight: 'bold', fontSize: '0.7rem'
                                }}>
                                    {idx + 1}
                                </div>
                                <div style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-primary)', maxWidth: '160px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {f.properties.School}
                                </div>
                            </div>
                            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--accent-cyan)' }}>
                                {f.properties[rankCategory].toFixed(3)}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Preliminary score distribution */}
            <div className="chart-container">
                <div className="chart-title">Custom Greening Index Distribution</div>
                <div style={{ height: '160px' }}>
                    <Bar
                        data={{
                            labels: ['0–0.2', '0.2–0.4', '0.4–0.6', '0.6–0.8', '0.8–1.0'],
                            datasets: [{
                                data: stats.prelimDist,
                                backgroundColor: [
                                    'rgba(34,211,238,0.3)', 'rgba(34,211,238,0.45)',
                                    'rgba(34,211,238,0.6)', 'rgba(34,211,238,0.75)', 'rgba(34,211,238,0.9)',
                                ],
                                borderColor: '#22d3ee',
                                borderWidth: 1,
                                borderRadius: 4,
                            }],
                        }}
                        options={chartOptions}
                    />
                </div>
            </div>




        </div>
    );
}

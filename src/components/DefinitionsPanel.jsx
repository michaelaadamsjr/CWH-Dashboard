/**
 * ╔═══════════════════════════════════════════════════════════════════════╗
 * ║  DefinitionsPanel.jsx — Methodology & Scoring Reference              ║
 * ╚═══════════════════════════════════════════════════════════════════════╝
 *
 * ARCHITECTURE ROLE:
 *   Right-panel "Definitions" tab. Provides static documentation of the
 *   Custom Greening Index methodology so users can understand how scores
 *   are calculated without leaving the dashboard.
 *
 * CONTENT SECTIONS:
 *   1. Custom Greening Index — composite formula + weight breakdown
 *   2. Infiltration Potential (30%) — soil scoring table + formulas
 *   3. Canopy Heat Relief (30%) — tree canopy / temp normalization
 *   4. Community Opportunity Score (30%) — CES 5.0 integration
 *   5. Park Proximity (5%) — green corridor rationale
 *   6. Contains Elementary School (5%) — grade-level prioritization
 *   7. Data Sources — citations for all upstream datasets
 *
 * DESIGN NOTES:
 *   - Purely presentational (no props, no state, no API calls).
 *   - Wrapped in React.memo since content never changes.
 *   - Style constants (SECTION_STYLE, FORMULA_STYLE, etc.) are defined
 *     at module scope to avoid inline object re-creation.
 */
import React from 'react';

const SECTION_STYLE = { borderBottom: '1px solid var(--border-subtle)', paddingBottom: '14px' };
const TITLE_STYLE = { fontWeight: '700', color: 'var(--text-primary)', marginBottom: '6px', fontSize: '0.88rem' };
const SUBTITLE_STYLE = { fontWeight: '600', color: 'var(--text-primary)', marginBottom: '4px', fontSize: '0.82rem', marginTop: '10px' };
const BODY_STYLE = { fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: '1.5' };
const FORMULA_STYLE = {
    fontSize: '0.76rem', fontFamily: "'Courier New', monospace", background: 'var(--bg-secondary)',
    padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border-subtle)',
    margin: '8px 0', lineHeight: '1.6', color: 'var(--text-primary)', overflowX: 'auto'
};
const TABLE_STYLE = { width: '100%', fontSize: '0.75rem', borderCollapse: 'collapse', margin: '8px 0' };
const TH_STYLE = { textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid var(--border-accent)', color: 'var(--text-primary)', fontWeight: 600 };
const TD_STYLE = { padding: '4px 8px', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' };

const DefinitionsPanel = React.memo(() => {
    return (
        <div className="definitions-panel" style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

                {/* Custom Greening Index */}
                <div style={SECTION_STYLE}>
                    <div style={TITLE_STYLE}>Custom Greening Index</div>
                    <div style={BODY_STYLE}>
                        Multi-benefit composite score (0–1) prioritizing LA County school sites for greening investment.
                        Integrates canopy needs, heat vulnerability, stormwater capture potential, community disadvantage, park access, and grade level.
                    </div>
                    <div style={FORMULA_STYLE}>
                        CWH = normalize(<br />
                        &nbsp;&nbsp;0.30 × InfiltrationPotential_pctl<br />
                        &nbsp;&nbsp;+ 0.30 × CanopyHeatRelief<br />
                        &nbsp;&nbsp;+ 0.30 × CommunityOpportunity<br />
                        &nbsp;&nbsp;+ 0.05 × NormalizedParkCount<br />
                        &nbsp;&nbsp;+ 0.05 × ContainsElementary<br />
                        )
                    </div>
                    <div style={BODY_STYLE}>
                        The raw weighted sum is min-max normalized across all schools to produce the final 0–1 score.
                        Park count (number of parks within ¼ mile) is normalized to 0–1 before weighting.
                    </div>
                    <div style={{ ...BODY_STYLE, marginTop: '8px', padding: '6px 10px', background: 'rgba(34, 211, 238, 0.08)', borderRadius: '6px', border: '1px solid rgba(34, 211, 238, 0.2)' }}>
                        <strong style={{ color: 'var(--accent-cyan)' }}>💡 Modular Weights:</strong> These percentages are defaults.
                        Use the <strong>Scoring</strong> tab to adjust weights in real time and see how rankings change.
                    </div>
                </div>

                {/* Infiltration Potential */}
                <div style={SECTION_STYLE}>
                    <div style={TITLE_STYLE}>Infiltration Potential (30%)</div>
                    <div style={BODY_STYLE}>
                        Estimates each site's stormwater capture capacity based on soil permeability
                        and available impermeable surface for conversion.
                    </div>
                    <div style={FORMULA_STYLE}>
                        InfilPot_raw = SoilScore_avg × Impermeable_sqft<br />
                        InfilPot_pctl = percentile_rank(InfilPot_raw)
                    </div>
                    <div style={SUBTITLE_STYLE}>Variables</div>
                    <div style={BODY_STYLE}>
                        <strong>SoilScore_avg</strong> — Area-weighted average hydrologic soil group score across all parcels overlapping the school polygon (gNATSGO, USDA-NRCS).<br />
                        <strong>Impermeable_sqft</strong> — Total impermeable surface area (sq ft) from SCW Program parcels (2023), area-weighted where school polygons overlap multiple parcels.
                    </div>
                    <div style={{ ...BODY_STYLE, marginTop: '6px' }}>
                        The raw product is converted to a percentile rank due to extreme right-skew in the distribution, yielding a uniform distribution (mean = 50%).
                    </div>
                    <div style={SUBTITLE_STYLE}>Hydrologic Soil Group Scoring</div>
                    <table style={TABLE_STYLE}>
                        <thead>
                            <tr>
                                <th style={TH_STYLE}>Group</th>
                                <th style={TH_STYLE}>Score</th>
                                <th style={TH_STYLE}>Drainage</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr><td style={TD_STYLE}>A</td><td style={TD_STYLE}>100%</td><td style={TD_STYLE}>High infiltration</td></tr>
                            <tr><td style={TD_STYLE}>B</td><td style={TD_STYLE}>66%</td><td style={TD_STYLE}>Moderate infiltration</td></tr>
                            <tr><td style={TD_STYLE}>C</td><td style={TD_STYLE}>33%</td><td style={TD_STYLE}>Slow infiltration</td></tr>
                            <tr><td style={TD_STYLE}>B/D, C/D, D</td><td style={TD_STYLE}>10%</td><td style={TD_STYLE}>Very slow / impeded</td></tr>
                        </tbody>
                    </table>
                </div>

                {/* Canopy Heat Relief */}
                <div style={SECTION_STYLE}>
                    <div style={TITLE_STYLE}>Canopy Heat Relief (30%)</div>
                    <div style={BODY_STYLE}>
                        Measures urban cooling opportunity. Identifies schools with low canopy and high temperatures
                        where new trees would provide the greatest heat-health benefits.
                    </div>
                    <div style={FORMULA_STYLE}>
                        CHR_raw = mean(<br />
                        &nbsp;&nbsp;norm(1 − TreeCanopy),<br />
                        &nbsp;&nbsp;norm(CanopyGap),<br />
                        &nbsp;&nbsp;norm(Temperature)<br />
                        )<br />
                        CHR_pctl = percentile_rank(CHR_raw)
                    </div>
                    <div style={SUBTITLE_STYLE}>Variables</div>
                    <div style={BODY_STYLE}>
                        <strong>TreeCanopy</strong> — Proportion of the school's area covered by tree canopy (Tree Equity Score, American Forests 2025). Inverted (1 − value) so that less canopy = higher score.<br />
                        <strong>CanopyGap</strong> — Difference between a neighborhood's existing canopy and its target canopy goal (Tree Equity Score).<br />
                        <strong>Temperature</strong> — Average surface temperature during extreme heat days, normalized across all LA County schools (Tree Equity Score).
                    </div>
                    <div style={{ ...BODY_STYLE, marginTop: '6px' }}>
                        Each variable is min-max normalized across LA County schools before averaging.
                        The averaged score is then converted to a percentile rank to ensure a uniform distribution (mean = 50%), making the data more transparent.
                    </div>
                </div>

                {/* Community Opportunity Score */}
                <div style={SECTION_STYLE}>
                    <div style={TITLE_STYLE}>Community Opportunity Score (30%)</div>
                    <div style={BODY_STYLE}>
                        Identifies communities disproportionately burdened by pollution and socioeconomic
                        vulnerability using CalEnviroScreen 5.0 (OEHHA).
                    </div>
                    <div style={FORMULA_STYLE}>
                        DC_raw = mean(<br />
                        &nbsp;&nbsp;CIscore_Pctl, Poverty_Pctl<br />
                        )<br />
                        DC_pctl = percentile_rank(DC_raw)
                    </div>
                    <div style={SUBTITLE_STYLE}>Variables</div>
                    <div style={BODY_STYLE}>
                        <strong>CIscore_Pctl</strong> — CalEnviroScreen 5.0 composite percentile, reflecting cumulative pollution burden and population vulnerability (OEHHA).<br />
                        <strong>Poverty_Pctl</strong> — Percentile ranking of poverty rate for the census tract (CalEnviroScreen 5.0).
                    </div>
                    <div style={{ ...BODY_STYLE, marginTop: '6px' }}>
                        Percentiles are averaged and then converted to an overall percentile rank to ensure a uniform distribution (mean = 50%), making the data more transparent.
                    </div>
                </div>

                {/* Park Proximity */}
                <div style={SECTION_STYLE}>
                    <div style={TITLE_STYLE}>Park Proximity (5%)</div>
                    <div style={BODY_STYLE}>
                        The number of public parks within a ¼-mile radius of each school, normalized by dividing
                        by the maximum park count across all schools (max = 7).
                        While it may seem counterintuitive to prioritize schools that already have parks nearby,
                        the logic is rooted in creating <strong>green corridors</strong> that sustain wildlife
                        mobility and hydrological continuity. Greening a school adjacent to existing park space
                        extends contiguous canopy cover, amplifying ecological and stormwater benefits beyond
                        what an isolated site could achieve.
                    </div>
                </div>

                {/* Contains Elementary School */}
                <div style={SECTION_STYLE}>
                    <div style={TITLE_STYLE}>Contains Elementary School (5%)</div>
                    <div style={BODY_STYLE}>
                        Binary variable: <strong>1</strong> if the school polygon contains an elementary-level program
                        (based on the <code style={{ fontSize: '0.76rem' }}>level</code> field from CSCD), <strong>0</strong> otherwise.
                        Elementary schools are prioritized because younger children are more vulnerable to heat-related
                        illness and benefit disproportionately from shaded outdoor spaces. Greening elementary campuses
                        creates early exposure to nature, supporting long-term environmental stewardship.
                    </div>
                </div>


                <div style={{ paddingBottom: '8px' }}>
                    <div style={TITLE_STYLE}>Data Sources</div>
                    <div style={{ ...BODY_STYLE, lineHeight: '1.7' }}>
                        • Tree canopy & temperature — Tree Equity Score (American Forests, 2025)<br />
                        • Pollution & poverty — CalEnviroScreen 5.0 Draft (OEHHA)<br />
                        • Soil classification — gNATSGO (USDA-NRCS)<br />
                        • Impermeable surface — SCW Program Parcels (2023)<br />
                        • Park proximity — LA County DPR (¼-mile spatial join)<br />
                        • School polygons & grade levels — CSCD (2024)
                    </div>
                </div>

            </div>
        </div>
    );
});

export default DefinitionsPanel;

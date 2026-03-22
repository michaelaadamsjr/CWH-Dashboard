/**
 * ╔═══════════════════════════════════════════════════════════════════════╗
 * ║  scoringConfig.js — Custom Greening Index Engine                      ║
 * ╚═══════════════════════════════════════════════════════════════════════╝
 *
 * ARCHITECTURE NOTES:
 *
 * MODULAR SCORING
 * - Computes a composite 0–1 score for each school site based on user-configurable weights.
 * - All normalization happens client-side so the score updates instantly when weights change.
 * 
 * NORMALIZATION CONTEXT
 * - Raw values are min-max normalized (0-1) across the entire dataset.
 * - To prevent skewed results from extreme outliers, we calculate P5 and P95 
 *   values to clip the bounds. 
 *
 * ELEMENTARY SCHOOL PROPAGATION
 * - A single campus might have multiple polygons (e.g., an elementary school 
 *   and a high school sharing the same lat/long). The `buildNormContext` function
 *   builds a Set of coordinates where ANY polygon is an elementary school.
 * - The `getComponentValue` function then checks this Set so that ALL co-located
 *   schools properly receive the elementary school bonus points.
 */

export const SCORING_VARIABLES = [
    {
        id: 'infilpot_pctl',
        label: 'Infiltration Potential',
        field: 'infilpot_pctl',
        defaultWeight: 30,
        description: 'Stormwater capture capacity based on soil permeability (percentile, 0–1).',
        alreadyNormalized: true,
    },
    {
        id: 'canopyHeatRelief',
        label: 'Canopy Heat Relief',
        field: 'CanopyHeatReliefScore',
        defaultWeight: 30,
        description: 'Urban cooling opportunity — low canopy + high heat (0–1).',
        alreadyNormalized: false,
        usePercentile: true,
    },
    {
        id: 'dac',
        label: 'Community Opportunity Score',
        field: 'DisadvantagedCommunitiesScore',
        defaultWeight: 30,
        description: 'CalEnviroScreen pollution burden & socioeconomic vulnerability (0–1).',
        alreadyNormalized: false,
        usePercentile: true,
    },
    {
        id: 'parkCount',
        label: 'Park Proximity (¼ mi)',
        field: 'Join_Count',
        defaultWeight: 5,
        description: 'Number of public parks within ¼ mile, normalized across all schools.',
        alreadyNormalized: false,  // needs min-max normalization
    },
    {
        id: 'containsElementary',
        label: 'Contains Elementary School',
        field: 'level',
        defaultWeight: 5,
        description: 'Binary flag: 1 if the school polygon contains an elementary school, 0 otherwise.',
        alreadyNormalized: true,  // binary 0/1
        isBinary: true,
    },
];

/**
 * Build default weights object from the variable definitions.
 * Returns { [variableId]: weightPercent, ... }
 */
export function getDefaultWeights() {
    const weights = {};
    for (const v of SCORING_VARIABLES) {
        weights[v.id] = v.defaultWeight;
    }
    return weights;
}

/**
 * Compute normalization context from all features.
 * Finds min/max of Join_Count and builds location-based elementary lookup
 * so co-located schools all share the elementary flag.
 */
function buildNormContext(features) {
    let maxJoinCount = 0;

    const percentiles = {
        CanopyHeatReliefScore: [],
        DisadvantagedCommunitiesScore: []
    };

    // Group features by location to propagate elementary status to co-located schools
    const locationElementary = new Set(); // Set of 'lat,lng' keys that contain elementary
    for (let i = 0; i < features.length; i++) {
        const props = features[i].properties;
        const jc = Number(props.Join_Count);
        if (!isNaN(jc) && jc > maxJoinCount) maxJoinCount = jc;

        const ch = Number(props.CanopyHeatReliefScore);
        if (!isNaN(ch)) percentiles.CanopyHeatReliefScore.push(ch);

        const dac = Number(props.DisadvantagedCommunitiesScore);
        if (!isNaN(dac)) percentiles.DisadvantagedCommunitiesScore.push(dac);

        const level = props.level || '';
        if (level.includes('Elementary')) {
            const key = `${props.lat},${props.long}`;
            locationElementary.add(key);
        }
    }

    // Sort the percentile arrays
    percentiles.CanopyHeatReliefScore.sort((a, b) => a - b);
    percentiles.DisadvantagedCommunitiesScore.sort((a, b) => a - b);

    return { maxJoinCount: maxJoinCount || 1, locationElementary, percentiles };
}

/**
 * Get individual component value (0–1) for a single feature.
 */
export function getComponentValue(feature, variable, normCtx) {
    const props = feature.properties;
    if (variable.isBinary) {
        // "Elementary" check: true if THIS school OR any co-located school is elementary
        const level = props[variable.field] || '';
        if (level.includes('Elementary')) return 1;
        // Check co-located schools
        const locKey = `${props.lat},${props.long}`;
        return normCtx.locationElementary.has(locKey) ? 1 : 0;
    }
    if (variable.usePercentile) {
        const val = Number(props[variable.field]);
        if (isNaN(val)) return 0;
        const arr = normCtx.percentiles[variable.field];
        if (!arr || arr.length === 0) return 0;
        // Binary search to find percentile rank
        let low = 0, high = arr.length - 1;
        while (low <= high) {
            const mid = (low + high) >> 1;
            if (arr[mid] < val) low = mid + 1;
            else if (arr[mid] > val) high = mid - 1;
            else {
                low = mid;
                break;
            }
        }
        return Math.max(0, Math.min(1, low / Math.max(1, arr.length - 1)));
    }
    if (variable.alreadyNormalized) {
        const val = Number(props[variable.field]);
        return isNaN(val) ? 0 : Math.max(0, Math.min(1, val));
    }
    // Join_Count normalization
    if (variable.field === 'Join_Count') {
        const val = Number(props[variable.field]);
        return isNaN(val) ? 0 : val / normCtx.maxJoinCount;
    }
    return 0;
}

/**
 * Compute Custom Greening Index scores for all features.
 * 
 * @param {Array} features - GeoJSON features array
 * @param {Object} weights - { variableId: weightPercent } (should sum to 100)
 * @returns {Float64Array} scores indexed by feature position (0–1, min-max normalized)
 */
export function computeScores(features, weights) {
    if (!features || features.length === 0) return new Float64Array(0);

    const normCtx = buildNormContext(features);
    const totalWeight = Object.values(weights).reduce((s, w) => s + w, 0) || 1;

    // Phase 1: Compute raw weighted sums
    const rawScores = new Float64Array(features.length);
    let rawMin = Infinity;
    let rawMax = -Infinity;

    for (let i = 0; i < features.length; i++) {
        let sum = 0;
        for (const variable of SCORING_VARIABLES) {
            const val = getComponentValue(features[i], variable, normCtx);

            // Overwrite the raw property with the calculated 0–1 percentile rank
            // so that the leaderboard dropdown properly sorts by it.
            // Since percentile of a percentile is the same value, this is safe to run repeatedly.
            if (variable.usePercentile) {
                features[i].properties[variable.field] = val;
            }

            const w = (weights[variable.id] || 0) / totalWeight;
            if (w === 0) continue;
            sum += val * w;
        }
        rawScores[i] = sum;
        if (sum < rawMin) rawMin = sum;
        if (sum > rawMax) rawMax = sum;
    }

    // Phase 2: Min-max normalize to 0–1
    const range = rawMax - rawMin || 1;
    const scores = new Float64Array(features.length);
    for (let i = 0; i < features.length; i++) {
        scores[i] = (rawScores[i] - rawMin) / range;
    }

    return scores;
}

/**
 * Get the component breakdown for a single feature (for DetailPanel).
 * Returns array of { id, label, value, weight } objects.
 */
export function getScoreBreakdown(feature, weights, allFeatures) {
    const normCtx = buildNormContext(allFeatures);
    const totalWeight = Object.values(weights).reduce((s, w) => s + w, 0) || 1;
    return SCORING_VARIABLES.map(v => ({
        id: v.id,
        label: v.label,
        value: getComponentValue(feature, v, normCtx),
        weight: (weights[v.id] || 0) / totalWeight,
        weightPercent: weights[v.id] || 0,
    }));
}

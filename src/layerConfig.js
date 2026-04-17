/**
 * ╔═══════════════════════════════════════════════════════════════════════=
 * ║  layerConfig.js — Map Layer Properties & Configuration                ║
 * ╚═══════════════════════════════════════════════════════════════════════â•
 *
 * ARCHITECTURE NOTES:
 *
 * CONFIGURATION STRUCTURE
 * - LAYER_CONFIG is the single source of truth for all map layers.
 * - Order in this array dictates the map's render order (from bottom to top).
 * 
 * CRITICAL FIELDS
 * - `layerType`: 
 *     'primary' indicates the schools dataset, which gets dynamically scored.
 *     'dataset' indicates a pick-one basal map metric (e.g. Tree Equity).
 *     'overlay' indicates toggleable points/polygons.
 *     'boundary' indicates passive shapes like watersheds.
 * - `keyFields`:
 *     Determines what shows up in the DetailPanel.
 *     Use format: 'percent-raw' for decimals (0.12), 'percent' for 0-100 values,
 *     'score' for customized UI green-text score formats, 'binary-yn' for 1/0 flags.
 * 
 * GOTCHAS
 * - Only the properties defined in `keyFields` will render in the detail panel.
 *   If you add a field to the Python export script but don't add it here, 
 *   it will be hidden from the user interface.
 */
// Helper to convert ArcGIS HSV to standard RGB hex for styling
function hsvToHex(h, s, v) {
    s /= 100; v /= 100;
    let c = v * s;
    let x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    let m = v - c;
    let r = 0, g = 0, b = 0;
    if (0 <= h && h < 60) { r = c; g = x; b = 0; }
    else if (60 <= h && h < 120) { r = x; g = c; b = 0; }
    else if (120 <= h && h < 180) { r = 0; g = c; b = x; }
    else if (180 <= h && h < 240) { r = 0; g = x; b = c; }
    else if (240 <= h && h < 300) { r = x; g = 0; b = c; }
    else if (300 <= h && h < 360) { r = c; g = 0; b = x; }

    r = Math.round((r + m) * 255);
    g = Math.round((g + m) * 255);
    b = Math.round((b + m) * 255);
    return `rgb(${r}, ${g}, ${b})`;
}

// Helper for Tree Equity Score (0-100)
// Low score = area needs trees = More Greening Opportunity (vibrant purple)
// High score = good tree equity = Less Opportunity (silver-blue)
function getTesColor(score) {
    if (score === null || isNaN(score)) return '#808080';
    const t = Math.max(0, Math.min(100, score)) / 100;
    // Hue: 285 (magenta-purple) -> 210 (blue-grey)
    // Sat: 90% -> 20%
    // Lit: 45% -> 78%
    const hue = Math.round(285 - t * 75);
    const sat = Math.round(90 - t * 70);
    const lit = Math.round(45 + t * 33);
    return `hsl(${hue}, ${sat}%, ${lit}%)`;
}

// Helper to interpolate between standard green to red based on a 0-1 score
// Green (0.0): #38A800 -> Yellow/Orange -> Red (1.0): #FF0000
function getGraduatedColor(score, metric) {
    if (score === null || isNaN(score)) return '#808080';

    // Linear mapping — preserves true data distribution without editorial transforms
    const val = Math.max(0, Math.min(1, score));

    // Simple hue interpolation: 120 (green) to 0 (red)
    const hue = val * 120; // 0=red(0°), 1=green(120°)
    return `hsl(${hue}, 100%, 45%)`;
}

// CES5 color breaks based on CIscore_Pctl
function getCesColor(pctl) {
    if (pctl === null || isNaN(pctl)) return '#808080';
    if (pctl <= 15.82) return 'rgb(0, 32, 77)';
    if (pctl <= 27.63) return 'rgb(0, 48, 111)';
    if (pctl <= 37.70) return 'rgb(42, 64, 108)';
    if (pctl <= 47.04) return 'rgb(71, 81, 107)';
    if (pctl <= 55.56) return 'rgb(94, 98, 110)';
    if (pctl <= 63.34) return 'rgb(114, 115, 116)';
    if (pctl <= 70.62) return 'rgb(136, 132, 121)';
    if (pctl <= 77.05) return 'rgb(159, 151, 119)';
    if (pctl <= 83.06) return 'rgb(183, 170, 113)';
    if (pctl <= 88.94) return 'rgb(208, 190, 103)';
    if (pctl <= 94.66) return 'rgb(234, 212, 87)';
    return 'rgb(255, 234, 69)';
}

// USFS tree canopy percentage classes (LA block groups)
function getCanopyColor(pct) {
    if (pct === null || isNaN(pct)) return '#9ca3af';
    // Deep forest greens are reached at 50% canopy.
    const t = Math.max(0, Math.min(50, Number(pct))) / 50;

    const hue = Math.round(75 + t * 80);
    const sat = Math.round(55 + t * 30);
    const lit = Math.round(88 - t * 63);

    return `hsl(${hue}, ${sat}%, ${lit}%)`;
}

// SCW Stormwater Opportunity Unique Values mapped to exact extracted RGBs
function getScwStormColor(val) {
    const map = {
        "General (Wet or Dry)": "rgb(233, 255, 190)",
        "General (Wet)": "rgb(190, 210, 255)",
        "High (Wet or Dry)": "rgb(209, 255, 115)",
        "High (Wet)": "rgb(115, 178, 255)",
        "Higher (Wet or Dry)": "rgb(170, 255, 0)",
        "Higher (Wet)": "rgb(0, 112, 255)",
        "Highest (Wet or Dry)": "rgb(152, 230, 0)",
        "Highest (Wet)": "rgb(0, 92, 230)"
    };
    return map[val] || "rgb(128,128,128)";
}

// SCW Water Quality Unique Values
function getScwWQColor(val) {
    const map = {
        "General": "rgb(190, 210, 255)",
        "General (Water Quality Only)": "rgb(233, 255, 190)",
        "High": "rgb(115, 178, 255)",
        "High (Water Quality Only)": "rgb(209, 255, 115)",
        "Higher": "rgb(0, 112, 255)",
        "Higher (Water Quality Only)": "rgb(170, 255, 0)",
        "Highest": "rgb(0, 77, 168)",
        "Highest (Water Quality Only)": "rgb(152, 230, 0)"
    };
    return map[val] || "rgb(128,128,128)";
}

export function getSoilColor(val) {
    const map = {
        "A": hsvToHex(254, 87, 63),
        "B": hsvToHex(242, 66, 71),
        "C": hsvToHex(224, 65, 80),
        "B/D": hsvToHex(210, 69, 89),
        "C/D": hsvToHex(210, 48, 91),
        "D": hsvToHex(203, 33, 93),
        "<Null>": "rgba(0, 0, 0, 0)"
    };
    return map[val] || "rgb(128,128,128)";
}

export function getSgmaColor(priority) {
    if (!priority) return 'rgba(156, 163, 175, 0.4)'; // Gray
    if (priority.includes('High')) return 'rgba(239, 68, 68, 0.5)'; // Red
    if (priority.includes('Medium')) return 'rgba(249, 115, 22, 0.4)'; // Orange
    if (priority.includes('Very low')) return 'rgba(34, 197, 94, 0.4)'; // Green
    if (priority.includes('Low')) return 'rgba(250, 204, 21, 0.4)'; // Yellow
    return 'rgba(156, 163, 175, 0.4)'; // Default gray
}

export function getSgmaDescription(priority) {
    if (!priority) return 'Priority unassigned.';
    if (priority.includes('not subject to SGMA')) return 'Not required to form Groundwater Sustainability Agencies (GSAs) or develop sustainability plans.';
    return 'Mandated by California to form GSAs and develop Groundwater Sustainability Plans (GSPs) to manage groundwater for long-term sustainability.';
}

const LAYER_CONFIG = [
    {
        id: 'schools_andparks',
        name: 'School Indices (CSCD, 2025)',
        detailLabel: 'Traditional Public Schools, K-12',
        file: '/data/finalschoolswithdatareal.bin',
        color: '#0891b2',
        description: 'Schools with graduated score coloring (Green=Low, Red=High)',
        defaultVisible: true,
        nameField: 'School',
        category: 'overlays',
        radius: 60,
        strokeOpacity: 0.8,
        dynamicColor: (feature, metric = 'CWHScore') => getGraduatedColor(feature.properties[metric], metric),
        legend: {
            type: 'gradient',
            label: 'School Ranking (Red to Green)',
            stops: [
                { color: 'hsl(0, 100%, 45%)', label: 'Lowest Opportunity' },
                { color: 'hsl(60, 100%, 45%)', label: 'Medium' },
                { color: 'hsl(120, 100%, 45%)', label: 'Highest Opportunity' }
            ]
        },
        keyFields: [
            { key: 'School', label: 'School Name' },
            { key: 'CWHScore', label: 'Custom Greening Index', format: 'score', trendText: '(Higher = More Opportunity)' },
            { key: 'CanopyHeatReliefScore', label: 'Canopy Heat Relief', format: 'score', trendText: '(Higher = More Opportunity)' },
            { key: 'DisadvantagedCommunitiesScore', label: 'Community Opportunity Score', format: 'score', trendText: '(Higher = More Opportunity)' },
            { key: 'infilpot_pctl', label: 'Infiltration Potential (Percentile)', format: 'score', trendText: '(Higher = More Opportunity)' },
            { key: 'Join_Count', label: '# Parks within a 1/4 mile', format: 'number' },
            { key: 'ContainsElementary', label: 'Contains Elementary School', format: 'binary-yn' },
            { key: 'Open', label: 'Open?', format: 'open-yn' },
        ]
    },
    {
        id: 'gsa_2024',
        name: 'Schools (Green Schoolyards America)',
        file: '/data/gsa_2024.geojson',
        color: '#c084fc', // Light Purple (Purple 400)
        weight: 1,
        fillColor: 'rgba(192, 132, 252, 0.5)', // Light Purple fill
        description: 'Green Schoolyards America 2024 dataset.',
        defaultVisible: false,
        nameField: 'SchoolName',
        category: 'overlays',
        radius: 4,
        radiusByZoom: { min: 2, max: 8, minZoom: 10, maxZoom: 18 },
        strokeOpacity: 0.75,
        legend: {
            type: 'solid',
            color: 'rgba(192, 132, 252, 0.4)'
        },
        keyFields: [
            { key: 'SchoolName', label: 'School Name' },
            { key: 'District', label: 'School District' },
            { key: 'City', label: 'City' },
            { key: 'County', label: 'County' },
            { key: 'CpTotEnr23', label: 'Campus Total Enrollment (2023)', format: 'number' },
            { key: 'GSYschlprp', label: 'Green Schoolyard Property', format: 'number' },
            { key: 'DistAvT', label: 'District Average Tree Canopy', format: 'percent-raw' },
            { key: 'PropPct', label: 'Property Percent Tree Canopy', format: 'percent-raw' },
            { key: 'FPct', label: 'Free/Reduced Price Meals Percentage', format: 'percent-raw' },
            { key: 'StPct', label: 'State Percent Cover', format: 'percent-raw' }
        ]
    },
    {
        id: 'school_trees',
        name: 'LAUSD School Trees (TreeKeeper)',
        detailLabel: 'Individual Tree Specimens',
        file: '/data/school_trees_compact.json',
        compactFormat: true, // Decoded at load time from flat-array format
        clustered: true, // Use marker clustering for 82K+ points
        maxClusterRadius: 40, // Tighter radius to avoid entire campus spiraling from one point
        disableClusteringAtZoom: 16,
        color: '#16a34a', // Green 600
        description: 'Individual tree inventory from trees.school (82,000+ points).',
        defaultVisible: false,
        nameField: 'c',
        category: 'overlays',
        radius: 2,
        radiusByZoom: { min: 2, max: 10, minZoom: 14, maxZoom: 20 },
        weight: 0,
        strokeOpacity: 0,
        dynamicColor: (feature) => {
            const cond = (feature.properties.condition || '').toLowerCase();
            if (cond === 'excellent') return '#15803d'; // Green 700
            if (cond === 'good') return '#22c55e';      // Green 500
            if (cond === 'fair') return '#eab308';      // Yellow 500
            if (cond === 'poor') return '#ef4444';      // Red 500
            if (cond === 'critical' || cond === 'dead') return '#78716c'; // Stone 500
            return '#16a34a'; // Default green
        },
        legend: {
            type: 'categorical',
            items: [
                { value: 'Excellent/Good', color: '#22c55e' },
                { value: 'Fair', color: '#eab308' },
                { value: 'Poor', color: '#ef4444' },
                { value: 'Dead/Critical', color: '#78716c' }
            ]
        },
        keyFields: [
            { key: 'b', label: 'Botanical Name' },
            { key: 'c', label: 'Common Name' },
            { key: 'd', label: 'Condition' },
            { key: 's', label: 'School Property' },
            { key: 'treeCount', label: 'Tree Count', format: 'number' }
        ]
    },
    {
        id: 'parks_public',
        name: 'Parks with Public Access (LA County)',
        file: '/data/countywide_parks.bin',
        color: '#000000',
        fillColor: 'rgba(0,197,255,0.4)',
        description: 'Countywide public parks',
        defaultVisible: false,
        nameField: 'PARK_NAME',
        category: 'overlays',
        color: '#009adb',
        weight: 1.5,
        fillColor: 'url(#park-pattern)',
        fillOpacity: 1, // Pattern has native opacity encoded
        legend: {
            type: 'solid',
            color: 'rgba(0,197,255,0.4)'
        },
        keyFields: [
            { key: 'PARK_NAME', label: 'Park Name' }
        ]
    },


    {
        id: 'ces_5',
        name: 'CalEnviroScreen 5.0 (Draft)',
        file: '/data/ces.bin',
        color: '#000000',
        description: 'CalEnviroScreen 5.0 Percentiles',
        defaultVisible: false,
        nameField: 'AppoxLoc',
        category: 'datasets',
        dynamicColor: (feature) => getCesColor(feature.properties.CIscore_Pctl),
        legend: {
            type: 'gradient',
            label: 'CalEnviroScreen 5.0 Percentile',
            stops: [
                { color: 'rgb(0, 32, 77)', label: '0% (Less Opportunity)' },
                { color: 'rgb(114, 115, 116)', label: '50%' },
                { color: 'rgb(255, 234, 69)', label: '100% (More Opportunity)' }
            ]
        },
        keyFields: [
            { key: 'tract', label: 'Census Tract' },
            { key: 'AppoxLoc', label: 'Location' },
            { key: 'CIscore_Pctl', label: 'Cumulative Impact Percentile', format: 'percentile', trendText: '(Higher = More Opportunity)', description: 'Combined score of pollution burden and population vulnerability, as a statewide percentile.' },
            { key: 'Poverty_Pctl', label: 'Poverty Percentile', format: 'percentile', trendText: '(Higher = More Opportunity)', description: 'Percentage of population living below twice the federal poverty level.' },
            { key: 'Pollution_Pctl', label: 'Pollution Burden Percentile', format: 'percentile', trendText: '(Higher = More Opportunity)', description: 'Combined exposure and environmental effects score (air quality, water, toxic releases, etc.).' }
        ]
    },
    {
        id: 'tree_equity',
        name: 'Tree Equity Score (2025)',
        file: '/data/tree_equity.bin',
        color: '#000000',
        fillColor: 'rgb(252,235,194)',
        description: 'Tree Equity Score polygons',
        defaultVisible: false,
        nameField: 'place',
        category: 'datasets',
        dynamicColor: (feature) => getTesColor(feature.properties.tes),
        legend: {
            type: 'gradient',
            label: 'Tree Equity Score',
            stops: [
                { color: 'hsl(285, 90%, 45%)', label: '0 (More Opportunity)' },
                { color: 'hsl(248, 55%, 62%)', label: '50' },
                { color: 'hsl(210, 20%, 78%)', label: '100 (Less Opportunity)' }
            ]
        },
        keyFields: [
            { key: 'place', label: 'Place' },
            { key: 'tes', label: 'Tree Equity Score', format: 'score', trendText: '(Higher = Less Opportunity)', description: 'Composite 0–100 score from American Forests measuring how equitably trees are distributed. Lower = greater need for planting.' },
            { key: 'treecanopy', label: 'Existing Tree Canopy', format: 'percent' },
            { key: 'tc_goal', label: 'Tree Canopy Goal', format: 'percent' },
            { key: 'tc_gap', label: 'Tree Canopy Gap', format: 'percent' },
            { key: 'pctpoc', label: 'People of Color', format: 'percent' },
            { key: 'pctpov', label: 'Poverty Rate', format: 'percent' },
            { key: 'unemplrate', label: 'Unemployment Rate', format: 'percent' },
            { key: 'linguistic', label: 'Linguistic Isolation', format: 'percent' },
            { key: 'dep_perc', label: 'Age Dependents', format: 'percent' },
            { key: 'temp_diff', label: 'Heat Disparity (°F vs. Urban Avg)', format: 'number' }
        ]
    },
    {
        id: 'lariac7_canopy',
        name: 'Tree Canopy Coverage (USFS)',
        detailLabel: 'Tree Canopy Coverage — Census Block Group',
        file: '/data/canopy_blockgroups_lacounty.bin',
        color: '#16a34a', // Emerald Green
        fillColor: 'rgba(22, 163, 74, 0.1)',
        description: 'Tree canopy coverage by census block group for LA County (USFS Land Cover & Tree Canopy Analysis, NAIP-derived).',
        defaultVisible: false,
        nameField: 'GEOID',
        category: 'datasets',
        fillOpacity: 0.45,
        weight: 0.5,
        strokeOpacity: 0.6,
        dynamicColor: (feature) => getCanopyColor(feature.properties.TC_Pct),
        // Keep class boundaries readable instead of tinting outlines same as fill.
        dynamicStrokeColor: () => '#334155',
        legend: {
            type: 'gradient',
            label: 'Tree Canopy Coverage (USFS)',
            stops: [
                { color: 'hsl(75, 55%, 88%)', label: '0%' },
                { color: 'hsl(115, 70%, 56%)', label: '25%' },
                { color: 'hsl(155, 85%, 25%)', label: '50%+' }
            ]
        },
        keyFields: [
            { key: 'GEOID', label: 'Census Block Group' },
            { key: 'TC_Pct', label: 'Tree Canopy Cover (%)', format: 'number' },
            { key: 'TC_Ac', label: 'Tree Canopy Cover (acres)', format: 'number' },
            { key: 'To_TC_Pct', label: 'Total Tree + Shrub Cover (%)', format: 'number' },
            { key: 'To_TC_Ac', label: 'Total Tree + Shrub Cover (acres)', format: 'number' },
            { key: 'Herb_Pct', label: 'Herbaceous / Grass Cover (%)', format: 'number' },
            { key: 'Soil_Pct', label: 'Bare Soil (%)', format: 'number' },
            { key: 'IA_Pct', label: 'Impervious Surface (%)', format: 'number' },
            { key: 'Total_Ac', label: 'Total Area (acres)', format: 'number' },
            { key: 'Land_Ac', label: 'Land Area (acres)', format: 'number' }
        ]
    },
    {
        id: 'scw_groundwater',
        name: 'Groundwater Opportunity (SCWP)',
        file: '/data/scw_groundwater.bin',
        color: '#000000',
        fillColor: 'rgb(0,197,255)',
        description: 'SCWP groundwater recharge opportunity areas prioritizing unconfined aquifers and upstream capture zones.',
        defaultVisible: false,
        nameField: 'Opportunit',
        category: 'datasets',
        legend: {
            type: 'solid',
            color: 'rgb(0,197,255)'
        },
        keyFields: [
            { key: 'Opportunit', label: 'Opportunity Score' }
        ]
    },
    {
        id: 'scw_stormwater',
        name: 'Stormwater Opportunity (SCWP)',
        file: '/data/scw_stormwater.bin',
        color: '#000000',
        description: 'SCWP stormwater capture opportunity classes (smoothed). "Wet" = storm-event capture only; "Wet or Dry" = storm-event plus dry-weather/baseflow capture potential.',
        defaultVisible: false,
        nameField: 'Opp_Score',
        category: 'datasets',
        dynamicColor: (feature) => getScwStormColor(feature.properties.Opp_Score),
        legend: {
            type: 'categorical',
            note: '"Wet" means storm-event capture only. "Wet or Dry" means opportunity in both wet-weather and dry-weather/baseflow conditions.',
            items: [
                { value: "Highest (Wet)", color: getScwStormColor("Highest (Wet)") },
                { value: "Highest (Wet or Dry)", color: getScwStormColor("Highest (Wet or Dry)") },
                { value: "Higher (Wet)", color: getScwStormColor("Higher (Wet)") },
                { value: "Higher (Wet or Dry)", color: getScwStormColor("Higher (Wet or Dry)") },
                { value: "High (Wet)", color: getScwStormColor("High (Wet)") },
                { value: "High (Wet or Dry)", color: getScwStormColor("High (Wet or Dry)") },
                { value: "General (Wet)", color: getScwStormColor("General (Wet)") },
                { value: "General (Wet or Dry)", color: getScwStormColor("General (Wet or Dry)") }
            ]
        },
        keyFields: [
            { key: 'Opp_Score', label: 'Opportunity Score' }
        ]
    },
    {
        id: 'scw_water_quality',
        name: 'Opportunity to Improve Water Quality and Increase Water Supply (SCWP)',
        file: '/data/scw_waterquality.bin',
        color: '#000000',
        description: 'SCWP water quality and water supply opportunity classes (smoothed). "(Water Quality Only)" indicates pollutant-load reduction benefit without meaningful added water-supply benefit.',
        defaultVisible: false,
        nameField: 'Opportunit',
        category: 'datasets',
        dynamicColor: (feature) => getScwWQColor(feature.properties.Opportunit),
        legend: {
            type: 'categorical',
            note: '"(Water Quality Only)" indicates areas expected to improve pollutant reduction but not add meaningful water-supply yield.',
            items: [
                { value: "Highest", color: getScwWQColor("Highest") },
                { value: "Highest (Water Quality Only)", color: getScwWQColor("Highest (Water Quality Only)") },
                { value: "Higher", color: getScwWQColor("Higher") },
                { value: "Higher (Water Quality Only)", color: getScwWQColor("Higher (Water Quality Only)") },
                { value: "High", color: getScwWQColor("High") },
                { value: "High (Water Quality Only)", color: getScwWQColor("High (Water Quality Only)") },
                { value: "General", color: getScwWQColor("General") },
                { value: "General (Water Quality Only)", color: getScwWQColor("General (Water Quality Only)") }
            ]
        },
        keyFields: [
            { key: 'Opportunit', label: 'Opportunity Score' }
        ]
    },
    {
        id: 'soil_polygons',
        name: 'Soil Types (gNATSGO)',
        file: '/data/mupolygon.bin',
        color: '#000000',
        description: 'Soil types with unique value coloring (A, B, C, B/D, C/D, D)',
        defaultVisible: false,
        nameField: 'hydgrpdcd',
        category: 'datasets',
        exactFieldsOnly: true,
        dynamicColor: (feature) => getSoilColor(feature.properties.hydgrpdcd || 'D'),
        legend: {
            type: 'categorical',
            note: 'Most infiltration -> least infiltration',
            items: [
                { value: 'A - 100%', color: hsvToHex(254, 87, 63) },
                { value: 'B - 66%', color: hsvToHex(242, 66, 71) },
                { value: 'C - 33%', color: hsvToHex(224, 65, 80) },
                { value: 'B/D - 10%', color: hsvToHex(210, 69, 89) },
                { value: 'C/D - 10%', color: hsvToHex(210, 48, 91) },
                { value: 'D - 10%', color: hsvToHex(203, 33, 93) }
            ]
        },
        keyFields: [
            { key: 'hydgrpdcd', label: 'Hydrologic Group' }
        ]
    },
    // ═══ Storm Drain Network (SDN) ═══
    {
        id: 'sdn_open_channel',
        name: 'Open Channels',
        file: '/data/sdn/OpenChannel.bin',
        color: '#0f172a',
        weight: 2.2,
        lineWeightByZoom: { min: 2.2, max: 4.2, minZoom: 9, maxZoom: 18 },
        minClickWeight: 4,
        smoothFactor: 1.6,
        fillColor: 'transparent',
        description: 'LA County Flood Control open channels and rivers.',
        defaultVisible: false,
        nameField: 'NAME',
        category: 'sdn',
        strokeOpacity: 0.9,
        legend: { type: 'solid', color: '#0f172a' },
        keyFields: [
            { key: 'NAME', label: 'Channel Name' },
            { key: 'WIDTH', label: 'Width (ft)', format: 'number' },
            { key: 'MATERIAL', label: 'Material' },
            { key: 'SD_TYPE', label: 'Type' },
            { key: 'OWNER', label: 'Owner' }
        ],
        detailLabel: 'Storm Drain Infrastructure',
    },
    {
        id: 'sdn_gravity_main',
        name: 'Gravity Mains',
        file: '/data/sdn/GravityMain.bin',
        color: '#3b82f6',
        weight: 0.8,
        minClickWeight: 1.8,
        smoothFactor: 2.4,
        fillColor: 'transparent',
        description: 'Storm drain gravity mains (185K+ segments).',
        defaultVisible: false,
        nameField: 'NAME',
        category: 'sdn',
        prefetch: true,
        clickOnly: true,
        strokeOpacity: 0.9,
        legend: { type: 'solid', color: '#3b82f6' },
        keyFields: [
            { key: 'NAME', label: 'Name' },
            { key: 'DIAMETER_HEIGHT', label: 'Diameter/Height (in)', format: 'number' },
            { key: 'MATERIAL', label: 'Material' }
        ],
        detailLabel: 'Storm Drain Infrastructure',
    },
    {
        id: 'sdn_lateral_line',
        name: 'Lateral Lines',
        file: '/data/sdn/LateralLine.bin',
        color: '#818cf8',
        weight: 0.6,
        minClickWeight: 1.8,
        smoothFactor: 2.6,
        fillColor: 'transparent',
        description: 'Storm drain lateral connections (170K+ segments).',
        defaultVisible: false,
        category: 'sdn',
        prefetch: true,
        clickOnly: true,
        strokeOpacity: 0.9,
        legend: { type: 'solid', color: '#818cf8' },
        keyFields: [
            { key: 'DIAMETER_HEIGHT', label: 'Diameter/Height (in)', format: 'number' },
            { key: 'MATERIAL', label: 'Material' }
        ],
        detailLabel: 'Storm Drain Infrastructure',
    },
    {
        id: 'sdn_culvert',
        name: 'Culverts',
        file: '/data/sdn/Culvert.geojson',
        color: '#22d3ee',
        weight: 2.2,
        lineWeightByZoom: { min: 2.2, max: 4.2, minZoom: 9, maxZoom: 18 },
        minClickWeight: 4,
        fillColor: 'transparent',
        description: 'Storm drain culverts.',
        defaultVisible: false,
        nameField: 'NAME',
        category: 'sdn',
        strokeOpacity: 0.9,
        legend: { type: 'solid', color: '#22d3ee' },
        keyFields: [
            { key: 'NAME', label: 'Name' },
            { key: 'DIAMETER_HEIGHT', label: 'Diameter/Height (in)', format: 'number' },
            { key: 'MATERIAL', label: 'Material' },
            { key: 'OWNER', label: 'Owner' }
        ],
        detailLabel: 'Storm Drain Infrastructure',
    },
    {
        id: 'sdn_natural_drainage',
        name: 'Natural Drainage',
        file: '/data/sdn/NaturalDrainage.geojson',
        color: '#2dd4bf',
        weight: 2.2,
        lineWeightByZoom: { min: 2.2, max: 4.2, minZoom: 9, maxZoom: 18 },
        minClickWeight: 4,
        fillColor: 'transparent',
        description: 'Natural drainage channels.',
        defaultVisible: false,
        nameField: 'NAME',
        category: 'sdn',
        strokeOpacity: 0.9,
        legend: { type: 'solid', color: '#2dd4bf' },
        keyFields: [
            { key: 'NAME', label: 'Name' },
            { key: 'WIDTH', label: 'Width (ft)', format: 'number' }
        ],
        detailLabel: 'Storm Drain Infrastructure',
    },
    {
        id: 'sdn_force_main',
        name: 'Force Mains',
        file: '/data/sdn/ForceMain.geojson',
        color: '#d946ef',
        weight: 2.2,
        lineWeightByZoom: { min: 2.2, max: 4.2, minZoom: 9, maxZoom: 18 },
        minClickWeight: 4,
        fillColor: 'transparent',
        description: 'Pressurized storm drain force mains.',
        defaultVisible: false,
        nameField: 'NAME',
        category: 'sdn',
        strokeOpacity: 0.9,
        legend: { type: 'solid', color: '#d946ef' },
        keyFields: [
            { key: 'NAME', label: 'Name' },
            { key: 'DIAMETER', label: 'Diameter (in)', format: 'number' },
            { key: 'MATERIAL', label: 'Material' }
        ],
        detailLabel: 'Storm Drain Infrastructure',
    },
    {
        id: 'sdn_permitted_connection',
        name: 'Permitted Connections',
        file: '/data/sdn/PermittedConnection.bin',
        color: '#f43f5e', // Vibrant Rose/Pink (Not green)
        weight: 2.2,
        lineWeightByZoom: { min: 2.2, max: 4.2, minZoom: 9, maxZoom: 18 },
        minClickWeight: 4,
        smoothFactor: 2.0,
        fillColor: 'transparent',
        description: 'Permitted storm drain connections.',
        defaultVisible: false,
        category: 'sdn',
        clickOnly: true,
        strokeOpacity: 0.9,
        legend: { type: 'solid', color: '#f43f5e' },
        keyFields: [
            { key: 'PERMIT_NO', label: 'Permit Number' },
            { key: 'DIAMETER', label: 'Diameter (in)', format: 'number' }
        ],
        detailLabel: 'Storm Drain Infrastructure',
    },
    {
        id: 'sdn_catch_basin',
        name: 'Catch Basins',
        file: '/data/sdn/CatchBasin.bin',
        color: '#78350f',
        fillColor: '#78350f',
        clustered: true,
        disableClusteringAtZoom: 14,
        description: 'Stormwater catch basins / inlets (167K+ points).',
        defaultVisible: false,
        category: 'sdn',
        clickOnly: true,
        radius: 2.2,
        minClickRadius: 2.5,
        radiusByZoom: { min: 0.1, max: 12.0, minZoom: 10, maxZoom: 18 },
        weight: 0,
        strokeOpacity: 0,
        legend: { type: 'solid', color: '#78350f' },
        keyFields: [
            { key: 'SUBTYPE', label: 'Subtype' },
            { key: 'BMP', label: 'BMP Type' }
        ],
        detailLabel: 'Storm Drain Infrastructure',
    },
    {
        id: 'sdn_maintenance_hole',
        name: 'Maintenance Holes',
        file: '/data/sdn/MaintenanceHole.bin',
        color: '#fbbf24',
        fillColor: '#fbbf24',
        clustered: true,
        disableClusteringAtZoom: 14,
        description: 'Storm drain maintenance holes (75K+ points).',
        defaultVisible: false,
        category: 'sdn',
        clickOnly: true,
        radius: 2.2,
        minClickRadius: 2.5,
        radiusByZoom: { min: 0.1, max: 12.0, minZoom: 10, maxZoom: 18 },
        weight: 0,
        strokeOpacity: 0,
        legend: { type: 'solid', color: '#fbbf24' },
        keyFields: [
            { key: 'SUBTYPE', label: 'Subtype' }
        ],
        detailLabel: 'Storm Drain Infrastructure',
    },
    {
        id: 'sdn_pump_station',
        name: 'Pump Stations',
        file: '/data/sdn/PumpStation.geojson',
        color: '#8b5cf6',
        fillColor: '#8b5cf6',
        description: 'Storm drain pump stations.',
        defaultVisible: false,
        nameField: 'NAME',
        category: 'sdn',
        radius: 5,
        radiusByZoom: { min: 3, max: 8, minZoom: 10, maxZoom: 16 },
        weight: 1,
        strokeOpacity: 0.8,
        legend: { type: 'solid', color: '#8b5cf6' },
        keyFields: [
            { key: 'NAME', label: 'Station Name' },
            { key: 'CAPACITY', label: 'Capacity', format: 'number' },
            { key: 'NO_PUMPS', label: 'Number of Pumps', format: 'number' }
        ]
    },
    {
        id: 'watershed_boundaries',
        name: 'Watershed Area Boundaries (SCWP)',
        file: '/data/watershed_boundaries.bin',
        color: '#475569',
        weight: 3,
        fillColor: 'transparent',
        isBoundary: true,
        description: 'Safe Clean Water Program Watershed Area Boundaries.',
        defaultVisible: false,
        nameField: 'name',
        category: 'overlays',
        legend: {
            type: 'solid',
            color: '#475569'
        },
        keyFields: [
            { key: 'name', label: 'Watershed Area Name' }
        ]
    },
    {
        id: 'watershed_subbasins',
        name: 'Watershed Subbasins',
        file: '/data/Watershed/Watersheds subbasins.bin',
        color: '#2563eb', // Blue border
        weight: 1,
        fillColor: '#2563eb',
        fillOpacity: 0.01, // Near-invisible fill so polygons remain easy to click
        isBoundary: true,
        interactive: true,
        showLabels: false,
        description: 'Finer granular division of major watershed drainages.',
        defaultVisible: false,
        nameField: 'NAME',
        category: 'overlays',
        legend: {
            type: 'solid',
            color: '#2563eb'
        },
        keyFields: [
            { key: 'NAME', label: 'Subbasin Name' },
            { key: 'NAME2', label: 'Alternative Name' }
        ]
    },
    {
        id: 'groundwater_basins',
        name: 'Groundwater Basins (SGMA)',
        file: '/data/Watershed/Groundwater basins.geojson',
        color: '#475569',
        weight: 2,
        description: 'Groundwater basin delineations colored by SGMA Priority.',
        defaultVisible: false,
        nameField: 'Basin_Name',
        category: 'overlays',
        dynamicColor: (feature) => getSgmaColor(feature.properties.Priority),
        legend: {
            type: 'categorical',
            items: [
                { value: 'High', color: getSgmaColor('High') },
                { value: 'Medium', color: getSgmaColor('Medium') },
                { value: 'Low', color: getSgmaColor('Low') },
                { value: 'Very Low', color: getSgmaColor('Very low') }
            ]
        },
        keyFields: [
            { key: 'Basin_Name', label: 'Basin Name' },
            { key: 'Basin_Subbasin_Name', label: 'Subbasin Name' },
            { key: 'Priority', label: 'SGMA Priority', format: 'sgma-desc' }
        ]
    }
];

export const CATEGORIES = {
    overlays: { label: 'Overlays' },
    datasets: { label: 'Datasets (pick one)' },
    sdn: { label: 'Storm Drain Network (SDN)' },
};

export function formatValue(value, format) {
    if (value === null || value === undefined || value === '' || value === 'nan' || value === 'NaN') return '—';
    switch (format) {
        case 'open-yn':
            return String(value).toUpperCase() === 'TRUE' ? 'Yes' : 'No';
        case 'binary-yn':
            return value === 1 || value === true ? 'Yes' : 'No';
        case 'score':
            return typeof value === 'number' ? value.toFixed(3) : value;
        case 'percent':
            return typeof value === 'number' ? (value * 100 < 2 ? value.toFixed(4) : value.toFixed(2)) + '%' : value;
        case 'percent-raw':
            return typeof value === 'number' ? value.toFixed(2) + '%' : value;
        case 'percentile':
            return typeof value === 'number' ? value.toFixed(1) + 'th' : value;
        case 'number':
            return typeof value === 'number' ? value.toLocaleString(undefined, { maximumFractionDigits: 1 }) : value;
        case 'currency':
            return typeof value === 'number' ? '$' + value.toLocaleString(undefined, { maximumFractionDigits: 0 }) : value;
        case 'coord':
            return typeof value === 'number' ? value.toFixed(6) : value;
        case 'sgma-desc':
            return value + ' — ' + getSgmaDescription(value);
        default:
            return String(value);
    }
}

export default LAYER_CONFIG;

/**
 * Format hints for "Additional Fields" that aren't in keyFields.
 * DetailPanel uses these to display raw property values correctly.
 * 'percent' = stored as 0-1, display as ×100 with % sign.
 */
export const FIELD_FORMATS = {
    // Tree Equity Score — 0-1 decimal fields
    treecanopy: 'percent', tc_goal: 'percent', tc_gap: 'percent',
    pctpoc: 'percent', pctpov: 'percent', unemplrate: 'percent',
    linguistic: 'percent', dep_perc: 'percent', child_perc: 'percent',
    seniorperc: 'percent',
    // Normalized 0-1 fields — display as decimal (already fine)
    pctpocnorm: 'percent', pctpovnorm: 'percent', unemplnorm: 'percent',
    depratnorm: 'percent', lingnorm: 'percent',
};

/**
 * Human-readable aliases for raw GeoJSON property keys.
 * Used by DetailPanel to rename the "Additional Fields" section entries.
 */
export const FIELD_ALIASES = {
    // ── School Indices (CWH) ──
    cdscode: 'CDS School Code',
    level: 'School Level',
    Ed_Type: 'School Type',
    Street: 'Street Address',
    Impermeable_SqFt: 'Impermeable Area (sq ft) (SCW 2023)',
    Soil_Score_Average: 'Avg Soil Infiltration Score',
    InfilPot_Raw: 'Infiltration Potential (Raw)',
    InfilPot_Normalized: 'Infiltration Potential (Normalized)',
    Temp_Norm: 'Surface Temperature (Normalized) (TES)',
    TC_Gap: 'Tree Canopy Gap (%) (TES)',
    TreeCoverage: 'Tree Coverage (%) (TES)',
    treecanopynorm: 'Tree Coverage (Normalized) (TES)',
    PreliminaryScore: 'Preliminary Score',
    DisadvantagedCommunitiesScore: 'Community Opportunity Score',
    CanopyHeatReliefScore: 'Canopy Heat Relief Score',
    infilpot_pctl: 'Infiltration Potential (Percentile)',
    Poverty_Pctl: 'Poverty Percentile (CES)',
    CIscore_Pctl: 'Cumulative Impact Percentile (CES)',

    // ── Tree Equity Score (American Forests) ──
    _bld1200: 'Building Shadow (12:00 PM)',
    _veg1200: 'Vegetation Shadow (12:00 PM)',
    _tot1200: 'Total Shadow (12:00 PM)',
    _bld1500: 'Building Shadow (3:00 PM)',
    _veg1500: 'Vegetation Shadow (3:00 PM)',
    _tot1500: 'Total Shadow (3:00 PM)',
    _bld1800: 'Building Shadow (6:00 PM)',
    _veg1800: 'Vegetation Shadow (6:00 PM)',
    _tot1800: 'Total Shadow (6:00 PM)',
    GEOID: 'Census Block Group ID',
    state: 'State',
    state_abbr: 'State Abbreviation',
    county: 'County',
    ua_name: 'Urban Area Name',
    ua_pop: 'Urban Area Population',
    congressio: 'Congressional District',
    cbg_pop: 'Block Group Population',
    acs_pop: 'ACS Survey Population',
    land_area: 'Land Area (sq mi)',
    biome: 'Biome Type',
    cnpysource: 'Canopy Data Source',
    tc_goal: 'Tree Canopy Goal (%)',
    treecanopy: 'Existing Tree Canopy (%)',
    tc_gap: 'Tree Canopy Gap (%)',
    priority_i: 'Planting Priority Index',
    pctpoc: 'People of Color (%)',
    pctpocnorm: 'People of Color (Normalized)',
    pctpov: 'Poverty Rate (%)',
    pctpovnorm: 'Poverty Rate (Normalized)',
    unemplrate: 'Unemployment Rate (%)',
    unemplnorm: 'Unemployment Rate (Normalized)',
    dep_ratio: 'Age Dependency Ratio',
    dep_perc: 'Dependents as % of Population',
    depratnorm: 'Dependency Ratio (Normalized)',
    linguistic: 'Linguistic Isolation (%)',
    lingnorm: 'Linguistic Isolation (Normalized)',
    health_nor: 'Health Burden Index (Normalized)',
    temp_diff: 'Heat Disparity (°F vs. Urban Avg)',
    temp_norm: 'Surface Temperature (Normalized)',
    tesctyscor: 'City-Wide Tree Equity Score',
    holc_grade: 'Historic Redlining Grade (HOLC)',
    child_perc: 'Children as % of Population',
    seniorperc: 'Seniors as % of Population',
    ej_disadva: 'EJ Disadvantaged Community',
    rank: 'Block Group Rank',
    rankgrpsz: 'Rank Group Size',

    // ── CalEnviroScreen 5.0 (OEHHA) ──
    region: 'Region',
    Population: 'Population',
    CIscore: 'Cumulative Impact Score',
    CIscore_Pctl: 'Cumulative Impact Percentile (CES)',
    AirOzone: 'Ozone Concentration',
    AirOzone_Pctl: 'Ozone Percentile',
    AirPM25: 'PM2.5 Concentration',
    AirPM25_Pctl: 'PM2.5 Percentile',
    ChildLead: 'Children\'s Lead Risk',
    ChildLead_Pctl: 'Children\'s Lead Risk Percentile',
    DieselPM: 'Diesel Particulate Matter',
    DieselPM_Pctl: 'Diesel PM Percentile',
    DrinkingWater: 'Drinking Water Contaminants',
    DrinkingWater_Pctl: 'Drinking Water Percentile',
    Pesticides: 'Pesticide Use',
    Pesticides_Pctl: 'Pesticide Use Percentile',
    ToxReleases: 'Toxic Releases from Facilities',
    ToxReleases_Pctl: 'Toxic Releases Percentile',
    TrafficImp: 'Traffic Impacts',
    TrafficImp_Pctl: 'Traffic Impacts Percentile',
    CleanupSites: 'Cleanup Sites',
    CleanupSites_Pctl: 'Cleanup Sites Percentile',
    gwthreats: 'Groundwater Threats',
    GWThreats_Pctl: 'Groundwater Threats Percentile',
    HazWaste: 'Hazardous Waste',
    HazWaste_Pctl: 'Hazardous Waste Percentile',
    ImpWaters: 'Impaired Water Bodies',
    ImpWaters_Pctl: 'Impaired Water Bodies Percentile',
    SmAirToxSites: 'Small Air Toxics Sites',
    SmAirToxSites_Pctl: 'Small Air Toxics Sites Percentile',
    SolidWaste: 'Solid Waste Sites',
    SolidWaste_Pctl: 'Solid Waste Sites Percentile',
    Pollution: 'Pollution Burden Score',
    PollutionScore: 'Pollution Burden (Scaled)',
    Pollution_Pctl: 'Pollution Burden Percentile',
    asthma: 'Asthma Rate',
    Asthma_Pctl: 'Asthma Percentile',
    Cardiovascular: 'Cardiovascular Disease Rate',
    Cardiovascular_Pctl: 'Cardiovascular Disease Percentile',
    DiabetesPrev: 'Diabetes Prevalence',
    DiabetesPrev_Pctl: 'Diabetes Prevalence Percentile',
    LowBirthWeight: 'Low Birth Weight Infants Rate',
    LowBirthWeight_Pctl: 'Low Birth Weight Percentile',
    Education: 'Low Educational Attainment (%)',
    Education_Pctl: 'Education Percentile',
    HousingBurden: 'Housing Cost Burden (%)',
    HousingBurden_Pctl: 'Housing Burden Percentile',
    LinguisticIso: 'Linguistic Isolation (%)',
    LinguisticIso_Pctl: 'Linguistic Isolation Percentile',
    Poverty: 'Poverty Rate (%)',
    Poverty_Pctl: 'Poverty Percentile (CES)',
    Unemployment: 'Unemployment Rate (%)',
    Unemployment_Pctl: 'Unemployment Percentile',
    PopChar: 'Population Characteristics Score',
    PopCharScore: 'Population Characteristics (Scaled)',
    PopChar_Pctl: 'Population Characteristics Percentile',
    PopUnd_10: 'Population Under 10 (%)',
    Pop10_64: 'Population 10–64 (%)',
    PopOver_65: 'Population Over 65 (%)',
    White_Pct: 'White (%)',
    Hispanic_Pct: 'Hispanic (%)',
    Black_Pct: 'Black (%)',
    NatAmeri_Pct: 'Native American (%)',
    Asian_Pct: 'Asian (%)',
    OtherMulti_Pct: 'Other/Multiracial (%)',
};

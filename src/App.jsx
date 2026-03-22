/**
 * ARCHITECTURE AND PERFORMANCE NOTES:
 *
 * 1. MAP RENDERING ENGINE (SVG vs Canvas)
 *    - `preferCanvas={false}` is explicitly set on MapContainer.
 *    - While `preferCanvas={true}` would vastly improve performance for rendering thousands of K-12 and GSA school points by shifting from DOM nodes to a single HTML5 canvas, it breaks interactivity (hover/click events) for the complex dataset layers.
 *    - Therefore, the map relies on SVG rendering. To mitigate lag, we rely on thin stroke widths, reduced radii, and lower opacity for overlapping layers.
 *
 * 2. REACTIVITY & PERFORMANCE
 * - All layer GeoJSON is fetched once on mount and stored in `layerData` state.
 * - The schools layer ("schools_andparks") is the primary layer. Its features
 *   are enriched client-side with `CWHScore` and `ContainsElementary` via
 *   the `scoredLayerData` useMemo. Other layers pass through unchanged.
 * - Scoring weights live in `scoringWeights` state. A `validWeights` memo
 *   gates recomputation: scores ONLY update when weights sum to 100%.
 *   This prevents expensive re-renders during intermediate slider drags.
 *
 * MAP RENDERING (IMPORTANT)
 * - react-leaflet's <GeoJSON> component does NOT re-render when its `data`
 *   prop changes. It only renders once. The ONLY way to force a re-render
 *   is to change the `key` prop (which unmounts and remounts the component).
 * - The GeoJSON key includes `scoringKey` (derived from validWeights) and
 *   `schoolOpenFilter` so the map updates when weights or filters change.
 * - `geoKeys` is a counter that increments when layer data is first loaded,
 *   so the initial render works correctly.
 *
 * CO-LOCATED SCHOOLS
 * - Multiple school polygons can share the same lat/long (e.g., an elementary
 *   and a high school on the same campus). These are linked via a coordinate
 *   index (`coordinateIndex`) for the detail panel's "Schools" heading.
 * - The elementary flag is propagated by location: if ANY polygon at a given
 *   lat/long is elementary, ALL polygons there get ContainsElementary=1.
 *   This is done in both `scoringConfig.js` (for scoring) and here (for display).
 *
 * LAYER ORDERING
 * - Layer render order follows the array order in layerConfig.js.
 * - Custom Leaflet panes control z-index stacking:
 *     boundaryPane (z-index 350) — watershed boundaries, sub-basins, etc.
 *     datasetPane  (z-index 400) — CalEnviroScreen, Tree Equity Score, etc.
 *     overlayPaneStrict (z-index 500) — Traditional Schools, parks (dense)
 *     topOverlayPane (z-index 600) — GSA (sparse, always visible on top)
 *   IMPORTANT: topOverlayPane uses pointer-events:none on the pane div
 *   so clicks pass through gaps between GSA dots to schools below. CSS
 *   re-enables pointer-events on the actual SVG circle/path elements.
 *
 * PANEL TABS
 * - Right panel has 4 tabs: Feature Details, Statistics, Scoring, Definitions.
 * - "Scoring" tab renders ScoringPanel.jsx which controls `scoringWeights`.
 * - Feature Details uses `coLocated` array to show co-located school campuses.
 *   School names are deduplicated to avoid showing the same name twice.
 *
 * SCORING ENGINE (scoringConfig.js)
 * - Default formula: 30% infilpot_pctl + 30% CanopyHeatRelief + 30% DAC
 *   + 5% parkCount (normalized) + 5% containsElementary (binary).
 * - All variables and weights are defined in SCORING_VARIABLES array.
 * - computeScores() returns a Float64Array of min-max normalized 0–1 scores.
 */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { MapContainer, TileLayer, GeoJSON, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import LAYER_CONFIG from './layerConfig';
import LayerPanel from './components/LayerPanel';
import DetailPanel from './components/DetailPanel';
import StatsPanel from './components/StatsPanel';
import LegendPanel from './components/LegendPanel';
import DefinitionsPanel from './components/DefinitionsPanel';
import ScoringPanel from './components/ScoringPanel';
import { getDefaultWeights, computeScores } from './scoringConfig';

delete L.Icon.Default.prototype._getIconUrl;

// Marker cluster wrapper — reads compact JSON directly (no GeoJSON decode step)
function MarkerClusterLayer({ rawData, layer, onFeatureClick }) {
    const map = useMap();
    const clusterRef = useRef(null);
    const onClickRef = useRef(onFeatureClick);
    onClickRef.current = onFeatureClick;

    useEffect(() => {
        if (!rawData || !map) return;

        const cluster = L.markerClusterGroup({
            chunkedLoading: true,
            chunkInterval: 100,
            chunkDelay: 10,
            maxClusterRadius: 60,
            disableClusteringAtZoom: 17,
            zoomToBoundsOnClick: true,
            spiderfyOnMaxZoom: true,
            showCoverageOnHover: false,
            iconCreateFunction: (c) => {
                const count = c.getChildCount();
                let size = 'small';
                if (count > 100) size = 'large';
                else if (count > 10) size = 'medium';
                return L.divIcon({
                    html: `<div style="opacity:0.55"><span>${count}</span></div>`,
                    className: `marker-cluster marker-cluster-${size}`,
                    iconSize: L.point(40, 40)
                });
            }
        });

        // Condition → color map (inline for speed, no per-feature function call)
        const condColors = { F: '#eab308', G: '#22c55e', P: '#ef4444', D: '#78716c' };
        const defaultColor = '#16a34a';
        const lu = rawData.lookups;
        const coords = rawData.coords;
        const bArr = rawData.b, cArr = rawData.c, sArr = rawData.s, dArr = rawData.d;
        const total = rawData.count;

        cluster.on('click', (e) => {
            const m = e.layer;
            if (m._treeIdx != null) {
                const idx = m._treeIdx;
                const feature = {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [coords[idx * 2], coords[idx * 2 + 1]] },
                    properties: {
                        b: lu.b[bArr[idx]] || '',
                        c: lu.c[cArr[idx]] || '',
                        d: lu.d[dArr[idx]] || dArr[idx] || '',
                        s: lu.s[sArr[idx]] || ''
                    }
                };
                onClickRef.current(feature, layer.id);
            }
        });

        map.addLayer(cluster);
        clusterRef.current = cluster;

        // Compute initial radius based on zoom (scales with radiusByZoom config)
        const rz = layer.radiusByZoom;
        function radiusForZoom(z) {
            if (!rz) return 4;
            return getZoomScaledRadius(rz, z);
        }
        let currentRadius = radiusForZoom(map.getZoom());

        // Update all marker radii when zoom changes
        const markersRef = [];
        function onZoomEnd() {
            const r = radiusForZoom(map.getZoom());
            if (r === currentRadius) return;
            currentRadius = r;
            for (let i = 0; i < markersRef.length; i++) {
                markersRef[i].setRadius(r);
            }
        }
        map.on('zoomend', onZoomEnd);

        // Batch marker creation in chunks to avoid blocking the main thread
        let cancelled = false;
        const CHUNK = 10000;
        let offset = 0;

        function processChunk() {
            if (cancelled) return;
            const end = Math.min(offset + CHUNK, total);
            const batch = [];
            for (let i = offset; i < end; i++) {
                const marker = L.circleMarker(
                    [coords[i * 2 + 1], coords[i * 2]],
                    { radius: currentRadius, fillColor: condColors[dArr[i]] || defaultColor,
                      color: condColors[dArr[i]] || defaultColor, weight: 0, fillOpacity: 0.45, pane: 'overlayPaneStrict' }
                );
                marker._treeIdx = i;
                batch.push(marker);
                markersRef.push(marker);
            }
            cluster.addLayers(batch);
            offset = end;
            if (offset < total) setTimeout(processChunk, 0);
        }
        processChunk();

        return () => {
            cancelled = true;
            map.off('zoomend', onZoomEnd);
            if (clusterRef.current) {
                map.removeLayer(clusterRef.current);
                clusterRef.current = null;
            }
        };
    }, [rawData, map, layer.id]);

    return null;
}

function FitBounds({ data }) {
    const map = useMap();
    const hasFit = useRef(false);
    useEffect(() => {
        if (data && !hasFit.current) {
            try {
                const geoLayer = L.geoJSON(data);
                const bounds = geoLayer.getBounds();
                if (bounds.isValid()) {
                    map.fitBounds(bounds, { padding: [30, 30] });
                    hasFit.current = true;
                }
            } catch (e) {
                // Ignore
            }
        }
    }, [data, map]);
    return null;
}

function ZoomToFeature({ zoomRequest }) {
    const map = useMap();
    useEffect(() => {
        if (zoomRequest && zoomRequest.feature && zoomRequest.feature.properties) {
            const feature = zoomRequest.feature;

            // Try to find lat/long or calculate center if polygon
            let lat = feature.properties.lat;
            let lng = feature.properties.long;

            // Try fallback properties (like parks might use Y_COORD, X_COORD or CENTER_LAT, CENTER_LON)
            if (lat == null || lng == null) {
                lat = feature.properties.CENTER_LAT || feature.properties.Y_COORD;
                lng = feature.properties.CENTER_LON || feature.properties.X_COORD;
            }

            if (lat != null && lng != null) {
                // Fly to the coordinate at a high zoom level
                map.flyTo([lat, lng], 16, { duration: 1.5 });
            } else if (feature.geometry && feature.geometry.type.includes('Polygon')) {
                // If it's a polygon without center points, calculate basic envelope center
                try {
                    const geoLayer = L.geoJSON(feature);
                    const bounds = geoLayer.getBounds();
                    if (bounds.isValid()) {
                        map.flyToBounds(bounds, { padding: [50, 50], duration: 1.5 });
                    }
                } catch (e) {
                    // Ignore
                }
            }
        }
    }, [zoomRequest, map]);
    return null;
}

function ZoomWatcher({ onZoom }) {
    const map = useMapEvents({
        zoomend: () => {
            onZoom(map.getZoom());
        }
    });

    useEffect(() => {
        onZoom(map.getZoom());
    }, [map, onZoom]);

    return null;
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function getZoomScaledRadius(config, zoom) {
    if (!config || typeof zoom !== 'number') return null;
    const { min, max, minZoom, maxZoom } = config;
    if ([min, max, minZoom, maxZoom].some(v => typeof v !== 'number')) return null;
    if (minZoom === maxZoom) return clamp(max, min, max);
    const t = (zoom - minZoom) / (maxZoom - minZoom);
    const raw = min + t * (max - min);
    return clamp(raw, min, max);
}

function MapEvents({ tooltipRef }) {
    const map = useMap();
    useEffect(() => {
        const handleDragStart = () => {
            if (tooltipRef?.current) tooltipRef.current.style.display = 'none';
            // Safely iterate over layers to close active feature tooltips (for boundaries)
            map.eachLayer((layer) => {
                if (typeof layer.closeTooltip === 'function') {
                    layer.closeTooltip();
                }
            });
        };
        map.on('dragstart', handleDragStart);
        map.on('zoomstart', handleDragStart);
        return () => {
            map.off('dragstart', handleDragStart);
            map.off('zoomstart', handleDragStart);
        }
    }, [map, tooltipRef]);
    return null;
}


/**
 * ViewportCounter — counts how many school polygons are visible on screen.
 * IMPORTANT: This component must live inside <MapContainer> because it uses useMap().
 * The `isActive` prop gates the moveend listener so it doesn't fire during normal
 * map navigation when the user is on a different tab.
 */
function ViewportCounter({ schoolFeatures, isActive, onUpdate }) {
    const map = useMap();

    useEffect(() => {
        if (!isActive || !schoolFeatures?.length) return;

        const computeVisible = () => {
            const bounds = map.getBounds();
            let count = 0;
            for (let i = 0; i < schoolFeatures.length; i++) {
                const props = schoolFeatures[i].properties;
                const lat = Number(props.lat);
                const lng = Number(props.long);
                if (!isNaN(lat) && !isNaN(lng) && bounds.contains([lat, lng])) {
                    count++;
                }
            }
            onUpdate(count);
        };

        // Compute immediately when tab becomes active
        computeVisible();

        map.on('moveend', computeVisible);
        return () => map.off('moveend', computeVisible);
    }, [map, isActive, schoolFeatures, onUpdate]);

    return null;
}

// Dynamically swap tile layers when boundaries toggle
function DynamicTileLayer({ showLabels, basemapType }) {
    const map = useMap();
    const tileRef = useRef(null);

    useEffect(() => {
        if (tileRef.current) {
            map.removeLayer(tileRef.current);
        }

        let url;
        let attribution;
        let maxNativeZoom;

        if (basemapType === 'satellite') {
            url = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
            attribution = '';
            maxNativeZoom = 19;
        } else if (basemapType === 'dark') {
            url = showLabels
                ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
                : 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png';
            attribution = '';
            maxNativeZoom = 20;
        } else {
            // Default: Light
            url = showLabels
                ? 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
                : 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png';
            attribution = '';
            maxNativeZoom = 20;
        }

        tileRef.current = L.tileLayer(url, {
            attribution: attribution,
            maxNativeZoom: maxNativeZoom,
            maxZoom: 20,
            className: basemapType === 'dark' ? 'dark-basemap-filter' : ''
        }).addTo(map);
        // Ensure tiles render below everything else
        tileRef.current.bringToBack();
        return () => {
            if (tileRef.current) map.removeLayer(tileRef.current);
        };
    }, [showLabels, basemapType, map]);

    return null;
}

// Create custom panes to strictly enforce rendering z-index order
function CustomPanes() {
    const map = useMap();
    useEffect(() => {
        // 200 = Tile basemap

        // Boundaries at 350 (below interactive layers so they don't block clicks)
        if (!map.getPane('boundaryPane')) {
            const bp = map.createPane('boundaryPane');
            bp.style.zIndex = 350;
            bp.style.pointerEvents = 'none';
        }

        // Datasets (CalEnviroScreen, Tree Equity Score) at 400 (default overlay pane level)
        if (!map.getPane('datasetPane')) {
            const dp = map.createPane('datasetPane');
            dp.style.zIndex = 400;
        }

        // Dense overlays (Traditional Schools, Parks) at 500
        if (!map.getPane('overlayPaneStrict')) {
            const op = map.createPane('overlayPaneStrict');
            op.style.zIndex = 500;
        }

        // Sparse top overlay (GSA) at 600 — always visible on top
        // pointer-events: none on the pane div so clicks pass through
        // gaps between GSA dots to schools/parks below.
        // CSS re-enables pointer-events on individual SVG shapes.
        if (!map.getPane('topOverlayPane')) {
            const top = map.createPane('topOverlayPane');
            top.style.zIndex = 600;
            top.style.pointerEvents = 'none';
        }
    }, [map]);
    return null;
}

class MapErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false };
    }
    static getDerivedStateFromError(error) {
        return { hasError: true };
    }
    componentDidCatch(error, errorInfo) {
        console.error("Map rendering error:", error, errorInfo);
    }
    render() {
        if (this.state.hasError) {
            return (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', color: 'var(--text-secondary)' }}>
                    <div style={{ fontSize: '3rem', marginBottom: '16px', opacity: 0.5 }}>⚠️</div>
                    <h3>Map Failed to Load</h3>
                    <p style={{ fontSize: '0.8rem' }}>There was an error rendering the map data.</p>
                </div>
            );
        }
        return this.props.children;
    }
}

const globalFileCache = {};

function App() {
    const [visibleLayers, setVisibleLayers] = useState(() => {
        const initial = {};
        LAYER_CONFIG.forEach(l => { initial[l.id] = l.defaultVisible; });
        return initial;
    });

    const [layerData, setLayerData] = useState({});
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState(null);
    const [activeTab, setActiveTab] = useState('details');
    const [activeSchoolMetric, setActiveSchoolMetric] = useState('CWHScore');
    const [schoolOpenFilter, setSchoolOpenFilter] = useState('all'); // 'all' | 'open' | 'closed'
    const [zoomRequest, setZoomRequest] = useState(null);
    const [mapZoom, setMapZoom] = useState(10);
    const [basemapType, setBasemapType] = useState(() => {
        return localStorage.getItem('cwh_basemap_preference') || 'light';
    });
    const [scoringWeights, setScoringWeights] = useState(getDefaultWeights);
    const tooltipRef = useRef(null);
    const [visibleSchoolCount, setVisibleSchoolCount] = useState(null);
    const handleVisibleCountUpdate = useCallback((count) => setVisibleSchoolCount(count), []);

    // Apply dark theme to body when basemap is 'dark' and save preference
    useEffect(() => {
        localStorage.setItem('cwh_basemap_preference', basemapType);
        if (basemapType === 'dark') {
            document.body.classList.add('theme-dark');
        } else {
            document.body.classList.remove('theme-dark');
        }
    }, [basemapType]);

    const [layerCounts, setLayerCounts] = useState({});
    const [geoKeys, setGeoKeys] = useState({});
    const [coordinateIndex, setCoordinateIndex] = useState(new Map());

    useEffect(() => {
        let cancelled = false;

        async function loadRequiredLayers() {
            const requiredLayers = LAYER_CONFIG.filter(l => visibleLayers[l.id] || l.id === 'schools_andparks');
            const fetches = [];

            for (const layer of requiredLayers) {
                // Ignore if it's already staged in state
                if (layerData[layer.id]) continue;

                // Cache network fetch promise if it hasn't started yet
                if (!globalFileCache[layer.file]) {
                    globalFileCache[layer.file] = fetch(layer.file).then(r => {
                        if (!r.ok) throw new Error(`HTTP ${r.status}`);
                        return r.json();
                    }).catch(err => {
                        console.warn(`Failed to load ${layer.file}:`, err);
                        return null;
                    });
                }

                fetches.push((async () => {
                    let data = await globalFileCache[layer.file];
                    if (!data) return null;

                    // Compact+clustered layers: store raw data as-is (decoded lazily by MarkerClusterLayer)
                    if (layer.compactFormat && layer.clustered && data.coords && data.count) {
                        return { id: layer.id, data, count: data.count, isCompact: true };
                    }

                    let features = data.features;
                    if (layer.filter && features) {
                        features = features.filter(layer.filter);
                    }
                    return { id: layer.id, data: { ...data, features }, count: features?.length || 0 };
                })());
            }

            if (fetches.length === 0) {
                if (loading) setLoading(false);
                return;
            }

            // Wait for only the required components we just staged
            const results = await Promise.all(fetches);
            if (cancelled) return;

            let hasNewData = false;
            const newData = {};
            const newCounts = {};
            const newKeys = {};

            for (const res of results) {
                if (res) {
                    newData[res.id] = res.data;
                    newCounts[res.id] = res.count;
                    newKeys[res.id] = Date.now() + Math.random();
                    hasNewData = true;
                }
            }

            if (hasNewData) {
                setLayerData(prev => ({ ...prev, ...newData }));
                setLayerCounts(prev => ({ ...prev, ...newCounts }));
                setGeoKeys(prev => ({ ...prev, ...newKeys }));

                //Index coordinates for O(1) school lookup
                if (newData['schools_andparks']) {
                    const idx = new Map();
                    newData['schools_andparks'].features.forEach(f => {
                        const lat = f.properties.lat;
                        const lng = f.properties.long;
                        if (lat != null && lng != null) {
                            const key = `${Number(lat).toFixed(4)}_${Number(lng).toFixed(4)}`;
                            if (!idx.has(key)) idx.set(key, []);
                            idx.get(key).push(f);
                        }
                    });
                    setCoordinateIndex(idx);
                }
            }

            setLoading(false);
        }

        loadRequiredLayers();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visibleLayers]);

    const selectedLayerRef = useRef(null);
    const selectedCfgRef = useRef(null);
    const selectedFeatureRef = useRef(null);
    const hoveredLayerRef = useRef(null);

    const resetHighlight = useCallback(() => {
        const oldLayer = selectedLayerRef.current;
        if (oldLayer && oldLayer.setStyle) {
            const lCfg = selectedCfgRef.current;
            const feature = selectedFeatureRef.current;
            if (lCfg && feature) {
                const isBoundary = lCfg.category === 'boundaries';
                const fill = lCfg.dynamicColor ? lCfg.dynamicColor(feature) : (lCfg.fillColor || '#4ade80');
                const stroke = isBoundary ? (lCfg.color || '#475569') : (lCfg.dynamicColor ? fill : (lCfg.color || '#000'));
                const defaultWeight = lCfg.weight !== undefined ? lCfg.weight : 0.5;
                const defaultFillOpacity = isBoundary ? 0 : (lCfg.fillOpacity !== undefined ? lCfg.fillOpacity : (lCfg.category === 'datasets' ? 0.4 : 0.6));
                oldLayer.setStyle({ weight: defaultWeight, fillOpacity: defaultFillOpacity, color: stroke, fillColor: isBoundary ? 'transparent' : fill });
            }
        }
    }, []);

    const clearSelection = useCallback(() => {
        resetHighlight();
        selectedLayerRef.current = null;
        selectedCfgRef.current = null;
        selectedFeatureRef.current = null;
        setSelected(null);
    }, [resetHighlight]);

    const handleFeatureClick = useCallback((feature, layerId, featureLayer, layerConfig) => {
        resetHighlight();
        if (featureLayer && featureLayer.setStyle) {
            const isBoundary = layerConfig.category === 'boundaries';
            featureLayer.setStyle({
                weight: isBoundary ? 4 : 2,
                fillOpacity: isBoundary ? 0.1 : 0.85,
                color: '#ffffff' // Clean white outline for selection
            });
            if (featureLayer.bringToFront) featureLayer.bringToFront();
        }
        selectedLayerRef.current = featureLayer;
        selectedCfgRef.current = layerConfig;
        selectedFeatureRef.current = feature;

        // PhD level optimization: use the O(1) index for co-located lookup
        let coLocated = [];
        if (layerId === 'schools_andparks') {
            const lat = feature.properties.lat;
            const lng = feature.properties.long;
            if (lat != null && lng != null) {
                const key = `${Number(lat).toFixed(4)}_${Number(lng).toFixed(4)}`;
                const hits = coordinateIndex.get(key) || [];
                coLocated = hits.filter(f => f !== feature);
            }
        }

        setSelected({ feature, properties: feature.properties, layerId, coLocated });
        setActiveTab('details');
    }, [resetHighlight, layerData, coordinateIndex]);

    // --- Only recompute scores when weights sum to 100% (prevents lag during slider adjustment) ---
    const lastValidWeightsRef = useRef(scoringWeights);
    const validWeights = useMemo(() => {
        const total = Object.values(scoringWeights).reduce((s, w) => s + w, 0);
        if (Math.abs(total - 100) < 0.5) {
            lastValidWeightsRef.current = scoringWeights;
            return scoringWeights;
        }
        return lastValidWeightsRef.current;
    }, [scoringWeights]);

    // --- Compute CWH Scores and inject into features ---
    const scoredLayerData = useMemo(() => {
        const schoolsGeo = layerData['schools_andparks'];
        if (!schoolsGeo?.features) return layerData;

        const scores = computeScores(schoolsGeo.features, validWeights);

        // Build location-based elementary lookup so co-located schools share the flag
        const locationElementary = new Set();
        for (const f of schoolsGeo.features) {
            if ((f.properties.level || '').includes('Elementary')) {
                locationElementary.add(`${f.properties.lat},${f.properties.long}`);
            }
        }

        // Mark duplicate co-located polygons so only one renders with a fill.
        // Uses 4-decimal rounding (~11m) to catch near-identical coordinates.
        const seenCoords = new Set();

        const scoredFeatures = schoolsGeo.features.map((f, i) => {
            const locKey = `${f.properties.lat},${f.properties.long}`;
            const roundedKey = `${Number(f.properties.lat).toFixed(4)}_${Number(f.properties.long).toFixed(4)}`;
            const isDuplicate = seenCoords.has(roundedKey);
            seenCoords.add(roundedKey);
            return {
                ...f,
                properties: {
                    ...f.properties,
                    CWHScore: scores[i],
                    ContainsElementary: locationElementary.has(locKey) ? 1 : 0,
                    _isDuplicate: isDuplicate,
                },
            };
        });

        return {
            ...layerData,
            schools_andparks: { ...schoolsGeo, features: scoredFeatures },
        };
    }, [layerData, validWeights]);

    const primaryData = scoredLayerData['schools_andparks'];

    return (
        <div className="dashboard">
            {/* GIS Pattern Defs for overlapping highlights */}
            <svg style={{ position: 'absolute', width: 0, height: 0 }} aria-hidden="true">
                <defs>
                    <pattern id="park-pattern" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                        <rect width="8" height="8" fill="rgba(0, 197, 255, 0.15)" />
                        <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(0, 197, 255, 0.7)" strokeWidth="1.5" />
                    </pattern>
                </defs>
            </svg>
            <LayerPanel
                visibleLayers={visibleLayers}
                setVisibleLayers={setVisibleLayers}
                layerCounts={layerCounts}
                activeSchoolMetric={activeSchoolMetric}
                setActiveSchoolMetric={setActiveSchoolMetric}
                schoolOpenFilter={schoolOpenFilter}
                setSchoolOpenFilter={setSchoolOpenFilter}
                basemapType={basemapType}
                setBasemapType={setBasemapType}
            />

            <div className="map-wrapper">
                {loading && (
                    <div className="loading-overlay">
                        <div className="loading-spinner" />
                    </div>
                )}
                <MapErrorBoundary>
                    <MapContainer
                        center={[34.05, -118.25]}
                        zoom={10}
                        zoomControl={false}
                        attributionControl={false}
                        preferCanvas={false} /* CRITICAL: Do NOT enable Canvas rendering. It makes layers uninteractable and performance issues are likely related to point-count/styling overhead. */
                        style={{ height: '100%', width: '100%' }}
                    >
                        <DynamicTileLayer
                            showLabels={!visibleLayers['watershed_boundaries']}
                            basemapType={basemapType}
                        />
                        <CustomPanes />
                        <MapEvents tooltipRef={tooltipRef} />
                        <ZoomWatcher onZoom={setMapZoom} />
                        <ViewportCounter
                            schoolFeatures={primaryData?.features}
                            isActive={activeTab === 'stats'}
                            onUpdate={handleVisibleCountUpdate}
                        />
                        {primaryData && <FitBounds data={primaryData} />}
                        <ZoomToFeature zoomRequest={zoomRequest} />

                        {useMemo(() => {
                            // Derive a key from scoring weights for reactive map updates
                            const scoringKey = Object.values(validWeights).join('-');
                            const zoomBucket = Math.round(mapZoom || 0);

                            return LAYER_CONFIG.map(layer => {
                                if (!visibleLayers[layer.id] || !scoredLayerData[layer.id]) return null;
                                const data = scoredLayerData[layer.id];

                                // Apply open/closed filter for the schools layer
                                let filteredData = data;
                                if (layer.id === 'schools_andparks' && schoolOpenFilter !== 'all') {
                                    filteredData = {
                                        ...data,
                                        features: data.features.filter(f => {
                                            const isOpen = String(f.properties.Open || '').toUpperCase() === 'TRUE';
                                            return schoolOpenFilter === 'open' ? isOpen : !isOpen;
                                        })
                                    };
                                }

                                const isBoundary = layer.isBoundary || layer.category === 'boundaries';

                                // Use marker clustering for dense point layers
                                if (layer.clustered) {
                                    // Compact data has coords/lookups at top level (no .features)
                                    const compactRaw = data?.coords && data?.lookups ? data : null;
                                    return (
                                        <MarkerClusterLayer
                                            key={`${layer.id}-${geoKeys[layer.id]}-cluster`}
                                            rawData={compactRaw}
                                            layer={layer}
                                            onFeatureClick={(feature, layerId) => {
                                                handleFeatureClick(feature, layerId, null, layer);
                                            }}
                                        />
                                    );
                                }

                                const baseKey = `${layer.id}-${geoKeys[layer.id]}`;
                                const scoringSuffix = layer.id === 'schools_andparks' ? `${schoolOpenFilter}-${scoringKey}` : '';
                                const zoomSuffix = layer.id === 'gsa_2024' ? `z${zoomBucket}` : '';
                                const geoKey = [baseKey, scoringSuffix, zoomSuffix].filter(Boolean).join('-');

                                return (
                                    <GeoJSON
                                        key={geoKey}
                                        data={filteredData}
                                        interactive={!isBoundary}
                                        pane={isBoundary ? 'boundaryPane' : (layer.id === 'gsa_2024' ? 'topOverlayPane' : (layer.category === 'datasets' ? 'datasetPane' : 'overlayPaneStrict'))}
                                        pointToLayer={(feature, latlng) => {
                                            if (layer.pointToLayer) return layer.pointToLayer(feature, latlng);
                                            // Use L.circle so the size scales geographically with zoom level
                                            const ptFillOpacity = (layer.id === 'schools_andparks' && feature.properties._isDuplicate)
                                                ? 0
                                                : (layer.fillOpacity !== undefined ? layer.fillOpacity : 0.8);
                                            let radius = layer.radius || 6;
                                            if (layer.radiusByZoom) {
                                                const scaled = getZoomScaledRadius(layer.radiusByZoom, mapZoom);
                                                if (scaled != null && !isNaN(scaled)) radius = scaled;
                                            }
                                            return L.circleMarker(latlng, {
                                                radius: radius, // pixels
                                                fillColor: layer.fillColor || '#4ade80',
                                                color: layer.color || '#000000',
                                                weight: layer.weight !== undefined ? layer.weight : 0.5,
                                                opacity: layer.strokeOpacity !== undefined ? layer.strokeOpacity : 1,
                                                fillOpacity: ptFillOpacity
                                            });
                                        }}
                                        style={(feature) => {
                                            let fill = layer.fillColor || '#4ade80';
                                            let stroke = layer.color || '#000000';
                                            let weight = layer.weight !== undefined ? layer.weight : 0.5;
                                            let fillOpacity = layer.fillOpacity !== undefined ? layer.fillOpacity : (layer.category === 'datasets' ? 0.4 : 0.6);
                                            let strokeOpacity = layer.strokeOpacity !== undefined ? layer.strokeOpacity : 1;

                                            if (layer.dynamicColor) {
                                                fill = layer.dynamicColor(feature, activeSchoolMetric);
                                                stroke = fill;
                                            }

                                            // De-stack co-located schools: duplicate polygons get no fill
                                            if (layer.id === 'schools_andparks' && feature.properties._isDuplicate) {
                                                fillOpacity = 0;
                                            }

                                            return {
                                                pane: isBoundary ? 'boundaryPane' : (layer.id === 'gsa_2024' ? 'topOverlayPane' : (layer.category === 'datasets' ? 'datasetPane' : 'overlayPaneStrict')),
                                                fillColor: fill,
                                                color: stroke,
                                                weight: weight,
                                                opacity: strokeOpacity,
                                                fillOpacity: fillOpacity,
                                            };
                                        }}
                                        onEachFeature={(feature, featureLayer) => {
                                            const name = feature.properties[layer.nameField] || 'Feature';
                                            if (isBoundary) {
                                                // Only render labels if not explicitly disabled
                                                if (layer.showLabels !== false) {
                                                    // Use manual label coordinates if available
                                                    const lat = feature.properties.labelLat;
                                                    const lng = feature.properties.labelLng;
                                                    if (lat && lng) {
                                                        const tooltip = L.tooltip({
                                                            permanent: true,
                                                            direction: 'center',
                                                            className: 'watershed-label',
                                                            offset: [0, 0],
                                                        });
                                                        tooltip.setContent(name);
                                                        tooltip.setLatLng([lat, lng]);
                                                        featureLayer.on('add', () => {
                                                            featureLayer._map && tooltip.addTo(featureLayer._map);
                                                        });
                                                        featureLayer.on('remove', () => {
                                                            tooltip.remove();
                                                        });
                                                    } else {
                                                        featureLayer.bindTooltip(name, {
                                                            permanent: true,
                                                            direction: 'center',
                                                            className: 'watershed-label',
                                                            offset: [0, 0],
                                                        });
                                                    }
                                                }
                                                return; // No event handlers for boundaries
                                            }
                                            // Leaflet bug workaround: Render our custom React tooltip instead of native Leaflet
                                            // bindTooltip so dragging never orphans tooltips
                                            featureLayer.on({
                                                click: (e) => handleFeatureClick(feature, layer.id, e.target, layer),
                                                mousemove: (e) => {
                                                    if (tooltipRef.current && e.originalEvent) {
                                                        tooltipRef.current.style.left = e.originalEvent.clientX + 'px';
                                                        tooltipRef.current.style.top = (e.originalEvent.clientY - 15) + 'px';
                                                    }
                                                },
                                                mouseover: (e) => {
                                                    if (tooltipRef.current && e.originalEvent) {
                                                        tooltipRef.current.style.display = 'block';
                                                        tooltipRef.current.style.left = e.originalEvent.clientX + 'px';
                                                        tooltipRef.current.style.top = (e.originalEvent.clientY - 15) + 'px';
                                                        const titleNode = tooltipRef.current.querySelector('.tt-title');
                                                        const layerNode = tooltipRef.current.querySelector('.tt-layer');
                                                        if (titleNode) titleNode.textContent = name;
                                                        if (layerNode) layerNode.textContent = layer.name;
                                                    }

                                                    if (selectedLayerRef.current === e.target) return;

                                                    // Apply a very subtle, clean outline for hover highlighting
                                                    // Softened significantly per user request
                                                    const isBoundaryHover = layer.category === 'boundaries';
                                                    e.target.setStyle({
                                                        weight: isBoundaryHover ? 3 : 1,
                                                        color: '#f8fafc', // slate-50
                                                        opacity: 0.6,
                                                        fillOpacity: isBoundaryHover ? 0.05 : 0.70
                                                    });
                                                },
                                                mouseout: (e) => {
                                                    if (tooltipRef.current) tooltipRef.current.style.display = 'none';

                                                    if (selectedLayerRef.current === e.target) return;
                                                    const fill = layer.dynamicColor ? layer.dynamicColor(feature, activeSchoolMetric) : (layer.fillColor || '#4ade80');
                                                    const stroke = layer.dynamicColor ? fill : (layer.color || '#000');
                                                    const defaultWeight = layer.weight !== undefined ? layer.weight : 0.5;
                                                    let defaultFillOpacity = layer.fillOpacity !== undefined ? layer.fillOpacity : (layer.category === 'datasets' ? 0.4 : 0.6);
                                                    // Keep duplicate co-located polygons transparent
                                                    if (layer.id === 'schools_andparks' && feature.properties._isDuplicate) {
                                                        defaultFillOpacity = 0;
                                                    }
                                                    e.target.setStyle({
                                                        weight: defaultWeight,
                                                        color: stroke,
                                                        opacity: 0.8,
                                                        fillOpacity: defaultFillOpacity
                                                    });
                                                }
                                            });
                                        }}
                                    />
                                );
                            });
                        }, [visibleLayers, scoredLayerData, geoKeys, activeSchoolMetric, schoolOpenFilter, validWeights, handleFeatureClick, mapZoom])}
                    </MapContainer>
                </MapErrorBoundary>

                <LegendPanel
                    visibleLayers={visibleLayers}
                    activeSchoolMetric={activeSchoolMetric}
                />
            </div>

            <div className="detail-panel">
                <div className="detail-tabs">
                    <button
                        className={`detail-tab ${activeTab === 'details' ? 'active' : ''}`}
                        onClick={() => setActiveTab('details')}
                    >
                        Feature Details
                    </button>
                    <button
                        className={`detail-tab ${activeTab === 'stats' ? 'active' : ''}`}
                        onClick={() => setActiveTab('stats')}
                    >
                        Statistics
                    </button>
                    <button
                        className={`detail-tab ${activeTab === 'scoring' ? 'active' : ''}`}
                        onClick={() => setActiveTab('scoring')}
                    >
                        Scoring
                    </button>
                    <button
                        className={`detail-tab ${activeTab === 'definitions' ? 'active' : ''}`}
                        onClick={() => setActiveTab('definitions')}
                    >
                        Definitions
                    </button>
                </div>
                <div className="detail-content-wrapper" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    {activeTab === 'details' ? (
                        <DetailPanel
                            selected={selected}
                            onClose={clearSelection}
                            layerData={scoredLayerData}
                            onFeatureClick={handleFeatureClick}
                            onZoomRequest={(feature) => setZoomRequest({ feature, timestamp: Date.now() })}
                            scoringWeights={scoringWeights}
                        />
                    ) : activeTab === 'scoring' ? (
                        <ScoringPanel weights={scoringWeights} setWeights={setScoringWeights} />
                    ) : activeTab === 'stats' ? (
                        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
                            <StatsPanel layerData={scoredLayerData} onFeatureClick={handleFeatureClick} onZoomRequest={(feature) => setZoomRequest({ feature, timestamp: Date.now() })} visibleSchoolCount={visibleSchoolCount} />
                        </div>
                    ) : (
                        <DefinitionsPanel />
                    )}
                </div>
            </div>

            {/* Global Monolithic React Tooltip Overlay */}
            <div
                ref={tooltipRef}
                style={{
                    display: 'none',
                    position: 'fixed',
                    pointerEvents: 'none',
                    zIndex: 99999,
                    background: 'var(--bg-secondary)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-accent)',
                    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.12)',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-md)',
                    transform: 'translate(-50%, -100%)',
                    fontFamily: "'Inter', sans-serif",
                    minWidth: '150px',
                    textAlign: 'center'
                }}>
                <div className="tt-title" style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '4px' }}></div>
                <div className="tt-layer" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}></div>

                {/* Tooltip triangle pointer */}
                <div style={{
                    position: 'absolute',
                    bottom: '-6px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: 0,
                    height: 0,
                    borderLeft: '6px solid transparent',
                    borderRight: '6px solid transparent',
                    borderTop: '6px solid var(--bg-secondary)',
                    filter: 'drop-shadow(0 2px 1px rgba(0,0,0,0.1))'
                }} />
            </div>
        </div >
    );
}

export default App;

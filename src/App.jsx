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
import { feature as topojsonFeature } from 'topojson-client';
import geobuf from 'geobuf';
import Pbf from 'pbf';
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
const TREEKEEPER_SCHOOL_GROUP_ZOOM = 18;
const SCHOOL_INDEX_CELL_SIZE = 0.01;
const SCHOOL_ASSIGN_FALLBACK_DISTANCE = 0.0018;

function pointInRing(lng, lat, ring) {
    if (!Array.isArray(ring) || ring.length < 3) return false;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0];
        const yi = ring[i][1];
        const xj = ring[j][0];
        const yj = ring[j][1];
        const denom = (yj - yi) || Number.EPSILON;
        const intersects = ((yi > lat) !== (yj > lat)) && (lng < ((xj - xi) * (lat - yi)) / denom + xi);
        if (intersects) inside = !inside;
    }
    return inside;
}

function pointInPolygon(lng, lat, polygonCoords) {
    if (!Array.isArray(polygonCoords) || polygonCoords.length === 0) return false;
    if (!pointInRing(lng, lat, polygonCoords[0])) return false;
    for (let i = 1; i < polygonCoords.length; i++) {
        if (pointInRing(lng, lat, polygonCoords[i])) return false;
    }
    return true;
}

function pointInMultiPolygon(lng, lat, multiPolygonCoords) {
    if (!Array.isArray(multiPolygonCoords)) return false;
    for (let i = 0; i < multiPolygonCoords.length; i++) {
        if (pointInPolygon(lng, lat, multiPolygonCoords[i])) return true;
    }
    return false;
}

function getFeatureArea(feature) {
    const geometry = feature?.geometry;
    if (!geometry) return 0;

    if (geometry.type === 'Polygon') {
        return getPolygonArea(geometry.coordinates);
    }

    if (geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)) {
        let area = 0;
        for (let i = 0; i < geometry.coordinates.length; i++) {
            area += getPolygonArea(geometry.coordinates[i]);
        }
        return area;
    }

    return 0;
}

function createSchoolPolygonSummaries(schoolFeatures) {
    if (!Array.isArray(schoolFeatures)) return [];
    const schools = [];

    for (let i = 0; i < schoolFeatures.length; i++) {
        const feature = schoolFeatures[i];
        const geometry = feature?.geometry;
        if (!geometry) continue;

        const polygons = geometry.type === 'Polygon'
            ? [geometry.coordinates]
            : geometry.type === 'MultiPolygon'
                ? geometry.coordinates
                : null;
        if (!polygons || polygons.length === 0) continue;

        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        for (let p = 0; p < polygons.length; p++) {
            const poly = polygons[p];
            for (let r = 0; r < poly.length; r++) {
                const ring = poly[r];
                for (let c = 0; c < ring.length; c++) {
                    const coord = ring[c];
                    const x = coord[0];
                    const y = coord[1];
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
            }
        }

        if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) continue;

        const propLat = Number(feature?.properties?.lat);
        const propLng = Number(feature?.properties?.long);
        const centerLat = Number.isFinite(propLat) ? propLat : (minY + maxY) / 2;
        const centerLng = Number.isFinite(propLng) ? propLng : (minX + maxX) / 2;
        const name = feature?.properties?.School || 'School';

        schools.push({
            feature,
            name,
            polygons,
            minX,
            minY,
            maxX,
            maxY,
            centerLat,
            centerLng,
            area: getFeatureArea(feature)
        });
    }

    // Smaller footprints win overlap ties so shared campuses do not double-count.
    schools.sort((a, b) => a.area - b.area);
    return schools;
}

function buildSchoolSpatialIndex(schools) {
    const index = new Map();
    for (let i = 0; i < schools.length; i++) {
        const s = schools[i];
        const minCellX = Math.floor(s.minX / SCHOOL_INDEX_CELL_SIZE);
        const maxCellX = Math.floor(s.maxX / SCHOOL_INDEX_CELL_SIZE);
        const minCellY = Math.floor(s.minY / SCHOOL_INDEX_CELL_SIZE);
        const maxCellY = Math.floor(s.maxY / SCHOOL_INDEX_CELL_SIZE);

        for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
            for (let cellY = minCellY; cellY <= maxCellY; cellY++) {
                const key = `${cellX}_${cellY}`;
                if (!index.has(key)) index.set(key, []);
                index.get(key).push(i);
            }
        }
    }
    return index;
}

function findContainingSchoolIndex(lng, lat, schools, schoolIndex) {
    const cellX = Math.floor(lng / SCHOOL_INDEX_CELL_SIZE);
    const cellY = Math.floor(lat / SCHOOL_INDEX_CELL_SIZE);
    const candidates = schoolIndex.get(`${cellX}_${cellY}`);
    if (!candidates || candidates.length === 0) return -1;

    for (let i = 0; i < candidates.length; i++) {
        const idx = candidates[i];
        const school = schools[idx];
        if (lng < school.minX || lng > school.maxX || lat < school.minY || lat > school.maxY) continue;
        if (pointInMultiPolygon(lng, lat, school.polygons)) return idx;
    }

    return -1;
}

function findNearestSchoolIndex(lng, lat, schools, schoolIndex, maxDistance = SCHOOL_ASSIGN_FALLBACK_DISTANCE) {
    const cellX = Math.floor(lng / SCHOOL_INDEX_CELL_SIZE);
    const cellY = Math.floor(lat / SCHOOL_INDEX_CELL_SIZE);
    const maxDistanceSq = maxDistance * maxDistance;
    let bestIdx = -1;
    let bestDistSq = maxDistanceSq;
    const seen = new Set();

    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            const candidates = schoolIndex.get(`${cellX + dx}_${cellY + dy}`);
            if (!candidates || candidates.length === 0) continue;

            for (let i = 0; i < candidates.length; i++) {
                const idx = candidates[i];
                if (seen.has(idx)) continue;
                seen.add(idx);

                const school = schools[idx];
                if (lng < (school.minX - maxDistance) || lng > (school.maxX + maxDistance) ||
                    lat < (school.minY - maxDistance) || lat > (school.maxY + maxDistance)) {
                    continue;
                }

                const dLng = school.centerLng - lng;
                const dLat = school.centerLat - lat;
                const distSq = dLng * dLng + dLat * dLat;
                if (distSq <= bestDistSq) {
                    bestDistSq = distSq;
                    bestIdx = idx;
                }
            }
        }
    }

    return bestIdx;
}

function getSchoolTreeIcon(count) {
    let size = 'small';
    if (count > 250) size = 'large';
    else if (count > 80) size = 'medium';
    return L.divIcon({
        html: `<div style="opacity:0.65"><span>${count}</span></div>`,
        className: `marker-cluster marker-cluster-${size}`,
        iconSize: L.point(40, 40)
    });
}

function MarkerClusterLayer({ rawData, layer, schoolFeatures, onFeatureClick }) {
    const map = useMap();
    const clusterRef = useRef(null);
    const schoolSummaryRef = useRef(null);
    const onClickRef = useRef(onFeatureClick);
    onClickRef.current = onFeatureClick;

    const isGeoJson = rawData && Array.isArray(rawData.features);

    useEffect(() => {
        if (!rawData || !map) return;
        const shouldGroupBySchool = layer.id === 'school_trees' && Array.isArray(schoolFeatures) && schoolFeatures.length > 0;
        let schoolSummaryReady = !shouldGroupBySchool;

        const cluster = L.markerClusterGroup({
            chunkedLoading: true,
            chunkInterval: 100,
            chunkDelay: 10,
            maxClusterRadius: 90,
            disableClusteringAtZoom: layer.disableClusteringAtZoom || (shouldGroupBySchool ? 22 : 17),
            zoomToBoundsOnClick: true,
            spiderfyOnMaxZoom: false,
            showCoverageOnHover: false,
            iconCreateFunction: (c) => {
                const count = c.getChildCount();
                const color = layer.color || '#16a34a';
                const countStr = count.toLocaleString();
                // Dynamically scale circle size for large numbers (10k, 100k, etc.)
                const size = count < 100 ? 36 : count < 1000 ? 42 : count < 10000 ? 48 : 54;
                
                return L.divIcon({
                    html: `<div style="background-color: ${color}; border: 2.5px solid rgba(255,255,255,0.9); box-shadow: 0 3px 6px rgba(0,0,0,0.4); color: white; border-radius: 50%; width: ${size}px; height: ${size}px; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: ${size > 42 ? '0.7rem' : '0.75rem'}; transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);"><span>${countStr}</span></div>`,
                    className: 'marker-cluster-custom',
                    iconSize: L.point(size, size)
                });
            }
        });

        // Condition ->’ color map (inline for speed, no per-feature function call)
        const condColors = { F: '#eab308', G: '#22c55e', P: '#ef4444', D: '#78716c' };
        const defaultColor = layer.fillColor || layer.color || '#16a34a';
        const lu = rawData.lookups;
        const coords = rawData.coords;
        const bArr = rawData.b, cArr = rawData.c, sArr = rawData.s, dArr = rawData.d;
        const total = isGeoJson ? rawData.features.length : rawData.count;

        cluster.on('click', (e) => {
            const m = e.layer;
            if (m._feature) {
                onClickRef.current(m._feature, layer.id);
            } else if (m._treeIdx != null) {
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

        const schoolSummaryLayer = L.layerGroup();
        map.addLayer(cluster);
        clusterRef.current = cluster;
        schoolSummaryRef.current = schoolSummaryLayer;

        function syncLayerMode() {
            const showSchoolGroups = shouldGroupBySchool
                && map.getZoom() >= TREEKEEPER_SCHOOL_GROUP_ZOOM;

            if (showSchoolGroups) {
                if (map.hasLayer(cluster)) map.removeLayer(cluster);
                if (!map.hasLayer(schoolSummaryLayer)) map.addLayer(schoolSummaryLayer);
            } else {
                if (map.hasLayer(schoolSummaryLayer)) map.removeLayer(schoolSummaryLayer);
                if (!map.hasLayer(cluster)) map.addLayer(cluster);
            }
        }

        syncLayerMode();

        // Compute initial radius based on zoom (scales with radiusByZoom config)
        const rz = layer.radiusByZoom;
        function radiusForZoom(z) {
            if (!rz) return 4;
            return getZoomScaledValue(rz, z);
        }
        let currentRadius = radiusForZoom(map.getZoom());

        // Update all marker radii when zoom changes
        const markersRef = [];
        function onZoomEnd() {
            const r = radiusForZoom(map.getZoom());
            if (r !== currentRadius) {
                currentRadius = r;
                for (let i = 0; i < markersRef.length; i++) {
                    markersRef[i].setRadius(r);
                }
            }
            syncLayerMode();
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
                let lat, lng, feat;
                let color = defaultColor;

                if (isGeoJson) {
                    feat = rawData.features[i];
                    [lng, lat] = feat.geometry.coordinates;
                } else {
                    lng = coords[i * 2];
                    lat = coords[i * 2 + 1];
                    color = condColors[dArr[i]] || defaultColor;
                }

                const marker = L.circleMarker(
                    [lat, lng],
                    { radius: currentRadius, fillColor: color,
                      color: color, weight: 0, fillOpacity: 0.45, pane: 'overlayPaneStrict' }
                );

                if (isGeoJson) {
                    marker._feature = feat;
                } else {
                    marker._treeIdx = i;
                }
                batch.push(marker);
                markersRef.push(marker);
            }
            cluster.addLayers(batch);
            offset = end;
            if (offset < total) setTimeout(processChunk, 0);
        }
        processChunk();

        if (shouldGroupBySchool) {
            try {
                const schools = createSchoolPolygonSummaries(schoolFeatures);
                if (schools.length === 0) {
                    schoolSummaryReady = true;
                    syncLayerMode();
                } else {
                    const schoolCounts = new Uint32Array(schools.length);
                    const schoolIndex = buildSchoolSpatialIndex(schools);
                    const ASSIGNMENT_CHUNK = 3000;
                    let treeOffset = 0;

                    function assignTreesToSchools() {
                        if (cancelled) return;
                        try {
                            const end = Math.min(treeOffset + ASSIGNMENT_CHUNK, total);
                            for (let i = treeOffset; i < end; i++) {
                                const lng = coords[i * 2];
                                const lat = coords[i * 2 + 1];
                                let schoolIdx = findContainingSchoolIndex(lng, lat, schools, schoolIndex);
                                if (schoolIdx < 0) {
                                    schoolIdx = findNearestSchoolIndex(lng, lat, schools, schoolIndex);
                                }
                                if (schoolIdx >= 0) schoolCounts[schoolIdx] += 1;
                            }
                            treeOffset = end;

                            if (treeOffset < total) {
                                setTimeout(assignTreesToSchools, 0);
                                return;
                            }

                            if (cancelled) return;
                            const summaryMarkers = [];
                            for (let i = 0; i < schools.length; i++) {
                                const count = schoolCounts[i];
                                if (!count) continue;
                                const school = schools[i];
                        const marker = L.marker([school.centerLat, school.centerLng], {
                            icon: getSchoolTreeIcon(count),
                            pane: 'treeSummaryPane',
                            zIndexOffset: 1000,
                            interactive: true,
                            bubblingMouseEvents: false
                        });

                                marker.on('click', () => {
                                    const feature = {
                                        type: 'Feature',
                                        geometry: { type: 'Point', coordinates: [school.centerLng, school.centerLat] },
                                        properties: {
                                            b: '',
                                            c: '',
                                            d: 'Grouped by school polygon',
                                            s: school.name,
                                            treeCount: Number(count)
                                        }
                                    };
                                    onClickRef.current(feature, layer.id);
                                });

                                summaryMarkers.push(marker);
                            }

                            for (let i = 0; i < summaryMarkers.length; i++) {
                                schoolSummaryLayer.addLayer(summaryMarkers[i]);
                            }
                            schoolSummaryReady = true;
                            syncLayerMode();
                        } catch (err) {
                            console.warn('TreeKeeper school grouping failed; falling back to regular clustering.', err);
                        }
                    }

                    setTimeout(assignTreesToSchools, 0);
                }
            } catch (err) {
                console.warn('TreeKeeper school grouping setup failed; falling back to regular clustering.', err);
            }
        }

        return () => {
            cancelled = true;
            map.off('zoomend', onZoomEnd);
            if (clusterRef.current) {
                if (map.hasLayer(clusterRef.current)) map.removeLayer(clusterRef.current);
                clusterRef.current = null;
            }
            if (schoolSummaryRef.current) {
                if (map.hasLayer(schoolSummaryRef.current)) map.removeLayer(schoolSummaryRef.current);
                schoolSummaryRef.current = null;
            }
        };
    }, [rawData, map, layer.id, layer.radiusByZoom, schoolFeatures]);

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

function getZoomScaledValue(config, zoom) {
    if (!config || typeof zoom !== 'number') return null;
    const { min, max, minZoom, maxZoom } = config;
    if ([min, max, minZoom, maxZoom].some(v => typeof v !== 'number')) return null;
    if (minZoom === maxZoom) return clamp(max, min, max);
    const t = (zoom - minZoom) / (maxZoom - minZoom);
    const raw = min + t * (max - min);
    return clamp(raw, min, max);
}

function getInteractiveLineWeight(layer, zoom) {
    const base = layer.weight !== undefined ? layer.weight : 0.5;
    if (layer.category !== 'sdn') return base;

    // Keep SDN subtle at county view and progressively stronger at street view.
    const fallbackMin = Math.min(base, 0.9);
    const fallbackMax = Math.max(base * 1.25, fallbackMin + 0.35);
    const scale = layer.lineWeightByZoom || {
        min: fallbackMin,
        max: fallbackMax,
        minZoom: 9,
        maxZoom: 18
    };
    const scaled = getZoomScaledValue(scale, zoom);
    const resolved = scaled != null ? scaled : base;
    if (typeof layer.minClickWeight === 'number' && zoom >= 14) {
        return Math.max(resolved, layer.minClickWeight);
    }
    return resolved;
}

function getInteractivePointRadius(layer, zoom) {
    let radius = layer.radius || 6;
    if (layer.radiusByZoom) {
        const scaled = getZoomScaledValue(layer.radiusByZoom, zoom);
        if (scaled != null && !isNaN(scaled)) radius = scaled;
    }
    if (layer.category !== 'sdn' || zoom < 14) return radius;
    return Math.max(radius, layer.minClickRadius || 4);
}

function getLayerPaneId(layer, isBoundary = false, interactive = false) {
    if (isBoundary || layer?.isBoundary || layer?.category === 'boundaries') {
        return interactive ? 'boundaryInteractivePane' : 'boundaryPane';
    }
    if (layer?.id === 'gsa_2024') return 'topOverlayPane';
    if (layer?.category === 'datasets') return 'datasetPane';
    if (layer?.category === 'sdn') return 'sdnPane';
    return 'overlayPaneStrict';
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
        if (!map.getPane('boundaryInteractivePane')) {
            const bip = map.createPane('boundaryInteractivePane');
            bip.style.zIndex = 360;
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

        if (!map.getPane('sdnPane')) {
            const sp = map.createPane('sdnPane');
            sp.style.zIndex = 560;
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

        if (!map.getPane('treeSummaryPane')) {
            const tsp = map.createPane('treeSummaryPane');
            tsp.style.zIndex = 650;
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
                    <div style={{ fontSize: '3rem', marginBottom: '16px', opacity: 0.5 }}>âš ï¸</div>
                    <h3>Map Failed to Load</h3>
                    <p style={{ fontSize: '0.8rem' }}>There was an error rendering the map data.</p>
                </div>
            );
        }
        return this.props.children;
    }
}

const globalFileCache = {};

// Some vendor-exported GeoJSON files contain bare NaN tokens, which are invalid JSON.
// Replace only value-position NaN tokens so JSON.parse can recover safely.
function sanitizeInvalidJsonNumbers(text) {
    let sanitized = text;
    sanitized = sanitized.replace(/(:\s*)NaN(?=\s*[,}\]])/g, '$1null');
    sanitized = sanitized.replace(/(\[\s*)NaN(?=\s*[,}\]])/g, '$1null');
    sanitized = sanitized.replace(/(,\s*)NaN(?=\s*[,}\]])/g, '$1null');
    return sanitized;
}

async function fetchLayerJson(file) {
    const response = await fetch(file);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    if (file.toLowerCase().endsWith('.pbf') || file.toLowerCase().endsWith('.bin')) {
        const bytes = new Uint8Array(await response.arrayBuffer());
        return geobuf.decode(new Pbf(bytes));
    }

    const rawText = await response.text();

    const maybeConvertTopo = (parsed) => {
        if (parsed?.type !== 'Topology' || !parsed.objects) return parsed;
        const objectNames = Object.keys(parsed.objects);
        if (!objectNames.length) throw new Error(`No TopoJSON objects found in ${file}`);
        return topojsonFeature(parsed, parsed.objects[objectNames[0]]);
    };

    try {
        return maybeConvertTopo(JSON.parse(rawText));
    } catch (parseErr) {
        if (!rawText.includes('NaN')) throw parseErr;
        const sanitized = sanitizeInvalidJsonNumbers(rawText);
        if (sanitized === rawText) throw parseErr;
        try {
            console.warn(`Sanitized invalid NaN values while loading ${file}.`);
            return maybeConvertTopo(JSON.parse(sanitized));
        } catch {
            throw parseErr;
        }
    }
}

function primeLayerFile(file) {
    if (!globalFileCache[file]) {
        globalFileCache[file] = fetchLayerJson(file).catch(err => {
            console.warn(`Failed to load ${file}:`, err);
            return null;
        });
    }
    return globalFileCache[file];
}

function getRingArea(ring) {
    if (!Array.isArray(ring) || ring.length < 4) return 0;
    let twiceArea = 0;
    for (let i = 0; i < ring.length - 1; i++) {
        const [x1, y1] = ring[i] || [];
        const [x2, y2] = ring[i + 1] || [];
        if (
            typeof x1 !== 'number' || typeof y1 !== 'number' ||
            typeof x2 !== 'number' || typeof y2 !== 'number'
        ) {
            continue;
        }
        twiceArea += (x1 * y2) - (x2 * y1);
    }
    return Math.abs(twiceArea / 2);
}

function getPolygonArea(coordinates) {
    if (!Array.isArray(coordinates) || coordinates.length === 0) return 0;
    const outerArea = getRingArea(coordinates[0]);
    if (!outerArea) return 0;

    let holeArea = 0;
    for (let i = 1; i < coordinates.length; i++) {
        holeArea += getRingArea(coordinates[i]);
    }
    return Math.max(0, outerArea - holeArea);
}

function getFeatureGeometryArea(feature) {
    const geometry = feature?.geometry;
    if (!geometry) return 0;

    if (geometry.type === 'Polygon') {
        return getPolygonArea(geometry.coordinates);
    }

    if (geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)) {
        let area = 0;
        for (let i = 0; i < geometry.coordinates.length; i++) {
            area += getPolygonArea(geometry.coordinates[i]);
        }
        return area;
    }

    return 0;
}

function sortFeaturesByAreaDescending(features) {
    if (!Array.isArray(features) || features.length < 2) return features;

    const hasPolygons = features.some((feature) => {
        const type = feature?.geometry?.type;
        return type === 'Polygon' || type === 'MultiPolygon';
    });
    if (!hasPolygons) return features;

    return features
        .map((feature, index) => ({ feature, index, area: getFeatureGeometryArea(feature) }))
        .sort((a, b) => (b.area - a.area) || (a.index - b.index))
        .map(({ feature }) => feature);
}

function getSchoolDuplicateFillOpacity(baseOpacity, feature, layerId, options = {}) {
    if (layerId === 'schools_andparks' && feature?.properties?._isDuplicate) {
        const selected = options?.selected === true;
        // Keep duplicate campuses visually light to avoid opacity stacking, while
        // preserving a stronger fill for selected features so clicks remain clear.
        const duplicateCap = selected ? 0.22 : 0.02;
        return Math.min(baseOpacity, duplicateCap);
    }
    return baseOpacity;
}

const SCHOOL_METRIC_WEIGHT_ID = {
    CanopyHeatReliefScore: 'canopyHeatRelief',
    DisadvantagedCommunitiesScore: 'dac',
    infilpot_pctl: 'infilpot_pctl',
};

function getPresetWeightsForSchoolMetric(metric) {
    const defaults = getDefaultWeights();
    const targetWeightId = SCHOOL_METRIC_WEIGHT_ID[metric];

    if (!targetWeightId) return defaults;

    const preset = {};
    for (const id of Object.keys(defaults)) {
        preset[id] = 0;
    }
    preset[targetWeightId] = 100;
    return preset;
}

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
    const [customScoringWeights, setCustomScoringWeights] = useState(getDefaultWeights);
    const tooltipRef = useRef(null);
    const [visibleSchoolCount, setVisibleSchoolCount] = useState(null);
    const handleVisibleCountUpdate = useCallback((count) => setVisibleSchoolCount(count), []);
    const scoringWeights = useMemo(() => {
        if (activeSchoolMetric === 'CWHScore') return customScoringWeights;
        return getPresetWeightsForSchoolMetric(activeSchoolMetric);
    }, [activeSchoolMetric, customScoringWeights]);
    const handleScoringWeightsChange = useCallback((nextWeights) => {
        setCustomScoringWeights(nextWeights);
        // Any manual slider edit means we're back in composite/custom index mode.
        if (activeSchoolMetric !== 'CWHScore') {
            setActiveSchoolMetric('CWHScore');
        }
    }, [activeSchoolMetric]);

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
    const sdnCanvasRenderer = useMemo(() => L.canvas({ padding: 0.5, tolerance: 10 }), []);

    // Warm up the heaviest SDN file in the background so first click is faster.
    useEffect(() => {
        const layersToPrefetch = LAYER_CONFIG.filter((layer) => layer.prefetch);
        if (!layersToPrefetch.length) return;

        const runPrefetch = () => {
            layersToPrefetch.forEach((layer) => {
                primeLayerFile(layer.file);
            });
        };

        if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
            const idleId = window.requestIdleCallback(runPrefetch, { timeout: 3000 });
            return () => window.cancelIdleCallback(idleId);
        }

        const timer = setTimeout(runPrefetch, 1200);
        return () => clearTimeout(timer);
    }, []);

    useEffect(() => {
        let cancelled = false;

        async function loadRequiredLayers() {
            const requiredLayers = LAYER_CONFIG.filter(l => visibleLayers[l.id] || l.id === 'schools_andparks');
            const fetches = [];

            for (const layer of requiredLayers) {
                // Ignore if it's already staged in state
                if (layerData[layer.id]) continue;

                fetches.push((async () => {
                    let data = await primeLayerFile(layer.file);
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
                const isBoundary = lCfg.isBoundary || lCfg.category === 'boundaries';
                const isBoundaryInteractive = isBoundary && lCfg.interactive === true;
                const fill = lCfg.dynamicColor ? lCfg.dynamicColor(feature) : (lCfg.fillColor || '#4ade80');
                const dynamicStroke = lCfg.dynamicStrokeColor ? lCfg.dynamicStrokeColor(feature, fill) : fill;
                const stroke = isBoundary ? (lCfg.color || '#475569') : (lCfg.dynamicColor ? dynamicStroke : (lCfg.color || '#000'));
                const defaultWeight = getInteractiveLineWeight(lCfg, mapZoom);
                let defaultFillOpacity = isBoundary
                    ? (isBoundaryInteractive ? (lCfg.fillOpacity !== undefined ? lCfg.fillOpacity : 0.01) : 0)
                    : (lCfg.fillOpacity !== undefined ? lCfg.fillOpacity : (lCfg.category === 'datasets' ? 0.4 : 0.6));
                defaultFillOpacity = getSchoolDuplicateFillOpacity(defaultFillOpacity, feature, lCfg.id);
                oldLayer.setStyle({
                    weight: defaultWeight,
                    fillOpacity: defaultFillOpacity,
                    color: stroke,
                    fillColor: isBoundaryInteractive ? fill : (isBoundary ? 'transparent' : fill)
                });
            }
        }
    }, [mapZoom]);

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
            const isBoundary = layerConfig.isBoundary || layerConfig.category === 'boundaries';
            const isBoundaryInteractive = isBoundary && layerConfig.interactive === true;
            const selectedFillOpacity = isBoundary
                ? (isBoundaryInteractive ? 0.08 : 0.1)
                : getSchoolDuplicateFillOpacity(0.85, feature, layerConfig.id, { selected: true });
            featureLayer.setStyle({
                weight: isBoundary ? 4 : Math.max(getInteractiveLineWeight(layerConfig, mapZoom), 2),
                fillOpacity: selectedFillOpacity,
                color: '#ffffff' // Clean white outline for selection
            });
            // Keep school draw order stable (small on top) so overlapping schools stay clickable.
            if (featureLayer.bringToFront && layerId !== 'schools_andparks') {
                featureLayer.bringToFront();
            }
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
    }, [resetHighlight, layerData, coordinateIndex, mapZoom]);

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
        const orderedScoredFeatures = sortFeaturesByAreaDescending(scoredFeatures);

        return {
            ...layerData,
            schools_andparks: { ...schoolsGeo, features: orderedScoredFeatures },
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
                                const isInteractive = layer.interactive === true || !isBoundary;
                                const paneId = getLayerPaneId(layer, isBoundary, isInteractive);

                                // Use marker clustering for dense point layers
                                if (layer.clustered) {
                                    // Compact data has coords/lookups at top level (no .features)
                                    return (
                                        <MarkerClusterLayer
                                            key={`${layer.id}-${geoKeys[layer.id]}-cluster`}
                                            rawData={data}
                                            layer={layer}
                                            schoolFeatures={layer.id === 'school_trees' ? layerData['schools_andparks']?.features : null}
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
                                const layerWeight = getInteractiveLineWeight(layer, mapZoom);
                                const layerRadius = getInteractivePointRadius(layer, mapZoom);
                                const isSdn = layer.category === 'sdn';
                                const isSchool = layer.id === 'schools_andparks';
                                const layerBaseFillOpacity = layer.fillOpacity !== undefined ? layer.fillOpacity : (layer.category === 'datasets' ? 0.4 : 0.6);
                                const layerStrokeOpacity = layer.strokeOpacity !== undefined ? layer.strokeOpacity : 1;

                                return (
                                    <GeoJSON
                                        key={geoKey}
                                        data={filteredData}
                                        interactive={isInteractive}
                                        renderer={isSdn ? sdnCanvasRenderer : undefined}
                                        smoothFactor={isSdn ? (layer.smoothFactor || 2) : 1}
                                        pane={paneId}
                                        pointToLayer={(feature, latlng) => {
                                            if (layer.pointToLayer) return layer.pointToLayer(feature, latlng);
                                            const basePtFillOpacity = layer.fillOpacity !== undefined ? layer.fillOpacity : 0.8;
                                            const ptFillOpacity = isSchool 
                                                ? getSchoolDuplicateFillOpacity(basePtFillOpacity, feature, layer.id)
                                                : basePtFillOpacity;

                                            return L.circleMarker(latlng, {
                                                radius: layerRadius,
                                                fillColor: layer.fillColor || '#4ade80',
                                                color: layer.color || '#000000',
                                                weight: layerWeight,
                                                opacity: layerStrokeOpacity,
                                                fillOpacity: ptFillOpacity
                                            });
                                        }}
                                        style={(feature) => {
                                            let fill = layer.fillColor || '#4ade80';
                                            let stroke = layer.color || '#000000';
                                            let weight = layerWeight;
                                            let fillOpacity = layerBaseFillOpacity;
                                            let strokeOpacity = layerStrokeOpacity;

                                            if (layer.dynamicColor) {
                                                fill = layer.dynamicColor(feature, activeSchoolMetric);
                                                stroke = layer.dynamicStrokeColor
                                                    ? layer.dynamicStrokeColor(feature, activeSchoolMetric, fill)
                                                    : fill;
                                            }

                                            if (isSchool) {
                                                fillOpacity = getSchoolDuplicateFillOpacity(fillOpacity, feature, layer.id);
                                            }

                                            return {
                                                pane: paneId,
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
                                                if (!isInteractive) return; // No event handlers for non-interactive boundaries
                                            }

                                            // For massive SDN layers, keep only click handlers to reduce first-load lag.
                                            if (layer.clickOnly) {
                                                featureLayer.on({
                                                    click: (e) => handleFeatureClick(feature, layer.id, e.target, layer)
                                                });
                                                return;
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
                                                    const isBoundaryHover = layer.isBoundary || layer.category === 'boundaries';
                                                    const hoverWeight = isBoundaryHover
                                                        ? 3
                                                        : Math.max(getInteractiveLineWeight(layer, mapZoom), 1.2);
                                                    e.target.setStyle({
                                                        weight: hoverWeight,
                                                        color: '#f8fafc', // slate-50
                                                        opacity: 0.6,
                                                        fillOpacity: isBoundaryHover ? 0.05 : 0.70
                                                    });
                                                },
                                                mouseout: (e) => {
                                                    if (tooltipRef.current) tooltipRef.current.style.display = 'none';

                                                    if (selectedLayerRef.current === e.target) return;
                                                    const fill = layer.dynamicColor ? layer.dynamicColor(feature, activeSchoolMetric) : (layer.fillColor || '#4ade80');
                                                    const stroke = layer.dynamicColor
                                                        ? (layer.dynamicStrokeColor
                                                            ? layer.dynamicStrokeColor(feature, activeSchoolMetric, fill)
                                                            : fill)
                                                        : (layer.color || '#000');
                                                    const defaultWeight = getInteractiveLineWeight(layer, mapZoom);
                                                    let defaultFillOpacity = layer.fillOpacity !== undefined ? layer.fillOpacity : (layer.category === 'datasets' ? 0.4 : 0.6);
                                                    defaultFillOpacity = getSchoolDuplicateFillOpacity(defaultFillOpacity, feature, layer.id);
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
                        }, [visibleLayers, scoredLayerData, geoKeys, activeSchoolMetric, schoolOpenFilter, validWeights, handleFeatureClick, mapZoom, sdnCanvasRenderer])}
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
                        <ScoringPanel
                            weights={scoringWeights}
                            setWeights={handleScoringWeightsChange}
                            activeSchoolMetric={activeSchoolMetric}
                            setActiveSchoolMetric={setActiveSchoolMetric}
                        />
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

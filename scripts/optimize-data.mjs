import fs from 'node:fs';
import path from 'node:path';
import geobuf from 'geobuf';
import Pbf from 'pbf';
import { feature as topojsonFeature } from 'topojson-client';

const DATA_ROOT = path.resolve('public', 'data');

const PBF_TARGETS = [
    // Primary large non-SDN layers
    { source: 'finalschoolswithdatareal.topojson', output: 'finalschoolswithdatareal.bin', precision: 5 },
    { source: 'canopy_blockgroups_lacounty.topojson', output: 'canopy_blockgroups_lacounty.bin', precision: 5 },
    { source: 'tree_equity.geojson', output: 'tree_equity.bin', precision: 5 },
    { source: 'ces.geojson', output: 'ces.bin', precision: 5 },
    { source: 'mupolygon.topojson', output: 'mupolygon.bin', precision: 5 },
    { source: 'scw_groundwater.geojson', output: 'scw_groundwater.bin', precision: 5 },
    { source: 'scw_stormwater.geojson', output: 'scw_stormwater.bin', precision: 5 },
    { source: 'scw_waterquality.topojson', output: 'scw_waterquality.bin', precision: 5 },
    { source: 'countywide_parks.geojson', output: 'countywide_parks.bin', precision: 5 },
    { source: 'watershed_boundaries.geojson', output: 'watershed_boundaries.bin', precision: 5 },
    { source: 'Watershed/Watersheds subbasins.geojson', output: 'Watershed/Watersheds subbasins.bin', precision: 5 },

    // Heaviest SDN layers (more aggressive where needed)
    { source: 'sdn/OpenChannel.bin', output: 'sdn/OpenChannel.bin', precision: 4 },
    { source: 'sdn/GravityMain.bin', output: 'sdn/GravityMain.bin', precision: 3 },
    { source: 'sdn/LateralLine.bin', output: 'sdn/LateralLine.bin', precision: 3 },
    { source: 'sdn/PermittedConnection.bin', output: 'sdn/PermittedConnection.bin', precision: 4 },
    { source: 'sdn/CatchBasin.bin', output: 'sdn/CatchBasin.bin', precision: 5 },
    { source: 'sdn/MaintenanceHole.bin', output: 'sdn/MaintenanceHole.bin', precision: 5 },
];

function sanitizeInvalidJsonNumbers(text) {
    let sanitized = text;
    sanitized = sanitized.replace(/(:\s*)NaN(?=\s*[,}\]])/g, '$1null');
    sanitized = sanitized.replace(/(\[\s*)NaN(?=\s*[,}\]])/g, '$1null');
    sanitized = sanitized.replace(/(,\s*)NaN(?=\s*[,}\]])/g, '$1null');
    return sanitized;
}

function bytesToMB(bytes) {
    return (bytes / (1024 * 1024)).toFixed(2);
}

function roundCoord(value, precision) {
    const factor = 10 ** precision;
    return Math.round(value * factor) / factor;
}

function dedupeRoundedCoords(coords, precision, minPoints = 0) {
    const out = [];
    let prevKey = null;
    for (const coord of coords || []) {
        if (!Array.isArray(coord) || coord.length < 2) continue;
        const x = roundCoord(coord[0], precision);
        const y = roundCoord(coord[1], precision);
        const key = `${x},${y}`;
        if (key === prevKey) continue;
        out.push([x, y]);
        prevKey = key;
    }
    if (minPoints && out.length < minPoints) return null;
    return out;
}

function simplifyGeometry(geometry, precision) {
    if (!geometry || !geometry.type) return null;

    if (geometry.type === 'Point') {
        const [x, y] = geometry.coordinates || [];
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        return { ...geometry, coordinates: [roundCoord(x, precision), roundCoord(y, precision)] };
    }

    if (geometry.type === 'MultiPoint') {
        const coords = (geometry.coordinates || [])
            .filter((pt) => Array.isArray(pt) && pt.length >= 2)
            .map(([x, y]) => [roundCoord(x, precision), roundCoord(y, precision)]);
        if (!coords.length) return null;
        return { ...geometry, coordinates: coords };
    }

    if (geometry.type === 'LineString') {
        const coords = dedupeRoundedCoords(geometry.coordinates, precision, 2);
        if (!coords) return null;
        return { ...geometry, coordinates: coords };
    }

    if (geometry.type === 'MultiLineString') {
        const lines = (geometry.coordinates || [])
            .map((line) => dedupeRoundedCoords(line, precision, 2))
            .filter(Boolean);
        if (!lines.length) return null;
        return { ...geometry, coordinates: lines };
    }

    if (geometry.type === 'Polygon') {
        const rings = (geometry.coordinates || [])
            .map((ring) => dedupeRoundedCoords(ring, precision, 4))
            .filter(Boolean);
        if (!rings.length) return null;
        return { ...geometry, coordinates: rings };
    }

    if (geometry.type === 'MultiPolygon') {
        const polys = [];
        for (const polygon of geometry.coordinates || []) {
            const rings = (polygon || [])
                .map((ring) => dedupeRoundedCoords(ring, precision, 4))
                .filter(Boolean);
            if (rings.length) polys.push(rings);
        }
        if (!polys.length) return null;
        return { ...geometry, coordinates: polys };
    }

    return geometry;
}

function simplifyGeoJson(geoJson, precision) {
    if (!geoJson?.features?.length) {
        return { geoJson, beforeCount: 0, afterCount: 0 };
    }

    const simplifiedFeatures = [];
    for (const feature of geoJson.features) {
        const simplifiedGeometry = simplifyGeometry(feature.geometry, precision);
        if (!simplifiedGeometry) continue;
        simplifiedFeatures.push({ ...feature, geometry: simplifiedGeometry });
    }

    return {
        geoJson: { ...geoJson, features: simplifiedFeatures },
        beforeCount: geoJson.features.length,
        afterCount: simplifiedFeatures.length,
    };
}

function loadGeoJsonFromGeoJson(absPath) {
    const raw = fs.readFileSync(absPath, 'utf8');
    const safe = sanitizeInvalidJsonNumbers(raw);
    return {
        geo: JSON.parse(safe),
        bytes: Buffer.byteLength(raw),
        source: absPath,
    };
}

function loadGeoJsonFromTopoJson(absPath) {
    const raw = fs.readFileSync(absPath, 'utf8');
    const topology = JSON.parse(raw);
    const objectNames = Object.keys(topology.objects || {});
    if (!objectNames.length) {
        throw new Error(`No objects found in TopoJSON: ${absPath}`);
    }
    const geo = topojsonFeature(topology, topology.objects[objectNames[0]]);
    return {
        geo,
        bytes: Buffer.byteLength(raw),
        source: absPath,
    };
}

function loadGeoJsonFromPbf(absPath) {
    const pbfBytes = fs.readFileSync(absPath);
    return {
        geo: geobuf.decode(new Pbf(pbfBytes)),
        bytes: pbfBytes.length,
        source: absPath,
    };
}

function loadInputGeoJson(relPath) {
    const abs = path.join(DATA_ROOT, relPath);
    if (!fs.existsSync(abs)) return null;

    const ext = path.extname(abs).toLowerCase();
    if (ext === '.geojson' || ext === '.json') return loadGeoJsonFromGeoJson(abs);
    if (ext === '.topojson') return loadGeoJsonFromTopoJson(abs);
    if (ext === '.bin') return loadGeoJsonFromPbf(abs);
    throw new Error(`Unsupported input extension: ${abs}`);
}

function run() {
    let totalBefore = 0;
    let totalAfter = 0;

    for (const target of PBF_TARGETS) {
        const loaded = loadInputGeoJson(target.source);
        if (!loaded) {
            console.warn(`Skipping missing source: ${path.join(DATA_ROOT, target.source)}`);
            continue;
        }

        const simplified = simplifyGeoJson(loaded.geo, target.precision);
        const pbfBytes = Buffer.from(geobuf.encode(simplified.geoJson, new Pbf()));
        const outputPath = path.join(DATA_ROOT, target.output);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, pbfBytes);

        const beforeBytes = loaded.bytes;
        const afterBytes = pbfBytes.length;
        totalBefore += beforeBytes;
        totalAfter += afterBytes;

        const pct = ((1 - afterBytes / beforeBytes) * 100).toFixed(1);
        const removed = Math.max((simplified.beforeCount || 0) - (simplified.afterCount || 0), 0);
        console.log(
            `${target.source} -> ${target.output} (p=${target.precision}, source=${path.basename(loaded.source)}): ` +
            `${bytesToMB(beforeBytes)} MB -> ${bytesToMB(afterBytes)} MB (${pct}% smaller), ` +
            `features ${simplified.beforeCount} -> ${simplified.afterCount} (removed ${removed})`
        );
    }

    const totalPct = totalBefore > 0 ? ((1 - totalAfter / totalBefore) * 100).toFixed(1) : '0.0';
    console.log(`Total: ${bytesToMB(totalBefore)} MB -> ${bytesToMB(totalAfter)} MB (${totalPct}% smaller)`);
}

run();

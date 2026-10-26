import { BARANGAY_ANCHORS, BARANGAY_COLLECTION_ROUTES, CENRO_DEPOT_WAYPOINT, getBarangaySimulationRoute, SimulationWaypoint } from '@/constants/barangaySimulationRoutes';
import { fetchWithFastTimeout } from '@/utils/devicePerformance';

export type Coordinate = {
  latitude: number;
  longitude: number;
};

// In-memory cache to prevent redundant API calls
const routeCache = new Map<string, Coordinate[]>();

/**
 * Fetches real road-snapped geometry from OpenStreetMap OSRM routing engine.
 * Converts sparse waypoints into hundreds of dense turn-by-turn road coordinates.
 */
export async function fetchRoadPolyline(
  waypoints: Coordinate[]
): Promise<Coordinate[]> {
  if (!waypoints || waypoints.length < 2) {
    return waypoints || [];
  }

  // Filter valid numerical coordinates
  const valid = waypoints.filter(
    (p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude)
  );
  if (valid.length < 2) return valid;

  // Key for in-memory caching
  const cacheKey = valid
    .map((p) => `${p.latitude.toFixed(4)},${p.longitude.toFixed(4)}`)
    .join(';');

  if (routeCache.has(cacheKey)) {
    return routeCache.get(cacheKey)!;
  }

  try {
    let roadCoordinates: Coordinate[] = [];

    if (valid.length <= 30) {
      const coordinatesString = valid
        .map((p) => `${p.longitude},${p.latitude}`)
        .join(';');
      const url = `https://router.project-osrm.org/route/v1/driving/${coordinatesString}?overview=full&geometries=geojson`;
      const response = await fetchWithFastTimeout(url, {
        headers: {
          Accept: 'application/json',
        },
      }, 2500);

      if (response.ok) {
        const data = await response.json();
        if (data.code === 'Ok' && data.routes && data.routes[0]?.geometry?.coordinates) {
          roadCoordinates = data.routes[0].geometry.coordinates.map(
            ([lng, lat]: [number, number]) => ({
              latitude: lat,
              longitude: lng,
            })
          );
        }
      }
    } else {
      // Chunk into segments of 25 with 1-point overlap to visit every waypoint along real roads
      const chunkSize = 25;
      for (let i = 0; i < valid.length - 1; i += chunkSize - 1) {
        const chunk = valid.slice(i, i + chunkSize);
        const coordinatesString = chunk
          .map((p) => `${p.longitude},${p.latitude}`)
          .join(';');
        const url = `https://router.project-osrm.org/route/v1/driving/${coordinatesString}?overview=full&geometries=geojson`;
        const response = await fetchWithFastTimeout(url, {
          headers: {
            Accept: 'application/json',
          },
        }, 2500);
        if (response.ok) {
          const data = await response.json();
          if (data.code === 'Ok' && data.routes && data.routes[0]?.geometry?.coordinates) {
            const subCoords: Coordinate[] = data.routes[0].geometry.coordinates.map(
              ([lng, lat]: [number, number]) => ({
                latitude: lat,
                longitude: lng,
              })
            );
            if (roadCoordinates.length > 0 && subCoords.length > 0) {
              roadCoordinates.push(...subCoords.slice(1));
            } else {
              roadCoordinates.push(...subCoords);
            }
          }
        }
      }
    }

    if (roadCoordinates.length >= 2) {
      routeCache.set(cacheKey, roadCoordinates);
      return roadCoordinates;
    }
  } catch (error) {
    console.warn('OSRM road routing fallback active:', error);
  }

  // Fallback: Return original waypoints with smooth linear interpolation
  const interpolated = interpolateCoordinates(valid, 15);
  routeCache.set(cacheKey, interpolated);
  return interpolated;
}

/**
 * Retrieves the full, dense road polyline coordinates for any Danao City barangay route.
 */
export async function getRoadPolylineForBarangay(
  barangayName?: string
): Promise<Coordinate[]> {
  const target = (barangayName || 'Poblacion').trim();
  const baseWaypoints = getBarangaySimulationRoute(target);
  return fetchRoadPolyline(
    baseWaypoints.map((w) => ({ latitude: w.latitude, longitude: w.longitude }))
  );
}

/**
 * Generates a high-precision, road-accurate driver simulation path for any Danao City barangay.
 * Queries OSRM so the truck follows real streets, bridges, and highways.
 */
export async function getRoadSnappedSimulationRoute(
  barangayName?: string
): Promise<SimulationWaypoint[]> {
  const target = (barangayName || 'Poblacion').trim();
  const baseWaypoints = getBarangaySimulationRoute(target);

  try {
    const roadCoordinates = await fetchRoadPolyline(
      baseWaypoints.map((w) => ({ latitude: w.latitude, longitude: w.longitude }))
    );

    if (roadCoordinates.length > 5) {
      // Step through road points to produce smooth simulation steps (~25-35m apart)
      // Sampling target ~180 points preserves every road curve and corner
      const targetStepCount = Math.min(roadCoordinates.length, 180);
      const stepInterval = Math.max(1, Math.floor(roadCoordinates.length / targetStepCount));

      const simulationRoute: SimulationWaypoint[] = [];

      for (let i = 0; i < roadCoordinates.length; i += stepInterval) {
        const coord = roadCoordinates[i];
        const progress = i / roadCoordinates.length;
        const speed = Math.floor(22 + Math.sin(progress * Math.PI * 4) * 6 + Math.random() * 4);

        const cleanTarget = target.replace(/_(Whole|Original|Direct)/i, '').replace(/\s*\([^)]*\)/g, '').trim();
        // Find nearest base waypoint landmark name for accurate HUD reporting
        let nearestName = `Brgy. ${cleanTarget} Collection Sector`;
        let minD = 99999;
        for (const bw of baseWaypoints) {
          const d = Math.abs(bw.latitude - coord.latitude) + Math.abs(bw.longitude - coord.longitude);
          if (d < minD) {
            minD = d;
            nearestName = bw.name || nearestName;
          }
        }

        if (i === 0) nearestName = baseWaypoints[0]?.name || 'CENRO Municipal Depot (Origin)';
        else if (i >= roadCoordinates.length - stepInterval) {
          nearestName = baseWaypoints[baseWaypoints.length - 1]?.name || 'CENRO Municipal Transfer Station (Return)';
        }

        simulationRoute.push({
          latitude: coord.latitude,
          longitude: coord.longitude,
          name: nearestName,
          speed,
          barangay: progress > 0.2 && progress < 0.8 ? cleanTarget : 'Poblacion',
        });
      }

      // Ensure last point is included
      const lastCoord = roadCoordinates[roadCoordinates.length - 1];
      if (
        simulationRoute.length > 0 &&
        (simulationRoute[simulationRoute.length - 1].latitude !== lastCoord.latitude ||
          simulationRoute[simulationRoute.length - 1].longitude !== lastCoord.longitude)
      ) {
        simulationRoute.push({
          latitude: lastCoord.latitude,
          longitude: lastCoord.longitude,
          name: baseWaypoints[baseWaypoints.length - 1]?.name || 'CENRO Municipal Transfer Station (Return)',
          speed: 18,
          barangay: 'Poblacion',
        });
      }

      return simulationRoute;
    }
  } catch (err) {
    console.warn('Road snapped route generation error, using base route:', err);
  }

  return baseWaypoints;
}

/**
 * Samples array of waypoints evenly to stay within API limit.
 */
function sampleWaypoints(points: Coordinate[], maxCount: number): Coordinate[] {
  if (points.length <= maxCount) return points;
  const result: Coordinate[] = [points[0]];
  const step = (points.length - 1) / (maxCount - 1);
  for (let i = 1; i < maxCount - 1; i++) {
    result.push(points[Math.round(i * step)]);
  }
  result.push(points[points.length - 1]);
  return result;
}

/**
 * Interpolates smooth intermediate points if OSRM is offline.
 */
function interpolateCoordinates(points: Coordinate[], stepsPerSegment = 10): Coordinate[] {
  const result: Coordinate[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];
    for (let s = 0; s < stepsPerSegment; s++) {
      const t = s / stepsPerSegment;
      result.push({
        latitude: start.latitude + (end.latitude - start.latitude) * t,
        longitude: start.longitude + (end.longitude - start.longitude) * t,
      });
    }
  }
  result.push(points[points.length - 1]);
  return result;
}

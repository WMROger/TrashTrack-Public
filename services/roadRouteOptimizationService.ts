import { optimizeRoute, RoutableStop } from '@/services/routeOptimizationService';

export type MapCoordinate = { latitude: number; longitude: number };

export type RoadRouteOptions = {
  optimizeWaypointOrder?: boolean;
  trafficAware?: boolean;
};

export type RoadRouteResult<T> = {
  orderedStops: T[];
  distanceKm: number;
  durationMinutes: number | null;
  geocodedStops: number;
  unlocatedStops: number;
  method: 'google-routes-waypoint-optimization' | 'geographic-fallback' | 'insufficient-coordinates';
  provider: 'Google Routes API' | 'Local geographic fallback';
  roadPolyline: MapCoordinate[];
  fallbackReason?: string;
};

const coordinateOf = (stop: RoutableStop): MapCoordinate | null => {
  const latitude = stop.location?.lat ?? stop.location?.latitude;
  const longitude = stop.location?.lng ?? stop.location?.longitude;
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    ? { latitude: Number(latitude), longitude: Number(longitude) }
    : null;
};

const waypoint = (coordinate: MapCoordinate) => ({
  location: { latLng: coordinate },
});

const haversineKm = (a: MapCoordinate, b: MapCoordinate) => {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(b.latitude - a.latitude);
  const dLng = radians(b.longitude - a.longitude);
  const value = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
};

const pathDistanceKm = <T extends RoutableStop>(stops: T[], origin: MapCoordinate | null) => {
  const coordinates = stops.map(coordinateOf).filter((item): item is MapCoordinate => item !== null);
  const path = [...(origin ? [origin] : []), ...coordinates];
  return Math.round(path.slice(1).reduce((total, coordinate, index) => (
    total + haversineKm(path[index], coordinate)
  ), 0) * 100) / 100;
};

function fallbackResult<T extends RoutableStop>(
  stops: T[],
  origin: MapCoordinate | null,
  reason: string,
  preserveOrder = false,
): RoadRouteResult<T> {
  const fallback = optimizeRoute(stops);
  const orderedStops = preserveOrder ? stops : fallback.orderedStops;
  const polyline = [
    ...(origin ? [origin] : []),
    ...orderedStops.map(coordinateOf).filter((item): item is MapCoordinate => item !== null),
  ];
  return {
    orderedStops,
    distanceKm: preserveOrder ? pathDistanceKm(orderedStops, origin) : fallback.distanceKm,
    durationMinutes: null,
    geocodedStops: fallback.geocodedStops,
    unlocatedStops: fallback.unlocatedStops,
    method: fallback.method === 'insufficient-coordinates' ? 'insufficient-coordinates' : 'geographic-fallback',
    provider: 'Local geographic fallback',
    roadPolyline: polyline,
    fallbackReason: reason,
  };
}

/**
 * Uses Google Routes waypoint optimization when configured. The existing
 * nearest-neighbor + 2-opt engine remains an automatic offline fallback.
 */
export async function optimizeRoadRoute<T extends RoutableStop>(
  stops: T[],
  truckOrigin?: MapCoordinate | null,
  options: RoadRouteOptions = {},
): Promise<RoadRouteResult<T>> {
  const locatedStops = stops.filter(stop => coordinateOf(stop));
  const unlocatedStops = stops.filter(stop => !coordinateOf(stop));
  const apiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY?.trim();
  const preserveOrder = options.optimizeWaypointOrder === false;

  if (locatedStops.length < 2) {
    return fallbackResult(stops, truckOrigin || null, 'At least two GPS-tagged stops are required for road optimization.', preserveOrder);
  }
  if (!apiKey) {
    return fallbackResult(stops, truckOrigin || null, 'Google Maps API key is not configured.', preserveOrder);
  }

  const optimizeWaypointOrder = options.optimizeWaypointOrder !== false;
  const fixedAnchorStop = truckOrigin ? null : locatedStops[0];
  const anchor = truckOrigin || coordinateOf(fixedAnchorStop!);
  const intermediateStops = fixedAnchorStop ? locatedStops.slice(1) : locatedStops;
  if (!anchor || intermediateStops.length > 25) {
    return fallbackResult(stops, truckOrigin || null, intermediateStops.length > 25
      ? 'Google waypoint optimization supports a maximum of 25 intermediate stops.'
      : 'A route origin could not be determined.', preserveOrder);
  }

  try {
    const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline,routes.optimizedIntermediateWaypointIndex',
      },
      body: JSON.stringify({
        origin: waypoint(anchor),
        destination: waypoint(anchor),
        intermediates: intermediateStops.map(stop => waypoint(coordinateOf(stop)!)),
        travelMode: 'DRIVE',
        routingPreference: options.trafficAware ? 'TRAFFIC_AWARE' : 'TRAFFIC_UNAWARE',
        optimizeWaypointOrder,
        polylineQuality: 'OVERVIEW',
        polylineEncoding: 'GEO_JSON_LINESTRING',
        languageCode: 'en-US',
        regionCode: 'ph',
        units: 'METRIC',
      }),
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Routes API ${response.status}: ${message.slice(0, 180)}`);
    }

    const payload = await response.json();
    const route = payload.routes?.[0];
    if (!route) throw new Error('Google Routes API returned no drivable route.');

    const optimizedIndices: number[] = optimizeWaypointOrder
      ? (route.optimizedIntermediateWaypointIndex || intermediateStops.map((_, index) => index))
      : intermediateStops.map((_, index) => index);
    const orderedLocated = [
      ...(fixedAnchorStop ? [fixedAnchorStop] : []),
      ...optimizedIndices.map(index => intermediateStops[index]).filter(Boolean),
    ];
    const coordinates = route.polyline?.geoJsonLinestring?.coordinates;
    const roadPolyline: MapCoordinate[] = Array.isArray(coordinates)
      ? coordinates
        .filter((pair: unknown) => Array.isArray(pair) && pair.length >= 2)
        .map((pair: number[]) => ({ latitude: Number(pair[1]), longitude: Number(pair[0]) }))
        .filter(point => Number.isFinite(point.latitude) && Number.isFinite(point.longitude))
      : [];

    return {
      orderedStops: [...orderedLocated, ...unlocatedStops],
      distanceKm: Math.round((Number(route.distanceMeters) / 1000) * 100) / 100,
      durationMinutes: Math.max(1, Math.round(Number.parseFloat(route.duration || '0') / 60)),
      geocodedStops: locatedStops.length,
      unlocatedStops: unlocatedStops.length,
      method: 'google-routes-waypoint-optimization',
      provider: 'Google Routes API',
      roadPolyline,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Road routing request failed.';
    console.warn('Road-aware optimization unavailable; using geographic fallback:', message);
    return fallbackResult(stops, truckOrigin || null, message, preserveOrder);
  }
}

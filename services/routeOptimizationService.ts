export type RoutableStop = {
  id: string;
  location?: { lat?: number; lng?: number; latitude?: number; longitude?: number } | null;
  createdAt?: unknown;
};

export type OptimizedRoute<T> = {
  orderedStops: T[];
  distanceKm: number;
  geocodedStops: number;
  unlocatedStops: number;
  method: 'nearest-neighbor-2opt' | 'insufficient-coordinates';
};

type Coordinate = { lat: number; lng: number };

const coordinateOf = (stop: RoutableStop): Coordinate | null => {
  const lat = stop.location?.lat ?? stop.location?.latitude;
  const lng = stop.location?.lng ?? stop.location?.longitude;
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat: Number(lat), lng: Number(lng) } : null;
};

const distanceKm = (a: Coordinate, b: Coordinate) => {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const value = Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
};

const routeDistance = <T extends RoutableStop>(route: T[]) => route.slice(1).reduce((sum, stop, index) => {
  const previous = coordinateOf(route[index]);
  const current = coordinateOf(stop);
  return previous && current ? sum + distanceKm(previous, current) : sum;
}, 0);

const createdTime = (value: unknown) => {
  if (typeof value === 'string' || typeof value === 'number') return new Date(value).getTime() || 0;
  if (value && typeof (value as any).toMillis === 'function') return (value as any).toMillis();
  return 0;
};

export function optimizeRoute<T extends RoutableStop>(stops: T[]): OptimizedRoute<T> {
  const located = stops.filter(stop => coordinateOf(stop));
  const unlocated = stops.filter(stop => !coordinateOf(stop)).sort((a, b) => createdTime(a.createdAt) - createdTime(b.createdAt));

  if (located.length < 2) {
    return {
      orderedStops: [...located, ...unlocated], distanceKm: 0,
      geocodedStops: located.length, unlocatedStops: unlocated.length,
      method: 'insufficient-coordinates',
    };
  }

  // Start with the oldest request, then repeatedly visit the nearest unvisited stop.
  const remaining = [...located].sort((a, b) => createdTime(a.createdAt) - createdTime(b.createdAt));
  const route: T[] = [remaining.shift()!];
  while (remaining.length) {
    const current = coordinateOf(route[route.length - 1])!;
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    remaining.forEach((candidate, index) => {
      const candidateDistance = distanceKm(current, coordinateOf(candidate)!);
      if (candidateDistance < nearestDistance) {
        nearestDistance = candidateDistance;
        nearestIndex = index;
      }
    });
    route.push(remaining.splice(nearestIndex, 1)[0]);
  }

  // Improve the greedy path by reversing segments when a 2-opt swap shortens it.
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < route.length - 2; i += 1) {
      for (let k = i + 1; k < route.length - 1; k += 1) {
        const candidate = [...route.slice(0, i), ...route.slice(i, k + 1).reverse(), ...route.slice(k + 1)];
        if (routeDistance(candidate) + 0.001 < routeDistance(route)) {
          route.splice(0, route.length, ...candidate);
          improved = true;
        }
      }
    }
  }

  return {
    orderedStops: [...route, ...unlocated],
    distanceKm: Math.round(routeDistance(route) * 100) / 100,
    geocodedStops: located.length,
    unlocatedStops: unlocated.length,
    method: 'nearest-neighbor-2opt',
  };
}

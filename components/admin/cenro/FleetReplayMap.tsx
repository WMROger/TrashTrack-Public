import React, { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { fetchRoadPolyline, Coordinate } from '@/services/osrmRoutingService';

export type ReplayPoint = {
  id: string;
  latitude: number;
  longitude: number;
  speedKph: number;
  timestampMs: number;
};

type Props = {
  points: ReplayPoint[];
  activeIndex: number;
  autoPan?: boolean;
};

declare const window: any;
declare const document: any;

const DANAO_DEFAULT_CENTER: [number, number] = [10.5218, 124.0285];

export default function FleetReplayMap({ points, activeIndex, autoPan = true }: Props) {
  const mapInstanceRef = useRef<any>(null);
  const fullPolylineRef = useRef<any>(null);
  const traveledPolylineRef = useRef<any>(null);
  const startMarkerRef = useRef<any>(null);
  const endMarkerRef = useRef<any>(null);
  const activeMarkerRef = useRef<any>(null);
  const waypointsLayerRef = useRef<any>(null);
  const [leafletReady, setLeafletReady] = useState(false);
  const [roadCoordinates, setRoadCoordinates] = useState<Array<[number, number]>>([]);
  const mapIdRef = useRef(`fleet-replay-map-${Math.random().toString(36).substring(2, 9)}`);

  const valid = points.filter(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude));
  const safeIndex = Math.max(0, Math.min(activeIndex, valid.length - 1));
  const active = valid[safeIndex] || null;

  // 1. Ensure Leaflet CSS & JS is loaded on web
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;

    if (window.L) {
      setLeafletReady(true);
      return;
    }

    // Inject Leaflet CSS & Custom Animations
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);

      const style = document.createElement('style');
      style.id = 'leaflet-custom-anim';
      style.innerHTML = `
        @keyframes pulse-ring {
          0% { transform: scale(0.85); opacity: 0.9; }
          70% { transform: scale(1.6); opacity: 0; }
          100% { transform: scale(0.85); opacity: 0; }
        }
        @keyframes truck-glow {
          0%, 100% { filter: drop-shadow(0 0 6px rgba(37,99,235,0.7)); }
          50% { filter: drop-shadow(0 0 12px rgba(245,158,11,0.9)); }
        }
        .custom-replay-marker {
          transition: transform 0.35s ease-out;
        }
      `;
      document.head.appendChild(style);
    }

    // Inject Leaflet JS
    if (!document.getElementById('leaflet-js')) {
      const script = document.createElement('script');
      script.id = 'leaflet-js';
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload = () => {
        if (window.L && window.L.DomUtil && !(window.L.DomUtil as any)._safeGetPosPatched) {
          const origGetPos = window.L.DomUtil.getPosition;
          window.L.DomUtil.getPosition = function (el: any) {
            if (!el) return new (window.L as any).Point(0, 0);
            try {
              return origGetPos(el) || new (window.L as any).Point(0, 0);
            } catch {
              return new (window.L as any).Point(0, 0);
            }
          };
          (window.L.DomUtil as any)._safeGetPosPatched = true;
        }
        setLeafletReady(true);
      };
      document.head.appendChild(script);
    } else {
      const checkInterval = setInterval(() => {
        if (window.L) {
          clearInterval(checkInterval);
          if (window.L.DomUtil && !(window.L.DomUtil as any)._safeGetPosPatched) {
            const origGetPos = window.L.DomUtil.getPosition;
            window.L.DomUtil.getPosition = function (el: any) {
              if (!el) return new (window.L as any).Point(0, 0);
              try {
                return origGetPos(el) || new (window.L as any).Point(0, 0);
              } catch {
                return new (window.L as any).Point(0, 0);
              }
            };
            (window.L.DomUtil as any)._safeGetPosPatched = true;
          }
          setLeafletReady(true);
        }
      }, 100);
      return () => clearInterval(checkInterval);
    }
  }, []);

  // 2. Fetch full road-snapped geometry when points change
  useEffect(() => {
    let isCancelled = false;
    if (valid.length < 2) {
      setRoadCoordinates(valid.map(p => [p.latitude, p.longitude]));
      return;
    }

    fetchRoadPolyline(valid.map(p => ({ latitude: p.latitude, longitude: p.longitude })))
      .then(roadPoints => {
        if (!isCancelled && roadPoints && roadPoints.length >= 2) {
          setRoadCoordinates(roadPoints.map(p => [p.latitude, p.longitude]));
        } else if (!isCancelled) {
          setRoadCoordinates(valid.map(p => [p.latitude, p.longitude]));
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setRoadCoordinates(valid.map(p => [p.latitude, p.longitude]));
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [valid.length, points[0]?.id]);

  // 3. Initialize Leaflet Map
  useEffect(() => {
    if (Platform.OS !== 'web' || !leafletReady || !window.L) return;

    const container = document.getElementById(mapIdRef.current);
    if (!container) return;

    if (mapInstanceRef.current) {
      try {
        mapInstanceRef.current.stop?.();
        mapInstanceRef.current.off?.();
        mapInstanceRef.current.remove?.();
      } catch {}
      mapInstanceRef.current = null;
    }

    if ((container as any)._leaflet_id) {
      delete (container as any)._leaflet_id;
    }

    try {
      const L = window.L;
      const initialLat = valid.length ? valid[0].latitude : DANAO_DEFAULT_CENTER[0];
      const initialLng = valid.length ? valid[0].longitude : DANAO_DEFAULT_CENTER[1];

      const map = L.map(mapIdRef.current, {
        center: [initialLat, initialLng],
        zoom: 14,
        zoomControl: false,
      });

      // OpenStreetMap Tile Layer (100% Free, no API key required)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);

      // Add custom zoom control in bottom-right
      L.control.zoom({ position: 'bottomright' }).addTo(map);

      mapInstanceRef.current = map;

      setTimeout(() => {
        try {
          map.invalidateSize();
        } catch (e) {}
      }, 250);
    } catch (err) {
      console.warn('Leaflet map initialization error:', err);
    }

    return () => {
      if (mapInstanceRef.current) {
        try {
          mapInstanceRef.current.stop?.();
          mapInstanceRef.current.off?.();
          mapInstanceRef.current.remove?.();
        } catch (e) {}
        mapInstanceRef.current = null;
      }
      const el = document.getElementById(mapIdRef.current);
      if (el && (el as any)._leaflet_id) {
        delete (el as any)._leaflet_id;
      }
    };
  }, [leafletReady]);

  // 4. Render Full Base Route & Waypoint Markers
  useEffect(() => {
    if (!mapInstanceRef.current || !window.L) return;
    const L = window.L;
    const map = mapInstanceRef.current;

    // Clear previous base layers
    if (fullPolylineRef.current) {
      map.removeLayer(fullPolylineRef.current);
      fullPolylineRef.current = null;
    }
    if (startMarkerRef.current) {
      map.removeLayer(startMarkerRef.current);
      startMarkerRef.current = null;
    }
    if (endMarkerRef.current) {
      map.removeLayer(endMarkerRef.current);
      endMarkerRef.current = null;
    }

    if (!valid.length) {
      map.setView(DANAO_DEFAULT_CENTER, 14);
      return;
    }

    const baseCoords = roadCoordinates.length >= 2
      ? roadCoordinates
      : valid.map(p => [p.latitude, p.longitude] as [number, number]);

    // Full Route Line (Muted slate with road outline)
    const fullPolyline = L.polyline(baseCoords, {
      color: '#64748B',
      weight: 6,
      opacity: 0.45,
      lineCap: 'round',
      lineJoin: 'round',
      dashArray: '8, 8',
    }).addTo(map);
    fullPolylineRef.current = fullPolyline;

    // Start Marker (Green A)
    const startIcon = L.divIcon({
      className: 'custom-start-marker',
      html: `
        <div style="background-color: #16A34A; color: white; width: 28px; height: 28px; border-radius: 14px; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 900; border: 2.5px solid white; box-shadow: 0 3px 8px rgba(0,0,0,0.35);">
          A
        </div>
      `,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });
    startMarkerRef.current = L.marker([valid[0].latitude, valid[0].longitude], { icon: startIcon, zIndexOffset: 500 })
      .bindTooltip('<b>Route Start (Origin)</b>', { permanent: false, direction: 'top' })
      .addTo(map);

    // End Marker (Red B)
    if (valid.length > 1) {
      const last = valid[valid.length - 1];
      const endIcon = L.divIcon({
        className: 'custom-end-marker',
        html: `
          <div style="background-color: #DC2626; color: white; width: 28px; height: 28px; border-radius: 14px; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 900; border: 2.5px solid white; box-shadow: 0 3px 8px rgba(0,0,0,0.35);">
            B
          </div>
        `,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });
      endMarkerRef.current = L.marker([last.latitude, last.longitude], { icon: endIcon, zIndexOffset: 500 })
        .bindTooltip('<b>Route Destination (Return)</b>', { permanent: false, direction: 'top' })
        .addTo(map);
    }

    try {
      if (valid.length > 1) {
        map.fitBounds(fullPolyline.getBounds(), { padding: [45, 45], maxZoom: 16 });
      } else if (valid.length === 1) {
        map.setView([valid[0].latitude, valid[0].longitude], 15);
      }
    } catch (e) {}
  }, [valid.length, roadCoordinates.length, points[0]?.id, leafletReady]);

  // 5. Update Traveled Road Polyline & Waypoints as Replay Advances Step by Step
  useEffect(() => {
    if (!mapInstanceRef.current || !window.L || !valid.length) return;
    const L = window.L;
    const map = mapInstanceRef.current;

    // Clear traveled line and waypoints
    if (traveledPolylineRef.current) {
      map.removeLayer(traveledPolylineRef.current);
      traveledPolylineRef.current = null;
    }
    if (waypointsLayerRef.current) {
      map.removeLayer(waypointsLayerRef.current);
      waypointsLayerRef.current = null;
    }

    // Calculate traveled portion of road coordinates
    let traveledCoords: Array<[number, number]> = [];
    if (roadCoordinates.length >= 2 && valid.length >= 2) {
      const progressFraction = (safeIndex + 1) / valid.length;
      const traveledCount = Math.max(2, Math.min(roadCoordinates.length, Math.round(roadCoordinates.length * progressFraction)));
      traveledCoords = roadCoordinates.slice(0, traveledCount);
    } else {
      traveledCoords = valid.slice(0, safeIndex + 1).map(p => [p.latitude, p.longitude]);
    }

    if (traveledCoords.length >= 2) {
      const traveledPolyline = L.polyline(traveledCoords, {
        color: '#2563EB',
        weight: 6,
        opacity: 0.95,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(map);
      traveledPolylineRef.current = traveledPolyline;
    }

    // Waypoint dots with dynamic visual status
    const waypointsGroup = L.layerGroup().addTo(map);
    valid.forEach((p, idx) => {
      if (idx === 0 || idx === valid.length - 1) return;

      const isVisited = idx < safeIndex;
      const isCurrent = idx === safeIndex;

      const fillColor = isCurrent ? '#F59E0B' : isVisited ? '#10B981' : '#94A3B8';
      const radius = isCurrent ? 7 : isVisited ? 5 : 4;
      const weight = isCurrent ? 2.5 : 1.5;

      const circle = L.circleMarker([p.latitude, p.longitude], {
        radius,
        fillColor,
        color: '#FFFFFF',
        weight,
        fillOpacity: 0.95,
      });

      const statusLabel = isCurrent ? '🟢 ACTIVE POSITION' : isVisited ? '✅ COMPLETED' : '⏳ UPCOMING';
      circle.bindTooltip(`
        <div style="font-family: sans-serif; font-size: 11px;">
          <b>Point #${idx + 1} (${statusLabel})</b><br/>
          Speed: ${p.speedKph.toFixed(1)} km/h<br/>
          Time: ${new Date(p.timestampMs).toLocaleTimeString()}
        </div>
      `, { direction: 'top' });

      waypointsGroup.addLayer(circle);
    });
    waypointsLayerRef.current = waypointsGroup;
  }, [safeIndex, valid.length, roadCoordinates.length, leafletReady]);

  // 6. Update Animated Truck Vehicle Marker
  useEffect(() => {
    if (!mapInstanceRef.current || !window.L || !active) return;
    const L = window.L;
    const map = mapInstanceRef.current;

    // Compute heading angle for truck rotation
    let headingDeg = 0;
    if (safeIndex < valid.length - 1) {
      const next = valid[safeIndex + 1];
      const dLng = next.longitude - active.longitude;
      const dLat = next.latitude - active.latitude;
      headingDeg = (Math.atan2(dLng, dLat) * 180) / Math.PI;
    } else if (safeIndex > 0) {
      const prev = valid[safeIndex - 1];
      const dLng = active.longitude - prev.longitude;
      const dLat = active.latitude - prev.latitude;
      headingDeg = (Math.atan2(dLng, dLat) * 180) / Math.PI;
    }

    const replayIcon = L.divIcon({
      className: 'custom-replay-marker',
      html: `
        <div style="position: relative; width: 48px; height: 48px; display: flex; align-items: center; justify-content: center;">
          <div style="position: absolute; width: 46px; height: 46px; border-radius: 23px; background-color: rgba(245, 158, 11, 0.35); animation: pulse-ring 1.4s infinite;"></div>
          <div style="position: absolute; width: 34px; height: 34px; border-radius: 17px; background: linear-gradient(135deg, #F59E0B 0%, #D97706 100%); border: 2.5px solid #FFFFFF; box-shadow: 0 4px 12px rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; transform: rotate(${headingDeg.toFixed(0)}deg);">
            <span style="font-size: 18px; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.4));">🚚</span>
          </div>
          <div style="position: absolute; top: -16px; background: #0F172A; color: #FFFFFF; font-size: 9px; font-weight: 900; padding: 2px 7px; border-radius: 6px; white-space: nowrap; box-shadow: 0 2px 5px rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.2);">
            ${active.speedKph.toFixed(0)} km/h
          </div>
        </div>
      `,
      iconSize: [48, 48],
      iconAnchor: [24, 24],
    });

    if (!activeMarkerRef.current) {
      activeMarkerRef.current = L.marker([active.latitude, active.longitude], {
        icon: replayIcon,
        zIndexOffset: 2000,
      }).addTo(map);
    } else {
      activeMarkerRef.current.setLatLng([active.latitude, active.longitude]);
      activeMarkerRef.current.setIcon(replayIcon);
    }

    // Smoothly pan to follow the truck if moving
    if (autoPan && mapInstanceRef.current && (safeIndex > 0 || safeIndex === valid.length - 1)) {
      map.panTo([active.latitude, active.longitude], { animate: true, duration: 0.35 });
    }
  }, [safeIndex, active, leafletReady, autoPan]);

  const handleRecenter = () => {
    if (!mapInstanceRef.current || !fullPolylineRef.current) return;
    try {
      mapInstanceRef.current.fitBounds(fullPolylineRef.current.getBounds(), { padding: [45, 45], maxZoom: 16 });
    } catch (e) {}
  };

  return (
    <View style={styles.frame}>
      {Platform.OS === 'web' ? (
        <div
          id={mapIdRef.current}
          style={{ width: '100%', height: '380px', borderRadius: '16px', zIndex: 1 }}
        />
      ) : (
        <View style={styles.nativeFallback}>
          <MaterialIcons name="map" size={36} color="#2563EB" />
          <Text style={styles.nativeFallbackText}>Live Map Replay</Text>
        </View>
      )}

      {/* Floating Re-center button */}
      {valid.length > 0 && (
        <TouchableOpacity style={styles.recenterBtn} onPress={handleRecenter} activeOpacity={0.8}>
          <MaterialIcons name="my-location" size={16} color="#1E293B" />
          <Text style={styles.recenterText}>Fit Route</Text>
        </TouchableOpacity>
      )}

      {/* Floating Speed & Step Indicator Chip */}
      {!!active && (
        <View style={styles.overlayChip}>
          <View style={styles.activeDot} />
          <Text style={styles.overlayText}>
            Step {safeIndex + 1}/{valid.length} · {active.speedKph.toFixed(1)} km/h · {new Date(active.timestampMs).toLocaleTimeString()}
          </Text>
        </View>
      )}

      {!valid.length && (
        <View style={styles.emptyState}>
          <MaterialIcons name="satellite-alt" size={32} color="#94A3B8" />
          <Text style={styles.emptyStateText}>No recorded trip points yet for this selection.</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    position: 'relative',
    height: 380,
    overflow: 'hidden',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#F1F5F9',
  },
  overlayChip: {
    position: 'absolute',
    right: 14,
    top: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(15, 23, 42, 0.90)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    zIndex: 1000,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  activeDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#10B981',
  },
  overlayText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  recenterBtn: {
    position: 'absolute',
    left: 14,
    top: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    zIndex: 1000,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
  },
  recenterText: {
    color: '#1E293B',
    fontSize: 11,
    fontWeight: '800',
  },
  emptyState: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(248, 250, 252, 0.85)',
    zIndex: 500,
  },
  emptyStateText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748B',
  },
  nativeFallback: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  nativeFallbackText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#334155',
  },
});

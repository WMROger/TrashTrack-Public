import React, { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { RouteStop } from '@/services/trafficAwareOptimizerService';
import { fetchRoadPolyline } from '@/services/osrmRoutingService';

type Props = {
  baselineStops: RouteStop[];
  optimizedStops: RouteStop[];
  activeStopIndex?: number;
  currentSimPosition?: { latitude: number; longitude: number } | null;
  activeDriverName?: string;
  barangayName: string;
};

declare const window: any;
declare const document: any;

const DANAO_DEFAULT_CENTER: [number, number] = [10.5218, 124.0285];

export default function RouteOptimizationMap({
  baselineStops,
  optimizedStops,
  activeStopIndex = 0,
  currentSimPosition,
  activeDriverName,
  barangayName,
}: Props) {
  const mapContainerRef = useRef<any>(null);
  const mapInstanceRef = useRef<any>(null);
  const baselinePolylineRef = useRef<any>(null);
  const optimizedPolylineRef = useRef<any>(null);
  const markersLayerRef = useRef<any>(null);
  const simMarkerRef = useRef<any>(null);
  const [leafletReady, setLeafletReady] = useState(false);
  const [showBaselineLayer, setShowBaselineLayer] = useState(true);
  const [showOptimizedLayer, setShowOptimizedLayer] = useState(true);
  const mapIdRef = useRef(`route-opt-map-${Math.random().toString(36).substring(2, 9)}`);

  // 1. Ensure Leaflet CSS & JS is loaded on web
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;

    const patchDomUtil = () => {
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
    };

    if (window.L) {
      patchDomUtil();
      setLeafletReady(true);
      return;
    }

    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }

    if (!document.getElementById('leaflet-js')) {
      const script = document.createElement('script');
      script.id = 'leaflet-js';
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload = () => {
        patchDomUtil();
        setLeafletReady(true);
      };
      document.head.appendChild(script);
    } else {
      const check = setInterval(() => {
        if (window.L) {
          clearInterval(check);
          patchDomUtil();
          setLeafletReady(true);
        }
      }, 100);
      return () => clearInterval(check);
    }
  }, []);

  // 2. Initialize Leaflet Map Instance
  useEffect(() => {
    if (!leafletReady || !mapContainerRef.current || Platform.OS !== 'web') return;

    const L = window.L;
    if (!L) return;

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
      const map = L.map(mapIdRef.current, {
        center: DANAO_DEFAULT_CENTER,
        zoom: 15,
        zoomControl: false,
        attributionControl: false,
      });

      L.control.zoom({ position: 'topright' }).addTo(map);

      // High quality OpenStreetMap tiles
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
      }).addTo(map);

      mapInstanceRef.current = map;
      markersLayerRef.current = L.layerGroup().addTo(map);
    } catch (initErr) {
      console.warn('Route map initialization note:', initErr);
    }

    return () => {
      try {
        if (mapInstanceRef.current) {
          mapInstanceRef.current.stop?.();
          mapInstanceRef.current.off?.();
          mapInstanceRef.current.remove?.();
        }
      } catch {}
      mapInstanceRef.current = null;
      const el = document.getElementById(mapIdRef.current);
      if (el && (el as any)._leaflet_id) {
        delete (el as any)._leaflet_id;
      }
    };
  }, [leafletReady]);

  // 3. Draw Polylines & Markers
  useEffect(() => {
    if (!mapInstanceRef.current || Platform.OS !== 'web') return;
    const L = window.L;
    if (!L) return;

    const map = mapInstanceRef.current;

    // Clear previous polylines
    if (baselinePolylineRef.current) {
      map.removeLayer(baselinePolylineRef.current);
      baselinePolylineRef.current = null;
    }
    if (optimizedPolylineRef.current) {
      map.removeLayer(optimizedPolylineRef.current);
      optimizedPolylineRef.current = null;
    }
    if (markersLayerRef.current) {
      markersLayerRef.current.clearLayers();
    }

    let isMounted = true;
    const allLatLngs: [number, number][] = [];

    // Draw Baseline Route (Blue dashed polyline)
    if (showBaselineLayer && baselineStops.length > 1) {
      const baselineLatLngs = baselineStops.map((s) => [s.latitude, s.longitude] as [number, number]);
      const poly = L.polyline(baselineLatLngs, {
        color: '#3B82F6',
        weight: 4,
        opacity: 0.7,
        dashArray: '6, 8',
      }).addTo(map);
      baselinePolylineRef.current = poly;
      allLatLngs.push(...baselineLatLngs);

      fetchRoadPolyline(baselineStops.map((s) => ({ latitude: s.latitude, longitude: s.longitude })))
        .then((roadCoords) => {
          if (isMounted && baselinePolylineRef.current === poly && roadCoords && roadCoords.length > 2) {
            baselinePolylineRef.current.setLatLngs(roadCoords.map((c) => [c.latitude, c.longitude]));
          }
        })
        .catch((err) => console.warn('RouteOptimizationMap: baseline road snap error:', err));
    }

    // Draw Optimized Route (Emerald green solid polyline)
    if (showOptimizedLayer && optimizedStops.length > 1) {
      const optLatLngs = optimizedStops.map((s) => [s.latitude, s.longitude] as [number, number]);
      const poly = L.polyline(optLatLngs, {
        color: '#059669',
        weight: 5,
        opacity: 0.9,
      }).addTo(map);
      optimizedPolylineRef.current = poly;
      allLatLngs.push(...optLatLngs);

      fetchRoadPolyline(optimizedStops.map((s) => ({ latitude: s.latitude, longitude: s.longitude })))
        .then((roadCoords) => {
          if (isMounted && optimizedPolylineRef.current === poly && roadCoords && roadCoords.length > 2) {
            optimizedPolylineRef.current.setLatLngs(roadCoords.map((c) => [c.latitude, c.longitude]));
          }
        })
        .catch((err) => console.warn('RouteOptimizationMap: optimized road snap error:', err));
    }

    // Draw Waypoint Stop Markers
    const targetStops = showOptimizedLayer && optimizedStops.length > 0 ? optimizedStops : baselineStops;

    targetStops.forEach((stop, idx) => {
      const isStart = idx === 0;
      const isEnd = idx === targetStops.length - 1;
      const isReport = stop.stopType === 'verified_report';
      const isCongested = stop.trafficCongestionLevel === 'high';

      const bgCol = isStart ? '#059669' : isEnd ? '#DC2626' : isReport ? '#D97706' : isCongested ? '#E11D48' : '#1E293B';
      const labelText = isStart ? 'START' : isEnd ? 'FINISH' : isReport ? `REP #${idx}` : `${idx}`;

      const iconHtml = `
        <div style="
          background-color: ${bgCol};
          color: #FFFFFF;
          font-weight: 800;
          font-size: ${isStart || isEnd || isReport ? '10px' : '11px'};
          padding: ${isStart || isEnd || isReport ? '2px 6px' : '4px 7px'};
          border-radius: 12px;
          border: 2px solid #FFFFFF;
          box-shadow: 0 2px 6px rgba(0,0,0,0.3);
          white-space: nowrap;
          display: flex;
          align-items: center;
          justify-content: center;
          transform: translate(-50%, -50%);
        ">
          ${labelText}
        </div>
      `;

      const customIcon = L.divIcon({
        html: iconHtml,
        className: 'custom-route-stop-icon',
        iconSize: [0, 0],
      });

      const marker = L.marker([stop.latitude, stop.longitude], { icon: customIcon });

      marker.bindPopup(`
        <div style="font-family: sans-serif; min-width: 180px;">
          <div style="font-size: 11px; font-weight: 800; color: #64748B; text-transform: uppercase;">
            Stop #${idx + 1} &bull; ${stop.stopType.replace('_', ' ')}
          </div>
          <div style="font-size: 13px; font-weight: 800; color: #0F172A; margin: 3px 0;">
            ${stop.name}
          </div>
          <div style="font-size: 11px; color: #475569;">
            Brgy. ${stop.barangay || barangayName}
          </div>
          ${
            stop.peakAvoidanceReason
              ? `<div style="font-size: 11px; background: #FFF1F2; border-left: 3px solid #F43F5E; padding: 4px 6px; margin-top: 5px; color: #9F1239;">
                  <strong>Traffic Alert:</strong> ${stop.peakAvoidanceReason}
                </div>`
              : ''
          }
          ${
            isReport
              ? `<div style="font-size: 11px; background: #FEF3C7; border-left: 3px solid #F59E0B; padding: 4px 6px; margin-top: 5px; color: #92400E;">
                  <strong>Citizen Report:</strong> ${stop.estimatedWeight || '25kg'} (${stop.wasteType || 'Solid'})
                </div>`
              : ''
          }
        </div>
      `);

      markersLayerRef.current.addLayer(marker);
    });

    // Draw Live Simulation Position
    if (currentSimPosition && Number.isFinite(currentSimPosition.latitude) && Number.isFinite(currentSimPosition.longitude)) {
      const truckHtml = `
        <div style="
          background-color: #10B981;
          color: #FFFFFF;
          width: 32px;
          height: 32px;
          border-radius: 16px;
          border: 3px solid #FFFFFF;
          box-shadow: 0 0 12px rgba(16,185,129,0.8);
          display: flex;
          align-items: center;
          justify-content: center;
          transform: translate(-50%, -50%);
          animation: pulse 1.5s infinite;
        ">
          🚚
        </div>
      `;
      const truckIcon = L.divIcon({
        html: truckHtml,
        className: 'sim-truck-icon',
        iconSize: [0, 0],
      });

      if (simMarkerRef.current) {
        map.removeLayer(simMarkerRef.current);
      }

      simMarkerRef.current = L.marker([currentSimPosition.latitude, currentSimPosition.longitude], {
        icon: truckIcon,
        zIndexOffset: 1000,
      }).addTo(map);

      simMarkerRef.current.bindPopup(`
        <div style="font-family: sans-serif;">
          <strong>Live Simulating Truck</strong><br/>
          Driver: ${activeDriverName || 'Active Driver'}<br/>
          Brgy: ${barangayName}
        </div>
      `);

      allLatLngs.push([currentSimPosition.latitude, currentSimPosition.longitude]);
    }

    // Fit map bounds
    if (allLatLngs.length > 0) {
      try {
        const bounds = L.latLngBounds(allLatLngs);
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
      } catch {}
    }

    return () => {
      isMounted = false;
    };
  }, [baselineStops, optimizedStops, showBaselineLayer, showOptimizedLayer, currentSimPosition, activeDriverName, barangayName]);

  return (
    <View style={styles.container}>
      {/* Top Map Layer Control Bar */}
      <View style={styles.topControlBar}>
        <View style={styles.legendRow}>
          <TouchableOpacity
            style={[styles.legendPill, showBaselineLayer && styles.legendPillActiveBaseline]}
            onPress={() => setShowBaselineLayer(!showBaselineLayer)}
            activeOpacity={0.8}
          >
            <View style={[styles.pillDot, { backgroundColor: '#3B82F6' }]} />
            <Text style={[styles.pillText, showBaselineLayer && { color: '#1E40AF', fontWeight: '700' }]}>
              Baseline Route ({baselineStops.length} pts)
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.legendPill, showOptimizedLayer && styles.legendPillActiveOptimized]}
            onPress={() => setShowOptimizedLayer(!showOptimizedLayer)}
            activeOpacity={0.8}
          >
            <View style={[styles.pillDot, { backgroundColor: '#059669' }]} />
            <Text style={[styles.pillText, showOptimizedLayer && { color: '#065F46', fontWeight: '800' }]}>
              AI Traffic Optimized ({optimizedStops.length} stops)
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.barangayBadge}>
          <MaterialIcons name="navigation" size={13} color="#1B4D3E" style={{ marginRight: 4 }} />
          <Text style={styles.barangayBadgeText}>Brgy. {barangayName}</Text>
        </View>
      </View>

      {/* Map Element / Leaflet Container */}
      {Platform.OS === 'web' ? (
        <div
          id={mapIdRef.current}
          ref={mapContainerRef}
          style={{
            width: '100%',
            height: '100%',
            minHeight: '380px',
            backgroundColor: '#F1F5F9',
            borderRadius: '12px',
            overflow: 'hidden',
          }}
        />
      ) : (
        <View style={styles.fallbackNativeBox}>
          <MaterialIcons name="map" size={40} color="#059669" />
          <Text style={styles.fallbackNativeText}>
            Interactive GPS Road Polyline available on Web & Tablet portal
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    height: 400,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
    position: 'relative',
  },
  topControlBar: {
    position: 'absolute',
    top: 10,
    left: 10,
    right: 10,
    zIndex: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    backdropFilter: 'blur(8px)' as any,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  legendPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 5,
  },
  legendPillActiveBaseline: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
  },
  legendPillActiveOptimized: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  pillDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  pillText: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  barangayBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  barangayBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#166534',
  },
  fallbackNativeBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
    padding: 20,
    gap: 10,
  },
  fallbackNativeText: {
    fontSize: 13,
    color: '#475569',
    fontWeight: '600',
    textAlign: 'center',
  },
});

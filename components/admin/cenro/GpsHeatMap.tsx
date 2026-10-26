import { MaterialIcons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Circle, Defs, G, Line, LinearGradient, Rect, Stop, Text as SvgText } from 'react-native-svg';

type HeatPoint = {
  id: string;
  latitude: number;
  longitude: number;
  reportCount: number;
  intensity: number;
};

type Props = {
  points: HeatPoint[];
  geocodedCount: number;
  missingLocationCount: number;
};

declare const window: any;
declare const document: any;

const DANAO_DEFAULT_CENTER: [number, number] = [10.5218, 124.0285];
const MAP_HEIGHT = 380;
const SVG_WIDTH = 760;
const SVG_HEIGHT = 320;
const PADDING_X = 64;
const PADDING_Y = 52;
const DEFAULT_BOUNDS = { north: 10.60, south: 10.44, east: 124.10, west: 123.96 };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export default function GpsHeatMap({ points, geocodedCount, missingLocationCount }: Props) {
  const mapInstanceRef = useRef<any>(null);
  const layerGroupRef = useRef<any>(null);
  const [leafletReady, setLeafletReady] = useState(false);
  const mapIdRef = useRef(`gps-heat-map-${Math.random().toString(36).substring(2, 9)}`);

  // 1. Ensure Leaflet CSS & JS is loaded on Web
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
    if (Platform.OS !== 'web' || !leafletReady || !window.L) return;

    const container = document.getElementById(mapIdRef.current);
    if (!container) return;

    if (mapInstanceRef.current) {
      try {
        mapInstanceRef.current.remove?.();
      } catch {}
      mapInstanceRef.current = null;
    }

    if ((container as any)._leaflet_id) {
      delete (container as any)._leaflet_id;
    }

    try {
      const L = window.L;
      const initialCenter = points.length && Number.isFinite(points[0].latitude)
        ? [points[0].latitude, points[0].longitude]
        : DANAO_DEFAULT_CENTER;

      const map = L.map(mapIdRef.current, {
        center: initialCenter,
        zoom: 14,
        zoomControl: false,
        attributionControl: false,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
      }).addTo(map);

      L.control.zoom({ position: 'topright' }).addTo(map);

      layerGroupRef.current = L.layerGroup().addTo(map);
      mapInstanceRef.current = map;
    } catch (err) {
      console.warn('GPS Heat Map initialization error:', err);
    }

    return () => {
      if (mapInstanceRef.current) {
        try {
          mapInstanceRef.current.remove?.();
        } catch (e) {}
        mapInstanceRef.current = null;
      }
    };
  }, [leafletReady]);

  // 3. Render Hotspot Halos, Pins, and Auto-Fit
  useEffect(() => {
    if (Platform.OS !== 'web' || !mapInstanceRef.current || !layerGroupRef.current || !window.L) return;
    const L = window.L;
    const map = mapInstanceRef.current;
    const layer = layerGroupRef.current;

    layer.clearLayers();

    const validCoords: [number, number][] = [];

    points.forEach((point, index) => {
      if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) return;
      validCoords.push([point.latitude, point.longitude]);

      const strength = clamp(point.intensity / 100, 0.18, 1);
      const color = point.intensity >= 75 ? '#DC2626' : point.intensity >= 40 ? '#F59E0B' : '#10B981';

      // Outer heat glow
      L.circle([point.latitude, point.longitude], {
        radius: 180 + strength * 220,
        color: color,
        fillColor: color,
        fillOpacity: 0.14,
        weight: 1,
        stroke: true,
      }).addTo(layer);

      // Mid heat glow
      L.circle([point.latitude, point.longitude], {
        radius: 80 + strength * 110,
        color: color,
        fillColor: color,
        fillOpacity: 0.28,
        stroke: false,
      }).addTo(layer);

      // Custom HTML Marker Badge
      const labelText = `${point.reportCount} report${point.reportCount === 1 ? '' : 's'}`;
      const iconHtml = `
        <div style="display:flex; flex-direction:column; align-items:center; transform: translate(-50%, -50%); cursor:pointer;">
          <div style="background-color:${color}; width:28px; height:28px; border-radius:50%; border:3px solid #FFFFFF; box-shadow:0 3px 8px rgba(0,0,0,0.35); display:flex; align-items:center; justify-content:center; color:#FFFFFF; font-weight:900; font-size:11px; font-family:sans-serif;">
            H${index + 1}
          </div>
          <div style="margin-top:4px; background:rgba(255,255,255,0.96); border:1px solid #CBD5E1; border-radius:10px; padding:2px 8px; font-size:10px; font-weight:800; color:#1E293B; box-shadow:0 2px 6px rgba(0,0,0,0.18); white-space:nowrap; font-family:sans-serif;">
            ${labelText}
          </div>
        </div>
      `;

      const customIcon = L.divIcon({
        html: iconHtml,
        className: '',
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });

      const marker = L.marker([point.latitude, point.longitude], { icon: customIcon });
      marker.bindPopup(`
        <div style="padding:4px; font-family:sans-serif; min-width:150px;">
          <div style="font-size:13px; font-weight:800; color:#0F172A; margin-bottom:2px;">Hotspot H${index + 1}</div>
          <div style="font-size:11px; color:#64748B; margin-bottom:6px;">${point.latitude.toFixed(4)}° N, ${point.longitude.toFixed(4)}° E</div>
          <div style="display:inline-block; padding:3px 8px; border-radius:6px; font-size:11px; font-weight:700; background-color:${color}18; color:${color};">
            ${point.reportCount} Unresolved Report${point.reportCount === 1 ? '' : 's'} (${point.intensity}% Intensity)
          </div>
        </div>
      `);
      marker.addTo(layer);
    });

    if (validCoords.length > 0) {
      try {
        const bounds = L.latLngBounds(validCoords);
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [65, 65], maxZoom: 15 });
        }
      } catch (e) {
        console.warn('Map fit bounds note:', e);
      }
    } else {
      map.setView(DANAO_DEFAULT_CENTER, 13);
    }
  }, [points, leafletReady]);

  const handleFocusHotspots = useCallback(() => {
    if (!mapInstanceRef.current || !window.L || points.length === 0) return;
    const L = window.L;
    const coords = points
      .filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude))
      .map((p) => [p.latitude, p.longitude] as [number, number]);
    if (coords.length > 0) {
      mapInstanceRef.current.flyToBounds(L.latLngBounds(coords), { padding: [60, 60], maxZoom: 15 });
    }
  }, [points]);

  const handleCenterDanao = useCallback(() => {
    if (!mapInstanceRef.current) return;
    mapInstanceRef.current.flyTo(DANAO_DEFAULT_CENTER, 13, { duration: 1 });
  }, []);

  // Native fallback SVG bounds
  const nativeBounds = useMemo(() => {
    if (!points || points.length === 0) return DEFAULT_BOUNDS;
    const lats = points.map((p) => p.latitude).filter(Number.isFinite);
    const lngs = points.map((p) => p.longitude).filter(Number.isFinite);
    if (lats.length === 0 || lngs.length === 0) return DEFAULT_BOUNDS;

    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);

    const deltaLat = Math.max(maxLat - minLat, 0.04);
    const deltaLng = Math.max(maxLng - minLng, 0.05);

    const padLat = deltaLat * 0.35;
    const padLng = deltaLng * 0.35;

    return {
      north: maxLat + padLat,
      south: minLat - padLat,
      east: maxLng + padLng,
      west: minLng - padLng,
    };
  }, [points]);

  const projectNative = (latitude: number, longitude: number) => {
    const spanLng = Math.max(nativeBounds.east - nativeBounds.west, 0.0001);
    const spanLat = Math.max(nativeBounds.north - nativeBounds.south, 0.0001);
    const normX = (longitude - nativeBounds.west) / spanLng;
    const normY = (nativeBounds.north - latitude) / spanLat;
    const innerWidth = SVG_WIDTH - PADDING_X * 2;
    const innerHeight = SVG_HEIGHT - PADDING_Y * 2;

    return {
      x: clamp(PADDING_X + normX * innerWidth, PADDING_X, SVG_WIDTH - PADDING_X),
      y: clamp(PADDING_Y + normY * innerHeight, PADDING_Y, SVG_HEIGHT - PADDING_Y),
    };
  };

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>Danao GPS Report Heat Map</Text>
          <Text style={styles.subtitle}>Higher color intensity means more unresolved reports in the same geographic cell.</Text>
        </View>
        <View style={styles.coverageBadge}>
          <Text style={styles.coverageValue}>{geocodedCount}</Text>
          <Text style={styles.coverageLabel}>mapped</Text>
        </View>
      </View>

      <View style={styles.mapFrame}>
        {Platform.OS === 'web' ? (
          <View style={{ position: 'relative', width: '100%', height: MAP_HEIGHT }}>
            <div
              id={mapIdRef.current}
              style={{
                width: '100%',
                height: `${MAP_HEIGHT}px`,
                backgroundColor: '#E2E8F0',
                borderRadius: '16px',
                overflow: 'hidden',
              }}
            />

            {/* Quick Action Floating Controls */}
            <View style={styles.floatingToolbar}>
              {points.length > 0 && (
                <TouchableOpacity
                  style={[styles.floatingBtn, styles.floatingBtnActive]}
                  onPress={handleFocusHotspots}
                  activeOpacity={0.8}
                >
                  <MaterialIcons name="my-location" size={13} color="#0D9488" />
                  <Text style={styles.floatingBtnActiveText}>
                    Focus {points.length} Hotspot{points.length === 1 ? '' : 's'}
                  </Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.floatingBtn}
                onPress={handleCenterDanao}
                activeOpacity={0.8}
              >
                <MaterialIcons name="place" size={13} color="#475569" />
                <Text style={styles.floatingBtnText}>Danao Center</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <Svg width="100%" height={SVG_HEIGHT} viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}>
            <Defs>
              <LinearGradient id="mapBackground" x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor="#ECFDF5" />
                <Stop offset="1" stopColor="#DBEAFE" />
              </LinearGradient>
            </Defs>
            <Rect width={SVG_WIDTH} height={SVG_HEIGHT} rx={18} fill="url(#mapBackground)" />

            {[1, 2, 3, 4].map((index) => (
              <G key={`grid-${index}`}>
                <Line
                  x1={(SVG_WIDTH / 5) * index}
                  y1={0}
                  x2={(SVG_WIDTH / 5) * index}
                  y2={SVG_HEIGHT}
                  stroke="#94A3B8"
                  strokeOpacity={0.18}
                  strokeDasharray="5 7"
                />
                <Line
                  x1={0}
                  y1={(SVG_HEIGHT / 5) * index}
                  x2={SVG_WIDTH}
                  y2={(SVG_HEIGHT / 5) * index}
                  stroke="#94A3B8"
                  strokeOpacity={0.18}
                  strokeDasharray="5 7"
                />
              </G>
            ))}

            <SvgText x={18} y={24} fontSize={11} fontWeight="800" fill="#475569" letterSpacing={0.5}>
              DANAO & VICINITY HOTSPOTS
            </SvgText>
            <SvgText x={SVG_WIDTH - 18} y={24} textAnchor="end" fontSize={10} fontWeight="600" fill="#64748B">
              {nativeBounds.north.toFixed(3)}° N
            </SvgText>
            <SvgText x={18} y={SVG_HEIGHT - 16} fontSize={10} fontWeight="600" fill="#64748B">
              {nativeBounds.west.toFixed(3)}° E, {nativeBounds.south.toFixed(3)}° N
            </SvgText>
            <SvgText x={SVG_WIDTH - 18} y={SVG_HEIGHT - 16} textAnchor="end" fontSize={10} fontWeight="600" fill="#64748B">
              {nativeBounds.east.toFixed(3)}° E
            </SvgText>

            {points.map((point, index) => {
              const { x, y } = projectNative(point.latitude, point.longitude);
              const strength = clamp(point.intensity / 100, 0.18, 1);
              const color = point.intensity >= 75 ? '#DC2626' : point.intensity >= 40 ? '#F59E0B' : '#22C55E';
              const radius = 22 + strength * 28;
              const labelText = `${point.reportCount} report${point.reportCount === 1 ? '' : 's'}`;
              const pillWidth = Math.max(64, labelText.length * 6.5 + 18);
              const isNearBottom = y > SVG_HEIGHT - 55;
              const pillY = isNearBottom ? y - 34 : y + 20;

              return (
                <G key={point.id}>
                  <Circle cx={x} cy={y} r={radius} fill={color} opacity={0.10 + strength * 0.08} />
                  <Circle cx={x} cy={y} r={radius * 0.62} fill={color} opacity={0.18 + strength * 0.12} />
                  <Circle cx={x} cy={y} r={13} fill={color} opacity={0.96} stroke="#FFFFFF" strokeWidth={2.5} />
                  <SvgText x={x} y={y + 4} textAnchor="middle" fontSize={10} fontWeight="900" fill="#FFFFFF">
                    H{index + 1}
                  </SvgText>

                  <Rect
                    x={x - pillWidth / 2}
                    y={pillY}
                    width={pillWidth}
                    height={18}
                    rx={9}
                    fill="rgba(255, 255, 255, 0.94)"
                    stroke="rgba(203, 213, 225, 0.9)"
                    strokeWidth={1}
                  />
                  <SvgText
                    x={x}
                    y={pillY + 12.5}
                    textAnchor="middle"
                    fontSize={10}
                    fontWeight="800"
                    fill="#1E293B"
                  >
                    {labelText}
                  </SvgText>
                </G>
              );
            })}

            {points.length === 0 && (
              <SvgText x={SVG_WIDTH / 2} y={SVG_HEIGHT / 2} textAnchor="middle" fontSize={14} fontWeight="700" fill="#64748B">
                No unresolved geotagged reports to map
              </SvgText>
            )}
          </Svg>
        )}
      </View>

      <View style={styles.footerRow}>
        <View style={styles.legendRow}>
          <View style={[styles.legendDot, { backgroundColor: '#10B981' }]} />
          <Text style={styles.legendText}>Low</Text>
          <View style={[styles.legendDot, { backgroundColor: '#F59E0B' }]} />
          <Text style={styles.legendText}>Medium</Text>
          <View style={[styles.legendDot, { backgroundColor: '#DC2626' }]} />
          <Text style={styles.legendText}>High</Text>
        </View>
        <Text style={styles.missingText}>{missingLocationCount} report{missingLocationCount === 1 ? '' : 's'} missing GPS</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 16, borderWidth: 1, borderColor: '#D1FAE5', borderRadius: 16, backgroundColor: '#FFFFFF', padding: 16 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 14 },
  title: { fontSize: 15, fontWeight: '800', color: '#111827' },
  subtitle: { color: '#64748B', fontSize: 11, lineHeight: 16, marginTop: 3 },
  coverageBadge: { minWidth: 68, alignItems: 'center', borderRadius: 12, backgroundColor: '#ECFDF5', paddingHorizontal: 12, paddingVertical: 8 },
  coverageValue: { color: '#047857', fontSize: 18, fontWeight: '900' },
  coverageLabel: { color: '#047857', fontSize: 9, fontWeight: '800', textTransform: 'uppercase' },
  mapFrame: { overflow: 'hidden', borderRadius: 18, borderWidth: 1, borderColor: '#D1D5DB' },
  floatingToolbar: {
    position: 'absolute',
    top: 12,
    left: 12,
    flexDirection: 'row',
    gap: 8,
    zIndex: 1000,
  },
  floatingBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  floatingBtnActive: {
    borderColor: '#0D9488',
    backgroundColor: '#F0FDFA',
  },
  floatingBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#334155',
  },
  floatingBtnActiveText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0F766E',
  },
  footerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginTop: 12 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5, marginLeft: 6 },
  legendText: { color: '#64748B', fontSize: 10, fontWeight: '700' },
  missingText: { color: '#92400E', fontSize: 10, fontWeight: '700' },
});

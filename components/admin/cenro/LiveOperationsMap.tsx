import React, { useEffect, useRef, useState, useCallback } from 'react';
import { StyleSheet, Text, View, Platform, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import Svg, { Circle, G, Line, Rect, Text as SvgText } from 'react-native-svg';

export type LiveMapTruck = {
  id: string;
  latitude: number;
  longitude: number;
  label: string;
  active: boolean;
};

export type LiveMapReport = {
  id: string;
  latitude: number;
  longitude: number;
  label: string;
  barangay?: string;
  status?: string;
  street?: string;
  description?: string;
  imageURL?: string | null;
  createdAt?: any;
};

type Props = {
  trucks: LiveMapTruck[];
  reports: LiveMapReport[];
  height?: number;
  focusedTarget?: { latitude: number; longitude: number; id?: string; label?: string } | null;
  onSelectReport?: (report: LiveMapReport) => void;
};

type DispersedReport = LiveMapReport & {
  displayLat: number;
  displayLng: number;
  originalLat: number;
  originalLng: number;
  clusterIndex: number;
  clusterTotal: number;
};

declare const window: any;
declare const document: any;

const DANAO_DEFAULT_CENTER: [number, number] = [10.5218, 124.0285];
const WIDTH = 760;
const HEIGHT = 420;
const BOUNDS = { north: 10.60, south: 10.44, east: 124.10, west: 123.96 };
const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));
const project = (latitude: number, longitude: number) => ({
  x: clamp(((longitude - BOUNDS.west) / (BOUNDS.east - BOUNDS.west)) * WIDTH, 24, WIDTH - 24),
  y: clamp(((BOUNDS.north - latitude) / (BOUNDS.north - BOUNDS.south)) * HEIGHT, 24, HEIGHT - 24),
});

/**
 * Disperses co-located or overlapping markers in a neat radial pattern so every report is visible and clickable.
 */
function calculateDispersedReports(reportsList: LiveMapReport[]): DispersedReport[] {
  const validReports = reportsList.filter(
    (r) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude)
  );

  const clusters: LiveMapReport[][] = [];
  const THRESHOLD = 0.00018; // ~20 meters threshold

  validReports.forEach((rep) => {
    let placed = false;
    for (const cluster of clusters) {
      const leader = cluster[0];
      const dLat = Math.abs(leader.latitude - rep.latitude);
      const dLng = Math.abs(leader.longitude - rep.longitude);
      if (dLat < THRESHOLD && dLng < THRESHOLD) {
        cluster.push(rep);
        placed = true;
        break;
      }
    }
    if (!placed) {
      clusters.push([rep]);
    }
  });

  const results: DispersedReport[] = [];

  clusters.forEach((cluster) => {
    const total = cluster.length;
    if (total === 1) {
      results.push({
        ...cluster[0],
        displayLat: cluster[0].latitude,
        displayLng: cluster[0].longitude,
        originalLat: cluster[0].latitude,
        originalLng: cluster[0].longitude,
        clusterIndex: 0,
        clusterTotal: 1,
      });
    } else {
      // Disperse around original center in a circle
      const baseLat = cluster[0].latitude;
      const baseLng = cluster[0].longitude;
      const radiusDeg = 0.00028; // ~30 meters dispersion radius (clearly separates markers at zoom 15+)

      cluster.forEach((rep, idx) => {
        const angle = (2 * Math.PI * idx) / total - Math.PI / 2;
        const displayLat = baseLat + Math.sin(angle) * radiusDeg;
        const displayLng = baseLng + (Math.cos(angle) * radiusDeg) / Math.cos((baseLat * Math.PI) / 180);

        results.push({
          ...rep,
          displayLat,
          displayLng,
          originalLat: baseLat,
          originalLng: baseLng,
          clusterIndex: idx,
          clusterTotal: total,
        });
      });
    }
  });

  return results;
}

export default function LiveOperationsMap({
  trucks,
  reports,
  height = 400,
  focusedTarget,
  onSelectReport,
}: Props) {
  const mapInstanceRef = useRef<any>(null);
  const markersRef = useRef<Map<string, any>>(new Map());
  const clusterLayersRef = useRef<any[]>([]);
  const [leafletReady, setLeafletReady] = useState(false);
  const mapIdRef = useRef(`live-ops-map-${Math.random().toString(36).substring(2, 9)}`);
  const hasAutoFittedRef = useRef(false);

  // Expose global click handler for Leaflet popup buttons
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.__selectOperationalReport = (id: string) => {
        const rep = reports.find((r) => r.id === id);
        if (rep && onSelectReport) {
          onSelectReport(rep);
        }
      };
    }
    return () => {
      if (typeof window !== 'undefined') {
        delete window.__selectOperationalReport;
      }
    };
  }, [reports, onSelectReport]);

  // 1. Ensure Leaflet CSS & JS is loaded on Web
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;

    if (window.L) {
      setLeafletReady(true);
      return;
    }

    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);

      const style = document.createElement('style');
      style.id = 'leaflet-live-anim';
      style.innerHTML = `
        @keyframes live-radar-pulse {
          0% { transform: scale(0.9); opacity: 0.9; }
          70% { transform: scale(2.2); opacity: 0; }
          100% { transform: scale(0.9); opacity: 0; }
        }
        @keyframes danger-pulse {
          0% { transform: scale(0.9); opacity: 0.9; }
          60% { transform: scale(1.9); opacity: 0; }
          100% { transform: scale(0.9); opacity: 0; }
        }
        .leaflet-popup-action-btn {
          background: #1B4D3E;
          color: #FFFFFF;
          border: none;
          border-radius: 6px;
          padding: 6px 10px;
          font-size: 11px;
          font-weight: 700;
          cursor: pointer;
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.15);
          transition: background 0.15s ease;
        }
        .leaflet-popup-action-btn:hover {
          background: #15803D;
        }
      `;
      document.head.appendChild(style);
    }

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
          setLeafletReady(true);
        }
      }, 100);
      return () => clearInterval(checkInterval);
    }
  }, []);

  // 2. Initialize Leaflet Map
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
      let initialLat = DANAO_DEFAULT_CENTER[0];
      let initialLng = DANAO_DEFAULT_CENTER[1];
      let initialZoom = 14;

      if (reports.length && Number.isFinite(reports[0].latitude)) {
        initialLat = reports[0].latitude;
        initialLng = reports[0].longitude;
        initialZoom = 14;
      } else if (trucks.length && Number.isFinite(trucks[0].latitude)) {
        initialLat = trucks[0].latitude;
        initialLng = trucks[0].longitude;
        initialZoom = 14;
      }

      const map = L.map(mapIdRef.current, {
        center: [initialLat, initialLng],
        zoom: initialZoom,
        zoomControl: false,
        attributionControl: false,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
      }).addTo(map);

      L.control.zoom({ position: 'topright' }).addTo(map);

      mapInstanceRef.current = map;
    } catch (err) {
      console.warn('Live operations map initialization error:', err);
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

  // 3. Update Markers, Co-location Dispersion, and Auto-Fit
  useEffect(() => {
    if (!mapInstanceRef.current || !window.L || Platform.OS !== 'web') return;
    const L = window.L;
    const map = mapInstanceRef.current;
    const currentMarkerMap = markersRef.current;

    // Clear previous cluster connector lines/anchors
    clusterLayersRef.current.forEach((layer) => {
      try {
        map.removeLayer(layer);
      } catch {}
    });
    clusterLayersRef.current = [];

    const activeItemKeys = new Set<string>();
    const allCoordinates: [number, number][] = [];

    // Update Truck Markers
    trucks.forEach((truck, index) => {
      if (!Number.isFinite(truck.latitude) || !Number.isFinite(truck.longitude)) return;
      const key = `truck-${truck.id || index}`;
      activeItemKeys.add(key);
      allCoordinates.push([truck.latitude, truck.longitude]);

      const color = truck.active ? '#059669' : '#64748B';
      const pulseColor = truck.active ? 'rgba(16,185,129,0.4)' : 'transparent';

      const truckHtml = `
        <div style="position: relative; width: 50px; height: 50px; display: flex; align-items: center; justify-content: center;">
          ${truck.active ? `<div style="position: absolute; width: 44px; height: 44px; border-radius: 22px; background: ${pulseColor}; border: 1.5px solid #10B981; animation: live-radar-pulse 2s infinite ease-out;"></div>` : ''}
          <div style="position: relative; z-index: 10; width: 30px; height: 30px; border-radius: 15px; background: ${color}; border: 2.5px solid white; box-shadow: 0 3px 8px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="1" y="3" width="15" height="13"></rect>
              <polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon>
              <circle cx="5.5" cy="18.5" r="2.5"></circle>
              <circle cx="18.5" cy="18.5" r="2.5"></circle>
            </svg>
          </div>
          <div style="position: absolute; bottom: -6px; z-index: 15; background: #0F172A; color: #FFFFFF; font-size: 8px; font-weight: 800; padding: 1px 5px; border-radius: 6px; white-space: nowrap; border: 1px solid #334155; box-shadow: 0 2px 4px rgba(0,0,0,0.25);">
            ${truck.label || `T-${index + 1}`}
          </div>
        </div>
      `;

      const customIcon = L.divIcon({
        className: 'live-op-truck-marker',
        html: truckHtml,
        iconSize: [50, 50],
        iconAnchor: [25, 25],
      });

      const popupHtml = `
        <div style="font-family: sans-serif; padding: 4px;">
          <div style="font-size: 13px; font-weight: 800; color: #0F172A; margin-bottom: 2px;">
            🚛 ${truck.label || 'Municipal Truck'}
          </div>
          <div style="display: inline-block; font-size: 10px; font-weight: 700; color: ${truck.active ? '#059669' : '#64748B'}; background: ${truck.active ? '#ECFDF5' : '#F1F5F9'}; padding: 2px 6px; border-radius: 4px; margin-bottom: 6px;">
            ${truck.active ? '🟢 ACTIVE ON ROUTE' : '⚪ STANDBY / DEPOT'}
          </div>
          <div style="font-size: 11px; color: #475569;">
            GPS: ${truck.latitude.toFixed(4)}, ${truck.longitude.toFixed(4)}
          </div>
        </div>
      `;

      if (currentMarkerMap.has(key)) {
        const marker = currentMarkerMap.get(key);
        marker.setLatLng([truck.latitude, truck.longitude]);
        marker.setIcon(customIcon);
        marker.setPopupContent(popupHtml);
      } else {
        const marker = L.marker([truck.latitude, truck.longitude], { icon: customIcon, zIndexOffset: 500 })
          .bindPopup(popupHtml)
          .addTo(map);
        currentMarkerMap.set(key, marker);
      }
    });

    // Disperse co-located reports so they never occlude or hide behind each other
    const dispersedReports = calculateDispersedReports(reports);

    // Track original cluster centers to draw anchor dots once
    const renderedAnchors = new Set<string>();

    dispersedReports.forEach((report, index) => {
      const key = `report-${report.id || index}`;
      activeItemKeys.add(key);
      allCoordinates.push([report.displayLat, report.displayLng]);

      // If multiple reports are at the same spot, draw a connector line & anchor
      if (report.clusterTotal > 1) {
        const anchorKey = `${report.originalLat.toFixed(5)}_${report.originalLng.toFixed(5)}`;
        if (!renderedAnchors.has(anchorKey)) {
          const anchor = L.circleMarker([report.originalLat, report.originalLng], {
            radius: 5,
            fillColor: '#EF4444',
            color: '#FFFFFF',
            weight: 2,
            fillOpacity: 1,
            zIndexOffset: 300,
          }).bindTooltip(
            `<div style="font-size: 11px; font-weight: 700;">📍 Cluster: ${report.clusterTotal} reports co-located here</div>`
          ).addTo(map);

          clusterLayersRef.current.push(anchor);
          renderedAnchors.add(anchorKey);
        }

        // Connector line from anchor to dispersed marker
        const connector = L.polyline(
          [
            [report.originalLat, report.originalLng],
            [report.displayLat, report.displayLng],
          ],
          {
            color: '#EF4444',
            weight: 2,
            dashArray: '3, 4',
            opacity: 0.75,
          }
        ).addTo(map);
        clusterLayersRef.current.push(connector);
      }

      const clusterBadgeHtml = report.clusterTotal > 1
        ? `<div style="position: absolute; top: -6px; right: -6px; z-index: 20; background: #DC2626; color: #FFFFFF; font-size: 8px; font-weight: 900; width: 16px; height: 16px; border-radius: 8px; display: flex; align-items: center; justify-content: center; border: 1.5px solid white;">${report.clusterIndex + 1}</div>`
        : '';

      const reportBadgeText = report.clusterTotal > 1
        ? `${report.barangay ? report.barangay.slice(0, 9) : 'Report'} #${report.clusterIndex + 1}`
        : (report.barangay ? report.barangay.slice(0, 10) : `R${index + 1}`);

      const reportHtml = `
        <div style="position: relative; width: 48px; height: 48px; display: flex; align-items: center; justify-content: center; cursor: pointer;">
          <div style="position: absolute; width: 40px; height: 40px; border-radius: 20px; background: rgba(239,68,68,0.35); border: 1.5px solid #EF4444; animation: danger-pulse 1.8s infinite ease-out;"></div>
          <div style="position: relative; z-index: 10; width: 26px; height: 26px; border-radius: 13px; background: #DC2626; border: 2.5px solid white; box-shadow: 0 3px 8px rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center;">
            <span style="color: white; font-size: 12px; font-weight: 900; line-height: 1;">!</span>
          </div>
          ${clusterBadgeHtml}
          <div style="position: absolute; bottom: -5px; z-index: 15; background: #991B1B; color: #FFFFFF; font-size: 8px; font-weight: 800; padding: 1px 5px; border-radius: 4px; white-space: nowrap; border: 1px solid #FFFFFF; box-shadow: 0 1px 3px rgba(0,0,0,0.3);">
            ${reportBadgeText}
          </div>
        </div>
      `;

      const customIcon = L.divIcon({
        className: 'live-op-report-marker',
        html: reportHtml,
        iconSize: [48, 48],
        iconAnchor: [24, 24],
      });

      const clusterInfoHtml = report.clusterTotal > 1
        ? `<div style="background: #FEF2F2; border: 1px solid #FECACA; border-radius: 6px; padding: 4px 6px; margin-bottom: 6px; font-size: 10px; color: #DC2626; font-weight: 800;">
            📍 Report ${report.clusterIndex + 1} of ${report.clusterTotal} co-located in this area
           </div>`
        : '';

      const popupHtml = `
        <div style="font-family: sans-serif; padding: 4px; min-width: 200px;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
            <div style="display: flex; align-items: center; gap: 4px;">
              <span style="font-size: 13px;">⚠️</span>
              <span style="font-size: 11px; font-weight: 800; color: #DC2626;">Citizen Hazard Report</span>
            </div>
            <span style="font-size: 9px; font-weight: 700; background: #FEE2E2; color: #DC2626; padding: 2px 5px; border-radius: 4px;">
              ${(report.status || 'PENDING').toUpperCase()}
            </span>
          </div>

          ${clusterInfoHtml}

          <div style="font-size: 13px; font-weight: 700; color: #0F172A; margin-bottom: 4px;">
            ${report.label || report.barangay || 'Open Incident'}
          </div>

          ${report.street ? `<div style="font-size: 11px; color: #475569; margin-bottom: 2px;">Street: <b>${report.street}</b></div>` : ''}
          ${report.barangay ? `<div style="font-size: 11px; color: #475569; margin-bottom: 4px;">Barangay: <b>${report.barangay}</b></div>` : ''}

          <div style="font-size: 9px; color: #94A3B8; margin-bottom: 8px;">
            📍 GPS: ${report.originalLat.toFixed(5)}, ${report.originalLng.toFixed(5)}
          </div>

          <button
            class="leaflet-popup-action-btn"
            onclick="window.__selectOperationalReport && window.__selectOperationalReport('${report.id}')"
          >
            Inspect Incident Details ↗
          </button>
        </div>
      `;

      if (currentMarkerMap.has(key)) {
        const marker = currentMarkerMap.get(key);
        marker.setLatLng([report.displayLat, report.displayLng]);
        marker.setIcon(customIcon);
        marker.setPopupContent(popupHtml);
      } else {
        const marker = L.marker([report.displayLat, report.displayLng], {
          icon: customIcon,
          zIndexOffset: 600 + report.clusterIndex * 10,
        })
          .bindPopup(popupHtml)
          .addTo(map);

        marker.on('click', () => {
          if (onSelectReport) onSelectReport(report);
        });

        currentMarkerMap.set(key, marker);
      }
    });

    // Remove deleted markers
    for (const [key, marker] of currentMarkerMap.entries()) {
      if (!activeItemKeys.has(key)) {
        map.removeLayer(marker);
        currentMarkerMap.delete(key);
      }
    }

    // Auto-fit bounds on initial data load
    if (!hasAutoFittedRef.current && allCoordinates.length > 0) {
      try {
        const bounds = L.latLngBounds(allCoordinates);
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [60, 60], maxZoom: 15 });
          hasAutoFittedRef.current = true;
        }
      } catch (err) {
        console.warn('Auto-fit bounds note:', err);
      }
    }
  }, [trucks, reports, onSelectReport]);

  // 4. Handle Focused Target Animation
  useEffect(() => {
    if (!mapInstanceRef.current || !window.L || !focusedTarget || Platform.OS !== 'web') return;
    const { latitude, longitude, id } = focusedTarget;
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      mapInstanceRef.current.flyTo([latitude, longitude], 16, { duration: 1.2 });
      if (id) {
        const key = `report-${id}`;
        const marker = markersRef.current.get(key);
        if (marker) {
          setTimeout(() => marker.openPopup(), 600);
        }
      }
    }
  }, [focusedTarget]);

  // Quick Map Action Handlers
  const handleFocusHazards = useCallback(() => {
    if (!mapInstanceRef.current || !window.L || reports.length === 0) return;
    const L = window.L;
    const dispersed = calculateDispersedReports(reports);
    const hazardCoords: [number, number][] = dispersed.map((r) => [r.displayLat, r.displayLng]);

    if (hazardCoords.length === 1) {
      mapInstanceRef.current.flyTo(hazardCoords[0], 16, { duration: 1 });
      const firstMarker = markersRef.current.get(`report-${reports[0].id || 0}`);
      if (firstMarker) {
        setTimeout(() => firstMarker.openPopup(), 500);
      }
    } else if (hazardCoords.length > 1) {
      const bounds = L.latLngBounds(hazardCoords);
      mapInstanceRef.current.flyToBounds(bounds, { padding: [50, 50], maxZoom: 16 });
    }
  }, [reports]);

  const handleFitAll = useCallback(() => {
    if (!mapInstanceRef.current || !window.L) return;
    const L = window.L;
    const allCoords: [number, number][] = [];
    const dispersed = calculateDispersedReports(reports);
    dispersed.forEach((r) => allCoords.push([r.displayLat, r.displayLng]));
    trucks.forEach((t) => {
      if (Number.isFinite(t.latitude) && Number.isFinite(t.longitude)) allCoords.push([t.latitude, t.longitude]);
    });

    if (allCoords.length > 0) {
      const bounds = L.latLngBounds(allCoords);
      mapInstanceRef.current.flyToBounds(bounds, { padding: [50, 50], maxZoom: 15 });
    } else {
      mapInstanceRef.current.flyTo(DANAO_DEFAULT_CENTER, 14);
    }
  }, [trucks, reports]);

  const handleFocusDanao = useCallback(() => {
    if (!mapInstanceRef.current) return;
    mapInstanceRef.current.flyTo(DANAO_DEFAULT_CENTER, 14, { duration: 1 });
  }, []);

  return (
    <View style={styles.wrapper}>
      {Platform.OS === 'web' ? (
        <View style={{ position: 'relative', width: '100%', height }}>
          {/* Interactive Leaflet Map Container */}
          <div
            id={mapIdRef.current}
            style={{
              width: '100%',
              height: `${height}px`,
              backgroundColor: '#E8F2E9',
              borderRadius: '12px',
              overflow: 'hidden',
            }}
          />

          {/* Floating Map Navigation Toolbar */}
          <View style={styles.floatingToolbar}>
            {reports.length > 0 && (
              <TouchableOpacity
                style={[styles.floatingBtn, styles.floatingBtnDanger]}
                onPress={handleFocusHazards}
                activeOpacity={0.8}
              >
                <MaterialIcons name="warning" size={13} color="#DC2626" />
                <Text style={styles.floatingBtnDangerText}>
                  Focus {reports.length} Hazard{reports.length === 1 ? '' : 's'}
                </Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.floatingBtn}
              onPress={handleFitAll}
              activeOpacity={0.8}
            >
              <MaterialIcons name="zoom-out-map" size={13} color="#475569" />
              <Text style={styles.floatingBtnText}>Fit All</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.floatingBtn}
              onPress={handleFocusDanao}
              activeOpacity={0.8}
            >
              <MaterialIcons name="location-city" size={13} color="#059669" />
              <Text style={styles.floatingBtnText}>Danao Center</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <Svg width="100%" height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
          <Rect width={WIDTH} height={HEIGHT} rx={16} fill="#E8F2E9" />
          {[1, 2, 3, 4].map((index) => (
            <G key={`grid-${index}`}>
              <Line x1={(WIDTH / 5) * index} y1={0} x2={(WIDTH / 5) * index} y2={HEIGHT} stroke="#648675" strokeOpacity={0.17} strokeDasharray="5 8" />
              <Line x1={0} y1={(HEIGHT / 5) * index} x2={WIDTH} y2={(HEIGHT / 5) * index} stroke="#648675" strokeOpacity={0.17} strokeDasharray="5 8" />
            </G>
          ))}
          <SvgText x={18} y={26} fill="#526A5A" fontSize={11} fontWeight="800">DANAO CITY LIVE GPS VIEW</SvgText>

          {reports.map((report, index) => {
            const point = project(report.latitude, report.longitude);
            return (
              <G key={`report-${report.id}`}>
                <Circle cx={point.x} cy={point.y} r={12} fill="#DC2626" opacity={0.2} />
                <Circle cx={point.x} cy={point.y} r={6} fill="#DC2626" stroke="#FFFFFF" strokeWidth={2} />
                <SvgText x={point.x} y={point.y - 10} textAnchor="middle" fill="#991B1B" fontSize={8} fontWeight="800">R{index + 1}</SvgText>
              </G>
            );
          })}

          {trucks.map((truck, index) => {
            const point = project(truck.latitude, truck.longitude);
            const color = truck.active ? '#15803D' : '#64748B';
            return (
              <G key={`truck-${truck.id}`}>
                <Circle cx={point.x} cy={point.y} r={16} fill={color} opacity={0.18} />
                <Circle cx={point.x} cy={point.y} r={10} fill={color} stroke="#FFFFFF" strokeWidth={2.5} />
                <SvgText x={point.x} y={point.y + 3.5} textAnchor="middle" fill="#FFFFFF" fontSize={8} fontWeight="900">T{index + 1}</SvgText>
              </G>
            );
          })}
        </Svg>
      )}

      {/* Clean Legend Strip */}
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: '#059669' }]} />
          <Text style={styles.legendText}>Active Truck</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: '#64748B' }]} />
          <Text style={styles.legendText}>Standby Truck</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: '#DC2626' }]} />
          <Text style={styles.legendText}>Hazard / Report Pin</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    overflow: 'hidden',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
  },
  floatingToolbar: {
    position: 'absolute',
    top: 12,
    left: 12,
    zIndex: 1000,
    flexDirection: 'row',
    gap: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    padding: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 5,
    elevation: 4,
  },
  floatingBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  floatingBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#334155',
  },
  floatingBtnDanger: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  floatingBtnDangerText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#DC2626',
  },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 16,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    color: '#475569',
    fontSize: 11,
    fontWeight: '600',
  },
});

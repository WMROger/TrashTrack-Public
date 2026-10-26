import React, { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

export type LiveTruck = {
  id: string; // driverId
  driverId: string;
  truckId: string;
  plateNumber: string;
  driverName: string;
  latitude: number;
  longitude: number;
  speedKph: number;
  heading: number;
  barangay: string;
  locationName: string;
  status: string;
  isSimulation: boolean;
  lastUpdate: number;
};

type Props = {
  trucks: LiveTruck[];
  selectedTruckId?: string | null;
  onSelectTruck?: (truck: LiveTruck) => void;
};

declare const window: any;
declare const document: any;

const DANAO_DEFAULT_CENTER: [number, number] = [10.5218, 124.0285];

export default function LiveFleetMap({ trucks, selectedTruckId, onSelectTruck }: Props) {
  const mapInstanceRef = useRef<any>(null);
  const markersRef = useRef<Map<string, any>>(new Map());
  const [leafletReady, setLeafletReady] = useState(false);
  const mapIdRef = useRef(`live-fleet-map-${Math.random().toString(36).substring(2, 9)}`);
  const [autoFollow, setAutoFollow] = useState(true);

  const activeSelectedTruck = trucks.find(t => t.id === selectedTruckId || t.driverId === selectedTruckId) || trucks[0] || null;

  // 1. Ensure Leaflet CSS & JS is loaded on web
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
        @keyframes live-glow {
          0%, 100% { filter: drop-shadow(0 0 6px rgba(16,185,129,0.8)); }
          50% { filter: drop-shadow(0 0 14px rgba(5,150,105,1)); }
        }
        .live-truck-marker {
          transition: transform 0.4s ease-out;
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
      const initialLat = activeSelectedTruck ? activeSelectedTruck.latitude : DANAO_DEFAULT_CENTER[0];
      const initialLng = activeSelectedTruck ? activeSelectedTruck.longitude : DANAO_DEFAULT_CENTER[1];

      const map = L.map(mapIdRef.current, {
        center: [initialLat, initialLng],
        zoom: 15,
        zoomControl: false,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);

      L.control.zoom({ position: 'bottomright' }).addTo(map);

      mapInstanceRef.current = map;
    } catch (err) {
      console.warn('Live map initialization error:', err);
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

  // 3. Update Real-Time Live Truck Markers
  useEffect(() => {
    if (!mapInstanceRef.current || !window.L) return;
    const L = window.L;
    const map = mapInstanceRef.current;
    const currentMarkerMap = markersRef.current;
    const activeTruckIds = new Set(trucks.map(t => t.id));

    // Remove markers that are no longer active
    for (const [id, marker] of currentMarkerMap.entries()) {
      if (!activeTruckIds.has(id)) {
        map.removeLayer(marker);
        currentMarkerMap.delete(id);
      }
    }

    // Add or update live truck markers
    trucks.forEach(truck => {
      if (!Number.isFinite(truck.latitude) || !Number.isFinite(truck.longitude)) return;
      const isSelected = activeSelectedTruck?.id === truck.id;
      const themeColor = truck.isSimulation ? '#059669' : '#2563EB';
      const pulseColor = truck.isSimulation ? 'rgba(16,185,129,0.45)' : 'rgba(37,99,235,0.45)';

      const truckHtml = `
        <div style="position: relative; width: 64px; height: 64px; display: flex; align-items: center; justify-content: center;">
          <!-- Pulsing Radar Wave -->
          <div style="position: absolute; width: 54px; height: 54px; border-radius: 27px; background: ${pulseColor}; border: 1.5px solid ${themeColor}; animation: live-radar-pulse 2s infinite ease-out;"></div>
          
          <!-- Truck Icon Badge -->
          <div style="position: relative; z-index: 10; width: 38px; height: 38px; border-radius: 19px; background: ${themeColor}; border: 2.5px solid white; box-shadow: 0 4px 12px rgba(0,0,0,0.35); display: flex; align-items: center; justify-content: center; transform: rotate(${truck.heading || 0}deg); transition: transform 0.3s ease;">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="1" y="3" width="15" height="13"></rect>
              <polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon>
              <circle cx="5.5" cy="18.5" r="2.5"></circle>
              <circle cx="18.5" cy="18.5" r="2.5"></circle>
            </svg>
          </div>

          <!-- Speed Badge -->
          <div style="position: absolute; top: -4px; right: -2px; z-index: 15; background: #0F172A; color: #10B981; font-size: 9px; font-weight: 900; padding: 2px 5px; border-radius: 8px; border: 1px solid #334155; white-space: nowrap; box-shadow: 0 2px 4px rgba(0,0,0,0.4);">
            ${Math.round(truck.speedKph || 0)} km/h
          </div>

          <!-- Plate Pill -->
          <div style="position: absolute; bottom: -8px; z-index: 15; background: ${isSelected ? '#1E293B' : '#FFFFFF'}; color: ${isSelected ? '#FFFFFF' : '#0F172A'}; font-size: 9px; font-weight: 800; padding: 2px 6px; border-radius: 10px; border: 1.5px solid ${themeColor}; white-space: nowrap; box-shadow: 0 2px 6px rgba(0,0,0,0.25);">
            ${truck.plateNumber}
          </div>
        </div>
      `;

      const customIcon = L.divIcon({
        className: 'live-truck-marker',
        html: truckHtml,
        iconSize: [64, 64],
        iconAnchor: [32, 32],
      });

      const popupContent = `
        <div style="padding: 6px; font-family: sans-serif;">
          <div style="font-size: 13px; font-weight: 800; color: #0F172A; margin-bottom: 2px;">
            🚛 ${truck.plateNumber}
          </div>
          <div style="font-size: 11px; color: #475569; margin-bottom: 4px;">
            Driver: <b>${truck.driverName}</b>
          </div>
          <div style="display: inline-block; font-size: 10px; font-weight: 700; color: ${truck.isSimulation ? '#059669' : '#2563EB'}; background: ${truck.isSimulation ? '#ECFDF5' : '#EFF6FF'}; padding: 2px 6px; border-radius: 4px; margin-bottom: 6px;">
            ${truck.isSimulation ? '🟢 GPS SIMULATION' : '🟢 ACTIVE DISPATCH'}
          </div>
          <div style="font-size: 11px; color: #334155; border-top: 1px solid #E2E8F0; padding-top: 4px;">
            📍 <b>${truck.barangay ? `Brgy. ${truck.barangay}` : 'Danao City'}</b><br/>
            ⚡ Speed: <b>${Math.round(truck.speedKph || 0)} km/h</b><br/>
            ⏱ Updated: <b>Just now</b>
          </div>
        </div>
      `;

      if (currentMarkerMap.has(truck.id)) {
        const marker = currentMarkerMap.get(truck.id);
        marker.setLatLng([truck.latitude, truck.longitude]);
        marker.setIcon(customIcon);
        marker.setPopupContent(popupContent);
      } else {
        const marker = L.marker([truck.latitude, truck.longitude], {
          icon: customIcon,
          zIndexOffset: isSelected ? 1000 : 500,
        })
          .bindPopup(popupContent)
          .addTo(map);

        marker.on('click', () => {
          if (onSelectTruck) onSelectTruck(truck);
        });

        currentMarkerMap.set(truck.id, marker);
      }
    });

    // Auto-pan to selected active truck
    if (autoFollow && activeSelectedTruck && Number.isFinite(activeSelectedTruck.latitude) && Number.isFinite(activeSelectedTruck.longitude)) {
      map.panTo([activeSelectedTruck.latitude, activeSelectedTruck.longitude], { animate: true, duration: 0.5 });
    }
  }, [trucks, activeSelectedTruck?.id, autoFollow]);

  return (
    <View style={styles.mapWrapper}>
      <div
        id={mapIdRef.current}
        style={{
          width: '100%',
          height: '420px',
          borderRadius: '12px',
          overflow: 'hidden',
          backgroundColor: '#E2E8F0',
        }}
      />

      {/* Floating HUD Telemetry Card */}
      {activeSelectedTruck && (
        <View style={styles.floatingHud}>
          <View style={styles.hudRow}>
            <View style={styles.hudBadge}>
              <View style={[styles.pulseDot, activeSelectedTruck.isSimulation && { backgroundColor: '#10B981' }]} />
              <Text style={styles.hudBadgeText}>
                {activeSelectedTruck.isSimulation ? 'SIMULATION BROADCAST' : 'LIVE GPS STREAM'}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.autoFollowBtn, autoFollow && styles.autoFollowBtnActive]}
              onPress={() => setAutoFollow(prev => !prev)}
            >
              <MaterialIcons name={autoFollow ? 'gps-fixed' : 'gps-not-fixed'} size={14} color={autoFollow ? '#FFFFFF' : '#475569'} />
              <Text style={[styles.autoFollowText, autoFollow && { color: '#FFFFFF' }]}>
                {autoFollow ? 'Auto-Following' : 'Free Pan'}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.hudDetails}>
            <View>
              <Text style={styles.hudTruckPlate}>{activeSelectedTruck.plateNumber}</Text>
              <Text style={styles.hudMeta}>
                {activeSelectedTruck.driverName} · Brgy. {activeSelectedTruck.barangay || 'Poblacion'}
              </Text>
              <Text style={styles.hudStreet} numberOfLines={1}>
                📍 {activeSelectedTruck.locationName}
              </Text>
            </View>
            <View style={styles.hudSpeedBox}>
              <Text style={styles.hudSpeedValue}>{Math.round(activeSelectedTruck.speedKph || 0)}</Text>
              <Text style={styles.hudSpeedUnit}>KM/H</Text>
            </View>
          </View>
        </View>
      )}

      {/* No Active Trucks Notice */}
      {trucks.length === 0 && (
        <View style={styles.noTrucksOverlay}>
          <MaterialIcons name="sensors-off" size={28} color="#64748B" />
          <Text style={styles.noTrucksTitle}>No Active Vehicles Broadcasting</Text>
          <Text style={styles.noTrucksSub}>
            Start a drive or simulation in the Driver Terminal to stream live telemetry here in real time.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  mapWrapper: {
    position: 'relative',
    width: '100%',
    height: 420,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#0F172A',
  },
  floatingHud: {
    position: 'absolute',
    top: 14,
    left: 14,
    right: 14,
    zIndex: 1000,
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
    backdropFilter: 'blur(8px)',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
  },
  hudRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  hudBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(16, 185, 129, 0.18)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.4)',
  },
  pulseDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#34D399',
  },
  hudBadgeText: {
    fontSize: 9,
    fontWeight: '900',
    color: '#34D399',
    letterSpacing: 0.6,
  },
  autoFollowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  autoFollowBtnActive: {
    backgroundColor: '#059669',
    borderColor: '#047857',
  },
  autoFollowText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#334155',
  },
  hudDetails: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  hudTruckPlate: {
    fontSize: 15,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  hudMeta: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 2,
    fontWeight: '600',
  },
  hudStreet: {
    fontSize: 11,
    color: '#E2E8F0',
    marginTop: 3,
    fontWeight: '700',
  },
  hudSpeedBox: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1E293B',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  hudSpeedValue: {
    fontSize: 20,
    fontWeight: '900',
    color: '#34D399',
    lineHeight: 22,
  },
  hudSpeedUnit: {
    fontSize: 8,
    fontWeight: '900',
    color: '#94A3B8',
    letterSpacing: 0.8,
  },
  noTrucksOverlay: {
    position: 'absolute',
    top: '35%',
    left: '10%',
    right: '10%',
    zIndex: 900,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
  },
  noTrucksTitle: {
    fontSize: 13,
    fontWeight: '900',
    color: '#1E293B',
    marginTop: 6,
  },
  noTrucksSub: {
    fontSize: 11,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 3,
    lineHeight: 15,
  },
});

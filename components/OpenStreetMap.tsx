import React, { useEffect, useRef, useMemo, forwardRef, useImperativeHandle } from 'react';
import { StyleSheet, View, StyleProp, ViewStyle } from 'react-native';
import WebView from 'react-native-webview';

export type MapCoordinate = {
  latitude: number;
  longitude: number;
};

export type MapStop = {
  id: string;
  latitude: number;
  longitude: number;
  title?: string;
  subtitle?: string;
  orderNumber?: number;
  selected?: boolean;
};

export type MapTruck = {
  id: string;
  latitude: number;
  longitude: number;
  plateNumber?: string;
  driverName?: string;
  speedKph?: number;
  heading?: number;
  isStale?: boolean;
  locationName?: string;
};

export type MapPolyline = {
  id?: string;
  coordinates: MapCoordinate[];
  strokeColor?: string;
  strokeWidth?: number;
  isDashed?: boolean;
};

export interface OpenStreetMapProps {
  initialCenter?: MapCoordinate;
  zoom?: number;
  polyline?: MapCoordinate[];
  polylineColor?: string;
  polylines?: MapPolyline[];
  truckCoordinate?: (MapCoordinate & { heading?: number; speedKph?: number }) | null;
  trucks?: MapTruck[];
  userCoordinate?: MapCoordinate | null;
  stops?: MapStop[];
  style?: StyleProp<ViewStyle>;
  isDark?: boolean;
  onSelectStop?: (id: string) => void;
  interactive?: boolean;
  zoomControlPosition?: 'topleft' | 'topright' | 'bottomleft' | 'bottomright';
  zoomBottomOffset?: number;
  showZoomControl?: boolean;
  centerOnTruck?: boolean;
}

export interface OpenStreetMapRef {
  animateToRegion: (
    region: { latitude: number; longitude: number; latitudeDelta?: number; longitudeDelta?: number },
    duration?: number
  ) => void;
  fitToCoordinates: (
    coords: MapCoordinate[],
    options?: { edgePadding?: { top: number; right: number; bottom: number; left: number }; animated?: boolean }
  ) => void;
  setCenter: (latitude: number, longitude: number, zoom?: number) => void;
  centerOnTruck: () => void;
  fitRoute: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
}

export const OpenStreetMap = forwardRef<OpenStreetMapRef, OpenStreetMapProps>(function OpenStreetMap(
  {
    initialCenter = { latitude: 10.5218, longitude: 124.0285 },
    zoom = 15,
    polyline = [],
    polylineColor = '#2E8B57',
    polylines = [],
    truckCoordinate = null,
    trucks = [],
    userCoordinate = null,
    stops = [],
    style,
    isDark = false,
    onSelectStop,
    interactive = true,
    zoomControlPosition = 'bottomright',
    zoomBottomOffset = 28,
    showZoomControl = true,
    centerOnTruck = false,
  },
  ref
) {
  const webViewRef = useRef<WebView>(null);
  const isLoadedRef = useRef(false);
  const initialCenterRef = useRef(initialCenter);

  // Expose imperative methods for camera / navigation control
  useImperativeHandle(ref, () => ({
    animateToRegion: (region, _duration) => {
      if (webViewRef.current && isLoadedRef.current) {
        webViewRef.current.injectJavaScript(
          `if (window.nativeSetCenter) { window.nativeSetCenter(${region.latitude}, ${region.longitude}); } true;`
        );
      }
    },
    fitToCoordinates: (coords, _options) => {
      if (webViewRef.current && isLoadedRef.current && coords && coords.length > 0) {
        const coordsJson = JSON.stringify(coords.map((c) => ({ latitude: c.latitude, longitude: c.longitude })));
        webViewRef.current.injectJavaScript(
          `if (window.nativeFitCoordinates) { window.nativeFitCoordinates('${coordsJson}'); } true;`
        );
      }
    },
    setCenter: (latitude, longitude, newZoom) => {
      if (webViewRef.current && isLoadedRef.current) {
        webViewRef.current.injectJavaScript(
          `if (window.nativeSetCenter) { window.nativeSetCenter(${latitude}, ${longitude}, ${newZoom || 'null'}); } true;`
        );
      }
    },
    centerOnTruck: () => {
      if (webViewRef.current && isLoadedRef.current) {
        const target = truckCoordinate || initialCenter;
        if (target && Number.isFinite(target.latitude) && Number.isFinite(target.longitude)) {
          webViewRef.current.injectJavaScript(
            `if (window.nativeSetCenter) { window.nativeSetCenter(${target.latitude}, ${target.longitude}); } true;`
          );
        }
      }
    },
    fitRoute: () => {
      if (webViewRef.current && isLoadedRef.current) {
        webViewRef.current.injectJavaScript(`if (window.nativeFitRoute) { window.nativeFitRoute(); } true;`);
      }
    },
    zoomIn: () => {
      if (webViewRef.current) {
        webViewRef.current.injectJavaScript(
          `if (window.nativeZoomIn) { window.nativeZoomIn(); } else if (window.map) { window.map.zoomIn(); } true;`
        );
      }
    },
    zoomOut: () => {
      if (webViewRef.current) {
        webViewRef.current.injectJavaScript(
          `if (window.nativeZoomOut) { window.nativeZoomOut(); } else if (window.map) { window.map.zoomOut(); } true;`
        );
      }
    },
  }));

  // Filter valid single polyline
  const validPolyline = useMemo(() => {
    return (polyline || []).filter(
      (p) => p && Number.isFinite(p.latitude) && Number.isFinite(p.longitude)
    );
  }, [polyline]);

  // Filter valid multiple polylines
  const validPolylines = useMemo(() => {
    return (polylines || [])
      .map((p) => ({
        ...p,
        coordinates: (p.coordinates || []).filter(
          (c) => c && Number.isFinite(c.latitude) && Number.isFinite(c.longitude)
        ),
      }))
      .filter((p) => p.coordinates.length > 1);
  }, [polylines]);

  // Filter valid stops
  const validStops = useMemo(() => {
    return (stops || []).filter(
      (s) => s && Number.isFinite(s.latitude) && Number.isFinite(s.longitude)
    );
  }, [stops]);

  // Filter valid trucks
  const validTrucks = useMemo(() => {
    return (trucks || []).filter(
      (t) => t && Number.isFinite(t.latitude) && Number.isFinite(t.longitude)
    );
  }, [trucks]);

  // Generate self-contained Leaflet + OpenStreetMap HTML
  const htmlContent = useMemo(() => {
    const effectiveCenter = (centerOnTruck && truckCoordinate && Number.isFinite(truckCoordinate.latitude) && Number.isFinite(truckCoordinate.longitude))
      ? truckCoordinate
      : initialCenter;
    const centerLat = Number.isFinite(effectiveCenter?.latitude) ? effectiveCenter.latitude : 10.5218;
    const centerLng = Number.isFinite(effectiveCenter?.longitude) ? effectiveCenter.longitude : 124.0285;

    const tileUrl = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

    const polylineJson = JSON.stringify(
      validPolyline.map((p) => [p.latitude, p.longitude])
    );

    const polylinesJson = JSON.stringify(
      validPolylines.map((p) => ({
        id: p.id || '',
        coords: p.coordinates.map((c) => [c.latitude, c.longitude]),
        color: p.strokeColor || '#059669',
        width: p.strokeWidth || 4,
        isDashed: !!p.isDashed,
      }))
    );

    const stopsJson = JSON.stringify(
      validStops.map((s) => ({
        id: s.id,
        lat: s.latitude,
        lng: s.longitude,
        title: s.title || '',
        order: s.orderNumber || 1,
        selected: !!s.selected,
      }))
    );

    const trucksJson = JSON.stringify(
      validTrucks.map((t) => ({
        id: t.id,
        lat: t.latitude,
        lng: t.longitude,
        plate: t.plateNumber || 'Truck',
        driver: t.driverName || '',
        speed: t.speedKph || 0,
        isStale: !!t.isStale,
        locationName: t.locationName || '',
      }))
    );

    const singleTruckJson = truckCoordinate
      ? JSON.stringify({
          lat: truckCoordinate.latitude,
          lng: truckCoordinate.longitude,
          speed: truckCoordinate.speedKph || 0,
        })
      : 'null';

    const userJson = userCoordinate
      ? JSON.stringify({
          lat: userCoordinate.latitude,
          lng: userCoordinate.longitude,
        })
      : 'null';

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          html, body, #map { width: 100%; height: 100%; background: ${isDark ? '#111827' : '#F3F4F6'}; overflow: hidden; }
          ${
            isDark
              ? `
          .leaflet-tile-pane {
            filter: brightness(0.6) invert(1) contrast(3) hue-rotate(200deg) saturate(0.3) brightness(0.7);
          }
          `
              : ''
          }
          
          /* Custom Truck Marker */
          .truck-marker-wrap {
            position: relative;
            width: 44px;
            height: 44px;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .truck-pulse {
            position: absolute;
            width: 44px;
            height: 44px;
            border-radius: 22px;
            background: rgba(34, 197, 94, 0.35);
            animation: pulse-ring 1.8s cubic-bezier(0.215, 0.61, 0.355, 1) infinite;
          }
          @keyframes pulse-ring {
            0% { transform: scale(0.6); opacity: 1; }
            100% { transform: scale(1.4); opacity: 0; }
          }
          .truck-pin {
            position: absolute;
            width: 34px;
            height: 34px;
            border-radius: 17px;
            background: #16A34A;
            border: 2.5px solid #FFFFFF;
            box-shadow: 0 4px 10px rgba(0,0,0,0.35);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 16px;
            color: #FFF;
          }
          .truck-pin.stale {
            background: #D97706;
          }

          /* Custom User Pin */
          .user-marker-wrap {
            position: relative;
            width: 32px;
            height: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .user-pulse {
            position: absolute;
            width: 32px;
            height: 32px;
            border-radius: 16px;
            background: rgba(37, 99, 235, 0.35);
            animation: pulse-ring 2s cubic-bezier(0.215, 0.61, 0.355, 1) infinite;
          }
          .user-pin {
            position: absolute;
            width: 16px;
            height: 16px;
            border-radius: 8px;
            background: #2563EB;
            border: 2.5px solid #FFFFFF;
            box-shadow: 0 2px 6px rgba(0,0,0,0.4);
          }

          /* Custom Stop Marker */
          .stop-badge {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 28px;
            height: 28px;
            border-radius: 14px;
            background: #6366F1;
            color: #FFF;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 12px;
            font-weight: 800;
            border: 2px solid #FFF;
            box-shadow: 0 2px 6px rgba(0,0,0,0.28);
            cursor: pointer;
          }
          .stop-badge.selected {
            background: #10B981;
            transform: scale(1.15);
            border-color: #ECFDF5;
          }

          /* Leaflet UI adjustments */
          .leaflet-control-attribution { display: none !important; }
          .leaflet-tooltip {
            font-size: 11px;
            font-weight: 600;
            border-radius: 6px;
            padding: 4px 8px;
            box-shadow: 0 2px 6px rgba(0,0,0,0.2);
          }

          /* Mobile-optimized, thumb-accessible zoom controls */
          .leaflet-control-zoom {
            border: none !important;
            box-shadow: 0 4px 14px rgba(0, 0, 0, 0.22) !important;
            border-radius: 12px !important;
            overflow: hidden !important;
          }
          .leaflet-control-zoom a {
            width: 44px !important;
            height: 44px !important;
            line-height: 44px !important;
            font-size: 22px !important;
            font-weight: 700 !important;
            color: #1F2937 !important;
            background-color: #FFFFFF !important;
            text-align: center !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            text-decoration: none !important;
            user-select: none !important;
            -webkit-user-select: none !important;
            touch-action: manipulation !important;
          }
          .leaflet-control-zoom a:active,
          .leaflet-control-zoom a:hover {
            background-color: #F3F4F6 !important;
            color: #059669 !important;
          }
          .leaflet-control-zoom-in {
            border-bottom: 1px solid #E5E7EB !important;
          }
          .leaflet-bottom.leaflet-right {
            bottom: ${zoomBottomOffset}px !important;
            right: 18px !important;
            display: ${showZoomControl ? 'block' : 'none'} !important;
          }
          .leaflet-top.leaflet-left {
            top: 75px !important;
            left: 16px !important;
          }
        </style>
      </head>
      <body>
        <div id="map"></div>
        <script>
          var map = L.map('map', {
            zoomControl: false,
            dragging: ${interactive ? 'true' : 'false'},
            touchZoom: ${interactive ? 'true' : 'false'},
            scrollWheelZoom: ${interactive ? 'true' : 'false'},
            doubleClickZoom: ${interactive ? 'true' : 'false'},
            attributionControl: false
          }).setView([${centerLat}, ${centerLng}], ${zoom});

          window.map = map;
          window.nativeZoomIn = function() {
            try { map.zoomIn(); } catch(e) {}
          };
          window.nativeZoomOut = function() {
            try { map.zoomOut(); } catch(e) {}
          };

          ${interactive && showZoomControl ? `L.control.zoom({ position: '${zoomControlPosition}' }).addTo(map);` : ''}

          L.tileLayer('${tileUrl}', {
            maxZoom: 19,
            subdomains: ['a', 'b', 'c']
          }).addTo(map);

          setTimeout(function() {
            map.invalidateSize();
          }, 300);

          var polylineLayer = null;
          var polylinesGroup = L.layerGroup().addTo(map);
          var stopsLayers = {};
          var truckMarker = null;
          var truckMarkers = {};
          var userMarker = null;

          function updatePolylineLayer(coords, color) {
            if (polylineLayer) map.removeLayer(polylineLayer);
            if (coords && coords.length > 1) {
              polylineLayer = L.polyline(coords, {
                color: color || '${polylineColor}',
                weight: 5,
                opacity: 0.85,
                lineCap: 'round',
                lineJoin: 'round'
              }).addTo(map);
            }
          }

          function updatePolylinesLayer(polylinesData) {
            polylinesGroup.clearLayers();
            if (!polylinesData) return;
            polylinesData.forEach(function(p) {
              if (p.coords && p.coords.length > 1) {
                L.polyline(p.coords, {
                  color: p.color || '#059669',
                  weight: p.width || 4,
                  opacity: 0.85,
                  dashArray: p.isDashed ? '8, 8' : undefined,
                  lineCap: 'round',
                  lineJoin: 'round'
                }).addTo(polylinesGroup);
              }
            });
          }

          function updateStopsLayer(stopsData) {
            Object.values(stopsLayers).forEach(function(l) { map.removeLayer(l); });
            stopsLayers = {};

            stopsData.forEach(function(s) {
              var icon = L.divIcon({
                className: 'custom-stop-icon',
                html: '<div class="stop-badge ' + (s.selected ? 'selected' : '') + '">' + s.order + '</div>',
                iconSize: [28, 28],
                iconAnchor: [14, 14]
              });

              var m = L.marker([s.lat, s.lng], { icon: icon }).addTo(map);
              if (s.title) m.bindTooltip(s.title, { direction: 'top', offset: [0, -10] });

              m.on('click', function() {
                if (window.ReactNativeWebView) {
                  window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'STOP_CLICK', id: s.id }));
                }
              });

              stopsLayers[s.id] = m;
            });
          }

          function updateSingleTruckMarker(truck) {
            if (!truck || truck.lat == null || truck.lng == null) {
              if (truckMarker) { map.removeLayer(truckMarker); truckMarker = null; }
              return;
            }

            var icon = L.divIcon({
              className: 'custom-truck-icon',
              html: '<div class="truck-marker-wrap"><div class="truck-pulse"></div><div class="truck-pin">🚛</div></div>',
              iconSize: [44, 44],
              iconAnchor: [22, 22]
            });

            if (!truckMarker) {
              truckMarker = L.marker([truck.lat, truck.lng], { icon: icon, zIndexOffset: 1000 }).addTo(map);
            } else {
              truckMarker.setLatLng([truck.lat, truck.lng]);
            }

            if (${centerOnTruck ? 'true' : 'false'}) {
              map.setView([truck.lat, truck.lng], map.getZoom());
            }
          }

          function updateTrucksMarkers(trucksData) {
            var activeIds = {};
            (trucksData || []).forEach(function(t) {
              activeIds[t.id] = true;
              var isStale = !!t.isStale;
              var pinClass = isStale ? 'truck-pin stale' : 'truck-pin';
              var pulseHtml = isStale ? '' : '<div class="truck-pulse"></div>';

              var icon = L.divIcon({
                className: 'custom-truck-icon-' + t.id,
                html: '<div class="truck-marker-wrap">' + pulseHtml + '<div class="' + pinClass + '">🚛</div></div>',
                iconSize: [44, 44],
                iconAnchor: [22, 22]
              });

              var tooltipText = '<b>' + (t.plate || 'Collection Truck') + '</b>';
              if (t.driver) tooltipText += '<br/>' + t.driver;
              if (isStale) tooltipText += '<br/><span style="color:#D97706;">● Standby</span>';
              else if (t.speed) tooltipText += '<br/><span style="color:#16A34A;">● Moving ' + Math.round(t.speed) + ' km/h</span>';

              if (!truckMarkers[t.id]) {
                var m = L.marker([t.lat, t.lng], { icon: icon, zIndexOffset: 1000 }).addTo(map);
                m.bindTooltip(tooltipText, { direction: 'top', offset: [0, -15] });
                truckMarkers[t.id] = m;
              } else {
                truckMarkers[t.id].setLatLng([t.lat, t.lng]);
                truckMarkers[t.id].setIcon(icon);
                truckMarkers[t.id].setTooltipContent(tooltipText);
              }
            });

            // Remove removed trucks
            Object.keys(truckMarkers).forEach(function(id) {
              if (!activeIds[id]) {
                map.removeLayer(truckMarkers[id]);
                delete truckMarkers[id];
              }
            });
          }

          function updateUserMarker(user) {
            if (!user) {
              if (userMarker) { map.removeLayer(userMarker); userMarker = null; }
              return;
            }

            var icon = L.divIcon({
              className: 'custom-user-icon',
              html: '<div class="user-marker-wrap"><div class="user-pulse"></div><div class="user-pin"></div></div>',
              iconSize: [32, 32],
              iconAnchor: [16, 16]
            });

            if (!userMarker) {
              userMarker = L.marker([user.lat, user.lng], { icon: icon, zIndexOffset: 900 }).addTo(map);
              userMarker.bindTooltip('Your Location', { direction: 'top', offset: [0, -10] });
            } else {
              userMarker.setLatLng([user.lat, user.lng]);
            }
          }

          // Initial Render
          var initPolyline = ${polylineJson};
          var initPolylines = ${polylinesJson};
          var initStops = ${stopsJson};
          var initTrucks = ${trucksJson};
          var initSingleTruck = ${singleTruckJson};
          var initUser = ${userJson};

          if (initPolylines && initPolylines.length > 0) {
            updatePolylinesLayer(initPolylines);
          } else if (initPolyline && initPolyline.length > 1) {
            updatePolylineLayer(initPolyline, '${polylineColor}');
          }

          if (initStops && initStops.length > 0) {
            updateStopsLayer(initStops);
          }

          if (initTrucks && initTrucks.length > 0) {
            updateTrucksMarkers(initTrucks);
          }

          if (initSingleTruck) {
            updateSingleTruckMarker(initSingleTruck);
          }

          if (initUser) {
            updateUserMarker(initUser);
          }

          // Global JS Hooks for zero-reload RN updates (safely wrapped without recursion)
          window.nativeUpdateTruck = function(lat, lng, speed, shouldCenter) {
            try {
              if (lat == null || lng == null) {
                updateSingleTruckMarker(null);
                return;
              }
              updateSingleTruckMarker({ lat: lat, lng: lng, speed: speed });
              if (shouldCenter === true || (${centerOnTruck ? 'true' : 'false'} && shouldCenter !== false)) {
                map.setView([lat, lng], map.getZoom());
              }
            } catch(e) {}
          };

          window.nativeUpdateTrucks = function(trucksData) {
            try { updateTrucksMarkers(trucksData); } catch(e) {}
          };

          window.nativeUpdateUser = function(lat, lng) {
            try { updateUserMarker({ lat: lat, lng: lng }); } catch(e) {}
          };

          window.setPolyline = function(coords, color) {
            try { updatePolylineLayer(coords, color); } catch(e) {}
          };

          window.setPolylines = function(polylinesData) {
            try { updatePolylinesLayer(polylinesData); } catch(e) {}
          };

          window.setStops = function(stopsData) {
            try { updateStopsLayer(stopsData); } catch(e) {}
          };

          window.nativeSetCenter = function(lat, lng, newZoom) {
            try { map.setView([lat, lng], newZoom || map.getZoom()); } catch(e) {}
          };

          window.nativeFitRoute = function() {
            try {
              if (polylineLayer && polylineLayer.getBounds && polylineLayer.getBounds().isValid()) {
                map.fitBounds(polylineLayer.getBounds(), { padding: [35, 35] });
              }
            } catch(e) {}
          };

          window.nativeFitCoordinates = function(coordsJson) {
            try {
              var coords = typeof coordsJson === 'string' ? JSON.parse(coordsJson) : coordsJson;
              if (coords && coords.length > 0) {
                var bounds = L.latLngBounds(coords.map(function(c) { return [c.latitude, c.longitude]; }));
                if (bounds.isValid()) {
                  map.fitBounds(bounds, { padding: [40, 40] });
                }
              }
            } catch(e) {}
          };
        </script>
      </body>
      </html>
    `;
  }, [isDark, interactive, zoomControlPosition, centerOnTruck]);

  // Dynamic Zoom Control position and visibility update (avoids full WebView reload)
  useEffect(() => {
    if (!webViewRef.current || !isLoadedRef.current) return;
    const js = `
      var el = document.querySelector('.leaflet-bottom.leaflet-right');
      if (el) {
        el.style.setProperty('bottom', '${zoomBottomOffset}px', 'important');
        el.style.setProperty('display', '${showZoomControl ? "block" : "none"}', 'important');
      }
      true;
    `;
    webViewRef.current.injectJavaScript(js);
  }, [zoomBottomOffset, showZoomControl]);

  // Dynamic Center update
  useEffect(() => {
    if (!webViewRef.current || !isLoadedRef.current) return;
    if (initialCenter && Number.isFinite(initialCenter.latitude) && Number.isFinite(initialCenter.longitude)) {
      const js = `
        if (window.nativeSetCenter) {
          window.nativeSetCenter(${initialCenter.latitude}, ${initialCenter.longitude});
        }
        true;
      `;
      webViewRef.current.injectJavaScript(js);
    }
  }, [initialCenter?.latitude, initialCenter?.longitude]);

  // Dynamic Polyline update
  useEffect(() => {
    if (!webViewRef.current || !isLoadedRef.current) return;
    const polylineJson = JSON.stringify(validPolyline.map((p) => [p.latitude, p.longitude]));
    const js = `
      if (window.setPolyline) {
        window.setPolyline(${polylineJson}, '${polylineColor}');
      }
      true;
    `;
    webViewRef.current.injectJavaScript(js);
  }, [validPolyline, polylineColor]);

  // Dynamic Polylines update
  useEffect(() => {
    if (!webViewRef.current || !isLoadedRef.current) return;
    const polylinesJson = JSON.stringify(
      validPolylines.map((p) => ({
        id: p.id || '',
        coords: p.coordinates.map((c) => [c.latitude, c.longitude]),
        color: p.strokeColor || '#059669',
        width: p.strokeWidth || 4,
        isDashed: !!p.isDashed,
      }))
    );
    const js = `
      if (window.setPolylines) {
        window.setPolylines(${polylinesJson});
      }
      true;
    `;
    webViewRef.current.injectJavaScript(js);
  }, [validPolylines]);

  // Dynamic Single Truck update (Driver mode)
  useEffect(() => {
    if (!webViewRef.current || !isLoadedRef.current) return;
    if (!truckCoordinate || !Number.isFinite(truckCoordinate.latitude) || !Number.isFinite(truckCoordinate.longitude)) {
      webViewRef.current.injectJavaScript(`if (window.nativeUpdateTruck) { window.nativeUpdateTruck(null, null); } true;`);
      return;
    }
    const shouldCenter = centerOnTruck ? 'true' : 'false';
    const js = `
      if (window.nativeUpdateTruck) {
        window.nativeUpdateTruck(${truckCoordinate.latitude}, ${truckCoordinate.longitude}, ${truckCoordinate.speedKph || 0}, ${shouldCenter});
      }
      true;
    `;
    webViewRef.current.injectJavaScript(js);
  }, [truckCoordinate?.latitude, truckCoordinate?.longitude, truckCoordinate?.speedKph, centerOnTruck]);

  // Dynamic Multi-Trucks update (Resident mode)
  useEffect(() => {
    if (!webViewRef.current || !isLoadedRef.current) return;
    const trucksJson = JSON.stringify(
      validTrucks.map((t) => ({
        id: t.id,
        lat: t.latitude,
        lng: t.longitude,
        plate: t.plateNumber || 'Truck',
        driver: t.driverName || '',
        speed: t.speedKph || 0,
        isStale: !!t.isStale,
        locationName: t.locationName || '',
      }))
    );
    const js = `
      if (window.nativeUpdateTrucks) {
        window.nativeUpdateTrucks(${trucksJson});
      }
      true;
    `;
    webViewRef.current.injectJavaScript(js);
  }, [validTrucks]);

  // Dynamic User Coordinate update
  useEffect(() => {
    if (!webViewRef.current || !isLoadedRef.current) return;
    if (userCoordinate) {
      const js = `
        if (window.nativeUpdateUser) {
          window.nativeUpdateUser(${userCoordinate.latitude}, ${userCoordinate.longitude});
        }
        true;
      `;
      webViewRef.current.injectJavaScript(js);
    }
  }, [userCoordinate?.latitude, userCoordinate?.longitude]);

  // Dynamic Stops update
  useEffect(() => {
    if (!webViewRef.current || !isLoadedRef.current) return;
    const stopsJson = JSON.stringify(
      validStops.map((s) => ({
        id: s.id,
        lat: s.latitude,
        lng: s.longitude,
        title: s.title || '',
        order: s.orderNumber || 1,
        selected: !!s.selected,
      }))
    );
    const js = `
      if (window.setStops) {
        window.setStops(${stopsJson});
      }
      true;
    `;
    webViewRef.current.injectJavaScript(js);
  }, [validStops]);

  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'STOP_CLICK' && onSelectStop) {
        onSelectStop(data.id);
      }
    } catch {}
  };

  return (
    <View style={[styles.container, style]} pointerEvents={interactive ? 'auto' : 'none'}>
      <WebView
        ref={webViewRef}
        originWhitelist={['*']}
        source={{ html: htmlContent }}
        style={styles.webview}
        javaScriptEnabled
        domStorageEnabled
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        onMessage={handleMessage}
        onLoad={() => {
          isLoadedRef.current = true;
        }}
        onLoadEnd={() => {
          isLoadedRef.current = true;
        }}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: '#E5E7EB',
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});

export default OpenStreetMap;

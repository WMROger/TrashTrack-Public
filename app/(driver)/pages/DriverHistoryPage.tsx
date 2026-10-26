import { auth, db } from '@/config/firebase';
import { useTheme } from '@/hooks/useTheme';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, onSnapshot, query, where, getDocs } from 'firebase/firestore';
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export interface RouteHistoryItem {
  id: string;
  driverId: string;
  truckPlate: string;
  barangay: string;
  routeName: string;
  durationMinutes: number;
  pickupsCompleted: number;
  totalDistanceKm: number;
  fuelBurnedLiters: number;
  fuelCostPhp: number;
  status: 'completed' | 'in-progress' | 'issue';
  completedAt?: any;
  dateText: string;
  timeText: string;
  month: string;
  summaryText: string;
  stops?: string[];
}

export interface PickupHistoryItem {
  id: string;
  street: string;
  wasteCategory: string;
  month: string;
  dateText?: string;
  completionImage?: string;
  status: string;
}

export default function DriverHistoryPage() {
  const router = useRouter();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'routes' | 'pickups'>('routes');

  const [firestoreRoutes, setFirestoreRoutes] = useState<RouteHistoryItem[]>([]);
  const [pickupData, setPickupData] = useState<Record<string, PickupHistoryItem[]>>({});

  const [selectedRoute, setSelectedRoute] = useState<RouteHistoryItem | null>(null);
  const [selectedPickup, setSelectedPickup] = useState<PickupHistoryItem | null>(null);

  // 1. Listen to real-time driver route history from Firestore (direct database connection)
  useEffect(() => {
    setLoading(true);

    const unsubAuth = onAuthStateChanged(auth, (currentUser) => {
      if (!db || !currentUser) {
        setFirestoreRoutes([]);
        setLoading(false);
        return;
      }

      const routeQuery = query(
        collection(db, 'driver_route_history'),
        where('driverId', '==', currentUser.uid)
      );

      const unsubRoutes = onSnapshot(
        routeQuery,
        (snapshot) => {
          const loaded: RouteHistoryItem[] = [];
          snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const timestamp = data.completedAt || data.createdAt || new Date();
            const dateObj = timestamp?.toDate ? timestamp.toDate() : new Date(timestamp);
            const monthKey = dateObj.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
            const dateText = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            const timeText = dateObj.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

            loaded.push({
              id: docSnap.id,
              driverId: data.driverId || currentUser.uid,
              truckPlate: data.truckPlate || 'TRUCK-DANAO-01',
              barangay: data.barangay || 'Poblacion',
              routeName: data.routeName || `Brgy. ${data.barangay || 'Danao City'} Route`,
              durationMinutes: Number(data.durationMinutes) || 0,
              pickupsCompleted: Number(data.pickupsCompleted) || 0,
              totalDistanceKm: Number(data.totalDistanceKm) || 0,
              fuelBurnedLiters: Number(data.fuelBurnedLiters) || 0,
              fuelCostPhp: Number(data.fuelCostPhp) || 0,
              status: data.status || 'completed',
              completedAt: timestamp,
              dateText,
              timeText,
              month: monthKey,
              summaryText: data.summaryText || `Drove for ${data.durationMinutes || 0} mins and completed ${data.pickupsCompleted || 0} pickups in Brgy. ${data.barangay || 'Danao City'}.`,
              stops: Array.isArray(data.stops) ? data.stops : undefined,
            });
          });

          // Sort most recent first
          loaded.sort((a, b) => {
            const tA = a.completedAt?.toMillis ? a.completedAt.toMillis() : new Date(a.completedAt || 0).getTime();
            const tB = b.completedAt?.toMillis ? b.completedAt.toMillis() : new Date(b.completedAt || 0).getTime();
            return tB - tA;
          });

          setFirestoreRoutes(loaded);
          setLoading(false);
          setRefreshing(false);
        },
        (error) => {
          if (error?.code !== 'permission-denied') {
            console.warn('DriverHistoryPage: route history listener error:', error);
          }
          setLoading(false);
          setRefreshing(false);
        }
      );

      return () => unsubRoutes();
    });

    return () => unsubAuth();
  }, []);

  // 2. Listen to individual completed pickups from schedules (direct database connection)
  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (currentUser) => {
      if (!db || !currentUser) {
        setPickupData({});
        return;
      }

      // Query schedules where this driver was assigned OR completed
      const pickupQuery1 = query(
        collection(db, 'schedules'),
        where('assignedDriverId', '==', currentUser.uid)
      );

      const pickupQuery2 = query(
        collection(db, 'schedules'),
        where('completedByUid', '==', currentUser.uid)
      );

      // Query citizen reports assigned to or resolved by this driver
      const repQuery1 = query(
        collection(db, 'reports'),
        where('assignedDriverId', '==', currentUser.uid)
      );

      const repQuery2 = query(
        collection(db, 'reports'),
        where('resolvedByUid', '==', currentUser.uid)
      );

      let p1List: any[] = [];
      let p2List: any[] = [];
      let r1List: any[] = [];
      let r2List: any[] = [];

      const syncGroupedPickups = () => {
        const itemMap = new Map<string, any>();
        p1List.forEach((d) => itemMap.set(d.id, d));
        p2List.forEach((d) => itemMap.set(d.id, d));

        const repMap = new Map<string, any>();
        r1List.forEach((d) => repMap.set(d.id, d));
        r2List.forEach((d) => repMap.set(d.id, d));

        const grouped: Record<string, PickupHistoryItem[]> = {};
        const seenItemIds = new Set<string>();

        // 1. Process schedules (including embedded stops)
        itemMap.forEach((data, id) => {
          if (Array.isArray(data.stops) && data.stops.length > 0) {
            data.stops.forEach((s: any, idx: number) => {
              if (s.completed) {
                const stopId = `${id}_stop_${s.order || idx + 1}`;
                if (seenItemIds.has(stopId)) return;
                seenItemIds.add(stopId);
                if (s.reportId) seenItemIds.add(`rep_${s.reportId}`);

                const timestamp = s.completedAt || data.completedAt || data.updatedAt || new Date();
                const dateObj = timestamp?.toDate ? timestamp.toDate() : new Date(timestamp);
                const monthKey = dateObj.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

                if (!grouped[monthKey]) grouped[monthKey] = [];
                grouped[monthKey].push({
                  id: stopId,
                  street: s.name || s.street || data.street || `Stop ${idx + 1}`,
                  wasteCategory: s.type === 'citizen_report' ? 'Verified Citizen Report' : (data.wasteCategory || 'Collection Stop'),
                  month: monthKey,
                  dateText: dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
                  completionImage: s.completionImage || data.completionImage || undefined,
                  status: 'completed',
                });
              }
            });
          } else if (data.status === 'completed' || data.status === 'issue') {
            if (seenItemIds.has(id)) return;
            seenItemIds.add(id);

            const timestamp = data.completedAt || data.issueReportedAt || data.updatedAt || new Date();
            const dateObj = timestamp?.toDate ? timestamp.toDate() : new Date(timestamp);
            const monthKey = dateObj.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

            if (!grouped[monthKey]) grouped[monthKey] = [];
            grouped[monthKey].push({
              id,
              street: data.street || data.locationName || 'Scheduled Collection Point',
              wasteCategory: data.wasteCategory || 'General Waste',
              month: monthKey,
              dateText: dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
              completionImage: (data.status === 'issue' ? data.issueImage : data.completionImage) || undefined,
              status: data.status || 'completed',
            });
          }
        });

        // 2. Process citizen reports completed / resolved by this driver
        repMap.forEach((data, id) => {
          const normStatus = (data.status || '').toLowerCase().replace(/_/g, '-');
          if (normStatus === 'resolved' || normStatus === 'completed') {
            const repKey = `rep_${id}`;
            if (seenItemIds.has(repKey) || seenItemIds.has(id)) return;
            seenItemIds.add(repKey);

            const timestamp = data.collectedAt || data.resolvedAt || data.updatedAt || new Date();
            const dateObj = timestamp?.toDate ? timestamp.toDate() : new Date(timestamp);
            const monthKey = dateObj.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

            if (!grouped[monthKey]) grouped[monthKey] = [];
            grouped[monthKey].push({
              id: repKey,
              street: data.street || data.address || data.locationDescription || data.title || 'Citizen Report Location',
              wasteCategory: `Citizen Report • ${data.aiAnalysis?.wasteType || data.wasteType || 'General'}`,
              month: monthKey,
              dateText: dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
              completionImage: data.completionImage || undefined,
              status: 'completed',
            });
          }
        });

        // Sort items in each month by date descending
        Object.keys(grouped).forEach((m) => {
          grouped[m].sort((a, b) => {
            const tA = new Date(a.dateText || 0).getTime();
            const tB = new Date(b.dateText || 0).getTime();
            return tB - tA;
          });
        });

        setPickupData(grouped);
      };

      const unsubPickups1 = onSnapshot(
        pickupQuery1,
        (snapshot) => {
          p1List = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
          syncGroupedPickups();
        },
        (err) => {
          if (err?.code !== 'permission-denied') {
            console.warn('DriverHistoryPage: pickup listener 1 error:', err);
          }
        }
      );

      const unsubPickups2 = onSnapshot(
        pickupQuery2,
        (snapshot) => {
          p2List = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
          syncGroupedPickups();
        },
        (err) => {
          if (err?.code !== 'permission-denied') {
            console.warn('DriverHistoryPage: pickup listener 2 error:', err);
          }
        }
      );

      const unsubReps1 = onSnapshot(
        repQuery1,
        (snapshot) => {
          r1List = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
          syncGroupedPickups();
        },
        (err) => {
          if (err?.code !== 'permission-denied') {
            console.warn('DriverHistoryPage: report listener 1 error:', err);
          }
        }
      );

      const unsubReps2 = onSnapshot(
        repQuery2,
        (snapshot) => {
          r2List = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
          syncGroupedPickups();
        },
        (err) => {
          if (err?.code !== 'permission-denied') {
            console.warn('DriverHistoryPage: report listener 2 error:', err);
          }
        }
      );

      return () => {
        unsubPickups1();
        unsubPickups2();
        unsubReps1();
        unsubReps2();
      };
    });

    return () => unsubAuth();
  }, []);

  // Pull-to-refresh directly querying the latest database records
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    const currentUser = auth.currentUser;
    if (!db || !currentUser) {
      setRefreshing(false);
      return;
    }

    try {
      const routeSnap = await getDocs(
        query(
          collection(db, 'driver_route_history'),
          where('driverId', '==', currentUser.uid)
        )
      );
      const loaded: RouteHistoryItem[] = [];
      routeSnap.forEach((docSnap) => {
        const data = docSnap.data();
        const timestamp = data.completedAt || data.createdAt || new Date();
        const dateObj = timestamp?.toDate ? timestamp.toDate() : new Date(timestamp);
        const monthKey = dateObj.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        const dateText = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const timeText = dateObj.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

        loaded.push({
          id: docSnap.id,
          driverId: data.driverId || currentUser.uid,
          truckPlate: data.truckPlate || 'TRUCK-DANAO-01',
          barangay: data.barangay || 'Poblacion',
          routeName: data.routeName || `Brgy. ${data.barangay || 'Danao City'} Route`,
          durationMinutes: Number(data.durationMinutes) || 0,
          pickupsCompleted: Number(data.pickupsCompleted) || 0,
          totalDistanceKm: Number(data.totalDistanceKm) || 0,
          fuelBurnedLiters: Number(data.fuelBurnedLiters) || 0,
          fuelCostPhp: Number(data.fuelCostPhp) || 0,
          status: data.status || 'completed',
          completedAt: timestamp,
          dateText,
          timeText,
          month: monthKey,
          summaryText: data.summaryText || `Drove for ${data.durationMinutes || 0} mins and completed ${data.pickupsCompleted || 0} pickups.`,
          stops: Array.isArray(data.stops) ? data.stops : undefined,
        });
      });

      loaded.sort((a, b) => {
        const tA = a.completedAt?.toMillis ? a.completedAt.toMillis() : new Date(a.completedAt || 0).getTime();
        const tB = b.completedAt?.toMillis ? b.completedAt.toMillis() : new Date(b.completedAt || 0).getTime();
        return tB - tA;
      });

      setFirestoreRoutes(loaded);
    } catch (e) {
      console.warn('DriverHistoryPage: refresh error:', e);
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Database-driven collection routes (no artificial hardcoded mock baseline)
  const allRoutes = useMemo(() => {
    return firestoreRoutes;
  }, [firestoreRoutes]);

  // Aggregate driver performance metrics
  const totalDurationMins = useMemo(() => {
    return allRoutes.reduce((sum, r) => sum + (r.durationMinutes || 0), 0);
  }, [allRoutes]);

  const totalPickups = useMemo(() => {
    return allRoutes.reduce((sum, r) => sum + (r.pickupsCompleted || 0), 0);
  }, [allRoutes]);

  const totalKm = useMemo(() => {
    return allRoutes.reduce((sum, r) => sum + (r.totalDistanceKm || 0), 0);
  }, [allRoutes]);

  const totalFuel = useMemo(() => {
    return allRoutes.reduce((sum, r) => sum + (r.fuelBurnedLiters || 0), 0);
  }, [allRoutes]);

  // Group routes by month
  const routesByMonth = useMemo(() => {
    const grouped: Record<string, RouteHistoryItem[]> = {};
    allRoutes.forEach((route) => {
      const m = route.month || 'Recent';
      if (!grouped[m]) grouped[m] = [];
      grouped[m].push(route);
    });
    return grouped;
  }, [allRoutes]);

  const allPickupsFlat = useMemo(() => {
    const list: PickupHistoryItem[] = [];
    Object.values(pickupData).forEach(items => {
      items.forEach(it => list.push(it));
    });
    return list;
  }, [pickupData]);

  if (loading) {
    return (
      <View style={[styles.container, isDark && styles.containerDark, styles.center]}>
        <ActivityIndicator size="large" color={isDark ? "#86EFAC" : "#2E8B57"} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        style={[styles.container, isDark && styles.containerDark]}
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: 110 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={isDark ? "#86EFAC" : "#2E8B57"}
            colors={["#2E8B57"]}
          />
        }
      >
        <StatusBar
          barStyle={isDark ? "light-content" : "dark-content"}
          backgroundColor={isDark ? "#111827" : "#F4FBF1"}
        />

        {/* Header */}
        <View style={styles.header}>
          <Text style={[styles.title, isDark && styles.textLight]}>History</Text>
          <Text style={[styles.subtitle, isDark && styles.textMuted]}>
            Track your past garbage collection records and completed routes.
          </Text>
        </View>

        {/* Top Summary Metrics Ribbon */}
        <View style={[styles.summaryRibbon, isDark && styles.summaryRibbonDark]}>
          <View style={styles.summaryItem}>
            <View style={[styles.summaryIconCircle, { backgroundColor: '#DCFCE7' }]}>
              <MaterialIcons name="alt-route" size={16} color="#166534" />
            </View>
            <Text style={[styles.summaryNumber, isDark && styles.textLight]}>
              {allRoutes.length}
            </Text>
            <Text style={[styles.summaryLabel, isDark && styles.textMuted]}>
              Routes
            </Text>
          </View>

          <View style={styles.summaryDivider} />

          <View style={styles.summaryItem}>
            <View style={[styles.summaryIconCircle, { backgroundColor: '#EDE9FE' }]}>
              <MaterialIcons name="schedule" size={16} color="#7C3AED" />
            </View>
            <Text style={[styles.summaryNumber, isDark && styles.textLight]}>
              {Math.floor(totalDurationMins / 60)}h {totalDurationMins % 60}m
            </Text>
            <Text style={[styles.summaryLabel, isDark && styles.textMuted]}>
              Drive Time
            </Text>
          </View>

          <View style={styles.summaryDivider} />

          <View style={styles.summaryItem}>
            <View style={[styles.summaryIconCircle, { backgroundColor: '#FEF3C7' }]}>
              <MaterialIcons name="inventory-2" size={16} color="#D97706" />
            </View>
            <Text style={[styles.summaryNumber, isDark && styles.textLight]}>
              {totalPickups}
            </Text>
            <Text style={[styles.summaryLabel, isDark && styles.textMuted]}>
              Pickups
            </Text>
          </View>

          <View style={styles.summaryDivider} />

          <View style={styles.summaryItem}>
            <View style={[styles.summaryIconCircle, { backgroundColor: '#E0F2FE' }]}>
              <MaterialIcons name="straighten" size={16} color="#0284C7" />
            </View>
            <Text style={[styles.summaryNumber, isDark && styles.textLight]}>
              {totalKm.toFixed(1)}
            </Text>
            <Text style={[styles.summaryLabel, isDark && styles.textMuted]}>
              Kilometers
            </Text>
          </View>
        </View>

        {/* Tab Switcher: Collection Routes vs Individual Pickups */}
        <View style={[styles.tabBar, isDark && styles.tabBarDark]}>
          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'routes' && styles.tabBtnActive]}
            onPress={() => setActiveTab('routes')}
            activeOpacity={0.8}
          >
            <MaterialIcons
              name="alt-route"
              size={16}
              color={activeTab === 'routes' ? '#FFFFFF' : (isDark ? '#9CA3AF' : '#64748B')}
            />
            <Text
              style={[
                styles.tabBtnText,
                activeTab === 'routes' && styles.tabBtnTextActive,
                isDark && activeTab !== 'routes' && styles.textMuted,
              ]}
            >
              Collection Routes ({allRoutes.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'pickups' && styles.tabBtnActive]}
            onPress={() => setActiveTab('pickups')}
            activeOpacity={0.8}
          >
            <MaterialIcons
              name="inventory-2"
              size={16}
              color={activeTab === 'pickups' ? '#FFFFFF' : (isDark ? '#9CA3AF' : '#64748B')}
            />
            <Text
              style={[
                styles.tabBtnText,
                activeTab === 'pickups' && styles.tabBtnTextActive,
                isDark && activeTab !== 'pickups' && styles.textMuted,
              ]}
            >
              Individual Stops
            </Text>
          </TouchableOpacity>
        </View>

        {/* ── TAB 1: COLLECTION ROUTE HISTORY ── */}
        {activeTab === 'routes' ? (
          allRoutes.length > 0 ? (
            Object.entries(routesByMonth).map(([month, routes]) => (
              <View key={month} style={styles.monthSection}>
                <View style={styles.monthHeaderRow}>
                  <MaterialIcons name="calendar-today" size={14} color={isDark ? '#86EFAC' : '#2E8B57'} />
                  <Text style={[styles.monthTitle, isDark && styles.textLight]}>{month}</Text>
                </View>

                <View style={styles.cardsContainer}>
                  {routes.map((item) => (
                    <TouchableOpacity
                      key={item.id}
                      style={[styles.routeCard, isDark && styles.cardDark]}
                      onPress={() => setSelectedRoute(item)}
                      activeOpacity={0.85}
                    >
                      {/* Card Top Row: Barangay Tag & Date & Status */}
                      <View style={styles.routeCardTopRow}>
                        <View style={styles.routeBadgeRow}>
                          <View style={styles.barangayTag}>
                            <Text style={styles.barangayTagText}>Brgy. {item.barangay}</Text>
                          </View>
                          <Text style={[styles.routeDateText, isDark && styles.textMuted]}>
                            {item.dateText} · {item.timeText}
                          </Text>
                        </View>
                        <View style={styles.completedStatusPill}>
                          <MaterialIcons name="check-circle" size={12} color="#166534" />
                          <Text style={styles.completedStatusText}>Completed</Text>
                        </View>
                      </View>

                      {/* Route Title */}
                      <Text style={[styles.routeCardTitle, isDark && styles.textLight]}>
                        {item.routeName}
                      </Text>

                      {/* 🌟 HIGHLIGHT BOX: "Drove for X mins and completed Y pickups" */}
                      <View style={[styles.routeHighlightBox, isDark && styles.routeHighlightBoxDark]}>
                        <View style={styles.highlightHeaderRow}>
                          <MaterialIcons name="verified" size={16} color="#10B981" />
                          <Text style={styles.highlightHeadline}>
                            Drove for {item.durationMinutes} mins · Completed {item.pickupsCompleted} pickups
                          </Text>
                        </View>
                        <Text style={[styles.highlightDescription, isDark && styles.textMuted]}>
                          {item.summaryText}
                        </Text>
                      </View>

                      {/* Quick Telemetry Grid */}
                      <View style={styles.telemetryGrid}>
                        <View style={[styles.telemetryPill, isDark && styles.telemetryPillDark]}>
                          <MaterialIcons name="timer" size={13} color="#7C3AED" />
                          <Text style={[styles.telemetryPillText, isDark && styles.textLight]}>
                            {item.durationMinutes} mins
                          </Text>
                        </View>

                        <View style={[styles.telemetryPill, isDark && styles.telemetryPillDark]}>
                          <MaterialIcons name="inventory-2" size={13} color="#D97706" />
                          <Text style={[styles.telemetryPillText, isDark && styles.textLight]}>
                            {item.pickupsCompleted} pickups
                          </Text>
                        </View>

                        <View style={[styles.telemetryPill, isDark && styles.telemetryPillDark]}>
                          <MaterialIcons name="straighten" size={13} color="#0284C7" />
                          <Text style={[styles.telemetryPillText, isDark && styles.textLight]}>
                            {item.totalDistanceKm.toFixed(1)} km
                          </Text>
                        </View>

                        <View style={[styles.telemetryPill, isDark && styles.telemetryPillDark]}>
                          <MaterialIcons name="local-gas-station" size={13} color="#10B981" />
                          <Text style={[styles.telemetryPillText, isDark && styles.textLight]}>
                            {item.fuelBurnedLiters.toFixed(1)} L
                          </Text>
                        </View>
                      </View>

                      {/* Card Footer: Truck Plate & Action Link */}
                      <View style={styles.routeCardFooter}>
                        <View style={styles.truckPlateBadge}>
                          <MaterialIcons name="local-shipping" size={13} color={isDark ? '#86EFAC' : '#166534'} />
                          <Text style={[styles.truckPlateText, isDark && { color: '#86EFAC' }]}>
                            {item.truckPlate}
                          </Text>
                        </View>
                        <View style={styles.viewDetailsRow}>
                          <Text style={styles.viewDetailsText}>Route Details</Text>
                          <Feather name="chevron-right" size={14} color="#2E8B57" />
                        </View>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ))
          ) : (
            <View style={[styles.emptyCard, isDark && styles.emptyCardDark]}>
              <MaterialIcons name="alt-route" size={48} color={isDark ? "#4B5563" : "#9CA3AF"} />
              <Text style={[styles.emptyText, isDark && styles.textLight]}>No collection routes recorded</Text>
              <Text style={[styles.emptySubtext, isDark && styles.textMuted]}>
                Completed sector routes and collection drives will appear here with live telemetry, fuel usage, and completed stops from the municipal database.
              </Text>
              <TouchableOpacity
                style={styles.startRouteBtn}
                onPress={() => router.push('/(driver)')}
                activeOpacity={0.85}
              >
                <MaterialIcons name="navigation" size={16} color="#FFFFFF" />
                <Text style={styles.startRouteBtnText}>Go to Driver Dashboard</Text>
              </TouchableOpacity>
            </View>
          )
        ) : (
          /* ── TAB 2: INDIVIDUAL PICKUPS LIST ── */
          Object.keys(pickupData).length > 0 ? (
            Object.entries(pickupData).map(([month, items]) => (
              <View key={month} style={styles.monthSection}>
                <View style={styles.monthHeaderRow}>
                  <MaterialIcons name="calendar-today" size={14} color={isDark ? '#86EFAC' : '#2E8B57'} />
                  <Text style={[styles.monthTitle, isDark && styles.textLight]}>{month}</Text>
                </View>

                <View style={styles.cardsContainer}>
                  {items.map((item) => (
                    <TouchableOpacity
                      key={item.id}
                      style={[styles.historyCard, isDark && styles.cardDark]}
                      onPress={() => setSelectedPickup(item)}
                      activeOpacity={0.8}
                    >
                      <View style={[styles.pickupIconBox, { backgroundColor: isDark ? '#374151' : '#E5E7EB' }]}>
                        <MaterialIcons name="place" size={24} color={isDark ? '#86EFAC' : '#2E8B57'} />
                      </View>
                      <View style={styles.historyContent}>
                        <View style={styles.historyTextContainer}>
                          <Text style={[styles.historyStreet, isDark && styles.textLight]}>
                            {item.street}
                          </Text>
                          <Text style={[styles.historyType, isDark && styles.textMuted]}>
                            Waste Category: {item.wasteCategory}
                          </Text>
                        </View>
                        <View style={styles.completedStatusPill}>
                          <MaterialIcons name="check-circle" size={12} color="#166534" />
                          <Text style={styles.completedStatusText}>
                            {item.status === 'issue' ? 'Issue Reported' : 'Collected'}
                          </Text>
                        </View>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ))
          ) : (
            <View style={[styles.emptyCard, isDark && styles.emptyCardDark]}>
              <Feather name="inbox" size={44} color={isDark ? "#4B5563" : "#9CA3AF"} />
              <Text style={[styles.emptyText, isDark && styles.textLight]}>No individual stops recorded</Text>
              <Text style={[styles.emptySubtext, isDark && styles.textMuted]}>
                Completed door-to-door schedule items will appear here. Check the Collection Routes tab to view full route driving history.
              </Text>
            </View>
          )
        )}
      </ScrollView>

      {/* ── ROUTE TRIP DETAILS MODAL ── */}
      <Modal
        visible={!!selectedRoute}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedRoute(null)}
      >
        <View style={styles.modalOverlay}>
          {selectedRoute && (
            <View style={[styles.modalContent, isDark && styles.modalContentDark]}>
              {/* Modal Header */}
              <View style={styles.modalTopHeader}>
                <View style={styles.modalHeaderBadge}>
                  <MaterialIcons name="alt-route" size={18} color="#166534" />
                  <Text style={styles.modalHeaderBadgeText}>
                    Brgy. {selectedRoute.barangay}
                  </Text>
                </View>
                <View style={styles.completedStatusPill}>
                  <MaterialIcons name="check-circle" size={12} color="#166534" />
                  <Text style={styles.completedStatusText}>Verified Route</Text>
                </View>
              </View>

              <Text style={[styles.modalRouteTitle, isDark && styles.textLight]}>
                {selectedRoute.routeName}
              </Text>
              <Text style={[styles.modalDateSub, isDark && styles.textMuted]}>
                {selectedRoute.dateText} · {selectedRoute.timeText} · Assigned Truck: {selectedRoute.truckPlate}
              </Text>

              {/* Highlight Banner */}
              <View style={[styles.modalHighlightBanner, isDark && { backgroundColor: 'rgba(16, 185, 129, 0.12)' }]}>
                <MaterialIcons name="verified" size={18} color="#10B981" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalHighlightTitle}>
                    Drove for {selectedRoute.durationMinutes} mins · Completed {selectedRoute.pickupsCompleted} pickups
                  </Text>
                  <Text style={[styles.modalHighlightDesc, isDark && styles.textMuted]}>
                    {selectedRoute.summaryText}
                  </Text>
                </View>
              </View>

              {/* Detailed Metrics Grid */}
              <View style={[styles.modalMetricsGrid, isDark && styles.modalMetricsGridDark]}>
                <View style={styles.modalMetricCell}>
                  <Text style={[styles.modalMetricLabel, isDark && styles.textMuted]}>TOTAL DURATION</Text>
                  <Text style={[styles.modalMetricVal, isDark && styles.textLight]}>
                    {selectedRoute.durationMinutes} minutes
                  </Text>
                </View>

                <View style={styles.modalMetricCell}>
                  <Text style={[styles.modalMetricLabel, isDark && styles.textMuted]}>PICKUPS COMPLETED</Text>
                  <Text style={[styles.modalMetricVal, { color: '#10B981' }]}>
                    {selectedRoute.pickupsCompleted} stops (100%)
                  </Text>
                </View>

                <View style={styles.modalMetricCell}>
                  <Text style={[styles.modalMetricLabel, isDark && styles.textMuted]}>DISTANCE TRAVELED</Text>
                  <Text style={[styles.modalMetricVal, isDark && styles.textLight]}>
                    {selectedRoute.totalDistanceKm.toFixed(1)} km
                  </Text>
                </View>

                <View style={styles.modalMetricCell}>
                  <Text style={[styles.modalMetricLabel, isDark && styles.textMuted]}>DIESEL CONSUMPTION</Text>
                  <Text style={[styles.modalMetricVal, isDark && styles.textLight]}>
                    {selectedRoute.fuelBurnedLiters.toFixed(1)} L (≈ ₱{selectedRoute.fuelCostPhp})
                  </Text>
                </View>
              </View>

              {/* Waypoint Stops Checklist */}
              {selectedRoute.stops && selectedRoute.stops.length > 0 ? (
                <View style={styles.stopsChecklistWrap}>
                  <Text style={[styles.stopsChecklistTitle, isDark && styles.textLight]}>
                    Completed Stops Along Sector:
                  </Text>
                  <ScrollView style={{ maxHeight: 150 }} showsVerticalScrollIndicator={false}>
                    {selectedRoute.stops.map((stopName, idx) => (
                      <View key={idx} style={styles.stopChecklistItem}>
                        <MaterialIcons name="check-circle" size={14} color="#10B981" />
                        <Text style={[styles.stopChecklistText, isDark && styles.textMuted]} numberOfLines={1}>
                          {idx + 1}. {stopName}
                        </Text>
                      </View>
                    ))}
                  </ScrollView>
                </View>
              ) : (
                <View style={styles.stopsChecklistWrap}>
                  <Text style={[styles.stopsChecklistTitle, isDark && styles.textLight]}>
                    Sector Stops:
                  </Text>
                  <View style={styles.stopChecklistItem}>
                    <MaterialIcons name="check-circle" size={14} color="#10B981" />
                    <Text style={[styles.stopChecklistText, isDark && styles.textMuted]}>
                      {selectedRoute.pickupsCompleted} collection stops completed across Brgy. {selectedRoute.barangay}
                    </Text>
                  </View>
                </View>
              )}

              {/* Close Button */}
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={() => setSelectedRoute(null)}
                activeOpacity={0.85}
              >
                <Text style={styles.closeBtnText}>Done</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </Modal>

      {/* ── INDIVIDUAL PICKUP DETAILS MODAL ── */}
      <Modal
        visible={!!selectedPickup}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedPickup(null)}
      >
        <View style={styles.modalOverlay}>
          {selectedPickup && (
            <View style={[styles.modalContent, isDark && styles.modalContentDark]}>
              <View style={styles.modalTopHeader}>
                <View style={[styles.modalHeaderBadge, { backgroundColor: isDark ? '#374151' : '#E5E7EB' }]}>
                  <MaterialIcons name="place" size={18} color={isDark ? '#86EFAC' : '#166534'} />
                  <Text style={[styles.modalHeaderBadgeText, isDark && { color: '#86EFAC' }]}>
                    Verified Stop
                  </Text>
                </View>
                <View style={styles.completedStatusPill}>
                  <MaterialIcons name="check-circle" size={12} color="#166534" />
                  <Text style={styles.completedStatusText}>
                    {selectedPickup.status === 'issue' ? 'Issue Reported' : 'Collected'}
                  </Text>
                </View>
              </View>

              <Text style={[styles.modalRouteTitle, isDark && styles.textLight]}>
                {selectedPickup.street}
              </Text>
              <Text style={[styles.modalDateSub, isDark && styles.textMuted]}>
                Waste Category: {selectedPickup.wasteCategory} · Date: {selectedPickup.dateText || selectedPickup.month}
              </Text>

              {selectedPickup.completionImage ? (
                <View style={styles.pickupModalImageWrap}>
                  <Image
                    source={{ uri: selectedPickup.completionImage }}
                    style={styles.pickupModalImage}
                    resizeMode="cover"
                  />
                </View>
              ) : null}

              <TouchableOpacity
                style={styles.closeBtn}
                onPress={() => setSelectedPickup(null)}
                activeOpacity={0.85}
              >
                <Text style={styles.closeBtnText}>Close</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F4FBF1',
    paddingHorizontal: 16,
  },
  containerDark: {
    backgroundColor: '#111827',
  },
  center: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  textLight: {
    color: '#F9FAFB',
  },
  textMuted: {
    color: '#9CA3AF',
  },
  header: {
    marginBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    color: '#166534',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 13.5,
    color: '#4B5563',
    marginTop: 4,
    lineHeight: 18,
  },
  // Top Metrics Ribbon
  summaryRibbon: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 10,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  summaryRibbonDark: {
    backgroundColor: '#1F2937',
    borderColor: '#374151',
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
  },
  summaryIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  summaryNumber: {
    fontSize: 14,
    fontWeight: '900',
    color: '#0F172A',
  },
  summaryLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#64748B',
    marginTop: 2,
  },
  summaryDivider: {
    width: 1,
    height: 28,
    backgroundColor: '#E2E8F0',
  },
  // Tab Bar
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#E2E8F0',
    borderRadius: 12,
    padding: 4,
    marginBottom: 20,
    gap: 4,
  },
  tabBarDark: {
    backgroundColor: '#1F2937',
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    borderRadius: 9,
    gap: 6,
  },
  tabBtnActive: {
    backgroundColor: '#166534',
    shadowColor: '#166534',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  tabBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  tabBtnTextActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  // Month Section
  monthSection: {
    marginBottom: 24,
  },
  monthHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
    paddingLeft: 2,
  },
  monthTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1E293B',
    letterSpacing: 0.2,
  },
  cardsContainer: {
    gap: 14,
  },
  // Route Card
  routeCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  cardDark: {
    backgroundColor: '#1F2937',
    borderColor: '#374151',
  },
  routeCardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  routeBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  barangayTag: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  barangayTagText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#166534',
  },
  routeDateText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  completedStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  completedStatusText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#166534',
  },
  routeCardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 10,
  },
  // User Requested Highlight Box
  routeHighlightBox: {
    backgroundColor: 'rgba(240, 253, 244, 0.95)',
    borderRadius: 12,
    padding: 10,
    borderLeftWidth: 3.5,
    borderLeftColor: '#10B981',
    marginBottom: 12,
  },
  routeHighlightBoxDark: {
    backgroundColor: 'rgba(20, 83, 45, 0.4)',
    borderLeftColor: '#10B981',
  },
  highlightHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 4,
  },
  highlightHeadline: {
    fontSize: 13,
    fontWeight: '800',
    color: '#065F46',
  },
  highlightDescription: {
    fontSize: 11.5,
    color: '#374151',
    lineHeight: 16,
  },
  // Telemetry Grid
  telemetryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 12,
  },
  telemetryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  telemetryPillDark: {
    backgroundColor: '#374151',
    borderColor: '#4B5563',
  },
  telemetryPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#334155',
  },
  // Footer
  routeCardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  truckPlateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  truckPlateText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#166534',
  },
  viewDetailsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  viewDetailsText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#2E8B57',
  },
  // Individual Pickup History Card
  historyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 12,
    gap: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  pickupIconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  historyTextContainer: {
    flex: 1,
    minWidth: 0,
    paddingRight: 8,
  },
  historyStreet: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#0F172A',
  },
  historyType: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  // Empty State
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderStyle: 'dashed',
    marginTop: 20,
  },
  emptyCardDark: {
    backgroundColor: '#1F2937',
    borderColor: '#374151',
  },
  emptyText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#334155',
    marginTop: 12,
  },
  emptySubtext: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 4,
    textAlign: 'center',
    lineHeight: 18,
  },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 22,
    width: '100%',
    maxWidth: 440,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 14,
    elevation: 10,
  },
  modalContentDark: {
    backgroundColor: '#1F2937',
  },
  modalTopHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  modalHeaderBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  modalHeaderBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#166534',
  },
  modalRouteTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#0F172A',
    marginBottom: 4,
  },
  modalDateSub: {
    fontSize: 11.5,
    color: '#64748B',
    marginBottom: 14,
  },
  modalHighlightBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: 'rgba(240, 253, 244, 0.95)',
    borderRadius: 12,
    padding: 12,
    borderLeftWidth: 3.5,
    borderLeftColor: '#10B981',
    marginBottom: 16,
  },
  modalHighlightTitle: {
    fontSize: 13.5,
    fontWeight: '800',
    color: '#065F46',
    marginBottom: 2,
  },
  modalHighlightDesc: {
    fontSize: 11.5,
    color: '#374151',
    lineHeight: 16,
  },
  modalMetricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  modalMetricsGridDark: {
    backgroundColor: '#111827',
    borderColor: '#374151',
  },
  modalMetricCell: {
    width: '47%',
  },
  modalMetricLabel: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  modalMetricVal: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#0F172A',
  },
  stopsChecklistWrap: {
    marginBottom: 16,
  },
  stopsChecklistTitle: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#1E293B',
    marginBottom: 8,
  },
  stopChecklistItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 3,
  },
  stopChecklistText: {
    fontSize: 11.5,
    color: '#475569',
  },
  closeBtn: {
    backgroundColor: '#166534',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#166534',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  closeBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  startRouteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#166534',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 14,
    marginTop: 18,
  },
  startRouteBtnText: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '700',
  },
  pickupModalImageWrap: {
    width: '100%',
    height: 180,
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 16,
    backgroundColor: '#F1F5F9',
  },
  pickupModalImage: {
    width: '100%',
    height: '100%',
  },
});

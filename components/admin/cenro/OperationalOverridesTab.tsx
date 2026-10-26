import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  ActivityIndicator,
  Modal,
  TextInput,
  useWindowDimensions,
  Platform,
  Image,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { db, auth } from '../../../config/firebase';
import {
  doc,
  collection,
  onSnapshot,
  setDoc,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';
import LiveOperationsMap, { LiveMapReport, LiveMapTruck } from './LiveOperationsMap';
import {
  toggleSystemOverrideAndNotify,
  dispatchEmergencyBroadcastDirective,
  clearActiveEmergencyBroadcast,
  OverrideKey,
  SystemOverridesData,
  DEFAULT_OVERRIDES,
} from '../../../services/systemOverridesService';


interface OperationalOverridesTabProps {
  onNavigateToLogs?: () => void;
  isReadOnly?: boolean;
}

const formatLogTime = (timestamp: any) => {
  if (!timestamp) return 'Just now';
  let date: Date;
  if (timestamp?.toMillis) {
    date = new Date(timestamp.toMillis());
  } else if (timestamp?.seconds) {
    date = new Date(timestamp.seconds * 1000);
  } else if (timestamp instanceof Date) {
    date = timestamp;
  } else if (typeof timestamp === 'string' || typeof timestamp === 'number') {
    date = new Date(timestamp);
  } else {
    return 'Recently';
  }
  if (isNaN(date.getTime())) return 'Recently';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
};

export default function OperationalOverridesTab({
  onNavigateToLogs,
  isReadOnly = false,
}: OperationalOverridesTabProps) {
  const { width } = useWindowDimensions();
  const isMobile = width < 960;
  const isSmallMobile = width < 640;

  const [settings, setSettings] = useState<SystemOverridesData>(DEFAULT_OVERRIDES);


  const [isUpdating, setIsUpdating] = useState<string | null>(null);
  const [liveTrucks, setLiveTrucks] = useState<LiveMapTruck[]>([]);
  const [openReports, setOpenReports] = useState<(LiveMapReport & { barangay: string })[]>([]);
  const [recentLogs, setRecentLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [focusedTarget, setFocusedTarget] = useState<{
    latitude: number;
    longitude: number;
    id?: string;
    label?: string;
  } | null>(null);
  const [selectedHazardReport, setSelectedHazardReport] = useState<any | null>(null);

  // Emergency Broadcast Modal
  const [broadcastModalVisible, setBroadcastModalVisible] = useState(false);
  const [broadcastSubject, setBroadcastSubject] = useState('');
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [broadcastPriority, setBroadcastPriority] = useState<'high' | 'urgent'>('urgent');
  const [isBroadcasting, setIsBroadcasting] = useState(false);

  // Emergency Fleet Pause Confirmation Modal
  const [pauseModalVisible, setPauseModalVisible] = useState(false);
  const [pauseReason, setPauseReason] = useState('Severe Flash Flooding & Flood Basin Overflow');

  const QUICK_PAUSE_REASONS = [
    'Severe Flash Flooding & River Basin Overflow',
    'PAGASA Heavy Rainfall / Calamity Warning',
    'Landslide Hazard & Roadway Obstruction',
    'Critical Roadway Rehabilitation & Bridge Repair',
  ];

  useEffect(() => {
    if (!db) {
      setLoading(false);
      return;
    }

    // 1. Listen to system settings overrides in real-time
    const docRef = doc(db, 'system_settings', 'overrides');
    const unsubDoc = onSnapshot(
      docRef,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setSettings({
            forcePauseCollection: Boolean(data.forcePauseCollection),
            activateBackupFleet: data.activateBackupFleet !== undefined ? Boolean(data.activateBackupFleet) : true,
            severeWeatherProtocol: Boolean(data.severeWeatherProtocol),
            surgePriorityMode: Boolean(data.surgePriorityMode),
            updatedAt: data.updatedAt,
            updatedBy: data.updatedBy,
            activeEmergencyBroadcast: data.activeEmergencyBroadcast || null,
          });

        }
        setLoading(false);
      },
      (error) => {
        console.error('Error listening to system_settings:', error);
        setLoading(false);
      }
    );

    // 2. Listen to recent override activity logs
    const logsRef = collection(db, 'system_settings', 'overrides', 'activity_logs');
    const unsubLogs = onSnapshot(
      logsRef,
      (snap) => {
        const fetched = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));
        fetched.sort((a: any, b: any) => {
          const timeA = a.timestamp?.toMillis ? a.timestamp.toMillis() : (a.timestamp instanceof Date ? a.timestamp.getTime() : 0);
          const timeB = b.timestamp?.toMillis ? b.timestamp.toMillis() : (b.timestamp instanceof Date ? b.timestamp.getTime() : 0);
          return timeB - timeA;
        });
        setRecentLogs(fetched.slice(0, 8));
      },
      (error) => console.error('Error fetching override activity logs:', error)
    );

    // 3. Listen to Trucks & Live Locations
    let truckPlatesMap: Record<string, string> = {};
    const unsubTrucks = onSnapshot(collection(db, 'trucks'), (snap) => {
      const map: Record<string, string> = {};
      snap.forEach((d) => {
        const data = d.data();
        if (data.plateNumber) {
          map[d.id] = data.plateNumber;
        }
      });
      truckPlatesMap = map;
      setLiveTrucks((prev) =>
        prev.map((t) => ({
          ...t,
          label: truckPlatesMap[t.id] || truckPlatesMap[t.label] || t.label,
        }))
      );
    });

    const unsubLocations = onSnapshot(
      collection(db, 'truck_locations'),
      (snapshot) => {
        setLiveTrucks(
          snapshot.docs
            .map((item) => {
              const data = item.data();
              const rawTruckId = String(data.truckId || item.id);
              const plate = truckPlatesMap[rawTruckId] || truckPlatesMap[item.id] || rawTruckId;
              return {
                id: item.id,
                latitude: Number(data.lat ?? data.latitude),
                longitude: Number(data.lng ?? data.longitude),
                label: plate,
                active: String(data.status || '').toLowerCase() === 'active',
              };
            })
            .filter((item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude))
        );
      },
      (error) => console.error('Error fetching live truck locations:', error)
    );

    // 4. Listen to Reports
    const unsubReports = onSnapshot(
      collection(db, 'reports'),
      (snapshot) => {
        setOpenReports(
          snapshot.docs
            .map((item) => {
              const data = item.data();
              const location = data.location || {};
              return {
                id: item.id,
                latitude: Number(location.lat ?? location.latitude ?? data.lat ?? data.latitude),
                longitude: Number(location.lng ?? location.longitude ?? data.lng ?? data.longitude),
                label: String(data.title || data.barangay || 'Open report'),
                barangay: String(data.barangay || 'Unspecified'),
                status: String(data.status || 'pending'),
                street: String(data.street || ''),
                description: String(data.description || ''),
                imageURL: data.imageURL || null,
                createdAt: data.createdAt,
              };
            })
            .filter(
              (item) =>
                !['resolved', 'completed', 'done', 'rejected'].includes(item.status.toLowerCase()) &&
                Number.isFinite(item.latitude) &&
                Number.isFinite(item.longitude)
            )
        );
      },
      (error) => console.error('Error fetching report locations:', error)
    );

    return () => {
      unsubDoc();
      unsubLogs();
      unsubTrucks();
      unsubLocations();
      unsubReports();
    };
  }, []);

  const riskHotspots = useMemo(() => {
    const counts = openReports.reduce<Record<string, number>>((result, report) => {
      result[report.barangay] = (result[report.barangay] || 0) + 1;
      return result;
    }, {});
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);
  }, [openReports]);

  // Total active contingency protocols
  const activeContingenciesCount = useMemo(() => {
    let count = 0;
    if (settings.forcePauseCollection) count++;
    if (settings.severeWeatherProtocol) count++;
    if (settings.surgePriorityMode) count++;
    if (settings.activateBackupFleet) count++;
    return count;
  }, [settings]);

  // Handle Interactive System Override Switch Toggle
  const handleToggleSetting = async (
    key: OverrideKey,
    newValue: boolean,
    customReason?: string
  ) => {
    if (!db) return;
    setIsUpdating(key);
    const actorEmail = auth.currentUser?.email || 'cenro@trashtrack.gov.ph';
    const actorUid = auth.currentUser?.uid || 'cenro-admin';
    const actorName = auth.currentUser?.displayName || 'CENRO Administrator';

    try {
      await toggleSystemOverrideAndNotify({
        key,
        newValue,
        actorEmail,
        actorUid,
        actorName,
        reason: customReason,
      });

      if (key === 'forcePauseCollection') {
        if (newValue) {
          Alert.alert(
            '🚨 Fleet Collection Paused',
            `Municipal dispatch halted across Danao City. All active drivers have received instant in-cab standby directives.\nReason: ${customReason || 'Emergency weather / calamity contingency pause'}`
          );
        } else {
          Alert.alert(
            '✅ Operations Resumed',
            'CENRO has lifted the operational halt. All drivers have been notified to safely resume scheduled waste collection routes.'
          );
        }
      } else if (key === 'severeWeatherProtocol') {
        if (newValue) {
          Alert.alert(
            '⚠️ Weather Protocol Activated',
            'Severe weather & flood hazard protocol engaged. Drivers instructed to bypass riverbanks and low flood basins, utilizing elevated arterial detours.'
          );
        } else {
          Alert.alert(
            '🌤️ Weather Protocol Deactivated',
            'Severe weather protocol deactivated. Drivers notified that standard route adherence has been restored.'
          );
        }
      }
    } catch (err: any) {
      console.error('Error updating system override:', err);
      Alert.alert('Update Failed', err?.message || 'Could not update system override.');
    } finally {
      setIsUpdating(null);
    }
  };

  // Handle Emergency Broadcast
  const [isClearingBroadcast, setIsClearingBroadcast] = useState(false);

  const handleSendBroadcast = async () => {
    const message = broadcastMessage.trim();
    const subject = broadcastSubject.trim() || (broadcastPriority === 'urgent' ? '🚨 EMERGENCY DISPATCH DIRECTIVE' : '⚡ PRIORITY WEATHER ADVISORY');

    if (!message) {
      Alert.alert('Validation Error', 'Please enter an emergency broadcast message.');
      return;
    }

    if (!db) return;
    setIsBroadcasting(true);

    try {
      const actorEmail = auth.currentUser?.email || 'cenro@trashtrack.gov.ph';
      const actorUid = auth.currentUser?.uid || 'cenro-admin';
      const actorName = auth.currentUser?.displayName || 'CENRO Administrator';

      await dispatchEmergencyBroadcastDirective({
        subject,
        message,
        priority: broadcastPriority,
        actorEmail,
        actorUid,
        actorName,
      });

      setBroadcastModalVisible(false);
      setBroadcastSubject('');
      setBroadcastMessage('');
      Alert.alert('Broadcast Dispatched', 'Emergency directive successfully transmitted and announced to all active trucks, driver cockpits, and environmental coordinators.');
    } catch (err: any) {
      console.error('Error sending broadcast:', err);
      Alert.alert('Broadcast Failed', err?.message || 'Could not dispatch emergency broadcast.');
    } finally {
      setIsBroadcasting(false);
    }
  };

  const handleClearBroadcast = async () => {
    const actorEmail = auth.currentUser?.email || 'cenro@trashtrack.gov.ph';
    const actorUid = auth.currentUser?.uid || 'cenro-admin';
    setIsClearingBroadcast(true);
    try {
      await clearActiveEmergencyBroadcast(actorEmail, actorUid);
      Alert.alert('Broadcast Dismissed', 'Active emergency broadcast directive has been dismissed.');
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Could not clear active broadcast.');
    } finally {
      setIsClearingBroadcast(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#1B4D3E" />
        <Text style={{ marginTop: 14, color: '#64748B', fontSize: 13, fontWeight: '700' }}>
          Synchronizing municipal override protocols...
        </Text>
      </View>
    );
  }

  const onlineTrucksCount = liveTrucks.filter((t) => t.active).length;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer} showsVerticalScrollIndicator={false}>
      {/* 1. TOP HEADER ROW */}
      <View style={[styles.headerRow, isMobile && { flexDirection: 'column', gap: 16, alignItems: 'stretch' }]}>
        <View style={styles.headerTextContainer}>
          <View style={styles.headerBadgeRow}>
            <View style={[styles.systemStatusPill, settings.forcePauseCollection ? styles.statusPillAlert : styles.statusPillNormal]}>
              <View style={[styles.statusDot, settings.forcePauseCollection ? styles.statusDotAlert : styles.statusDotNormal]} />
              <Text style={[styles.systemStatusText, settings.forcePauseCollection ? styles.statusTextAlert : styles.statusTextNormal]}>
                {settings.forcePauseCollection ? 'DISPATCH PAUSED' : `${activeContingenciesCount} PROTOCOLS CONFIGURED`}
              </Text>
            </View>
            <Text style={styles.syncIndicator}>• Real-Time Cloud Sync</Text>
          </View>
          <Text style={styles.headerTitle}>Operational Overrides & Fleet Contingency</Text>
          <Text style={styles.headerDesc}>
            Execute emergency response overrides, pause municipal truck runs, mobilize standby units, and reroute fleet paths around flood and logistical hazards.
          </Text>
        </View>

        <View style={[styles.headerActions, isMobile && { justifyContent: 'flex-start' }]}>
          <TouchableOpacity
            style={styles.dangerBtn}
            onPress={() => setBroadcastModalVisible(true)}
            activeOpacity={0.85}
          >
            <MaterialIcons name="campaign" size={20} color="#FFFFFF" />
            <Text style={styles.dangerBtnText}>Emergency Broadcast</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ACTIVE EMERGENCY BROADCAST BANNER (if active) */}
      {settings.activeEmergencyBroadcast && settings.activeEmergencyBroadcast.active ? (
        <View style={styles.activeBroadcastCard}>
          <View style={styles.activeBroadcastLeft}>
            <View style={styles.activeBroadcastIconWrap}>
              <MaterialIcons name="campaign" size={28} color="#DC2626" />
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                <View style={[styles.activeBroadcastPriorityTag, settings.activeEmergencyBroadcast.priority === 'urgent' ? { backgroundColor: '#FEE2E2', borderColor: '#FCA5A5' } : { backgroundColor: '#FEF3C7', borderColor: '#FDE68A' }]}>
                  <Text style={[styles.activeBroadcastPriorityText, settings.activeEmergencyBroadcast.priority === 'urgent' ? { color: '#B91C1C' } : { color: '#B45309' }]}>
                    {settings.activeEmergencyBroadcast.priority === 'urgent' ? '🚨 URGENT CALAMITY ALERT' : '⚡ HIGH PRIORITY ADVISORY'}
                  </Text>
                </View>
                <Text style={{ fontSize: 11, color: '#64748B', fontWeight: '600' }}>
                  • Transmitted to Driver Cockpits & Coordinators
                </Text>
              </View>
              <Text style={styles.activeBroadcastTitle}>
                {settings.activeEmergencyBroadcast.subject}
              </Text>
              <Text style={styles.activeBroadcastDesc}>
                {settings.activeEmergencyBroadcast.message}
              </Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.clearBroadcastBtn}
            onPress={handleClearBroadcast}
            disabled={isClearingBroadcast}
            activeOpacity={0.8}
          >
            {isClearingBroadcast ? (
              <ActivityIndicator size="small" color="#991B1B" />
            ) : (
              <>
                <MaterialIcons name="close" size={16} color="#991B1B" />
                <Text style={styles.clearBroadcastBtnText}>Clear Broadcast</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      ) : null}

      {/* 2. EXECUTIVE STATUS PILL RIBBON */}
      <View style={[styles.ribbonRow, isSmallMobile && { flexDirection: 'column' }]}>
        {/* Metric 1: Collection Status */}
        <View style={[styles.ribbonCard, settings.forcePauseCollection && styles.ribbonCardAlert]}>
          <View style={styles.ribbonCardTop}>
            <Text style={styles.ribbonLabel}>COLLECTION STATE</Text>
            <MaterialIcons
              name={settings.forcePauseCollection ? 'pause-circle-filled' : 'check-circle'}
              size={18}
              color={settings.forcePauseCollection ? '#DC2626' : '#059669'}
            />
          </View>
          <Text style={[styles.ribbonValue, { color: settings.forcePauseCollection ? '#DC2626' : '#059669' }]}>
            {settings.forcePauseCollection ? 'FORCE-PAUSED' : 'NORMAL DISPATCH'}
          </Text>
          <Text style={styles.ribbonSub} numberOfLines={1}>
            {settings.forcePauseCollection ? 'Trucks halted at depot' : 'Routes actively executed'}
          </Text>
        </View>

        {/* Metric 2: Reserve Capacity */}
        <View style={[styles.ribbonCard, settings.activateBackupFleet && styles.ribbonCardActive]}>
          <View style={styles.ribbonCardTop}>
            <Text style={styles.ribbonLabel}>BACKUP FLEET</Text>
            <MaterialIcons
              name="local-shipping"
              size={18}
              color={settings.activateBackupFleet ? '#15803D' : '#64748B'}
            />
          </View>
          <Text style={[styles.ribbonValue, { color: settings.activateBackupFleet ? '#15803D' : '#475569' }]}>
            {settings.activateBackupFleet ? 'MOBILIZED' : 'STANDBY'}
          </Text>
          <Text style={styles.ribbonSub} numberOfLines={1}>
            {settings.activateBackupFleet ? 'Reserve compactor shifts active' : 'Auxiliary units parked'}
          </Text>
        </View>

        {/* Metric 3: Weather Routing */}
        <View style={[styles.ribbonCard, settings.severeWeatherProtocol && styles.ribbonCardInfo]}>
          <View style={styles.ribbonCardTop}>
            <Text style={styles.ribbonLabel}>WEATHER ROUTING</Text>
            <MaterialIcons
              name="thunderstorm"
              size={18}
              color={settings.severeWeatherProtocol ? '#0284C7' : '#64748B'}
            />
          </View>
          <Text style={[styles.ribbonValue, { color: settings.severeWeatherProtocol ? '#0284C7' : '#475569' }]}>
            {settings.severeWeatherProtocol ? 'REROUTE ACTIVE' : 'STANDARD CORRIDORS'}
          </Text>
          <Text style={styles.ribbonSub} numberOfLines={1}>
            {settings.severeWeatherProtocol ? 'Bypassing flood basins' : 'Standard route adherence'}
          </Text>
        </View>

        {/* Metric 4: Surge Priority Mode */}
        <View style={[styles.ribbonCard, settings.surgePriorityMode && styles.ribbonCardWarning]}>
          <View style={styles.ribbonCardTop}>
            <Text style={styles.ribbonLabel}>SURGE DISPOSAL</Text>
            <MaterialIcons
              name="speed"
              size={18}
              color={settings.surgePriorityMode ? '#D97706' : '#64748B'}
            />
          </View>
          <Text style={[styles.ribbonValue, { color: settings.surgePriorityMode ? '#D97706' : '#475569' }]}>
            {settings.surgePriorityMode ? 'PRIORITY FAST-TRACK' : 'BALANCED TRIAGE'}
          </Text>
          <Text style={styles.ribbonSub} numberOfLines={1}>
            {settings.surgePriorityMode ? 'Expedited MRF bay unloading' : 'Normal turnaround queue'}
          </Text>
        </View>
      </View>

      {/* 3. MAIN INTERACTIVE CONTENT GRID (2 COLUMNS) */}
      <View style={[styles.mainGrid, isMobile && { flexDirection: 'column' }]}>
        
        {/* LEFT COLUMN: SYSTEM OVERRIDE PROTOCOL CONTROLS */}
        <View style={[styles.leftColumn, isMobile && { flex: undefined, width: '100%' }]}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionTitle}>System Override Protocols</Text>
              <Text style={styles.sectionDesc}>Direct executive switches to alter municipal dispatch rules in real-time</Text>
            </View>
            <View style={styles.persistenceTag}>
              <MaterialIcons name="bolt" size={13} color="#059669" />
              <Text style={styles.persistenceText}>INSTANT PERSISTENCE</Text>
            </View>
          </View>

          <View style={styles.protocolCardsList}>
            {/* Control 1: Force Pause Collection */}
            <View style={[styles.protocolCard, settings.forcePauseCollection && styles.protocolCardAlert]}>
              <View style={styles.protocolCardHeader}>
                <View style={[styles.protocolIconWrap, { backgroundColor: settings.forcePauseCollection ? '#FEE2E2' : '#F1F5F9' }]}>
                  <MaterialIcons
                    name="pause-circle-filled"
                    size={24}
                    color={settings.forcePauseCollection ? '#DC2626' : '#475569'}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.protocolTitleRow}>
                    <Text style={styles.protocolName}>Fleet Collection Pause</Text>
                    <View style={[styles.protocolBadge, settings.forcePauseCollection ? styles.badgeAlert : styles.badgeNormal]}>
                      <Text style={[styles.protocolBadgeText, settings.forcePauseCollection ? styles.badgeTextAlert : styles.badgeTextNormal]}>
                        {settings.forcePauseCollection ? 'DISPATCH PAUSED' : 'NORMAL DISPATCH'}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.protocolCategory}>CRITICAL FLEET CONTINGENCY</Text>
                </View>
              </View>

              <Text style={styles.protocolDescription}>
                Immediately halt all municipal truck runs across Danao City. Drivers receive instant in-cab standby directives and park safely until collection is authorized to resume.
              </Text>

              <View style={styles.protocolFooter}>
                <View style={styles.impactPreview}>
                  <Text style={styles.impactLabel}>CURRENT IMPLICATION</Text>
                  <Text style={[styles.impactValue, settings.forcePauseCollection && { color: '#DC2626', fontWeight: '700' }]}>
                    {settings.forcePauseCollection ? 'Drivers standby at depot / safe zones' : 'Trucks actively executing scheduled routes'}
                  </Text>
                </View>

                {isUpdating === 'forcePauseCollection' ? (
                  <ActivityIndicator size="small" color="#DC2626" />
                ) : (
                  <Switch
                    value={settings.forcePauseCollection}
                    onValueChange={(val) => {
                      if (val) {
                        setPauseModalVisible(true);
                      } else {
                        handleToggleSetting('forcePauseCollection', false);
                      }
                    }}
                    trackColor={{ false: '#E2E8F0', true: '#DC2626' }}
                    thumbColor="#FFFFFF"
                  />
                )}
              </View>
            </View>

            {/* Control 2: Activate Backup Fleet */}
            <View style={[styles.protocolCard, settings.activateBackupFleet && styles.protocolCardActive]}>
              <View style={styles.protocolCardHeader}>
                <View style={[styles.protocolIconWrap, { backgroundColor: settings.activateBackupFleet ? '#DCFCE7' : '#F1F5F9' }]}>
                  <MaterialIcons
                    name="local-shipping"
                    size={24}
                    color={settings.activateBackupFleet ? '#15803D' : '#475569'}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.protocolTitleRow}>
                    <Text style={styles.protocolName}>Backup Fleet Mobilization</Text>
                    <View style={[styles.protocolBadge, settings.activateBackupFleet ? styles.badgeActive : styles.badgeStandby]}>
                      <Text style={[styles.protocolBadgeText, settings.activateBackupFleet ? styles.badgeTextActive : styles.badgeTextStandby]}>
                        {settings.activateBackupFleet ? 'MOBILIZED' : 'STANDBY'}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.protocolCategory}>RESERVE LOGISTICAL CAPACITY</Text>
                </View>
              </View>

              <Text style={styles.protocolDescription}>
                Mobilize secondary compactor units and standby driver shifts from the motor pool to handle heavy waste build-up or cover for trucks undergoing maintenance.
              </Text>

              <View style={styles.protocolFooter}>
                <View style={styles.impactPreview}>
                  <Text style={styles.impactLabel}>CURRENT IMPLICATION</Text>
                  <Text style={[styles.impactValue, settings.activateBackupFleet && { color: '#15803D', fontWeight: '700' }]}>
                    {settings.activateBackupFleet ? 'Reserve compactor shifts mobilized on arterial corridors' : 'Standby units held in depot'}
                  </Text>
                </View>

                {isUpdating === 'activateBackupFleet' ? (
                  <ActivityIndicator size="small" color="#15803D" />
                ) : (
                  <Switch
                    value={settings.activateBackupFleet}
                    onValueChange={(val) => handleToggleSetting('activateBackupFleet', val)}
                    trackColor={{ false: '#E2E8F0', true: '#1B4D3E' }}
                    thumbColor="#FFFFFF"
                  />
                )}
              </View>
            </View>

            {/* Control 3: Severe Weather Routing */}
            <View style={[styles.protocolCard, settings.severeWeatherProtocol && styles.protocolCardInfo]}>
              <View style={styles.protocolCardHeader}>
                <View style={[styles.protocolIconWrap, { backgroundColor: settings.severeWeatherProtocol ? '#E0F2FE' : '#F1F5F9' }]}>
                  <MaterialIcons
                    name="thunderstorm"
                    size={24}
                    color={settings.severeWeatherProtocol ? '#0284C7' : '#475569'}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.protocolTitleRow}>
                    <Text style={styles.protocolName}>Severe Weather Emergency Routing</Text>
                    <View style={[styles.protocolBadge, settings.severeWeatherProtocol ? styles.badgeInfo : styles.badgeStandby]}>
                      <Text style={[styles.protocolBadgeText, settings.severeWeatherProtocol ? styles.badgeTextInfo : styles.badgeTextStandby]}>
                        {settings.severeWeatherProtocol ? 'REROUTE ACTIVE' : 'STANDARD ROUTING'}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.protocolCategory}>CALAMITY & FLOOD HAZARD DEFENSE</Text>
                </View>
              </View>

              <Text style={styles.protocolDescription}>
                Instructs drivers to bypass low-elevation flood basins, riverbanks, and landslide-prone collector streets during PAGASA rainfall warnings, re-routing through elevated arterial roads.
              </Text>

              <View style={styles.protocolFooter}>
                <View style={styles.impactPreview}>
                  <Text style={styles.impactLabel}>CURRENT IMPLICATION</Text>
                  <Text style={[styles.impactValue, settings.severeWeatherProtocol && { color: '#0284C7', fontWeight: '700' }]}>
                    {settings.severeWeatherProtocol ? 'Flood corridor bypass engaged for all active units' : 'Standard route adherence active'}
                  </Text>
                </View>

                {isUpdating === 'severeWeatherProtocol' ? (
                  <ActivityIndicator size="small" color="#0284C7" />
                ) : (
                  <Switch
                    value={Boolean(settings.severeWeatherProtocol)}
                    onValueChange={(val) => handleToggleSetting('severeWeatherProtocol', val)}
                    trackColor={{ false: '#E2E8F0', true: '#0284C7' }}
                    thumbColor="#FFFFFF"
                  />
                )}
              </View>
            </View>

            {/* Control 4: Overload Surge Priority */}
            <View style={[styles.protocolCard, settings.surgePriorityMode && styles.protocolCardWarning]}>
              <View style={styles.protocolCardHeader}>
                <View style={[styles.protocolIconWrap, { backgroundColor: settings.surgePriorityMode ? '#FEF3C7' : '#F1F5F9' }]}>
                  <MaterialIcons
                    name="speed"
                    size={24}
                    color={settings.surgePriorityMode ? '#D97706' : '#475569'}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.protocolTitleRow}>
                    <Text style={styles.protocolName}>Overload Surge Priority Mode</Text>
                    <View style={[styles.protocolBadge, settings.surgePriorityMode ? styles.badgeWarning : styles.badgeStandby]}>
                      <Text style={[styles.protocolBadgeText, settings.surgePriorityMode ? styles.badgeTextWarning : styles.badgeTextStandby]}>
                        {settings.surgePriorityMode ? 'SURGE PRIORITY' : 'BALANCED'}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.protocolCategory}>TRANSFER LOGISTICS OPTIMIZATION</Text>
                </View>
              </View>

              <Text style={styles.protocolDescription}>
                Prioritizes high-tonnage barangay hubs (Public Market, Commercial Port, Poblacion) and authorizes express turnaround dumping at the MRF to rapidly clear overflow bottlenecks.
              </Text>

              <View style={styles.protocolFooter}>
                <View style={styles.impactPreview}>
                  <Text style={styles.impactLabel}>CURRENT IMPLICATION</Text>
                  <Text style={[styles.impactValue, settings.surgePriorityMode && { color: '#D97706', fontWeight: '700' }]}>
                    {settings.surgePriorityMode ? 'Fast-track MRF dumping prioritized for high-volume sectors' : 'Standard sequential collection schedule'}
                  </Text>
                </View>

                {isUpdating === 'surgePriorityMode' ? (
                  <ActivityIndicator size="small" color="#D97706" />
                ) : (
                  <Switch
                    value={Boolean(settings.surgePriorityMode)}
                    onValueChange={(val) => handleToggleSetting('surgePriorityMode', val)}
                    trackColor={{ false: '#E2E8F0', true: '#D97706' }}
                    thumbColor="#FFFFFF"
                  />
                )}
              </View>
            </View>
          </View>
        </View>

        {/* RIGHT COLUMN: LIVE GIS TELEMETRY + RISK HOTSPOTS */}
        <View style={[styles.rightColumn, isMobile && { flex: undefined, width: '100%' }]}>
          
          {/* Card 1: Interactive Live Telemetry Map */}
          <View style={styles.mapCard}>
            <View style={styles.mapCardHeader}>
              <View>
                <Text style={styles.mapCardTitle}>Live Impact & Telemetry View</Text>
                <Text style={styles.mapCardSubtitle}>Danao City live GPS fleet telemetry and citizen hazard reports</Text>
              </View>

              <View style={styles.mapHeaderBadges}>
                <View style={styles.liveStreamBadge}>
                  <View style={styles.pulsingDot} />
                  <Text style={styles.liveStreamText}>
                    {onlineTrucksCount} ONLINE
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.hazardBadge, { cursor: 'pointer', flexDirection: 'row', alignItems: 'center', gap: 4 }]}
                  onPress={() => {
                    if (openReports.length > 0) {
                      setFocusedTarget({
                        latitude: openReports[0].latitude,
                        longitude: openReports[0].longitude,
                        id: openReports[0].id,
                        label: openReports[0].label,
                      });
                    }
                  }}
                  activeOpacity={0.8}
                >
                  <MaterialIcons name="my-location" size={12} color="#DC2626" />
                  <Text style={styles.hazardBadgeText}>
                    {openReports.length} HAZARDS (LOCATE)
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Real Interactive Map Component with Target Focusing */}
            <LiveOperationsMap
              trucks={liveTrucks}
              reports={openReports}
              height={390}
              focusedTarget={focusedTarget}
              onSelectReport={(rep) => setSelectedHazardReport(rep)}
            />
          </View>

          {/* Card 2: Barangay Risk Hotspots & Report Clusters (Placed neatly below the map) */}
          <View style={styles.hotspotsCard}>
            <View style={styles.hotspotsHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <MaterialIcons name="warning-amber" size={18} color="#D97706" />
                <Text style={styles.hotspotsTitle}>Barangay Risk Hotspots & Report Clusters</Text>
              </View>
              <View style={styles.hotspotCountPill}>
                <Text style={styles.hotspotCountText}>
                  {openReports.length} Active Geotags
                </Text>
              </View>
            </View>

            {riskHotspots.length === 0 ? (
              <View style={styles.emptyHotspots}>
                <MaterialIcons name="verified" size={28} color="#10B981" />
                <Text style={styles.emptyHotspotsTitle}>All barangay sectors clear</Text>
                <Text style={styles.emptyHotspotsSubtitle}>No open hazard reports or severe collection disruptions detected.</Text>
              </View>
            ) : (
              <View style={styles.hotspotsList}>
                {riskHotspots.map(([barangay, count], index) => {
                  const isHighRisk = count >= 4;
                  const isElevated = count >= 2;
                  const matchingReport = openReports.find(
                    (r) => r.barangay.toLowerCase() === barangay.toLowerCase()
                  );
                  return (
                    <TouchableOpacity
                      key={barangay}
                      style={[styles.hotspotRow, { cursor: 'pointer' }]}
                      onPress={() => {
                        if (matchingReport) {
                          setFocusedTarget({
                            latitude: matchingReport.latitude,
                            longitude: matchingReport.longitude,
                            id: matchingReport.id,
                            label: matchingReport.label,
                          });
                        }
                      }}
                      activeOpacity={0.75}
                    >
                      <View style={styles.hotspotLeft}>
                        <View style={[styles.hotspotRankBox, isHighRisk && styles.rankBoxHigh]}>
                          <Text style={[styles.hotspotRankText, isHighRisk && { color: '#DC2626' }]}>
                            #{index + 1}
                          </Text>
                        </View>
                        <View>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Text style={styles.hotspotBrgyName}>Brgy. {barangay}</Text>
                            <MaterialIcons name="open-in-new" size={12} color="#0284C7" />
                          </View>
                          <Text style={styles.hotspotReportDesc}>
                            {count} unresolved geotagged report{count === 1 ? '' : 's'} • Tap to locate
                          </Text>
                        </View>
                      </View>

                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <View style={[styles.riskSeverityTag, isHighRisk ? styles.severityHigh : (isElevated ? styles.severityElevated : styles.severityMonitor)]}>
                          <Text style={[styles.riskSeverityText, isHighRisk ? styles.severityTextHigh : (isElevated ? styles.severityTextElevated : styles.severityTextMonitor)]}>
                            {isHighRisk ? 'HIGH RISK' : (isElevated ? 'ELEVATED' : 'MONITOR')}
                          </Text>
                        </View>
                        <View style={styles.locateActionBtn}>
                          <MaterialIcons name="my-location" size={12} color="#0284C7" />
                          <Text style={styles.locateActionText}>Map</Text>
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                })}

                {/* Individual Hazard Items List */}
                {openReports.length > 0 && (
                  <View style={styles.individualHazardsWrap}>
                    <Text style={styles.individualHazardsHeader}>
                      INDIVIDUAL INCIDENT LOCATIONS ({openReports.length})
                    </Text>
                    {openReports.map((report, rIndex) => (
                      <TouchableOpacity
                        key={report.id || rIndex}
                        style={styles.individualHazardRow}
                        onPress={() => {
                          setFocusedTarget({
                            latitude: report.latitude,
                            longitude: report.longitude,
                            id: report.id,
                            label: report.label,
                          });
                          setSelectedHazardReport(report);
                        }}
                        activeOpacity={0.75}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                          <View style={styles.hazardPinDot} />
                          <View style={{ flex: 1 }}>
                            <Text style={styles.hazardItemTitle} numberOfLines={1}>
                              {report.label || `Report #${rIndex + 1}`}
                            </Text>
                            <Text style={styles.hazardItemSub}>
                              Brgy. {report.barangay} • GPS: {report.latitude.toFixed(4)}, {report.longitude.toFixed(4)}
                            </Text>
                          </View>
                        </View>
                        <View style={styles.flyToBtn}>
                          <MaterialIcons name="near-me" size={12} color="#FFFFFF" />
                          <Text style={styles.flyToBtnText}>Fly to Pin</Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            )}
          </View>
        </View>
      </View>

      {/* 4. FULL-WIDTH ENTERPRISE AUDIT & RECENT OVERRIDE ACTIVITY */}
      <View style={styles.auditSection}>
        <View style={styles.auditHeader}>
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <MaterialIcons name="history-edu" size={20} color="#1B4D3E" />
              <Text style={styles.auditTitle}>Recent Override Activity & Audit Trail</Text>
            </View>
            <Text style={styles.auditSubtitle}>
              Immutable real-time audit ledger recording manual supervisor overrides and fleet directives.
            </Text>
          </View>

          {onNavigateToLogs && (
            <TouchableOpacity style={styles.viewAllLogsBtn} onPress={onNavigateToLogs} activeOpacity={0.8}>
              <Text style={styles.viewAllLogsBtnText}>View Complete Audit Logs</Text>
              <MaterialIcons name="arrow-forward" size={16} color="#1B4D3E" />
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.auditTableCard}>
          <View style={styles.tableHeaderRow}>
            <Text style={[styles.th, { flex: 1.4 }]}>TIMESTAMP</Text>
            <Text style={[styles.th, { flex: 2 }]}>INITIATOR / OPERATOR</Text>
            <Text style={[styles.th, { flex: 2.2 }]}>DIRECTIVE ACTION</Text>
            <Text style={[styles.th, { flex: 1.4, textAlign: 'center' }]}>CONFIDENCE</Text>
            <Text style={[styles.th, { flex: 2.5 }]}>OPERATIONAL DETAILS</Text>
          </View>

          {recentLogs.length === 0 ? (
            <View style={styles.emptyTableBox}>
              <MaterialIcons name="assignment-turned-in" size={32} color="#CBD5E1" />
              <Text style={styles.emptyTableTitle}>No recent override activity recorded</Text>
              <Text style={styles.emptyTableSubtitle}>Any modifications to municipal collection directives will be securely logged here.</Text>
            </View>
          ) : (
            recentLogs.map((row, idx) => (
              <View key={row.id || idx} style={[styles.tableBodyRow, idx % 2 === 1 && styles.tableBodyRowAlt]}>
                <View style={{ flex: 1.4, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <MaterialIcons name="schedule" size={14} color="#94A3B8" />
                  <Text style={styles.timeCell}>{formatLogTime(row.timestamp)}</Text>
                </View>

                <View style={{ flex: 2, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={styles.userAvatarBox}>
                    <MaterialIcons name="person" size={14} color="#1B4D3E" />
                  </View>
                  <Text style={styles.actorCell} numberOfLines={1}>
                    {row.source || 'CENRO Supervisor'}
                  </Text>
                </View>

                <View style={{ flex: 2.2 }}>
                  <Text style={styles.actionCell} numberOfLines={1}>
                    {row.action}
                  </Text>
                </View>

                <View style={{ flex: 1.4, alignItems: 'center' }}>
                  <View style={styles.confidencePill}>
                    <Text style={styles.confidencePillText}>
                      {row.confidence || 'Manual Override'}
                    </Text>
                  </View>
                </View>

                <View style={{ flex: 2.5 }}>
                  <Text style={styles.detailsCell} numberOfLines={1}>
                    {row.details || 'Executive contingency protocol updated.'}
                  </Text>
                </View>
              </View>
            ))
          )}
        </View>
      </View>

      {/* 5. EMERGENCY BROADCAST MODAL */}
      <Modal visible={broadcastModalVisible} transparent={true} animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, isSmallMobile && { width: '95%', padding: 18 }]}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={styles.modalIconBox}>
                  <MaterialIcons name="campaign" size={26} color="#EF4444" />
                </View>
                <View>
                  <Text style={styles.modalTitle}>Dispatch Emergency Broadcast</Text>
                  <Text style={styles.modalSubtitle}>Transmit high-priority alert to all municipal units and coordinators</Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => setBroadcastModalVisible(false)} style={styles.modalCloseBtn}>
                <MaterialIcons name="close" size={22} color="#64748B" />
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>PRIORITY LEVEL</Text>
                <View style={styles.prioritySelector}>
                  <TouchableOpacity
                    style={[styles.priorityPill, broadcastPriority === 'high' && styles.priorityPillHighActive]}
                    onPress={() => setBroadcastPriority('high')}
                  >
                    <MaterialIcons name="bolt" size={16} color={broadcastPriority === 'high' ? '#B45309' : '#64748B'} />
                    <Text style={[styles.priorityPillText, broadcastPriority === 'high' && { color: '#B45309', fontWeight: '800' }]}>
                      HIGH PRIORITY ADVISORY
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.priorityPill, broadcastPriority === 'urgent' && styles.priorityPillUrgentActive]}
                    onPress={() => setBroadcastPriority('urgent')}
                  >
                    <MaterialIcons name="warning" size={16} color={broadcastPriority === 'urgent' ? '#DC2626' : '#64748B'} />
                    <Text style={[styles.priorityPillText, broadcastPriority === 'urgent' && { color: '#DC2626', fontWeight: '800' }]}>
                      URGENT CALAMITY ALERT
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>DIRECTIVE SUBJECT</Text>
                <TextInput
                  style={styles.formInput}
                  placeholder="e.g. FLASH FLOOD: Reroute Trucks away from Poblacion Riverbank"
                  placeholderTextColor="#94A3B8"
                  value={broadcastSubject}
                  onChangeText={setBroadcastSubject}
                />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>DIRECTIVE MESSAGE</Text>
                <TextInput
                  style={[styles.formInput, { height: 110, textAlignVertical: 'top' }]}
                  placeholder="Enter explicit operational commands for field drivers and environmental coordinators..."
                  placeholderTextColor="#94A3B8"
                  multiline={true}
                  numberOfLines={4}
                  value={broadcastMessage}
                  onChangeText={setBroadcastMessage}
                />
              </View>
            </View>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setBroadcastModalVisible(false)}
                disabled={isBroadcasting}
              >
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalSendBtn}
                onPress={handleSendBroadcast}
                disabled={isBroadcasting}
                activeOpacity={0.85}
              >
                {isBroadcasting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <MaterialIcons name="send" size={16} color="#FFFFFF" />
                    <Text style={styles.modalSendBtnText}>Transmit Directive</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 5B. EMERGENCY FLEET PAUSE DIRECTIVE MODAL */}
      <Modal
        visible={pauseModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setPauseModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, isSmallMobile && { width: '95%', padding: 18 }]}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={[styles.modalIconBox, { backgroundColor: '#FEE2E2' }]}>
                  <MaterialIcons name="pause-circle-filled" size={26} color="#DC2626" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalTitle}>Halt Municipal Fleet Collection</Text>
                  <Text style={styles.modalSubtitle}>
                    Emergency Dispatch Override • Instant Driver Standby Directive
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                onPress={() => setPauseModalVisible(false)}
                style={styles.modalCloseBtn}
              >
                <MaterialIcons name="close" size={22} color="#64748B" />
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              <View style={[styles.hazardModalBanner, { backgroundColor: '#FEF2F2', borderColor: '#FECACA' }]}>
                <MaterialIcons name="warning" size={20} color="#DC2626" />
                <Text style={{ flex: 1, fontSize: 12, color: '#991B1B', fontWeight: '600', lineHeight: 18 }}>
                  Activating this directive will immediately halt all municipal truck runs across Danao City. Active drivers will receive an instant in-cab standby modal on their navigation screens to safely pull over until authorized to resume.
                </Text>
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>EMERGENCY JUSTIFICATION / HAZARD</Text>
                <View style={{ gap: 8 }}>
                  {QUICK_PAUSE_REASONS.map((reason) => (
                    <TouchableOpacity
                      key={reason}
                      style={[
                        styles.quickReasonPill,
                        pauseReason === reason && styles.quickReasonPillActive,
                      ]}
                      onPress={() => setPauseReason(reason)}
                      activeOpacity={0.8}
                    >
                      <MaterialIcons
                        name={pauseReason === reason ? 'radio-button-checked' : 'radio-button-unchecked'}
                        size={16}
                        color={pauseReason === reason ? '#DC2626' : '#64748B'}
                      />
                      <Text
                        style={[
                          styles.quickReasonText,
                          pauseReason === reason && styles.quickReasonTextActive,
                        ]}
                      >
                        {reason}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>CUSTOM DIRECTIVE NOTES (OPTIONAL)</Text>
                <TextInput
                  style={styles.formInput}
                  placeholder="Specific instructions for drivers (e.g. Standby at Danao Central Depot)..."
                  placeholderTextColor="#94A3B8"
                  value={pauseReason}
                  onChangeText={setPauseReason}
                />
              </View>
            </View>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setPauseModalVisible(false)}
                disabled={isUpdating === 'forcePauseCollection'}
              >
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalSendBtn, { backgroundColor: '#DC2626' }]}
                onPress={async () => {
                  const reasonToSend = pauseReason.trim() || 'Severe Flooding / Calamity Hazard';
                  setPauseModalVisible(false);
                  await handleToggleSetting('forcePauseCollection', true, reasonToSend);
                }}
                disabled={isUpdating === 'forcePauseCollection'}
                activeOpacity={0.85}
              >
                {isUpdating === 'forcePauseCollection' ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <MaterialIcons name="pause-circle-filled" size={16} color="#FFFFFF" />
                    <Text style={styles.modalSendBtnText}>Halt Fleet & Alert Drivers</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 6. HAZARD REPORT DETAIL & CO-LOCATION INSPECTOR MODAL */}
      <Modal visible={Boolean(selectedHazardReport)} transparent={true} animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, isSmallMobile && { width: '95%', padding: 18 }]}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={[styles.modalIconBox, { backgroundColor: '#FEE2E2' }]}>
                  <MaterialIcons name="warning" size={24} color="#DC2626" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalTitle}>Incident Hazard Details</Text>
                  <Text style={styles.modalSubtitle}>
                    Geotagged citizen report • Brgy. {selectedHazardReport?.barangay}
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                onPress={() => setSelectedHazardReport(null)}
                style={styles.modalCloseBtn}
              >
                <MaterialIcons name="close" size={22} color="#64748B" />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
              <View style={{ gap: 14 }}>
                {/* Image if present */}
                {selectedHazardReport?.imageURL ? (
                  <View style={styles.hazardModalImgWrap}>
                    <Image
                      source={{ uri: selectedHazardReport.imageURL }}
                      style={styles.hazardModalImg}
                      resizeMode="cover"
                    />
                  </View>
                ) : null}

                {/* Status & Barangay Banner */}
                <View style={styles.hazardModalBanner}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.hazardModalLabel}>INCIDENT LOCATION</Text>
                    <Text style={styles.hazardModalLocation}>
                      Brgy. {selectedHazardReport?.barangay}
                      {selectedHazardReport?.street ? ` · ${selectedHazardReport.street}` : ''}
                    </Text>
                  </View>
                  <View style={styles.hazardModalStatusPill}>
                    <Text style={styles.hazardModalStatusText}>
                      {(selectedHazardReport?.status || 'PENDING').toUpperCase()}
                    </Text>
                  </View>
                </View>

                {/* Description */}
                <View style={styles.hazardModalSection}>
                  <Text style={styles.hazardModalLabel}>REPORTED HAZARD TITLE</Text>
                  <Text style={styles.hazardModalTitleText}>
                    {selectedHazardReport?.label || 'Citizen Waste / Road Hazard'}
                  </Text>
                  {selectedHazardReport?.description ? (
                    <Text style={styles.hazardModalDescText}>
                      {selectedHazardReport.description}
                    </Text>
                  ) : (
                    <Text style={[styles.hazardModalDescText, { fontStyle: 'italic', color: '#94A3B8' }]}>
                      No additional description provided by citizen.
                    </Text>
                  )}
                </View>

                {/* Co-located / Multiple Reports Switcher */}
                {openReports.filter((r) => r.barangay?.toLowerCase() === selectedHazardReport?.barangay?.toLowerCase()).length > 1 && (
                  <View style={styles.coLocatedWrap}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                      <MaterialIcons name="layers" size={16} color="#DC2626" />
                      <Text style={styles.coLocatedTitle}>
                        {openReports.filter((r) => r.barangay?.toLowerCase() === selectedHazardReport?.barangay?.toLowerCase()).length} Reports co-located in this area:
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      {openReports
                        .filter((r) => r.barangay?.toLowerCase() === selectedHazardReport?.barangay?.toLowerCase())
                        .map((siblingReport, sIndex) => {
                          const isCurrent = siblingReport.id === selectedHazardReport?.id;
                          return (
                            <TouchableOpacity
                              key={siblingReport.id || sIndex}
                              style={[styles.coLocatedPill, isCurrent && styles.coLocatedPillActive]}
                              onPress={() => setSelectedHazardReport(siblingReport)}
                            >
                              <Text style={[styles.coLocatedPillText, isCurrent && styles.coLocatedPillTextActive]}>
                                #{sIndex + 1} {siblingReport.label?.slice(0, 16) || `Report ${sIndex + 1}`}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                    </View>
                  </View>
                )}

                {/* GPS Coordinates */}
                <View style={styles.hazardGpsRow}>
                  <MaterialIcons name="my-location" size={14} color="#64748B" />
                  <Text style={styles.hazardGpsText}>
                    Exact GPS: {selectedHazardReport?.latitude?.toFixed(5)}, {selectedHazardReport?.longitude?.toFixed(5)}
                  </Text>
                </View>
              </View>
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setSelectedHazardReport(null)}
              >
                <Text style={styles.modalCancelBtnText}>Close</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalSendBtn, { backgroundColor: '#1B4D3E' }]}
                onPress={() => {
                  if (selectedHazardReport) {
                    setFocusedTarget({
                      latitude: selectedHazardReport.latitude,
                      longitude: selectedHazardReport.longitude,
                      id: selectedHazardReport.id,
                      label: selectedHazardReport.label,
                    });
                    setSelectedHazardReport(null);
                  }
                }}
                activeOpacity={0.85}
              >
                <MaterialIcons name="near-me" size={16} color="#FFFFFF" />
                <Text style={styles.modalSendBtnText}>Fly to on Map</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  contentContainer: {
    padding: 24,
    paddingBottom: 60,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  headerTextContainer: {
    flex: 1,
    paddingRight: 24,
  },
  headerBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  systemStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  statusPillNormal: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  statusPillAlert: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusDotNormal: {
    backgroundColor: '#10B981',
  },
  statusDotAlert: {
    backgroundColor: '#EF4444',
  },
  systemStatusText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  statusTextNormal: {
    color: '#047857',
  },
  statusTextAlert: {
    color: '#B91C1C',
  },
  syncIndicator: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.6,
  },
  headerDesc: {
    fontSize: 13,
    color: '#64748B',
    lineHeight: 20,
    maxWidth: 720,
    marginTop: 6,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dangerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#EF4444',
    paddingVertical: 11,
    paddingHorizontal: 18,
    borderRadius: 9,
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  dangerBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 13,
    letterSpacing: 0.2,
  },
  ribbonRow: {
    flexDirection: 'row',
    gap: 14,
    marginBottom: 24,
  },
  ribbonCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
    elevation: 1,
  },
  ribbonCardActive: {
    borderColor: '#BBF7D0',
    backgroundColor: '#F0FDF4',
  },
  ribbonCardAlert: {
    borderColor: '#FECACA',
    backgroundColor: '#FEF2F2',
  },
  ribbonCardInfo: {
    borderColor: '#BAE6FD',
    backgroundColor: '#F0F9FF',
  },
  ribbonCardWarning: {
    borderColor: '#FDE68A',
    backgroundColor: '#FFFBEB',
  },
  ribbonCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  ribbonLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.5,
  },
  ribbonValue: {
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 3,
  },
  ribbonSub: {
    fontSize: 11,
    color: '#64748B',
  },
  mainGrid: {
    flexDirection: 'row',
    gap: 24,
    marginBottom: 28,
  },
  leftColumn: {
    flex: 1.15,
  },
  rightColumn: {
    flex: 1,
    gap: 18,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.3,
  },
  sectionDesc: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  persistenceTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  persistenceText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#047857',
    letterSpacing: 0.4,
  },
  protocolCardsList: {
    gap: 14,
  },
  protocolCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  protocolCardActive: {
    borderColor: '#86EFAC',
    backgroundColor: '#FAFCF8',
  },
  protocolCardAlert: {
    borderColor: '#FCA5A5',
    backgroundColor: '#FFF9F9',
  },
  protocolCardInfo: {
    borderColor: '#7DD3FC',
    backgroundColor: '#F7FCFF',
  },
  protocolCardWarning: {
    borderColor: '#FCD34D',
    backgroundColor: '#FFFEF8',
  },
  protocolCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 10,
  },
  protocolIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  protocolTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  protocolName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  protocolCategory: {
    fontSize: 9,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.5,
    marginTop: 2,
  },
  protocolBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 5,
  },
  protocolBadgeText: {
    fontSize: 9,
    fontWeight: '800',
  },
  badgeNormal: {
    backgroundColor: '#F1F5F9',
  },
  badgeTextNormal: {
    fontSize: 9,
    fontWeight: '800',
    color: '#475569',
  },
  badgeAlert: {
    backgroundColor: '#FEE2E2',
  },
  badgeTextAlert: {
    fontSize: 9,
    fontWeight: '800',
    color: '#DC2626',
  },
  badgeActive: {
    backgroundColor: '#DCFCE7',
  },
  badgeTextActive: {
    fontSize: 9,
    fontWeight: '800',
    color: '#15803D',
  },
  badgeStandby: {
    backgroundColor: '#F1F5F9',
  },
  badgeTextStandby: {
    fontSize: 9,
    fontWeight: '800',
    color: '#64748B',
  },
  badgeInfo: {
    backgroundColor: '#E0F2FE',
  },
  badgeTextInfo: {
    fontSize: 9,
    fontWeight: '800',
    color: '#0284C7',
  },
  badgeWarning: {
    backgroundColor: '#FEF3C7',
  },
  badgeTextWarning: {
    fontSize: 9,
    fontWeight: '800',
    color: '#D97706',
  },
  protocolDescription: {
    fontSize: 12,
    color: '#475569',
    lineHeight: 18,
    marginBottom: 14,
  },
  protocolFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  impactPreview: {
    flex: 1,
    paddingRight: 16,
  },
  impactLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  impactValue: {
    fontSize: 12,
    color: '#334155',
    fontWeight: '500',
  },
  mapCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  mapCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  mapCardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  mapCardSubtitle: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  mapHeaderBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  liveStreamBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  pulsingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  liveStreamText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#047857',
  },
  hazardBadge: {
    backgroundColor: '#FEF2F2',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  hazardBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#DC2626',
  },
  hotspotsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  hotspotsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  hotspotsTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  hotspotCountPill: {
    backgroundColor: '#FFFBEB',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  hotspotCountText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#B45309',
  },
  emptyHotspots: {
    paddingVertical: 20,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  emptyHotspotsTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
    marginTop: 4,
  },
  emptyHotspotsSubtitle: {
    fontSize: 11,
    color: '#64748B',
    textAlign: 'center',
  },
  hotspotsList: {
    gap: 8,
  },
  hotspotRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 9,
    paddingHorizontal: 12,
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  hotspotLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  hotspotRankBox: {
    width: 26,
    height: 26,
    borderRadius: 6,
    backgroundColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankBoxHigh: {
    backgroundColor: '#FEE2E2',
  },
  hotspotRankText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#475569',
  },
  hotspotBrgyName: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
  },
  hotspotReportDesc: {
    fontSize: 10,
    color: '#64748B',
    marginTop: 1,
  },
  riskSeverityTag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  riskSeverityText: {
    fontSize: 9,
    fontWeight: '800',
  },
  severityHigh: {
    backgroundColor: '#FEE2E2',
  },
  severityTextHigh: {
    fontSize: 9,
    fontWeight: '800',
    color: '#DC2626',
  },
  severityElevated: {
    backgroundColor: '#FEF3C7',
  },
  severityTextElevated: {
    fontSize: 9,
    fontWeight: '800',
    color: '#D97706',
  },
  severityMonitor: {
    backgroundColor: '#ECFDF5',
  },
  severityTextMonitor: {
    fontSize: 9,
    fontWeight: '800',
    color: '#059669',
  },
  locateActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  locateActionText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#0284C7',
  },
  individualHazardsWrap: {
    marginTop: 8,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    gap: 6,
  },
  individualHazardsHeader: {
    fontSize: 9,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  individualHazardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    cursor: 'pointer',
  },
  hazardPinDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#DC2626',
  },
  hazardItemTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0F172A',
  },
  hazardItemSub: {
    fontSize: 9,
    color: '#64748B',
    marginTop: 1,
  },
  flyToBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#0284C7',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  flyToBtnText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  auditSection: {
    marginTop: 4,
  },
  auditHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 12,
  },
  auditTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.3,
  },
  auditSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  viewAllLogsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: '#E8F2E9',
  },
  viewAllLogsBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1B4D3E',
  },
  auditTableCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  tableHeaderRow: {
    flexDirection: 'row',
    paddingVertical: 11,
    paddingHorizontal: 16,
    backgroundColor: '#F8FAFC',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  th: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.5,
  },
  tableBodyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  tableBodyRowAlt: {
    backgroundColor: '#FAFBFD',
  },
  timeCell: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  userAvatarBox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#E8F2E9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actorCell: {
    fontSize: 12,
    color: '#1E293B',
    fontWeight: '600',
  },
  actionCell: {
    fontSize: 12,
    color: '#0F172A',
    fontWeight: '700',
  },
  confidencePill: {
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  confidencePillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#047857',
  },
  detailsCell: {
    fontSize: 11,
    color: '#64748B',
  },
  emptyTableBox: {
    paddingVertical: 36,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyTableTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#475569',
  },
  emptyTableSubtitle: {
    fontSize: 12,
    color: '#94A3B8',
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContent: {
    width: 540,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
    elevation: 24,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalIconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
  },
  modalSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  modalCloseBtn: {
    padding: 6,
  },
  modalBody: {
    gap: 16,
  },
  formGroup: {
    gap: 6,
  },
  formLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#475569',
    letterSpacing: 0.6,
  },
  formInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 13,
    color: '#0F172A',
  },
  prioritySelector: {
    flexDirection: 'row',
    gap: 10,
  },
  priorityPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
  },
  priorityPillHighActive: {
    backgroundColor: '#FEF3C7',
    borderColor: '#FDE68A',
  },
  priorityPillUrgentActive: {
    backgroundColor: '#FEE2E2',
    borderColor: '#FECACA',
  },
  priorityPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
  },
  modalFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 22,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  modalCancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  modalCancelBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  modalSendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#EF4444',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  modalSendBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  hazardModalImgWrap: {
    width: '100%',
    height: 180,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#F1F5F9',
  },
  hazardModalImg: {
    width: '100%',
    height: '100%',
  },
  hazardModalBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  hazardModalLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  hazardModalLocation: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  hazardModalStatusPill: {
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  hazardModalStatusText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#DC2626',
  },
  hazardModalSection: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  hazardModalTitleText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 6,
  },
  hazardModalDescText: {
    fontSize: 12,
    color: '#475569',
    lineHeight: 18,
  },
  coLocatedWrap: {
    backgroundColor: '#FFF5F5',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#FED7D7',
  },
  coLocatedTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#C53030',
  },
  coLocatedPill: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  coLocatedPillActive: {
    backgroundColor: '#DC2626',
    borderColor: '#DC2626',
  },
  coLocatedPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  coLocatedPillTextActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  hazardGpsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 4,
  },
  hazardGpsText: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  quickReasonPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
  },
  quickReasonPillActive: {
    borderColor: '#FCA5A5',
    backgroundColor: '#FEF2F2',
  },
  quickReasonText: {
    fontSize: 12,
    color: '#475569',
    fontWeight: '600',
    flex: 1,
  },
  quickReasonTextActive: {
    color: '#991B1B',
    fontWeight: '700',
  },
  activeBroadcastCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FEF2F2',
    borderWidth: 1.5,
    borderColor: '#F87171',
    borderRadius: 14,
    padding: 16,
    gap: 16,
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 3,
  },
  activeBroadcastLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    flex: 1,
  },
  activeBroadcastIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#FCA5A5',
  },
  activeBroadcastPriorityTag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  activeBroadcastPriorityText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  activeBroadcastTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#991B1B',
    marginBottom: 4,
  },
  activeBroadcastDesc: {
    fontSize: 13,
    color: '#7F1D1D',
    lineHeight: 18,
  },
  clearBroadcastBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    alignSelf: 'flex-start',
  },
  clearBroadcastBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#991B1B',
  },
});


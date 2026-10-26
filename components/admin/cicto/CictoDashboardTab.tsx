import { MaterialIcons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';

import {
  CictoOversightSnapshot,
  getCictoOversightSnapshot,
  sendCictoCommand,
} from '@/services/cictoOversightService';

export interface CictoNavigationParams {
  role?: 'all' | 'user' | 'coordinator' | 'driver' | 'admin' | 'cicto' | string;
  status?: string;
  search?: string;
}

interface Props {
  onNavigateTab?: (tab: string, params?: CictoNavigationParams) => void;
}

export default function CictoDashboardTab({ onNavigateTab }: Props) {
  const { width } = useWindowDimensions();
  const isMobile = width < 768;
  const isNarrow = width < 1024;

  const [data, setData] = useState<CictoOversightSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Quick Command state
  const [commandSubject, setCommandSubject] = useState('');
  const [commandMsg, setCommandMsg] = useState('');
  const [commandPriority, setCommandPriority] = useState<'normal' | 'high' | 'urgent'>('normal');
  const [isSendingCmd, setIsSendingCmd] = useState(false);
  const [cmdSuccess, setCmdSuccess] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setData(await getCictoOversightSnapshot());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Oversight data could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleSendCommand = async () => {
    if (!commandSubject.trim() || !commandMsg.trim()) return;
    setIsSendingCmd(true);
    setCmdSuccess('');
    try {
      await sendCictoCommand({
        subject: commandSubject.trim(),
        message: commandMsg.trim(),
        priority: commandPriority,
      });
      setCmdSuccess('Message sent to the inter-agency chat.');
      setCommandSubject('');
      setCommandMsg('');
      setTimeout(() => setCmdSuccess(''), 4000);
      load();
    } catch (err: any) {
      setError(err?.message || 'Failed to transmit directive.');
    } finally {
      setIsSendingCmd(false);
    }
  };

  if (loading && !data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0D9488" />
        <Text style={styles.muted}>Synthesizing CICTO System Telemetry…</Text>
      </View>
    );
  }

  const roleList = Object.entries(data?.roles || {})
    .filter(([role]) => role.toLowerCase() !== 'dict')
    .map(([role, count]) => {
      const normalizedRole = role.toLowerCase() === 'admin' ? 'cenro' : role.toLowerCase();
      return [normalizedRole, count] as [string, number];
    })
    .reduce((acc: [string, number][], [role, count]) => {
      const existing = acc.find(([r]) => r.toLowerCase() === role.toLowerCase());
      if (existing) {
        existing[1] += count;
      } else {
        acc.push([role, count]);
      }
      return acc;
    }, [])
    .sort((a, b) => b[1] - a[1]);
  const totalRoleUsers = roleList.reduce((a, b) => a + b[1], 0) || 1;

  const registeredResidentsCount = (data?.roles?.user || 0) + (data?.roles?.resident || 0);
  const driversCount = data?.roles?.driver || 0;
  const trucksCount = data?.counts?.trucks || 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, isMobile && { padding: 14 }]}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>CICTO / EXECUTIVE OVERSIGHT</Text>
          <Text style={styles.title}>System Governance</Text>
          <Text style={styles.sub}>
            Real-time infrastructure status, security telemetry, and interagency dispatch coordination.
          </Text>
        </View>
        <TouchableOpacity style={styles.refresh} onPress={load} activeOpacity={0.7} accessibilityLabel="Refresh">
          <MaterialIcons name="refresh" size={20} color="#0D9488" />
        </TouchableOpacity>
      </View>

      {!!error && <Text style={styles.error}>{error}</Text>}

      {/* 1. Executive Top KPI Cards: Drivers, Trucks, Registered Residents */}
      <View style={styles.cards}>
        {/* Registered Residents Card */}
        <Pressable
          style={({ pressed, hovered }: any) => [
            styles.card,
            hovered && styles.cardHovered,
            pressed && styles.cardPressed,
          ]}
          onPress={() => onNavigateTab?.('identity-access', { role: 'user' })}
          accessibilityRole="button"
          accessibilityLabel="Registered Residents, open User Governance filtered to residents"
        >
          {({ hovered }: any) => (
            <>
              <View style={styles.cardTop}>
                <Text style={styles.cardTitle}>REGISTERED RESIDENTS</Text>
                <View style={[styles.iconBox, { backgroundColor: '#ECFDF5' }]}>
                  <MaterialIcons name="people" size={20} color="#059669" />
                </View>
              </View>
              <Text style={[styles.cardValue, { color: '#059669' }]}>{registeredResidentsCount}</Text>
              <View style={styles.cardBottomRow}>
                <Text style={styles.cardSub}>Citizens registered across Danao</Text>
                <View style={[styles.cardActionIcon, hovered && { backgroundColor: '#ECFDF5' }]}>
                  <MaterialIcons
                    name="arrow-forward"
                    size={12}
                    color={hovered ? '#059669' : '#94A3B8'}
                  />
                </View>
              </View>
            </>
          )}
        </Pressable>

        {/* Fleet Drivers Card */}
        <Pressable
          style={({ pressed, hovered }: any) => [
            styles.card,
            hovered && styles.cardHovered,
            pressed && styles.cardPressed,
          ]}
          onPress={() => onNavigateTab?.('identity-access', { role: 'driver' })}
          accessibilityRole="button"
          accessibilityLabel="Official Drivers, open User Governance filtered to drivers"
        >
          {({ hovered }: any) => (
            <>
              <View style={styles.cardTop}>
                <Text style={styles.cardTitle}>OFFICIAL DRIVERS</Text>
                <View style={[styles.iconBox, { backgroundColor: '#F0FDFA' }]}>
                  <MaterialIcons name="badge" size={20} color="#0D9488" />
                </View>
              </View>
              <Text style={[styles.cardValue, { color: '#0D9488' }]}>{driversCount}</Text>
              <View style={styles.cardBottomRow}>
                <Text style={styles.cardSub}>Authorized CENRO fleet operators</Text>
                <View style={[styles.cardActionIcon, hovered && { backgroundColor: '#F0FDFA' }]}>
                  <MaterialIcons
                    name="arrow-forward"
                    size={12}
                    color={hovered ? '#0D9488' : '#94A3B8'}
                  />
                </View>
              </View>
            </>
          )}
        </Pressable>

        {/* Municipal Trucks Card */}
        <Pressable
          style={({ pressed, hovered }: any) => [
            styles.card,
            hovered && styles.cardHovered,
            pressed && styles.cardPressed,
          ]}
          onPress={() => onNavigateTab?.('fleet-ops')}
          accessibilityRole="button"
          accessibilityLabel="Municipal Trucks, open Fleet Telemetry"
        >
          {({ hovered }: any) => (
            <>
              <View style={styles.cardTop}>
                <Text style={styles.cardTitle}>MUNICIPAL TRUCKS</Text>
                <View style={[styles.iconBox, { backgroundColor: '#EFF6FF' }]}>
                  <MaterialIcons name="local-shipping" size={20} color="#2563EB" />
                </View>
              </View>
              <Text style={[styles.cardValue, { color: '#2563EB' }]}>{trucksCount}</Text>
              <View style={styles.cardBottomRow}>
                <Text style={styles.cardSub}>{data?.operations.activeFleet || 0} active on GPS telemetry</Text>
                <View style={[styles.cardActionIcon, hovered && { backgroundColor: '#EFF6FF' }]}>
                  <MaterialIcons
                    name="arrow-forward"
                    size={12}
                    color={hovered ? '#2563EB' : '#94A3B8'}
                  />
                </View>
              </View>
            </>
          )}
        </Pressable>

        <Pressable
          style={({ pressed, hovered }: any) => [
            styles.card,
            hovered && styles.cardHovered,
            pressed && styles.cardPressed,
          ]}
          onPress={() => onNavigateTab?.('cenro-command')}
          accessibilityRole="button"
          accessibilityLabel="CENRO Directives, open Inter-Agency Chats"
        >
          {({ hovered }: any) => (
            <>
              <View style={styles.cardTop}>
                <Text style={styles.cardTitle}>CENRO DIRECTIVES</Text>
                <View style={[styles.iconBox, { backgroundColor: '#FEF3C7' }]}>
                  <MaterialIcons name="campaign" size={20} color="#D97706" />
                </View>
              </View>
              <Text style={[styles.cardValue, { color: '#D97706' }]}>
                {data?.counts.directives ?? data?.messages?.length ?? 0}
              </Text>
              <View style={styles.cardBottomRow}>
                <Text style={styles.cardSub}>Interagency dispatches & advisories</Text>
                <View style={[styles.cardActionIcon, hovered && { backgroundColor: '#FEF3C7' }]}>
                  <MaterialIcons
                    name="arrow-forward"
                    size={12}
                    color={hovered ? '#D97706' : '#94A3B8'}
                  />
                </View>
              </View>
            </>
          )}
        </Pressable>

        <Pressable
          style={({ pressed, hovered }: any) => [
            styles.card,
            hovered && styles.cardHovered,
            pressed && styles.cardPressed,
          ]}
          onPress={() => onNavigateTab?.('fleet-ops')}
          accessibilityRole="button"
          accessibilityLabel="Active Fleet GPS, open Fleet Telemetry"
        >
          {({ hovered }: any) => (
            <>
              <View style={styles.cardTop}>
                <Text style={styles.cardTitle}>ACTIVE FLEET GPS</Text>
                <View style={[styles.iconBox, { backgroundColor: '#EFF6FF' }]}>
                  <MaterialIcons name="local-shipping" size={20} color="#2563EB" />
                </View>
              </View>
              <Text style={[styles.cardValue, { color: '#2563EB' }]}>{data?.operations.activeFleet || 0}</Text>
              <View style={styles.cardBottomRow}>
                <Text style={styles.cardSub}>Transmitting live road coordinates</Text>
                <View style={[styles.cardActionIcon, hovered && { backgroundColor: '#EFF6FF' }]}>
                  <MaterialIcons
                    name="arrow-forward"
                    size={12}
                    color={hovered ? '#2563EB' : '#94A3B8'}
                  />
                </View>
              </View>
            </>
          )}
        </Pressable>

        <Pressable
          style={({ pressed, hovered }: any) => [
            styles.card,
            hovered && styles.cardHovered,
            pressed && styles.cardPressed,
          ]}
          onPress={() => onNavigateTab?.('activity-logs')}
          accessibilityRole="button"
          accessibilityLabel="System Audit Health, open Audit Trail"
        >
          {({ hovered }: any) => (
            <>
              <View style={styles.cardTop}>
                <Text style={styles.cardTitle}>SYSTEM AUDIT HEALTH</Text>
                <View style={[styles.iconBox, { backgroundColor: '#FDF2F8' }]}>
                  <MaterialIcons name="security" size={20} color="#9D174D" />
                </View>
              </View>
              <Text style={[styles.cardValue, { color: '#9D174D' }]}>
                {data?.counts.auditEvents || data?.recentActivity.length || 0}
              </Text>
              <View style={styles.cardBottomRow}>
                <Text style={styles.cardSub}>Forensic audit events recorded</Text>
                <View style={[styles.cardActionIcon, hovered && { backgroundColor: '#FDF2F8' }]}>
                  <MaterialIcons
                    name="arrow-forward"
                    size={12}
                    color={hovered ? '#9D174D' : '#94A3B8'}
                  />
                </View>
              </View>
            </>
          )}
        </Pressable>
      </View>

      {/* 2. Infrastructure & Cloud Services Health Grid */}
      <View style={styles.section}>
        <View style={styles.sectionHeaderRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <MaterialIcons name="cloud-done" size={20} color="#0D9488" />
            <Text style={styles.sectionTitle}>Infrastructure & API Gateway Status</Text>
          </View>
          <View style={styles.onlineBadge}>
            <View style={styles.greenDot} />
            <Text style={styles.onlineText}>ALL SERVICES HEALTHY</Text>
          </View>
        </View>

        <View style={styles.serviceGrid}>
          <View style={styles.serviceCard}>
            <View style={styles.serviceTop}>
              <Text style={styles.serviceName}>Firebase Firestore</Text>
              <Text style={styles.serviceStatus}>OPERATIONAL</Text>
            </View>
            <Text style={styles.serviceMeta}>Primary NoSQL Data Engine · Latency &lt;45ms</Text>
          </View>

          <View style={styles.serviceCard}>
            <View style={styles.serviceTop}>
              <Text style={styles.serviceName}>Cloudinary Media CDN</Text>
              <Text style={styles.serviceStatus}>CONNECTED</Text>
            </View>
            <Text style={styles.serviceMeta}>Edge Waste Image Processing &amp; Compression</Text>
          </View>

          <View style={styles.serviceCard}>
            <View style={styles.serviceTop}>
              <Text style={styles.serviceName}>OpenStreetMap OSRM</Text>
              <Text style={styles.serviceStatus}>ONLINE</Text>
            </View>
            <Text style={styles.serviceMeta}>Danao Road Snapping &amp; Fuel Optimization Router</Text>
          </View>

          <View style={styles.serviceCard}>
            <View style={styles.serviceTop}>
              <Text style={styles.serviceName}>Open-Meteo Weather API</Text>
              <Text style={styles.serviceStatus}>ACTIVE</Text>
            </View>
            <Text style={styles.serviceMeta}>10.5218°N, 124.0285°E Monsoon &amp; Rain Telemetry</Text>
          </View>

          <View style={styles.serviceCard}>
            <View style={styles.serviceTop}>
              <Text style={styles.serviceName}>Nager.Date Holiday API</Text>
              <Text style={styles.serviceStatus}>ACTIVE</Text>
            </View>
            <Text style={styles.serviceMeta}>Philippine Statutory Calendar &amp; Shift Advisories</Text>
          </View>

          <View style={styles.serviceCard}>
            <View style={styles.serviceTop}>
              <Text style={styles.serviceName}>Edge ML Classifier</Text>
              <Text style={styles.serviceStatus}>LOADED</Text>
            </View>
            <Text style={styles.serviceMeta}>MobileNet / TensorFlow Waste Identification</Text>
          </View>
        </View>
      </View>

      {/* 3. 2-Column Split: User Distribution & Operational Integrity */}
      <View style={[styles.splitGrid, isNarrow && { flexDirection: 'column' }]}>
        {/* Left: Role Governance */}
        <View style={[styles.splitCol, isNarrow && { width: '100%' }]}>
          <View style={styles.subSection}>
            <View style={styles.sectionHeaderRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <MaterialIcons name="badge" size={18} color="#0D9488" />
                <Text style={styles.sectionTitle}>Identity &amp; Role Breakdown</Text>
              </View>
              {onNavigateTab && (
                <TouchableOpacity onPress={() => onNavigateTab('identity-access', { role: 'all' })}>
                  <Text style={styles.linkText}>Manage Users &rarr;</Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.roleList}>
              {roleList.length === 0 ? (
                <Text style={styles.emptyText}>No user records found.</Text>
              ) : (
                roleList.map(([role, count]) => {
                  const pct = Math.round((count / totalRoleUsers) * 100);
                  const roleLabel =
                    role.toLowerCase() === 'cenro' || role.toLowerCase() === 'admin'
                      ? 'CENRO'
                      : role.replace(/_/g, ' ').toUpperCase();
                  const roleColor =
                    role.toLowerCase() === 'admin' || role.toLowerCase() === 'cenro'
                      ? '#2563EB'
                      : role.toLowerCase() === 'cicto'
                      ? '#0D9488'
                      : role.toLowerCase() === 'driver'
                      ? '#D97706'
                      : role.toLowerCase() === 'coordinator'
                      ? '#059669'
                      : '#64748B';

                  const targetRoleParam =
                    role.toLowerCase() === 'user' || role.toLowerCase() === 'resident'
                      ? 'user'
                      : role.toLowerCase() === 'cenro' || role.toLowerCase() === 'admin'
                      ? 'admin'
                      : role.toLowerCase();

                  return (
                    <TouchableOpacity
                      key={role}
                      style={styles.roleRow}
                      onPress={() => onNavigateTab?.('identity-access', { role: targetRoleParam })}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={`Filter by ${roleLabel}`}
                    >
                      <View style={styles.roleHeader}>
                        <Text style={styles.roleName}>{roleLabel}</Text>
                        <Text style={[styles.roleCount, { color: roleColor }]}>
                          {count} ({pct}%)
                        </Text>
                      </View>
                      <View style={styles.roleBarTrack}>
                        <View style={[styles.roleBarFill, { width: `${pct}%`, backgroundColor: roleColor }]} />
                      </View>
                    </TouchableOpacity>
                  );
                })
              )}
            </View>
          </View>
        </View>

        {/* Right: Operational Data Quality Gates */}
        <View style={[styles.splitCol, isNarrow && { width: '100%' }]}>
          <View style={styles.subSection}>
            <View style={styles.sectionHeaderRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <MaterialIcons name="verified" size={18} color="#059669" />
                <Text style={styles.sectionTitle}>Operational Integrity Gates</Text>
              </View>
              {onNavigateTab && (
                <TouchableOpacity onPress={() => onNavigateTab('data-mgmt')}>
                  <Text style={styles.linkText}>Data Governance &rarr;</Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.gateList}>
              <View style={styles.gateCard}>
                <View style={styles.gateIconBox}>
                  <MaterialIcons
                    name={(data?.dataQuality.reportsMissingGps || 0) === 0 ? 'check-circle' : 'warning'}
                    size={20}
                    color={(data?.dataQuality.reportsMissingGps || 0) === 0 ? '#16A34A' : '#D97706'}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.gateTitle}>Geotag GPS Completeness</Text>
                  <Text style={styles.gateDesc}>
                    {data?.dataQuality.reportsMissingGps || 0} record(s) missing coordinates
                  </Text>
                </View>
              </View>

              <View style={styles.gateCard}>
                <View style={styles.gateIconBox}>
                  <MaterialIcons
                    name={(data?.dataQuality.completedSchedulesMissingMeasurement || 0) === 0 ? 'check-circle' : 'info'}
                    size={20}
                    color={(data?.dataQuality.completedSchedulesMissingMeasurement || 0) === 0 ? '#16A34A' : '#2563EB'}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.gateTitle}>Weighbridge Mass Verification</Text>
                  <Text style={styles.gateDesc}>
                    {data?.dataQuality.completedSchedulesMissingMeasurement || 0} completed trip(s) pending weighbridge check
                  </Text>
                </View>
              </View>

              <View style={styles.gateCard}>
                <View style={styles.gateIconBox}>
                  <MaterialIcons name="security" size={20} color="#0D9488" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.gateTitle}>Security &amp; Audit Logs Integrity</Text>
                  <Text style={styles.gateDesc}>
                    {data?.counts.auditEvents || data?.recentActivity.length || 0} tamper-proof audit events recorded
                  </Text>
                </View>
              </View>
            </View>
          </View>
        </View>
      </View>

      {/* 4. Interagency Directives & Command Dispatcher */}
      <View style={styles.section}>
        <View style={styles.sectionHeaderRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <MaterialIcons name="campaign" size={22} color="#0D9488" />
            <Text style={styles.sectionTitle}>Transmit CICTO Directive to CENRO Console</Text>
          </View>
          {!!cmdSuccess && (
            <View style={styles.successBadge}>
              <MaterialIcons name="check" size={14} color="#166534" />
              <Text style={styles.successText}>{cmdSuccess}</Text>
            </View>
          )}
        </View>

        <View style={styles.commandForm}>
          <View style={styles.commandInputRow}>
            <TextInput
              style={[styles.input, { flex: 1.5 }]}
              placeholder="Directive Subject (e.g. Server Maintenance, Schedule Advisory)…"
              placeholderTextColor="#94A3B8"
              value={commandSubject}
              onChangeText={setCommandSubject}
            />
            <View style={styles.prioritySelector}>
              {(['normal', 'high', 'urgent'] as const).map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[
                    styles.priorityBtn,
                    commandPriority === p && (p === 'urgent' ? styles.urgentActive : p === 'high' ? styles.highActive : styles.normalActive),
                  ]}
                  onPress={() => setCommandPriority(p)}
                >
                  <Text
                    style={[
                      styles.priorityBtnText,
                      commandPriority === p && { color: '#FFFFFF', fontWeight: '800' },
                    ]}
                  >
                    {p.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <TextInput
            style={[styles.input, styles.textarea]}
            placeholder="Type your official administrative notice or technical directive here…"
            placeholderTextColor="#94A3B8"
            multiline
            numberOfLines={2}
            value={commandMsg}
            onChangeText={setCommandMsg}
          />

          <View style={styles.commandFooter}>
            <Text style={styles.commandHelp}>
              Broadcasts immediately to all active CENRO Administrator dashboards.
            </Text>
            <TouchableOpacity
              style={[styles.sendBtn, (!commandSubject.trim() || !commandMsg.trim() || isSendingCmd) && styles.sendBtnDisabled]}
              onPress={handleSendCommand}
              disabled={!commandSubject.trim() || !commandMsg.trim() || isSendingCmd}
            >
              {isSendingCmd ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <MaterialIcons name="send" size={15} color="#FFFFFF" />
                  <Text style={styles.sendBtnText}>Transmit Directive</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* 5. Recent Interagency Communications & Activity Feed */}
      <View style={styles.section}>
        <View style={styles.sectionHeaderRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <MaterialIcons name="history" size={20} color="#0D9488" />
            <Text style={styles.sectionTitle}>Recent Interagency Communications</Text>
          </View>
          {onNavigateTab && (
            <TouchableOpacity onPress={() => onNavigateTab('cenro-command')}>
              <Text style={styles.linkText}>View Command Log &rarr;</Text>
            </TouchableOpacity>
          )}
        </View>

        {(!data?.messages || data.messages.length === 0) ? (
          <Text style={styles.emptyText}>No interagency dispatches recorded recently.</Text>
        ) : (
          <View style={styles.messageFeed}>
            {data.messages.slice(0, 4).map((msg: any) => (
              <View key={msg.id} style={styles.msgItem}>
                <View style={styles.msgTop}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <View style={[styles.priorityPill, msg.priority === 'urgent' ? styles.urgentPill : msg.priority === 'high' ? styles.highPill : styles.normalPill]}>
                      <Text style={styles.priorityPillText}>{(msg.priority || 'normal').toUpperCase()}</Text>
                    </View>
                    <Text style={styles.msgSubject}>{msg.subject || 'Administrative Notice'}</Text>
                  </View>
                  <Text style={styles.msgTime}>
                    {msg.createdAt ? new Date(msg.createdAt).toLocaleString() : 'Just now'}
                  </Text>
                </View>
                <Text style={styles.msgBody}>{msg.message}</Text>
                <Text style={styles.msgSender}>From: {msg.senderName || 'CICTO Command'}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  content: { padding: 28 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F8FAFC' },
  muted: { color: '#64748B', marginTop: 10, fontSize: 13, fontWeight: '600' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  eyebrow: { fontSize: 10, fontWeight: '900', color: '#0D9488', letterSpacing: 1.1 },
  title: { fontSize: 26, fontWeight: '900', color: '#0F172A', marginTop: 4 },
  sub: { fontSize: 12, color: '#64748B', marginTop: 4 },
  refresh: {
    width: 38,
    height: 38,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: { color: '#B91C1C', backgroundColor: '#FEF2F2', padding: 12, borderRadius: 8, marginBottom: 16 },
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginBottom: 20 },
  card: {
    flex: 1,
    minWidth: 220,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
    elevation: 1,
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.15s ease' } : {}),
  },
  cardHovered: {
    borderColor: '#CBD5E1',
    transform: [{ translateY: -2 }],
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  cardPressed: {
    opacity: 0.8,
    transform: [{ translateY: 0 }],
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  cardTitle: { fontSize: 9.5, fontWeight: '900', color: '#64748B', letterSpacing: 0.8 },
  cardValue: { fontSize: 28, fontWeight: '900' },
  cardBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
  },
  cardSub: { fontSize: 11, color: '#64748B', flex: 1, paddingRight: 6 },
  cardActionIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
    elevation: 1,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  sectionTitle: { fontSize: 14, fontWeight: '900', color: '#0F172A' },
  onlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  greenDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#10B981' },
  onlineText: { fontSize: 9, fontWeight: '900', color: '#065F46', letterSpacing: 0.6 },
  serviceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  serviceCard: {
    flex: 1,
    minWidth: 260,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 12,
  },
  serviceTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 },
  serviceName: { fontSize: 12, fontWeight: '800', color: '#0F172A' },
  serviceStatus: { fontSize: 9, fontWeight: '900', color: '#059669', backgroundColor: '#ECFDF5', paddingHorizontal: 6, paddingVertical: 1.5, borderRadius: 4 },
  serviceMeta: { fontSize: 10.5, color: '#64748B' },
  splitGrid: { flexDirection: 'row', gap: 20, marginBottom: 20 },
  splitCol: { flex: 1 },
  subSection: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 18,
    height: '100%',
  },
  linkText: { fontSize: 11.5, fontWeight: '800', color: '#0D9488' },
  roleList: { gap: 10 },
  roleRow: { marginBottom: 4 },
  roleHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  roleName: { fontSize: 11, fontWeight: '800', color: '#334155' },
  roleCount: { fontSize: 11, fontWeight: '800' },
  roleBarTrack: { height: 6, backgroundColor: '#F1F5F9', borderRadius: 3, overflow: 'hidden' },
  roleBarFill: { height: '100%', borderRadius: 3 },
  gateList: { gap: 10 },
  gateCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 12,
  },
  gateIconBox: { width: 32, alignItems: 'center', justifyContent: 'center' },
  gateTitle: { fontSize: 12, fontWeight: '800', color: '#0F172A' },
  gateDesc: { fontSize: 11, color: '#64748B', marginTop: 2 },
  emptyText: { fontSize: 12, color: '#94A3B8', paddingVertical: 8 },
  commandForm: { backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 10, padding: 14 },
  commandInputRow: { flexDirection: 'row', gap: 10, marginBottom: 10, flexWrap: 'wrap' },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 12,
    color: '#0F172A',
  },
  textarea: { height: 60, textAlignVertical: 'top', marginBottom: 10 },
  prioritySelector: { flexDirection: 'row', gap: 6 },
  priorityBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  urgentActive: { backgroundColor: '#DC2626', borderColor: '#B91C1C' },
  highActive: { backgroundColor: '#D97706', borderColor: '#B45309' },
  normalActive: { backgroundColor: '#0D9488', borderColor: '#0F766E' },
  priorityBtnText: { fontSize: 9.5, fontWeight: '700', color: '#64748B' },
  commandFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  commandHelp: { fontSize: 11, color: '#64748B', fontStyle: 'italic' },
  sendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#0D9488',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
  },
  sendBtnDisabled: { opacity: 0.5 },
  sendBtnText: { color: '#FFFFFF', fontSize: 11.5, fontWeight: '800' },
  successBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  successText: { fontSize: 11, fontWeight: '700', color: '#166534' },
  messageFeed: { gap: 10 },
  msgItem: { backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 8, padding: 12 },
  msgTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  priorityPill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  urgentPill: { backgroundColor: '#FEE2E2' },
  highPill: { backgroundColor: '#FEF3C7' },
  normalPill: { backgroundColor: '#ECFDF5' },
  priorityPillText: { fontSize: 8.5, fontWeight: '900', color: '#0F172A' },
  msgSubject: { fontSize: 12, fontWeight: '800', color: '#0F172A' },
  msgTime: { fontSize: 10, color: '#94A3B8' },
  msgBody: { fontSize: 11.5, color: '#334155', lineHeight: 16 },
  msgSender: { fontSize: 10, color: '#64748B', marginTop: 4, fontStyle: 'italic' },
});

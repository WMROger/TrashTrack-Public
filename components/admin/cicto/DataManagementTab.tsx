import { MaterialIcons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  CictoOversightSnapshot,
  getCictoOversightSnapshot,
} from '@/services/cictoOversightService';

export default function DataManagementTab() {
  const [data, setData] = useState<CictoOversightSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setData(await getCictoOversightSnapshot());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Data inventory failed.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const collections = [
    ['Users', data?.counts.users || 0, 'Identity directory'],
    ['Reports', data?.counts.reports || 0, `${data?.dataQuality.reportsMissingGps || 0} missing GPS`],
    ['Schedules', data?.counts.schedules || 0, `${data?.dataQuality.completedSchedulesMissingMeasurement || 0} completed without measurement`],
    ['Trucks', data?.counts.trucks || 0, 'Fleet inventory'],
    ['Expense records', data?.counts.expenses || 0, `${data?.dataQuality.expensePeriods || 0} distinct periods`],
    ['Audit events', data?.counts.auditEvents || 0, 'Latest server audit window'],
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>CICTO / DATA GOVERNANCE</Text>
          <Text style={styles.title}>Data Management</Text>
          <Text style={styles.sub}>
            Live collection inventory, completeness checks, and operational data readiness.
          </Text>
        </View>
        <TouchableOpacity style={styles.refresh} onPress={load} activeOpacity={0.7} accessibilityLabel="Refresh">
          <MaterialIcons name="refresh" size={20} color="#0D9488" />
        </TouchableOpacity>
      </View>

      {loading && !data ? (
        <ActivityIndicator size="large" color="#0D9488" style={{ marginVertical: 20 }} />
      ) : null}

      {!!error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.table}>
        <View style={styles.tableHead}>
          <Text style={[styles.th, { flex: 1.2 }]}>DATASET</Text>
          <Text style={[styles.th, { width: 100 }]}>RECORDS</Text>
          <Text style={[styles.th, { flex: 2 }]}>QUALITY SIGNAL</Text>
          <Text style={[styles.th, { width: 100 }]}>STATUS</Text>
        </View>
        {collections.map(([name, count, signal]) => (
          <View key={String(name)} style={styles.row}>
            <Text style={[styles.name, { flex: 1.2 }]}>{name}</Text>
            <Text style={[styles.count, { width: 100 }]}>{count}</Text>
            <Text style={[styles.signal, { flex: 2 }]}>{signal}</Text>
            <View style={[styles.badge, { width: 100 }]}>
              <View style={styles.dot} />
              <Text style={styles.badgeText}>CONNECTED</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.quality}>
        <Text style={styles.qualityTitle}>Readiness Gates</Text>
        <View style={styles.gates}>
          {[
            ['GPS completeness', (data?.dataQuality.reportsMissingGps || 0) === 0, `${data?.dataQuality.reportsMissingGps || 0} missing`],
            ['Measured pickups', (data?.dataQuality.completedSchedulesMissingMeasurement || 0) === 0, `${data?.dataQuality.completedSchedulesMissingMeasurement || 0} incomplete`],
            ['Budget backtest', (data?.dataQuality.expensePeriods || 0) >= 3, `${data?.dataQuality.expensePeriods || 0}/3 periods`],
          ].map(([label, ok, detail]) => (
            <View key={String(label)} style={styles.gate}>
              <MaterialIcons name={ok ? 'check-circle' : 'pending'} size={23} color={ok ? '#16A34A' : '#D97706'} />
              <Text style={styles.gateLabel}>{label}</Text>
              <Text style={styles.gateDetail}>{detail}</Text>
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  content: { padding: 28 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 22,
  },
  eyebrow: {
    fontSize: 10,
    fontWeight: '900',
    color: '#0D9488',
    letterSpacing: 1.1,
  },
  title: {
    fontSize: 26,
    fontWeight: '900',
    color: '#0F172A',
    marginTop: 5,
  },
  sub: { fontSize: 12, color: '#64748B', marginTop: 5 },
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
  error: {
    color: '#B91C1C',
    backgroundColor: '#FEF2F2',
    padding: 12,
    borderRadius: 9,
    marginBottom: 14,
  },
  table: {
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    overflow: 'hidden',
  },
  tableHead: {
    flexDirection: 'row',
    padding: 13,
    backgroundColor: '#F1F5F9',
  },
  th: {
    fontSize: 9,
    fontWeight: '900',
    color: '#64748B',
    letterSpacing: 0.7,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  name: { fontSize: 12, fontWeight: '900', color: '#0F172A' },
  count: { fontSize: 15, fontWeight: '900', color: '#0D9488' },
  signal: { fontSize: 11, color: '#64748B' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#10B981',
  },
  badgeText: { fontSize: 8, fontWeight: '900', color: '#166534' },
  quality: {
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    padding: 17,
    marginTop: 16,
  },
  qualityTitle: { fontSize: 14, fontWeight: '900', color: '#0F172A' },
  gates: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 12 },
  gate: {
    flex: 1,
    minWidth: 180,
    backgroundColor: '#F8FAFC',
    borderRadius: 11,
    padding: 14,
  },
  gateLabel: { fontSize: 11, fontWeight: '900', color: '#334155', marginTop: 8 },
  gateDetail: { fontSize: 9, color: '#64748B', marginTop: 3 },
});

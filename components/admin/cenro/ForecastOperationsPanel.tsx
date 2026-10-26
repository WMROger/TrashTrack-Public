import { MaterialIcons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import {
  ForecastApiHealth,
  ForecastApiResult,
  getForecastApiHealth,
  isForecastApiConfigured,
  requestTensorFlowForecast,
} from '@/services/forecastApiService';
import { formatAdaptiveMassFromMetricTons } from '@/utils/wasteUnits';

type Props = {
  historyTons: number[];
  candidate: any;
  baselineForecast?: number[];
};

export default function ForecastOperationsPanel({ historyTons, candidate, baselineForecast }: Props) {
  const [health, setHealth] = useState<ForecastApiHealth | null>(null);
  const [result, setResult] = useState<ForecastApiResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const configured = isForecastApiConfigured();

  const checkHealth = useCallback(async () => {
    if (!configured) return;
    setChecking(true);
    setError('');
    try {
      setHealth(await getForecastApiHealth());
    } catch (healthError) {
      setHealth(null);
      setError(healthError instanceof Error ? healthError.message : 'The inference service could not be reached.');
    } finally {
      setChecking(false);
    }
  }, [configured]);

  useEffect(() => {
    checkHealth();
  }, [checkHealth]);

  const runInference = async () => {
    setRunning(true);
    setError('');
    try {
      setResult(await requestTensorFlowForecast(historyTons, 3));
    } catch (inferenceError) {
      setError(inferenceError instanceof Error ? inferenceError.message : 'TensorFlow inference failed.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>MODEL OPERATIONS / FEATURE 27-28</Text>
          <Text style={styles.title}>TensorFlow Backend Inference & Monitoring</Text>
          <Text style={styles.subtitle}>Runs the saved Keras model through the configured backend API. Monthly monitoring only retrains when drift or a manual gate triggers it.</Text>
        </View>
        <View style={[styles.statusBadge, health?.status === 'ready' ? styles.statusReady : styles.statusHold]}>
          <View style={[styles.statusDot, { backgroundColor: health?.status === 'ready' ? '#16A34A' : '#D97706' }]} />
          <Text style={[styles.statusText, { color: health?.status === 'ready' ? '#166534' : '#92400E' }]}>
            {health?.status === 'ready' ? 'API READY' : configured ? 'API OFFLINE' : 'API NOT CONFIGURED'}
          </Text>
        </View>
      </View>

      <View style={styles.grid}>
        <View style={styles.metricBox}>
          <Text style={styles.metricLabel}>MODEL VERSION</Text>
          <Text style={styles.metricValueSmall}>{health?.modelId || candidate.modelId}</Text>
        </View>
        <View style={styles.metricBox}>
          <Text style={styles.metricLabel}>PROMOTION GATE</Text>
          <Text style={styles.metricValue}>{candidate.evaluation.stabilityGatePassed ? 'PASSED' : 'HOLD'}</Text>
          <Text style={styles.metricHint}>{candidate.evaluation.individualSeedWins} stable seed wins</Text>
        </View>
        <View style={styles.metricBox}>
          <Text style={styles.metricLabel}>MONITORING</Text>
          <Text style={styles.metricValue}>MONTHLY</Text>
          <Text style={styles.metricHint}>Drift threshold: 15% MAPE</Text>
        </View>
      </View>

      {result && (
        <View style={styles.resultBox}>
          <Text style={styles.resultTitle}>Live backend forecast vs. Baseline Actual</Text>
          <View style={styles.resultRow}>
            {result.predictionsTons.map((value, index) => {
              const baselineVal = baselineForecast && baselineForecast[index] !== undefined ? baselineForecast[index] : null;
              const delta = baselineVal !== null ? value - baselineVal : null;
              return (
                <View key={`api-forecast-${index}`} style={styles.forecastChip}>
                  <Text style={styles.forecastLabel}>MONTH {index + 1}</Text>
                  <Text style={styles.forecastValue}>{formatAdaptiveMassFromMetricTons(value)}</Text>
                  {baselineVal !== null && (
                    <Text style={{ fontSize: 10, color: '#4B5563', marginTop: 3 }}>
                      Baseline: {formatAdaptiveMassFromMetricTons(baselineVal)}
                    </Text>
                  )}
                  {delta !== null && (
                    <Text style={{ fontSize: 10, fontWeight: '700', color: delta >= 0 ? '#166534' : '#B91C1C', marginTop: 1 }}>
                      Δ {delta >= 0 ? `+${delta.toFixed(1)}t` : `${delta.toFixed(1)}t`}
                    </Text>
                  )}
                </View>
              );
            })}
          </View>
          {!result.productionApproved && <Text style={styles.holdText}>Candidate output only — the validated baseline remains the operational forecast.</Text>}
        </View>
      )}

      {!!error && <Text style={styles.errorText}>{error}</Text>}
      {!configured && <Text style={styles.configText}>Set EXPO_PUBLIC_FORECAST_API_URL to the deployed ml/inference_api.py service to enable live inference.</Text>}

      <View style={styles.actions}>
        <TouchableOpacity style={styles.secondaryButton} onPress={checkHealth} disabled={!configured || checking}>
          {checking ? <ActivityIndicator size="small" color="#334155" /> : <MaterialIcons name="health-and-safety" size={18} color="#334155" />}
          <Text style={styles.secondaryButtonText}>Check API</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.primaryButton, (!configured || health?.status !== 'ready') && styles.disabled]} onPress={runInference} disabled={!configured || health?.status !== 'ready' || running}>
          {running ? <ActivityIndicator size="small" color="#FFFFFF" /> : <MaterialIcons name="memory" size={18} color="#FFFFFF" />}
          <Text style={styles.primaryButtonText}>{running ? 'Running model…' : 'Run Backend Inference'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#DDD6FE', borderRadius: 16, padding: 20, marginBottom: 20 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 18 },
  eyebrow: { color: '#7C3AED', fontSize: 10, fontWeight: '900', letterSpacing: 1.1, marginBottom: 5 },
  title: { color: '#111827', fontSize: 18, fontWeight: '900' },
  subtitle: { color: '#64748B', fontSize: 12, lineHeight: 18, marginTop: 5, maxWidth: 780 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 999, borderWidth: 1 },
  statusReady: { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' },
  statusHold: { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 9, fontWeight: '900' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 18 },
  metricBox: { flex: 1, minWidth: 180, backgroundColor: '#F8FAFC', borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', padding: 14 },
  metricLabel: { color: '#64748B', fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  metricValue: { color: '#111827', fontSize: 18, fontWeight: '900', marginTop: 5 },
  metricValueSmall: { color: '#111827', fontSize: 12, fontWeight: '800', marginTop: 7 },
  metricHint: { color: '#64748B', fontSize: 10, marginTop: 3 },
  resultBox: { backgroundColor: '#F5F3FF', borderRadius: 12, padding: 14, marginTop: 14 },
  resultTitle: { color: '#5B21B6', fontSize: 12, fontWeight: '900', marginBottom: 10 },
  resultRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  forecastChip: { backgroundColor: '#FFFFFF', borderRadius: 9, paddingHorizontal: 13, paddingVertical: 9, borderWidth: 1, borderColor: '#DDD6FE' },
  forecastLabel: { color: '#7C3AED', fontSize: 8, fontWeight: '900' },
  forecastValue: { color: '#4C1D95', fontSize: 14, fontWeight: '900', marginTop: 3 },
  holdText: { color: '#92400E', fontSize: 10, fontWeight: '700', marginTop: 10 },
  errorText: { color: '#B91C1C', fontSize: 11, fontWeight: '700', marginTop: 12 },
  configText: { color: '#92400E', fontSize: 11, lineHeight: 17, marginTop: 12 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 10, marginTop: 16 },
  secondaryButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 15, paddingVertical: 10, borderRadius: 9, borderWidth: 1, borderColor: '#CBD5E1', backgroundColor: '#FFFFFF' },
  secondaryButtonText: { color: '#334155', fontSize: 11, fontWeight: '800' },
  primaryButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 15, paddingVertical: 10, borderRadius: 9, backgroundColor: '#7C3AED' },
  primaryButtonText: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
  disabled: { opacity: 0.45 },
});

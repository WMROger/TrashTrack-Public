import { MaterialIcons } from '@expo/vector-icons';
import { addDoc, collection, doc, onSnapshot, orderBy, query, serverTimestamp, setDoc } from 'firebase/firestore';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { auth, db } from '@/config/firebase';
import {
  DEFAULT_FISCAL_YEAR_CONFIG,
  evaluateFiscalYearSufficiency,
  ExpenseRecord,
  FiscalYearConfig,
  validateExpenseBudget,
} from '@/services/budgetValidationService';
import { formatAdaptiveMassFromMetricTons } from '@/utils/wasteUnits';

type Props = { forecastTons: number; contingencyPercent: number };
const categories = ['Fuel', 'Labor', 'Maintenance', 'Disposal', 'Other'];
const currency = (value: number | null) => value === null ? '—' : `₱${value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatNumberInput = (text: string): string => {
  const clean = text.replace(/[^0-9.]/g, '');
  if (!clean) return '';

  const parts = clean.split('.');
  let integerPart = parts[0].replace(/^0+(?=\d)/, '');
  const decimalPart = parts.length > 1 ? parts.slice(1).join('') : null;

  if (!integerPart && decimalPart !== null) {
    integerPart = '0';
  }

  const formattedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return decimalPart !== null ? `${formattedInteger}.${decimalPart}` : formattedInteger;
};

const handleNumberChange = (prev: string, next: string, setter: (val: string) => void) => {
  if (prev.length - next.length === 1 && prev.replace(/,/g, '') === next.replace(/,/g, '')) {
    let commaIndex = -1;
    for (let i = 0; i < prev.length; i++) {
      if (prev[i] === ',' && (i >= next.length || next[i] !== ',')) {
        commaIndex = i;
        break;
      }
    }
    if (commaIndex > 0) {
      const adjusted = prev.slice(0, commaIndex - 1) + prev.slice(commaIndex + 1);
      setter(formatNumberInput(adjusted));
      return;
    }
  }
  setter(formatNumberInput(next));
};

export default function ExpenseBudgetPanel({ forecastTons, contingencyPercent }: Props) {
  const now = new Date();
  const [records, setRecords] = useState<ExpenseRecord[]>([]);
  const [period, setPeriod] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const [category, setCategory] = useState('Fuel');
  const [amount, setAmount] = useState('');
  const [tons, setTons] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  // Fiscal Year Configuration State
  const [fiscalConfig, setFiscalConfig] = useState<FiscalYearConfig>(DEFAULT_FISCAL_YEAR_CONFIG);
  const [fyYearInput, setFyYearInput] = useState(String(DEFAULT_FISCAL_YEAR_CONFIG.fiscalYear));
  const [fyBudgetInput, setFyBudgetInput] = useState(
    DEFAULT_FISCAL_YEAR_CONFIG.allocatedBudget ? Number(DEFAULT_FISCAL_YEAR_CONFIG.allocatedBudget).toLocaleString('en-US') : ''
  );
  const [isEditingFy, setIsEditingFy] = useState(false);
  const [savingFy, setSavingFy] = useState(false);

  useEffect(() => {
    if (!db) return;
    const subcollections = ['fuel', 'labor', 'maintenance', 'disposal', 'other', 'items'];
    const bucket: Record<string, ExpenseRecord[]> = {};

    const unsubs = subcollections.map(sub => {
      const recordsRef = collection(db, 'analytics', 'expense_records', sub);
      return onSnapshot(query(recordsRef, orderBy('period', 'desc')), snapshot => {
        bucket[sub] = snapshot.docs.map(item => ({ id: item.id, ...item.data() } as ExpenseRecord));
        
        // Merge all buckets, deduplicate by id
        const mergedMap = new Map<string, ExpenseRecord>();
        Object.values(bucket).flat().forEach(rec => {
          if (rec.id) mergedMap.set(rec.id, rec);
        });
        const mergedList = Array.from(mergedMap.values()).sort((a, b) => {
          const pComp = (b.period || '').localeCompare(a.period || '');
          if (pComp !== 0) return pComp;
          const tA = typeof (a.createdAt as any)?.toMillis === 'function' ? (a.createdAt as any).toMillis() : (a.createdAt ? new Date(String(a.createdAt)).getTime() : 0);
          const tB = typeof (b.createdAt as any)?.toMillis === 'function' ? (b.createdAt as any).toMillis() : (b.createdAt ? new Date(String(b.createdAt)).getTime() : 0);
          return tB - tA;
        });

        setRecords(mergedList);
        setLoading(false);
      }, error => {
        bucket[sub] = [];
        setLoading(false);
      });
    });

    return () => {
      unsubs.forEach(unsub => unsub());
    };
  }, []);

  const validation = useMemo(
    () => validateExpenseBudget(records, forecastTons, contingencyPercent),
    [contingencyPercent, forecastTons, records],
  );

  const saveRecord = async () => {
    const numericAmount = Number(amount.replace(/,/g, ''));
    const numericTons = Number(tons.replace(/,/g, ''));
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
      Alert.alert('Invalid period', 'Use YYYY-MM, for example 2026-08.');
      return;
    }
    if (!Number.isFinite(numericAmount) || numericAmount <= 0 || !Number.isFinite(numericTons) || numericTons <= 0) {
      Alert.alert('Invalid actual record', 'Enter an expense amount and actual collected metric tons greater than zero.');
      return;
    }
    setSaving(true);
    try {
      const categorySubcollection = (category || 'fuel').trim().toLowerCase();
      await addDoc(collection(db, 'analytics', 'expense_records', categorySubcollection), {
        period,
        category,
        amount: numericAmount,
        collectedTons: numericTons,
        notes: notes.trim(),
        createdAt: serverTimestamp(),
        createdByUid: auth.currentUser?.uid || null,
      });
      setAmount('');
      setTons('');
      setNotes('');
      Alert.alert('Actual expense saved', 'Budget validation has been recalculated from the approved records.');
    } catch (error) {
      console.error('Expense record save failed:', error);
      Alert.alert('Unable to save', 'The actual expense record could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  // Listen to Fiscal Year Configuration from Firestore
  useEffect(() => {
    if (!db) return;
    const unsub = onSnapshot(doc(db, 'settings', 'fiscal_year'), snapshot => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        const conf: FiscalYearConfig = {
          fiscalYear: Number(data.fiscalYear) || DEFAULT_FISCAL_YEAR_CONFIG.fiscalYear,
          allocatedBudget: Number(data.allocatedBudget) || DEFAULT_FISCAL_YEAR_CONFIG.allocatedBudget,
          department: data.department || DEFAULT_FISCAL_YEAR_CONFIG.department,
          notes: data.notes || DEFAULT_FISCAL_YEAR_CONFIG.notes,
        };
        setFiscalConfig(conf);
        setFyYearInput(String(conf.fiscalYear));
        setFyBudgetInput(Number(conf.allocatedBudget).toLocaleString('en-US'));
      }
    }, () => {});
    return () => unsub();
  }, []);

  const fySufficiency = useMemo(
    () => evaluateFiscalYearSufficiency(fiscalConfig, validation.projectedTotalCost),
    [fiscalConfig, validation.projectedTotalCost]
  );

  const saveFiscalYearConfig = async () => {
    const yr = Number(fyYearInput);
    const bud = Number(fyBudgetInput.replace(/,/g, ''));
    if (!yr || yr < 2020 || yr > 2050) {
      Alert.alert('Invalid Year', 'Please enter a valid 4-digit fiscal year (e.g., 2026).');
      return;
    }
    if (!bud || bud <= 0) {
      Alert.alert('Invalid Budget', 'Please enter a positive municipal budget amount.');
      return;
    }
    setSavingFy(true);
    try {
      await setDoc(doc(db, 'settings', 'fiscal_year'), {
        fiscalYear: yr,
        allocatedBudget: bud,
        department: 'CENRO Danao Solid Waste Management',
        updatedAt: serverTimestamp(),
        updatedByUid: auth.currentUser?.uid || null,
      }, { merge: true });
      setIsEditingFy(false);
      Alert.alert('Fiscal Year Updated', `Budget settings for FY ${yr} have been saved and validated.`);
    } catch (err) {
      console.error('Error saving fiscal year:', err);
      Alert.alert('Save Error', 'Failed to update fiscal year settings.');
    } finally {
      setSavingFy(false);
    }
  };

  const statusLabel = validation.status === 'backtested'
    ? 'BACKTESTED'
    : validation.status === 'needs-review' ? 'VARIANCE NEEDS REVIEW' : 'WAITING FOR 3 PERIODS';
  const statusColor = validation.status === 'backtested' ? '#166534' : validation.status === 'needs-review' ? '#B91C1C' : '#92400E';

  return (
    <View style={{ gap: 20 }}>
      {/* 1. Fiscal Year Configuration & Budget Sufficiency Card (Manuscript & Consultant Item) */}
      <View style={styles.fyCard}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <MaterialIcons name="account-balance" size={16} color="#0D9488" />
              <Text style={styles.fyEyebrow}>FISCAL YEAR BUDGET GOVERNANCE & SUFFICIENCY EVALUATION</Text>
            </View>
            <Text style={styles.title}>Fiscal Year {fiscalConfig.fiscalYear} Municipal Allocation</Text>
            <Text style={styles.subtitle}>
              Compares the allocated annual municipal solid waste budget against the projected operational cost to ensure financial sufficiency.
            </Text>
          </View>
          <TouchableOpacity
            style={styles.fyEditBtn}
            onPress={() => setIsEditingFy(!isEditingFy)}
            activeOpacity={0.8}
          >
            <MaterialIcons name={isEditingFy ? 'close' : 'edit'} size={15} color="#0F766E" />
            <Text style={styles.fyEditBtnText}>{isEditingFy ? 'Cancel' : 'Set Fiscal Year'}</Text>
          </TouchableOpacity>
        </View>

        {/* Inline Fiscal Year Editor */}
        {isEditingFy && (
          <View style={styles.fyEditForm}>
            <Text style={styles.fyEditFormTitle}>Update Fiscal Year Budget Allocation</Text>
            <View style={styles.fyEditInputRow}>
              <View style={{ width: 110 }}>
                <Text style={styles.fyInputLabel}>FISCAL YEAR:</Text>
                <TextInput
                  style={styles.fyInput}
                  value={fyYearInput}
                  onChangeText={setFyYearInput}
                  placeholder="2026"
                  placeholderTextColor="#94A3B8"
                  keyboardType="numeric"
                  maxLength={4}
                />
              </View>
              <View style={{ flex: 1, minWidth: 160 }}>
                <Text style={styles.fyInputLabel}>ANNUAL ALLOCATED BUDGET (₱):</Text>
                <TextInput
                  style={styles.fyInput}
                  value={fyBudgetInput}
                  onChangeText={(text) => handleNumberChange(fyBudgetInput, text, setFyBudgetInput)}
                  placeholder="15,000,000"
                  placeholderTextColor="#94A3B8"
                  keyboardType="numeric"
                />
              </View>
              <TouchableOpacity
                style={styles.fySaveBtn}
                onPress={saveFiscalYearConfig}
                disabled={savingFy}
                activeOpacity={0.8}
              >
                {savingFy ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <MaterialIcons name="save" size={16} color="#FFFFFF" />
                    <Text style={styles.fySaveBtnText}>Save Settings</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Budget Sufficiency Status Banner */}
        <View style={[
          styles.fyBanner,
          fySufficiency.status === 'sufficient' ? styles.fyBannerSufficient :
          fySufficiency.status === 'near-limit' ? styles.fyBannerWarning :
          fySufficiency.status === 'insufficient' ? styles.fyBannerDanger : styles.fyBannerNeutral
        ]}>
          <View style={styles.fyBannerIconBox}>
            <MaterialIcons
              name={
                fySufficiency.status === 'sufficient' ? 'check-circle' :
                fySufficiency.status === 'near-limit' ? 'warning' :
                fySufficiency.status === 'insufficient' ? 'error' : 'hourglass-empty'
              }
              size={20}
              color={
                fySufficiency.status === 'sufficient' ? '#059669' :
                fySufficiency.status === 'near-limit' ? '#D97706' :
                fySufficiency.status === 'insufficient' ? '#DC2626' : '#64748B'
              }
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[
              styles.fyBannerTitle,
              fySufficiency.status === 'sufficient' ? { color: '#065F46' } :
              fySufficiency.status === 'near-limit' ? { color: '#92400E' } :
              fySufficiency.status === 'insufficient' ? { color: '#991B1B' } : { color: '#334155' }
            ]}>
              {fySufficiency.status === 'sufficient' ? `✅ BUDGET SUFFICIENT FOR FY ${fiscalConfig.fiscalYear}` :
               fySufficiency.status === 'near-limit' ? `⚠️ BUDGET NEAR CEILING FOR FY ${fiscalConfig.fiscalYear}` :
               fySufficiency.status === 'insufficient' ? `🚨 INSUFFICIENT BUDGET FOR FY ${fiscalConfig.fiscalYear} (DEFICIT WARNING)` :
               `WAITING FOR COST PROJECTION DATA`}
            </Text>
            <Text style={styles.fyBannerText}>
              {fySufficiency.status === 'sufficient' ?
                `Allocated annual budget of ${currency(fySufficiency.allocatedBudget)} fully covers the projected operational cost of ${currency(fySufficiency.projectedAnnualCost)} with an estimated surplus buffer of ${currency(fySufficiency.budgetBuffer)} (${fySufficiency.utilizationRatePercent}% utilized).` :
               fySufficiency.status === 'near-limit' ?
                `Projected annual operational cost of ${currency(fySufficiency.projectedAnnualCost)} reaches ${fySufficiency.utilizationRatePercent}% of the ${currency(fySufficiency.allocatedBudget)} annual allocation. Buffer remaining: ${currency(fySufficiency.budgetBuffer)}.` :
               fySufficiency.status === 'insufficient' ?
                `Projected operational cost of ${currency(fySufficiency.projectedAnnualCost)} exceeds the ${currency(fySufficiency.allocatedBudget)} annual budget by ${currency(Math.abs(fySufficiency.budgetBuffer || 0))}. Additional municipal appropriation or route efficiency adjustments required.` :
                `Enter approved expense records below to calibrate baseline cost per ton and evaluate annual sufficiency.`
              }
            </Text>
          </View>
        </View>

        {/* Sufficiency Metric Cards */}
        <View style={styles.fyMetricsRow}>
          <View style={styles.fyMetric}>
            <Text style={styles.metricLabel}>FY {fiscalConfig.fiscalYear} BUDGET</Text>
            <Text style={[styles.metricValue, { color: '#0F766E' }]}>{currency(fySufficiency.allocatedBudget)}</Text>
            <Text style={styles.fyMetricSub}>City Approved Allocation</Text>
          </View>
          <View style={styles.fyMetric}>
            <Text style={styles.metricLabel}>PROJECTED MONTHLY</Text>
            <Text style={styles.metricValue}>{currency(fySufficiency.projectedMonthlyCost)}</Text>
            <Text style={styles.fyMetricSub}>Validated monthly spend</Text>
          </View>
          <View style={styles.fyMetric}>
            <Text style={styles.metricLabel}>PROJECTED ANNUAL COST</Text>
            <Text style={[styles.metricValue, { color: fySufficiency.isSufficient ? '#1E293B' : '#DC2626' }]}>
              {currency(fySufficiency.projectedAnnualCost)}
            </Text>
            <Text style={styles.fyMetricSub}>12-Month Total Forecast</Text>
          </View>
          <View style={[styles.fyMetric, fySufficiency.isSufficient ? { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' } : { backgroundColor: '#FEF2F2', borderColor: '#FECACA' }]}>
            <Text style={styles.metricLabel}>{fySufficiency.isSufficient ? 'SURPLUS BUFFER' : 'ESTIMATED DEFICIT'}</Text>
            <Text style={[styles.metricValue, { color: fySufficiency.isSufficient ? '#166534' : '#DC2626' }]}>
              {currency(fySufficiency.budgetBuffer)}
            </Text>
            <Text style={styles.fyMetricSub}>
              {fySufficiency.utilizationRatePercent ? `${fySufficiency.utilizationRatePercent}% Utilization Rate` : 'Pending Rate'}
            </Text>
          </View>
        </View>
      </View>

      {/* 2. Expense Validation Card */}
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>ACTUAL EXPENSE VALIDATION / FEATURE 29</Text>
            <Text style={styles.title}>Expense-Based Budget Prediction</Text>
            <Text style={styles.subtitle}>Records approved monthly expenses and actual collected tonnage, backtests the rolling cost rate, then projects the validated baseline forecast.</Text>
          </View>
          <View style={[styles.statusBadge, { borderColor: `${statusColor}55`, backgroundColor: `${statusColor}10` }]}>
            <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
          </View>
        </View>

        <View style={styles.metrics}>
          <View style={styles.metric}><Text style={styles.metricLabel}>ACTUAL PERIODS</Text><Text style={styles.metricValue}>{validation.periodCount}</Text></View>
          <View style={styles.metric}><Text style={styles.metricLabel}>ACTUAL TONNAGE</Text><Text style={styles.metricValue}>{formatAdaptiveMassFromMetricTons(validation.actualTonsTotal)}</Text></View>
          <View style={styles.metric}><Text style={styles.metricLabel}>WEIGHTED COST / TON</Text><Text style={styles.metricValue}>{currency(validation.weightedCostPerTon)}</Text></View>
          <View style={styles.metric}><Text style={styles.metricLabel}>BACKTEST MAPE</Text><Text style={styles.metricValue}>{validation.validationMapePercent === null ? '—' : `${validation.validationMapePercent}%`}</Text></View>
          <View style={[styles.metric, styles.projectionMetric]}><Text style={styles.metricLabel}>PROJECTED MONTHLY</Text><Text style={[styles.metricValue, { color: '#166534' }]}>{currency(validation.projectedTotalCost)}</Text></View>
        </View>

        <View style={styles.form}>
          <TextInput
            style={styles.input}
            value={period}
            onChangeText={setPeriod}
            placeholder="YYYY-MM"
            placeholderTextColor="#94A3B8"
            maxLength={7}
          />
          <TextInput
            style={styles.input}
            value={amount}
            onChangeText={(text) => handleNumberChange(amount, text, setAmount)}
            placeholder="Actual expense (₱)"
            placeholderTextColor="#94A3B8"
            keyboardType="decimal-pad"
          />
          <TextInput
            style={styles.input}
            value={tons}
            onChangeText={(text) => handleNumberChange(tons, text, setTons)}
            placeholder="Actual tons collected"
            placeholderTextColor="#94A3B8"
            keyboardType="decimal-pad"
          />
          <TextInput
            style={[styles.input, { flex: 1.5 }]}
            value={notes}
            onChangeText={setNotes}
            placeholder="Reference or notes"
            placeholderTextColor="#94A3B8"
          />
        </View>
        <View style={styles.categoryRow}>
          {categories.map(item => (
            <TouchableOpacity key={item} style={[styles.categoryChip, category === item && styles.categoryChipActive]} onPress={() => setCategory(item)}>
              <Text style={[styles.categoryText, category === item && styles.categoryTextActive]}>{item}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.saveButton} onPress={saveRecord} disabled={saving}>
            {saving ? <ActivityIndicator size="small" color="#FFFFFF" /> : <MaterialIcons name="add-chart" size={18} color="#FFFFFF" />}
            <Text style={styles.saveText}>Add Actual Record</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.recordsBox}>
          <Text style={styles.recordsTitle}>RECENT APPROVED COST RECORDS</Text>
          {loading ? <ActivityIndicator color="#2E8B57" style={{ marginVertical: 16 }} /> : records.length === 0 ? (
            <Text style={styles.emptyText}>No real expense records yet. Add the first approved period above; no sample costs are inserted.</Text>
          ) : records.slice(0, 6).map(record => (
            <View key={record.id} style={styles.recordRow}>
              <Text style={styles.recordPeriod}>{record.period}</Text>
              <Text style={styles.recordCategory}>{record.category}</Text>
              <Text style={styles.recordAmount}>{currency(record.amount)}</Text>
              <Text style={styles.recordTons}>{formatAdaptiveMassFromMetricTons(record.collectedTons)}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.disclaimer}>“Backtested” means the rolling cost model has at least three real periods and ≤20% MAPE. CENRO must still approve the records and planning decision.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#BBF7D0', borderRadius: 16, padding: 20 },
  fyCard: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#99F6E4', borderRadius: 16, padding: 20 },
  fyEyebrow: { color: '#0D9488', fontSize: 10, fontWeight: '900', letterSpacing: 1.1 },
  fyEditBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#F0FDFA', borderWidth: 1, borderColor: '#CCFBF1', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  fyEditBtnText: { color: '#0F766E', fontSize: 11, fontWeight: '800' },
  fyEditForm: { backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, padding: 14, marginTop: 14 },
  fyEditFormTitle: { color: '#0F172A', fontSize: 12, fontWeight: '800', marginBottom: 10 },
  fyEditInputRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' },
  fyInputLabel: { color: '#475569', fontSize: 9, fontWeight: '800', letterSpacing: 0.5, marginBottom: 4 },
  fyInput: { borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, color: '#0F172A', backgroundColor: '#FFFFFF' },
  fySaveBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#0D9488', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9 },
  fySaveBtnText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  fyBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, borderRadius: 12, padding: 14, marginTop: 16, borderWidth: 1 },
  fyBannerSufficient: { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' },
  fyBannerWarning: { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' },
  fyBannerDanger: { backgroundColor: '#FEF2F2', borderColor: '#FECACA' },
  fyBannerNeutral: { backgroundColor: '#F8FAFC', borderColor: '#E2E8F0' },
  fyBannerIconBox: { marginTop: 2 },
  fyBannerTitle: { fontSize: 12, fontWeight: '900', letterSpacing: 0.6, marginBottom: 3 },
  fyBannerText: { fontSize: 11, lineHeight: 17, color: '#334155' },
  fyMetricsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16 },
  fyMetric: { flex: 1, minWidth: 140, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 11, padding: 12 },
  fyMetricSub: { color: '#64748B', fontSize: 9, marginTop: 4, fontWeight: '600' },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 },
  eyebrow: { color: '#15803D', fontSize: 10, fontWeight: '900', letterSpacing: 1.1, marginBottom: 5 },
  title: { color: '#111827', fontSize: 18, fontWeight: '900' },
  subtitle: { color: '#64748B', fontSize: 12, lineHeight: 18, marginTop: 5, maxWidth: 800 },
  statusBadge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 7 },
  statusText: { fontSize: 9, fontWeight: '900' },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 18 },
  metric: { flex: 1, minWidth: 140, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 11, padding: 12 },
  projectionMetric: { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' },
  metricLabel: { color: '#64748B', fontSize: 8, fontWeight: '900', letterSpacing: 0.7 },
  metricValue: { color: '#111827', fontSize: 15, fontWeight: '900', marginTop: 5 },
  form: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 16 },
  input: { flex: 1, minWidth: 140, borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 9, paddingHorizontal: 11, paddingVertical: 10, color: '#0F172A' },
  categoryRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 10 },
  categoryChip: { borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 999, paddingHorizontal: 11, paddingVertical: 7 },
  categoryChipActive: { backgroundColor: '#DCFCE7', borderColor: '#86EFAC' },
  categoryText: { color: '#64748B', fontSize: 10, fontWeight: '700' },
  categoryTextActive: { color: '#166534' },
  saveButton: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#15803D', borderRadius: 9, paddingHorizontal: 14, paddingVertical: 9 },
  saveText: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
  recordsBox: { backgroundColor: '#F8FAFC', borderRadius: 11, padding: 13, marginTop: 14 },
  recordsTitle: { color: '#475569', fontSize: 9, fontWeight: '900', letterSpacing: 0.8, marginBottom: 7 },
  emptyText: { color: '#64748B', fontSize: 11, lineHeight: 17, paddingVertical: 8 },
  recordRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  recordPeriod: { width: 70, color: '#0F172A', fontSize: 11, fontWeight: '800' },
  recordCategory: { flex: 1, color: '#475569', fontSize: 11 },
  recordAmount: { width: 110, textAlign: 'right', color: '#0F172A', fontSize: 11, fontWeight: '800' },
  recordTons: { width: 90, textAlign: 'right', color: '#64748B', fontSize: 10 },
  disclaimer: { color: '#64748B', fontSize: 10, lineHeight: 16, marginTop: 12 },
});

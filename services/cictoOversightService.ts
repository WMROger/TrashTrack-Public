import { auth, db } from '@/config/firebase';
import {
  addDoc,
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  where,
} from 'firebase/firestore';

export type CictoOversightSnapshot = {
  generatedAt: string;
  counts: Record<string, number>;
  roles: Record<string, number>;
  operations: {
    activeFleet: number;
    staleFleet: number;
    pendingReports: number;
    completedSchedules: number;
    activeSchedules: number;
  };
  dataQuality: {
    reportsMissingGps: number;
    completedSchedulesMissingMeasurement: number;
    expensePeriods: number;
  };
  fleetLocations: any[];
  recentAudit: any[];
  recentErrors: any[];
  recentActivity: any[];
  expenseRecords: any[];
  messages: any[];
};


const normalizeValue = (value: any): any => {
  if (value?.toDate) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeValue(item)]));
  }
  return value;
};

const rows = (snapshot: any) => snapshot.docs.map((item: any) => ({ id: item.id, ...normalizeValue(item.data()) }));
const safeGet = async (reference: any) => getDocs(reference).catch(() => ({ docs: [], size: 0 } as any));

export async function getCictoOversightSnapshot(): Promise<CictoOversightSnapshot> {
  if (!db) throw new Error('Firestore is unavailable.');
  const [users, reports, schedules, trucks, locations, audit, errors, activity, fuelExp, laborExp, maintExp, dispExp, otherExp, itemExp, messages, announcements] = await Promise.all([
    safeGet(collection(db, 'users')),
    safeGet(collection(db, 'reports')),
    safeGet(collection(db, 'schedules')),
    safeGet(collection(db, 'trucks')),
    safeGet(collection(db, 'truck_locations')),
    safeGet(query(collection(db, 'audit_logs'), orderBy('createdAt', 'desc'), limit(20))),
    safeGet(query(collection(db, 'error_logs'), orderBy('createdAt', 'desc'), limit(12))),
    safeGet(query(collection(db, 'client_activity'), orderBy('createdAt', 'desc'), limit(250))),
    safeGet(query(collection(db, 'analytics', 'expense_records', 'fuel'), orderBy('period', 'desc'), limit(50))),
    safeGet(query(collection(db, 'analytics', 'expense_records', 'labor'), orderBy('period', 'desc'), limit(50))),
    safeGet(query(collection(db, 'analytics', 'expense_records', 'maintenance'), orderBy('period', 'desc'), limit(50))),
    safeGet(query(collection(db, 'analytics', 'expense_records', 'disposal'), orderBy('period', 'desc'), limit(50))),
    safeGet(query(collection(db, 'analytics', 'expense_records', 'other'), orderBy('period', 'desc'), limit(50))),
    safeGet(query(collection(db, 'analytics', 'expense_records', 'items'), orderBy('period', 'desc'), limit(50))),
    safeGet(query(collection(db, 'interagency_messages'), where('channelId', 'in', ['general-command', 'urgent-advisories', 'fleet-dispatch', 'incident-escalation', 'system-governance']), limit(50))),
    safeGet(collection(db, 'announcements')),
  ]);

  const userRows = rows(users);
  const reportRows = rows(reports);
  const scheduleRows = rows(schedules);
  const locationRows = rows(locations);
  const messageRows = rows(messages).sort((a: any, b: any) => {
    const timeA = new Date(a.createdAt || 0).getTime();
    const timeB = new Date(b.createdAt || 0).getTime();
    return timeB - timeA;
  });
  const expenseRows = [
    ...rows(fuelExp),
    ...rows(laborExp),
    ...rows(maintExp),
    ...rows(dispExp),
    ...rows(otherExp),
    ...rows(itemExp),
  ];
  const expenseCount = fuelExp.size + laborExp.size + maintExp.size + dispExp.size + otherExp.size + itemExp.size;
  const now = Date.now();
  const activeFleet = locationRows.filter((item: any) => (
    item.status === 'active' && now - new Date(item.lastUpdate || 0).getTime() <= 2 * 60 * 1000
  )).length;

  const truckRows = rows(trucks);
  const userMap = new Map(userRows.map((u: any) => [u.id, u]));
  const truckMap = new Map(truckRows.map((t: any) => [t.id, t]));

  const enrichedFleetLocations = locationRows.map((item: any, idx: number) => {
    const truckData: any = truckMap.get(item.truckId) || truckRows.find((t: any) => t.plateNumber && (t.plateNumber === item.plateNumber || t.plateNumber === item.plate));
    const driverData: any = userMap.get(item.driverId) || userMap.get(item.id);
    const resolvedPlate = item.plateNumber || item.plate || truckData?.plateNumber || `Truck #${idx + 1}`;
    const resolvedDriver = item.driverName || driverData?.displayName || driverData?.name || 'Assigned Driver';
    return {
      ...item,
      plateNumber: resolvedPlate,
      plate: resolvedPlate,
      driverName: resolvedDriver,
      model: truckData?.model,
      capacity: truckData?.capacity,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    counts: {
      users: users.size,
      reports: reports.size,
      schedules: schedules.size,
      trucks: trucks.size,
      announcements: announcements.size,
      expenses: expenseCount,
      auditEvents: audit.size,
      errorEvents: errors.size,
      directives: messages.size,
    },
    roles: userRows.reduce((summary: Record<string, number>, item: any) => {
      let role = String(item.role || 'user').toLowerCase();
      if (role === 'dict') return summary; // Exclude obsolete DICT role
      if (role === 'admin') role = 'cenro';
      summary[role] = (summary[role] || 0) + 1;
      return summary;
    }, {}),
    operations: {
      activeFleet,
      staleFleet: locationRows.filter((item: any) => item.status === 'active').length - activeFleet,
      pendingReports: reportRows.filter((item: any) => ['pending', 'acknowledged', 'in-progress'].includes(String(item.status))).length,
      completedSchedules: scheduleRows.filter((item: any) => ['completed', 'done'].includes(String(item.status))).length,
      activeSchedules: scheduleRows.filter((item: any) => ['pending', 'in-progress'].includes(String(item.status))).length,
    },
    dataQuality: {
      reportsMissingGps: reportRows.filter((item: any) => (
        !Number.isFinite(item.location?.lat ?? item.location?.latitude)
        || !Number.isFinite(item.location?.lng ?? item.location?.longitude)
      )).length,
      completedSchedulesMissingMeasurement: scheduleRows.filter((item: any) => (
        ['completed', 'done'].includes(String(item.status)) && !(Number(item.collectionMeasurement?.value) > 0)
      )).length,
      expensePeriods: new Set(expenseRows.map((item: any) => item.period).filter(Boolean)).size,
    },
    fleetLocations: enrichedFleetLocations,
    recentAudit: rows(audit),
    recentErrors: rows(errors),
    recentActivity: rows(activity),
    expenseRecords: expenseRows,
    messages: messageRows.slice(0, 30),
  };
}


export interface InteragencyMessageInput {
  message: string;
  subject?: string;
  priority?: 'normal' | 'high' | 'urgent';
  channelId?: string;
  senderRole?: 'cicto' | 'admin' | 'cenro' | 'coordinator' | 'mayor';
  senderName?: string;
  senderEmail?: string;
}

export async function sendInteragencyMessage(input: InteragencyMessageInput) {
  if (!db || !auth.currentUser) throw new Error('Authentication is required to send inter-agency dispatches.');
  const message = input.message.trim();
  if (message.length < 1 || message.length > 3000) {
    throw new Error('Please enter a message to transmit.');
  }
  const senderRole = input.senderRole || 'cicto';
  const priority = input.priority || 'normal';
  const subject = input.subject?.trim() || (priority === 'urgent' ? '🚨 URGENT DIRECTIVE' : priority === 'high' ? '⚡ PRIORITY ADVISORY' : 'Operational Dispatch');
  const channelId = input.channelId || 'general-command';
  
  const defaultName = senderRole === 'cicto'
    ? 'CICTO Controller'
    : senderRole === 'coordinator'
    ? 'Barangay Coordinator'
    : senderRole === 'mayor'
    ? 'Office of the Mayor'
    : 'CENRO Administrator';

  const messageRef = await addDoc(collection(db, 'interagency_messages'), {
    subject,
    message,
    priority,
    channelId,
    senderUid: auth.currentUser.uid,
    senderName: input.senderName || auth.currentUser.displayName || defaultName,
    senderEmail: input.senderEmail || auth.currentUser.email || '',
    senderRole,
    status: 'sent',
    deliveryMode: 'spark-firestore',
    createdAt: serverTimestamp(),
  });
  return { id: messageRef.id };
}

export async function sendCictoCommand(input: { subject: string; message: string; priority: 'normal' | 'high' | 'urgent'; channelId?: string }) {
  if (!db || !auth.currentUser) throw new Error('An authenticated CICTO account is required.');
  const subject = input.subject.trim();
  const message = input.message.trim();
  if (subject.length < 2 || subject.length > 120 || message.length < 1 || message.length > 3000) {
    throw new Error('Enter a valid subject and command message.');
  }
  const messageRef = await addDoc(collection(db, 'interagency_messages'), {
    subject,
    message,
    priority: input.priority,
    channelId: input.channelId || 'general-command',
    senderUid: auth.currentUser.uid,
    senderName: auth.currentUser.displayName || 'CICTO Controller',
    senderEmail: auth.currentUser.email || '',
    senderRole: 'cicto',
    status: 'sent',
    deliveryMode: 'spark-firestore',
    createdAt: serverTimestamp(),
  });
  const admins = await getDocs(query(collection(db, 'users'), where('role', '==', 'admin')));
  return { id: messageRef.id, recipientCount: admins.size };
}


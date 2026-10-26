import { MaterialIcons } from '@expo/vector-icons';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';

import { auth, db } from '@/config/firebase';

export interface SupportTicket {
  id: string;
  subject: string;
  category: string;
  priority: 'Normal' | 'Urgent' | 'Critical';
  description: string;
  barangay?: string;
  status: 'open' | 'in-progress' | 'resolved' | 'closed';
  createdByEmail: string;
  createdByName: string;
  createdByUid: string;
  createdByRole: string;
  createdAt: any;
  resolutionNotes?: string;
  resolvedAt?: any;
  resolvedByEmail?: string;
  resolvedByName?: string;
  inProgressAt?: any;
  inProgressBy?: string;
}

interface CictoHelpdeskTabProps {
  onNavigateTab?: (tab: string) => void;
}

export default function CictoHelpdeskTab({ onNavigateTab }: CictoHelpdeskTabProps) {
  const { width } = useWindowDimensions();
  const isMobile = width < 768;

  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'in-progress' | 'resolved' | 'closed'>('all');
  const [priorityFilter, setPriorityFilter] = useState<'all' | 'Normal' | 'Urgent' | 'Critical'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [barangayFilter, setBarangayFilter] = useState<string>('all');

  // Resolution Modal State
  const [resolvingTicket, setResolvingTicket] = useState<SupportTicket | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [isSubmittingResolution, setIsSubmittingResolution] = useState(false);

  // Real-time listener
  useEffect(() => {
    if (!db) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const q = query(collection(db, 'support_tickets'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: SupportTicket[] = [];
        snapshot.forEach((docSnap) => {
          list.push({ id: docSnap.id, ...docSnap.data() } as SupportTicket);
        });
        setTickets(list);
        setLoading(false);
        setError('');
      },
      (err) => {
        console.warn('CictoHelpdeskTab: Firestore onSnapshot error:', err);
        setError('Failed to load support tickets stream: ' + err.message);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  // Summary Metrics
  const metrics = useMemo(() => {
    const total = tickets.length;
    const openCount = tickets.filter((t) => t.status === 'open').length;
    const inProgressCount = tickets.filter((t) => t.status === 'in-progress').length;
    const resolvedCount = tickets.filter((t) => t.status === 'resolved' || t.status === 'closed').length;
    const urgentCount = tickets.filter((t) => (t.priority === 'Urgent' || t.priority === 'Critical') && t.status !== 'resolved' && t.status !== 'closed').length;
    return { total, openCount, inProgressCount, resolvedCount, urgentCount };
  }, [tickets]);

  // Unique categories and barangays for dropdown/filter
  const categories = useMemo(() => {
    const set = new Set<string>();
    tickets.forEach((t) => {
      if (t.category) set.add(t.category);
    });
    return Array.from(set);
  }, [tickets]);

  const barangays = useMemo(() => {
    const set = new Set<string>();
    tickets.forEach((t) => {
      if (t.barangay) set.add(t.barangay);
    });
    return Array.from(set).sort();
  }, [tickets]);

  // Filtered tickets
  const filteredTickets = useMemo(() => {
    return tickets.filter((t) => {
      // Status
      if (statusFilter !== 'all' && t.status !== statusFilter) return false;

      // Priority
      if (priorityFilter !== 'all' && t.priority !== priorityFilter) return false;

      // Category
      if (categoryFilter !== 'all' && t.category !== categoryFilter) return false;

      // Barangay
      if (barangayFilter !== 'all' && t.barangay !== barangayFilter) return false;

      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesSubject = (t.subject || '').toLowerCase().includes(q);
        const matchesDesc = (t.description || '').toLowerCase().includes(q);
        const matchesUser = (t.createdByName || '').toLowerCase().includes(q);
        const matchesEmail = (t.createdByEmail || '').toLowerCase().includes(q);
        const matchesBrgy = (t.barangay || '').toLowerCase().includes(q);
        if (!matchesSubject && !matchesDesc && !matchesUser && !matchesEmail && !matchesBrgy) {
          return false;
        }
      }

      return true;
    });
  }, [tickets, statusFilter, priorityFilter, categoryFilter, barangayFilter, searchQuery]);

  // Status Update Handlers
  const handleMarkInProgress = async (ticket: SupportTicket) => {
    if (!db) return;
    try {
      const currentUser = auth?.currentUser;
      const ref = doc(db, 'support_tickets', ticket.id);
      await updateDoc(ref, {
        status: 'in-progress',
        inProgressAt: serverTimestamp(),
        inProgressBy: currentUser?.displayName || currentUser?.email || 'CICTO Admin',
      });
    } catch (e: any) {
      console.error('Failed to mark in-progress:', e);
      showAlert('Error', e?.message || 'Failed to update ticket status.');
    }
  };

  const handleOpenResolveModal = (ticket: SupportTicket) => {
    setResolvingTicket(ticket);
    setResolutionNotes(ticket.resolutionNotes || '');
  };

  const handleConfirmResolve = async () => {
    if (!resolvingTicket || !db) return;
    setIsSubmittingResolution(true);
    try {
      const currentUser = auth?.currentUser;
      const ref = doc(db, 'support_tickets', resolvingTicket.id);
      await updateDoc(ref, {
        status: 'resolved',
        resolutionNotes: resolutionNotes.trim() || 'Issue verified and resolved by CICTO IT Command.',
        resolvedAt: serverTimestamp(),
        resolvedByEmail: currentUser?.email || 'cicto@trashtrack.gov.ph',
        resolvedByName: currentUser?.displayName || 'CICTO IT Authority',
      });

      setResolvingTicket(null);
      setResolutionNotes('');
      showAlert('Ticket Resolved', 'The support ticket has been marked as Resolved and filed.');
    } catch (e: any) {
      console.error('Failed to resolve ticket:', e);
      showAlert('Error', e?.message || 'Failed to resolve ticket.');
    } finally {
      setIsSubmittingResolution(false);
    }
  };

  const handleReopenTicket = async (ticket: SupportTicket) => {
    if (!db) return;
    try {
      const ref = doc(db, 'support_tickets', ticket.id);
      await updateDoc(ref, {
        status: 'open',
      });
      showAlert('Ticket Reopened', 'The ticket has been set back to Under Review.');
    } catch (e: any) {
      showAlert('Error', e?.message || 'Failed to reopen ticket.');
    }
  };

  const handleCloseTicket = async (ticket: SupportTicket) => {
    if (!db) return;
    try {
      const ref = doc(db, 'support_tickets', ticket.id);
      await updateDoc(ref, {
        status: 'closed',
      });
      showAlert('Ticket Closed', 'The ticket has been archived as Closed.');
    } catch (e: any) {
      showAlert('Error', e?.message || 'Failed to close ticket.');
    }
  };

  const handleDeleteTicket = async (ticket: SupportTicket) => {
    const doDelete = async () => {
      try {
        const ref = doc(db, 'support_tickets', ticket.id);
        await deleteDoc(ref);
        showAlert('Deleted', 'Ticket has been permanently removed.');
      } catch (e: any) {
        showAlert('Error', e?.message || 'Failed to delete ticket.');
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm(`Are you sure you want to delete ticket "${ticket.subject}"?`)) {
        await doDelete();
      }
    } else {
      Alert.alert(
        'Delete Support Ticket',
        `Are you sure you want to delete ticket "${ticket.subject}"?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: doDelete },
        ]
      );
    }
  };

  const showAlert = (title: string, message: string) => {
    if (Platform.OS === 'web') {
      window.alert(`${title}: ${message}`);
    } else {
      Alert.alert(title, message);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      {/* Header Section */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>CICTO / IT HELPDESK & FIELD DISPATCH TICKETS</Text>
          <Text style={styles.title}>Support & Incident Management</Text>
          <Text style={styles.sub}>
            Review, triage, and resolve incoming technical and operational support requests logged by Barangay Field Coordinators and CENRO Administrators.
          </Text>
        </View>

        <View style={styles.headerRight}>
          <View style={styles.liveSyncBadge}>
            <View style={styles.liveDot} />
            <Text style={styles.liveSyncText}>Real-Time Telemetry Desk</Text>
          </View>
        </View>
      </View>

      {/* Metrics Cards */}
      <View style={[styles.metricsGrid, isMobile && styles.metricsGridMobile]}>
        <View style={styles.metricCard}>
          <View style={styles.metricIconWrap}>
            <MaterialIcons name="confirmation-number" size={20} color="#0D9488" />
          </View>
          <View>
            <Text style={styles.metricValue}>{metrics.total}</Text>
            <Text style={styles.metricLabel}>Total Requests Logged</Text>
          </View>
        </View>

        <View style={[styles.metricCard, metrics.openCount > 0 && styles.metricCardAlert]}>
          <View style={[styles.metricIconWrap, { backgroundColor: '#FEF3C7' }]}>
            <MaterialIcons name="pending-actions" size={20} color="#D97706" />
          </View>
          <View>
            <Text style={[styles.metricValue, { color: '#B45309' }]}>{metrics.openCount}</Text>
            <Text style={styles.metricLabel}>Under Review (Pending)</Text>
          </View>
        </View>

        <View style={styles.metricCard}>
          <View style={[styles.metricIconWrap, { backgroundColor: '#DBEAFE' }]}>
            <MaterialIcons name="engineering" size={20} color="#2563EB" />
          </View>
          <View>
            <Text style={[styles.metricValue, { color: '#1D4ED8' }]}>{metrics.inProgressCount}</Text>
            <Text style={styles.metricLabel}>In Investigation</Text>
          </View>
        </View>

        <View style={styles.metricCard}>
          <View style={[styles.metricIconWrap, { backgroundColor: '#DCFCE7' }]}>
            <MaterialIcons name="check-circle" size={20} color="#16A34A" />
          </View>
          <View>
            <Text style={[styles.metricValue, { color: '#15803D' }]}>{metrics.resolvedCount}</Text>
            <Text style={styles.metricLabel}>Resolved & Closed</Text>
          </View>
        </View>
      </View>

      {/* Filter and Search Bar */}
      <View style={styles.filterCard}>
        {/* Search Input */}
        <View style={styles.searchRow}>
          <View style={styles.searchBox}>
            <MaterialIcons name="search" size={20} color="#94A3B8" style={{ marginRight: 8 }} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search by ticket subject, description, coordinator name, or barangay..."
              placeholderTextColor="#94A3B8"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <MaterialIcons name="close" size={18} color="#94A3B8" />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Status Pills */}
        <View style={styles.pillsRow}>
          <Text style={styles.filterSectionLabel}>STATUS:</Text>
          {(
            [
              { id: 'all', label: `All (${metrics.total})` },
              { id: 'open', label: `Under Review (${metrics.openCount})` },
              { id: 'in-progress', label: `In Progress (${metrics.inProgressCount})` },
              { id: 'resolved', label: `Resolved (${metrics.resolvedCount})` },
            ] as const
          ).map((s) => {
            const active = statusFilter === s.id;
            return (
              <TouchableOpacity
                key={s.id}
                style={[styles.pill, active && styles.pillActive]}
                onPress={() => setStatusFilter(s.id)}
                activeOpacity={0.7}
              >
                <Text style={[styles.pillText, active && styles.pillTextActive]}>{s.label}</Text>
              </TouchableOpacity>
            );
          })}

          <View style={styles.dividerV} />

          <Text style={styles.filterSectionLabel}>PRIORITY:</Text>
          {(['all', 'Critical', 'Urgent', 'Normal'] as const).map((p) => {
            const active = priorityFilter === p;
            return (
              <TouchableOpacity
                key={p}
                style={[styles.pill, active && styles.pillActive]}
                onPress={() => setPriorityFilter(p)}
                activeOpacity={0.7}
              >
                <Text style={[styles.pillText, active && styles.pillTextActive]}>
                  {p === 'all' ? 'All Priorities' : p}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Ticket Feed List */}
      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color="#0D9488" />
          <Text style={styles.loadingText}>Syncing IT Support Tickets...</Text>
        </View>
      ) : error ? (
        <View style={styles.errorBox}>
          <MaterialIcons name="error-outline" size={24} color="#DC2626" />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : filteredTickets.length === 0 ? (
        <View style={styles.emptyState}>
          <MaterialIcons name="task-alt" size={48} color="#CBD5E1" />
          <Text style={styles.emptyTitle}>No Support Tickets Found</Text>
          <Text style={styles.emptySub}>
            {searchQuery || statusFilter !== 'all' || priorityFilter !== 'all'
              ? 'No tickets match the selected filter criteria.'
              : 'All systems are running smoothly! No incoming support tickets from field staff.'}
          </Text>
        </View>
      ) : (
        <View style={styles.ticketList}>
          {filteredTickets.map((ticket) => {
            const isPending = ticket.status === 'open';
            const isInProgress = ticket.status === 'in-progress';
            const isResolved = ticket.status === 'resolved' || ticket.status === 'closed';

            const pColor = {
              Critical: { bg: '#FEE2E2', border: '#EF4444', text: '#B91C1C' },
              Urgent: { bg: '#FEF3C7', border: '#F59E0B', text: '#B45309' },
              Normal: { bg: '#EFF6FF', border: '#3B82F6', text: '#1D4ED8' },
            }[ticket.priority] || { bg: '#F1F5F9', border: '#CBD5E1', text: '#475569' };

            const statusBadge = {
              open: { bg: '#FEF3C7', text: '#B45309', label: 'Under Review' },
              'in-progress': { bg: '#DBEAFE', text: '#1E40AF', label: 'In Progress' },
              resolved: { bg: '#D1FAE5', text: '#065F46', label: 'Resolved' },
              closed: { bg: '#F1F5F9', text: '#475569', label: 'Closed' },
            }[ticket.status] || { bg: '#F1F5F9', text: '#475569', label: ticket.status };

            const dateStr = ticket.createdAt?.toDate
              ? ticket.createdAt.toDate().toLocaleString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : 'Just now';

            return (
              <View key={ticket.id} style={[styles.ticketCard, isPending && styles.ticketCardPending]}>
                {/* Top Info Bar */}
                <View style={styles.ticketCardHeader}>
                  <View style={{ flex: 1, paddingRight: 12 }}>
                    <View style={styles.ticketTitleRow}>
                      <Text style={styles.ticketSubject}>{ticket.subject}</Text>
                      <View style={[styles.priorityBadge, { backgroundColor: pColor.bg, borderColor: pColor.border }]}>
                        <Text style={[styles.priorityBadgeText, { color: pColor.text }]}>{ticket.priority}</Text>
                      </View>
                      <View style={[styles.statusBadge, { backgroundColor: statusBadge.bg }]}>
                        <Text style={[styles.statusBadgeText, { color: statusBadge.text }]}>
                          {statusBadge.label}
                        </Text>
                      </View>
                    </View>

                    {/* Metadata Sub-row */}
                    <View style={styles.ticketMetaRow}>
                      <View style={styles.metaBadge}>
                        <MaterialIcons name="person" size={13} color="#64748B" />
                        <Text style={styles.metaBadgeText}>{ticket.createdByName || 'Unknown'}</Text>
                      </View>

                      <View style={styles.metaBadge}>
                        <MaterialIcons name="verified-user" size={13} color="#0D9488" />
                        <Text style={[styles.metaBadgeText, { color: '#0F766E', textTransform: 'capitalize' }]}>
                          {ticket.createdByRole || 'Field Staff'}
                        </Text>
                      </View>

                      {ticket.barangay ? (
                        <View style={[styles.metaBadge, { backgroundColor: '#F0FDF4' }]}>
                          <MaterialIcons name="place" size={13} color="#16A34A" />
                          <Text style={[styles.metaBadgeText, { color: '#166534', fontWeight: '700' }]}>
                            Brgy. {ticket.barangay}
                          </Text>
                        </View>
                      ) : null}

                      <View style={styles.metaBadge}>
                        <MaterialIcons name="label" size={13} color="#64748B" />
                        <Text style={styles.metaBadgeText}>{ticket.category}</Text>
                      </View>

                      <View style={styles.metaBadge}>
                        <MaterialIcons name="schedule" size={13} color="#94A3B8" />
                        <Text style={styles.metaBadgeText}>{dateStr}</Text>
                      </View>
                    </View>
                  </View>

                  <View style={styles.ticketTopActions}>
                    <TouchableOpacity
                      style={styles.iconActionBtn}
                      onPress={() => handleDeleteTicket(ticket)}
                      accessibilityLabel="Delete Ticket"
                    >
                      <MaterialIcons name="delete-outline" size={18} color="#94A3B8" />
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Description Body */}
                <View style={styles.ticketBody}>
                  <Text style={styles.ticketBodyLabel}>DETAILS & OPERATIONAL CONTEXT:</Text>
                  <Text style={styles.ticketBodyText}>{ticket.description}</Text>
                </View>

                {/* Resolution / Investigation Notes if available */}
                {ticket.resolutionNotes || isResolved ? (
                  <View style={styles.resolutionContainer}>
                    <View style={styles.resolutionHeader}>
                      <MaterialIcons name="verified" size={16} color="#059669" />
                      <Text style={styles.resolutionTitle}>CICTO Resolution & Action Taken</Text>
                      {ticket.resolvedByName && (
                        <Text style={styles.resolutionBy}>by {ticket.resolvedByName}</Text>
                      )}
                    </View>
                    <Text style={styles.resolutionText}>
                      {ticket.resolutionNotes || 'No specific notes recorded. Ticket marked resolved.'}
                    </Text>
                  </View>
                ) : null}

                {/* Action Buttons Row */}
                <View style={styles.ticketActionsRow}>
                  <View style={styles.actionsLeft}>
                    <TouchableOpacity
                      style={styles.secondaryActionBtn}
                      onPress={() => onNavigateTab?.('cenro-command')}
                      activeOpacity={0.7}
                    >
                      <MaterialIcons name="forum" size={16} color="#0D9488" />
                      <Text style={styles.secondaryActionBtnText}>Inter-Agency Chat</Text>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.actionsRight}>
                    {isPending && (
                      <TouchableOpacity
                        style={styles.progressBtn}
                        onPress={() => handleMarkInProgress(ticket)}
                        activeOpacity={0.7}
                      >
                        <MaterialIcons name="pending" size={16} color="#FFFFFF" />
                        <Text style={styles.progressBtnText}>Investigate / In Progress</Text>
                      </TouchableOpacity>
                    )}

                    {!isResolved ? (
                      <TouchableOpacity
                        style={styles.resolveBtn}
                        onPress={() => handleOpenResolveModal(ticket)}
                        activeOpacity={0.7}
                      >
                        <MaterialIcons name="check" size={16} color="#FFFFFF" />
                        <Text style={styles.resolveBtnText}>Resolve Ticket</Text>
                      </TouchableOpacity>
                    ) : (
                      <>
                        <TouchableOpacity
                          style={styles.reopenBtn}
                          onPress={() => handleReopenTicket(ticket)}
                          activeOpacity={0.7}
                        >
                          <MaterialIcons name="replay" size={16} color="#475569" />
                          <Text style={styles.reopenBtnText}>Reopen</Text>
                        </TouchableOpacity>

                        {ticket.status !== 'closed' && (
                          <TouchableOpacity
                            style={styles.closeBtn}
                            onPress={() => handleCloseTicket(ticket)}
                            activeOpacity={0.7}
                          >
                            <MaterialIcons name="archive" size={16} color="#475569" />
                            <Text style={styles.closeBtnText}>Archive / Close</Text>
                          </TouchableOpacity>
                        )}
                      </>
                    )}
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {/* Resolution Modal */}
      <Modal
        visible={!!resolvingTicket}
        transparent
        animationType="fade"
        onRequestClose={() => setResolvingTicket(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderTitleRow}>
                <MaterialIcons name="task-alt" size={22} color="#059669" />
                <Text style={styles.modalTitle}>Resolve Support Ticket</Text>
              </View>
              <TouchableOpacity onPress={() => setResolvingTicket(null)}>
                <MaterialIcons name="close" size={22} color="#64748B" />
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              <Text style={styles.modalTicketSubject}>
                Subject: <Text style={{ fontWeight: '700' }}>{resolvingTicket?.subject}</Text>
              </Text>
              <Text style={styles.modalTicketMeta}>
                Requested by {resolvingTicket?.createdByName} • Brgy. {resolvingTicket?.barangay || 'Danao City'}
              </Text>

              <Text style={styles.modalInputLabel}>
                RESOLUTION & CORRECTIVE ACTION NOTES <Text style={{ color: '#EF4444' }}>*</Text>
              </Text>
              <TextInput
                style={styles.modalTextArea}
                placeholder="Describe resolution taken (e.g. Telemetry gateway reconnected, GPS coordinates refreshed, driver cache reset)..."
                placeholderTextColor="#94A3B8"
                multiline
                numberOfLines={4}
                value={resolutionNotes}
                onChangeText={setResolutionNotes}
                textAlignVertical="top"
              />
            </View>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setResolvingTicket(null)}
                disabled={isSubmittingResolution}
              >
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalConfirmBtn}
                onPress={handleConfirmResolve}
                disabled={isSubmittingResolution}
              >
                {isSubmittingResolution ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <MaterialIcons name="check-circle" size={17} color="#FFFFFF" style={{ marginRight: 6 }} />
                    <Text style={styles.modalConfirmBtnText}>Mark Resolved & Notify</Text>
                  </>
                )}
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
  content: {
    padding: 24,
    paddingBottom: 60,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
    flexWrap: 'wrap',
    gap: 12,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0D9488',
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  title: {
    fontSize: 24,
    fontWeight: '900',
    color: '#0F172A',
    letterSpacing: -0.5,
  },
  sub: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 4,
    maxWidth: 720,
    lineHeight: 18,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  liveSyncBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 6,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10B981',
  },
  liveSyncText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#065F46',
  },
  metricsGrid: {
    flexDirection: 'row',
    gap: 14,
    marginBottom: 20,
  },
  metricsGridMobile: {
    flexDirection: 'column',
  },
  metricCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 12,
  },
  metricCardAlert: {
    borderColor: '#FDE68A',
    backgroundColor: '#FFFDF5',
  },
  metricIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#CCFBF1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricValue: {
    fontSize: 20,
    fontWeight: '900',
    color: '#0F172A',
  },
  metricLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
    marginTop: 1,
  },
  filterCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 20,
    gap: 12,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: '#0F172A',
    padding: 0,
    outlineStyle: 'none' as any,
  },
  pillsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterSectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#94A3B8',
    marginRight: 2,
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  pillActive: {
    backgroundColor: '#0D9488',
    borderColor: '#0D9488',
  },
  pillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  pillTextActive: {
    color: '#FFFFFF',
  },
  dividerV: {
    width: 1,
    height: 16,
    backgroundColor: '#CBD5E1',
    marginHorizontal: 4,
  },
  loadingWrap: {
    paddingVertical: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 10,
    fontWeight: '600',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 8,
    padding: 14,
    gap: 10,
  },
  errorText: {
    fontSize: 13,
    color: '#DC2626',
    fontWeight: '600',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 20,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#334155',
    marginTop: 12,
  },
  emptySub: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 4,
    textAlign: 'center',
    maxWidth: 420,
  },
  ticketList: {
    gap: 14,
  },
  ticketCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  ticketCardPending: {
    borderColor: '#FCD34D',
    borderLeftWidth: 4,
    borderLeftColor: '#F59E0B',
  },
  ticketCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  ticketTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 6,
  },
  ticketSubject: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  priorityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
  },
  priorityBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  ticketMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  metaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
    gap: 4,
  },
  metaBadgeText: {
    fontSize: 11,
    color: '#475569',
    fontWeight: '600',
  },
  ticketTopActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconActionBtn: {
    padding: 6,
    borderRadius: 6,
  },
  ticketBody: {
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  ticketBodyLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  ticketBodyText: {
    fontSize: 13,
    color: '#1E293B',
    lineHeight: 19,
  },
  resolutionContainer: {
    backgroundColor: '#ECFDF5',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#A7F3D0',
    padding: 12,
    marginBottom: 12,
  },
  resolutionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  resolutionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#065F46',
  },
  resolutionBy: {
    fontSize: 11,
    color: '#047857',
    fontWeight: '600',
  },
  resolutionText: {
    fontSize: 12,
    color: '#064E3B',
    lineHeight: 18,
  },
  ticketActionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 10,
  },
  actionsLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionsRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  secondaryActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#CCFBF1',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    gap: 4,
  },
  secondaryActionBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0D9488',
  },
  progressBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2563EB',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    gap: 4,
  },
  progressBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  resolveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#059669',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    gap: 4,
  },
  resolveBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  reopenBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    gap: 4,
  },
  reopenBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  closeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    gap: 4,
  },
  closeBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 540,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    paddingBottom: 10,
  },
  modalHeaderTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  modalBody: {
    marginBottom: 16,
  },
  modalTicketSubject: {
    fontSize: 14,
    color: '#1E293B',
    marginBottom: 2,
  },
  modalTicketMeta: {
    fontSize: 12,
    color: '#64748B',
    marginBottom: 14,
  },
  modalInputLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#475569',
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  modalTextArea: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    padding: 12,
    fontSize: 13,
    color: '#0F172A',
    minHeight: 100,
    outlineStyle: 'none' as any,
  },
  modalFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 12,
  },
  modalCancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
  },
  modalCancelBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748B',
  },
  modalConfirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#059669',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  modalConfirmBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});


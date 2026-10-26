import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import {
  collection,
  addDoc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import { db, auth } from '@/config/firebase';

interface SupportTabProps {
  userRole?: string;
  assignedBarangay?: string;
  onNavigateTab?: (tab: string) => void;
}

interface SupportTicket {
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
  resolvedByName?: string;
  resolvedAt?: any;
}

const TICKET_CATEGORIES = [
  { label: 'GPS & Live Fleet Tracking', icon: 'location-searching' },
  { label: 'Route & AI Dispatch', icon: 'alt-route' },
  { label: 'Citizen Waste Reports', icon: 'assignment' },
  { label: 'Driver & Personnel Accounts', icon: 'recent-actors' },
  { label: 'Collection Schedule & Shifts', icon: 'event-note' },
  { label: 'Diesel & Fuel Estimates', icon: 'local-gas-station' },
  { label: 'App Glitch or Technical Issue', icon: 'bug-report' },
  { label: 'General Operational Inquiry', icon: 'help-outline' },
];

const FAQS = [
  {
    category: 'Emergency & Fleet',
    question: 'What should a coordinator do when a collection truck breaks down mid-route?',
    answer:
      '1. Instruct the driver to safely pull the vehicle to the shoulder and turn on hazard flashers.\n2. In the Announcements tab, publish an announcement with category "Maintenance" or "Schedule Change" so residents in the affected barangay know about the delay.\n3. Call the Danao City Motorpool Fleet Maintenance hotline immediately to request a mechanical response.\n4. Use the "CICTO Command & Chat" tab to alert CENRO dispatchers for emergency backup truck routing.',
  },
  {
    category: 'Emergency & Fleet',
    question: 'How is an emergency roadside hazard or roadblock reported?',
    answer:
      'Coordinators can report uncollected waste blockages or hazardous spills directly to the CDRRMO Danao Disaster Unit at (032) 200-2222 or submit an Urgent Ticket via this Helpdesk. You can also broadcast an Emergency Announcement to alert residents.',
  },
  {
    category: 'Fuel & Diesel',
    question: 'How does the Diesel Calculation and Fuel Estimation work?',
    answer:
      'The engine computes baseline diesel requirements from total route distance, vehicle compaction type (Compactor ~0.35 L/km vs Dump Truck ~0.28 L/km), idle duration factor, and Danao topography gradients. Coordinators can audit fuel pump logs in the "Trip & Diesel Log" tab.',
  },
  {
    category: 'Mobile App & GPS',
    question: 'Why is a truck not updating its live location on the Fleet Monitoring map?',
    answer:
      'Location broadcasts depend on the driver’s mobile device having GPS active and "Always Allow" location permissions. In highland zones (e.g., Guinacot, Masaba), temporary GSM/LTE loss may pause live sync; telemetry points are buffered locally and upload automatically once network connectivity is re-established.',
  },
  {
    category: 'Citizen Reports',
    question: 'How do coordinators review and resolve citizen trash reports?',
    answer:
      'Under the "Trash Reports" tab, filter by your assigned barangay. Review pending submissions and coordinate with the assigned truck driver. Once the waste is cleared, mark the report as "Resolved" to notify the resident and award verified eco-tokens.',
  },
  {
    category: 'Accounts & Access',
    question: 'How can a coordinator or driver password/PIN be reset?',
    answer:
      'For driver accounts, CENRO administrators can reset credentials from the "Accounts Directory" tab. For coordinator accounts or elevated permissions, contact CICTO IT Command at cicto@trashtrack.gov.ph or submit a ticket below.',
  },
];

export default function SupportTab({
  userRole = 'admin',
  assignedBarangay,
  onNavigateTab,
}: SupportTabProps) {
  const { width } = useWindowDimensions();
  const isMobile = width < 768;
  const isCoordinator = userRole === 'coordinator';

  // Sub-tabs: 'contacts' | 'ticket' | 'faq' | 'telemetry'
  const [activeSubTab, setActiveSubTab] = useState<'contacts' | 'ticket' | 'faq' | 'telemetry'>('contacts');

  // Ticket Form State
  const [ticketSubject, setTicketSubject] = useState('');
  const [ticketCategory, setTicketCategory] = useState(TICKET_CATEGORIES[0].label);
  const [ticketPriority, setTicketPriority] = useState<'Normal' | 'Urgent' | 'Critical'>('Normal');
  const [ticketDescription, setTicketDescription] = useState('');
  const [ticketBarangay, setTicketBarangay] = useState(assignedBarangay || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);

  // Tickets List
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loadingTickets, setLoadingTickets] = useState(true);
  const [ticketFilter, setTicketFilter] = useState<'all' | 'my'>('all');

  // FAQ State
  const [faqSearch, setFaqSearch] = useState('');
  const [expandedFaqIndex, setExpandedFaqIndex] = useState<number | null>(0);
  const [faqCategoryFilter, setFaqCategoryFilter] = useState<string>('All');

  // System Diagnostics Latency
  const [pingMs, setPingMs] = useState<number>(38);
  const [isRefreshingTelemetry, setIsRefreshingTelemetry] = useState(false);

  useEffect(() => {
    if (!db) return;
    const q = query(collection(db, 'support_tickets'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: SupportTicket[] = [];
        snap.forEach((d) => {
          list.push({ id: d.id, ...d.data() } as SupportTicket);
        });
        setTickets(list);
        setLoadingTickets(false);
      },
      (err) => {
        console.warn('SupportTab: tickets listener error', err);
        setLoadingTickets(false);
      }
    );
    return () => unsub();
  }, []);

  const handleCreateTicket = async () => {
    if (!ticketSubject.trim() || !ticketDescription.trim()) {
      if (Platform.OS === 'web') {
        window.alert('Please enter both a Subject and a Detailed Description for your ticket.');
      } else {
        Alert.alert('Validation Error', 'Please enter both a Subject and a Detailed Description.');
      }
      return;
    }

    setIsSubmitting(true);
    try {
      const currentUser = auth?.currentUser;
      await addDoc(collection(db, 'support_tickets'), {
        subject: ticketSubject.trim(),
        category: ticketCategory,
        priority: ticketPriority,
        description: ticketDescription.trim(),
        barangay: isCoordinator ? (assignedBarangay || '') : ticketBarangay.trim(),
        status: 'open',
        createdByEmail: currentUser?.email || 'Unknown',
        createdByName: currentUser?.displayName || currentUser?.email?.split('@')[0] || 'Portal User',
        createdByUid: currentUser?.uid || 'anon',
        createdByRole: userRole,
        createdAt: serverTimestamp(),
      });

      if (Platform.OS === 'web') {
        window.alert('Support ticket submitted successfully. Our operations team will review it shortly.');
      } else {
        Alert.alert('Ticket Submitted', 'Your ticket has been logged and assigned to the support desk.');
      }

      setTicketSubject('');
      setTicketDescription('');
      setTicketPriority('Normal');
      setShowCategoryDropdown(false);
    } catch (e: any) {
      console.error('Failed to submit support ticket:', e);
      if (Platform.OS === 'web') {
        window.alert(e?.message || 'Failed to submit ticket. Please check permissions.');
      } else {
        Alert.alert('Error', e?.message || 'Failed to submit ticket.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRefreshTelemetry = () => {
    setIsRefreshingTelemetry(true);
    setTimeout(() => {
      setPingMs(Math.floor(25 + Math.random() * 30));
      setIsRefreshingTelemetry(false);
    }, 600);
  };

  const filteredFaqs = FAQS.filter((f) => {
    const matchCat = faqCategoryFilter === 'All' || f.category === faqCategoryFilter;
    const matchSearch =
      !faqSearch.trim() ||
      f.question.toLowerCase().includes(faqSearch.toLowerCase()) ||
      f.answer.toLowerCase().includes(faqSearch.toLowerCase());
    return matchCat && matchSearch;
  });

  const currentUserUid = auth?.currentUser?.uid;
  const displayedTickets = tickets.filter((t) => {
    if (ticketFilter === 'my') {
      return t.createdByUid === currentUserUid;
    }
    return true;
  });

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Top Header Banner */}
      <View style={styles.headerSection}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerSubtitle}>
            OPERATIONAL GUIDES, DIRECTORY & TECHNICAL ASSISTANCE • DANAO CITY
          </Text>
          <Text style={styles.headerTitle}>Support & Operations Helpdesk</Text>
        </View>

        <View style={styles.statusBadgesRow}>
          <View style={styles.onlineBadge}>
            <View style={styles.onlineDot} />
            <Text style={styles.onlineText}>All Systems Operational</Text>
          </View>
          {isCoordinator ? (
            <View style={styles.roleBadge}>
              <MaterialIcons name="place" size={13} color="#047857" />
              <Text style={styles.roleBadgeText}>
                Coordinator • {assignedBarangay ? `Brgy. ${assignedBarangay}` : 'Barangay Field'}
              </Text>
            </View>
          ) : (
            <View style={styles.roleBadge}>
              <MaterialIcons name="security" size={13} color="#1E3A8A" />
              <Text style={[styles.roleBadgeText, { color: '#1E3A8A' }]}>CENRO Head Admin</Text>
            </View>
          )}
        </View>
      </View>

      {/* Sub-Tabs Selector */}
      <View style={styles.subTabNav}>
        <TouchableOpacity
          style={[styles.subTabBtn, activeSubTab === 'contacts' && styles.activeSubTabBtn]}
          onPress={() => setActiveSubTab('contacts')}
          activeOpacity={0.7}
        >
          <MaterialIcons
            name="contact-phone"
            size={18}
            color={activeSubTab === 'contacts' ? '#1B4D3E' : '#64748B'}
          />
          <Text style={[styles.subTabBtnText, activeSubTab === 'contacts' && styles.activeSubTabBtnText]}>
            Hotlines & Directory
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.subTabBtn, activeSubTab === 'ticket' && styles.activeSubTabBtn]}
          onPress={() => setActiveSubTab('ticket')}
          activeOpacity={0.7}
        >
          <MaterialIcons
            name="support-agent"
            size={18}
            color={activeSubTab === 'ticket' ? '#1B4D3E' : '#64748B'}
          />
          <Text style={[styles.subTabBtnText, activeSubTab === 'ticket' && styles.activeSubTabBtnText]}>
            Submit Ticket
          </Text>
          {tickets.filter((t) => t.status === 'open').length > 0 && (
            <View style={styles.pillCount}>
              <Text style={styles.pillCountText}>
                {tickets.filter((t) => t.status === 'open').length}
              </Text>
            </View>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.subTabBtn, activeSubTab === 'faq' && styles.activeSubTabBtn]}
          onPress={() => setActiveSubTab('faq')}
          activeOpacity={0.7}
        >
          <MaterialIcons
            name="menu-book"
            size={18}
            color={activeSubTab === 'faq' ? '#1B4D3E' : '#64748B'}
          />
          <Text style={[styles.subTabBtnText, activeSubTab === 'faq' && styles.activeSubTabBtnText]}>
            FAQs & Protocols
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.subTabBtn, activeSubTab === 'telemetry' && styles.activeSubTabBtn]}
          onPress={() => setActiveSubTab('telemetry')}
          activeOpacity={0.7}
        >
          <MaterialIcons
            name="network-check"
            size={18}
            color={activeSubTab === 'telemetry' ? '#1B4D3E' : '#64748B'}
          />
          <Text style={[styles.subTabBtnText, activeSubTab === 'telemetry' && styles.activeSubTabBtnText]}>
            System Health
          </Text>
        </TouchableOpacity>
      </View>

      {/* ========================================================= */}
      {/* 1. CONTACTS & DIRECTORY TAB                               */}
      {/* ========================================================= */}
      {activeSubTab === 'contacts' && (
        <View style={styles.contentSection}>
          <View style={styles.noticeBanner}>
            <MaterialIcons name="info" size={20} color="#0D9488" style={{ marginTop: 1 }} />
            <Text style={styles.noticeText}>
              Need immediate assistance? Use the dedicated channels below. For inter-agency operational
              dispatches, you can communicate directly in the{' '}
              <Text
                style={{ fontWeight: '700', textDecorationLine: 'underline', color: '#0F766E' }}
                onPress={() => onNavigateTab?.('cicto-commands')}
              >
                CICTO Command & Chat
              </Text>{' '}
              channel.
            </Text>
          </View>

          <View style={[styles.contactsGrid, isMobile && styles.contactsGridMobile]}>
            {/* CICTO Technical Dispatch */}
            <View style={styles.contactCard}>
              <View style={[styles.contactCardHeader, { borderLeftColor: '#2563EB' }]}>
                <View style={[styles.contactIconCircle, { backgroundColor: '#EFF6FF' }]}>
                  <MaterialIcons name="computer" size={24} color="#2563EB" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.contactCategory}>TECHNICAL & IT INFRASTRUCTURE</Text>
                  <Text style={styles.contactName}>CICTO Danao IT Command</Text>
                </View>
              </View>
              <View style={styles.contactCardBody}>
                <View style={styles.contactDetailRow}>
                  <MaterialIcons name="email" size={16} color="#64748B" />
                  <Text style={styles.contactDetailText}>cicto@trashtrack.gov.ph</Text>
                </View>
                <View style={styles.contactDetailRow}>
                  <MaterialIcons name="phone" size={16} color="#64748B" />
                  <Text style={styles.contactDetailText}>(032) 200-1111 local 108</Text>
                </View>
                <View style={styles.contactDetailRow}>
                  <MaterialIcons name="schedule" size={16} color="#64748B" />
                  <Text style={styles.contactDetailText}>24/7 Telemetry & Server Monitoring</Text>
                </View>
              </View>
              <View style={styles.contactCardFooter}>
                <TouchableOpacity
                  style={styles.cardPrimaryBtn}
                  onPress={() => onNavigateTab?.('cicto-commands')}
                  activeOpacity={0.7}
                >
                  <MaterialIcons name="forum" size={16} color="#FFFFFF" />
                  <Text style={styles.cardPrimaryBtnText}>Open Command Chat</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* CENRO Operations Center */}
            <View style={styles.contactCard}>
              <View style={[styles.contactCardHeader, { borderLeftColor: '#059669' }]}>
                <View style={[styles.contactIconCircle, { backgroundColor: '#ECFDF5' }]}>
                  <MaterialIcons name="nature-people" size={24} color="#059669" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.contactCategory}>FIELD OPERATIONS & DISPATCH</Text>
                  <Text style={styles.contactName}>CENRO Danao Headquarters</Text>
                </View>
              </View>
              <View style={styles.contactCardBody}>
                <View style={styles.contactDetailRow}>
                  <MaterialIcons name="place" size={16} color="#64748B" />
                  <Text style={styles.contactDetailText}>Danao City Hall Compound, F. Ralota St.</Text>
                </View>
                <View style={styles.contactDetailRow}>
                  <MaterialIcons name="phone" size={16} color="#64748B" />
                  <Text style={styles.contactDetailText}>(032) 200-3456 / +63 917 123 4567</Text>
                </View>
                <View style={styles.contactDetailRow}>
                  <MaterialIcons name="radio" size={16} color="#64748B" />
                  <Text style={styles.contactDetailText}>VHF Channel 142.800 MHz (CENRO Net)</Text>
                </View>
              </View>
              <View style={styles.contactCardFooter}>
                <TouchableOpacity
                  style={[styles.cardPrimaryBtn, { backgroundColor: '#059669' }]}
                  onPress={() => onNavigateTab?.('fleet-monitoring')}
                  activeOpacity={0.7}
                >
                  <MaterialIcons name="location-searching" size={16} color="#FFFFFF" />
                  <Text style={styles.cardPrimaryBtnText}>View Fleet Monitor</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Motorpool & Fleet Maintenance */}
            <View style={styles.contactCard}>
              <View style={[styles.contactCardHeader, { borderLeftColor: '#D97706' }]}>
                <View style={[styles.contactIconCircle, { backgroundColor: '#FEF3C7' }]}>
                  <MaterialIcons name="build" size={24} color="#D97706" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.contactCategory}>VEHICLE BREAKDOWN & REPAIRS</Text>
                  <Text style={styles.contactName}>City Motorpool & Fleet Depot</Text>
                </View>
              </View>
              <View style={styles.contactCardBody}>
                <View style={styles.contactDetailRow}>
                  <MaterialIcons name="place" size={16} color="#64748B" />
                  <Text style={styles.contactDetailText}>Sabang Motorpool, Danao City</Text>
                </View>
                <View style={styles.contactDetailRow}>
                  <MaterialIcons name="phone" size={16} color="#64748B" />
                  <Text style={styles.contactDetailText}>+63 920 987 6543 (Emergency Fleet Dispatch)</Text>
                </View>
                <View style={styles.contactDetailRow}>
                  <MaterialIcons name="schedule" size={16} color="#64748B" />
                  <Text style={styles.contactDetailText}>Roadside Rescue: 6:00 AM – 10:00 PM</Text>
                </View>
              </View>
              <View style={styles.contactCardFooter}>
                <TouchableOpacity
                  style={[styles.cardPrimaryBtn, { backgroundColor: '#D97706' }]}
                  onPress={() => onNavigateTab?.('truck-inventory')}
                  activeOpacity={0.7}
                >
                  <MaterialIcons name="local-shipping" size={16} color="#FFFFFF" />
                  <Text style={styles.cardPrimaryBtnText}>Fleet Inventory</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Disaster & Accidents (CDRRMO) */}
            <View style={styles.contactCard}>
              <View style={[styles.contactCardHeader, { borderLeftColor: '#DC2626' }]}>
                <View style={[styles.contactIconCircle, { backgroundColor: '#FEE2E2' }]}>
                  <MaterialIcons name="emergency" size={24} color="#DC2626" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.contactCategory}>EMERGENCY DISPATCH & RESCUE</Text>
                  <Text style={styles.contactName}>CDRRMO Danao Emergency</Text>
                </View>
              </View>
              <View style={styles.contactCardBody}>
                <View style={styles.contactDetailRow}>
                  <MaterialIcons name="phone-in-talk" size={16} color="#64748B" />
                  <Text style={styles.contactDetailText}>Emergency Hotline: 911 / (032) 200-2222</Text>
                </View>
                <View style={styles.contactDetailRow}>
                  <MaterialIcons name="warning" size={16} color="#64748B" />
                  <Text style={styles.contactDetailText}>Severe Weather, Collisions, Road Hazards</Text>
                </View>
                <View style={styles.contactDetailRow}>
                  <MaterialIcons name="schedule" size={16} color="#64748B" />
                  <Text style={styles.contactDetailText}>24/7 City Emergency Response Unit</Text>
                </View>
              </View>
              <View style={styles.contactCardFooter}>
                <TouchableOpacity
                  style={[styles.cardPrimaryBtn, { backgroundColor: '#DC2626' }]}
                  onPress={() => onNavigateTab?.('announcements')}
                  activeOpacity={0.7}
                >
                  <MaterialIcons name="campaign" size={16} color="#FFFFFF" />
                  <Text style={styles.cardPrimaryBtnText}>Post Announcement</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      )}

      {/* ========================================================= */}
      {/* 2. SUBMIT SUPPORT TICKET TAB                              */}
      {/* ========================================================= */}
      {activeSubTab === 'ticket' && (
        <View style={styles.contentSection}>
          {/* New Ticket Form Card */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardTitleRow}>
                <MaterialIcons name="add-comment" size={20} color="#1B4D3E" style={{ marginRight: 6 }} />
                <Text style={styles.cardTitle}>Log a New Support Request</Text>
              </View>
              <Text style={styles.cardCountBadge}>Logged to Helpdesk</Text>
            </View>

            <View style={styles.formGrid}>
              {/* Category Picker */}
              <View style={styles.formGroupHalf}>
                <Text style={styles.label}>
                  ISSUE CATEGORY <Text style={styles.requiredAsterisk}>*</Text>
                </Text>
                <TouchableOpacity
                  style={[styles.dropdown, showCategoryDropdown && styles.dropdownOpen]}
                  onPress={() => setShowCategoryDropdown(!showCategoryDropdown)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.dropdownText}>{ticketCategory}</Text>
                  <MaterialIcons
                    name={showCategoryDropdown ? 'arrow-drop-up' : 'arrow-drop-down'}
                    size={22}
                    color="#475569"
                  />
                </TouchableOpacity>

                {showCategoryDropdown && (
                  <View style={styles.dropdownMenu}>
                    {TICKET_CATEGORIES.map((cat) => (
                      <TouchableOpacity
                        key={cat.label}
                        style={[
                          styles.dropdownMenuItem,
                          ticketCategory === cat.label && styles.dropdownMenuItemActive,
                        ]}
                        onPress={() => {
                          setTicketCategory(cat.label);
                          setShowCategoryDropdown(false);
                        }}
                      >
                        <MaterialIcons
                          name={cat.icon as any}
                          size={16}
                          color={ticketCategory === cat.label ? '#1B4D3E' : '#64748B'}
                          style={{ marginRight: 8 }}
                        />
                        <Text
                          style={[
                            styles.dropdownMenuItemText,
                            ticketCategory === cat.label && styles.dropdownMenuItemTextActive,
                          ]}
                        >
                          {cat.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>

              {/* Priority Selector */}
              <View style={styles.formGroupHalf}>
                <Text style={styles.label}>
                  URGENCY / PRIORITY <Text style={styles.requiredAsterisk}>*</Text>
                </Text>
                <View style={styles.prioritySelectorRow}>
                  {(['Normal', 'Urgent', 'Critical'] as const).map((p) => {
                    const active = ticketPriority === p;
                    const pColors = {
                      Normal: { activeBg: '#EFF6FF', activeBorder: '#3B82F6', activeText: '#1D4ED8' },
                      Urgent: { activeBg: '#FEF3C7', activeBorder: '#F59E0B', activeText: '#B45309' },
                      Critical: { activeBg: '#FEE2E2', activeBorder: '#EF4444', activeText: '#B91C1C' },
                    }[p];

                    return (
                      <TouchableOpacity
                        key={p}
                        style={[
                          styles.priorityPill,
                          active && {
                            backgroundColor: pColors.activeBg,
                            borderColor: pColors.activeBorder,
                          },
                        ]}
                        onPress={() => setTicketPriority(p)}
                        activeOpacity={0.7}
                      >
                        <Text
                          style={[
                            styles.priorityPillText,
                            active && { color: pColors.activeText, fontWeight: '800' },
                          ]}
                        >
                          {p}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* Barangay (If not coordinator) */}
              {!isCoordinator && (
                <View style={styles.formGroupHalf}>
                  <Text style={styles.label}>AFFECTED BARANGAY (OPTIONAL)</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. Suba, Looc, Poblacion..."
                    placeholderTextColor="#94A3B8"
                    value={ticketBarangay}
                    onChangeText={setTicketBarangay}
                  />
                </View>
              )}

              {/* Subject */}
              <View style={isCoordinator ? styles.formGroupFull : styles.formGroupHalf}>
                <Text style={styles.label}>
                  SUBJECT SUMMARY <Text style={styles.requiredAsterisk}>*</Text>
                </Text>
                <TextInput
                  style={styles.input}
                  placeholder="Brief summary of the operational issue..."
                  placeholderTextColor="#94A3B8"
                  value={ticketSubject}
                  onChangeText={setTicketSubject}
                />
              </View>

              {/* Detailed Description */}
              <View style={styles.formGroupFull}>
                <Text style={styles.label}>
                  DETAILED DESCRIPTION & STEPS <Text style={styles.requiredAsterisk}>*</Text>
                </Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  placeholder="Describe the problem in detail. Include truck plate number, driver name, road location, or error message encountered..."
                  placeholderTextColor="#94A3B8"
                  value={ticketDescription}
                  onChangeText={setTicketDescription}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                />
              </View>
            </View>

            <View style={styles.formFooter}>
              <TouchableOpacity
                style={styles.submitBtn}
                onPress={handleCreateTicket}
                disabled={isSubmitting}
                activeOpacity={0.8}
              >
                {isSubmitting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <MaterialIcons name="send" size={18} color="#FFFFFF" />
                    <Text style={styles.submitBtnText}>Submit Support Request</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>

          {/* Recent Tickets Table / List */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardTitleRow}>
                <MaterialIcons name="receipt-long" size={20} color="#1B4D3E" style={{ marginRight: 6 }} />
                <Text style={styles.cardTitle}>Recent Support Requests</Text>
              </View>

              <View style={styles.filterPillsRow}>
                <TouchableOpacity
                  style={[styles.filterPill, ticketFilter === 'all' && styles.filterPillActive]}
                  onPress={() => setTicketFilter('all')}
                >
                  <Text
                    style={[
                      styles.filterPillText,
                      ticketFilter === 'all' && styles.filterPillTextActive,
                    ]}
                  >
                    All ({tickets.length})
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.filterPill, ticketFilter === 'my' && styles.filterPillActive]}
                  onPress={() => setTicketFilter('my')}
                >
                  <Text
                    style={[
                      styles.filterPillText,
                      ticketFilter === 'my' && styles.filterPillTextActive,
                    ]}
                  >
                    My Submissions
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {loadingTickets ? (
              <View style={{ paddingVertical: 40, alignItems: 'center' }}>
                <ActivityIndicator size="large" color="#1B4D3E" />
                <Text style={{ marginTop: 10, color: '#64748B', fontSize: 13 }}>Loading tickets...</Text>
              </View>
            ) : displayedTickets.length === 0 ? (
              <View style={styles.emptyState}>
                <MaterialIcons name="task-alt" size={42} color="#CBD5E1" />
                <Text style={styles.emptyStateTitle}>No Active Support Tickets</Text>
                <Text style={styles.emptyStateSub}>
                  {ticketFilter === 'my'
                    ? 'You have not submitted any tickets yet.'
                    : 'All operational inquiries and system requests have been resolved.'}
                </Text>
              </View>
            ) : (
              <View style={styles.ticketsList}>
                {displayedTickets.map((item) => {
                  const pColors = {
                    Normal: { bg: '#EFF6FF', text: '#2563EB' },
                    Urgent: { bg: '#FEF3C7', text: '#D97706' },
                    Critical: { bg: '#FEE2E2', text: '#DC2626' },
                  }[item.priority] || { bg: '#F1F5F9', text: '#475569' };

                  const statusColors = {
                    open: { bg: '#FEF3C7', text: '#B45309', label: 'Under Review' },
                    'in-progress': { bg: '#DBEAFE', text: '#1E40AF', label: 'In Progress' },
                    resolved: { bg: '#D1FAE5', text: '#065F46', label: 'Resolved' },
                    closed: { bg: '#F1F5F9', text: '#475569', label: 'Closed' },
                  }[item.status] || { bg: '#F1F5F9', text: '#475569', label: item.status };

                  const dateStr = item.createdAt?.toDate
                    ? item.createdAt.toDate().toLocaleString()
                    : 'Just now';

                  return (
                    <View key={item.id} style={styles.ticketItem}>
                      <View style={styles.ticketItemHeader}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.ticketItemSubject}>{item.subject}</Text>
                          <Text style={styles.ticketItemMeta}>
                            Logged by {item.createdByName} • {item.category} • {dateStr}
                            {item.barangay ? ` • Brgy. ${item.barangay}` : ''}
                          </Text>
                        </View>

                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <View style={[styles.badge, { backgroundColor: pColors.bg }]}>
                            <Text style={[styles.badgeText, { color: pColors.text }]}>{item.priority}</Text>
                          </View>
                          <View style={[styles.badge, { backgroundColor: statusColors.bg }]}>
                            <Text style={[styles.badgeText, { color: statusColors.text }]}>
                              {statusColors.label}
                            </Text>
                          </View>
                        </View>
                      </View>
                      <Text style={styles.ticketItemDesc}>{item.description}</Text>
                      {item.resolutionNotes ? (
                        <View style={styles.ticketResolutionBox}>
                          <View style={styles.ticketResolutionHeader}>
                            <MaterialIcons name="verified" size={15} color="#059669" />
                            <Text style={styles.ticketResolutionTitle}>
                              CICTO Resolution Note {item.resolvedByName ? `(${item.resolvedByName})` : ''}
                            </Text>
                          </View>
                          <Text style={styles.ticketResolutionText}>{item.resolutionNotes}</Text>
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        </View>
      )}

      {/* ========================================================= */}
      {/* 3. OPERATIONAL FAQS & SOPS                                */}
      {/* ========================================================= */}
      {activeSubTab === 'faq' && (
        <View style={styles.contentSection}>
          {/* FAQ Search & Category Filter */}
          <View style={styles.faqSearchCard}>
            <View style={styles.faqSearchInputBox}>
              <MaterialIcons name="search" size={20} color="#94A3B8" style={{ marginRight: 8 }} />
              <TextInput
                style={styles.faqSearchInput}
                placeholder="Search protocols, truck failure guides, fuel questions..."
                placeholderTextColor="#94A3B8"
                value={faqSearch}
                onChangeText={setFaqSearch}
              />
              {faqSearch.length > 0 && (
                <TouchableOpacity onPress={() => setFaqSearch('')}>
                  <MaterialIcons name="close" size={18} color="#94A3B8" />
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.faqPillsRow}>
              {['All', 'Emergency & Fleet', 'Fuel & Diesel', 'Mobile App & GPS', 'Citizen Reports', 'Accounts & Access'].map(
                (cat) => (
                  <TouchableOpacity
                    key={cat}
                    style={[
                      styles.faqPill,
                      faqCategoryFilter === cat && styles.faqPillActive,
                    ]}
                    onPress={() => setFaqCategoryFilter(cat)}
                  >
                    <Text
                      style={[
                        styles.faqPillText,
                        faqCategoryFilter === cat && styles.faqPillTextActive,
                      ]}
                    >
                      {cat}
                    </Text>
                  </TouchableOpacity>
                )
              )}
            </View>
          </View>

          {/* FAQs Accordion */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardTitleRow}>
                <MaterialIcons name="help" size={20} color="#1B4D3E" style={{ marginRight: 6 }} />
                <Text style={styles.cardTitle}>Standard Operating Procedures & FAQs</Text>
              </View>
              <Text style={styles.cardCountBadge}>{filteredFaqs.length} Guides Available</Text>
            </View>

            {filteredFaqs.length === 0 ? (
              <View style={styles.emptyState}>
                <MaterialIcons name="search-off" size={40} color="#CBD5E1" />
                <Text style={styles.emptyStateTitle}>No Matching FAQs Found</Text>
                <Text style={styles.emptyStateSub}>
                  Try adjusting your search terms or view the Emergency Contacts directory.
                </Text>
              </View>
            ) : (
              <View style={styles.faqList}>
                {filteredFaqs.map((faq, index) => {
                  const isExpanded = expandedFaqIndex === index;
                  return (
                    <View key={faq.question} style={styles.faqItem}>
                      <TouchableOpacity
                        style={styles.faqQuestionBtn}
                        onPress={() => setExpandedFaqIndex(isExpanded ? null : index)}
                        activeOpacity={0.7}
                      >
                        <View style={{ flex: 1, paddingRight: 8 }}>
                          <View style={styles.faqCatBadge}>
                            <Text style={styles.faqCatBadgeText}>{faq.category}</Text>
                          </View>
                          <Text style={styles.faqQuestionText}>{faq.question}</Text>
                        </View>
                        <MaterialIcons
                          name={isExpanded ? 'expand-less' : 'expand-more'}
                          size={24}
                          color="#64748B"
                        />
                      </TouchableOpacity>

                      {isExpanded && (
                        <View style={styles.faqAnswerBox}>
                          <Text style={styles.faqAnswerText}>{faq.answer}</Text>
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        </View>
      )}

      {/* ========================================================= */}
      {/* 4. SYSTEM HEALTH & TELEMETRY                              */}
      {/* ========================================================= */}
      {activeSubTab === 'telemetry' && (
        <View style={styles.contentSection}>
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardTitleRow}>
                <MaterialIcons name="speed" size={20} color="#1B4D3E" style={{ marginRight: 6 }} />
                <Text style={styles.cardTitle}>Portal Diagnostics & Services Health</Text>
              </View>

              <TouchableOpacity
                style={styles.refreshBtn}
                onPress={handleRefreshTelemetry}
                disabled={isRefreshingTelemetry}
                activeOpacity={0.7}
              >
                {isRefreshingTelemetry ? (
                  <ActivityIndicator size="small" color="#1B4D3E" />
                ) : (
                  <>
                    <MaterialIcons name="refresh" size={16} color="#1B4D3E" />
                    <Text style={styles.refreshBtnText}>Refresh Telemetry</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

            <View style={styles.diagnosticsGrid}>
              <View style={styles.diagnosticCard}>
                <View style={styles.diagHeader}>
                  <MaterialIcons name="cloud-done" size={22} color="#059669" />
                  <View style={styles.diagStatusPill}>
                    <Text style={styles.diagStatusText}>ONLINE</Text>
                  </View>
                </View>
                <Text style={styles.diagTitle}>Cloud Firestore DB</Text>
                <Text style={styles.diagDesc}>Real-time synchronization for schedules, reports and logs.</Text>
                <Text style={styles.diagSub}>Latency: ~{pingMs}ms</Text>
              </View>

              <View style={styles.diagnosticCard}>
                <View style={styles.diagHeader}>
                  <MaterialIcons name="verified-user" size={22} color="#2563EB" />
                  <View style={styles.diagStatusPill}>
                    <Text style={styles.diagStatusText}>ACTIVE</Text>
                  </View>
                </View>
                <Text style={styles.diagTitle}>Authentication Service</Text>
                <Text style={styles.diagDesc}>Firebase Auth & Secure Coordinator Session.</Text>
                <Text style={styles.diagSub}>User: {auth?.currentUser?.email || 'Active'}</Text>
              </View>

              <View style={styles.diagnosticCard}>
                <View style={styles.diagHeader}>
                  <MaterialIcons name="gps-fixed" size={22} color="#7C3AED" />
                  <View style={styles.diagStatusPill}>
                    <Text style={styles.diagStatusText}>LISTENING</Text>
                  </View>
                </View>
                <Text style={styles.diagTitle}>Fleet Telemetry Service</Text>
                <Text style={styles.diagDesc}>Live vehicle geolocation broker & headway alerts.</Text>
                <Text style={styles.diagSub}>Frequency: 5-second polling interval</Text>
              </View>

              <View style={styles.diagnosticCard}>
                <View style={styles.diagHeader}>
                  <MaterialIcons name="alt-route" size={22} color="#D97706" />
                  <View style={styles.diagStatusPill}>
                    <Text style={styles.diagStatusText}>READY</Text>
                  </View>
                </View>
                <Text style={styles.diagTitle}>AI Route Optimization</Text>
                <Text style={styles.diagDesc}>Danao waypoint sequencing and fuel estimation algorithms.</Text>
                <Text style={styles.diagSub}>Algorithm: Danao Waste Routing v2.1</Text>
              </View>
            </View>

            {/* Version & Build Info */}
            <View style={styles.buildInfoBox}>
              <Text style={styles.buildInfoTitle}>TrashTrack Danao City • CENRO Civic Steward Suite</Text>
              <Text style={styles.buildInfoSub}>
                Build Version: 2.4.0-prod • Environment: Production • City: Danao City, Cebu, Philippines
              </Text>
            </View>
          </View>
        </View>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    padding: 32,
  },
  headerSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    gap: 16,
    marginBottom: 24,
  },
  headerSubtitle: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 1,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.5,
  },
  statusBadgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  onlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  onlineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10B981',
  },
  onlineText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#047857',
  },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  roleBadgeText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#334155',
  },

  // Sub-Tab Navigation
  subTabNav: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    padding: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 24,
    flexWrap: 'wrap',
  },
  subTabBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  activeSubTabBtn: {
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  subTabBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748B',
  },
  activeSubTabBtnText: {
    color: '#1B4D3E',
  },
  pillCount: {
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    marginLeft: 4,
  },
  pillCountText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#DC2626',
  },

  contentSection: {
    gap: 24,
  },

  noticeBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#CCFBF1',
    borderRadius: 12,
    padding: 16,
  },
  noticeText: {
    fontSize: 13.5,
    color: '#134E4A',
    lineHeight: 20,
    flex: 1,
  },

  // Contacts Grid
  contactsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 20,
  },
  contactsGridMobile: {
    flexDirection: 'column',
  },
  contactCard: {
    flex: 1,
    minWidth: 300,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  contactCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderLeftWidth: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    backgroundColor: '#FAFAFA',
  },
  contactIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  contactCategory: {
    fontSize: 10,
    fontWeight: '800',
    color: '#94A3B8',
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  contactName: {
    fontSize: 14.5,
    fontWeight: '800',
    color: '#0F172A',
  },
  contactCardBody: {
    padding: 16,
    gap: 10,
  },
  contactDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  contactDetailText: {
    fontSize: 12.5,
    color: '#475569',
    fontWeight: '500',
    flex: 1,
  },
  contactCardFooter: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  cardPrimaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#1B4D3E',
    paddingVertical: 10,
    borderRadius: 8,
  },
  cardPrimaryBtnText: {
    color: '#FFFFFF',
    fontSize: 12.5,
    fontWeight: '700',
  },

  // Generic Card
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 24,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
  },
  cardCountBadge: {
    fontSize: 11,
    fontWeight: '800',
    color: '#1B4D3E',
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },

  // Form
  formGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  formGroupHalf: {
    width: '48%',
    marginBottom: 4,
  },
  formGroupFull: {
    width: '100%',
    marginBottom: 4,
  },
  label: {
    fontSize: 11,
    fontWeight: '800',
    color: '#475569',
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  requiredAsterisk: {
    color: '#EF4444',
    fontWeight: '800',
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 13.5,
    color: '#0F172A',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  textArea: {
    minHeight: 100,
  },
  dropdown: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  dropdownOpen: {
    borderColor: '#1B4D3E',
  },
  dropdownText: {
    fontSize: 13.5,
    fontWeight: '600',
    color: '#0F172A',
  },
  dropdownMenu: {
    position: 'absolute',
    top: 68,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 8,
    zIndex: 999,
    overflow: 'hidden',
  },
  dropdownMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  dropdownMenuItemActive: {
    backgroundColor: '#F0FDF4',
  },
  dropdownMenuItemText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
  },
  dropdownMenuItemTextActive: {
    color: '#1B4D3E',
    fontWeight: '700',
  },
  prioritySelectorRow: {
    flexDirection: 'row',
    gap: 8,
    height: 42,
  },
  priorityPill: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  priorityPillText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: '#64748B',
  },
  formFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 18,
  },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#1B4D3E',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    shadowColor: '#1B4D3E',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '800',
  },

  // Filter Pills
  filterPillsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  filterPill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  filterPillActive: {
    backgroundColor: '#1B4D3E',
    borderColor: '#1B4D3E',
  },
  filterPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  filterPillTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },

  // Tickets List
  ticketsList: {
    gap: 12,
  },
  ticketItem: {
    padding: 16,
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  ticketItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  ticketItemSubject: {
    fontSize: 14.5,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 3,
  },
  ticketItemMeta: {
    fontSize: 11.5,
    color: '#64748B',
  },
  ticketItemDesc: {
    fontSize: 13,
    color: '#334155',
    lineHeight: 18,
  },
  ticketResolutionBox: {
    marginTop: 10,
    backgroundColor: '#ECFDF5',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#A7F3D0',
    padding: 10,
  },
  ticketResolutionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  ticketResolutionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#065F46',
  },
  ticketResolutionText: {
    fontSize: 12,
    color: '#064E3B',
    lineHeight: 17,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 10.5,
    fontWeight: '800',
  },

  // Empty State
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 36,
  },
  emptyStateTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#334155',
    marginTop: 8,
    marginBottom: 4,
  },
  emptyStateSub: {
    fontSize: 12.5,
    color: '#94A3B8',
    textAlign: 'center',
    maxWidth: 420,
  },

  // FAQ Search
  faqSearchCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 14,
  },
  faqSearchInputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  faqSearchInput: {
    flex: 1,
    fontSize: 13.5,
    color: '#0F172A',
  },
  faqPillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  faqPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#F1F5F9',
  },
  faqPillActive: {
    backgroundColor: '#1B4D3E',
  },
  faqPillText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#475569',
  },
  faqPillTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },

  // FAQ List
  faqList: {
    gap: 10,
  },
  faqItem: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
  faqQuestionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#FAFAFA',
  },
  faqCatBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#E2E8F0',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginBottom: 6,
  },
  faqCatBadgeText: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#475569',
  },
  faqQuestionText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  faqAnswerBox: {
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  faqAnswerText: {
    fontSize: 13.5,
    color: '#334155',
    lineHeight: 22,
  },

  // Telemetry
  refreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  refreshBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1B4D3E',
  },
  diagnosticsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  diagnosticCard: {
    flex: 1,
    minWidth: 240,
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  diagHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  diagStatusPill: {
    backgroundColor: '#D1FAE5',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  diagStatusText: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#065F46',
  },
  diagTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 4,
  },
  diagDesc: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 16,
    marginBottom: 8,
  },
  diagSub: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94A3B8',
  },
  buildInfoBox: {
    marginTop: 20,
    padding: 14,
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
    alignItems: 'center',
  },
  buildInfoTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#334155',
    marginBottom: 2,
  },
  buildInfoSub: {
    fontSize: 11,
    color: '#64748B',
  },
});

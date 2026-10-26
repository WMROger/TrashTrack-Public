import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export type LegalTabType = "terms" | "privacy" | "consent";

interface TermsAndConsentModalProps {
  visible: boolean;
  initialTab?: LegalTabType;
  onClose: () => void;
  onAccept?: () => void;
  acceptButtonText?: string;
  alreadyAccepted?: boolean;
}

export default function TermsAndConsentModal({
  visible,
  initialTab = "consent",
  onClose,
  onAccept,
  acceptButtonText = "I Agree & Accept",
  alreadyAccepted = false,
}: TermsAndConsentModalProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isMobile = Platform.OS !== "web" || width < 768;

  const [activeTab, setActiveTab] = useState<LegalTabType>(initialTab);
  const [readTabs, setReadTabs] = useState<Record<LegalTabType, boolean>>({
    terms: false,
    privacy: false,
    consent: false,
  });
  const [containerHeight, setContainerHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const scrollViewRef = React.useRef<ScrollView>(null);

  React.useEffect(() => {
    if (visible) {
      setActiveTab(initialTab);
      if (alreadyAccepted) {
        setReadTabs({ terms: true, privacy: true, consent: true });
      }
    }
  }, [visible, initialTab, alreadyAccepted]);

  // When activeTab changes, scroll back to top
  React.useEffect(() => {
    scrollViewRef.current?.scrollTo({ y: 0, animated: false });
  }, [activeTab]);

  const checkAutoScrolled = (cHeight: number, lHeight: number) => {
    if (cHeight > 0 && lHeight > 0 && cHeight <= lHeight + 20) {
      setReadTabs((prev) => {
        if (prev[activeTab]) return prev;
        return { ...prev, [activeTab]: true };
      });
    }
  };

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    // Buffer of 35 pixels from the bottom or content fits without scrolling
    const isAtBottom =
      contentSize.height <= layoutMeasurement.height + 20 ||
      layoutMeasurement.height + contentOffset.y >= contentSize.height - 35;

    if (isAtBottom) {
      setReadTabs((prev) => {
        if (prev[activeTab]) return prev;
        return { ...prev, [activeTab]: true };
      });
    }
  };

  const handleContentSizeChange = (_w: number, h: number) => {
    setContentHeight(h);
    checkAutoScrolled(h, containerHeight);
  };

  const completedCount = [readTabs.terms, readTabs.privacy, readTabs.consent].filter(Boolean).length;
  const allCompleted = completedCount === 3;

  const handleAccept = () => {
    if (!allCompleted) return;
    if (onAccept) {
      onAccept();
    }
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType={isMobile ? "slide" : "fade"}
      transparent={true}
      statusBarTranslucent={true}
      onRequestClose={onClose}
    >
      <StatusBar
        barStyle="dark-content"
        backgroundColor={isMobile ? "#FFFFFF" : "rgba(15, 23, 42, 0.75)"}
        translucent={true}
      />
      <View
        style={[
          styles.modalOverlay,
          isMobile ? styles.modalOverlayMobile : styles.modalOverlayDesktop,
        ]}
      >
        <View
          style={[
            styles.modalContainer,
            isMobile ? styles.modalContainerMobile : styles.modalContainerDesktop,
          ]}
        >
          {/* Header */}
          <View
            style={[
              styles.header,
              isMobile && {
                paddingTop:
                  Platform.OS === "web"
                    ? 16
                    : Math.max(insets.top + 8, 16),
              },
            ]}
          >
            <View style={styles.headerTitleRow}>
              <View style={styles.iconCircle}>
                <Ionicons name="shield-checkmark" size={22} color="#1B4D3E" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.headerTitle}>Legal & Privacy Notice</Text>
                <Text style={styles.headerSubtitle}>TrashTrack • Danao City Government</Text>
              </View>
              <TouchableOpacity
                onPress={onClose}
                style={styles.closeButton}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                accessibilityLabel="Close modal"
              >
                <Ionicons name="close" size={20} color="#64748B" />
              </TouchableOpacity>
            </View>

            {/* 3-Tab Segmented Control */}
            <View style={styles.tabBar}>
              <TouchableOpacity
                style={[styles.tabButton, activeTab === "terms" && styles.tabButtonActive]}
                onPress={() => setActiveTab("terms")}
                activeOpacity={0.8}
                accessibilityRole="tab"
                accessibilityLabel="Terms and Conditions"
                accessibilityState={{ selected: activeTab === "terms" }}
              >
                <Ionicons
                  name={readTabs.terms ? "checkmark-circle" : "newspaper-outline"}
                  size={15}
                  color={
                    readTabs.terms
                      ? activeTab === "terms"
                        ? "#A7F3D0"
                        : "#059669"
                      : activeTab === "terms"
                      ? "#FFFFFF"
                      : "#64748B"
                  }
                />
                <Text
                  style={[styles.tabButtonText, activeTab === "terms" && styles.tabButtonTextActive]}
                  numberOfLines={1}
                >
                  Terms
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.tabButton, activeTab === "privacy" && styles.tabButtonActive]}
                onPress={() => setActiveTab("privacy")}
                activeOpacity={0.8}
                accessibilityRole="tab"
                accessibilityLabel="Data Privacy Act of 2012"
                accessibilityState={{ selected: activeTab === "privacy" }}
              >
                <Ionicons
                  name={readTabs.privacy ? "checkmark-circle" : "shield-checkmark-outline"}
                  size={15}
                  color={
                    readTabs.privacy
                      ? activeTab === "privacy"
                        ? "#A7F3D0"
                        : "#059669"
                      : activeTab === "privacy"
                      ? "#FFFFFF"
                      : "#64748B"
                  }
                />
                <Text
                  style={[styles.tabButtonText, activeTab === "privacy" && styles.tabButtonTextActive]}
                  numberOfLines={1}
                >
                  Privacy
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.tabButton, activeTab === "consent" && styles.tabButtonActive]}
                onPress={() => setActiveTab("consent")}
                activeOpacity={0.8}
                accessibilityRole="tab"
                accessibilityLabel="Informed Consent"
                accessibilityState={{ selected: activeTab === "consent" }}
              >
                <Ionicons
                  name={readTabs.consent ? "checkmark-circle" : "hand-right-outline"}
                  size={15}
                  color={
                    readTabs.consent
                      ? activeTab === "consent"
                        ? "#A7F3D0"
                        : "#059669"
                      : activeTab === "consent"
                      ? "#FFFFFF"
                      : "#64748B"
                  }
                />
                <Text
                  style={[styles.tabButtonText, activeTab === "consent" && styles.tabButtonTextActive]}
                  numberOfLines={1}
                >
                  Consent
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Scrollable Content */}
          <ScrollView
            ref={scrollViewRef}
            style={styles.scrollContent}
            contentContainerStyle={styles.scrollInner}
            showsVerticalScrollIndicator={true}
            scrollEventThrottle={16}
            onScroll={handleScroll}
            onLayout={(e) => {
              const h = e.nativeEvent.layout.height;
              setContainerHeight(h);
              checkAutoScrolled(contentHeight, h);
            }}
            onContentSizeChange={handleContentSizeChange}
          >
            {activeTab === "terms" ? (
              /* TERMS AND CONDITIONS CONTENT */
              <View>
                <View style={styles.badgeBanner}>
                  <Ionicons name="document-text" size={18} color="#059669" />
                  <Text style={styles.badgeBannerText}>
                    Republic of the Philippines • Danao City Official Municipal Rules
                  </Text>
                </View>

                <Text style={styles.sectionTitle}>Terms and Conditions of Service</Text>
                <Text style={styles.paragraph}>
                  These Terms and Conditions govern access to and usage of the <Text style={styles.boldText}>TrashTrack Danao City Solid Waste Management System</Text>, operated under the oversight of the <Text style={styles.boldText}>City Environment and Natural Resources Office (CENRO)</Text> and the <Text style={styles.boldText}>City Information and Communications Technology Office (CICTO)</Text>.
                </Text>

                <View style={styles.card}>
                  <Text style={styles.cardHeader}>1. Acceptance of Terms & Authority</Text>
                  <Text style={styles.cardText}>
                    By creating an account, logging in, or changing credentials, residents, drivers, environmental coordinators, and municipal personnel agree to comply with these Terms, all applicable City Ordinances, and Republic Act No. 9003 (Ecological Solid Waste Management Act of 2000).
                  </Text>
                </View>

                <View style={styles.card}>
                  <Text style={styles.cardHeader}>2. Resident Responsibilities & Citizen Reporting</Text>
                  <Text style={styles.cardItem}>• Provide truthful, accurate, and current profile and location information.</Text>
                  <Text style={styles.cardItem}>• Submit authentic, geo-verified waste incident reports; submission of frivolous, staged, or malicious false reports is strictly prohibited.</Text>
                  <Text style={styles.cardItem}>• Comply with Danao City household waste segregation schedules (Biodegradable, Non-Biodegradable, Recyclable, and Special/Bulk waste).</Text>
                </View>

                <View style={styles.card}>
                  <Text style={styles.cardHeader}>3. Officer, Coordinator & Driver Protocols</Text>
                  <Text style={styles.cardItem}>• <Text style={styles.boldText}>Mandatory Credential Security:</Text> Newly provisioned CENRO officers, Barangay Coordinators, and drivers issued temporary passwords MUST establish their permanent, confidential credentials upon initial sign-in.</Text>
                  <Text style={styles.cardItem}>• <Text style={styles.boldText}>Telemetry & Audit Integrity:</Text> Collection logs, truck GPS records, and waste weight weighbridge entries constitute official municipal audit records. Tampering with tracking or falsifying collection status is prohibited.</Text>
                  <Text style={styles.cardItem}>• <Text style={styles.boldText}>Non-Transferability:</Text> Officer and driver logins are strictly non-transferable.</Text>
                </View>

                <View style={styles.card}>
                  <Text style={styles.cardHeader}>4. System Availability & Service Modifications</Text>
                  <Text style={styles.cardText}>
                    The City Government strives to provide continuous service availability; however, operations may be suspended or rerouted during severe weather advisories, emergency force majeure events, or scheduled maintenance under CICTO directives.
                  </Text>
                </View>

                <View style={styles.card}>
                  <Text style={styles.cardHeader}>5. Violations & Penalties</Text>
                  <Text style={styles.cardText}>
                    Misuse of the system, unauthorized data extraction, or violation of operational mandates is subject to account suspension, administrative disciplinary actions, and legal liability under applicable Philippine laws and municipal penal codes.
                  </Text>
                </View>

                {/* Bottom Navigation Prompt */}
                <View style={styles.bottomNavContainer}>
                  {readTabs.terms ? (
                    <TouchableOpacity
                      style={styles.nextTabButton}
                      onPress={() => setActiveTab("privacy")}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.nextTabButtonText}>
                        {readTabs.privacy ? "View Privacy Notice" : "Continue to Privacy Notice"}
                      </Text>
                      <Ionicons name="arrow-forward" size={15} color="#1B4D3E" />
                    </TouchableOpacity>
                  ) : (
                    <View style={styles.scrollDownHint}>
                      <Ionicons name="arrow-down-circle-outline" size={15} color="#64748B" />
                      <Text style={styles.scrollDownHintText}>Scroll to the bottom of this section</Text>
                    </View>
                  )}
                </View>
              </View>
            ) : activeTab === "privacy" ? (
              /* DATA PRIVACY TERMS CONTENT */
              <View>
                <View style={styles.badgeBanner}>
                  <Ionicons name="shield-checkmark" size={18} color="#059669" />
                  <Text style={styles.badgeBannerText}>
                    Republic Act No. 10173 (Data Privacy Act of 2012)
                  </Text>
                </View>

                <Text style={styles.sectionTitle}>Data Privacy Policy & NPC Compliance</Text>
                <Text style={styles.paragraph}>
                  TrashTrack Danao City processes personal and locational information in strict accordance with <Text style={styles.boldText}>Republic Act No. 10173</Text>, also known as the <Text style={styles.boldText}>Data Privacy Act of 2012 (DPA)</Text>, its Implementing Rules and Regulations (IRR), and National Privacy Commission (NPC) circulars.
                </Text>

                <View style={styles.card}>
                  <Text style={styles.cardHeader}>1. Data Security & Encryption Standards</Text>
                  <Text style={styles.cardText}>
                    Personal information is safeguarded through end-to-end TLS encryption in transit and encrypted database storage at rest. Access is strictly controlled via Role-Based Access Control (RBAC) restricted to authorized municipal officers, coordinators, and drivers.
                  </Text>
                </View>

                <View style={styles.card}>
                  <Text style={styles.cardHeader}>2. Legitimate Purpose & Non-Disclosure</Text>
                  <Text style={styles.cardText}>
                    Data is processed solely for public service: route scheduling, citizen dispatch, and fleet management. TrashTrack does NOT sell, rent, trade, or monetize personal information. Data sharing is limited to interagency coordination (CENRO, CICTO, and Office of the Mayor) as permitted by law.
                  </Text>
                </View>

                <View style={styles.card}>
                  <Text style={styles.cardHeader}>3. Data Subject Rights (RA 10173, Sec. 16)</Text>
                  <Text style={styles.cardItem}>• <Text style={styles.boldText}>Right to be Informed:</Text> Knowing how personal and location data are collected, processed, and safeguarded.</Text>
                  <Text style={styles.cardItem}>• <Text style={styles.boldText}>Right to Access:</Text> Viewing stored registration records and activity history.</Text>
                  <Text style={styles.cardItem}>• <Text style={styles.boldText}>Right to Rectification:</Text> Correcting erroneous name, contact, or barangay assignments.</Text>
                  <Text style={styles.cardItem}>• <Text style={styles.boldText}>Right to Erasure or Blocking:</Text> Requesting permanent deletion of account data upon cessation of municipal service use.</Text>
                  <Text style={styles.cardItem}>• <Text style={styles.boldText}>Right to Damages:</Text> Indemnification for damages sustained due to inaccurate, incomplete, or unlawful processing.</Text>
                </View>

                <View style={styles.card}>
                  <Text style={styles.cardHeader}>4. Data Protection Inquiries</Text>
                  <Text style={styles.cardText}>
                    For data protection inquiries or to exercise your rights under RA 10173, contact:{"\n"}
                    <Text style={styles.boldText}>City Environment & Natural Resources Office (CENRO)</Text>{"\n"}
                    City Hall Compound, F. Ralota St., Danao City, Cebu 6004{"\n"}
                    Email: <Text style={styles.boldText}>dataprivacy@trashtrack.gov.ph</Text>
                  </Text>
                </View>

                {/* Bottom Navigation Prompt */}
                <View style={styles.bottomNavContainer}>
                  {readTabs.privacy ? (
                    <TouchableOpacity
                      style={styles.nextTabButton}
                      onPress={() => setActiveTab("consent")}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.nextTabButtonText}>
                        {readTabs.consent ? "View Informed Consent" : "Continue to Informed Consent"}
                      </Text>
                      <Ionicons name="arrow-forward" size={15} color="#1B4D3E" />
                    </TouchableOpacity>
                  ) : (
                    <View style={styles.scrollDownHint}>
                      <Ionicons name="arrow-down-circle-outline" size={15} color="#64748B" />
                      <Text style={styles.scrollDownHintText}>Scroll to the bottom of this section</Text>
                    </View>
                  )}
                </View>
              </View>
            ) : (
              /* INFORMED CONSENT CONTENT */
              <View>
                <View style={styles.badgeBanner}>
                  <Ionicons name="checkmark-done-circle" size={18} color="#059669" />
                  <Text style={styles.badgeBannerText}>
                    Voluntary Informed Consent Declaration
                  </Text>
                </View>

                <Text style={styles.sectionTitle}>Informed Consent for TrashTrack</Text>
                <Text style={styles.paragraph}>
                  By confirming this agreement, you freely, voluntarily, and expressly authorize <Text style={styles.boldText}>TrashTrack</Text>, in collaboration with the <Text style={styles.boldText}>City Environment and Natural Resources Office (CENRO)</Text> of Danao City, to collect, process, and securely store your information under RA 10173.
                </Text>

                <View style={styles.card}>
                  <Text style={styles.cardHeader}>1. Information We Collect</Text>
                  <Text style={styles.cardItem}>• <Text style={styles.boldText}>Identity Data:</Text> Full name, employee/resident designation, and contact details.</Text>
                  <Text style={styles.cardItem}>• <Text style={styles.boldText}>Locational Information:</Text> Assigned Barangay, street address, and live GPS coordinates during dispatch or reporting.</Text>
                  <Text style={styles.cardItem}>• <Text style={styles.boldText}>Operational Records:</Text> Geo-tagged photos, pickup verification weights, and route timestamps.</Text>
                </View>

                <View style={styles.card}>
                  <Text style={styles.cardHeader}>2. Purpose of Data Processing</Text>
                  <Text style={styles.cardItem}>• Coordinating and optimizing scheduled residential garbage collection routes.</Text>
                  <Text style={styles.cardItem}>• Dispatching municipal waste collection trucks to reported uncollected or unsegregated waste.</Text>
                  <Text style={styles.cardItem}>• Crediting eco-rewards and points for verified sustainable waste disposal.</Text>
                  <Text style={styles.cardItem}>• Sending collection schedule updates, weather-related delays, and public advisories.</Text>
                </View>

                <View style={styles.card}>
                  <Text style={styles.cardHeader}>3. Voluntary Participation & Withdrawal</Text>
                  <Text style={styles.cardText}>
                    Providing your data is voluntary. You retain the right to withdraw consent or request account deactivation at any time via Profile Settings or by contacting the Danao City CENRO Helpdesk.
                  </Text>
                </View>

                {/* Bottom Navigation Prompt */}
                <View style={styles.bottomNavContainer}>
                  {allCompleted ? (
                    <View style={styles.allCompletedBadge}>
                      <Ionicons name="checkmark-done-circle" size={18} color="#059669" />
                      <Text style={styles.allCompletedBadgeText}>
                        All 3 sections reviewed! Click below to confirm.
                      </Text>
                    </View>
                  ) : readTabs.consent ? (
                    <TouchableOpacity
                      style={styles.nextTabButton}
                      onPress={() => {
                        if (!readTabs.terms) setActiveTab("terms");
                        else if (!readTabs.privacy) setActiveTab("privacy");
                      }}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.nextTabButtonText}>
                        {!readTabs.terms ? "Review Terms & Conditions" : "Review Privacy Notice"}
                      </Text>
                      <Ionicons name="arrow-forward" size={15} color="#1B4D3E" />
                    </TouchableOpacity>
                  ) : (
                    <View style={styles.scrollDownHint}>
                      <Ionicons name="arrow-down-circle-outline" size={15} color="#64748B" />
                      <Text style={styles.scrollDownHintText}>Scroll to the bottom of this section</Text>
                    </View>
                  )}
                </View>
              </View>
            )}
          </ScrollView>

          {/* Footer Actions */}
          <View
            style={[
              styles.footer,
              isMobile && {
                paddingBottom:
                  Platform.OS === "web"
                    ? 16
                    : Math.max(insets.bottom + 12, 16),
              },
            ]}
          >
            {!allCompleted && (
              <View style={styles.footerProgressRow}>
                <Ionicons name="information-circle" size={15} color="#B45309" />
                <Text style={styles.footerProgressText}>
                  Please scroll to the bottom of all 3 terms ({completedCount}/3 completed)
                </Text>
              </View>
            )}

            <View style={styles.footerButtonsRow}>
              <TouchableOpacity
                style={styles.closeModalButton}
                onPress={onClose}
                activeOpacity={0.8}
              >
                <Text style={styles.closeModalButtonText}>Close</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.acceptButton,
                  !allCompleted && styles.acceptButtonDisabled,
                ]}
                onPress={handleAccept}
                disabled={!allCompleted}
                activeOpacity={allCompleted ? 0.8 : 1}
              >
                <Ionicons
                  name={allCompleted ? "checkmark-circle" : "lock-closed-outline"}
                  size={18}
                  color={allCompleted ? "#FFFFFF" : "#64748B"}
                  style={{ marginRight: 6 }}
                />
                <Text
                  style={[
                    styles.acceptButtonText,
                    !allCompleted && styles.acceptButtonTextDisabled,
                  ]}
                >
                  {allCompleted ? acceptButtonText : `Scroll 3 terms to confirm (${completedCount}/3)`}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
  },
  modalOverlayDesktop: {
    backgroundColor: "rgba(15, 23, 42, 0.75)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 24,
  },
  modalOverlayMobile: {
    backgroundColor: "#FFFFFF",
    justifyContent: "flex-start",
    alignItems: "stretch",
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  modalContainer: {
    backgroundColor: "#FFFFFF",
    flexDirection: "column",
    overflow: "hidden",
  },
  modalContainerDesktop: {
    borderRadius: 20,
    width: "100%",
    maxWidth: 720,
    maxHeight: 840,
    height: "90%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.22,
    shadowRadius: 28,
    elevation: 12,
  },
  modalContainerMobile: {
    flex: 1,
    width: "100%",
    height: "100%",
    borderRadius: 0,
  },
  header: {
    paddingHorizontal: Platform.OS === "web" ? 22 : 16,
    paddingTop: Platform.OS === "web" ? 18 : 14,
    paddingBottom: Platform.OS === "web" ? 14 : 10,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
    backgroundColor: "#FFFFFF",
  },
  headerTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#ECFDF5",
    borderWidth: 1.5,
    borderColor: "#A7F3D0",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#0F172A",
    letterSpacing: -0.2,
  },
  headerSubtitle: {
    fontSize: 12.5,
    color: "#64748B",
    marginTop: 2,
    fontWeight: "500",
  },
  closeButton: {
    padding: 7,
    backgroundColor: "#F1F5F9",
    borderRadius: 18,
    ...Platform.select({
      web: { cursor: "pointer" } as any,
    }),
  },
  tabBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F1F5F9",
    borderRadius: 12,
    padding: 4,
    gap: 4,
    width: "100%",
  },
  tabButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 9,
    gap: 6,
    ...Platform.select({
      web: { cursor: "pointer" } as any,
    }),
  },
  tabButtonActive: {
    backgroundColor: "#1B4D3E",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 3,
    elevation: 2,
  },
  tabButtonText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#64748B",
  },
  tabButtonTextActive: {
    color: "#FFFFFF",
    fontWeight: "800",
  },
  scrollContent: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  scrollInner: {
    paddingHorizontal: Platform.OS === "web" ? 22 : 16,
    paddingTop: 16,
    paddingBottom: 24,
  },
  badgeBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ECFDF5",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    gap: 8,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#A7F3D0",
  },
  badgeBannerText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#065F46",
    flex: 1,
  },
  sectionTitle: {
    fontSize: 18.5,
    fontWeight: "800",
    color: "#0F172A",
    marginBottom: 10,
    letterSpacing: -0.2,
  },
  paragraph: {
    fontSize: 14.5,
    lineHeight: 23,
    color: "#1E293B",
    marginBottom: 14,
  },
  boldText: {
    fontWeight: "700",
    color: "#0F172A",
  },
  card: {
    backgroundColor: "#F8FAFC",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    padding: Platform.OS === "web" ? 16 : 14,
    marginBottom: 12,
  },
  cardHeader: {
    fontSize: 15,
    fontWeight: "800",
    color: "#0F172A",
    marginBottom: 8,
  },
  cardItem: {
    fontSize: 14,
    lineHeight: 22,
    color: "#334155",
    marginBottom: 8,
  },
  cardText: {
    fontSize: 14,
    lineHeight: 22,
    color: "#334155",
  },
  bottomNavContainer: {
    marginTop: 8,
    marginBottom: 12,
    alignItems: "center",
  },
  nextTabButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ECFDF5",
    borderWidth: 1.5,
    borderColor: "#A7F3D0",
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 8,
    width: "100%",
    ...Platform.select({
      web: { cursor: "pointer" } as any,
    }),
  },
  nextTabButtonText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#1B4D3E",
  },
  scrollDownHint: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    gap: 6,
  },
  scrollDownHintText: {
    fontSize: 13,
    fontWeight: "500",
    color: "#64748B",
  },
  allCompletedBadge: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ECFDF5",
    borderWidth: 1,
    borderColor: "#A7F3D0",
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 14,
    gap: 8,
    width: "100%",
  },
  allCompletedBadgeText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#065F46",
  },
  footer: {
    flexDirection: "column",
    alignItems: "center",
    paddingHorizontal: Platform.OS === "web" ? 22 : 16,
    paddingTop: 12,
    paddingBottom: Platform.OS === "ios" ? 24 : 14,
    borderTopWidth: 1,
    borderTopColor: "#F1F5F9",
    backgroundColor: "#FFFFFF",
  },
  footerProgressRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFBEB",
    borderWidth: 1,
    borderColor: "#FDE68A",
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginBottom: 10,
    gap: 6,
    width: "100%",
  },
  footerProgressText: {
    fontSize: 12.5,
    fontWeight: "600",
    color: "#92400E",
  },
  footerButtonsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    width: "100%",
  },
  closeModalButton: {
    paddingVertical: 13,
    paddingHorizontal: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    backgroundColor: "#F8FAFC",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 96,
    ...Platform.select({
      web: { cursor: "pointer" } as any,
    }),
  },
  closeModalButtonText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#475569",
  },
  acceptButton: {
    flex: 1,
    backgroundColor: "#1B4D3E",
    paddingVertical: 13,
    paddingHorizontal: 20,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#1B4D3E",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
    ...Platform.select({
      web: { cursor: "pointer" } as any,
    }),
  },
  acceptButtonDisabled: {
    backgroundColor: "#E2E8F0",
    shadowOpacity: 0,
    elevation: 0,
    ...Platform.select({
      web: { cursor: "not-allowed" } as any,
    }),
  },
  acceptButtonText: {
    fontSize: 14.5,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 0.2,
  },
  acceptButtonTextDisabled: {
    color: "#64748B",
    fontWeight: "700",
  },
});

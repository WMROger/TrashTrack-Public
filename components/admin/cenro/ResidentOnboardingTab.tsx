import { MaterialIcons } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
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
} from "react-native";
import { DANAO_CITY_BARANGAYS } from "@/constants/danaoBarangays";
import { provisionResidentOnSpark } from "@/services/residentProvisioningService";

export default function ResidentOnboardingTab({
  onClose,
  defaultBarangay,
  isReadOnly = false,
}: {
  onClose?: () => void;
  defaultBarangay?: string;
  isReadOnly?: boolean;
}) {
  const { width } = useWindowDimensions();
  const isMobile = width < 768;

  // Personal Info
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [middleInitial, setMiddleInitial] = useState("");

  // Credentials & Contact
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("Danao2026!");
  const [showPassword, setShowPassword] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState("");

  // Location
  const [barangay, setBarangay] = useState(defaultBarangay || "");
  const [street, setStreet] = useState("");
  const [isBarangayDropdownOpen, setIsBarangayDropdownOpen] = useState(false);
  const [barangaySearchQuery, setBarangaySearchQuery] = useState("");

  // Settings
  const [initialPoints, setInitialPoints] = useState("50");

  // State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [bannerFeedback, setBannerFeedback] = useState<{
    type: "error" | "success";
    message: string;
  } | null>(null);
  const [successModalData, setSuccessModalData] = useState<any>(null);

  // Filtered barangays
  const filteredBarangays = useMemo(() => {
    if (!barangaySearchQuery.trim()) return DANAO_CITY_BARANGAYS;
    const q = barangaySearchQuery.toLowerCase().trim();
    return DANAO_CITY_BARANGAYS.filter((b) => b.toLowerCase().includes(q));
  }, [barangaySearchQuery]);

  const handleSubmit = async () => {
    if (isReadOnly) {
      Alert.alert("Read-Only Mode", "Account provisioning is restricted in Read-Only Mode.");
      return;
    }
    setBannerFeedback(null);

    if (!firstName.trim() || !lastName.trim()) {
      setBannerFeedback({
        type: "error",
        message: "Please enter the resident's First and Last Name.",
      });
      return;
    }

    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setBannerFeedback({
        type: "error",
        message: "Please enter a valid resident email address.",
      });
      return;
    }

    if (password.length < 8) {
      setBannerFeedback({
        type: "error",
        message: "Temporary password must be at least 8 characters long.",
      });
      return;
    }

    if (!barangay.trim()) {
      setBannerFeedback({
        type: "error",
        message: "Please select a Danao City barangay for this resident.",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await provisionResidentOnSpark({
        firstName,
        lastName,
        middleInitial,
        email,
        password,
        phoneNumber,
        barangay,
        street,
        initialPoints: parseInt(initialPoints, 10) || 50,
      });

      setSuccessModalData(result);
    } catch (err: any) {
      console.error("Error provisioning resident account:", err);
      setBannerFeedback({
        type: "error",
        message: err?.message || "Failed to create resident account.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* Modal / Card Header */}
      <View style={styles.header}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={styles.headerIconBadge}>
            <MaterialIcons name="person-add-alt-1" size={24} color="#2563EB" />
          </View>
          <View>
            <Text style={styles.headerTitle}>Onboard Resident Account</Text>
            <Text style={styles.headerSubtitle}>
              Register a verified Danao City citizen resident into TrashTrack
            </Text>
          </View>
        </View>
        {onClose && (
          <TouchableOpacity
            style={styles.closeBtn}
            onPress={onClose}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <MaterialIcons name="close" size={22} color="#64748B" />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
        showsVerticalScrollIndicator={true}
      >
        {/* Banner Feedback */}
        {bannerFeedback && (
          <View
            style={[
              styles.banner,
              bannerFeedback.type === "error"
                ? styles.bannerError
                : styles.bannerSuccess,
            ]}
          >
            <MaterialIcons
              name={bannerFeedback.type === "error" ? "error-outline" : "check-circle"}
              size={18}
              color={bannerFeedback.type === "error" ? "#B91C1C" : "#15803D"}
            />
            <Text
              style={[
                styles.bannerText,
                { color: bannerFeedback.type === "error" ? "#B91C1C" : "#15803D" },
              ]}
            >
              {bannerFeedback.message}
            </Text>
          </View>
        )}

        {/* Section 1: Citizen Identification */}
        <View style={styles.sectionCard}>
          <View style={styles.sectionCardHeader}>
            <MaterialIcons name="badge" size={18} color="#2563EB" />
            <Text style={styles.sectionCardTitle}>1. Resident Information</Text>
          </View>

          <View style={[styles.formRow, isMobile && { flexDirection: "column" }]}>
            <View style={{ flex: 2 }}>
              <Text style={styles.inputLabel}>FIRST NAME *</Text>
              <TextInput
                style={styles.textInput}
                placeholder="e.g. Maria"
                placeholderTextColor="#94A3B8"
                value={firstName}
                onChangeText={setFirstName}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.inputLabel}>M.I. (OPTIONAL)</Text>
              <TextInput
                style={styles.textInput}
                placeholder="e.g. S"
                placeholderTextColor="#94A3B8"
                maxLength={2}
                value={middleInitial}
                onChangeText={setMiddleInitial}
              />
            </View>
            <View style={{ flex: 2 }}>
              <Text style={styles.inputLabel}>LAST NAME *</Text>
              <TextInput
                style={styles.textInput}
                placeholder="e.g. Santos"
                placeholderTextColor="#94A3B8"
                value={lastName}
                onChangeText={setLastName}
              />
            </View>
          </View>
        </View>

        {/* Section 2: Account Login Credentials */}
        <View style={styles.sectionCard}>
          <View style={styles.sectionCardHeader}>
            <MaterialIcons name="lock-outline" size={18} color="#2563EB" />
            <Text style={styles.sectionCardTitle}>2. Account Credentials & Contact</Text>
          </View>

          <View style={[styles.formRow, isMobile && { flexDirection: "column" }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.inputLabel}>EMAIL ADDRESS *</Text>
              <TextInput
                style={styles.textInput}
                placeholder="e.g. resident@gmail.com"
                placeholderTextColor="#94A3B8"
                autoCapitalize="none"
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.inputLabel}>CONTACT PHONE NUMBER (OPTIONAL)</Text>
              <TextInput
                style={styles.textInput}
                placeholder="e.g. 0917-123-4567"
                placeholderTextColor="#94A3B8"
                keyboardType="phone-pad"
                value={phoneNumber}
                onChangeText={setPhoneNumber}
              />
            </View>
          </View>

          <View style={{ marginTop: 6 }}>
            <Text style={styles.inputLabel}>INITIAL TEMPORARY PASSWORD *</Text>
            <View style={styles.passwordInputWrap}>
              <TextInput
                style={styles.passwordTextInput}
                placeholder="Enter password (min 8 chars)"
                placeholderTextColor="#94A3B8"
                secureTextEntry={!showPassword}
                value={password}
                onChangeText={setPassword}
              />
              <TouchableOpacity
                onPress={() => setShowPassword(!showPassword)}
                style={styles.eyeBtn}
              >
                <MaterialIcons
                  name={showPassword ? "visibility-off" : "visibility"}
                  size={18}
                  color="#64748B"
                />
              </TouchableOpacity>
            </View>
            <Text style={styles.inputHelper}>
              The resident can sign into the mobile app immediately and update this password.
            </Text>
          </View>
        </View>

        {/* Section 3: Danao City Barangay Location */}
        <View style={styles.sectionCard}>
          <View style={styles.sectionCardHeader}>
            <MaterialIcons name="place" size={18} color="#2563EB" />
            <Text style={styles.sectionCardTitle}>3. Danao City Barangay & Address</Text>
          </View>

          <View style={{ marginBottom: 12 }}>
            <Text style={styles.inputLabel}>DANAO CITY BARANGAY *</Text>
            <TouchableOpacity
              style={styles.dropdownBtn}
              onPress={() => setIsBarangayDropdownOpen(!isBarangayDropdownOpen)}
              activeOpacity={0.8}
            >
              <Text style={[styles.dropdownBtnText, !barangay && { color: "#94A3B8" }]}>
                {barangay ? `Brgy. ${barangay}` : "Select Danao City Barangay..."}
              </Text>
              <MaterialIcons
                name={isBarangayDropdownOpen ? "expand-less" : "expand-more"}
                size={20}
                color="#64748B"
              />
            </TouchableOpacity>

            {isBarangayDropdownOpen && (
              <View style={styles.dropdownMenu}>
                <View style={styles.dropdownSearchWrap}>
                  <MaterialIcons name="search" size={16} color="#94A3B8" />
                  <TextInput
                    style={styles.dropdownSearchInput}
                    placeholder="Search 42 Danao barangays..."
                    placeholderTextColor="#94A3B8"
                    value={barangaySearchQuery}
                    onChangeText={setBarangaySearchQuery}
                  />
                  {barangaySearchQuery.length > 0 && (
                    <TouchableOpacity onPress={() => setBarangaySearchQuery("")}>
                      <MaterialIcons name="close" size={14} color="#94A3B8" />
                    </TouchableOpacity>
                  )}
                </View>
                <ScrollView style={{ maxHeight: 180 }} nestedScrollEnabled={true}>
                  {filteredBarangays.map((b) => (
                    <TouchableOpacity
                      key={b}
                      style={[
                        styles.dropdownItem,
                        barangay === b && styles.dropdownItemActive,
                      ]}
                      onPress={() => {
                        setBarangay(b);
                        setIsBarangayDropdownOpen(false);
                        setBarangaySearchQuery("");
                      }}
                    >
                      <Text
                        style={[
                          styles.dropdownItemText,
                          barangay === b && styles.dropdownItemTextActive,
                        ]}
                      >
                        Brgy. {b}
                      </Text>
                      {barangay === b && (
                        <MaterialIcons name="check" size={16} color="#2563EB" />
                      )}
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}
          </View>

          <View>
            <Text style={styles.inputLabel}>SITIO / STREET ADDRESS (OPTIONAL)</Text>
            <TextInput
              style={styles.textInput}
              placeholder="e.g. Sitio Tuburan, Zone 3"
              placeholderTextColor="#94A3B8"
              value={street}
              onChangeText={setStreet}
            />
          </View>
        </View>

        {/* Section 4: Welcome Bonus & Verification Status */}
        <View style={styles.sectionCard}>
          <View style={styles.sectionCardHeader}>
            <MaterialIcons name="verified" size={18} color="#16A34A" />
            <Text style={styles.sectionCardTitle}>4. Verification & Civic Privileges</Text>
          </View>

          <View style={[styles.formRow, isMobile && { flexDirection: "column" }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.inputLabel}>INITIAL ECO-POINTS BONUS</Text>
              <View style={styles.passwordInputWrap}>
                <MaterialIcons name="stars" size={18} color="#D97706" style={{ marginLeft: 10 }} />
                <TextInput
                  style={[styles.passwordTextInput, { paddingLeft: 6 }]}
                  keyboardType="numeric"
                  placeholder="50"
                  value={initialPoints}
                  onChangeText={setInitialPoints}
                />
                <Text style={styles.pointsSuffix}>PTS</Text>
              </View>
              <Text style={styles.inputHelper}>
                Granted to citizen as civic welcome token balance.
              </Text>
            </View>

            <View style={{ flex: 1, justifyContent: "center" }}>
              <View style={styles.verifiedNoticeBox}>
                <MaterialIcons name="verified-user" size={20} color="#15803D" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.verifiedNoticeTitle}>Verified Resident Status</Text>
                  <Text style={styles.verifiedNoticeText}>
                    Account will be automatically marked as verified by CENRO administrative oversight.
                  </Text>
                </View>
              </View>
            </View>
          </View>
        </View>

        {/* Action Buttons */}
        <View style={styles.actionsRow}>
          {onClose && (
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={onClose}
              disabled={isSubmitting}
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.submitBtn, (isSubmitting || isReadOnly) && { opacity: 0.5 }]}
            onPress={handleSubmit}
            disabled={isSubmitting || isReadOnly}
            activeOpacity={0.85}
          >
            {isSubmitting ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <ActivityIndicator size="small" color="#FFFFFF" />
                <Text style={styles.submitBtnText}>Creating Account…</Text>
              </View>
            ) : (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <MaterialIcons name="how-to-reg" size={18} color="#FFFFFF" />
                <Text style={styles.submitBtnText}>Register Resident Account</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Success Modal */}
      {successModalData && (
        <Modal
          visible={!!successModalData}
          transparent={true}
          animationType="fade"
          onRequestClose={() => {
            setSuccessModalData(null);
            onClose?.();
          }}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.successModalCard}>
              <View style={styles.successIconBadge}>
                <MaterialIcons name="check-circle" size={48} color="#16A34A" />
              </View>
              <Text style={styles.successTitle}>Resident Account Created!</Text>
              <Text style={styles.successSub}>
                {successModalData.displayName} has been successfully registered as a verified citizen of Brgy. {successModalData.barangay}.
              </Text>

              <View style={styles.credentialsBox}>
                <View style={styles.credRow}>
                  <Text style={styles.credLabel}>Email:</Text>
                  <Text style={styles.credValue}>{successModalData.email}</Text>
                </View>
                <View style={styles.credRow}>
                  <Text style={styles.credLabel}>Temporary Password:</Text>
                  <Text style={styles.credValue}>{successModalData.password}</Text>
                </View>
                <View style={styles.credRow}>
                  <Text style={styles.credLabel}>Barangay:</Text>
                  <Text style={styles.credValue}>Brgy. {successModalData.barangay}</Text>
                </View>
                <View style={styles.credRow}>
                  <Text style={styles.credLabel}>Welcome Balance:</Text>
                  <Text style={[styles.credValue, { color: "#0D9488" }]}>+{successModalData.points} pts</Text>
                </View>
              </View>

              <TouchableOpacity
                style={styles.doneBtn}
                onPress={() => {
                  setSuccessModalData(null);
                  onClose?.();
                }}
              >
                <Text style={styles.doneBtnText}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8FAFC",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
  },
  headerIconBadge: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: "#EFF6FF",
    borderWidth: 1,
    borderColor: "#DBEAFE",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: "#0F172A",
  },
  headerSubtitle: {
    fontSize: 12,
    color: "#64748B",
    marginTop: 2,
  },
  closeBtn: {
    padding: 6,
    borderRadius: 8,
  },
  body: {
    flex: 1,
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
    borderWidth: 1,
  },
  bannerError: {
    backgroundColor: "#FEF2F2",
    borderColor: "#FECACA",
  },
  bannerSuccess: {
    backgroundColor: "#F0FDF4",
    borderColor: "#BBF7D0",
  },
  bannerText: {
    fontSize: 12.5,
    fontWeight: "600",
    flex: 1,
  },
  sectionCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    padding: 16,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  sectionCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
    paddingBottom: 10,
  },
  sectionCardTitle: {
    fontSize: 13.5,
    fontWeight: "800",
    color: "#0F172A",
  },
  formRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 10,
  },
  inputLabel: {
    fontSize: 10.5,
    fontWeight: "800",
    color: "#475569",
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  textInput: {
    backgroundColor: "#F8FAFC",
    borderWidth: 1.5,
    borderColor: "#CBD5E1",
    borderRadius: 9,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 13,
    color: "#0F172A",
  },
  passwordInputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderWidth: 1.5,
    borderColor: "#CBD5E1",
    borderRadius: 9,
  },
  passwordTextInput: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 13,
    color: "#0F172A",
  },
  eyeBtn: {
    paddingHorizontal: 10,
  },
  pointsSuffix: {
    fontSize: 11,
    fontWeight: "800",
    color: "#D97706",
    paddingRight: 12,
  },
  inputHelper: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 4,
  },
  dropdownBtn: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderWidth: 1.5,
    borderColor: "#CBD5E1",
    borderRadius: 9,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  dropdownBtnText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#0F172A",
  },
  dropdownMenu: {
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#CBD5E1",
    marginTop: 6,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  dropdownSearchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "#F8FAFC",
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
  },
  dropdownSearchInput: {
    flex: 1,
    fontSize: 12,
    color: "#0F172A",
    padding: 0,
  },
  dropdownItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
  },
  dropdownItemActive: {
    backgroundColor: "#EFF6FF",
  },
  dropdownItemText: {
    fontSize: 12.5,
    color: "#334155",
  },
  dropdownItemTextActive: {
    color: "#2563EB",
    fontWeight: "700",
  },
  verifiedNoticeBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#F0FDF4",
    borderWidth: 1,
    borderColor: "#BBF7D0",
    borderRadius: 10,
    padding: 12,
  },
  verifiedNoticeTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: "#15803D",
  },
  verifiedNoticeText: {
    fontSize: 11,
    color: "#166534",
    marginTop: 2,
  },
  actionsRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 12,
    marginTop: 8,
  },
  cancelBtn: {
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: "#F1F5F9",
  },
  cancelBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#64748B",
  },
  submitBtn: {
    backgroundColor: "#2563EB",
    paddingHorizontal: 22,
    paddingVertical: 11,
    borderRadius: 10,
    shadowColor: "#2563EB",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  submitBtnText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.65)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  successModalCard: {
    width: "100%",
    maxWidth: 460,
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 24,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 10,
  },
  successIconBadge: {
    marginBottom: 12,
  },
  successTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: "#0F172A",
    textAlign: "center",
  },
  successSub: {
    fontSize: 12.5,
    color: "#64748B",
    textAlign: "center",
    marginTop: 6,
    lineHeight: 18,
  },
  credentialsBox: {
    width: "100%",
    backgroundColor: "#F8FAFC",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    padding: 14,
    marginVertical: 16,
    gap: 8,
  },
  credRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  credLabel: {
    fontSize: 11.5,
    color: "#64748B",
    fontWeight: "600",
  },
  credValue: {
    fontSize: 12,
    fontWeight: "800",
    color: "#0F172A",
  },
  doneBtn: {
    width: "100%",
    backgroundColor: "#2563EB",
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  doneBtnText: {
    fontSize: 13.5,
    fontWeight: "800",
    color: "#FFFFFF",
  },
});

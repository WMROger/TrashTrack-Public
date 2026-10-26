import { MaterialIcons } from "@expo/vector-icons";
import {
  collection,
  deleteDoc,
  getDocs,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import React, { useEffect, useMemo, useRef, useState } from "react";
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
import { db } from "@/config/firebase";
import { DANAO_CITY_BARANGAYS, resolveScheduleBarangays } from "@/constants/danaoBarangays";
import { provisionCoordinatorOnSpark } from "@/services/coordinatorProvisioningService";

export default function CoordinatorOnboardingTab({
  onClose,
  initialUser,
  initialMode,
  isReadOnly = false,
}: {
  onClose?: () => void;
  initialUser?: any;
  initialMode?: "create" | "upgrade";
  isReadOnly?: boolean;
} = {}) {
  const { width } = useWindowDimensions();
  const isMobile = width < 768;
  const isNarrow = width < 960;
  const scrollViewRef = useRef<ScrollView>(null);

  const [mode, setMode] = useState<"create" | "upgrade">(
    initialMode || (initialUser ? "upgrade" : "create")
  );

  // Employee ID State
  const [employeeSuffix, setEmployeeSuffix] = useState("");
  const [isCalculatingId, setIsCalculatingId] = useState(false);

  // Create State - Personal
  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [middleInitial, setMiddleInitial] = useState("");

  // Credentials & Contact
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [assignedZone, setAssignedZone] = useState("");

  // Upgrade State
  const [searchEmail, setSearchEmail] = useState("");
  const [foundUser, setFoundUser] = useState<any>(initialUser || null);
  const [residentsList, setResidentsList] = useState<any[]>([]);

  // Barangay Assignment (1 Coordinator per Barangay)
  const [assignedBarangay, setAssignedBarangay] = useState(
    initialUser?.assignedBarangay || initialUser?.barangay || ""
  );
  const [isBarangayDropdownOpen, setIsBarangayDropdownOpen] = useState(false);
  const [barangaySearchQuery, setBarangaySearchQuery] = useState("");
  const [availableBarangays, setAvailableBarangays] = useState<string[]>([...DANAO_CITY_BARANGAYS]);
  const [scheduleBarangaySet, setScheduleBarangaySet] = useState<Set<string>>(new Set());
  const [existingCoordinators, setExistingCoordinators] = useState<any[]>([]);

  // Submission State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({});
  const [bannerFeedback, setBannerFeedback] = useState<{
    type: "error" | "success";
    message: string;
  } | null>(null);
  const [successModalData, setSuccessModalData] = useState<any>(null);

  // Compute map of taken barangays -> coordinator name
  const takenBarangaysMap = useMemo(() => {
    const map: { [barangay: string]: string } = {};
    existingCoordinators.forEach((c) => {
      const b = c.assignedBarangay || c.barangay;
      if (b) {
        map[b] = c.displayName || c.email || "Active Coordinator";
      }
    });
    return map;
  }, [existingCoordinators]);

  // Available barangays count
  const availableBarangaysCount = useMemo(() => {
    return availableBarangays.filter((b) => !takenBarangaysMap[b]).length;
  }, [availableBarangays, takenBarangaysMap]);

  // Filtered barangays for dropdown search
  const filteredBarangays = useMemo(() => {
    if (!barangaySearchQuery.trim()) return availableBarangays;
    const q = barangaySearchQuery.toLowerCase().trim();
    return availableBarangays.filter((b) => b.toLowerCase().includes(q));
  }, [availableBarangays, barangaySearchQuery]);

  // Auto-increment Coordinator Employee ID (e.g., CENRO-COORD-001)
  const fetchNextEmployeeId = async () => {
    if (!db) return;
    setIsCalculatingId(true);
    try {
      const existingNumbers = new Set<number>();

      // Read active users to detect active coordinators vs deleted orphans
      const allUsersSnap = await getDocs(collection(db, "users"));
      const activeUserIds = new Set<string>();
      allUsersSnap.forEach((d) => activeUserIds.add(d.id));

      // 1. Scan verified coordinator identifiers collection & clean up orphans from deleted users
      try {
        const identSnap = await getDocs(collection(db, "identifiers", "coordinator", "items"));
        for (const d of identSnap.docs) {
          const uId = d.data()?.userId;
          if (uId && !activeUserIds.has(uId)) {
            // Deleted user orphan - clean up in Firestore
            deleteDoc(d.ref).catch(() => {});
            continue;
          }
          const idStr = String(d.id || d.data()?.id || d.data()?.employeeId || "");
          const match = idStr.match(/(\d+)$/);
          if (match) existingNumbers.add(parseInt(match[1], 10));
        }
      } catch {}

      // Clean up orphaned coordinator_barangays assignments from deleted users
      try {
        const brgyIdentSnap = await getDocs(collection(db, "identifiers", "coordinator_barangays", "items"));
        for (const d of brgyIdentSnap.docs) {
          const uId = d.data()?.userId;
          if (uId && !activeUserIds.has(uId)) {
            // Previous coordinator was deleted - remove the lock!
            deleteDoc(d.ref).catch(() => {});
          }
        }
      } catch {}

      // 2. Scan coordinator_employee_ids collection if present
      try {
        const snap = await getDocs(collection(db, "coordinator_employee_ids"));
        snap.forEach((d) => {
          const uId = d.data()?.userId;
          if (uId && !activeUserIds.has(uId)) {
            deleteDoc(d.ref).catch(() => {});
            return;
          }
          const match = d.id.match(/(\d+)$/);
          if (match) existingNumbers.add(parseInt(match[1], 10));
        });
      } catch {}

      // 3. Scan active users collection for any coordinator roles or COORD employee IDs
      allUsersSnap.forEach((d) => {
        const data = d.data();
        const role = String(data.role || "").toLowerCase();
        const empId = data.employeeId;
        const isCoordRole = role === "coordinator" || role === "barangay_coordinator" || role === "cenro_coordinator";
        const hasCoordId = empId && String(empId).toUpperCase().includes("COORD");
        if ((isCoordRole || hasCoordId) && empId && data.disabled !== true) {
          const match = String(empId).match(/(\d+)$/);
          if (match) existingNumbers.add(parseInt(match[1], 10));
        }
      });

      let nextNum = 1;
      while (existingNumbers.has(nextNum)) {
        nextNum++;
      }
      setEmployeeSuffix(String(nextNum).padStart(3, "0"));
    } catch {
      if (!employeeSuffix) setEmployeeSuffix("001");
    } finally {
      setIsCalculatingId(false);
    }
  };

  useEffect(() => {
    fetchNextEmployeeId();
  }, []);

  // Listen for existing coordinators & residents
  useEffect(() => {
    if (!db) return;

    const qCoord = query(
      collection(db, "users"),
      where("role", "==", "coordinator")
    );
    const unsubCoord = onSnapshot(qCoord, (snap) => {
      const list: any[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
      setExistingCoordinators(list);
    });

    const qUsers = query(collection(db, "users"));
    const unsubUsers = onSnapshot(qUsers, (snap) => {
      const residents: any[] = [];
      snap.forEach((d) => {
        const data = d.data();
        const role = String(data.role || "user").toLowerCase();
        if (
          role !== "admin" &&
          role !== "driver" &&
          role !== "coordinator" &&
          role !== "cicto"
        ) {
          residents.push({ id: d.id, ...data });
        }
      });
      setResidentsList(residents);
    });

    // Listen for collection schedules
    const unsubSchedules = onSnapshot(collection(db, "barangay_schedules"), (snap) => {
      const scheduleNames = new Set<string>();
      snap.forEach((d) => {
        const data = d.data();
        if (data.barangayName && typeof data.barangayName === 'string' && data.barangayName.trim()) {
          scheduleNames.add(data.barangayName.trim());
        }
      });
      setScheduleBarangaySet(scheduleNames);
      setAvailableBarangays(resolveScheduleBarangays(Array.from(scheduleNames)));
    });

    return () => {
      unsubCoord();
      unsubUsers();
      unsubSchedules();
    };
  }, []);

  const fullEmployeeId = `CENRO-COORD-${employeeSuffix.trim() || "001"}`;

  // Philippine Mobile Phone Formatter (10-digits: 9XX XXX XXXX)
  const handlePhoneChange = (text: string) => {
    let digits = text.replace(/\D/g, "");
    if (digits.startsWith("63")) digits = digits.slice(2);
    if (digits.startsWith("0")) digits = digits.slice(1);
    digits = digits.slice(0, 10);

    let formatted = digits;
    if (digits.length > 6) {
      formatted = `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
    } else if (digits.length > 3) {
      formatted = `${digits.slice(0, 3)} ${digits.slice(3)}`;
    }
    setPhoneNumber(formatted);

    if (formErrors.phoneNumber) {
      setFormErrors((prev) => {
        const next = { ...prev };
        delete next.phoneNumber;
        return next;
      });
    }
  };

  const generateSecurePassword = () => {
    const chars =
      "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*";
    let pwd = "";
    for (let i = 0; i < 12; i++) {
      pwd += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setNewPassword(pwd);
    setShowPassword(true);
    if (formErrors.newPassword) {
      setFormErrors((prev) => {
        const next = { ...prev };
        delete next.newPassword;
        return next;
      });
    }
  };

  const getComputedFullName = () => {
    if (mode === "upgrade" && foundUser) {
      return (
        foundUser.displayName ||
        foundUser.name ||
        foundUser.email ||
        "Barangay Coordinator"
      );
    }
    const parts = [lastName.trim(), firstName.trim()];
    let full = parts.filter(Boolean).join(", ");
    if (middleInitial.trim()) full += ` ${middleInitial.trim().toUpperCase()}.`;
    return full;
  };

  const validateForm = () => {
    const errors: { [key: string]: string } = {};

    if (!employeeSuffix.trim()) {
      errors.employeeSuffix = "Coordinator ID is required.";
    }

    if (!assignedBarangay) {
      errors.assignedBarangay =
        "Assigned barangay is required (1 coordinator per barangay).";
    } else if (takenBarangaysMap[assignedBarangay]) {
      errors.assignedBarangay = `Brgy. ${assignedBarangay} already has an assigned coordinator (${takenBarangaysMap[assignedBarangay]}).`;
    }

    if (mode === "create") {
      if (!lastName.trim()) errors.lastName = "Last name is required.";
      if (!firstName.trim()) errors.firstName = "First name is required.";
      if (!newEmail.trim() || !newEmail.includes("@")) {
        errors.newEmail = "A valid login email address is required.";
      }
      const digits = phoneNumber.replace(/\D/g, "");
      if (!phoneNumber.trim() || digits.length < 10) {
        errors.phoneNumber = "A valid 10-digit contact number is required (e.g. 9XX XXX XXXX).";
      } else if (!digits.startsWith("9")) {
        errors.phoneNumber = "Philippine mobile numbers must start with 9.";
      }
      if (!newPassword || newPassword.length < 8 || newPassword.length > 24) {
        errors.newPassword = "Password must be 8 to 24 characters.";
      }
    } else {
      if (!foundUser) {
        errors.foundUser = "Please search and select a resident to upgrade.";
      }
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleOnboardCoordinator = async () => {
    if (isReadOnly) {
      Alert.alert("Read-Only Mode", "Account provisioning is restricted in Read-Only Mode.");
      return;
    }
    setBannerFeedback(null);
    if (!validateForm()) {
      setBannerFeedback({
        type: "error",
        message: "Please correct the highlighted fields before submitting.",
      });
      scrollViewRef.current?.scrollTo({ y: 0, animated: true });
      return;
    }

    setIsSubmitting(true);
    const resolvedFullName = getComputedFullName();
    const resolvedEmail =
      mode === "create" ? newEmail.trim() : foundUser?.email || "";

    try {
      const fullContact = phoneNumber.trim() ? `+63 ${phoneNumber.trim()}` : "";
      await provisionCoordinatorOnSpark({
        mode,
        email: resolvedEmail,
        password: newPassword,
        fullName: resolvedFullName,
        contactInfo: fullContact,
        existingUserId: mode === "upgrade" ? foundUser.id : undefined,
        employeeId: fullEmployeeId,
        barangay: assignedBarangay,
        zone: assignedZone.trim() || undefined,
      });

      setSuccessModalData({
        fullName: resolvedFullName,
        email: resolvedEmail,
        employeeId: fullEmployeeId,
        barangay: assignedBarangay,
        zone: assignedZone.trim() || "Standard",
        password: mode === "create" ? newPassword : "(Unchanged)",
        mode,
      });

      // Reset form
      setLastName("");
      setFirstName("");
      setMiddleInitial("");
      setNewEmail("");
      setNewPassword("");
      setPhoneNumber("");
      setAssignedBarangay("");
      setAssignedZone("");
      setSearchEmail("");
      setFoundUser(null);
      setFormErrors({});
      fetchNextEmployeeId();
    } catch (err: any) {
      console.error("Coordinator Onboarding Error:", err);
      setBannerFeedback({
        type: "error",
        message:
          err.message ||
          "Failed to complete coordinator onboarding. Please check inputs.",
      });
      scrollViewRef.current?.scrollTo({ y: 0, animated: true });
    } finally {
      setIsSubmitting(false);
    }
  };

  const [isResendingEmail, setIsResendingEmail] = useState(false);

  const handleCopyCredentials = () => {
    if (!successModalData) return;
    const text = `TRASH TRACK CENRO COORDINATOR CREDENTIALS\nName: ${successModalData.fullName}\nID: ${successModalData.employeeId}\nBarangay: Brgy. ${successModalData.barangay}\nZone: ${successModalData.zone}\nEmail: ${successModalData.email}\nPassword: ${successModalData.password}`;

    if (
      Platform.OS === "web" &&
      typeof navigator !== "undefined" &&
      navigator.clipboard
    ) {
      navigator.clipboard.writeText(text);
      window.alert("Credentials copied to clipboard!");
    } else {
      Alert.alert("Copied", "Coordinator credentials copied to clipboard!");
    }
  };

  const handleResendCredentialsEmail = async () => {
    if (!successModalData) return;
    setIsResendingEmail(true);
    try {
      const { sendCoordinatorWelcomeEmail } = await import('@/services/emailNotificationService');
      await sendCoordinatorWelcomeEmail({
        toEmail: successModalData.email,
        coordinatorName: successModalData.fullName,
        temporaryPassword: successModalData.mode === "create" ? successModalData.password : undefined,
        employeeId: successModalData.employeeId,
        barangay: successModalData.barangay,
        zone: successModalData.zone,
      });
      if (Platform.OS === "web") {
        window.alert(`Official credentials email sent to ${successModalData.email}!`);
      } else {
        Alert.alert("Email Sent", `Official credentials email sent to ${successModalData.email}!`);
      }
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Could not dispatch credentials email.");
    } finally {
      setIsResendingEmail(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* Sticky Header with Title and Close Button */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <View style={styles.headerBadge}>
            <MaterialIcons name="verified-user" size={13} color="#059669" />
            <Text style={styles.headerSubtitle}>
              CENRO ENVIRONMENTAL JURISDICTION MANAGEMENT
            </Text>
          </View>
          <Text style={styles.headerTitle}>
            Barangay Coordinator Onboarding
          </Text>
        </View>
        {onClose && (
          <TouchableOpacity
            onPress={onClose}
            style={styles.closeBtn}
            activeOpacity={0.7}
          >
            <MaterialIcons name="close" size={20} color="#64748B" />
          </TouchableOpacity>
        )}
      </View>

      {/* Scrollable Form Content */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.scrollContainer}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={true}
        keyboardShouldPersistTaps="handled"
      >
        {/* 1 Coordinator per Barangay Policy Banner */}
        <View style={styles.policyCard}>
          <View style={styles.policyIconBox}>
            <MaterialIcons name="info" size={20} color="#065F46" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.policyCardTitle}>
              1 Coordinator per Barangay Policy
            </Text>
            <Text style={styles.policyCardText}>
              Each of Danao City&apos;s {availableBarangays.length} barangays is
              assigned exactly 1 official Environmental Coordinator. Currently,{" "}
              <Text style={{ fontWeight: "800", color: "#065F46" }}>
                {existingCoordinators.length}
              </Text>{" "}
              assigned,{" "}
              <Text style={{ fontWeight: "800", color: "#059669" }}>
                {availableBarangaysCount}
              </Text>{" "}
              available for assignment.
            </Text>
          </View>
        </View>

        {/* Feedback Banner */}
        {bannerFeedback && (
          <View
            style={[
              styles.feedbackBanner,
              bannerFeedback.type === "error"
                ? styles.feedbackBannerError
                : styles.feedbackBannerSuccess,
            ]}
          >
            <MaterialIcons
              name={
                bannerFeedback.type === "error"
                  ? "error-outline"
                  : "check-circle"
              }
              size={20}
              color={bannerFeedback.type === "error" ? "#B91C1C" : "#047857"}
              style={{ marginRight: 8 }}
            />
            <Text
              style={[
                styles.feedbackText,
                bannerFeedback.type === "error"
                  ? styles.feedbackTextError
                  : styles.feedbackTextSuccess,
              ]}
            >
              {bannerFeedback.message}
            </Text>
          </View>
        )}

        {/* Mode Selector Tabs */}
        <View style={styles.modeContainer}>
          <TouchableOpacity
            style={[styles.modeBtn, mode === "create" && styles.modeBtnActive]}
            onPress={() => {
              setMode("create");
              setFormErrors({});
              setIsBarangayDropdownOpen(false);
            }}
            activeOpacity={0.8}
          >
            <MaterialIcons
              name="person-add"
              size={18}
              color={mode === "create" ? "#FFFFFF" : "#475569"}
              style={{ marginRight: 6 }}
            />
            <Text
              style={[
                styles.modeBtnText,
                mode === "create" && styles.modeBtnTextActive,
              ]}
            >
              Create New Coordinator
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.modeBtn, mode === "upgrade" && styles.modeBtnActive]}
            onPress={() => {
              setMode("upgrade");
              setFormErrors({});
              setIsBarangayDropdownOpen(false);
            }}
            activeOpacity={0.8}
          >
            <MaterialIcons
              name="upgrade"
              size={18}
              color={mode === "upgrade" ? "#FFFFFF" : "#475569"}
              style={{ marginRight: 6 }}
            />
            <Text
              style={[
                styles.modeBtnText,
                mode === "upgrade" && styles.modeBtnTextActive,
              ]}
            >
              Upgrade Existing Resident
            </Text>
          </TouchableOpacity>
        </View>

        {/* Upgrade Resident Search Box */}
        {mode === "upgrade" && (
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionIconBadge}>
                <MaterialIcons name="person-search" size={18} color="#1B4D3E" />
              </View>
              <View>
                <Text style={styles.sectionCardTitle}>
                  Select Resident to Promote
                </Text>
                <Text style={styles.sectionCardSubtitle}>
                  Search from registered resident citizen accounts.
                </Text>
              </View>
            </View>

            <View style={styles.searchBox}>
              <MaterialIcons
                name="search"
                size={18}
                color="#94A3B8"
                style={{ marginRight: 8 }}
              />
              <TextInput
                style={styles.searchInput}
                placeholder="Search resident name or email..."
                placeholderTextColor="#94A3B8"
                value={searchEmail}
                onChangeText={setSearchEmail}
              />
              {searchEmail.length > 0 && (
                <TouchableOpacity onPress={() => setSearchEmail("")}>
                  <MaterialIcons name="close" size={16} color="#94A3B8" />
                </TouchableOpacity>
              )}
            </View>

            {foundUser ? (
              <View style={styles.selectedUserBox}>
                <View style={styles.selectedUserAvatar}>
                  <Text style={styles.selectedUserAvatarText}>
                    {(foundUser.displayName || foundUser.email)
                      .substring(0, 2)
                      .toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.selectedUserName}>
                    {foundUser.displayName || "Resident Citizen"}
                  </Text>
                  <Text style={styles.selectedUserEmail}>
                    {foundUser.email}
                  </Text>
                  {Boolean(foundUser.barangay) && (
                    <Text style={styles.selectedUserBarangay}>
                      📍 Current Barangay: Brgy. {foundUser.barangay}
                    </Text>
                  )}
                </View>
                <TouchableOpacity
                  onPress={() => setFoundUser(null)}
                  style={styles.removeUserBtn}
                >
                  <MaterialIcons name="close" size={18} color="#DC2626" />
                </TouchableOpacity>
              </View>
            ) : (
              <ScrollView
                nestedScrollEnabled
                style={{ maxHeight: 180, marginTop: 8 }}
              >
                {residentsList
                  .filter((r) => {
                    const q = searchEmail.trim().toLowerCase();
                    if (!q) return true;
                    return (
                      (r.displayName || "").toLowerCase().includes(q) ||
                      (r.email || "").toLowerCase().includes(q) ||
                      (r.barangay || "").toLowerCase().includes(q)
                    );
                  })
                  .slice(0, 8)
                  .map((r) => (
                    <TouchableOpacity
                      key={r.id}
                      style={styles.residentItem}
                      onPress={() => {
                        setFoundUser(r);
                        if (r.barangay && !assignedBarangay) {
                          setAssignedBarangay(r.barangay);
                        }
                        if (formErrors.foundUser) {
                          setFormErrors((prev) => {
                            const next = { ...prev };
                            delete next.foundUser;
                            return next;
                          });
                        }
                      }}
                      activeOpacity={0.7}
                    >
                      <View style={styles.residentMiniAvatar}>
                        <Text style={styles.residentMiniAvatarText}>
                          {(r.displayName || r.email || "R")
                            .substring(0, 2)
                            .toUpperCase()}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.residentItemName}>
                          {r.displayName || "Resident"}
                        </Text>
                        <Text style={styles.residentItemEmail}>
                          {r.email}
                          {r.barangay ? ` • Brgy. ${r.barangay}` : ""}
                        </Text>
                      </View>
                      <View style={styles.selectBtnBadge}>
                        <Text style={styles.selectBtnBadgeText}>Select</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
              </ScrollView>
            )}
            {Boolean(formErrors.foundUser) && (
              <Text style={styles.fieldError}>{formErrors.foundUser}</Text>
            )}
          </View>
        )}

        {/* Section 1: Coordinator Identification & Barangay Assignment */}
        <View
          style={[
            styles.sectionCard,
            isBarangayDropdownOpen && styles.sectionCardElevated,
          ]}
        >
          <View style={styles.sectionHeader}>
            <View style={styles.sectionIconBadge}>
              <MaterialIcons name="badge" size={18} color="#1B4D3E" />
            </View>
            <View>
              <Text style={styles.sectionCardTitle}>
                1. Designation & Jurisdiction
              </Text>
              <Text style={styles.sectionCardSubtitle}>
                Configure the coordinator employee ID and designated barangay.
              </Text>
            </View>
          </View>

          <View
            style={[
              styles.formGrid,
              isNarrow && { flexDirection: "column" },
              isBarangayDropdownOpen && { zIndex: 1000 },
            ]}
          >
            {/* Coordinator ID */}
            <View style={{ flex: 1 }}>
              <View style={styles.labelRow}>
                <Text style={styles.label}>
                  COORDINATOR EMPLOYEE ID <Text style={styles.requiredAsterisk}>*</Text>
                </Text>
                <TouchableOpacity
                  onPress={fetchNextEmployeeId}
                  style={styles.autoNextBtn}
                  disabled={isCalculatingId}
                  activeOpacity={0.7}
                >
                  <MaterialIcons
                    name={isCalculatingId ? "hourglass-empty" : "sync"}
                    size={12}
                    color="#059669"
                    style={{ marginRight: 3 }}
                  />
                  <Text style={styles.autoNextBtnText}>
                    {isCalculatingId ? "Syncing..." : "Auto-Next"}
                  </Text>
                </TouchableOpacity>
              </View>
              <View style={styles.idInputContainer}>
                <View style={styles.idPrefix}>
                  <Text style={styles.idPrefixText}>CENRO-COORD-</Text>
                </View>
                <TextInput
                  style={styles.idSuffixInput}
                  value={employeeSuffix}
                  onChangeText={(t) => {
                    setEmployeeSuffix(t.toUpperCase());
                    if (formErrors.employeeSuffix) {
                      setFormErrors((prev) => {
                        const next = { ...prev };
                        delete next.employeeSuffix;
                        return next;
                      });
                    }
                  }}
                  placeholder="001"
                  placeholderTextColor="#94A3B8"
                  maxLength={10}
                />
              </View>
              {formErrors.employeeSuffix ? (
                <Text style={styles.fieldError}>
                  {formErrors.employeeSuffix}
                </Text>
              ) : (
                <Text style={styles.fieldHelper}>
                  Assigned ID:{" "}
                  <Text style={{ fontWeight: "700", color: "#1B4D3E" }}>
                    {fullEmployeeId}
                  </Text>
                </Text>
              )}
            </View>

            {/* Assigned Barangay (Enforce 1:1) */}
            <View
              style={[
                { flex: 1 },
                isBarangayDropdownOpen && { zIndex: 1000, position: "relative" },
              ]}
            >
              <Text style={styles.label}>
                ASSIGNED BARANGAY (1:1 JURISDICTION) <Text style={styles.requiredAsterisk}>*</Text>
              </Text>
              <View
                style={[
                  { position: "relative" },
                  isBarangayDropdownOpen && { zIndex: 1000 },
                ]}
              >
                <TouchableOpacity
                  style={[
                    styles.dropdownBtn,
                    formErrors.assignedBarangay && styles.inputErrorBorder,
                    isBarangayDropdownOpen && styles.dropdownBtnActive,
                  ]}
                  onPress={() => {
                    setIsBarangayDropdownOpen(!isBarangayDropdownOpen);
                    setBarangaySearchQuery("");
                  }}
                  activeOpacity={0.8}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", flex: 1, gap: 8 }}>
                    <MaterialIcons
                      name="location-on"
                      size={18}
                      color={assignedBarangay ? "#059669" : "#94A3B8"}
                    />
                    <Text
                      style={[
                        styles.dropdownBtnText,
                        !assignedBarangay && { color: "#94A3B8" },
                      ]}
                      numberOfLines={1}
                    >
                      {assignedBarangay
                        ? `Brgy. ${assignedBarangay}`
                        : "Select Assigned Barangay..."}
                    </Text>
                  </View>
                  <MaterialIcons
                    name={
                      isBarangayDropdownOpen
                        ? "keyboard-arrow-up"
                        : "keyboard-arrow-down"
                    }
                    size={20}
                    color="#64748B"
                  />
                </TouchableOpacity>

                {/* Dropdown Menu Popup */}
                {isBarangayDropdownOpen && (
                  <View style={styles.dropdownMenu}>
                    {/* Search Filter Header */}
                    <View style={styles.dropdownSearchHeader}>
                      <MaterialIcons name="search" size={16} color="#94A3B8" />
                      <TextInput
                        style={styles.dropdownSearchInput}
                        placeholder="Search 41 barangays..."
                        placeholderTextColor="#94A3B8"
                        value={barangaySearchQuery}
                        onChangeText={setBarangaySearchQuery}
                        autoFocus={Platform.OS === "web"}
                      />
                      {barangaySearchQuery.length > 0 && (
                        <TouchableOpacity
                          onPress={() => setBarangaySearchQuery("")}
                        >
                          <MaterialIcons
                            name="close"
                            size={16}
                            color="#94A3B8"
                          />
                        </TouchableOpacity>
                      )}
                    </View>

                    {/* Barangay List */}
                    <ScrollView
                      nestedScrollEnabled
                      style={{ maxHeight: 220 }}
                      keyboardShouldPersistTaps="handled"
                    >
                      {filteredBarangays.map((b) => {
                        const isTaken = !!takenBarangaysMap[b];
                        const isSelected = assignedBarangay === b;
                        return (
                          <TouchableOpacity
                            key={b}
                            style={[
                              styles.dropdownMenuItem,
                              isTaken && styles.dropdownMenuItemDisabled,
                              isSelected && styles.dropdownMenuItemSelected,
                            ]}
                            onPress={() => {
                              if (isTaken) {
                                Alert.alert(
                                  "Barangay Already Assigned",
                                  `Brgy. ${b} already has an active coordinator (${takenBarangaysMap[b]}). Danao City policy enforces 1 coordinator per barangay.`
                                );
                                return;
                              }
                              setAssignedBarangay(b);
                              setIsBarangayDropdownOpen(false);
                              if (formErrors.assignedBarangay) {
                                setFormErrors((prev) => {
                                  const next = { ...prev };
                                  delete next.assignedBarangay;
                                  return next;
                                });
                              }
                            }}
                            disabled={isTaken}
                            activeOpacity={0.7}
                          >
                            <View style={{ flex: 1 }}>
                              <Text
                                style={[
                                  styles.dropdownMenuItemText,
                                  isTaken && {
                                    color: "#94A3B8",
                                    textDecorationLine: "line-through",
                                  },
                                  isSelected && {
                                    color: "#1B4D3E",
                                    fontWeight: "800",
                                  },
                                ]}
                              >
                                {b}
                              </Text>
                              {isTaken ? (
                                <Text style={styles.takenBadgeText}>
                                  🔒 Assigned: {takenBarangaysMap[b]}
                                </Text>
                              ) : (
                                <Text style={styles.availableBadgeText}>
                                  ✓ Available
                                </Text>
                              )}
                            </View>
                            {isSelected && (
                              <View style={styles.checkedCircle}>
                                <MaterialIcons
                                  name="check"
                                  size={14}
                                  color="#FFFFFF"
                                />
                              </View>
                            )}
                          </TouchableOpacity>
                        );
                      })}
                      {filteredBarangays.length === 0 && (
                        <View style={{ padding: 14, alignItems: "center" }}>
                          <Text style={{ fontSize: 12, color: "#94A3B8" }}>
                            No barangays matching &quot;{barangaySearchQuery}&quot;
                          </Text>
                        </View>
                      )}
                    </ScrollView>
                  </View>
                )}
              </View>
              {formErrors.assignedBarangay ? (
                <Text style={styles.fieldError}>
                  {formErrors.assignedBarangay}
                </Text>
              ) : (
                <Text style={styles.fieldHelper}>
                  Enforces 1:1 CENRO jurisdiction policy
                </Text>
              )}
            </View>
          </View>

          {/* Assigned Zone / Sector */}
          <View
            style={[
              { marginTop: 14 },
              isBarangayDropdownOpen && { zIndex: 1 },
            ]}
          >
            <Text style={styles.label}>ASSIGNED ZONE / SECTOR (OPTIONAL)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Zone 1 - Coastal, Zone 2 - Central, Upland Cluster"
              placeholderTextColor="#94A3B8"
              value={assignedZone}
              onChangeText={setAssignedZone}
            />
            <Text style={styles.fieldHelper}>
              Optional: Specify designated sector or cluster within the barangay
            </Text>
          </View>
        </View>

        {/* Section 2: Personal Details & Account Credentials */}
        {mode === "create" && (
          <View
            style={[
              styles.sectionCard,
              isBarangayDropdownOpen && { zIndex: 1 },
            ]}
          >
            <View style={styles.sectionHeader}>
              <View style={styles.sectionIconBadge}>
                <MaterialIcons name="person" size={18} color="#1B4D3E" />
              </View>
              <View>
                <Text style={styles.sectionCardTitle}>
                  2. Personal Info & Access Credentials
                </Text>
                <Text style={styles.sectionCardSubtitle}>
                  New coordinator profile details and authentication setup.
                </Text>
              </View>
            </View>

            {/* Name Fields */}
            <View
              style={[
                styles.formGrid,
                isNarrow && { flexDirection: "column" },
              ]}
            >
              <View style={{ flex: 1.2 }}>
                <Text style={styles.label}>
                  LAST NAME <Text style={styles.requiredAsterisk}>*</Text>
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    formErrors.lastName && styles.inputErrorBorder,
                  ]}
                  placeholder="Dela Cruz"
                  placeholderTextColor="#94A3B8"
                  value={lastName}
                  onChangeText={(t) => {
                    setLastName(t);
                    if (formErrors.lastName) {
                      setFormErrors((prev) => {
                        const next = { ...prev };
                        delete next.lastName;
                        return next;
                      });
                    }
                  }}
                />
                {Boolean(formErrors.lastName) && (
                  <Text style={styles.fieldError}>{formErrors.lastName}</Text>
                )}
              </View>

              <View style={{ flex: 1.2 }}>
                <Text style={styles.label}>
                  FIRST NAME <Text style={styles.requiredAsterisk}>*</Text>
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    formErrors.firstName && styles.inputErrorBorder,
                  ]}
                  placeholder="Juan"
                  placeholderTextColor="#94A3B8"
                  value={firstName}
                  onChangeText={(t) => {
                    setFirstName(t);
                    if (formErrors.firstName) {
                      setFormErrors((prev) => {
                        const next = { ...prev };
                        delete next.firstName;
                        return next;
                      });
                    }
                  }}
                />
                {Boolean(formErrors.firstName) && (
                  <Text style={styles.fieldError}>{formErrors.firstName}</Text>
                )}
              </View>

              <View style={{ flex: 0.6 }}>
                <Text style={styles.label}>M.I.</Text>
                <TextInput
                  style={styles.input}
                  placeholder="M"
                  placeholderTextColor="#94A3B8"
                  value={middleInitial}
                  onChangeText={setMiddleInitial}
                  maxLength={2}
                />
              </View>
            </View>

            {/* Email & Contact */}
            <View
              style={[
                styles.formGrid,
                { marginTop: 14 },
                isNarrow && { flexDirection: "column" },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>
                  OFFICIAL EMAIL ADDRESS <Text style={styles.requiredAsterisk}>*</Text>
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    formErrors.newEmail && styles.inputErrorBorder,
                  ]}
                  placeholder="coordinator@danaocity.gov.ph"
                  placeholderTextColor="#94A3B8"
                  value={newEmail}
                  onChangeText={(t) => {
                    setNewEmail(t);
                    if (formErrors.newEmail) {
                      setFormErrors((prev) => {
                        const next = { ...prev };
                        delete next.newEmail;
                        return next;
                      });
                    }
                  }}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
                {Boolean(formErrors.newEmail) && (
                  <Text style={styles.fieldError}>{formErrors.newEmail}</Text>
                )}
              </View>

              <View style={{ flex: 1 }}>
                <Text style={styles.label}>
                  CONTACT NUMBER <Text style={styles.requiredAsterisk}>*</Text>
                </Text>
                <View
                  style={[
                    styles.phPhoneContainer,
                    formErrors.phoneNumber ? styles.inputErrorBorder : null,
                  ]}
                >
                  {/* Permanent Philippine +63 Box */}
                  <View style={styles.phPrefixBadge}>
                    <Text style={{ fontSize: 16 }}>🇵🇭</Text>
                    <Text style={styles.phPrefixText}>+63</Text>
                  </View>

                  {/* Empty text box for typing numbers starting with 9 */}
                  <TextInput
                    style={styles.phPhoneInput}
                    placeholder="9XX XXX XXXX"
                    placeholderTextColor="#94A3B8"
                    value={phoneNumber}
                    onChangeText={handlePhoneChange}
                    keyboardType="phone-pad"
                    maxLength={13}
                  />

                  {phoneNumber.length > 0 && (
                    <TouchableOpacity
                      onPress={() => {
                        setPhoneNumber("");
                        if (formErrors.phoneNumber) {
                          setFormErrors((prev) => {
                            const next = { ...prev };
                            delete next.phoneNumber;
                            return next;
                          });
                        }
                      }}
                      style={{ padding: 8, marginRight: 4 }}
                    >
                      <MaterialIcons name="cancel" size={16} color="#94A3B8" />
                    </TouchableOpacity>
                  )}
                </View>
                {formErrors.phoneNumber ? (
                  <Text style={styles.fieldError}>{formErrors.phoneNumber}</Text>
                ) : (
                  <Text style={{ fontSize: 11, color: "#64748B", marginTop: 4 }}>
                    Type 9 immediately (e.g. 9XX XXX XXXX)
                  </Text>
                )}
              </View>
            </View>

            {/* Temporary Password */}
            <View style={{ marginTop: 14 }}>
              <View style={styles.labelRow}>
                <Text style={styles.label}>
                  TEMPORARY LOGIN PASSWORD <Text style={styles.requiredAsterisk}>*</Text>
                </Text>
                <TouchableOpacity
                  onPress={generateSecurePassword}
                  style={styles.autoGenBtn}
                  activeOpacity={0.7}
                >
                  <MaterialIcons name="auto-fix-high" size={14} color="#059669" />
                  <Text style={styles.autoGenBtnText}>Auto-Generate</Text>
                </TouchableOpacity>
              </View>
              <View
                style={[
                  styles.passwordInputContainer,
                  formErrors.newPassword && styles.inputErrorBorder,
                ]}
              >
                <TextInput
                  style={styles.passwordInput}
                  placeholder="8 to 24 characters"
                  placeholderTextColor="#94A3B8"
                  value={newPassword}
                  onChangeText={(t) => {
                    setNewPassword(t);
                    if (formErrors.newPassword) {
                      setFormErrors((prev) => {
                        const next = { ...prev };
                        delete next.newPassword;
                        return next;
                      });
                    }
                  }}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                />
                <TouchableOpacity
                  onPress={() => setShowPassword(!showPassword)}
                  style={styles.eyeBtn}
                  activeOpacity={0.7}
                >
                  <MaterialIcons
                    name={showPassword ? "visibility-off" : "visibility"}
                    size={20}
                    color="#64748B"
                  />
                </TouchableOpacity>
              </View>
              {formErrors.newPassword ? (
                <Text style={styles.fieldError}>{formErrors.newPassword}</Text>
              ) : (
                <Text style={styles.fieldHelper}>
                  A secure temporary password will be provided for initial sign-in
                </Text>
              )}
            </View>
          </View>
        )}
      </ScrollView>

      {/* Fixed/Sticky Action Footer */}
      <View style={styles.actionFooter}>
        {onClose && (
          <TouchableOpacity
            style={styles.cancelBtn}
            onPress={onClose}
            disabled={isSubmitting}
            activeOpacity={0.7}
          >
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.submitBtn, (isSubmitting || isReadOnly) && styles.submitBtnDisabled]}
          onPress={handleOnboardCoordinator}
          disabled={isSubmitting || isReadOnly}
          activeOpacity={0.85}
        >
          {isSubmitting ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <ActivityIndicator size="small" color="#FFFFFF" />
              <Text style={styles.submitBtnText}>Provisioning...</Text>
            </View>
          ) : (
            <>
              <MaterialIcons
                name={mode === "create" ? "how-to-reg" : "upgrade"}
                size={18}
                color="#FFFFFF"
                style={{ marginRight: 8 }}
              />
              <Text style={styles.submitBtnText}>
                {mode === "create"
                  ? "Complete Coordinator Onboarding"
                  : "Promote & Assign Jurisdiction"}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* Success Confirmation Modal */}
      {successModalData && (
        <Modal visible={true} transparent={true} animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.successModalCard}>
              <View style={styles.successIconBox}>
                <MaterialIcons name="check-circle" size={48} color="#059669" />
              </View>
              <Text style={styles.successModalTitle}>
                Coordinator Successfully Onboarded!
              </Text>
              <Text style={styles.successModalSubtitle}>
                {successModalData.mode === "create"
                  ? "New account provisioned and assigned to jurisdiction."
                  : "Resident account upgraded to Environmental Coordinator."}
              </Text>

              <View style={styles.credentialsBox}>
                <View style={styles.credentialRow}>
                  <Text style={styles.credentialLabel}>Name:</Text>
                  <Text style={styles.credentialValue}>
                    {successModalData.fullName}
                  </Text>
                </View>
                <View style={styles.credentialRow}>
                  <Text style={styles.credentialLabel}>Coordinator ID:</Text>
                  <Text style={styles.credentialValue}>
                    {successModalData.employeeId}
                  </Text>
                </View>
                <View style={styles.credentialRow}>
                  <Text style={styles.credentialLabel}>Jurisdiction:</Text>
                  <Text
                    style={[
                      styles.credentialValue,
                      { color: "#047857", fontWeight: "800" },
                    ]}
                  >
                    Brgy. {successModalData.barangay}
                  </Text>
                </View>
                <View style={styles.credentialRow}>
                  <Text style={styles.credentialLabel}>Email:</Text>
                  <Text style={styles.credentialValue}>
                    {successModalData.email}
                  </Text>
                </View>
                {successModalData.mode === "create" && (
                  <View style={styles.credentialRow}>
                    <Text style={styles.credentialLabel}>Password:</Text>
                    <Text
                      style={[
                        styles.credentialValue,
                        { fontFamily: "monospace", color: "#1B4D3E" },
                      ]}
                    >
                      {successModalData.password}
                    </Text>
                  </View>
                )}
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#ECFDF5', padding: 12, borderRadius: 10, marginTop: 14, marginBottom: 14, gap: 10, borderWidth: 1, borderColor: '#A7F3D0' }}>
                <MaterialIcons name="mark-email-read" size={20} color="#059669" />
                <Text style={{ fontSize: 12.5, color: '#065F46', flex: 1, fontWeight: '600', lineHeight: 18 }}>
                  Official credentials email with portal access instructions has been dispatched to <Text style={{ fontWeight: '800' }}>{successModalData.email}</Text>.
                </Text>
              </View>

              <View style={styles.successBtnRow}>
                <TouchableOpacity
                  style={styles.copyBtn}
                  onPress={handleCopyCredentials}
                  activeOpacity={0.8}
                >
                  <MaterialIcons name="content-copy" size={16} color="#1B4D3E" />
                  <Text style={styles.copyBtnText}>Copy Credentials</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.copyBtn, { backgroundColor: '#F0FDF4', borderColor: '#A7F3D0' }]}
                  onPress={handleResendCredentialsEmail}
                  disabled={isResendingEmail}
                  activeOpacity={0.8}
                >
                  {isResendingEmail ? (
                    <ActivityIndicator size="small" color="#059669" />
                  ) : (
                    <>
                      <MaterialIcons name="send" size={16} color="#059669" />
                      <Text style={[styles.copyBtnText, { color: '#065F46' }]}>Resend Email</Text>
                    </>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.doneBtn}
                  onPress={() => {
                    setSuccessModalData(null);
                    if (onClose) onClose();
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={styles.doneBtnText}>Done & Return</Text>
                </TouchableOpacity>
              </View>
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
    alignItems: "flex-start",
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 16,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
    zIndex: 10,
  },
  headerBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 11,
    fontWeight: "800",
    color: "#059669",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: "900",
    color: "#0F172A",
  },
  closeBtn: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },

  scrollContainer: {
    flex: 1,
  },
  scrollContent: {
    padding: 24,
    paddingBottom: 32,
  },

  policyCard: {
    flexDirection: "row",
    backgroundColor: "#ECFDF5",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "#A7F3D0",
    marginBottom: 16,
    gap: 12,
    alignItems: "flex-start",
  },
  policyIconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "#D1FAE5",
    alignItems: "center",
    justifyContent: "center",
  },
  policyCardTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: "#065F46",
    marginBottom: 2,
  },
  policyCardText: {
    fontSize: 12,
    color: "#047857",
    lineHeight: 18,
  },

  feedbackBanner: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
  },
  feedbackBannerError: {
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FECACA",
  },
  feedbackBannerSuccess: {
    backgroundColor: "#ECFDF5",
    borderWidth: 1,
    borderColor: "#A7F3D0",
  },
  feedbackText: {
    fontSize: 13,
    fontWeight: "600",
    flex: 1,
  },
  feedbackTextError: {
    color: "#991B1B",
  },
  feedbackTextSuccess: {
    color: "#065F46",
  },

  modeContainer: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 16,
  },
  modeBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: "#E2E8F0",
  },
  modeBtnActive: {
    backgroundColor: "#1B4D3E",
    shadowColor: "#1B4D3E",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  modeBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#475569",
  },
  modeBtnTextActive: {
    color: "#FFFFFF",
  },

  sectionCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  sectionCardElevated: {
    zIndex: 1000,
    elevation: 10,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 14,
  },
  sectionIconBadge: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "#ECFDF5",
    alignItems: "center",
    justifyContent: "center",
  },
  sectionCardTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: "#0F172A",
  },
  sectionCardSubtitle: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 1,
  },

  formGrid: {
    flexDirection: "row",
    gap: 12,
  },
  labelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  label: {
    fontSize: 11,
    fontWeight: "800",
    color: "#475569",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  requiredAsterisk: {
    color: "#EF4444",
    fontWeight: "900",
  },
  fieldHelper: {
    fontSize: 10.5,
    color: "#64748B",
    marginTop: 4,
  },
  input: {
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: "#0F172A",
  },
  inputErrorBorder: {
    borderColor: "#DC2626",
    backgroundColor: "#FEF2F2",
  },
  fieldError: {
    fontSize: 11,
    color: "#DC2626",
    marginTop: 4,
    fontWeight: "600",
  },

  autoNextBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ECFDF5",
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
  },
  autoNextBtnText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#059669",
  },

  idInputContainer: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#F8FAFC",
  },
  idPrefix: {
    backgroundColor: "#E2E8F0",
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRightWidth: 1,
    borderRightColor: "#CBD5E1",
    justifyContent: "center",
  },
  idPrefixText: {
    fontSize: 11.5,
    fontWeight: "800",
    color: "#475569",
  },
  idSuffixInput: {
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 13,
    fontWeight: "700",
    color: "#0F172A",
  },

  dropdownBtn: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  dropdownBtnActive: {
    borderColor: "#059669",
    backgroundColor: "#FFFFFF",
  },
  dropdownBtnText: {
    fontSize: 13,
    color: "#0F172A",
    fontWeight: "600",
  },
  dropdownMenu: {
    position: "absolute",
    top: 48,
    left: 0,
    right: 0,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 16,
    elevation: 20,
    zIndex: 9999,
    overflow: "hidden",
  },
  dropdownSearchHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
    backgroundColor: "#F8FAFC",
    gap: 6,
  },
  dropdownSearchInput: {
    flex: 1,
    fontSize: 12,
    color: "#0F172A",
    paddingVertical: 2,
  },
  dropdownMenuItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
  },
  dropdownMenuItemDisabled: {
    backgroundColor: "#F8FAFC",
    opacity: 0.65,
  },
  dropdownMenuItemSelected: {
    backgroundColor: "#ECFDF5",
  },
  dropdownMenuItemText: {
    fontSize: 13,
    color: "#1E293B",
  },
  takenBadgeText: {
    fontSize: 10,
    color: "#DC2626",
    fontWeight: "600",
    marginTop: 1,
  },
  availableBadgeText: {
    fontSize: 10,
    color: "#059669",
    fontWeight: "600",
    marginTop: 1,
  },
  checkedCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#059669",
    alignItems: "center",
    justifyContent: "center",
  },

  autoGenBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ECFDF5",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 4,
  },
  autoGenBtnText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#059669",
  },

  passwordInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 8,
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: "#0F172A",
  },
  eyeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },

  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 8,
    paddingHorizontal: 10,
    marginBottom: 8,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 8,
    fontSize: 13,
    color: "#0F172A",
  },
  selectedUserBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ECFDF5",
    borderWidth: 1,
    borderColor: "#A7F3D0",
    borderRadius: 8,
    padding: 12,
    gap: 10,
  },
  selectedUserAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#1B4D3E",
    alignItems: "center",
    justifyContent: "center",
  },
  selectedUserAvatarText: {
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 13,
  },
  selectedUserName: {
    fontSize: 13,
    fontWeight: "700",
    color: "#0F172A",
  },
  selectedUserEmail: {
    fontSize: 11,
    color: "#64748B",
  },
  selectedUserBarangay: {
    fontSize: 11,
    color: "#047857",
    fontWeight: "600",
    marginTop: 2,
  },
  removeUserBtn: {
    padding: 6,
    borderRadius: 6,
    backgroundColor: "#FEE2E2",
  },
  residentItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
    gap: 10,
  },
  residentMiniAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#E2E8F0",
    alignItems: "center",
    justifyContent: "center",
  },
  residentMiniAvatarText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#475569",
  },
  residentItemName: {
    fontSize: 12,
    fontWeight: "700",
    color: "#0F172A",
  },
  residentItemEmail: {
    fontSize: 11,
    color: "#64748B",
  },
  selectBtnBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: "#ECFDF5",
    borderWidth: 1,
    borderColor: "#A7F3D0",
  },
  selectBtnBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#059669",
  },

  actionFooter: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 24,
    paddingVertical: 16,
    backgroundColor: "#FFFFFF",
    borderTopWidth: 1,
    borderTopColor: "#E2E8F0",
    zIndex: 10,
  },
  cancelBtn: {
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  cancelBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#64748B",
  },
  submitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1B4D3E",
    paddingHorizontal: 22,
    paddingVertical: 11,
    borderRadius: 8,
    shadowColor: "#1B4D3E",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  submitBtnDisabled: {
    opacity: 0.7,
  },
  submitBtnText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#FFFFFF",
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  successModalCard: {
    width: 480,
    maxWidth: "95%",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
  },
  successIconBox: {
    marginBottom: 12,
  },
  successModalTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: "#0F172A",
    textAlign: "center",
    marginBottom: 4,
  },
  successModalSubtitle: {
    fontSize: 12,
    color: "#64748B",
    textAlign: "center",
    marginBottom: 16,
  },
  credentialsBox: {
    width: "100%",
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 10,
    padding: 14,
    marginBottom: 18,
    gap: 8,
  },
  credentialRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  credentialLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#64748B",
  },
  credentialValue: {
    fontSize: 12,
    fontWeight: "700",
    color: "#0F172A",
  },
  successBtnRow: {
    flexDirection: "row",
    gap: 10,
    width: "100%",
  },
  copyBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#1B4D3E",
    backgroundColor: "#ECFDF5",
    gap: 6,
  },
  copyBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#1B4D3E",
  },
  doneBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: "#1B4D3E",
  },
  doneBtnText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  phPhoneContainer: {
    flexDirection: "row",
    alignItems: "center",
    height: 46,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 8,
    overflow: "hidden",
  },
  phPrefixBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F1F5F9",
    paddingHorizontal: 12,
    height: "100%",
    borderRightWidth: 1,
    borderRightColor: "#CBD5E1",
    gap: 6,
  },
  phPrefixText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#1E293B",
  },
  phPhoneInput: {
    flex: 1,
    height: "100%",
    paddingHorizontal: 12,
    fontSize: 14,
    fontWeight: "600",
    color: "#0F172A",
    backgroundColor: "#FFFFFF",
    ...Platform.select({
      web: { outlineStyle: "none" } as any,
    }),
  },
});

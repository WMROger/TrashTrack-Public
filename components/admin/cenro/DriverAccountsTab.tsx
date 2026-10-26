import { auth, db } from "@/config/firebase";
import { DANAO_CITY_BARANGAYS, resolveScheduleBarangays } from "@/constants/danaoBarangays";
import { isCictoEmail } from "@/constants/cictoConfig";
import { MaterialIcons } from "@expo/vector-icons";
import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc
} from "firebase/firestore";
import React, { createElement, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View
} from "react-native";
import CoordinatorOnboardingTab from "./CoordinatorOnboardingTab";
import DriverOnboardingTab from "./DriverOnboardingTab";
import ResidentOnboardingTab from "./ResidentOnboardingTab";
import DriverQrBadgeModal from "@/components/driver/DriverQrBadgeModal";
import { ensureDriverQrToken } from "@/services/driverQrService";
import {
  demoteDriverToResident,
  deleteAccountByCenro,
} from "@/services/driverProvisioningService";
import { demoteCoordinatorToResident } from "@/services/coordinatorProvisioningService";
import { handleDriverBarangayReassignment } from "@/services/autoDispatchService";
import ExportModal from "./ExportModal";
import { exportReport, ExportFormat } from "@/services/reportExportService";

interface UserAccount {
  id: string;
  displayName: string;
  email: string;
  role: string;
  employeeId?: string;
  licenseNumber?: string;
  assignedBarangay?: string;
  barangay?: string;
  phoneNumber?: string;
  contactInfo?: string;
  currentTruckId?: string;
  currentTruckPlate?: string;
  zone?: string;
  status?: string;
  createdAt: any;
  verificationStatus?: "pending" | "verified" | "rejected" | "unsubmitted";
  verified?: boolean;
  verifiedAt?: any;
  verifiedBy?: string;
  confirmedByCenro?: boolean;
  cenroConfirmedBy?: string;
  cenroConfirmedAt?: any;
  rejectionReason?: string;
  verificationImageUrl?: string;
  verificationIdType?: string;
  verificationIdNumber?: string;
}

type SortField = "name" | "role" | "credentials" | "assignment";
type SortDirection = "asc" | "desc";

export default function DriverAccountsTab({
  initialSubTab = "all",
  initialOpenOnboarding = false,
  userRole,
  assignedBarangay,
  isReadOnly = false,
}: {
  initialSubTab?: string;
  initialOpenOnboarding?: boolean;
  userRole?: string;
  assignedBarangay?: string;
  isReadOnly?: boolean;
}) {
  const { width } = useWindowDimensions();
  const isMobile = width < 768;
  const isCoordinator =
    userRole === "coordinator" ||
    userRole === "barangay_coordinator" ||
    userRole === "cenro_coordinator";

  const normalizedInitialTab =
    initialSubTab === "coordinators" || initialSubTab === "coordinator"
      ? "coordinator"
      : initialSubTab === "drivers" || initialSubTab === "driver"
        ? "driver"
        : initialSubTab === "users" || initialSubTab === "user"
          ? "user"
          : isCoordinator
            ? "driver"
            : "all";
  const [activeTab, setActiveTab] = useState<
    "all" | "user" | "driver" | "coordinator"
  >(normalizedInitialTab as any);
  const [isOnboardModalOpen, setIsOnboardModalOpen] = useState(
    initialOpenOnboarding,
  );
  const [elevatingUser, setElevatingUser] = useState<UserAccount | null>(null);
  const [isOnboardCoordinatorModalOpen, setIsOnboardCoordinatorModalOpen] =
    useState(false);
  const [isOnboardResidentModalOpen, setIsOnboardResidentModalOpen] =
    useState(false);
  const [elevatingCoordinatorUser, setElevatingCoordinatorUser] =
    useState<UserAccount | null>(null);
  const [isDemoting, setIsDemoting] = useState(false);

  // CENRO Barangay Filter State
  const [selectedBarangayFilter, setSelectedBarangayFilter] = useState<string>("all");
  const [isBarangayModalOpen, setIsBarangayModalOpen] = useState(false);
  const [barangaySearchQuery, setBarangaySearchQuery] = useState("");

  // Driver QR Badge Modal State
  const [driverQrModalVisible, setDriverQrModalVisible] = useState(false);
  const [selectedDriverForQr, setSelectedDriverForQr] = useState<any>(null);
  const [fetchingDriverQr, setFetchingDriverQr] = useState(false);

  // Resident ID Validation Review State (CENRO Only - Hidden from Coordinators)
  const [viewingIdUser, setViewingIdUser] = useState<UserAccount | null>(null);
  const [isVerifyingUser, setIsVerifyingUser] = useState(false);

  const handleCenroConfirmVerification = async (userToConfirm: UserAccount) => {
    if (isReadOnly) {
      Alert.alert("Read-Only Mode", "Your account has read-only privileges. Resident verification confirmation is restricted.");
      return;
    }
    if (!db || !userToConfirm) return;
    setIsVerifyingUser(true);
    try {
      const userRef = doc(db, "users", userToConfirm.id);
      const cenroEmail = auth?.currentUser?.email || "cenro@trashtrack.gov.ph";
      await updateDoc(userRef, {
        confirmedByCenro: true,
        cenroConfirmedBy: cenroEmail,
        cenroConfirmedAt: serverTimestamp(),
        verified: true,
        verificationStatus: "verified",
        verifiedBy: `CENRO (${cenroEmail})`,
        verifiedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // Optimistically update local users state
      setUsers((prev) =>
        prev.map((u) =>
          u.id === userToConfirm.id
            ? {
                ...u,
                confirmedByCenro: true,
                cenroConfirmedBy: cenroEmail,
                verified: true,
                verificationStatus: "verified",
                verifiedBy: `CENRO (${cenroEmail})`,
              }
            : u
        )
      );

      if (Platform.OS === "web") {
        window.alert(
          `Resident ID for ${userToConfirm.displayName || userToConfirm.email} has been confirmed by CENRO and officially verified. This status now immediately reflects on CICTO Oversight.`
        );
      } else {
        Alert.alert(
          "Confirmed by CENRO",
          `${userToConfirm.displayName || userToConfirm.email} is officially verified. This status now immediately reflects on CICTO Oversight.`
        );
      }
      setViewingIdUser(null);
    } catch (err) {
      console.error("Error confirming resident verification by CENRO:", err);
      Alert.alert("Error", "Failed to confirm resident verification.");
    } finally {
      setIsVerifyingUser(false);
    }
  };

  const handleCenroRejectVerification = async (
    userToReject: UserAccount,
    reason: string = "Document does not verify Danao City address"
  ) => {
    if (isReadOnly) {
      Alert.alert("Read-Only Mode", "Your account has read-only privileges. Resident verification rejection is restricted.");
      return;
    }
    if (!db || !userToReject) return;

    const executeReject = async (rejectionReasonText: string) => {
      setIsVerifyingUser(true);
      try {
        const userRef = doc(db, "users", userToReject.id);
        await updateDoc(userRef, {
          verificationStatus: "rejected",
          rejectionReason: rejectionReasonText,
          updatedAt: serverTimestamp(),
        });

        // Optimistically update local users state
        setUsers((prev) =>
          prev.map((u) =>
            u.id === userToReject.id
              ? {
                  ...u,
                  verificationStatus: "rejected",
                  rejectionReason: rejectionReasonText,
                }
              : u
          )
        );

        if (Platform.OS === "web") {
          window.alert(
            `Verification document for ${userToReject.displayName || userToReject.email} has been marked as rejected.`
          );
        } else {
          Alert.alert(
            "Verification Rejected",
            `Verification document for ${userToReject.displayName || userToReject.email} has been marked as rejected.`
          );
        }
        setViewingIdUser(null);
      } catch (err) {
        console.error("Error rejecting verification by CENRO:", err);
        Alert.alert("Error", "Failed to update verification status.");
      } finally {
        setIsVerifyingUser(false);
      }
    };

    if (Platform.OS === "web") {
      const inputReason = window.prompt(
        "Enter reason for rejecting resident ID document:",
        reason
      );
      if (inputReason === null) return;
      executeReject(inputReason.trim() || reason);
    } else {
      Alert.alert(
        "Reject Document",
        `Are you sure you want to reject the submitted ID document for ${userToReject.displayName || userToReject.email}?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Reject Document",
            style: "destructive",
            onPress: () => executeReject(reason),
          },
        ]
      );
    }
  };

  const handleOpenDriverQrBadge = async (userAccount: UserAccount) => {
    setFetchingDriverQr(true);
    try {
      const userRef = doc(db, 'users', userAccount.id);
      const snap = await getDoc(userRef);
      const data = snap.exists() ? snap.data() : (userAccount as any);
      const qrLoginToken = data.qrLoginToken || await ensureDriverQrToken(userAccount.id, data.employeeId || userAccount.employeeId);
      
      let authKey: string | undefined = undefined;
      try {
        const credSnap = await getDoc(doc(db, 'driver_qr_credentials', userAccount.id));
        if (credSnap.exists()) {
          authKey = credSnap.data()?.authKey;
        }
      } catch (credErr) {
        console.warn('Error fetching driver_qr_credentials:', credErr);
      }

      setSelectedDriverForQr({
        uid: userAccount.id,
        name: data.displayName || data.name || userAccount.displayName || 'Official Driver',
        email: data.email || userAccount.email || '',
        employeeId: data.employeeId || userAccount.employeeId || 'CENRO-DRV',
        qrLoginToken,
        authKey,
        assignedBarangay: data.assignedBarangay || data.barangay || userAccount.assignedBarangay || 'Danao City',
        plateNumber: data.currentTruckPlate || userAccount.currentTruckPlate || 'Pending Assignment',
        licenseNumber: data.licenseNumber || userAccount.licenseNumber || 'N/A',
      });
      setDriverQrModalVisible(true);
    } catch (err) {
      console.error('Error fetching driver for QR badge:', err);
      Alert.alert('Error', 'Failed to retrieve driver profile for QR badge.');
    } finally {
      setFetchingDriverQr(false);
    }
  };

  const handleAddDriver = () => {
    if (isReadOnly) {
      Alert.alert("Read-Only Mode", "Your account has read-only privileges. Adding drivers is restricted.");
      return;
    }
    setElevatingUser(null);
    setIsOnboardModalOpen(true);
  };

  const handleElevateUser = (user: UserAccount) => {
    if (isReadOnly) {
      Alert.alert("Read-Only Mode", "Your account has read-only privileges. Account elevations are restricted.");
      return;
    }
    setSelectedUser(null);
    setElevatingUser(user);
    setIsOnboardModalOpen(true);
  };

  const handleElevateToCoordinator = (user: UserAccount) => {
    if (isReadOnly) {
      Alert.alert("Read-Only Mode", "Your account has read-only privileges. Account elevations are restricted.");
      return;
    }
    setSelectedUser(null);
    setElevatingCoordinatorUser(user);
    setIsOnboardCoordinatorModalOpen(true);
  };

  const handleDemoteUser = (user: UserAccount) => {
    if (isReadOnly) {
      Alert.alert("Read-Only Mode", "Your account has read-only privileges. Account offboarding is restricted.");
      return;
    }
    const isDriver = user.role === "driver";
    const isCoord = user.role === "coordinator";
    const roleLabel = isDriver ? "Driver" : isCoord ? "Coordinator" : "Personnel";

    const confirmMsg = isDriver
      ? `Are you sure you want to offboard ${user.displayName || user.email} from Driver duties and revert their account back to standard Resident?\n\n• Unassigns collection vehicle (${user.currentTruckPlate || "currently assigned"})\n• Revokes driver credentials & Employee ID bindings\n• Deactivates Driver mobile app access & QR badges\n• Reverts role to standard citizen resident`
      : `Are you sure you want to relieve ${user.displayName || user.email} of Coordinator duties and revert their account back to standard Resident?`;

    const executeDemote = async () => {
      setIsDemoting(true);
      try {
        if (isDriver) {
          await demoteDriverToResident(user.id);
        } else if (isCoord) {
          await demoteCoordinatorToResident(user.id);
        } else {
          await updateDoc(doc(db, "users", user.id), {
            role: "user",
            updatedAt: serverTimestamp(),
          });
        }

        // Optimistically update local users state
        setUsers((prev) =>
          prev.map((u) =>
            u.id === user.id
              ? {
                  ...u,
                  role: "user",
                  currentTruckId: undefined,
                  currentTruckPlate: undefined,
                  assignedTruckId: undefined,
                  assignedTruckPlate: undefined,
                  employeeId: undefined,
                  licenseNumber: undefined,
                }
              : u
          )
        );

        // Close details inspector
        setSelectedUser(null);

        if (Platform.OS === "web") {
          window.alert(
            `Successfully offboarded ${user.displayName || user.email} back to standard Resident.`
          );
        } else {
          Alert.alert(
            "Account Offboarded",
            `Successfully reverted ${user.displayName || user.email} back to standard Resident.`
          );
        }
      } catch (err: any) {
        console.error("Failed to offboard user:", err);
        if (Platform.OS === "web") {
          window.alert(
            `Error offboarding account: ${err?.message || "Action failed."}`
          );
        } else {
          Alert.alert(
            "Offboard Failed",
            err?.message || "Could not offboard user to resident."
          );
        }
      } finally {
        setIsDemoting(false);
      }
    };

    if (Platform.OS === "web") {
      if (window.confirm(confirmMsg)) {
        executeDemote();
      }
    } else {
      Alert.alert(`Offboard ${roleLabel} to Resident`, confirmMsg, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Offboard to Resident",
          style: "destructive",
          onPress: executeDemote,
        },
      ]);
    }
  };


  // State & Handlers for CENRO Account Deletion
  const [deleteTargetUser, setDeleteTargetUser] = useState<UserAccount | null>(null);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [deleteGeneratedPin, setDeleteGeneratedPin] = useState<string>("");
  const [deletePinInput, setDeletePinInput] = useState<string>("");

  const handleOpenDelete = (user: UserAccount) => {
    if (isReadOnly) {
      Alert.alert("Read-Only Mode", "Your account has read-only privileges. Account deletion is restricted.");
      return;
    }
    if (user.role === "cicto" || isCictoEmail(user.email)) {
      Alert.alert(
        "Protected Account",
        "CICTO Super Administrator accounts cannot be deleted."
      );
      return;
    }
    if (user.role === "admin" || user.role === "cenro") {
      Alert.alert(
        "Administrative Account",
        "CENRO Administrator accounts can only be managed and deleted by CICTO."
      );
      return;
    }
    if (auth?.currentUser && user.id === auth.currentUser.uid) {
      Alert.alert(
        "Action Not Allowed",
        "You cannot delete your own logged-in administrator account."
      );
      return;
    }

    const generated = String(Math.floor(100000 + Math.random() * 900000));
    setDeleteGeneratedPin(generated);
    setDeletePinInput("");
    setDeleteTargetUser(user);
  };

  const handleConfirmDelete = async () => {
    if (isReadOnly) return;
    if (!deleteTargetUser) return;
    if (deletePinInput.trim() !== deleteGeneratedPin.trim()) {
      const msg = "Please type the PIN written below to confirm deletion.";
      if (Platform.OS === "web") {
        window.alert(msg);
      } else {
        Alert.alert("Invalid Confirmation PIN", msg);
      }
      return;
    }
    setIsDeletingAccount(true);
    try {
      await deleteAccountByCenro({
        id: deleteTargetUser.id,
        email: deleteTargetUser.email,
        displayName: deleteTargetUser.displayName,
        role: deleteTargetUser.role,
        currentTruckId: deleteTargetUser.currentTruckId,
        employeeId: deleteTargetUser.employeeId,
        licenseNumber: deleteTargetUser.licenseNumber,
        assignedBarangay: deleteTargetUser.assignedBarangay || deleteTargetUser.barangay,
        barangay: deleteTargetUser.barangay || deleteTargetUser.assignedBarangay,
      });

      // Optimistically update directory list
      setUsers((prev) => prev.filter((u) => u.id !== deleteTargetUser.id));

      // Close details modal if open for this user
      if (selectedUser?.id === deleteTargetUser.id) {
        setSelectedUser(null);
      }

      const deletedName =
        deleteTargetUser.displayName || deleteTargetUser.email || "User";
      setDeleteTargetUser(null);
      setDeletePinInput("");
      setDeleteGeneratedPin("");

      if (Platform.OS === "web") {
        window.alert(`Account "${deletedName}" has been permanently deleted.`);
      } else {
        Alert.alert(
          "Account Deleted",
          `Account "${deletedName}" has been permanently deleted.`
        );
      }
    } catch (err: any) {
      console.error("Failed to delete account:", err);
      if (Platform.OS === "web") {
        window.alert(
          `Could not delete account: ${err?.message || "Operation failed."}`
        );
      } else {
        Alert.alert(
          "Delete Failed",
          err?.message || "Could not delete user account."
        );
      }
    } finally {
      setIsDeletingAccount(false);
    }
  };
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [trucks, setTrucks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  // Sorting State (Default: Employee / License in ascending order)
  const [sortField, setSortField] = useState<SortField>("credentials");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  // Details Inspector & Editing Modal State
  const [selectedUser, setSelectedUser] = useState<UserAccount | null>(null);
  const [availableBarangays, setAvailableBarangays] = useState<string[]>([...DANAO_CITY_BARANGAYS]);
  const [isEditingBarangay, setIsEditingBarangay] = useState(false);
  const [editBarangayValue, setEditBarangayValue] = useState("");
  const [isSavingBarangay, setIsSavingBarangay] = useState(false);
  const [editBarangayDropdownOpen, setEditBarangayDropdownOpen] = useState(false);
  const [editBarangaySearch, setEditBarangaySearch] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [editSuccess, setEditSuccess] = useState<string | null>(null);
  const [isExportModalVisible, setIsExportModalVisible] = useState(false);

  const handleExport = async (format: ExportFormat) => {
    const reportTitle =
      activeTab === "driver"
        ? "Official Drivers Registry Report"
        : activeTab === "coordinator"
        ? "Official Environmental Coordinators Directory"
        : activeTab === "user"
        ? "Registered Residents Directory"
        : "Personnel and Resident Directory";

    const headers = [
      "Full Name",
      "Role",
      "Credentials / ID",
      "Assigned Barangay",
      "Email Address",
      "Contact Number",
      "Truck Assigned",
      "Verification Status",
      "Registration Date",
    ];

    const rows = sortedUsers.map((u) => {
      const cred =
        u.role === "driver"
          ? u.licenseNumber || "N/A"
          : u.role === "coordinator"
          ? u.employeeId || "N/A"
          : u.id;
      const roleStr =
        u.role === "driver"
          ? "Driver"
          : u.role === "coordinator"
          ? "Barangay Coordinator"
          : "Resident";
      const regDate = u.createdAt?.toDate
        ? u.createdAt.toDate().toLocaleDateString("en-US")
        : u.createdAt
        ? new Date(u.createdAt).toLocaleDateString("en-US")
        : "N/A";
      const verStr =
        u.verificationStatus === "verified" || u.verified
          ? "Verified"
          : u.verificationStatus === "pending"
          ? "Pending Review"
          : u.verificationStatus === "rejected"
          ? "Rejected"
          : "Unverified";

      return [
        u.displayName || "Unknown",
        roleStr,
        cred,
        u.assignedBarangay || u.barangay || "Danao City",
        u.email,
        u.phoneNumber || u.contactInfo || "N/A",
        u.currentTruckPlate || u.currentTruckId || "None",
        verStr,
        regDate,
      ];
    });

    const summaryCards = [
      { label: "Total Listed", value: sortedUsers.length },
      { label: "Drivers", value: sortedUsers.filter((u) => u.role === "driver").length },
      { label: "Coordinators", value: sortedUsers.filter((u) => u.role === "coordinator").length },
      {
        label: "Verified Accounts",
        value: sortedUsers.filter((u) => u.verified || u.verificationStatus === "verified").length,
      },
    ];

    const filename = `danao_cenro_${activeTab}_directory_${new Date().toISOString().slice(0, 10)}`;

    await exportReport({
      format,
      filename,
      title: reportTitle,
      subtitle: "City Environment & Natural Resources Office Personnel Registry",
      jurisdiction:
        isCoordinator && assignedBarangay
          ? `Brgy. ${assignedBarangay}`
          : selectedBarangayFilter !== "all"
          ? selectedBarangayFilter === "unassigned"
            ? "Unassigned Accounts"
            : `Brgy. ${selectedBarangayFilter}`
          : "City of Danao (All Barangays)",
      generatedBy: isCoordinator ? "Barangay Coordinator" : "CENRO Administrator",
      headers,
      rows,
      summaryCards,
      sheetName: activeTab === "all" ? "Personnel" : activeTab.toUpperCase(),
    });
  };

  // Compute map of taken barangays -> active coordinator info
  const takenCoordinatorBarangaysMap = useMemo(() => {
    const map: { [barangay: string]: { id: string; name: string } } = {};
    users.forEach((u) => {
      if (u.role === "coordinator") {
        const b = (u.assignedBarangay || u.barangay || "").trim();
        if (b) {
          map[b] = { id: u.id, name: u.displayName || u.email };
        }
      }
    });
    return map;
  }, [users]);

  // Listen to collection schedules for dynamically configured barangays
  useEffect(() => {
    if (!db) return;
    const unsubSchedules = onSnapshot(collection(db, "barangay_schedules"), (snap) => {
      const scheduleNames = new Set<string>();
      snap.forEach((d) => {
        const data = d.data();
        if (data.barangayName && typeof data.barangayName === "string" && data.barangayName.trim()) {
          scheduleNames.add(data.barangayName.trim());
        }
      });
      setAvailableBarangays(resolveScheduleBarangays(Array.from(scheduleNames)));
    });
    return () => unsubSchedules();
  }, []);

  // Reset editing state whenever selected user changes
  useEffect(() => {
    if (selectedUser) {
      setIsEditingBarangay(false);
      setEditBarangayValue(selectedUser.assignedBarangay || selectedUser.barangay || "");
      setEditError(null);
      setEditSuccess(null);
      setEditBarangayDropdownOpen(false);
      setEditBarangaySearch("");
    }
  }, [selectedUser]);

  const handleSaveBarangay = async () => {
    if (isReadOnly) return;
    if (!selectedUser || !db) return;
    setEditError(null);
    setEditSuccess(null);

    // If coordinator, check 1-coordinator-per-barangay policy
    if (selectedUser.role === "coordinator" && editBarangayValue) {
      const existing = takenCoordinatorBarangaysMap[editBarangayValue];
      if (existing && existing.id !== selectedUser.id) {
        setEditError(
          `Brgy. ${editBarangayValue} already has an active coordinator (${existing.name}). 1 Coordinator per Barangay policy enforced.`
        );
        return;
      }
    }

    setIsSavingBarangay(true);
    try {
      const newBarangay = editBarangayValue.trim();
      const userRef = doc(db, "users", selectedUser.id);
      await updateDoc(userRef, {
        assignedBarangay: newBarangay,
        barangay: newBarangay,
        updatedAt: serverTimestamp(),
      });

      if (selectedUser.role === "driver") {
        try {
          await handleDriverBarangayReassignment(selectedUser.id, newBarangay);
        } catch (reassignErr) {
          console.warn("handleDriverBarangayReassignment error:", reassignErr);
        }
      }

      setSelectedUser((prev) =>
        prev
          ? {
              ...prev,
              assignedBarangay: newBarangay,
              barangay: newBarangay,
            }
          : null
      );
      setEditSuccess("Barangay assignment updated successfully!");
      setIsEditingBarangay(false);
      setEditBarangayDropdownOpen(false);
    } catch (err: any) {
      console.error("Error updating barangay assignment:", err);
      setEditError(err?.message || "Failed to update barangay assignment.");
    } finally {
      setIsSavingBarangay(false);
    }
  };

  const handleHeaderSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  useEffect(() => {
    if (!db) return;
    const q = query(collection(db, "users"), limit(500));
    const unsubUsers = onSnapshot(
      q,
      (snap) => {
        const userList: UserAccount[] = [];
        snap.forEach((d) => {
          const data = d.data();
          const role = String(data.role || "user").toLowerCase();
          // CENRO cannot see CICTO or Admin accounts in the operational directory
          if (
            role === "cicto" ||
            role === "admin" ||
            String(data.email || "")
              .toLowerCase()
              .includes("cicto@")
          ) {
            return;
          }
          userList.push({
            id: d.id,
            displayName: data.displayName || data.name || "Unknown Name",
            email: data.email || "No email",
            role: data.role || "user",
            employeeId: data.employeeId || "",
            licenseNumber: data.licenseNumber || "",
            assignedBarangay: data.assignedBarangay || data.barangay || "",
            barangay: data.barangay || "",
            phoneNumber: data.phoneNumber || data.contactInfo || "",
            contactInfo: data.contactInfo || "",
            currentTruckId: data.currentTruckId || null,
            currentTruckPlate: data.currentTruckPlate || null,
            zone: data.zone || "",
            status: data.status || "active",
            createdAt: data.createdAt,
            verificationStatus:
              data.verificationStatus ||
              (data.verified ? "verified" : data.verificationImageUrl ? "pending" : undefined),
            verified: !!data.verified,
            verifiedAt: data.verifiedAt,
            verifiedBy: data.verifiedBy || "",
            confirmedByCenro: !!data.confirmedByCenro,
            cenroConfirmedBy: data.cenroConfirmedBy || "",
            cenroConfirmedAt: data.cenroConfirmedAt,
            rejectionReason: data.rejectionReason || "",
            verificationImageUrl: data.verificationImageUrl || "",
            verificationIdType: data.verificationIdType || "",
            verificationIdNumber: data.verificationIdNumber || "",
          });
        });
        userList.sort((a, b) => {
          const aTime = a.createdAt?.toMillis?.() || (a.createdAt?.seconds ? a.createdAt.seconds * 1000 : 0);
          const bTime = b.createdAt?.toMillis?.() || (b.createdAt?.seconds ? b.createdAt.seconds * 1000 : 0);
          return bTime - aTime;
        });
        setUsers(userList);
        setLoading(false);
      },
      (err) => {
        console.warn("DriverAccountsTab: Error loading accounts directory:", err);
        setLoading(false);
      }
    );

    const unsubTrucks = onSnapshot(collection(db, "trucks"), (snap) => {
      const truckList: any[] = [];
      snap.forEach((d) => {
        truckList.push({ id: d.id, ...d.data() });
      });
      setTrucks(truckList);
    });

    return () => {
      unsubUsers();
      unsubTrucks();
    };
  }, []);

  const handleOpenDetails = (user: UserAccount) => {
    setSelectedUser(user);
  };

  const getRoleLabel = (role: string) => {
    if (role === "admin") return "Admin";
    if (role === "cicto") return "CICTO";
    if (role === "coordinator") return "Coordinator";
    if (role === "driver") return "Driver";
    return "Resident";
  };

  const getRoleBadge = (role: string) => {
    if (role === "admin")
      return (
        <View
          style={[
            styles.roleBadge,
            { backgroundColor: "#FEE2E2", borderColor: "#FCA5A5" },
          ]}
        >
          <Text style={[styles.roleText, { color: "#B91C1C" }]}>Admin</Text>
        </View>
      );
    if (role === "cicto")
      return (
        <View
          style={[
            styles.roleBadge,
            { backgroundColor: "#F5F3FF", borderColor: "#DDD6FE" },
          ]}
        >
          <Text style={[styles.roleText, { color: "#6D28D9" }]}>CICTO</Text>
        </View>
      );
    if (role === "driver")
      return (
        <View
          style={[
            styles.roleBadge,
            { backgroundColor: "#E0F2FE", borderColor: "#BAE6FD" },
          ]}
        >
          <Text style={[styles.roleText, { color: "#0369A1" }]}>Driver</Text>
        </View>
      );
    if (role === "coordinator")
      return (
        <View
          style={[
            styles.roleBadge,
            { backgroundColor: "#FEF3C7", borderColor: "#FDE68A" },
          ]}
        >
          <Text style={[styles.roleText, { color: "#92400E" }]}>
            Coordinator
          </Text>
        </View>
      );
    return (
      <View
        style={[
          styles.roleBadge,
          { backgroundColor: "#F3F4F6", borderColor: "#E5E7EB" },
        ]}
      >
        <Text style={[styles.roleText, { color: "#4B5563" }]}>Resident</Text>
      </View>
    );
  };

  const getCredentialsSortKey = (u: UserAccount) => {
    if (u.role === "driver") {
      return (u.employeeId || u.licenseNumber || "Not set").toUpperCase();
    }
    if (u.role === "coordinator") {
      return (
        u.employeeId || (u.zone ? `Zone ${u.zone}` : "Not set")
      ).toUpperCase();
    }
    return "Resident Account";
  };

  const barangayAccountCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    let unassigned = 0;
    users.forEach((u) => {
      if (u.role === "cicto" || u.role === "admin") return;
      const b = (u.assignedBarangay || u.barangay || "").trim();
      if (!b) {
        unassigned++;
      } else {
        counts[b.toLowerCase()] = (counts[b.toLowerCase()] || 0) + 1;
      }
    });
    return { counts, unassigned };
  }, [users]);

  const normalizeBrgy = (name?: string | null) => {
    if (!name) return "";
    return name
      .toLowerCase()
      .replace(/^brgy\.?\s*/i, "")
      .replace(/^barangay\s*/i, "")
      .trim();
  };

  const barangayScopedUsers = useMemo(() => {
    return users.filter((u) => {
      if (u.role === "cicto" || u.role === "admin") return false;
      if (isCoordinator) {
        if (!assignedBarangay) return true;
        const targetBrgy = normalizeBrgy(assignedBarangay);
        const userAssigned = normalizeBrgy(u.assignedBarangay);
        const userBrgy = normalizeBrgy(u.barangay);
        return userAssigned === targetBrgy || userBrgy === targetBrgy;
      }
      if (selectedBarangayFilter === "all") return true;
      if (selectedBarangayFilter === "unassigned") {
        return !u.assignedBarangay && !u.barangay;
      }
      const targetFilter = normalizeBrgy(selectedBarangayFilter);
      return (
        normalizeBrgy(u.assignedBarangay) === targetFilter ||
        normalizeBrgy(u.barangay) === targetFilter
      );
    });
  }, [users, isCoordinator, assignedBarangay, selectedBarangayFilter]);

  const userCount = useMemo(
    () =>
      barangayScopedUsers.filter((u) => u.role === "user" || !u.role || u.role === "resident")
        .length,
    [barangayScopedUsers],
  );
  const driverCount = useMemo(
    () => barangayScopedUsers.filter((u) => u.role === "driver").length,
    [barangayScopedUsers],
  );
  const coordinatorCount = useMemo(
    () => barangayScopedUsers.filter((u) => u.role === "coordinator").length,
    [barangayScopedUsers],
  );
  const allCount = barangayScopedUsers.length;

  const filteredUsers = useMemo(() => {
    return barangayScopedUsers.filter((u) => {
      const matchesSearch =
        u.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (u.assignedBarangay || "")
          .toLowerCase()
          .includes(searchQuery.toLowerCase()) ||
        (u.barangay || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (u.employeeId || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (u.licenseNumber || "").toLowerCase().includes(searchQuery.toLowerCase());

      const matchesRole =
        activeTab === "all" ||
        u.role === activeTab ||
        (activeTab === "user" &&
          (u.role === "user" || !u.role || u.role === "resident"));

      return matchesSearch && matchesRole;
    });
  }, [barangayScopedUsers, searchQuery, activeTab]);

  const sortedUsers = useMemo(() => {
    return [...filteredUsers].sort((a, b) => {
      let comparison = 0;

      if (sortField === "role") {
        const roleA = getRoleLabel(a.role).toLowerCase();
        const roleB = getRoleLabel(b.role).toLowerCase();
        comparison = roleA.localeCompare(roleB, undefined, {
          numeric: true,
          sensitivity: "base",
        });
      } else if (sortField === "credentials") {
        const credA = getCredentialsSortKey(a).toLowerCase();
        const credB = getCredentialsSortKey(b).toLowerCase();
        comparison = credA.localeCompare(credB, undefined, {
          numeric: true,
          sensitivity: "base",
        });
      } else if (sortField === "assignment") {
        const assignA = (
          a.assignedBarangay ||
          a.barangay ||
          "No Barangay"
        ).toLowerCase();
        const assignB = (
          b.assignedBarangay ||
          b.barangay ||
          "No Barangay"
        ).toLowerCase();
        comparison = assignA.localeCompare(assignB, undefined, {
          numeric: true,
          sensitivity: "base",
        });
      } else {
        // Default: sort by name
        const nameA = (a.displayName || a.email || "").toLowerCase();
        const nameB = (b.displayName || b.email || "").toLowerCase();
        comparison = nameA.localeCompare(nameB, undefined, {
          numeric: true,
          sensitivity: "base",
        });
      }

      // Tie breaker: sort by display name
      if (comparison === 0) {
        comparison = (a.displayName || "").localeCompare(b.displayName || "");
      }

      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [filteredUsers, sortField, sortDirection]);

  return (
    <ScrollView style={[styles.container, isMobile && { padding: 14 }]}>
      {/* Header with Title and + Onboard New Driver Action Button */}
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: isMobile ? "flex-start" : "center",
          marginBottom: 16,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <View>
          <Text style={styles.headerSubtitle}>
            {isCoordinator
              ? `BARANGAY FIELD STEWARD • ${assignedBarangay ? `BRGY. ${assignedBarangay.toUpperCase()}` : "ASSIGNED JURISDICTION"}`
              : "ADMINISTRATIVE MANAGEMENT"}
          </Text>
          <Text style={styles.headerTitle}>
            {isCoordinator ? "Driver Accounts & Management" : "Accounts Directory"}
          </Text>
        </View>

        {isReadOnly ? (
          <View style={styles.readOnlyHeaderBadge}>
            <MaterialIcons name="visibility" size={16} color="#92400E" />
            <Text style={styles.readOnlyHeaderBadgeText}>Read-Only Access</Text>
          </View>
        ) : (
          <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
            <TouchableOpacity
              style={styles.onboardBtn}
              onPress={handleAddDriver}
              activeOpacity={0.85}
            >
              <MaterialIcons
                name="person-add"
                size={18}
                color="#FFFFFF"
                style={{ marginRight: 6 }}
              />
              <Text style={styles.onboardBtnText}>Add Driver</Text>
            </TouchableOpacity>

            {!isCoordinator && (
              <TouchableOpacity
                style={styles.onboardCoordBtn}
                onPress={() => setIsOnboardCoordinatorModalOpen(true)}
                activeOpacity={0.85}
              >
                <MaterialIcons
                  name="supervised-user-circle"
                  size={18}
                  color="#FFFFFF"
                  style={{ marginRight: 6 }}
                />
                <Text style={styles.onboardBtnText}>Add Coordinator</Text>
              </TouchableOpacity>
            )}

            {!isCoordinator && (
              <TouchableOpacity
                style={styles.onboardResidentBtn}
                onPress={() => setIsOnboardResidentModalOpen(true)}
                activeOpacity={0.85}
              >
                <MaterialIcons
                  name="person-add-alt-1"
                  size={18}
                  color="#FFFFFF"
                  style={{ marginRight: 6 }}
                />
                <Text style={styles.onboardBtnText}>Add Resident</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>

      {/* Coordinator Jurisdiction Badge & Filter Banner */}
      {isCoordinator && !!assignedBarangay && (
        <View style={styles.coordinatorJurisdictionBanner}>
          <MaterialIcons name="verified-user" size={20} color="#15803D" />
          <View style={{ flex: 1 }}>
            <Text style={styles.coordinatorJurisdictionTitle}>
              COORDINATOR JURISDICTION: BRGY. {assignedBarangay.toUpperCase()}
            </Text>
            <Text style={styles.coordinatorJurisdictionSubtitle}>
              You are authorized to elevate registered residents to Drivers or create new drivers assigned to your barangay.
            </Text>
          </View>
        </View>
      )}

      {/* Controls Bar: Tabs on Left, Search Bar on Right */}
      <View
        style={[
          styles.controlsRow,
          isMobile && {
            flexDirection: "column-reverse",
            gap: 12,
            alignItems: "stretch",
          },
        ]}
      >
        {/* Left: Role Tabs (All, Users, Drivers, Coordinators) */}
        <View
          style={[
            styles.subTabContainer,
            { marginBottom: 0, flexWrap: "wrap" },
          ]}
        >
          {[
            ...(isCoordinator
              ? [
                  {
                    id: "driver" as const,
                    label: `Drivers (${driverCount})`,
                    icon: "local-shipping",
                  },
                  {
                    id: "user" as const,
                    label: `Residents (${userCount})`,
                    icon: "person",
                  },
                  {
                    id: "all" as const,
                    label: `All (${allCount})`,
                    icon: "people",
                  },
                ]
              : [
                  { id: "all" as const, label: `All (${allCount})`, icon: "people" },
                  {
                    id: "user" as const,
                    label: `Users (${userCount})`,
                    icon: "person",
                  },
                  {
                    id: "driver" as const,
                    label: `Drivers (${driverCount})`,
                    icon: "local-shipping",
                  },
                  {
                    id: "coordinator" as const,
                    label: `Coordinators (${coordinatorCount})`,
                    icon: "supervised-user-circle",
                  },
                ]),
          ].map((tab) => (
            <TouchableOpacity
              key={tab.id}
              style={[
                styles.subTabBtn,
                activeTab === tab.id && styles.subTabBtnActive,
              ]}
              onPress={() => setActiveTab(tab.id)}
              activeOpacity={0.8}
            >
              <MaterialIcons
                name={tab.icon as any}
                size={17}
                color={activeTab === tab.id ? "#1B4D3E" : "#64748B"}
                style={{ marginRight: 6 }}
              />
              <Text
                style={[
                  styles.subTabBtnText,
                  activeTab === tab.id && styles.subTabBtnTextActive,
                ]}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Right: Barangay Filter, Search Box & Export Button */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            maxWidth: isMobile ? "100%" : 720,
            width: isMobile ? "100%" : "auto",
            flexWrap: isMobile ? "wrap" : "nowrap",
          }}
        >
          {/* CENRO Barangay Filter Dropdown */}
          {!isCoordinator && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, minWidth: isMobile ? "100%" : 190 }}>
              {Platform.OS === 'web' ? (
                <View style={[styles.barangaySelectWrapper, selectedBarangayFilter !== 'all' && styles.barangaySelectWrapperActive]}>
                  <MaterialIcons
                    name="location-on"
                    size={16}
                    color={selectedBarangayFilter !== 'all' ? "#059669" : "#64748B"}
                    style={{ marginLeft: 8, marginRight: -2 }}
                  />
                  {createElement('select', {
                    value: selectedBarangayFilter,
                    onChange: (e: any) => setSelectedBarangayFilter(e.target.value),
                    style: {
                      padding: '8px 26px 8px 6px',
                      borderRadius: '10px',
                      border: 'none',
                      fontSize: '13px',
                      backgroundColor: 'transparent',
                      color: selectedBarangayFilter !== 'all' ? '#065F46' : '#1E293B',
                      fontWeight: selectedBarangayFilter !== 'all' ? '800' : '600',
                      outline: 'none',
                      fontFamily: 'inherit',
                      cursor: 'pointer',
                      height: '38px',
                      width: '100%',
                      appearance: 'none',
                      WebkitAppearance: 'none',
                    },
                  }, [
                    createElement('option', { key: 'all', value: 'all' }, '🏘️ All Barangays'),
                    ...(barangayAccountCounts.unassigned > 0
                      ? [createElement('option', { key: 'unassigned', value: 'unassigned' }, `⚠️ No Barangay (${barangayAccountCounts.unassigned})`)]
                      : []),
                    ...DANAO_CITY_BARANGAYS.map(b => {
                      const cnt = barangayAccountCounts.counts[b.toLowerCase()] || 0;
                      return createElement(
                        'option',
                        { key: b, value: b },
                        `🏘️ Brgy. ${b}${cnt > 0 ? ` (${cnt})` : ''}`
                      );
                    }),
                  ])}
                  <MaterialIcons
                    name="arrow-drop-down"
                    size={20}
                    color={selectedBarangayFilter !== 'all' ? "#059669" : "#94A3B8"}
                    style={{ position: 'absolute', right: 8, pointerEvents: 'none' }}
                  />
                </View>
              ) : (
                <TouchableOpacity
                  style={[styles.barangaySelectWrapper, selectedBarangayFilter !== 'all' && styles.barangaySelectWrapperActive]}
                  onPress={() => {
                    setBarangaySearchQuery("");
                    setIsBarangayModalOpen(true);
                  }}
                  activeOpacity={0.8}
                >
                  <MaterialIcons
                    name="location-on"
                    size={16}
                    color={selectedBarangayFilter !== 'all' ? "#059669" : "#64748B"}
                  />
                  <Text
                    style={[styles.barangaySelectText, selectedBarangayFilter !== 'all' && styles.barangaySelectTextActive]}
                    numberOfLines={1}
                  >
                    {selectedBarangayFilter === 'all'
                      ? 'All Barangays'
                      : selectedBarangayFilter === 'unassigned'
                      ? 'No Barangay'
                      : `Brgy. ${selectedBarangayFilter}`}
                  </Text>
                  <MaterialIcons name="arrow-drop-down" size={20} color="#94A3B8" />
                </TouchableOpacity>
              )}

              {selectedBarangayFilter !== 'all' && (
                <TouchableOpacity
                  style={styles.clearBarangayBtn}
                  onPress={() => setSelectedBarangayFilter('all')}
                  activeOpacity={0.7}
                  accessibilityLabel="Reset barangay filter to All Barangays"
                >
                  <MaterialIcons name="close" size={14} color="#065F46" />
                </TouchableOpacity>
              )}
            </View>
          )}

          <View
            style={[
              styles.searchBox,
              {
                maxWidth: isMobile ? "100%" : 260,
                width: isMobile ? "100%" : 260,
              },
            ]}
          >
            <MaterialIcons
              name="search"
              size={18}
              color="#94A3B8"
              style={{ marginRight: 8 }}
            />
            <TextInput
              style={styles.searchInput}
              placeholder="Search name, email, ID..."
              placeholderTextColor="#94A3B8"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery("")}>
                <MaterialIcons name="close" size={16} color="#94A3B8" />
              </TouchableOpacity>
            )}
          </View>
          <TouchableOpacity
            style={styles.exportTopBtn}
            onPress={() => setIsExportModalVisible(true)}
            activeOpacity={0.8}
          >
            <MaterialIcons name="file-download" size={18} color="#059669" />
            <Text style={styles.exportTopBtnText}>Export</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Main Table Card */}
      <View
        style={[styles.card, isMobile && { padding: 14 }, { marginTop: 14 }]}
      >
        {/* CENRO Active Barangay Filter Scope Indicator */}
        {!isCoordinator && selectedBarangayFilter !== 'all' && (
          <View style={styles.activeFilterBanner}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
              <MaterialIcons name="filter-alt" size={16} color="#047857" />
              <Text style={styles.activeFilterBannerText}>
                Barangay Scope: <Text style={{ fontWeight: '800' }}>{selectedBarangayFilter === 'unassigned' ? 'Unassigned Accounts' : `Brgy. ${selectedBarangayFilter}`}</Text> ({filteredUsers.length} matching {filteredUsers.length === 1 ? 'account' : 'accounts'})
              </Text>
            </View>
            <TouchableOpacity
              style={styles.clearFilterBannerBtn}
              onPress={() => setSelectedBarangayFilter('all')}
              activeOpacity={0.7}
            >
              <MaterialIcons name="close" size={14} color="#065F46" />
              <Text style={styles.clearFilterBannerBtnText}>Clear Filter</Text>
            </TouchableOpacity>
          </View>
        )}
        <ScrollView
          horizontal={isMobile}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ flexGrow: 1, minWidth: "100%" }}
          style={{ width: "100%" }}
        >
          <View
            style={{
              minWidth: isMobile ? 780 : "100%",
              width: "100%",
            }}
          >
            <View style={styles.tableHead}>
              {/* Column 1: Employee / License */}
              <TouchableOpacity
                style={[styles.thBtn, { flex: 2.0 }]}
                onPress={() => handleHeaderSort("credentials")}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.th,
                    sortField === "credentials" && styles.thActive,
                  ]}
                >
                  EMPLOYEE / LICENSE
                </Text>
                <MaterialIcons
                  name={
                    sortField === "credentials"
                      ? sortDirection === "asc"
                        ? "arrow-upward"
                        : "arrow-downward"
                      : "unfold-more"
                  }
                  size={14}
                  color={sortField === "credentials" ? "#1B4D3E" : "#94A3B8"}
                />
              </TouchableOpacity>

              {/* Column 2: User Name & Email */}
              <TouchableOpacity
                style={[styles.thBtn, { flex: 2.6 }]}
                onPress={() => handleHeaderSort("name")}
                activeOpacity={0.7}
              >
                <Text
                  style={[styles.th, sortField === "name" && styles.thActive]}
                >
                  USER NAME & EMAIL
                </Text>
                <MaterialIcons
                  name={
                    sortField === "name"
                      ? sortDirection === "asc"
                        ? "arrow-upward"
                        : "arrow-downward"
                      : "unfold-more"
                  }
                  size={14}
                  color={sortField === "name" ? "#1B4D3E" : "#94A3B8"}
                />
              </TouchableOpacity>

              {/* Column 3: Barangay & Vehicle */}
              <TouchableOpacity
                style={[styles.thBtn, { flex: 1.8 }]}
                onPress={() => handleHeaderSort("assignment")}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.th,
                    sortField === "assignment" && styles.thActive,
                  ]}
                >
                  BARANGAY & VEHICLE
                </Text>
                <MaterialIcons
                  name={
                    sortField === "assignment"
                      ? sortDirection === "asc"
                        ? "arrow-upward"
                        : "arrow-downward"
                      : "unfold-more"
                  }
                  size={14}
                  color={sortField === "assignment" ? "#1B4D3E" : "#94A3B8"}
                />
              </TouchableOpacity>

              {/* Column 4: Role (next to Actions) */}
              <TouchableOpacity
                style={[styles.thBtn, { flex: 1.2 }]}
                onPress={() => handleHeaderSort("role")}
                activeOpacity={0.7}
              >
                <Text
                  style={[styles.th, sortField === "role" && styles.thActive]}
                >
                  ROLE
                </Text>
                <MaterialIcons
                  name={
                    sortField === "role"
                      ? sortDirection === "asc"
                        ? "arrow-upward"
                        : "arrow-downward"
                      : "unfold-more"
                  }
                  size={14}
                  color={sortField === "role" ? "#1B4D3E" : "#94A3B8"}
                />
              </TouchableOpacity>

              {/* Column 5: Actions */}
              <View
                style={{
                  flex: 0.8,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={styles.th}>ACTIONS</Text>
              </View>
            </View>

            {loading ? (
              <View style={{ padding: 40, alignItems: "center" }}>
                <ActivityIndicator size="large" color="#1B4D3E" />
                <Text style={{ marginTop: 10, color: "#64748B", fontSize: 13 }}>
                  Loading accounts directory…
                </Text>
              </View>
            ) : sortedUsers.length === 0 ? (
              <View style={{ padding: 40, alignItems: "center" }}>
                <Text style={{ color: "#6B7280", fontSize: 13 }}>
                  No matching user accounts found.
                </Text>
              </View>
            ) : (
              sortedUsers.map((row) => (
                <View key={row.id} style={styles.tableRow}>
                  {/* Column 1: Employee / License */}
                  <View style={{ flex: 2.0 }}>
                    {row.role === "driver" ? (
                      <>
                        <Text
                          style={{
                            color: "#0F172A",
                            fontSize: 12,
                            fontWeight: "700",
                          }}
                        >
                          ID: {row.employeeId || "Not set"}
                        </Text>
                        <Text
                          style={{
                            color: "#64748B",
                            fontSize: 11,
                            marginTop: 1,
                          }}
                        >
                          Lic: {row.licenseNumber || "Not set"}
                        </Text>
                      </>
                    ) : row.role === "coordinator" ? (
                      <>
                        <Text
                          style={{
                            color: "#0F172A",
                            fontSize: 12,
                            fontWeight: "700",
                          }}
                        >
                          ID: {row.employeeId || "Not set"}
                        </Text>
                        {row.zone ? (
                          <Text
                            style={{
                              color: "#64748B",
                              fontSize: 11,
                              marginTop: 1,
                            }}
                          >
                            Zone: {row.zone}
                          </Text>
                        ) : null}
                      </>
                    ) : (
                      <Text
                        style={{
                          color: "#94A3B8",
                          fontSize: 12,
                          fontStyle: "italic",
                        }}
                      >
                        Resident Account
                      </Text>
                    )}
                  </View>

                  {/* Column 2: User Name & Email */}
                  <View
                    style={{
                      flex: 2.6,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    <View
                      style={[
                        styles.avatarBadge,
                        row.role === "driver" && {
                          backgroundColor: "#E0F2FE",
                        },
                        row.role === "coordinator" && {
                          backgroundColor: "#FEF3C7",
                        },
                        row.role === "admin" && {
                          backgroundColor: "#FEE2E2",
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.avatarText,
                          row.role === "driver" && { color: "#0369A1" },
                          row.role === "coordinator" && { color: "#92400E" },
                          row.role === "admin" && { color: "#B91C1C" },
                        ]}
                      >
                        {row.displayName.substring(0, 2).toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.userName} numberOfLines={1}>
                        {row.displayName}
                      </Text>
                      <Text style={styles.userEmail} numberOfLines={1}>
                        {row.email}
                      </Text>
                      {!isCoordinator && (row.role === "user" || row.role === "resident" || !row.role) && (
                        <View style={{ marginTop: 4, flexDirection: "row", alignItems: "center" }}>
                          <TouchableOpacity
                            style={[
                              styles.verifyPillBadge,
                              row.verificationStatus === "verified"
                                ? (row.confirmedByCenro ? styles.verifyPillCenro : styles.verifyPillVerified)
                                : row.verificationStatus === "rejected"
                                ? styles.verifyPillRejected
                                : row.verificationImageUrl
                                ? styles.verifyPillPending
                                : styles.verifyPillUnsubmitted,
                            ]}
                            onPress={() => {
                              if (row.verificationImageUrl || row.verificationStatus === "verified" || row.verificationStatus === "rejected") {
                                setViewingIdUser(row);
                              }
                            }}
                            activeOpacity={row.verificationImageUrl || row.verificationStatus === "verified" || row.verificationStatus === "rejected" ? 0.7 : 1}
                            disabled={!row.verificationImageUrl && row.verificationStatus !== "verified" && row.verificationStatus !== "rejected"}
                          >
                            <MaterialIcons
                              name={
                                row.verificationStatus === "verified"
                                  ? "verified"
                                  : row.verificationStatus === "rejected"
                                  ? "cancel"
                                  : row.verificationImageUrl
                                  ? "pending"
                                  : "help-outline"
                              }
                              size={12}
                              color={
                                row.verificationStatus === "verified"
                                  ? (row.confirmedByCenro ? "#0D9488" : "#059669")
                                  : row.verificationStatus === "rejected"
                                  ? "#DC2626"
                                  : row.verificationImageUrl
                                  ? "#D97706"
                                  : "#64748B"
                              }
                            />
                            <Text
                              style={[
                                styles.verifyPillText,
                                row.verificationStatus === "verified"
                                  ? (row.confirmedByCenro ? styles.verifyPillTextCenro : styles.verifyPillTextVerified)
                                  : row.verificationStatus === "rejected"
                                  ? styles.verifyPillTextRejected
                                  : row.verificationImageUrl
                                  ? styles.verifyPillTextPending
                                  : styles.verifyPillTextUnsubmitted,
                              ]}
                            >
                              {row.verificationStatus === "verified"
                                ? (row.confirmedByCenro ? "CONFIRMED BY CENRO" : "ID VERIFIED")
                                : row.verificationStatus === "rejected"
                                ? "ID REJECTED"
                                : row.verificationImageUrl
                                ? "REVIEW ID"
                                : "NO ID"}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  </View>

                  {/* Column 3: Barangay & Vehicle */}
                  <View style={{ flex: 1.8 }}>
                    {row.assignedBarangay ? (
                      <Text
                        style={{
                          color: "#047857",
                          fontSize: 12,
                          fontWeight: "700",
                        }}
                      >
                        Brgy. {row.assignedBarangay}
                      </Text>
                    ) : row.barangay ? (
                      <Text
                        style={{
                          color: "#047857",
                          fontSize: 12,
                          fontWeight: "700",
                        }}
                      >
                        Brgy. {row.barangay}
                      </Text>
                    ) : (
                      <Text
                        style={{
                          color: "#94A3B8",
                          fontSize: 12,
                          fontStyle: "italic",
                        }}
                      >
                        No Barangay
                      </Text>
                    )}
                    {row.role === "driver" &&
                      (row.currentTruckPlate ? (
                        <View style={[styles.truckBadge, { marginTop: 3 }]}>
                          <Text style={styles.truckBadgeText}>
                            🚚 {row.currentTruckPlate}
                          </Text>
                        </View>
                      ) : (
                        <Text
                          style={{
                            color: "#9CA3AF",
                            fontSize: 11,
                            fontStyle: "italic",
                            marginTop: 2,
                          }}
                        >
                          No Truck
                        </Text>
                      ))}
                  </View>

                  {/* Column 4: Role (next to Actions) */}
                  <View
                    style={{
                      flex: 1.2,
                      alignItems: "flex-start",
                      justifyContent: "center",
                    }}
                  >
                    {getRoleBadge(row.role)}
                  </View>

                  {/* Column 5: Actions (QR Code Badge + 3 Dots Menu) */}
                  <View
                    style={{
                      flex: 1.1,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                    }}
                  >
                    {row.role === "driver" && (
                      <TouchableOpacity
                        style={styles.qrBadgeActionBtn}
                        onPress={() => handleOpenDriverQrBadge(row)}
                        accessibilityLabel={`View QR login badge for driver ${row.displayName || row.email}`}
                        activeOpacity={0.7}
                      >
                        <MaterialIcons name="qr-code-2" size={18} color="#059669" />
                      </TouchableOpacity>
                    )}
                    {!isReadOnly && !isCoordinator &&
                      row.role !== "cicto" &&
                      row.role !== "admin" &&
                      row.role !== "cenro" &&
                      !isCictoEmail(row.email) &&
                      row.id !== auth?.currentUser?.uid && (
                      <TouchableOpacity
                        style={styles.actionDeleteBtn}
                        onPress={() => handleOpenDelete(row)}
                        accessibilityLabel={`Delete account for ${row.displayName || row.email}`}
                        activeOpacity={0.7}
                      >
                        <MaterialIcons name="delete-outline" size={18} color="#DC2626" />
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      style={styles.moreActionBtn}
                      onPress={() => handleOpenDetails(row)}
                      accessibilityLabel={`View details and governance for ${row.displayName || row.email}`}
                      activeOpacity={0.7}
                    >
                      <MaterialIcons name="more-vert" size={20} color="#475569" />
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}
          </View>
        </ScrollView>
      </View>

      {/* Account Details & Information Inspector Modal (Read-Only) */}
      {selectedUser && (
        <Modal visible={true} transparent={true} animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              {/* Modal Header */}
              <View style={styles.modalHeader}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    flex: 1,
                  }}
                >
                  <View
                    style={[
                      styles.modalAvatar,
                      selectedUser.role === "driver" && {
                        backgroundColor: "#E0F2FE",
                      },
                      selectedUser.role === "coordinator" && {
                        backgroundColor: "#FEF3C7",
                      },
                      selectedUser.role === "admin" && {
                        backgroundColor: "#FEE2E2",
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.modalAvatarText,
                        selectedUser.role === "driver" && { color: "#0369A1" },
                        selectedUser.role === "coordinator" && {
                          color: "#92400E",
                        },
                        selectedUser.role === "admin" && { color: "#B91C1C" },
                      ]}
                    >
                      {selectedUser.displayName.substring(0, 2).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.modalUserName}>
                      {selectedUser.displayName || "No Name"}
                    </Text>
                    <Text style={styles.modalUserEmail}>
                      {selectedUser.email}
                    </Text>
                  </View>
                </View>
                <TouchableOpacity
                  onPress={() => setSelectedUser(null)}
                  style={styles.modalCloseBtn}
                >
                  <MaterialIcons name="close" size={20} color="#64748B" />
                </TouchableOpacity>
              </View>

              {/* Modal Body: Read-only Profile Information */}
              <ScrollView
                style={styles.modalBody}
                showsVerticalScrollIndicator={false}
              >
                {/* Role & Status Overview */}
                <View style={styles.detailRoleStatusCard}>
                  <View>
                    <Text style={styles.detailCardLabel}>ACCOUNT ROLE</Text>
                    <View style={{ marginTop: 4 }}>
                      {getRoleBadge(selectedUser.role)}
                    </View>
                  </View>

                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={styles.detailCardLabel}>ACCOUNT STATUS</Text>
                    <View style={styles.activeStatusBadge}>
                      <View style={styles.activeDot} />
                      <Text style={styles.activeStatusText}>Active</Text>
                    </View>
                  </View>
                </View>

                {/* Details List */}
                <View style={{ gap: 10 }}>
                  {/* Jurisdiction / Barangay (Editable for Driver & Coordinator only) */}
                  {(() => {
                    const canEditBarangay =
                      !isReadOnly &&
                      !isCoordinator &&
                      (selectedUser.role === "driver" ||
                        selectedUser.role === "coordinator");

                    if (!isEditingBarangay) {
                      return (
                        <View style={styles.detailInfoBox}>
                          <View style={styles.detailInfoIcon}>
                            <MaterialIcons
                              name="location-on"
                              size={18}
                              color="#1B4D3E"
                            />
                          </View>
                          <View style={{ flex: 1 }}>
                            <View
                              style={{
                                flexDirection: "row",
                                alignItems: "center",
                                justifyContent: "space-between",
                              }}
                            >
                              <Text style={styles.detailCardLabel}>
                                ASSIGNED BARANGAY / JURISDICTION
                              </Text>
                              {canEditBarangay && (
                                <TouchableOpacity
                                  onPress={() => {
                                    setIsEditingBarangay(true);
                                    setEditBarangayValue(
                                      selectedUser.assignedBarangay ||
                                        selectedUser.barangay ||
                                        ""
                                    );
                                    setEditError(null);
                                    setEditSuccess(null);
                                  }}
                                  style={styles.editBarangayPillBtn}
                                  activeOpacity={0.7}
                                >
                                  <MaterialIcons
                                    name="edit"
                                    size={12}
                                    color="#1B4D3E"
                                  />
                                  <Text style={styles.editBarangayPillText}>
                                    Change
                                  </Text>
                                </TouchableOpacity>
                              )}
                            </View>
                            <Text style={styles.detailCardValue}>
                              {(() => {
                                const b = (selectedUser.assignedBarangay || selectedUser.barangay || '').trim() ||
                                  (selectedUser.role === 'coordinator' || selectedUser.role === 'admin' || selectedUser.role === 'cenro' ? 'CITY' : '');
                                if (!b) return "No Barangay Assigned";
                                return b.toUpperCase() === 'CITY' ? "CITY (City-Wide Jurisdiction)" : `Brgy. ${b}`;
                              })()}
                            </Text>
                            {Boolean(editSuccess) && (
                              <View style={styles.editSuccessBanner}>
                                <MaterialIcons
                                  name="check-circle"
                                  size={14}
                                  color="#059669"
                                />
                                <Text style={styles.editSuccessText}>
                                  {editSuccess}
                                </Text>
                              </View>
                            )}
                          </View>
                        </View>
                      );
                    }

                    return (
                      <View
                        style={[
                          styles.detailInfoBox,
                          styles.detailInfoBoxEditing,
                        ]}
                      >
                        <View style={styles.detailInfoIcon}>
                          <MaterialIcons
                            name="edit-location"
                            size={18}
                            color="#1B4D3E"
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <View
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              justifyContent: "space-between",
                              marginBottom: 8,
                            }}
                          >
                            <Text style={styles.detailCardLabel}>
                              EDIT BARANGAY ASSIGNMENT
                            </Text>
                            <TouchableOpacity
                              onPress={() => {
                                setIsEditingBarangay(false);
                                setEditBarangayDropdownOpen(false);
                                setEditError(null);
                              }}
                              style={styles.editCancelPillBtn}
                              activeOpacity={0.7}
                            >
                              <Text style={styles.editCancelPillText}>
                                Cancel
                              </Text>
                            </TouchableOpacity>
                          </View>

                          {/* Dropdown trigger */}
                          <TouchableOpacity
                            style={styles.editDropdownTrigger}
                            onPress={() =>
                              setEditBarangayDropdownOpen(
                                !editBarangayDropdownOpen
                              )
                            }
                            activeOpacity={0.8}
                          >
                            <Text
                              style={[
                                styles.editDropdownTriggerText,
                                !editBarangayValue && { color: "#9CA3AF" },
                              ]}
                            >
                              {editBarangayValue
                                ? `Brgy. ${editBarangayValue}`
                                : "Select operational barangay..."}
                            </Text>
                            <MaterialIcons
                              name={
                                editBarangayDropdownOpen
                                  ? "keyboard-arrow-up"
                                  : "keyboard-arrow-down"
                              }
                              size={18}
                              color="#6B7280"
                            />
                          </TouchableOpacity>

                          {/* Dropdown menu */}
                          {editBarangayDropdownOpen && (
                            <View style={styles.editDropdownMenu}>
                              <View style={styles.editDropdownSearchContainer}>
                                <MaterialIcons
                                  name="search"
                                  size={14}
                                  color="#6B7280"
                                />
                                <TextInput
                                  value={editBarangaySearch}
                                  onChangeText={setEditBarangaySearch}
                                  placeholder="Filter barangays..."
                                  placeholderTextColor="#9CA3AF"
                                  style={styles.editDropdownSearchInput}
                                />
                                {editBarangaySearch.length > 0 && (
                                  <TouchableOpacity
                                    onPress={() => setEditBarangaySearch("")}
                                  >
                                    <MaterialIcons
                                      name="close"
                                      size={14}
                                      color="#6B7280"
                                    />
                                  </TouchableOpacity>
                                )}
                              </View>

                              <ScrollView
                                nestedScrollEnabled
                                style={{ maxHeight: 180 }}
                                keyboardShouldPersistTaps="handled"
                              >
                                {/* Option to clear/unassign */}
                                <TouchableOpacity
                                  style={[
                                    styles.editDropdownItem,
                                    !editBarangayValue &&
                                      styles.editDropdownItemSelected,
                                  ]}
                                  onPress={() => {
                                    setEditBarangayValue("");
                                    setEditBarangayDropdownOpen(false);
                                    setEditError(null);
                                  }}
                                >
                                  <Text
                                    style={[
                                      styles.editDropdownItemText,
                                      !editBarangayValue && {
                                        fontWeight: "700",
                                        color: "#1B4D3E",
                                      },
                                    ]}
                                  >
                                    (No Barangay Assigned / Clear)
                                  </Text>
                                </TouchableOpacity>

                                {availableBarangays
                                  .filter(
                                    (b) =>
                                      !editBarangaySearch.trim() ||
                                      b
                                        .toLowerCase()
                                        .includes(
                                          editBarangaySearch
                                            .trim()
                                            .toLowerCase()
                                        )
                                  )
                                  .map((b) => {
                                    const isSelected = editBarangayValue === b;
                                    const coordinatorOccupant =
                                      selectedUser.role === "coordinator"
                                        ? takenCoordinatorBarangaysMap[b]
                                        : null;
                                    const isOccupiedByOther =
                                      coordinatorOccupant &&
                                      coordinatorOccupant.id !==
                                        selectedUser.id;

                                    return (
                                      <TouchableOpacity
                                        key={b}
                                        style={[
                                          styles.editDropdownItem,
                                          isSelected &&
                                            styles.editDropdownItemSelected,
                                          isOccupiedByOther && { opacity: 0.6 },
                                        ]}
                                        onPress={() => {
                                          if (isOccupiedByOther) {
                                            setEditError(
                                              `Brgy. ${b} is already assigned to coordinator ${coordinatorOccupant.name}.`
                                            );
                                            return;
                                          }
                                          setEditBarangayValue(b);
                                          setEditBarangayDropdownOpen(false);
                                          setEditError(null);
                                        }}
                                      >
                                        <View
                                          style={{
                                            flex: 1,
                                            flexDirection: "row",
                                            alignItems: "center",
                                            justifyContent: "space-between",
                                          }}
                                        >
                                          <Text
                                            style={[
                                              styles.editDropdownItemText,
                                              isSelected && {
                                                fontWeight: "700",
                                                color: "#1B4D3E",
                                              },
                                            ]}
                                          >
                                            {b}
                                          </Text>
                                          {isOccupiedByOther ? (
                                            <View style={styles.takenBadgeMini}>
                                              <Text
                                                style={styles.takenBadgeMiniText}
                                              >
                                                Assigned
                                              </Text>
                                            </View>
                                          ) : (
                                            <View
                                              style={styles.scheduledBadgeMini}
                                            >
                                              <Text
                                                style={
                                                  styles.scheduledBadgeMiniText
                                                }
                                              >
                                                Available
                                              </Text>
                                            </View>
                                          )}
                                        </View>
                                      </TouchableOpacity>
                                    );
                                  })}
                              </ScrollView>
                            </View>
                          )}

                          {Boolean(editError) && (
                            <View style={styles.editErrorBanner}>
                              <MaterialIcons
                                name="error-outline"
                                size={14}
                                color="#B91C1C"
                              />
                              <Text style={styles.editErrorText}>
                                {editError}
                              </Text>
                            </View>
                          )}

                          {/* Action Buttons */}
                          <View
                            style={{
                              flexDirection: "row",
                              gap: 8,
                              marginTop: 10,
                            }}
                          >
                            <TouchableOpacity
                              style={styles.editSaveBtn}
                              onPress={handleSaveBarangay}
                              disabled={isSavingBarangay}
                              activeOpacity={0.8}
                            >
                              {isSavingBarangay ? (
                                <ActivityIndicator
                                  size="small"
                                  color="#FFFFFF"
                                />
                              ) : (
                                <>
                                  <MaterialIcons
                                    name="save"
                                    size={14}
                                    color="#FFFFFF"
                                  />
                                  <Text style={styles.editSaveBtnText}>
                                    Save Assignment
                                  </Text>
                                </>
                              )}
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={styles.editCancelBtn}
                              onPress={() => {
                                setIsEditingBarangay(false);
                                setEditBarangayDropdownOpen(false);
                                setEditError(null);
                              }}
                              disabled={isSavingBarangay}
                              activeOpacity={0.8}
                            >
                              <Text style={styles.editCancelBtnText}>
                                Cancel
                              </Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      </View>
                    );
                  })()}

                  {/* Driver Specific Credentials */}
                  {selectedUser.role === "driver" && (
                    <View style={styles.detailInfoBox}>
                      <View style={styles.detailInfoIcon}>
                        <MaterialIcons name="badge" size={18} color="#0284C7" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.detailCardLabel}>
                          DRIVER CREDENTIALS & QR BADGE
                        </Text>
                        <Text style={styles.detailCardValue}>
                          Employee ID:{" "}
                          <Text style={{ fontWeight: "800", color: "#0F172A" }}>
                            {selectedUser.employeeId || "Not set"}
                          </Text>
                        </Text>
                        <Text
                          style={[
                            styles.detailCardValue,
                            { marginTop: 2, fontSize: 12, color: "#64748B" },
                          ]}
                        >
                          LTO License: {selectedUser.licenseNumber || "Not set"}
                        </Text>
                        <TouchableOpacity
                          style={styles.modalQrBadgeBtn}
                          onPress={() => handleOpenDriverQrBadge(selectedUser)}
                          activeOpacity={0.8}
                          disabled={fetchingDriverQr}
                        >
                          {fetchingDriverQr ? (
                            <ActivityIndicator size="small" color="#FFFFFF" />
                          ) : (
                            <>
                              <MaterialIcons name="qr-code-2" size={16} color="#FFFFFF" />
                              <Text style={styles.modalQrBadgeBtnText}>
                                Display QR Login Badge for Driver
                              </Text>
                            </>
                          )}
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}

                  {/* Coordinator Specific Credentials */}
                  {selectedUser.role === "coordinator" && (
                    <View style={styles.detailInfoBox}>
                      <View style={styles.detailInfoIcon}>
                        <MaterialIcons
                          name="supervised-user-circle"
                          size={18}
                          color="#D97706"
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.detailCardLabel}>
                          COORDINATOR DESIGNATION
                        </Text>
                        <Text style={styles.detailCardValue}>
                          Coordinator ID:{" "}
                          <Text style={{ fontWeight: "800", color: "#0F172A" }}>
                            {selectedUser.employeeId || "Not set"}
                          </Text>
                        </Text>
                        {selectedUser.zone ? (
                          <Text
                            style={[
                              styles.detailCardValue,
                              { marginTop: 2, fontSize: 12, color: "#64748B" },
                            ]}
                          >
                            Sector / Zone: {selectedUser.zone}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  )}

                  {/* Truck Assignment (Driver only) */}
                  {selectedUser.role === "driver" && (
                    <View style={styles.detailInfoBox}>
                      <View style={styles.detailInfoIcon}>
                        <MaterialIcons
                          name="local-shipping"
                          size={18}
                          color="#059669"
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.detailCardLabel}>
                          ASSIGNED TRUCK / COMPACTOR
                        </Text>
                        <Text style={styles.detailCardValue}>
                          {selectedUser.currentTruckPlate
                            ? `🚚 ${selectedUser.currentTruckPlate}`
                            : "No Truck Assigned"}
                        </Text>
                      </View>
                    </View>
                  )}

                  {/* Contact Info */}
                  <View style={styles.detailInfoBox}>
                    <View style={styles.detailInfoIcon}>
                      <MaterialIcons name="phone" size={18} color="#475569" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.detailCardLabel}>
                        CONTACT PHONE NUMBER
                      </Text>
                      <Text style={styles.detailCardValue}>
                        {selectedUser.phoneNumber ||
                          selectedUser.contactInfo ||
                          "Not Provided"}
                      </Text>
                    </View>
                  </View>

                  {/* Registration Date */}
                  <View style={styles.detailInfoBox}>
                    <View style={styles.detailInfoIcon}>
                      <MaterialIcons
                        name="calendar-today"
                        size={18}
                        color="#64748B"
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.detailCardLabel}>
                        ACCOUNT REGISTERED
                      </Text>
                      <Text style={styles.detailCardValue}>
                        {selectedUser.createdAt?.toDate
                          ? selectedUser.createdAt
                              .toDate()
                              .toLocaleDateString("en-US", {
                                year: "numeric",
                                month: "long",
                                day: "numeric",
                              })
                          : "Active Account"}
                      </Text>
                    </View>
                  </View>

                  {/* Resident ID Verification Review Card (CENRO Only - Hidden from Coordinators) */}
                  {!isCoordinator &&
                    (selectedUser.role === "user" ||
                      selectedUser.role === "resident" ||
                      !selectedUser.role) && (
                      <View style={styles.detailInfoBox}>
                        <View style={styles.detailInfoIcon}>
                          <MaterialIcons
                            name="verified-user"
                            size={18}
                            color={
                              selectedUser.verificationStatus === "verified"
                                ? (selectedUser.confirmedByCenro ? "#0D9488" : "#059669")
                                : selectedUser.verificationStatus === "rejected"
                                ? "#DC2626"
                                : "#D97706"
                            }
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <View
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              justifyContent: "space-between",
                            }}
                          >
                            <Text style={styles.detailCardLabel}>
                              RESIDENT ID VERIFICATION
                            </Text>
                            <View
                              style={[
                                styles.verifyPillBadge,
                                selectedUser.verificationStatus === "verified"
                                  ? (selectedUser.confirmedByCenro ? styles.verifyPillCenro : styles.verifyPillVerified)
                                  : selectedUser.verificationStatus === "rejected"
                                  ? styles.verifyPillRejected
                                  : selectedUser.verificationImageUrl
                                  ? styles.verifyPillPending
                                  : styles.verifyPillUnsubmitted,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.verifyPillText,
                                  selectedUser.verificationStatus === "verified"
                                    ? (selectedUser.confirmedByCenro ? styles.verifyPillTextCenro : styles.verifyPillTextVerified)
                                    : selectedUser.verificationStatus === "rejected"
                                    ? styles.verifyPillTextRejected
                                    : selectedUser.verificationImageUrl
                                    ? styles.verifyPillTextPending
                                    : styles.verifyPillTextUnsubmitted,
                                ]}
                              >
                                {selectedUser.verificationStatus === "verified"
                                  ? (selectedUser.confirmedByCenro ? "CONFIRMED BY CENRO" : "ID VERIFIED")
                                  : selectedUser.verificationStatus === "rejected"
                                  ? "ID REJECTED"
                                  : selectedUser.verificationImageUrl
                                  ? "REVIEW PENDING"
                                  : "NO ID SUBMITTED"}
                              </Text>
                            </View>
                          </View>
                          <Text
                            style={[
                              styles.detailCardValue,
                              { marginTop: 4, fontSize: 12, color: "#475569" },
                            ]}
                          >
                            {selectedUser.verificationStatus === "verified"
                              ? selectedUser.confirmedByCenro
                                ? `Confirmed by CENRO (${selectedUser.cenroConfirmedBy || "CENRO Office"}). Official residency verified.`
                                : `Verified by ${selectedUser.verifiedBy || "Administrator"}.`
                              : selectedUser.verificationStatus === "rejected"
                              ? `Rejected: ${selectedUser.rejectionReason || "Invalid residency document"}`
                              : selectedUser.verificationImageUrl
                              ? `Submitted ${selectedUser.verificationIdType || "residency document"} ready for CENRO review.`
                              : "No proof of residency uploaded yet."}
                          </Text>
                          {selectedUser.verificationImageUrl ? (
                            <TouchableOpacity
                              style={[styles.modalQrBadgeBtn, { backgroundColor: "#1B4D3E", marginTop: 8 }]}
                              onPress={() => {
                                setViewingIdUser(selectedUser);
                              }}
                              activeOpacity={0.8}
                            >
                              <MaterialIcons
                                name="visibility"
                                size={16}
                                color="#FFFFFF"
                              />
                              <Text style={styles.modalQrBadgeBtnText}>
                                Inspect & Verify Submitted ID
                              </Text>
                            </TouchableOpacity>
                          ) : null}
                        </View>
                      </View>
                    )}

                  {/* Account Governance & Role Actions Section */}
                  <View style={styles.detailRoleActionCard}>
                    <View style={styles.detailRoleActionHeader}>
                      <View style={styles.detailRoleActionIconBadge}>
                        <MaterialIcons
                          name="admin-panel-settings"
                          size={18}
                          color="#0D9488"
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.detailRoleActionTitle}>
                          Role & Employment Governance
                        </Text>
                        <Text style={styles.detailRoleActionSub}>
                          {selectedUser.role === "driver"
                            ? "Active Fleet Personnel. You can promote to Coordinator or offboard back to standard resident status."
                            : selectedUser.role === "coordinator"
                            ? "Assigned Environmental Officer. You can relieve from duties and revert back to standard resident status."
                            : "Standard Citizen. You can elevate this account into an active driver or coordinator."}
                        </Text>
                      </View>
                    </View>

                    {isReadOnly ? (
                      <View style={styles.detailReadOnlyGovNotice}>
                        <MaterialIcons name="lock-outline" size={18} color="#92400E" />
                        <Text style={styles.detailReadOnlyGovText}>
                          Account governance, elevation, offboarding, and deletion are disabled in Read-Only Mode. Contact CICTO to request write access.
                        </Text>
                      </View>
                    ) : (
                      <View style={styles.detailRoleActionButtonsWrap}>
                      {/* Elevate to Driver (for residents) */}
                      {(selectedUser.role === "user" ||
                        selectedUser.role === "resident" ||
                        !selectedUser.role) && (
                        <TouchableOpacity
                          style={styles.detailGovActionItem}
                          onPress={() => handleElevateUser(selectedUser)}
                          activeOpacity={0.7}
                        >
                          <View
                            style={[
                              styles.detailGovIconWrap,
                              { backgroundColor: "#F0FDF4" },
                            ]}
                          >
                            <MaterialIcons
                              name="local-shipping"
                              size={20}
                              color="#047857"
                            />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.detailGovItemTitle}>
                              Elevate to Driver
                            </Text>
                            <Text style={styles.detailGovItemDesc}>
                              Assign license number, employee ID, truck, and route
                            </Text>
                          </View>
                          <MaterialIcons
                            name="chevron-right"
                            size={18}
                            color="#94A3B8"
                          />
                        </TouchableOpacity>
                      )}

                      {/* Elevate to Coordinator (for residents or drivers - CENRO only) */}
                      {!isCoordinator &&
                        (selectedUser.role === "user" ||
                          selectedUser.role === "resident" ||
                          !selectedUser.role ||
                          selectedUser.role === "driver") && (
                        <TouchableOpacity
                          style={styles.detailGovActionItem}
                          onPress={() =>
                            handleElevateToCoordinator(selectedUser)
                          }
                          activeOpacity={0.7}
                        >
                          <View
                            style={[
                              styles.detailGovIconWrap,
                              { backgroundColor: "#F0FDFA" },
                            ]}
                          >
                            <MaterialIcons
                              name="supervised-user-circle"
                              size={20}
                              color="#0D9488"
                            />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.detailGovItemTitle}>
                              Elevate to Coordinator
                            </Text>
                            <Text style={styles.detailGovItemDesc}>
                              Appoint as Barangay Environmental Coordinator
                            </Text>
                          </View>
                          <MaterialIcons
                            name="chevron-right"
                            size={18}
                            color="#94A3B8"
                          />
                        </TouchableOpacity>
                      )}

                      {/* Offboard / Revert to Resident (for drivers and coordinators) */}
                      {(selectedUser.role === "driver" ||
                        selectedUser.role === "coordinator") && (
                        <TouchableOpacity
                          style={[
                            styles.detailGovActionItem,
                            styles.detailGovActionItemWarning,
                          ]}
                          onPress={() => handleDemoteUser(selectedUser)}
                          disabled={isDemoting}
                          activeOpacity={0.7}
                        >
                          <View
                            style={[
                              styles.detailGovIconWrap,
                              { backgroundColor: "#FFFBEB" },
                            ]}
                          >
                            {isDemoting ? (
                              <ActivityIndicator
                                size="small"
                                color="#B45309"
                              />
                            ) : (
                              <MaterialIcons
                                name="assignment-return"
                                size={20}
                                color="#B45309"
                              />
                            )}
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text
                              style={[
                                styles.detailGovItemTitle,
                                { color: "#92400E" },
                              ]}
                            >
                              {selectedUser.role === "driver"
                                ? "Offboard Driver to Resident"
                                : "Offboard Coordinator to Resident"}
                            </Text>
                            <Text
                              style={[
                                styles.detailGovItemDesc,
                                { color: "#78350F" },
                              ]}
                            >
                              {selectedUser.role === "driver"
                                ? "Relieve driver duties, unassign truck, and revert account to resident"
                                : "Relieve coordinator duties and revert account to resident"}
                            </Text>
                          </View>
                          <MaterialIcons
                            name="chevron-right"
                            size={18}
                            color="#B45309"
                          />
                        </TouchableOpacity>
                      )}

                      {/* Permanently Delete Account (CENRO action) */}
                      {!isCoordinator &&
                        selectedUser.role !== "cicto" &&
                        selectedUser.role !== "admin" &&
                        selectedUser.role !== "cenro" &&
                        !isCictoEmail(selectedUser.email) &&
                        selectedUser.id !== auth?.currentUser?.uid && (
                        <TouchableOpacity
                          style={[
                            styles.detailGovActionItem,
                            styles.detailGovActionItemDanger,
                          ]}
                          onPress={() => handleOpenDelete(selectedUser)}
                          activeOpacity={0.7}
                        >
                          <View
                            style={[
                              styles.detailGovIconWrap,
                              { backgroundColor: "#FEE2E2" },
                            ]}
                          >
                            <MaterialIcons
                              name="delete-forever"
                              size={20}
                              color="#DC2626"
                            />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text
                              style={[
                                styles.detailGovItemTitle,
                                { color: "#DC2626" },
                              ]}
                            >
                              Permanently Delete Account
                            </Text>
                            <Text
                              style={[
                                styles.detailGovItemDesc,
                                { color: "#991B1B" },
                              ]}
                            >
                              Completely erase authentication, credentials, and records
                            </Text>
                          </View>
                          <MaterialIcons
                            name="chevron-right"
                            size={18}
                            color="#DC2626"
                          />
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                  </View>
                </View>
              </ScrollView>

              {/* Modal Footer */}
              <View style={styles.modalFooter}>
                <TouchableOpacity
                  style={styles.modalCloseDoneBtn}
                  onPress={() => setSelectedUser(null)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.modalCloseDoneBtnText}>
                    Close Details
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* Onboard New Driver Modal */}
      {isOnboardModalOpen && (
        <Modal
          visible={isOnboardModalOpen}
          transparent={true}
          animationType="fade"
          onRequestClose={() => {
            setIsOnboardModalOpen(false);
            setElevatingUser(null);
          }}
        >
          <View style={styles.modalOverlay}>
            <View
              style={[
                styles.onboardModalContainer,
                isMobile && { width: "95%", height: "92%" },
              ]}
            >
              <DriverOnboardingTab
                onClose={() => {
                  setIsOnboardModalOpen(false);
                  setElevatingUser(null);
                }}
                defaultBarangay={assignedBarangay}
                initialUser={elevatingUser}
                initialMode={elevatingUser ? "upgrade" : "create"}
                isReadOnly={isReadOnly}
              />
            </View>
          </View>
        </Modal>
      )}

      {/* Onboard New Coordinator Modal (1 Coordinator per Barangay) */}
      {isOnboardCoordinatorModalOpen && (
        <Modal
          visible={isOnboardCoordinatorModalOpen}
          transparent={true}
          animationType="fade"
          onRequestClose={() => {
            setIsOnboardCoordinatorModalOpen(false);
            setElevatingCoordinatorUser(null);
          }}
        >
          <View style={styles.modalOverlay}>
            <View
              style={[
                styles.onboardModalContainer,
                isMobile && { width: "95%", height: "92%" },
              ]}
            >
              <CoordinatorOnboardingTab
                onClose={() => {
                  setIsOnboardCoordinatorModalOpen(false);
                  setElevatingCoordinatorUser(null);
                }}
                initialUser={elevatingCoordinatorUser}
                initialMode={elevatingCoordinatorUser ? "upgrade" : "create"}
                isReadOnly={isReadOnly}
              />
            </View>
          </View>
        </Modal>
      )}

      {/* Onboard New Resident Modal */}
      {isOnboardResidentModalOpen && (
        <Modal
          visible={isOnboardResidentModalOpen}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setIsOnboardResidentModalOpen(false)}
        >
          <View style={styles.modalOverlay}>
            <View
              style={[
                styles.onboardModalContainer,
                isMobile && { width: "95%", height: "92%" },
              ]}
            >
              <ResidentOnboardingTab
                onClose={() => setIsOnboardResidentModalOpen(false)}
                defaultBarangay={assignedBarangay}
                isReadOnly={isReadOnly}
              />
            </View>
          </View>
        </Modal>
      )}

      {/* Permanent Account Deletion Confirmation Modal */}
      {deleteTargetUser && (
        <Modal
          visible={!!deleteTargetUser}
          transparent={true}
          animationType="fade"
          onRequestClose={() => {
            if (!isDeletingAccount) setDeleteTargetUser(null);
          }}
        >
          <View style={styles.deleteModalOverlay}>
            <View style={[styles.deleteModalCard, isMobile && { width: "94%" }]}>
              {/* Header */}
              <View style={styles.deleteHeaderRow}>
                <View style={styles.deleteHeaderIconBox}>
                  <MaterialIcons name="delete-forever" size={26} color="#DC2626" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.deleteModalTitle}>Delete User Account</Text>
                  <Text style={styles.deleteModalSub}>
                    Permanent removal from CENRO directory & TrashTrack system
                  </Text>
                </View>
                {!isDeletingAccount && (
                  <TouchableOpacity
                    onPress={() => setDeleteTargetUser(null)}
                    style={styles.deleteCloseBtn}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <MaterialIcons name="close" size={20} color="#64748B" />
                  </TouchableOpacity>
                )}
              </View>

              {/* Target User Info Summary Card */}
              <View style={styles.deleteUserSummaryCard}>
                <View style={styles.deleteUserAvatar}>
                  <Text style={styles.deleteUserAvatarText}>
                    {(deleteTargetUser.displayName || deleteTargetUser.email || "U")
                      .substring(0, 2)
                      .toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <Text style={styles.deleteUserName} numberOfLines={1}>
                      {deleteTargetUser.displayName || "Unnamed User"}
                    </Text>
                    {getRoleBadge(deleteTargetUser.role)}
                  </View>
                  <Text style={styles.deleteUserEmail} numberOfLines={1}>
                    {deleteTargetUser.email}
                  </Text>
                  {deleteTargetUser.employeeId ? (
                    <Text style={styles.deleteUserMeta}>
                      ID: {deleteTargetUser.employeeId}
                    </Text>
                  ) : null}
                  {deleteTargetUser.licenseNumber ? (
                    <Text style={styles.deleteUserMeta}>
                      License: {deleteTargetUser.licenseNumber}
                    </Text>
                  ) : null}
                  {deleteTargetUser.currentTruckPlate ? (
                    <Text style={[styles.deleteUserMeta, { color: "#D97706" }]}>
                      🚚 Truck: {deleteTargetUser.currentTruckPlate} (Will be automatically released)
                    </Text>
                  ) : null}
                  {(deleteTargetUser.assignedBarangay || deleteTargetUser.barangay) ? (
                    <Text style={[styles.deleteUserMeta, { color: "#059669" }]}>
                      📍 Brgy. {deleteTargetUser.assignedBarangay || deleteTargetUser.barangay}
                      {deleteTargetUser.role === "coordinator" ? " (Jurisdiction will be released)" : ""}
                    </Text>
                  ) : null}
                </View>
              </View>

              {/* Warning Notice Box */}
              <View style={styles.deleteWarningBox}>
                <MaterialIcons
                  name="warning-amber"
                  size={20}
                  color="#B91C1C"
                  style={{ marginTop: 2 }}
                />
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={styles.deleteWarningTitle}>
                    This action is permanent and cannot be undone
                  </Text>
                  <Text style={styles.deleteWarningText}>
                    • Firebase Auth login credentials will be permanently erased.
                  </Text>
                  {deleteTargetUser.role === "coordinator" ? (
                    <Text style={styles.deleteWarningText}>
                      • Coordinator barangay jurisdiction and employee ID will be unreserved for re-onboarding.
                    </Text>
                  ) : (
                    <Text style={styles.deleteWarningText}>
                      • Active truck assignments will be safely unlinked.
                    </Text>
                  )}
                  <Text style={styles.deleteWarningText}>
                    • System identifiers, employee badges, and credentials will be wiped.
                  </Text>
                  <Text style={styles.deleteWarningText}>
                    • Firestore profile document and records will be deleted.
                  </Text>
                </View>
              </View>

              {/* Type PIN Written Below to Confirm Box */}
              <View style={styles.deletePinCard}>
                <View style={styles.deletePinHeader}>
                  <MaterialIcons name="security" size={16} color="#0F766E" />
                  <Text style={styles.deletePinTitle}>Type the PIN written below to confirm</Text>
                </View>
                {deleteGeneratedPin ? (
                  <Text style={styles.deletePinCode}>{deleteGeneratedPin}</Text>
                ) : null}
                <Text style={styles.deletePinHint}>
                  To confirm permanent deletion, type the 6-digit confirmation PIN above into the field below.
                </Text>
              </View>

              <View style={{ marginBottom: 18 }}>
                <Text style={styles.deletePinInputLabel}>Enter Confirmation PIN:</Text>
                <TextInput
                  style={[
                    styles.deletePinInput,
                    deletePinInput.trim() === deleteGeneratedPin && styles.deletePinInputSuccess,
                  ]}
                  placeholder="000000"
                  placeholderTextColor="#94A3B8"
                  value={deletePinInput}
                  onChangeText={(text) => setDeletePinInput(text.replace(/[^0-9]/g, ''))}
                  keyboardType="numeric"
                  maxLength={6}
                  editable={!isDeletingAccount}
                />
                {deletePinInput.trim().length === 6 && deletePinInput.trim() === deleteGeneratedPin ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 }}>
                    <MaterialIcons name="check-circle" size={14} color="#059669" />
                    <Text style={{ fontSize: 11.5, fontWeight: '700', color: '#059669' }}>
                      PIN matched. You can now proceed to permanently delete.
                    </Text>
                  </View>
                ) : deletePinInput.trim().length === 6 && deletePinInput.trim() !== deleteGeneratedPin ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 }}>
                    <MaterialIcons name="cancel" size={14} color="#DC2626" />
                    <Text style={{ fontSize: 11.5, fontWeight: '700', color: '#DC2626' }}>
                      PIN does not match the PIN written above.
                    </Text>
                  </View>
                ) : null}
              </View>

              {/* Action Buttons */}
              <View style={styles.deleteActionsRow}>
                <TouchableOpacity
                  style={styles.deleteCancelBtn}
                  onPress={() => {
                    setDeleteTargetUser(null);
                    setDeletePinInput('');
                  }}
                  disabled={isDeletingAccount}
                  activeOpacity={0.8}
                >
                  <Text style={styles.deleteCancelBtnText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.deleteConfirmBtn,
                    (isDeletingAccount || deletePinInput.trim() !== deleteGeneratedPin) && {
                      opacity: 0.5,
                      backgroundColor: "#94A3B8",
                      shadowOpacity: 0,
                    },
                  ]}
                  onPress={handleConfirmDelete}
                  disabled={isDeletingAccount || deletePinInput.trim() !== deleteGeneratedPin}
                  activeOpacity={0.85}
                >
                  {isDeletingAccount ? (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <ActivityIndicator size="small" color="#FFFFFF" />
                      <Text style={styles.deleteConfirmBtnText}>
                        Deleting Account…
                      </Text>
                    </View>
                  ) : (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <MaterialIcons name="delete" size={17} color="#FFFFFF" />
                      <Text style={styles.deleteConfirmBtnText}>
                        Permanently Delete
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* Driver Official QR Badge Modal */}
      {selectedDriverForQr && (
        <DriverQrBadgeModal
          visible={driverQrModalVisible}
          onClose={() => {
            setDriverQrModalVisible(false);
            setSelectedDriverForQr(null);
          }}
          driverData={selectedDriverForQr}
        />
      )}

      {/* Resident Validation Review Modal (CENRO Access - Hidden from Coordinators) */}
      {!isCoordinator && (
        <Modal
          visible={!!viewingIdUser}
          transparent
          animationType="fade"
          onRequestClose={() => setViewingIdUser(null)}
        >
          <View style={styles.verifyModalBackdrop}>
            <View style={styles.verifyModalCard}>
              <View style={styles.verifyModalHeader}>
                <View style={styles.verifyModalHeaderIconBadge}>
                  <MaterialIcons name="verified-user" size={24} color="#15803D" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.verifyModalTitle}>Resident Validation Review</Text>
                  <Text style={styles.verifyModalSub}>
                    Inspect proof of residency document submitted during account registration.
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.verifyModalCloseIconBtn}
                  onPress={() => setViewingIdUser(null)}
                  disabled={isVerifyingUser}
                >
                  <MaterialIcons name="close" size={20} color="#64748B" />
                </TouchableOpacity>
              </View>

              {viewingIdUser && (
                <ScrollView style={{ maxHeight: 520, padding: 20 }} showsVerticalScrollIndicator={false}>
                  {/* Resident Info Summary */}
                  <View style={styles.verifyUserInfoBox}>
                    <View style={styles.verifyUserInfoRow}>
                      <Text style={styles.verifyUserInfoName}>
                        {viewingIdUser.displayName || 'Unnamed Resident'}
                      </Text>
                      <View
                        style={[
                          styles.verifyPillBadge,
                          viewingIdUser.verificationStatus === 'verified'
                            ? (viewingIdUser.confirmedByCenro ? styles.verifyPillCenro : styles.verifyPillVerified)
                            : viewingIdUser.verificationStatus === 'rejected'
                            ? styles.verifyPillRejected
                            : styles.verifyPillPending,
                        ]}
                      >
                        <Text
                          style={[
                            styles.verifyPillText,
                            viewingIdUser.verificationStatus === 'verified'
                              ? (viewingIdUser.confirmedByCenro ? styles.verifyPillTextCenro : styles.verifyPillTextVerified)
                              : viewingIdUser.verificationStatus === 'rejected'
                              ? styles.verifyPillRejected
                              : styles.verifyPillPending,
                          ]}
                        >
                          {viewingIdUser.verificationStatus === 'verified'
                            ? (viewingIdUser.confirmedByCenro ? 'CONFIRMED BY CENRO' : 'ID VERIFIED')
                            : (viewingIdUser.verificationStatus || 'PENDING').toUpperCase()}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.verifyUserInfoEmail}>{viewingIdUser.email}</Text>
                    <Text style={styles.verifyUserInfoSector}>
                      Registered Sector: Brgy. {viewingIdUser.barangay || viewingIdUser.assignedBarangay || 'Unassigned'}
                    </Text>
                  </View>

                  {/* Document Metadata Details */}
                  <View style={styles.docMetadataCard}>
                    <View style={styles.docMetaRow}>
                      <Text style={styles.docMetaLabel}>DOCUMENT TYPE:</Text>
                      <Text style={styles.docMetaValue}>{viewingIdUser.verificationIdType || 'Barangay Certificate / ID'}</Text>
                    </View>
                    {viewingIdUser.verificationIdNumber ? (
                      <View style={styles.docMetaRow}>
                        <Text style={styles.docMetaLabel}>ID / REFERENCE NO.:</Text>
                        <Text style={styles.docMetaValue}>{viewingIdUser.verificationIdNumber}</Text>
                      </View>
                    ) : null}
                    {viewingIdUser.confirmedByCenro ? (
                      <View style={styles.docMetaRow}>
                        <Text style={styles.docMetaLabel}>CENRO CONFIRMATION:</Text>
                        <Text style={[styles.docMetaValue, { color: '#0D9488', fontWeight: '700' }]}>
                          Confirmed by CENRO ({viewingIdUser.cenroConfirmedBy || 'CENRO Officer'})
                        </Text>
                      </View>
                    ) : null}
                    {viewingIdUser.verifiedBy ? (
                      <View style={styles.docMetaRow}>
                        <Text style={styles.docMetaLabel}>VERIFIED BY:</Text>
                        <Text style={styles.docMetaValue}>{viewingIdUser.verifiedBy}</Text>
                      </View>
                    ) : null}
                    {viewingIdUser.rejectionReason ? (
                      <View style={styles.docMetaRow}>
                        <Text style={styles.docMetaLabel}>REJECTION REASON:</Text>
                        <Text style={[styles.docMetaValue, { color: '#DC2626' }]}>{viewingIdUser.rejectionReason}</Text>
                      </View>
                    ) : null}
                  </View>

                  {/* Uploaded Document Image */}
                  <View style={styles.docImageContainer}>
                    <Text style={styles.docImageHeader}>ATTACHED DOCUMENT / VALID ID PHOTO</Text>
                    {viewingIdUser.verificationImageUrl ? (
                      <Image
                        source={{ uri: viewingIdUser.verificationImageUrl }}
                        style={styles.fullDocImage}
                        resizeMode="contain"
                      />
                    ) : (
                      <View style={styles.noDocImageBox}>
                        <MaterialIcons name="image-not-supported" size={40} color="#94A3B8" />
                        <Text style={styles.noDocImageText}>No document image uploaded</Text>
                      </View>
                    )}
                  </View>

                  {/* If already verified, choices disappear! */}
                  {viewingIdUser.verificationStatus === 'verified' ? (
                    <View style={styles.verifiedStatusBannerCard}>
                      <View style={styles.verifiedStatusHeaderRow}>
                        <MaterialIcons
                          name="verified"
                          size={22}
                          color={viewingIdUser.confirmedByCenro ? "#0D9488" : "#059669"}
                        />
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.verifiedStatusTitle, viewingIdUser.confirmedByCenro && { color: '#0F766E' }]}>
                            {viewingIdUser.confirmedByCenro
                              ? 'Resident ID Verified • Confirmed by CENRO'
                              : 'Resident ID Officially Verified'}
                          </Text>
                          <Text style={styles.verifiedStatusSub}>
                            {viewingIdUser.confirmedByCenro
                              ? `Confirmed by CENRO (${viewingIdUser.cenroConfirmedBy || 'CENRO Office'}). Immediately registered and reflected on CICTO Oversight.`
                              : `Verified by ${viewingIdUser.verifiedBy || 'Administrator'}. Document review completed.`}
                          </Text>
                        </View>
                      </View>
                      <TouchableOpacity
                        style={[styles.verifyModalCloseBtn, viewingIdUser.confirmedByCenro && { backgroundColor: '#0D9488' }]}
                        onPress={() => setViewingIdUser(null)}
                        activeOpacity={0.8}
                      >
                        <MaterialIcons name="check" size={18} color="#FFFFFF" style={{ marginRight: 6 }} />
                        <Text style={styles.verifyModalCloseBtnText}>Close Review</Text>
                      </TouchableOpacity>
                    </View>
                  ) : viewingIdUser.verificationStatus === 'rejected' ? (
                    <View style={styles.rejectedStatusBannerCard}>
                      <View style={styles.rejectedStatusHeaderRow}>
                        <MaterialIcons name="cancel" size={22} color="#DC2626" />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.rejectedStatusTitle}>Document Rejected</Text>
                          <Text style={styles.rejectedStatusSub}>
                            {viewingIdUser.rejectionReason
                              ? `Reason: ${viewingIdUser.rejectionReason}`
                              : 'This submission does not verify residency. Resident must re-upload a valid ID.'}
                          </Text>
                        </View>
                      </View>
                      <TouchableOpacity
                        style={styles.verifyModalCloseBtnDark}
                        onPress={() => setViewingIdUser(null)}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.verifyModalCloseBtnText}>Close Review</Text>
                      </TouchableOpacity>
                    </View>
                  ) : isReadOnly ? (
                    <View style={styles.verifyModalReadOnlyBox}>
                      <MaterialIcons name="lock-outline" size={20} color="#92400E" />
                      <Text style={styles.verifyModalReadOnlyBoxText}>
                        Read-Only Mode: You may inspect submitted residency documents, but official confirmation and rejection actions are restricted.
                      </Text>
                      <TouchableOpacity
                        style={styles.verifyModalCloseBtnDark}
                        onPress={() => setViewingIdUser(null)}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.verifyModalCloseBtnText}>Close Review</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    /* CENRO Review Decision Actions: Confirm & Verify or Reject */
                    <View style={styles.verifyModalActionsRow}>
                      <TouchableOpacity
                        style={[styles.verifyBtnApprove, isVerifyingUser && { opacity: 0.6 }]}
                        onPress={() => handleCenroConfirmVerification(viewingIdUser)}
                        disabled={isVerifyingUser}
                        activeOpacity={0.8}
                      >
                        {isVerifyingUser ? (
                          <ActivityIndicator size="small" color="#FFFFFF" />
                        ) : (
                          <>
                            <MaterialIcons name="check-circle" size={18} color="#FFFFFF" style={{ marginRight: 6 }} />
                            <Text style={styles.verifyBtnApproveText}>Confirm & Verify Resident</Text>
                          </>
                        )}
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.verifyBtnReject, isVerifyingUser && { opacity: 0.6 }]}
                        onPress={() => handleCenroRejectVerification(viewingIdUser)}
                        disabled={isVerifyingUser}
                        activeOpacity={0.8}
                      >
                        <MaterialIcons name="cancel" size={18} color="#DC2626" style={{ marginRight: 6 }} />
                        <Text style={styles.verifyBtnRejectText}>Reject Document</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </ScrollView>
              )}
            </View>
          </View>
        </Modal>
      )}

      {/* Report Export Modal */}
      {/* Mobile / Native Barangay Filter Modal */}
      <Modal
        visible={isBarangayModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsBarangayModalOpen(false)}
      >
        <View style={styles.filterModalOverlay}>
          <View style={styles.filterModalCard}>
            <View style={styles.filterModalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <MaterialIcons name="location-city" size={20} color="#059669" />
                <Text style={styles.filterModalTitle}>Filter by Barangay</Text>
              </View>
              <TouchableOpacity
                onPress={() => setIsBarangayModalOpen(false)}
                style={styles.filterModalCloseBtn}
              >
                <MaterialIcons name="close" size={18} color="#64748B" />
              </TouchableOpacity>
            </View>

            <View style={styles.filterModalSearchBox}>
              <MaterialIcons name="search" size={18} color="#94A3B8" />
              <TextInput
                style={styles.filterModalSearchInput}
                placeholder="Search Danao City barangays..."
                placeholderTextColor="#94A3B8"
                value={barangaySearchQuery}
                onChangeText={setBarangaySearchQuery}
              />
              {barangaySearchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setBarangaySearchQuery("")}>
                  <MaterialIcons name="close" size={16} color="#94A3B8" />
                </TouchableOpacity>
              )}
            </View>

            <ScrollView style={{ maxHeight: 360 }}>
              <TouchableOpacity
                style={[
                  styles.barangayModalRow,
                  selectedBarangayFilter === 'all' && styles.barangayModalRowActive,
                ]}
                onPress={() => {
                  setSelectedBarangayFilter('all');
                  setIsBarangayModalOpen(false);
                }}
              >
                <Text
                  style={[
                    styles.barangayModalRowText,
                    selectedBarangayFilter === 'all' && styles.barangayModalRowTextActive,
                  ]}
                >
                  🏘️ All Barangays
                </Text>
                {selectedBarangayFilter === 'all' && (
                  <MaterialIcons name="check" size={18} color="#059669" />
                )}
              </TouchableOpacity>

              {barangayAccountCounts.unassigned > 0 && (
                <TouchableOpacity
                  style={[
                    styles.barangayModalRow,
                    selectedBarangayFilter === 'unassigned' && styles.barangayModalRowActive,
                  ]}
                  onPress={() => {
                    setSelectedBarangayFilter('unassigned');
                    setIsBarangayModalOpen(false);
                  }}
                >
                  <Text
                    style={[
                      styles.barangayModalRowText,
                      selectedBarangayFilter === 'unassigned' && styles.barangayModalRowTextActive,
                    ]}
                  >
                    ⚠️ No Barangay ({barangayAccountCounts.unassigned})
                  </Text>
                  {selectedBarangayFilter === 'unassigned' && (
                    <MaterialIcons name="check" size={18} color="#059669" />
                  )}
                </TouchableOpacity>
              )}

              {DANAO_CITY_BARANGAYS
                .filter(b => b.toLowerCase().includes(barangaySearchQuery.toLowerCase()))
                .map(b => {
                  const cnt = barangayAccountCounts.counts[b.toLowerCase()] || 0;
                  const isSelected = selectedBarangayFilter === b;
                  return (
                    <TouchableOpacity
                      key={b}
                      style={[
                        styles.barangayModalRow,
                        isSelected && styles.barangayModalRowActive,
                      ]}
                      onPress={() => {
                        setSelectedBarangayFilter(b);
                        setIsBarangayModalOpen(false);
                      }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text
                          style={[
                            styles.barangayModalRowText,
                            isSelected && styles.barangayModalRowTextActive,
                          ]}
                        >
                          Brgy. {b}
                        </Text>
                        {cnt > 0 && (
                          <View style={styles.barangayCountPill}>
                            <Text style={styles.barangayCountPillText}>{cnt}</Text>
                          </View>
                        )}
                      </View>
                      {isSelected && (
                        <MaterialIcons name="check" size={18} color="#059669" />
                      )}
                    </TouchableOpacity>
                  );
                })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <ExportModal
        visible={isExportModalVisible}
        onClose={() => setIsExportModalVisible(false)}
        title={
          activeTab === "driver"
            ? "Official Drivers Registry Report"
            : activeTab === "coordinator"
            ? "Environmental Coordinators Directory"
            : activeTab === "user"
            ? "Registered Residents Directory"
            : "Personnel and Resident Directory"
        }
        dataCount={sortedUsers.length}
        onExport={handleExport}
      />

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC", padding: 24 },
  readOnlyHeaderBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FEF3C7",
    borderColor: "#FCD34D",
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
    gap: 6,
  },
  readOnlyHeaderBadgeText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#92400E",
  },
  detailReadOnlyGovNotice: {
    backgroundColor: "#FEF3C7",
    borderColor: "#FCD34D",
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  detailReadOnlyGovText: {
    flex: 1,
    fontSize: 12,
    color: "#92400E",
    lineHeight: 18,
    fontWeight: "500",
  },
  verifyModalReadOnlyBox: {
    backgroundColor: "#FEF3C7",
    borderColor: "#FCD34D",
    borderWidth: 1,
    borderRadius: 10,
    padding: 16,
    flexDirection: "column",
    alignItems: "center",
    gap: 12,
    marginTop: 8,
  },
  verifyModalReadOnlyBoxText: {
    fontSize: 12,
    color: "#92400E",
    textAlign: "center",
    lineHeight: 18,
    fontWeight: "500",
  },
  headerSubtitle: {
    fontSize: 11,
    fontWeight: "800",
    color: "#059669",
    letterSpacing: 1,
    marginBottom: 4,
    textTransform: "uppercase",
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: "900",
    color: "#0F172A",
    marginBottom: 18,
  },

  subTabContainer: { flexDirection: "row", gap: 10, marginBottom: 18 },
  subTabBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "#E2E8F0",
  },
  subTabBtnActive: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1.5,
    borderColor: "#1B4D3E",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  subTabBtnText: { fontSize: 13, fontWeight: "700", color: "#64748B" },
  subTabBtnTextActive: { color: "#1B4D3E", fontWeight: "800" },

  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 20,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },

  controlsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  searchBox: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F1F5F9",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxWidth: 440,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  searchInput: { flex: 1, fontSize: 13, color: "#0F172A", padding: 0 },

  // CENRO Barangay Filter Styles
  barangaySelectWrapper: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 10,
    height: 38,
    minWidth: 180,
    position: "relative",
  },
  barangaySelectWrapperActive: {
    backgroundColor: "#ECFDF5",
    borderColor: "#A7F3D0",
  },
  barangaySelectText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#1E293B",
    marginLeft: 6,
    marginRight: 4,
    flex: 1,
  },
  barangaySelectTextActive: {
    color: "#065F46",
    fontWeight: "800",
  },
  clearBarangayBtn: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: "#ECFDF5",
    borderWidth: 1,
    borderColor: "#A7F3D0",
    alignItems: "center",
    justifyContent: "center",
  },
  activeFilterBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#ECFDF5",
    borderWidth: 1,
    borderColor: "#A7F3D0",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
  },
  activeFilterBannerText: {
    fontSize: 12.5,
    color: "#065F46",
  },
  clearFilterBannerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: "#D1FAE5",
  },
  clearFilterBannerBtnText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#065F46",
  },
  filterModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  filterModalCard: {
    width: "100%",
    maxWidth: 440,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 20,
    maxHeight: "85%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
  },
  filterModalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  filterModalTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#0F172A",
  },
  filterModalCloseBtn: {
    padding: 4,
    borderRadius: 6,
  },
  filterModalSearchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 12,
  },
  filterModalSearchInput: {
    flex: 1,
    fontSize: 13,
    color: "#0F172A",
    padding: 0,
  },
  barangayModalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 4,
  },
  barangayModalRowActive: {
    backgroundColor: "#ECFDF5",
  },
  barangayModalRowText: {
    fontSize: 13,
    color: "#334155",
    fontWeight: "600",
  },
  barangayModalRowTextActive: {
    color: "#065F46",
    fontWeight: "800",
  },
  barangayCountPill: {
    backgroundColor: "#E2E8F0",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
  },
  barangayCountPillText: {
    fontSize: 10,
    fontWeight: "800",
    color: "#475569",
  },

  roleFilterPills: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  rolePill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: "#CBD5E1",
  },
  rolePillActive: { backgroundColor: "#1B4D3E", borderColor: "#1B4D3E" },
  rolePillText: { fontSize: 11, fontWeight: "700", color: "#64748B" },
  rolePillTextActive: { color: "#FFFFFF" },

  tableHead: {
    flexDirection: "row",
    backgroundColor: "#F8FAFC",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 8,
    marginBottom: 6,
  },
  thBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  th: {
    fontSize: 10.5,
    fontWeight: "800",
    color: "#64748B",
    letterSpacing: 0.5,
  },
  thActive: { color: "#1B4D3E", fontWeight: "900" },
  tableRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
  },

  avatarBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#DCFCE7",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 12, fontWeight: "800", color: "#166534" },
  userName: { fontWeight: "800", color: "#0F172A", fontSize: 13.5 },
  userEmail: { color: "#64748B", fontSize: 11.5, marginTop: 1 },

  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  roleText: { fontSize: 10.5, fontWeight: "800", textTransform: "uppercase" },

  truckBadge: {
    backgroundColor: "#ECFDF5",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: "#A7F3D0",
  },
  truckBadgeText: { fontSize: 11, fontWeight: "700", color: "#047857" },

  actionEyeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#ECFDF5",
    borderWidth: 1,
    borderColor: "#A7F3D0",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  actionEyeText: { fontSize: 11.5, fontWeight: "800", color: "#1B4D3E" },

  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  modalCard: {
    width: "100%",
    maxWidth: 520,
    maxHeight: "90%",
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 8,
    overflow: "hidden",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 18,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
    backgroundColor: "#F8FAFC",
  },
  modalAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#DCFCE7",
    alignItems: "center",
    justifyContent: "center",
  },
  modalAvatarText: { fontSize: 14, fontWeight: "800", color: "#166534" },
  modalUserName: { fontSize: 15, fontWeight: "800", color: "#0F172A" },
  modalUserEmail: { fontSize: 12, color: "#64748B", marginTop: 1 },
  modalCloseBtn: { padding: 6, borderRadius: 6 },

  modalBody: { padding: 18 },
  modalSectionTitle: {
    fontSize: 11.5,
    fontWeight: "800",
    color: "#334155",
    letterSpacing: 0.5,
    marginBottom: 8,
    textTransform: "uppercase",
  },

  rolePickerRow: { flexDirection: "row", gap: 8, marginBottom: 16 },
  roleSelectBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  roleSelectBtnActive: { backgroundColor: "#1B4D3E", borderColor: "#1B4D3E" },
  roleSelectBtnText: { fontSize: 12, fontWeight: "700", color: "#475569" },
  roleSelectBtnTextActive: { color: "#FFFFFF" },

  fieldLabel: {
    fontSize: 10.5,
    fontWeight: "800",
    color: "#64748B",
    letterSpacing: 0.5,
    marginBottom: 4,
    textTransform: "uppercase",
  },
  modalInput: {
    backgroundColor: "#F8FAFC",
    borderWidth: 1.5,
    borderColor: "#E2E8F0",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 13,
    color: "#0F172A",
    marginBottom: 12,
  },

  modalDropdown: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderWidth: 1.5,
    borderColor: "#E2E8F0",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  modalDropdownText: { fontSize: 13, fontWeight: "600", color: "#0F172A" },
  modalDropdownMenu: {
    position: "absolute",
    top: 48,
    left: 0,
    right: 0,
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#E2E8F0",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 6,
    zIndex: 100,
  },
  modalDropdownItem: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
  },
  modalDropdownItemText: { fontSize: 12.5, color: "#334155" },

  roleSpecificBox: {
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
  },
  roleSpecificTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: "#1B4D3E",
    marginBottom: 10,
  },

  actionElevateBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ECFDF5",
    borderWidth: 1,
    borderColor: "#A7F3D0",
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    gap: 3,
  },
  actionElevateBtnText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#047857",
  },

  coordinatorJurisdictionBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F0FDF4",
    borderWidth: 1,
    borderColor: "#BBF7D0",
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
    gap: 10,
  },
  coordinatorJurisdictionTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: "#166534",
    letterSpacing: 0.5,
  },
  coordinatorJurisdictionSubtitle: {
    fontSize: 11.5,
    color: "#15803D",
    marginTop: 2,
  },
  coordinatorFilterToggle: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 6,
  },
  coordinatorFilterToggleActive: {
    backgroundColor: "#DCFCE7",
    borderColor: "#86EFAC",
  },
  coordinatorFilterToggleText: {
    fontSize: 11.5,
    fontWeight: "700",
    color: "#64748B",
  },
  coordinatorFilterToggleTextActive: {
    color: "#166534",
  },

  modalFooter: {
    padding: 14,
    borderTopWidth: 1,
    borderTopColor: "#F1F5F9",
    backgroundColor: "#F8FAFC",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    alignItems: "center",
  },
  modalElevateBtn: {
    flex: 1,
    minWidth: 140,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#059669",
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 10,
    shadowColor: "#059669",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  modalElevateBtnText: {
    fontSize: 12.5,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  modalElevateCoordBtn: {
    flex: 1,
    minWidth: 140,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0D9488",
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 10,
    shadowColor: "#0D9488",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  modalElevateCoordBtnText: {
    fontSize: 12.5,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  modalDegradeBtn: {
    flex: 1,
    minWidth: 150,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FEF2F2",
    borderWidth: 1.5,
    borderColor: "#FECACA",
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 10,
  },
  modalDegradeBtnText: {
    fontSize: 12.5,
    fontWeight: "800",
    color: "#DC2626",
  },
  modalCloseDoneBtn: {
    flex: 1,
    minWidth: 110,
    backgroundColor: "#1B4D3E",
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  modalCloseDoneBtnText: {
    fontSize: 12.5,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  detailRoleActionCard: {
    backgroundColor: "#F8FAFC",
    borderWidth: 1.5,
    borderColor: "#E2E8F0",
    borderRadius: 12,
    padding: 14,
    gap: 12,
    marginTop: 4,
  },
  detailRoleActionHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  detailRoleActionIconBadge: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "#F0FDFA",
    borderWidth: 1,
    borderColor: "#CCFBF1",
    alignItems: "center",
    justifyContent: "center",
  },
  detailRoleActionTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: "#0F172A",
    letterSpacing: 0.3,
  },
  detailRoleActionSub: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 2,
    lineHeight: 15,
  },
  detailRoleActionButtonsWrap: {
    gap: 8,
  },
  detailActionElevateBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#059669",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  detailActionElevateBtnText: {
    fontSize: 12.5,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  detailActionCoordBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#0D9488",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  detailActionCoordBtnText: {
    fontSize: 12.5,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  detailActionOffboardBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#FFFBEB",
    borderWidth: 1.5,
    borderColor: "#FDE68A",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  detailActionOffboardBtnText: {
    fontSize: 12.5,
    fontWeight: "800",
    color: "#B45309",
  },

  detailRoleStatusCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#F8FAFC",
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    marginBottom: 14,
  },
  activeStatusBadge: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
    gap: 6,
    backgroundColor: "#ECFDF5",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  activeDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#059669",
  },
  activeStatusText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#065F46",
  },
  detailInfoBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 10,
    padding: 12,
    gap: 12,
  },
  detailInfoIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  detailCardLabel: {
    fontSize: 10,
    fontWeight: "800",
    color: "#64748B",
    letterSpacing: 0.5,
    marginBottom: 2,
    textTransform: "uppercase",
  },
  detailCardValue: {
    fontSize: 13,
    fontWeight: "700",
    color: "#0F172A",
  },

  onboardBtn: {
    backgroundColor: "#1B4D3E",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    shadowColor: "#1B4D3E",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  onboardCoordBtn: {
    backgroundColor: "#0D9488",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    shadowColor: "#0D9488",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  onboardResidentBtn: {
    backgroundColor: "#2563EB",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    shadowColor: "#2563EB",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  onboardBtnText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },
  onboardModalContainer: {
    width: 900,
    maxWidth: "96%",
    height: "90%",
    maxHeight: 850,
    backgroundColor: "#F8FAFC",
    borderRadius: 16,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
  },
  editBarangayPillBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#E8F5E9",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 4,
    borderWidth: 1,
    borderColor: "#C8E6C9",
  },
  editBarangayPillText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#1B4D3E",
  },
  editCancelPillBtn: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  editCancelPillText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#64748B",
  },
  detailInfoBoxEditing: {
    backgroundColor: "#F0FDF4",
    borderColor: "#86EFAC",
    borderWidth: 1.5,
  },
  editDropdownTrigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  editDropdownTriggerText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#0F172A",
  },
  editDropdownMenu: {
    marginTop: 6,
    backgroundColor: "#FFFFFF",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 8,
  },
  editDropdownSearchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 6,
  },
  editDropdownSearchInput: {
    flex: 1,
    fontSize: 12,
    color: "#0F172A",
    paddingVertical: 2,
  },
  editDropdownItem: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
  },
  editDropdownItemSelected: {
    backgroundColor: "#DCFCE7",
  },
  editDropdownItemText: {
    fontSize: 12.5,
    color: "#334155",
  },
  takenBadgeMini: {
    backgroundColor: "#FEE2E2",
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  takenBadgeMiniText: {
    fontSize: 9,
    fontWeight: "700",
    color: "#991B1B",
  },
  scheduledBadgeMini: {
    backgroundColor: "#DCFCE7",
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  scheduledBadgeMiniText: {
    fontSize: 9,
    fontWeight: "700",
    color: "#166534",
  },
  editErrorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FECACA",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginTop: 8,
  },
  editErrorText: {
    flex: 1,
    fontSize: 11,
    fontWeight: "600",
    color: "#991B1B",
  },
  editSuccessBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 6,
  },
  editSuccessText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#059669",
  },
  editSaveBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#1B4D3E",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 7,
  },
  editSaveBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  editCancelBtn: {
    justifyContent: "center",
    backgroundColor: "#E2E8F0",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 7,
  },
  editCancelBtnText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#475569",
  },

  // Three Dots Action Button & Menu Styles
  moreActionBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    alignItems: "center",
    justifyContent: "center",
  },
  detailGovActionItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    borderWidth: 1.5,
    borderColor: "#E2E8F0",
    gap: 12,
  },
  detailGovActionItemWarning: {
    backgroundColor: "#FFFDF5",
    borderColor: "#FDE68A",
  },
  detailGovActionItemDanger: {
    backgroundColor: "#FEF2F2",
    borderColor: "#FECACA",
  },
  detailGovIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  detailGovItemTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: "#0F172A",
  },
  detailGovItemDesc: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 2,
    lineHeight: 14,
  },

  // CENRO Account Deletion Styles
  actionDeleteBtn: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FECACA",
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
  },
  detailActionDeleteBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#FEF2F2",
    borderWidth: 1.5,
    borderColor: "#FECACA",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  detailActionDeleteBtnText: {
    fontSize: 12.5,
    fontWeight: "800",
    color: "#DC2626",
  },
  modalDeleteBtn: {
    flex: 1,
    minWidth: 130,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FEF2F2",
    borderWidth: 1.5,
    borderColor: "#FECACA",
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 10,
  },
  modalDeleteBtnText: {
    fontSize: 12.5,
    fontWeight: "800",
    color: "#DC2626",
  },
  deleteModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.65)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  deleteModalCard: {
    width: 520,
    maxWidth: "96%",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
    elevation: 12,
  },
  deleteHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
    marginBottom: 18,
  },
  deleteHeaderIconBox: {
    width: 46,
    height: 46,
    borderRadius: 12,
    backgroundColor: "#FEE2E2",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#FECACA",
  },
  deleteModalTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#0F172A",
    letterSpacing: -0.2,
  },
  deleteModalSub: {
    fontSize: 12,
    color: "#64748B",
    marginTop: 2,
    lineHeight: 16,
  },
  deleteCloseBtn: {
    padding: 4,
  },
  deleteUserSummaryCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  deleteUserAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#E2E8F0",
    alignItems: "center",
    justifyContent: "center",
  },
  deleteUserAvatarText: {
    fontSize: 16,
    fontWeight: "800",
    color: "#475569",
  },
  deleteUserName: {
    fontSize: 14,
    fontWeight: "800",
    color: "#0F172A",
  },
  deleteUserEmail: {
    fontSize: 12,
    color: "#64748B",
    marginTop: 2,
  },
  deleteUserMeta: {
    fontSize: 11,
    fontWeight: "600",
    color: "#475569",
    marginTop: 2,
  },
  deleteWarningBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FECACA",
    borderRadius: 10,
    padding: 14,
    marginBottom: 20,
  },
  deleteWarningTitle: {
    fontSize: 12.5,
    fontWeight: "800",
    color: "#991B1B",
    marginBottom: 2,
  },
  deleteWarningText: {
    fontSize: 11.5,
    color: "#B91C1C",
    lineHeight: 16,
  },
  deleteActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 10,
  },
  deleteCancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 9,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
  },
  deleteCancelBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#475569",
  },
  deleteConfirmBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 9,
    backgroundColor: "#DC2626",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#DC2626",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  deleteConfirmBtnText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  deletePinCard: {
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#99F6E4',
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
    alignItems: 'center',
  },
  deletePinHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  deletePinTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F766E',
    letterSpacing: -0.2,
  },
  deletePinCode: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: 6,
    color: '#0F766E',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    marginVertical: 4,
  },
  deletePinHint: {
    fontSize: 11,
    color: '#115E59',
    textAlign: 'center',
    lineHeight: 15,
  },
  deletePinInputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 6,
  },
  deletePinInput: {
    letterSpacing: 4,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '800',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    color: '#0F172A',
  },
  deletePinInputSuccess: {
    borderColor: '#10B981',
    backgroundColor: '#F0FDF4',
    color: '#065F46',
  },
  qrBadgeActionBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "#F0FDF4",
    borderWidth: 1,
    borderColor: "#BBF7D0",
    alignItems: "center",
    justifyContent: "center",
  },
  modalQrBadgeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#059669",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginTop: 8,
    alignSelf: "flex-start",
  },
  modalQrBadgeBtnText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  // Resident ID Verification Styles
  verifyPillBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  verifyPillVerified: {
    backgroundColor: "#ECFDF5",
    borderColor: "#A7F3D0",
  },
  verifyPillCenro: {
    backgroundColor: "#F0FDFA",
    borderColor: "#99F6E4",
  },
  verifyPillRejected: {
    backgroundColor: "#FEF2F2",
    borderColor: "#FECACA",
  },
  verifyPillPending: {
    backgroundColor: "#FFFBEB",
    borderColor: "#FDE68A",
  },
  verifyPillUnsubmitted: {
    backgroundColor: "#F1F5F9",
    borderColor: "#E2E8F0",
  },
  verifyPillText: {
    fontSize: 9.5,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  verifyPillTextVerified: {
    color: "#059669",
  },
  verifyPillTextCenro: {
    color: "#0D9488",
  },
  verifyPillTextRejected: {
    color: "#DC2626",
  },
  verifyPillTextPending: {
    color: "#D97706",
  },
  verifyPillTextUnsubmitted: {
    color: "#64748B",
  },
  verifyModalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.75)",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  verifyModalCard: {
    width: "100%",
    maxWidth: 580,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
  },
  verifyModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 18,
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
    backgroundColor: "#FFFFFF",
  },
  verifyModalHeaderIconBadge: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: "#DCFCE7",
    borderWidth: 1,
    borderColor: "#BBF7D0",
    alignItems: "center",
    justifyContent: "center",
  },
  verifyModalTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#0F172A",
  },
  verifyModalSub: {
    fontSize: 12,
    color: "#64748B",
    marginTop: 2,
  },
  verifyModalCloseIconBtn: {
    padding: 6,
    borderRadius: 8,
  },
  verifyUserInfoBox: {
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  verifyUserInfoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  verifyUserInfoName: {
    fontSize: 14,
    fontWeight: "800",
    color: "#0F172A",
  },
  verifyUserInfoEmail: {
    fontSize: 12,
    color: "#475569",
    marginTop: 2,
  },
  verifyUserInfoSector: {
    fontSize: 11.5,
    fontWeight: "700",
    color: "#047857",
    marginTop: 4,
  },
  docMetadataCard: {
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    gap: 6,
  },
  docMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  docMetaLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#64748B",
  },
  docMetaValue: {
    fontSize: 12,
    fontWeight: "700",
    color: "#0F172A",
  },
  docImageContainer: {
    backgroundColor: "#0F172A",
    borderRadius: 12,
    padding: 10,
    marginBottom: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  docImageHeader: {
    fontSize: 10,
    fontWeight: "800",
    color: "#94A3B8",
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  fullDocImage: {
    width: "100%",
    height: 260,
    borderRadius: 8,
    backgroundColor: "#1E293B",
  },
  noDocImageBox: {
    height: 180,
    alignItems: "center",
    justifyContent: "center",
  },
  noDocImageText: {
    fontSize: 12,
    color: "#94A3B8",
    marginTop: 6,
    fontWeight: "600",
  },
  verifiedStatusBannerCard: {
    backgroundColor: "#F0FDF4",
    borderWidth: 1,
    borderColor: "#BBF7D0",
    borderRadius: 12,
    padding: 14,
    marginTop: 4,
    marginBottom: 10,
    gap: 12,
  },
  verifiedStatusHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  verifiedStatusTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: "#15803D",
  },
  verifiedStatusSub: {
    fontSize: 11.5,
    color: "#166534",
    marginTop: 2,
    lineHeight: 16,
  },
  rejectedStatusBannerCard: {
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FECACA",
    borderRadius: 12,
    padding: 14,
    marginTop: 4,
    marginBottom: 10,
    gap: 12,
  },
  rejectedStatusHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  rejectedStatusTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: "#DC2626",
  },
  rejectedStatusSub: {
    fontSize: 11.5,
    color: "#991B1B",
    marginTop: 2,
    lineHeight: 16,
  },
  verifyModalCloseBtn: {
    height: 40,
    borderRadius: 8,
    backgroundColor: "#15803D",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  verifyModalCloseBtnDark: {
    height: 40,
    borderRadius: 8,
    backgroundColor: "#475569",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  verifyModalCloseBtnText: {
    fontSize: 12.5,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  verifyModalActionsRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
    marginBottom: 10,
  },
  verifyBtnApprove: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    backgroundColor: "#15803D",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  verifyBtnApproveText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  verifyBtnReject: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FECACA",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  verifyBtnRejectText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#DC2626",
  },
  exportTopBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: "#A7F3D0",
    backgroundColor: "#ECFDF5",
  },
  exportTopBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#065F46",
  },
});

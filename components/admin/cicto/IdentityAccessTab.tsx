import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Modal,
  Alert,
  Platform,
  Image,
  useWindowDimensions,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import {
  collection,
  query,
  onSnapshot,
  doc,
  updateDoc,
  serverTimestamp,
  limit,
} from 'firebase/firestore';
import { auth, db } from '@/config/firebase';
import { provisionCenroOnSpark } from '@/services/cenroProvisioningService';
import { provisionCoordinatorOnSpark } from '@/services/coordinatorProvisioningService';
import {
  requestAccountDeletionOtp,
  confirmAccountDeletion,
  isUserInactive6Months,
  getInactivityDurationString,
  deactivateResidentAccount,
  reactivateResidentAccount,
  batchDeactivateStaleResidents,
} from '@/services/cictoAccountService';
import {
  HARDCODED_CICTO_ACCOUNT,
  isCictoEmail,
  ensureCictoProfileInFirestore,
} from '@/constants/cictoConfig';
import { DANAO_CITY_BARANGAYS } from '@/constants/danaoBarangays';
import ExportModal from '@/components/admin/cenro/ExportModal';
import { exportReport, ExportFormat } from '@/services/reportExportService';

interface UserData {
  id: string;
  email: string;
  displayName: string;
  name?: string;
  firstName?: string;
  middleInitial?: string;
  lastName?: string;
  photoURL?: string;
  role: string;
  verified: boolean;
  employeeId?: string;
  department?: string;
  agency?: string;
  designation?: string;
  phoneNumber?: string;
  contactInfo?: string;
  status?: string;
  disabled?: boolean;
  lastLogin?: any;
  createdAt?: any;
  barangay?: string;
  assignedBarangay?: string;
  location?: string;
  address?: string;
  barangayUpdatedAt?: any;
  verificationImageUrl?: string;
  verificationIdType?: string;
  verificationIdNumber?: string;
  verificationStatus?: 'pending' | 'verified' | 'rejected' | 'unsubmitted';
  verificationSubmittedAt?: any;
  verifiedAt?: any;
  verifiedBy?: string;
  confirmedByCenro?: boolean;
  cenroConfirmedBy?: string;
  cenroConfirmedAt?: any;
  rejectionReason?: string;
  privileges?: string[];
  permissions?: Record<string, boolean>;
  privilegesUpdatedAt?: any;
  privilegesUpdatedBy?: string;
}

export interface PrivilegeDefinition {
  id: string;
  name: string;
  description: string;
  category: 'operations' | 'telemetry' | 'governance' | 'reporting';
  icon: keyof typeof MaterialIcons.glyphMap;
}

export const SYSTEM_PRIVILEGES: PrivilegeDefinition[] = [
  {
    id: 'manage_schedules',
    name: 'Manage Collection Schedules',
    description: 'Create, edit, and publish barangay collection timetables and street stops.',
    category: 'operations',
    icon: 'calendar-today',
  },
  {
    id: 'dispatch_fleet',
    name: 'Fleet Dispatch & Routing',
    description: 'Assign trucks, approve emergency corridor deviations, and override routes.',
    category: 'operations',
    icon: 'local-shipping',
  },
  {
    id: 'view_telemetry',
    name: 'GPS Telemetry & Replay',
    description: 'Access real-time vehicle movement streams, trails, and recorded trip replays.',
    category: 'telemetry',
    icon: 'navigation',
  },
  {
    id: 'export_reports',
    name: 'Export Official Reports',
    description: 'Generate and download executive PDF audits, waste summaries, and Excel files.',
    category: 'reporting',
    icon: 'picture-as-pdf',
  },
  {
    id: 'manage_users',
    name: 'User & Identity Governance',
    description: 'Provision administrative accounts, assign privileges, and audit credentials.',
    category: 'governance',
    icon: 'admin-panel-settings',
  },
  {
    id: 'broadcast_alerts',
    name: 'Directives & Advisory Broadcast',
    description: 'Issue urgent city-wide environmental alerts and interagency command messages.',
    category: 'operations',
    icon: 'campaign',
  },
  {
    id: 'acknowledge_incidents',
    name: 'Incident Escalation & Review',
    description: 'Acknowledge citizen illegal dumping tickets and verify cleanup milestones.',
    category: 'governance',
    icon: 'assignment-turned-in',
  },
  {
    id: 'purge_records',
    name: 'Purge Diagnostic Logs',
    description: 'Clear expired telemetry trails, archive inactive tickets, and manage audit logs.',
    category: 'governance',
    icon: 'delete-sweep',
  },
];

const DEPARTMENT_PRIVILEGES: Record<string, string[]> = {
  'Waste Management Operations': ['manage_schedules', 'dispatch_fleet', 'view_telemetry', 'export_reports', 'broadcast_alerts', 'acknowledge_incidents'],
  'Environmental Quality Division': ['view_telemetry', 'export_reports', 'acknowledge_incidents', 'broadcast_alerts'],
  'Solid Waste Collection & Transport': ['manage_schedules', 'dispatch_fleet', 'view_telemetry', 'export_reports'],
  'Pollution Control & Monitoring': ['view_telemetry', 'export_reports', 'acknowledge_incidents'],
  'Natural Resources & Conservation': ['export_reports', 'acknowledge_incidents', 'broadcast_alerts'],
  'General Administration & Records': ['manage_schedules', 'export_reports', 'manage_users'],
};

const DESIGNATION_PRIVILEGES: Record<string, string[]> = {
  'CENRO Field Officer': ['manage_schedules', 'view_telemetry', 'acknowledge_incidents', 'export_reports', 'dispatch_fleet'],
  'Operations Head / Supervisor': ['manage_schedules', 'dispatch_fleet', 'view_telemetry', 'export_reports', 'broadcast_alerts', 'acknowledge_incidents'],
  'Logistics & Fleet Dispatcher': ['dispatch_fleet', 'view_telemetry', 'manage_schedules', 'export_reports'],
  'Environmental Inspector': ['view_telemetry', 'export_reports', 'acknowledge_incidents'],
  'Enforcement & Compliance Officer': ['acknowledge_incidents', 'broadcast_alerts', 'export_reports'],
  'Administrative Officer': ['manage_schedules', 'export_reports', 'manage_users'],
};

const hasReadPrivilege = (list: string[], id: string): boolean => {
  return list.includes(id) || list.includes(`${id}:read`) || list.includes(`${id}:write`);
};

const hasWritePrivilege = (list: string[], id: string): boolean => {
  if (list.includes(`${id}:write`)) return true;
  if (list.includes(`${id}:read`)) return false;
  return list.includes(id);
};

const toggleReadPrivilegeInList = (list: string[], id: string): string[] => {
  const currentlyRead = hasReadPrivilege(list, id);
  const filtered = list.filter((p) => p !== id && p !== `${id}:read` && p !== `${id}:write`);
  if (currentlyRead) {
    // Unchecking Read also unchecks Write (since Write requires Read)
    return filtered;
  }
  return [...filtered, `${id}:read`];
};

const toggleWritePrivilegeInList = (list: string[], id: string): string[] => {
  const currentlyWrite = hasWritePrivilege(list, id);
  const filtered = list.filter((p) => p !== id && p !== `${id}:read` && p !== `${id}:write`);
  if (currentlyWrite) {
    // Unchecking Write retains Read access
    return [...filtered, `${id}:read`];
  }
  // Checking Write requires both Read and Write
  return [...filtered, id, `${id}:read`, `${id}:write`];
};

const buildFullReadWritePrivileges = (ids: string[]): string[] => {
  const result: string[] = [];
  ids.forEach((id) => {
    result.push(id, `${id}:read`, `${id}:write`);
  });
  return result;
};

const buildReadOnlyPrivileges = (ids: string[]): string[] => {
  const result: string[] = [];
  ids.forEach((id) => {
    result.push(`${id}:read`);
  });
  return result;
};

const getProvisionPrivilegePreset = (department: string, designation: string) => {
  const departmentPrivileges = DEPARTMENT_PRIVILEGES[department] || [];
  const designationPrivileges = new Set(DESIGNATION_PRIVILEGES[designation] || []);
  const matchedIds = departmentPrivileges.filter((privilege) => designationPrivileges.has(privilege));
  return buildFullReadWritePrivileges(matchedIds);
};

const normalizeRoleFilter = (role?: string): string => {
  if (!role) return 'all';
  const clean = role.toLowerCase().trim();
  if (clean === 'resident' || clean === 'residents' || clean === 'user' || clean === 'users') return 'user';
  if (clean === 'driver' || clean === 'drivers') return 'driver';
  if (clean === 'coordinator' || clean === 'coordinators') return 'coordinator';
  if (clean === 'cenro' || clean === 'admin' || clean === 'admins') return 'admin';
  if (clean === 'cicto') return 'cicto';
  return clean;
};

export interface IdentityAccessTabProps {
  initialRoleFilter?: 'all' | 'user' | 'coordinator' | 'driver' | 'admin' | 'cicto' | string;
  initialStatusFilter?: string;
  initialSearchQuery?: string;
}

export default function IdentityAccessTab({
  initialRoleFilter = 'all',
  initialStatusFilter = 'all',
  initialSearchQuery = '',
}: IdentityAccessTabProps = {}) {
  const { width } = useWindowDimensions();
  const isMobile = width < 768;

  const [users, setUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(true);

  // Resident verification review modal state
  const [viewingIdUser, setViewingIdUser] = useState<UserData | null>(null);
  const [isVerifyingUser, setIsVerifyingUser] = useState(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery || '');
  const [roleFilter, setRoleFilter] = useState<string>(normalizeRoleFilter(initialRoleFilter));
  const [barangayFilter, setBarangayFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>(initialStatusFilter || 'all');
  const [isExportModalVisible, setIsExportModalVisible] = useState(false);

  useEffect(() => {
    if (initialRoleFilter) {
      setRoleFilter(normalizeRoleFilter(initialRoleFilter));
    }
  }, [initialRoleFilter]);

  useEffect(() => {
    if (initialStatusFilter) {
      setStatusFilter(initialStatusFilter);
    }
  }, [initialStatusFilter]);

  useEffect(() => {
    if (typeof initialSearchQuery === 'string') {
      setSearchQuery(initialSearchQuery);
    }
  }, [initialSearchQuery]);

  // Barangay dropdown state for filter bar
  const [isBarangayDropdownOpen, setIsBarangayDropdownOpen] = useState(false);
  const [barangayDropdownSearch, setBarangayDropdownSearch] = useState('');

  // Status dropdown state
  const [isStatusDropdownOpen, setIsStatusDropdownOpen] = useState(false);

  // Dropdown container ref for web click-outside detection
  const barangayFilterRef = useRef<View>(null);
  const statusFilterRef = useRef<View>(null);

  // Provision CENRO Modal states
  const [isCenroModalOpen, setIsCenroModalOpen] = useState(false);
  const [cenroEmail, setCenroEmail] = useState('');
  const [cenroPassword, setCenroPassword] = useState('');
  const [cenroDepartment, setCenroDepartment] = useState('Waste Management Operations');
  const [cenroDesignation, setCenroDesignation] = useState('CENRO Field Officer');
  const [cenroProvisionPrivileges, setCenroProvisionPrivileges] = useState<string[]>(() =>
    buildFullReadWritePrivileges(SYSTEM_PRIVILEGES.map((privilege) => privilege.id))
  );
  const [cenroContact, setCenroContact] = useState('');
  const [showCenroPassword, setShowCenroPassword] = useState(false);
  const [copiedPassword, setCopiedPassword] = useState(false);
  const [isSubmittingCenro, setIsSubmittingCenro] = useState(false);
  const [isDeptDropdownOpen, setIsDeptDropdownOpen] = useState(false);
  const [isDesigDropdownOpen, setIsDesigDropdownOpen] = useState(false);

  // Edit User / Assign Barangay Modal states
  const [isEditUserModalOpen, setIsEditUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserData | null>(null);
  const [selectedBarangayForUser, setSelectedBarangayForUser] = useState('');
  const [isUpdatingBarangay, setIsUpdatingBarangay] = useState(false);
  const [isEditModalBrgyDropdownOpen, setIsEditModalBrgyDropdownOpen] = useState(false);
  const [editModalBrgySearch, setEditModalBrgySearch] = useState('');

  // Batch action state
  const [isBatchDeactivating, setIsBatchDeactivating] = useState(false);

  // Deletion with OTP modal state
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [targetUserToDelete, setTargetUserToDelete] = useState<UserData | null>(null);
  const [deleteStep, setDeleteStep] = useState<'confirm' | 'otp'>('confirm');
  const [deleteOtpInput, setDeleteOtpInput] = useState('');
  const [deleteRequestId, setDeleteRequestId] = useState('');
  const [deleteGeneratedPin, setDeleteGeneratedPin] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Elevate Privileges Modal states
  const [isElevateModalOpen, setIsElevateModalOpen] = useState(false);
  const [targetUserToElevate, setTargetUserToElevate] = useState<UserData | null>(null);
  const [elevateTargetRole, setElevateTargetRole] = useState<'cenro' | 'coordinator' | 'mayor'>('cenro');
  const [elevateBarangay, setElevateBarangay] = useState('Poblacion');
  const [elevateEmployeeId, setElevateEmployeeId] = useState('');
  const [isElevateBrgyDropdownOpen, setIsElevateBrgyDropdownOpen] = useState(false);
  const [elevateBrgySearch, setElevateBrgySearch] = useState('');
  const [isSubmittingElevation, setIsSubmittingElevation] = useState(false);

  // Assign Privileges Modal states (Consultant Revision #12)
  const [isPrivilegesModalOpen, setIsPrivilegesModalOpen] = useState(false);
  const [privilegesUser, setPrivilegesUser] = useState<UserData | null>(null);
  const [selectedPrivileges, setSelectedPrivileges] = useState<string[]>([]);
  const [isSavingPrivileges, setIsSavingPrivileges] = useState(false);

  // Enterprise Action Menu Modal (Option B: Three Dots Menu)
  const [actionMenuUser, setActionMenuUser] = useState<UserData | null>(null);

  // Web click-outside listener for filter dropdowns (non-blocking)
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;

    const handleDocumentClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target) return;

      if (
        isBarangayDropdownOpen &&
        barangayFilterRef.current &&
        !(barangayFilterRef.current as any).contains?.(target)
      ) {
        setIsBarangayDropdownOpen(false);
      }

      if (
        isStatusDropdownOpen &&
        statusFilterRef.current &&
        !(statusFilterRef.current as any).contains?.(target)
      ) {
        setIsStatusDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleDocumentClick);
    return () => {
      document.removeEventListener('mousedown', handleDocumentClick);
    };
  }, [isBarangayDropdownOpen, isStatusDropdownOpen]);

  const CENRO_DEPARTMENTS = [
    'Waste Management Operations',
    'Environmental Quality Division',
    'Solid Waste Collection & Transport',
    'Pollution Control & Monitoring',
    'Natural Resources & Conservation',
    'General Administration & Records',
  ];

  const CENRO_DESIGNATIONS = [
    'CENRO Field Officer',
    'Operations Head / Supervisor',
    'Logistics & Fleet Dispatcher',
    'Environmental Inspector',
    'Enforcement & Compliance Officer',
    'Administrative Officer',
  ];

  const generateSecureTemporaryPassword = () => {
    const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const small = 'abcdefghijkmnpqrstuvwxyz';
    const nums = '23456789';
    const syms = '!@#$%';

    let p = 'CENRO-';
    p += letters.charAt(Math.floor(Math.random() * letters.length));
    p += small.charAt(Math.floor(Math.random() * small.length));
    p += nums.charAt(Math.floor(Math.random() * nums.length));
    p += syms.charAt(Math.floor(Math.random() * syms.length));
    const all = letters + small + nums;
    for (let i = 0; i < 4; i++) {
      p += all.charAt(Math.floor(Math.random() * all.length));
    }
    return p;
  };

  const handleOpenProvisionModal = () => {
    setCenroPassword(generateSecureTemporaryPassword());
    setCenroEmail('');
    setCenroProvisionPrivileges(buildFullReadWritePrivileges(SYSTEM_PRIVILEGES.map((privilege) => privilege.id)));
    setCopiedPassword(false);
    setIsCenroModalOpen(true);
  };

  const handleToggleCenroProvisionRead = (privilegeId: string) => {
    setCenroProvisionPrivileges((current) => toggleReadPrivilegeInList(current, privilegeId));
  };

  const handleToggleCenroProvisionWrite = (privilegeId: string) => {
    setCenroProvisionPrivileges((current) => toggleWritePrivilegeInList(current, privilegeId));
  };

  const handleCopyPassword = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(cenroPassword);
    }
    setCopiedPassword(true);
    setTimeout(() => setCopiedPassword(false), 2000);
  };

  const handleRegeneratePassword = () => {
    setCenroPassword(generateSecureTemporaryPassword());
    setCopiedPassword(false);
  };

  useEffect(() => {
    if (!db) return;
    setLoading(true);

    const q = query(collection(db, 'users'), limit(500));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        let list: UserData[] = snapshot.docs
          .map((docSnap) => ({
            id: docSnap.id,
            ...(docSnap.data() as any),
          }))
          .filter((u) => {
            if (u.role === 'dict') return false;
            // Defensive safeguard: Filter out empty phantom records that have no identity (no email, name, role, or contact)
            const hasIdentity = Boolean(u.email || u.displayName || u.name || u.role || u.phoneNumber || u.employeeId);
            return hasIdentity;
          });

        // Ensure the hardcoded CICTO master account appears in the directory even before first login
        const hasCicto = list.some((u) => u.role === 'cicto' || isCictoEmail(u.email));
        if (!hasCicto) {
          list = [
            {
              id: 'cicto-master-account',
              email: HARDCODED_CICTO_ACCOUNT.email,
              displayName: HARDCODED_CICTO_ACCOUNT.displayName,
              name: HARDCODED_CICTO_ACCOUNT.displayName,
              role: 'cicto',
              verified: true,
              employeeId: HARDCODED_CICTO_ACCOUNT.employeeId,
              department: HARDCODED_CICTO_ACCOUNT.department,
              agency: HARDCODED_CICTO_ACCOUNT.agency,
              designation: 'CICTO Super Administrator',
              barangay: 'CITY',
              assignedBarangay: 'CITY',
              status: 'active',
              disabled: false,
            },
            ...list,
          ];
        }

        setUsers(list);
        setLoading(false);
      },
      (err) => {
        console.warn('Users listener error:', err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  // Role classification helpers
  const isUserCoordinator = (u: UserData) =>
    u.role === 'coordinator' ||
    (Boolean(u.employeeId) && String(u.employeeId).toUpperCase().includes('COORD'));

  const isUserResident = (u: UserData) =>
    (u.role === 'user' || u.role === 'resident' || !u.role) && !isUserCoordinator(u);

  // Compute counts per role
  const roleCounts = useMemo(() => {
    const all = users.length;
    const residents = users.filter(isUserResident).length;
    const coordinators = users.filter(isUserCoordinator).length;
    const drivers = users.filter((u) => u.role === 'driver').length;
    const cenro = users.filter((u) => u.role === 'admin' || u.role === 'cenro').length;
    const cicto = users.filter((u) => u.role === 'cicto' || isCictoEmail(u.email)).length;
    return { all, residents, coordinators, drivers, cenro, cicto };
  }, [users]);

  // Map of taken barangays (lowercase) -> coordinator holding it
  const takenBarangaysMap = useMemo(() => {
    const map: Record<string, UserData> = {};
    users.forEach((u) => {
      if (isUserCoordinator(u)) {
        const brgy = (u.barangay || u.assignedBarangay || '').trim();
        if (brgy) {
          map[brgy.toLowerCase()] = u;
        }
      }
    });
    return map;
  }, [users]);

  // Check if a barangay is assigned to another coordinator (excluding the user currently being edited)
  const isBarangayAssignedToOther = (brgyName: string, excludeUserId?: string): UserData | null => {
    if (!brgyName || brgyName.trim().toUpperCase() === 'CITY') return null;
    const holder = takenBarangaysMap[brgyName.toLowerCase().trim()];
    if (!holder) return null;
    if (excludeUserId && holder.id === excludeUserId) {
      return null;
    }
    if (targetUserToElevate && holder.id === targetUserToElevate.id) {
      return null;
    }
    return holder;
  };

  // Compute counts per barangay (for Danao City barangays + CITY jurisdiction)
  const barangayCounts = useMemo(() => {
    const counts: Record<string, number> = { all: users.length, unassigned: 0, CITY: 0 };
    DANAO_CITY_BARANGAYS.forEach((b) => {
      counts[b] = 0;
    });

    users.forEach((u) => {
      const isCenroAdmin = u.role === 'admin' || u.role === 'cenro';
      const isProtected = u.role === 'cicto' || isCictoEmail(u.email);
      const isCoordinator = isUserCoordinator(u);
      let rawB = (u.barangay || u.assignedBarangay || '').trim();
      if (!rawB && (isCenroAdmin || isProtected || isCoordinator)) {
        rawB = 'CITY';
      } else if ((isCenroAdmin || isProtected) && rawB.toUpperCase() !== 'CITY') {
        rawB = 'CITY';
      }

      if (!rawB) {
        counts.unassigned += 1;
      } else if (rawB.toUpperCase() === 'CITY') {
        counts.CITY = (counts.CITY || 0) + 1;
      } else {
        const matched = DANAO_CITY_BARANGAYS.find(
          (dbName) => dbName.toLowerCase() === rawB.toLowerCase()
        );
        if (matched) {
          counts[matched] = (counts[matched] || 0) + 1;
        } else {
          counts[rawB] = (counts[rawB] || 0) + 1;
        }
      }
    });

    return counts;
  }, [users]);

  // Filtered list of 42 barangays for dropdown search
  const filteredBarangayList = useMemo(() => {
    const q = barangayDropdownSearch.trim().toLowerCase();
    if (!q) return DANAO_CITY_BARANGAYS;
    return DANAO_CITY_BARANGAYS.filter((b) => b.toLowerCase().includes(q));
  }, [barangayDropdownSearch]);

  // Filtered users
  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      const q = searchQuery.toLowerCase().trim();
      const isCenroAdmin = u.role === 'admin' || u.role === 'cenro';
      const isProtected = u.role === 'cicto' || isCictoEmail(u.email);
      const isCoordinator = isUserCoordinator(u);
      let userBarangay = (u.barangay || u.assignedBarangay || '').trim();
      if (!userBarangay && (isCenroAdmin || isProtected || isCoordinator)) {
        userBarangay = 'CITY';
      } else if ((isCenroAdmin || isProtected) && userBarangay.toUpperCase() !== 'CITY') {
        userBarangay = 'CITY';
      }

      const matchesSearch =
        !q ||
        u.email?.toLowerCase().includes(q) ||
        u.displayName?.toLowerCase().includes(q) ||
        u.employeeId?.toLowerCase().includes(q) ||
        u.phoneNumber?.toLowerCase().includes(q) ||
        userBarangay.toLowerCase().includes(q);

      const matchesRole =
        roleFilter === 'all' ||
        (roleFilter === 'cicto' && (u.role === 'cicto' || isCictoEmail(u.email))) ||
        (roleFilter === 'admin' && (u.role === 'admin' || u.role === 'cenro')) ||
        (roleFilter === 'coordinator' && isUserCoordinator(u)) ||
        (roleFilter === 'driver' && u.role === 'driver') ||
        (roleFilter === 'user' && isUserResident(u));

      const matchesBarangay =
        barangayFilter === 'all' ||
        (barangayFilter === 'unassigned' && !userBarangay) ||
        userBarangay.toLowerCase() === barangayFilter.toLowerCase();

      const isInactive = isUserInactive6Months(u) || u.disabled === true || u.status === 'inactive';
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active' && !isInactive) ||
        (statusFilter === 'inactive' && isInactive);

      return matchesSearch && matchesRole && matchesBarangay && matchesStatus;
    });
  }, [users, searchQuery, roleFilter, barangayFilter, statusFilter]);

  // Stale resident count
  const staleResidentCount = useMemo(() => {
    return users.filter(
      (u) =>
        isUserResident(u) &&
        u.disabled !== true &&
        u.status !== 'inactive' &&
        isUserInactive6Months(u)
    ).length;
  }, [users]);

  const handleResetFilters = () => {
    setSearchQuery('');
    setRoleFilter('all');
    setBarangayFilter('all');
    setStatusFilter('all');
    setIsBarangayDropdownOpen(false);
    setIsStatusDropdownOpen(false);
  };

  const handleExportUsers = async (format: ExportFormat) => {
    const headers = [
      'Name',
      'Email',
      'Role',
      'Barangay',
      'Contact Number',
      'Verification Status',
      'Account State',
      'Employee ID',
    ];

    const rows = filteredUsers.map((u) => {
      const isInactive = isUserInactive6Months(u) || u.disabled === true || u.status === 'inactive';
      const isVer = u.verified || u.verificationStatus === 'verified';
      return [
        u.displayName || u.name || 'Resident',
        u.email || 'N/A',
        (u.role || 'user').toUpperCase(),
        u.barangay || u.assignedBarangay || 'Unassigned',
        u.phoneNumber || u.contactInfo || 'N/A',
        isVer ? 'VERIFIED' : (u.verificationStatus ? u.verificationStatus.toUpperCase() : 'UNVERIFIED'),
        isInactive ? 'INACTIVE' : 'ACTIVE',
        u.employeeId || 'N/A',
      ];
    });

    const scopeTitle =
      barangayFilter !== 'all'
        ? `Brgy. ${barangayFilter}`
        : 'City of Danao (All 42 Barangays)';

    await exportReport({
      format,
      filename: `cicto_identity_directory_${new Date().toISOString().slice(0, 10)}`,
      title: 'Municipal Identity & Access Directory Report',
      subtitle: 'City Information and Communications Technology Office (CICTO) Master Registry',
      jurisdiction: scopeTitle,
      generatedBy: 'CICTO Super Administrator',
      headers,
      rows,
      summaryCards: [
        { label: 'Total Users In View', value: filteredUsers.length },
        { label: 'Active Role Filter', value: roleFilter.toUpperCase() },
        { label: 'Barangay Scope', value: barangayFilter.toUpperCase() },
        { label: 'Status Filter', value: statusFilter.toUpperCase() },
      ],
      sheetName: 'Identity_Directory',
    });
  };

  const handleApproveVerification = async (userToVerify: UserData) => {
    if (!db || !userToVerify) return;
    setIsVerifyingUser(true);
    try {
      const userRef = doc(db, 'users', userToVerify.id);
      await updateDoc(userRef, {
        verificationStatus: 'verified',
        verified: true,
        verifiedAt: serverTimestamp(),
        verifiedBy: auth?.currentUser?.email || 'CICTO Administrator',
        updatedAt: serverTimestamp(),
      });
      Alert.alert(
        'Resident Verified',
        `${userToVerify.displayName || userToVerify.email} has been officially verified as a Danao City resident.`
      );
      setViewingIdUser(null);
    } catch (err) {
      console.error('Error approving verification:', err);
      Alert.alert('Error', 'Failed to approve resident verification.');
    } finally {
      setIsVerifyingUser(false);
    }
  };

  const handleRejectVerification = async (userToReject: UserData, reason: string = 'Document does not verify Danao City address') => {
    if (!db || !userToReject) return;
    setIsVerifyingUser(true);
    try {
      const userRef = doc(db, 'users', userToReject.id);
      await updateDoc(userRef, {
        verificationStatus: 'rejected',
        rejectionReason: reason,
        updatedAt: serverTimestamp(),
      });
      Alert.alert(
        'Verification Rejected',
        `Verification document for ${userToReject.displayName || userToReject.email} has been marked as rejected.`
      );
      setViewingIdUser(null);
    } catch (err) {
      console.error('Error rejecting verification:', err);
      Alert.alert('Error', 'Failed to update verification status.');
    } finally {
      setIsVerifyingUser(false);
    }
  };

  const handleOpenEditUser = (user: UserData) => {
    setEditingUser(user);
    const isCenroOrCicto = user.role === 'admin' || user.role === 'cenro' || user.role === 'cicto' || isCictoEmail(user.email);
    const isCoord = isUserCoordinator(user);
    let initialB = (user.barangay || user.assignedBarangay || '').trim();
    if (!initialB && (isCenroOrCicto || isCoord)) {
      initialB = 'CITY';
    } else if (isCenroOrCicto && initialB.toUpperCase() !== 'CITY') {
      initialB = 'CITY';
    }
    setSelectedBarangayForUser(initialB);
    setIsEditModalBrgyDropdownOpen(false);
    setEditModalBrgySearch('');
    setIsEditUserModalOpen(true);
  };

  const handleSaveUserBarangay = async () => {
    if (!editingUser || !db) return;
    setIsUpdatingBarangay(true);
    const cleanBarangay = selectedBarangayForUser.trim();
    const prevBarangay = (editingUser.barangay || editingUser.assignedBarangay || '').trim();

    try {
      // If user is a coordinator and selecting a non-empty barangay, check if another coordinator holds it
      if (isUserCoordinator(editingUser) && cleanBarangay) {
        const conflictingCoord = isBarangayAssignedToOther(cleanBarangay, editingUser.id);
        if (conflictingCoord) {
          Alert.alert(
            'Barangay Already Assigned',
            `Cannot assign coordinator: Brgy. ${cleanBarangay} already has an active coordinator (${conflictingCoord.displayName || conflictingCoord.email}${conflictingCoord.employeeId ? `, ID: ${conflictingCoord.employeeId}` : ''}).\n\nDanao City policy strictly permits only 1 coordinator per barangay.`
          );
          setIsUpdatingBarangay(false);
          return;
        }
      }

      const userRef = doc(db, 'users', editingUser.id);
      await updateDoc(userRef, {
        barangay: cleanBarangay,
        assignedBarangay: cleanBarangay,
        barangayUpdatedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // If coordinator, maintain coordinator barangay locks
      if (isUserCoordinator(editingUser)) {
        try {
          const { setDoc: setFirestoreDoc, deleteDoc: delDoc } = await import('firebase/firestore');
          // Release previous barangay lock if it changed
          if (prevBarangay && prevBarangay.toLowerCase() !== cleanBarangay.toLowerCase()) {
            const oldKey = prevBarangay.toLowerCase().replace(/[^a-z0-9]/g, '_');
            const oldLockRef = doc(db, 'identifiers', 'coordinator_barangays', 'items', oldKey);
            await delDoc(oldLockRef).catch(() => undefined);
          }

          // If new barangay is set, create the new barangay lock
          if (cleanBarangay) {
            const newKey = cleanBarangay.toLowerCase().replace(/[^a-z0-9]/g, '_');
            const newLockRef = doc(db, 'identifiers', 'coordinator_barangays', 'items', newKey);
            await setFirestoreDoc(
              newLockRef,
              {
                barangay: cleanBarangay,
                userId: editingUser.id,
                fullName: editingUser.displayName || editingUser.name || editingUser.email,
                employeeId: editingUser.employeeId || '',
                assignedAt: serverTimestamp(),
              },
              { merge: true }
            );
          }

          // If coordinator has employeeId, update coordinator identifier document
          if (editingUser.employeeId) {
            const coordIdRef = doc(db, 'identifiers', 'coordinator', 'items', editingUser.employeeId);
            await updateDoc(coordIdRef, {
              barangay: cleanBarangay,
              assignedAt: serverTimestamp(),
            }).catch(() => undefined);
          }
        } catch (coordLockErr) {
          console.warn('Coordinator lock sync note:', coordLockErr);
        }
      }

      // Optimistically update local users state
      setUsers((prev) =>
        prev.map((u) =>
          u.id === editingUser.id
            ? { ...u, barangay: cleanBarangay, assignedBarangay: cleanBarangay }
            : u
        )
      );

      // Audit trail entry
      try {
        const { addDoc } = await import('firebase/firestore');
        await addDoc(collection(db, 'client_activity'), {
          event: cleanBarangay ? 'user.barangay_reassigned' : 'user.barangay_unassigned',
          targetType: 'user',
          targetId: editingUser.id,
          actorEmail: auth.currentUser?.email || 'cicto@trashtrack.gov.ph',
          metadata: {
            previousBarangay: prevBarangay || 'Unassigned',
            newBarangay: cleanBarangay || 'Unassigned',
            userEmail: editingUser.email,
          },
          createdAt: serverTimestamp(),
        });
      } catch {}

      setIsEditUserModalOpen(false);
      Alert.alert(
        cleanBarangay ? 'Barangay Updated' : 'Barangay Cleared (Unassigned)',
        cleanBarangay
          ? `Registered sector for ${editingUser.displayName || editingUser.email} updated to Brgy. ${cleanBarangay}.`
          : `Sector cleared. Account for ${editingUser.displayName || editingUser.email} is now Unassigned.`
      );
    } catch (err: any) {
      Alert.alert('Update Failed', err?.message || 'Failed to update barangay preference.');
    } finally {
      setIsUpdatingBarangay(false);
    }
  };

  const handleOpenPrivilegesModal = (user: UserData) => {
    setPrivilegesUser(user);
    if (user.privileges !== undefined && Array.isArray(user.privileges)) {
      setSelectedPrivileges(user.privileges);
    } else {
      // Default privileges based on user role (only for legacy accounts where privileges field is missing)
      if (user.role === 'cicto' || user.role === 'admin' || user.role === 'cenro') {
        setSelectedPrivileges(buildFullReadWritePrivileges(SYSTEM_PRIVILEGES.map(p => p.id)));
      } else if (user.role === 'coordinator') {
        setSelectedPrivileges(buildFullReadWritePrivileges(['manage_schedules', 'view_telemetry', 'acknowledge_incidents', 'export_reports']));
      } else if (user.role === 'driver') {
        setSelectedPrivileges(buildReadOnlyPrivileges(['view_telemetry']));
      } else {
        setSelectedPrivileges([]);
      }
    }
    setIsPrivilegesModalOpen(true);
  };

  const handleTogglePrivilegeRead = (privilegeId: string) => {
    setSelectedPrivileges(prev => toggleReadPrivilegeInList(prev, privilegeId));
  };

  const handleTogglePrivilegeWrite = (privilegeId: string) => {
    setSelectedPrivileges(prev => toggleWritePrivilegeInList(prev, privilegeId));
  };

  const handleApplyPrivilegePreset = (preset: 'all' | 'field' | 'auditor' | 'clear') => {
    if (preset === 'all') {
      setSelectedPrivileges(buildFullReadWritePrivileges(SYSTEM_PRIVILEGES.map(p => p.id)));
    } else if (preset === 'field') {
      setSelectedPrivileges(buildFullReadWritePrivileges(['manage_schedules', 'dispatch_fleet', 'view_telemetry', 'acknowledge_incidents']));
    } else if (preset === 'auditor') {
      setSelectedPrivileges(buildReadOnlyPrivileges(SYSTEM_PRIVILEGES.map(p => p.id)));
    } else {
      setSelectedPrivileges([]);
    }
  };

  const handleSavePrivileges = async () => {
    if (!privilegesUser || !db) return;
    setIsSavingPrivileges(true);

    try {
      const userRef = doc(db, 'users', privilegesUser.id);
      await updateDoc(userRef, {
        privileges: selectedPrivileges,
        privilegesUpdatedAt: serverTimestamp(),
        privilegesUpdatedBy: auth.currentUser?.email || HARDCODED_CICTO_ACCOUNT.email,
        updatedAt: serverTimestamp(),
      });

      // Optimistically update local users state
      setUsers(prev => prev.map(u => u.id === privilegesUser.id ? { ...u, privileges: selectedPrivileges } : u));

      const grantedCount = SYSTEM_PRIVILEGES.filter(p => hasReadPrivilege(selectedPrivileges, p.id)).length;
      Alert.alert(
        'Privileges Assigned Successfully',
        `Operational privileges for ${privilegesUser.displayName || privilegesUser.email} have been updated (${grantedCount} privileges granted).`
      );
      setIsPrivilegesModalOpen(false);
    } catch (err: any) {
      console.error('Failed to update privileges:', err);
      Alert.alert('Privilege Update Failed', err?.message || 'Could not save privileges to database.');
    } finally {
      setIsSavingPrivileges(false);
    }
  };

  const handleToggleResidentStatus = async (user: UserData) => {
    if (user.role === 'cicto' || (user.email && isCictoEmail(user.email))) {
      Alert.alert('Protected Account', 'CICTO Super Administrator accounts cannot be modified or paused.');
      return;
    }
    const isInactive = isUserInactive6Months(user) || user.disabled === true || user.status === 'inactive';
    try {
      if (isInactive) {
        const res = await reactivateResidentAccount(user.id, user.email);
        setUsers((prev) =>
          prev.map((u) =>
            u.id === user.id ? { ...u, disabled: false, status: 'active' } : u
          )
        );
        Alert.alert('Reactivated', res.message);
      } else {
        const res = await deactivateResidentAccount(user.id, user.email, 'Admin Manual Directive');
        setUsers((prev) =>
          prev.map((u) =>
            u.id === user.id ? { ...u, disabled: true, status: 'inactive' } : u
          )
        );
        Alert.alert('Account Paused', res.message);
      }
    } catch (err: any) {
      Alert.alert('Action Failed', err?.message || 'Failed to toggle account status.');
    }
  };

  const handleBatchDeactivateStale = async () => {
    if (staleResidentCount === 0) {
      Alert.alert('Directory Up to Date', 'No active residents found with >= 6 months of inactivity.');
      return;
    }

    Alert.alert(
      'Batch Deactivate Stale Residents',
      `Found ${staleResidentCount} resident account(s) with >= 6 months of inactivity. Do you want to deactivate them now?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: `Deactivate (${staleResidentCount})`,
          style: 'destructive',
          onPress: async () => {
            setIsBatchDeactivating(true);
            try {
              const res = await batchDeactivateStaleResidents(users);
              Alert.alert('Batch Complete', `Successfully deactivated ${res.count} stale resident account(s).`);
            } catch (err: any) {
              Alert.alert('Batch Failed', err?.message || 'Failed to batch deactivate.');
            } finally {
              setIsBatchDeactivating(false);
            }
          },
        },
      ]
    );
  };

  const handleOpenDelete = (user: UserData) => {
    if (user.role === 'cicto' || (user.email && isCictoEmail(user.email))) {
      Alert.alert('Protected Account', 'CICTO Super Administrator accounts cannot be deleted.');
      return;
    }
    setTargetUserToDelete(user);
    setDeleteStep('confirm');
    setDeleteOtpInput('');
    setDeleteRequestId('');
    setDeleteGeneratedPin(null);
    setDeleteModalVisible(true);
  };

  const handleRequestDeletionOtp = async () => {
    if (!targetUserToDelete) return;
    setIsDeleting(true);
    try {
      const res = await requestAccountDeletionOtp(targetUserToDelete);
      setDeleteRequestId(res.requestId);
      setDeleteGeneratedPin(res.otpPin);
      setDeleteStep('otp');
      Alert.alert(
        'Authorization PIN Generated',
        `Your 6-digit authorization PIN is:\n\n${res.otpPin}\n\nPlease enter this PIN below to confirm deletion.`
      );
    } catch (err: any) {
      Alert.alert('PIN Generation Failed', err?.message || 'Could not generate deletion PIN.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleConfirmDeletion = async () => {
    if (!targetUserToDelete || !deleteRequestId || !deleteOtpInput.trim()) {
      Alert.alert('Validation Error', 'Please enter the 6-digit authorization PIN.');
      return;
    }
    setIsDeleting(true);
    try {
      const res = await confirmAccountDeletion({
        requestId: deleteRequestId,
        pin: deleteOtpInput.trim(),
        targetUid: targetUserToDelete.id,
        targetEmail: targetUserToDelete.email,
      });
      setDeleteModalVisible(false);
      Alert.alert('Account Deleted', res.message);
    } catch (err: any) {
      Alert.alert('Deletion Failed', err?.message || 'Invalid authorization PIN or error deleting account.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleOpenElevateModal = (targetUser: UserData) => {
    if (targetUser.role === 'cicto' || (targetUser.email && isCictoEmail(targetUser.email))) {
      Alert.alert('Protected Account', 'CICTO Super Administrator already holds maximum municipal governance authority.');
      return;
    }
    setTargetUserToElevate(targetUser);
    setElevateTargetRole('cenro');
    const userBrgy = (targetUser.barangay || targetUser.assignedBarangay || '').trim();

    // Check if user's current barangay is held by another coordinator
    const holder = userBrgy ? takenBarangaysMap[userBrgy.toLowerCase()] : null;
    const isTakenByOther = holder && holder.id !== targetUser.id;

    if (userBrgy && !isTakenByOther) {
      setElevateBarangay(userBrgy);
    } else {
      // Find first available Danao City barangay not held by another coordinator
      const available = DANAO_CITY_BARANGAYS.find((b) => {
        const h = takenBarangaysMap[b.toLowerCase()];
        return !h || h.id === targetUser.id;
      });
      setElevateBarangay(available || userBrgy || 'Poblacion');
    }

    setElevateEmployeeId(
      targetUser.employeeId || `CENRO-${Math.floor(1000 + Math.random() * 9000)}`
    );
    setIsElevateBrgyDropdownOpen(false);
    setElevateBrgySearch('');
    setIsElevateModalOpen(true);
  };

  const handleElevateToCenro = (targetUser: UserData) => {
    handleOpenElevateModal(targetUser);
  };

  const handleSelectElevateRole = (role: 'cenro' | 'coordinator' | 'mayor') => {
    setElevateTargetRole(role);
    if (role === 'mayor') {
      setElevateEmployeeId(targetUserToElevate?.employeeId || `MAYOR-${Math.floor(100 + Math.random() * 900)}`);
    } else if (role === 'cenro') {
      if (!elevateEmployeeId || elevateEmployeeId.startsWith('CENRO-COORD-')) {
        setElevateEmployeeId(
          targetUserToElevate?.employeeId?.startsWith('CENRO-') && !targetUserToElevate?.employeeId?.includes('COORD')
            ? targetUserToElevate.employeeId
            : `CENRO-${Math.floor(1000 + Math.random() * 9000)}`
        );
      }
    } else {
      if (!elevateEmployeeId || (!elevateEmployeeId.includes('COORD') && elevateEmployeeId.startsWith('CENRO-'))) {
        setElevateEmployeeId(
          targetUserToElevate?.employeeId?.includes('COORD')
            ? targetUserToElevate.employeeId
            : `CENRO-COORD-${Math.floor(100 + Math.random() * 900)}`
        );
      }
    }
  };

  const handleConfirmElevation = async () => {
    if (!targetUserToElevate) return;
    setIsSubmittingElevation(true);
    const email = (targetUserToElevate.email || '').trim().toLowerCase();
    const displayName = targetUserToElevate.displayName || targetUserToElevate.name || 'Municipal Officer';

    try {
      if (auth.currentUser && isCictoEmail(auth.currentUser.email)) {
        await ensureCictoProfileInFirestore(auth.currentUser.uid, auth.currentUser.email);
      }

      if (elevateTargetRole === 'cenro') {
        const empId = elevateEmployeeId.trim() || `CENRO-${Math.floor(1000 + Math.random() * 9000)}`;
        await provisionCenroOnSpark({
          mode: 'upgrade',
          existingUserId: targetUserToElevate.id,
          email,
          fullName: displayName,
          contactInfo: targetUserToElevate.contactInfo || '',
          employeeId: empId,
          department: 'City Environment and Natural Resources Office (CENRO Danao)',
          designation: 'CENRO Field Officer',
        });
        setIsElevateModalOpen(false);
        Alert.alert(
          'Account Elevated',
          `Successfully elevated ${email || displayName} to CENRO Municipal Admin (Employee ID: ${empId}). They can now sign in at /admin/login.`
        );
      } else if (elevateTargetRole === 'mayor') {
        await updateDoc(doc(db, 'users', targetUserToElevate.id), {
          role: 'mayor',
          department: "Office of the Mayor",
          designation: 'Mayor’s Office Representative',
          employeeId: elevateEmployeeId.trim() || `MAYOR-${Math.floor(100 + Math.random() * 900)}`,
          privileges: ['broadcast_alerts', 'mayor_interagency_only'],
          privilegesUpdatedAt: serverTimestamp(),
          privilegesUpdatedBy: auth.currentUser?.email || HARDCODED_CICTO_ACCOUNT.email,
          status: 'active',
          disabled: false,
          updatedAt: serverTimestamp(),
        });
        setIsElevateModalOpen(false);
        Alert.alert('Mayor’s Office Access Assigned', `${email || displayName} can sign in at /admin/login to coordinate interagency group chats.`);
      } else {
        const brgy = elevateBarangay.trim();
        if (!brgy) {
          Alert.alert('Validation Error', 'Please select an assigned barangay sector.');
          setIsSubmittingElevation(false);
          return;
        }

        const empId = elevateEmployeeId.trim() || `CENRO-COORD-${Math.floor(100 + Math.random() * 900)}`;

        const doProvisionCoordinator = async () => {
          setIsSubmittingElevation(true);
          try {
            await provisionCoordinatorOnSpark({
              mode: 'upgrade',
              existingUserId: targetUserToElevate.id,
              email,
              fullName: displayName,
              contactInfo: targetUserToElevate.contactInfo || '',
              employeeId: empId,
              barangay: brgy,
              zone: 'Sector 1',
            });
            setIsElevateModalOpen(false);
            Alert.alert(
              'Role Updated',
              `Successfully updated ${email || displayName} to Barangay Environmental Coordinator for Brgy. ${brgy} (Employee ID: ${empId}). They can now sign in at /admin/login.`
            );
          } catch (coordErr: any) {
            Alert.alert('Elevation Failed', coordErr?.message || 'Failed to update coordinator role.');
          } finally {
            setIsSubmittingElevation(false);
          }
        };

        const otherCoordinator = isBarangayAssignedToOther(brgy);
        if (otherCoordinator) {
          Alert.alert(
            'Reassign Barangay Sector',
            `Brgy. ${brgy} is currently assigned to ${otherCoordinator.displayName || otherCoordinator.email}${otherCoordinator.employeeId ? ` (${otherCoordinator.employeeId})` : ''}.\n\nDo you want to reassign this sector and transfer jurisdiction to ${displayName}?`,
            [
              { text: 'Cancel', style: 'cancel', onPress: () => setIsSubmittingElevation(false) },
              { text: 'Reassign Sector', style: 'destructive', onPress: doProvisionCoordinator },
            ]
          );
          return;
        }

        await doProvisionCoordinator();
      }
    } catch (err: any) {
      Alert.alert('Elevation Failed', err?.message || 'Failed to elevate user privileges.');
    } finally {
      setIsSubmittingElevation(false);
    }
  };

  const handleProvisionCenro = async () => {
    if (!cenroEmail.trim() || !cenroPassword.trim()) {
      Alert.alert('Validation Error', 'Email and password are required.');
      return;
    }
    setIsSubmittingCenro(true);
    try {
      if (auth.currentUser && isCictoEmail(auth.currentUser.email)) {
        await ensureCictoProfileInFirestore(auth.currentUser.uid, auth.currentUser.email);
      }
      const normEmail = cenroEmail.trim().toLowerCase();
      const matchedUser = users.find(
        (u) => (u.email || '').toLowerCase().trim() === normEmail
      );
      const targetEmpId = matchedUser?.employeeId || `CENRO-${Math.floor(1000 + Math.random() * 9000)}`;

      await provisionCenroOnSpark({
        mode: matchedUser ? 'upgrade' : 'create',
        existingUserId: matchedUser ? matchedUser.id : undefined,
        email: normEmail,
        password: cenroPassword.trim(),
        fullName: matchedUser?.displayName || matchedUser?.name || 'CENRO Administrator',
        contactInfo: cenroContact.trim() ? `+63 ${cenroContact.trim()}` : (matchedUser?.contactInfo || ''),
        employeeId: targetEmpId,
        department: cenroDepartment,
        designation: cenroDesignation,
        privileges: cenroProvisionPrivileges,
      });
      setIsCenroModalOpen(false);
      setCenroEmail('');
      setCenroPassword('');
      Alert.alert(
        'Success',
        matchedUser
          ? `Existing account ${normEmail} has been elevated to CENRO Admin (Employee ID: ${targetEmpId}). They can log in immediately at /admin/login.`
          : `CENRO Admin account provisioned for ${normEmail} (Employee ID: ${targetEmpId}).`
      );
    } catch (err: any) {
      Alert.alert('Provisioning Error', err?.message || 'Failed to provision CENRO account.');
    } finally {
      setIsSubmittingCenro(false);
    }
  };

  const hasActiveFilters =
    searchQuery.trim() !== '' ||
    roleFilter !== 'all' ||
    barangayFilter !== 'all' ||
    statusFilter !== 'all';

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <View style={styles.eyebrowRow}>
            <MaterialIcons name="security" size={14} color="#0D9488" />
            <Text style={styles.eyebrow}>CICTO / USER GOVERNANCE & ACCESS CONTROL</Text>
          </View>
          <Text style={styles.title}>Identity & Access Management</Text>
          <Text style={styles.sub}>
            Super-administrative oversight across 42 Danao City barangays, resident directory life-cycle, and municipal role governance.
          </Text>
        </View>

        <View style={styles.headerActions}>
          {staleResidentCount > 0 && (
            <TouchableOpacity
              style={styles.staleCleanBtn}
              onPress={handleBatchDeactivateStale}
              disabled={isBatchDeactivating}
              activeOpacity={0.8}
            >
              <MaterialIcons name="auto-fix-high" size={16} color="#DC2626" />
              <Text style={styles.staleCleanBtnText}>
                {isBatchDeactivating ? 'Cleaning...' : `Deactivate Stale (${staleResidentCount})`}
              </Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.exportBtn}
            onPress={() => setIsExportModalVisible(true)}
            activeOpacity={0.8}
          >
            <MaterialIcons name="file-download" size={18} color="#FFFFFF" />
            <Text style={styles.exportBtnText}>Export</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.provisionBtn}
            onPress={handleOpenProvisionModal}
            activeOpacity={0.8}
          >
            <MaterialIcons name="person-add" size={18} color="#FFFFFF" />
            <Text style={styles.provisionBtnText}>Provision CENRO Admin</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Filter and Search Bar */}
      <View style={[styles.filterSection, (isBarangayDropdownOpen || isStatusDropdownOpen) && { zIndex: 9999, elevation: 9999 }]}>
        {/* Top Filter Controls: Search + 42-Barangay Dropdown + Status Selector */}
        <View style={[styles.filterBar, (isBarangayDropdownOpen || isStatusDropdownOpen) && { zIndex: 9999, elevation: 9999 }]}>
          {/* General Search Input */}
          <View style={styles.searchBox}>
            <MaterialIcons name="search" size={18} color="#94A3B8" />
            <TextInput
              style={styles.searchInput}
              placeholder="Search by name, email, employee ID, or barangay..."
              placeholderTextColor="#94A3B8"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {searchQuery.trim() !== '' && (
              <TouchableOpacity onPress={() => setSearchQuery('')} style={{ padding: 4 }}>
                <MaterialIcons name="close" size={16} color="#94A3B8" />
              </TouchableOpacity>
            )}
          </View>

          {/* Searchable 42-Barangay Filter Dropdown */}
          <View
            ref={barangayFilterRef}
            style={[styles.dropdownContainer, { zIndex: isBarangayDropdownOpen ? 10000 : 20, elevation: isBarangayDropdownOpen ? 10000 : 20 }]}
          >
            <TouchableOpacity
              style={[
                styles.filterDropdownBtn,
                barangayFilter !== 'all' && styles.filterDropdownBtnActive,
                isBarangayDropdownOpen && styles.filterDropdownBtnOpen,
              ]}
              onPress={() => {
                setIsBarangayDropdownOpen(!isBarangayDropdownOpen);
                setIsStatusDropdownOpen(false);
              }}
              activeOpacity={0.8}
            >
              <View style={styles.dropdownBtnInner}>
                <MaterialIcons
                  name="location-on"
                  size={16}
                  color={barangayFilter !== 'all' ? '#0D9488' : '#64748B'}
                />
                <Text
                  style={[
                    styles.filterDropdownText,
                    barangayFilter !== 'all' && styles.filterDropdownTextActive,
                  ]}
                  numberOfLines={1}
                >
                  {barangayFilter === 'all'
                    ? `All Barangays (42)`
                    : barangayFilter === 'unassigned'
                    ? `Unassigned (${barangayCounts.unassigned || 0})`
                    : `${barangayFilter} (${barangayCounts[barangayFilter] || 0})`}
                </Text>
              </View>
              <MaterialIcons
                name={isBarangayDropdownOpen ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
                size={18}
                color={barangayFilter !== 'all' ? '#0D9488' : '#64748B'}
              />
            </TouchableOpacity>

            {/* Dropdown Menu with Search inside for 42 Barangays */}
            {isBarangayDropdownOpen && (
              <View style={styles.barangayDropdownMenu}>
                {/* Search Bar inside Barangay Dropdown */}
                <View style={styles.dropdownSearchBox}>
                  <MaterialIcons name="search" size={16} color="#0D9488" />
                  <TextInput
                    style={styles.dropdownSearchInput}
                    placeholder="Search 42 barangays..."
                    placeholderTextColor="#94A3B8"
                    value={barangayDropdownSearch}
                    onChangeText={setBarangayDropdownSearch}
                    autoFocus
                  />
                  {barangayDropdownSearch.trim() !== '' && (
                    <TouchableOpacity onPress={() => setBarangayDropdownSearch('')}>
                      <MaterialIcons name="close" size={14} color="#94A3B8" />
                    </TouchableOpacity>
                  )}
                </View>

                {/* Scrollable list of 42 barangays */}
                <ScrollView
                  style={styles.barangayDropdownScroll}
                  contentContainerStyle={{ flexGrow: 1, paddingBottom: 8 }}
                  nestedScrollEnabled={true}
                  showsVerticalScrollIndicator={true}
                  keyboardShouldPersistTaps="handled"
                >
                  {/* Option: All Barangays */}
                  <TouchableOpacity
                    style={[
                      styles.barangayDropdownItem,
                      barangayFilter === 'all' && styles.barangayDropdownItemSelected,
                    ]}
                    onPress={() => {
                      setBarangayFilter('all');
                      setIsBarangayDropdownOpen(false);
                      setBarangayDropdownSearch('');
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                      <MaterialIcons
                        name="public"
                        size={16}
                        color={barangayFilter === 'all' ? '#0D9488' : '#64748B'}
                      />
                      <Text
                        style={[
                          styles.barangayDropdownItemText,
                          barangayFilter === 'all' && styles.barangayDropdownItemTextSelected,
                        ]}
                      >
                        All 42 Barangays
                      </Text>
                    </View>
                    <View style={styles.countBadge}>
                      <Text style={styles.countBadgeText}>{users.length}</Text>
                    </View>
                  </TouchableOpacity>

                  {/* Option: Unassigned */}
                  <TouchableOpacity
                    style={[
                      styles.barangayDropdownItem,
                      barangayFilter === 'unassigned' && styles.barangayDropdownItemSelected,
                    ]}
                    onPress={() => {
                      setBarangayFilter('unassigned');
                      setIsBarangayDropdownOpen(false);
                      setBarangayDropdownSearch('');
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                      <MaterialIcons
                        name="help-outline"
                        size={16}
                        color={barangayFilter === 'unassigned' ? '#0D9488' : '#64748B'}
                      />
                      <Text
                        style={[
                          styles.barangayDropdownItemText,
                          barangayFilter === 'unassigned' && styles.barangayDropdownItemTextSelected,
                        ]}
                      >
                        Unassigned / Not Set
                      </Text>
                    </View>
                    <View style={[styles.countBadge, { backgroundColor: '#F1F5F9' }]}>
                      <Text style={styles.countBadgeText}>{barangayCounts.unassigned || 0}</Text>
                    </View>
                  </TouchableOpacity>

                  <View style={styles.dropdownDivider} />

                  {/* CITY (City-Wide Jurisdiction) */}
                  <TouchableOpacity
                    style={[
                      styles.barangayDropdownItem,
                      barangayFilter.toUpperCase() === 'CITY' && styles.barangayDropdownItemSelected,
                      { backgroundColor: barangayFilter.toUpperCase() === 'CITY' ? '#F0FDFA' : undefined },
                    ]}
                    onPress={() => {
                      setBarangayFilter('CITY');
                      setIsBarangayDropdownOpen(false);
                      setBarangayDropdownSearch('');
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                      <MaterialIcons
                        name="location-city"
                        size={15}
                        color={barangayFilter.toUpperCase() === 'CITY' ? '#0D9488' : '#0F766E'}
                      />
                      <Text
                        style={[
                          styles.barangayDropdownItemText,
                          barangayFilter.toUpperCase() === 'CITY' && styles.barangayDropdownItemTextSelected,
                          { fontWeight: '700' },
                        ]}
                      >
                        CITY (City-Wide Jurisdiction)
                      </Text>
                    </View>
                    <View style={[styles.countBadge, { backgroundColor: '#CCFBF1' }]}>
                      <Text style={[styles.countBadgeText, { color: '#0F766E', fontWeight: '800' }]}>
                        {barangayCounts.CITY || 0}
                      </Text>
                    </View>
                  </TouchableOpacity>

                  <View style={styles.dropdownDivider} />

                  {/* 42 Danao City Barangays */}
                  {filteredBarangayList.map((bName) => {
                    const isSelected = barangayFilter.toLowerCase() === bName.toLowerCase();
                    const count = barangayCounts[bName] || 0;

                    return (
                      <TouchableOpacity
                        key={bName}
                        style={[
                          styles.barangayDropdownItem,
                          isSelected && styles.barangayDropdownItemSelected,
                        ]}
                        onPress={() => {
                          setBarangayFilter(bName);
                          setIsBarangayDropdownOpen(false);
                          setBarangayDropdownSearch('');
                        }}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                          <MaterialIcons
                            name="location-on"
                            size={15}
                            color={isSelected ? '#0D9488' : '#94A3B8'}
                          />
                          <Text
                            style={[
                              styles.barangayDropdownItemText,
                              isSelected && styles.barangayDropdownItemTextSelected,
                            ]}
                          >
                            {bName}
                          </Text>
                        </View>
                        <View
                          style={[
                            styles.countBadge,
                            count > 0 && { backgroundColor: isSelected ? '#0D9488' : '#CCFBF1' },
                          ]}
                        >
                          <Text
                            style={[
                              styles.countBadgeText,
                              count > 0 && { color: isSelected ? '#FFFFFF' : '#0F766E', fontWeight: '800' },
                            ]}
                          >
                            {count}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}

                  {filteredBarangayList.length === 0 && (
                    <Text style={styles.noDropdownMatchText}>No barangays match &quot;{barangayDropdownSearch}&quot;.</Text>
                  )}
                </ScrollView>
              </View>
            )}
          </View>

          {/* Status Filter Dropdown */}
          <View
            ref={statusFilterRef}
            style={[styles.dropdownContainer, { zIndex: isStatusDropdownOpen ? 10000 : 15, elevation: isStatusDropdownOpen ? 10000 : 15 }]}
          >
            <TouchableOpacity
              style={[
                styles.filterDropdownBtn,
                statusFilter !== 'all' && styles.filterDropdownBtnActive,
                isStatusDropdownOpen && styles.filterDropdownBtnOpen,
              ]}
              onPress={() => {
                setIsStatusDropdownOpen(!isStatusDropdownOpen);
                setIsBarangayDropdownOpen(false);
              }}
              activeOpacity={0.8}
            >
              <View style={styles.dropdownBtnInner}>
                <MaterialIcons
                  name="filter-alt"
                  size={16}
                  color={statusFilter !== 'all' ? '#0D9488' : '#64748B'}
                />
                <Text
                  style={[
                    styles.filterDropdownText,
                    statusFilter !== 'all' && styles.filterDropdownTextActive,
                  ]}
                >
                  {statusFilter === 'all'
                    ? 'All Statuses'
                    : statusFilter === 'active'
                    ? 'Active Only'
                    : 'Inactive (6+ Mo)'}
                </Text>
              </View>
              <MaterialIcons
                name={isStatusDropdownOpen ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
                size={18}
                color={statusFilter !== 'all' ? '#0D9488' : '#64748B'}
              />
            </TouchableOpacity>

            {isStatusDropdownOpen && (
              <View style={[styles.barangayDropdownMenu, { width: 170 }]}>
                {[
                  { id: 'all', label: 'All Statuses', icon: 'list' },
                  { id: 'active', label: 'Active Only', icon: 'check-circle' },
                  { id: 'inactive', label: 'Inactive (6+ Mo)', icon: 'pause-circle-filled' },
                ].map((s) => (
                  <TouchableOpacity
                    key={s.id}
                    style={[
                      styles.barangayDropdownItem,
                      statusFilter === s.id && styles.barangayDropdownItemSelected,
                    ]}
                    onPress={() => {
                      setStatusFilter(s.id);
                      setIsStatusDropdownOpen(false);
                    }}
                  >
                    <MaterialIcons
                      name={s.icon as any}
                      size={15}
                      color={statusFilter === s.id ? '#0D9488' : '#64748B'}
                    />
                    <Text
                      style={[
                        styles.barangayDropdownItemText,
                        statusFilter === s.id && styles.barangayDropdownItemTextSelected,
                      ]}
                    >
                      {s.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        </View>

        {/* Role Tabs Row */}
        <View style={styles.roleTabsRow}>
          <View style={styles.filterGroup}>
            {[
              { id: 'all', label: 'ALL', count: roleCounts.all },
              { id: 'user', label: 'RESIDENTS', count: roleCounts.residents },
              { id: 'coordinator', label: 'COORDINATORS', count: roleCounts.coordinators },
              { id: 'driver', label: 'DRIVERS', count: roleCounts.drivers },
              { id: 'admin', label: 'CENRO', count: roleCounts.cenro },
              { id: 'cicto', label: 'CICTO', count: roleCounts.cicto },
            ].map((r) => {
              const isActive = roleFilter === r.id;
              return (
                <TouchableOpacity
                  key={r.id}
                  style={[styles.filterChip, isActive && styles.filterChipActive]}
                  onPress={() => setRoleFilter(r.id)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.filterChipText, isActive && styles.filterChipTextActive]}>
                    {r.label}
                  </Text>
                  <View
                    style={[
                      styles.roleChipBadge,
                      isActive && styles.roleChipBadgeActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.roleChipBadgeText,
                        isActive && styles.roleChipBadgeTextActive,
                      ]}
                    >
                      {r.count}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Active Filter Summary Bar */}
        {hasActiveFilters && (
          <View style={styles.activeFilterBar}>
            <View style={styles.activeFilterTags}>
              <Text style={styles.activeFilterLabel}>FILTERING:</Text>
              {roleFilter !== 'all' && (
                <View style={styles.activeTag}>
                  <Text style={styles.activeTagText}>
                    Role: {roleFilter === 'user' ? 'Residents' : roleFilter === 'coordinator' ? 'Coordinators' : roleFilter.toUpperCase()}
                  </Text>
                  <TouchableOpacity onPress={() => setRoleFilter('all')}>
                    <MaterialIcons name="close" size={13} color="#0F766E" />
                  </TouchableOpacity>
                </View>
              )}
              {barangayFilter !== 'all' && (
                <View style={styles.activeTag}>
                  <Text style={styles.activeTagText}>
                    Barangay: {barangayFilter === 'unassigned' ? 'Unassigned' : barangayFilter.toUpperCase() === 'CITY' ? 'CITY (City-Wide)' : barangayFilter}
                  </Text>
                  <TouchableOpacity onPress={() => setBarangayFilter('all')}>
                    <MaterialIcons name="close" size={13} color="#0F766E" />
                  </TouchableOpacity>
                </View>
              )}
              {statusFilter !== 'all' && (
                <View style={styles.activeTag}>
                  <Text style={styles.activeTagText}>
                    Status: {statusFilter.toUpperCase()}
                  </Text>
                  <TouchableOpacity onPress={() => setStatusFilter('all')}>
                    <MaterialIcons name="close" size={13} color="#0F766E" />
                  </TouchableOpacity>
                </View>
              )}
              {searchQuery.trim() !== '' && (
                <View style={styles.activeTag}>
                  <Text style={styles.activeTagText}>Search: &quot;{searchQuery}&quot;</Text>
                  <TouchableOpacity onPress={() => setSearchQuery('')}>
                    <MaterialIcons name="close" size={13} color="#0F766E" />
                  </TouchableOpacity>
                </View>
              )}
            </View>

            <TouchableOpacity style={styles.clearAllBtn} onPress={handleResetFilters}>
              <MaterialIcons name="refresh" size={14} color="#64748B" />
              <Text style={styles.clearAllBtnText}>Reset All</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Directory Summary Counter */}
      <View style={styles.resultsSummaryRow}>
        <Text style={styles.resultsSummaryText}>
          Showing <Text style={{ fontWeight: '800', color: '#0F172A' }}>{filteredUsers.length}</Text> of{' '}
          <Text style={{ fontWeight: '800', color: '#0F172A' }}>{users.length}</Text> total accounts
          {barangayFilter !== 'all' && ` in Brgy. ${barangayFilter}`}
        </Text>
      </View>

      {/* Users Table */}
      <View style={styles.tableCard}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ minWidth: '100%' }}>
          <View style={{ minWidth: 700, flex: 1 }}>
            <View style={styles.tableHead}>
              <Text style={[styles.th, { flex: 1, minWidth: 200 }]}>USER / CONTACT</Text>
              <Text style={[styles.th, { width: 135, flexShrink: 0 }]}>BARANGAY</Text>
              <Text style={[styles.th, { width: 110, flexShrink: 0 }]}>ROLE</Text>
              <Text style={[styles.th, { width: 110, flexShrink: 0 }]}>STATUS</Text>
              <Text style={[styles.th, { width: 80, flexShrink: 0, textAlign: 'center' }]}>ACTIONS</Text>
            </View>

            {loading ? (
              <View style={styles.loaderContainer}>
                <ActivityIndicator size="large" color="#0D9488" />
                <Text style={styles.loaderText}>Loading identity directory...</Text>
              </View>
            ) : filteredUsers.length === 0 ? (
              <View style={styles.emptyContainer}>
                <MaterialIcons name="person-search" size={48} color="#CBD5E1" />
                <Text style={styles.emptyTitle}>No matching accounts found</Text>
                <Text style={styles.emptySub}>
                  Try clearing your filters or selecting a different barangay sector.
                </Text>
                {hasActiveFilters && (
                  <TouchableOpacity style={styles.emptyResetBtn} onPress={handleResetFilters}>
                    <Text style={styles.emptyResetBtnText}>Reset Filters</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              filteredUsers.map((user) => {
                const isProtected = user.role === 'cicto' || isCictoEmail(user.email);
                const isInactive = isUserInactive6Months(user) || user.disabled === true || user.status === 'inactive';
                const isCenroAdmin = user.role === 'admin' || user.role === 'cenro';
                const isCoordinator = isUserCoordinator(user);
                const isResident = isUserResident(user);
                let userBarangay = (user.barangay || user.assignedBarangay || '').trim();
                if (!userBarangay && (isCenroAdmin || isProtected || isCoordinator)) {
                  userBarangay = 'CITY';
                } else if ((isCenroAdmin || isProtected) && userBarangay.toUpperCase() !== 'CITY') {
                  userBarangay = 'CITY';
                }
                const isCityScope = userBarangay.toUpperCase() === 'CITY';

                return (
                  <View key={user.id} style={styles.tableRow}>
                    {/* User / Email / Contact Info */}
                    <View style={[styles.userCell, { flex: 1, minWidth: 200 }]}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <View style={[styles.userAvatar, isProtected && styles.userAvatarCicto, { overflow: 'hidden' }]}>
                          {(user.photoURL || user.verificationImageUrl) ? (
                            <Image
                              source={{ uri: user.photoURL || user.verificationImageUrl }}
                              style={{ width: '100%', height: '100%' }}
                              resizeMode="cover"
                            />
                          ) : (
                            <Text style={[styles.userAvatarText, isProtected && styles.userAvatarTextCicto]}>
                              {(user.displayName || user.email || 'U').charAt(0).toUpperCase()}
                            </Text>
                          )}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.userName} numberOfLines={1}>
                            {user.displayName || user.email?.split('@')[0]}
                          </Text>
                          <Text style={styles.userEmail} numberOfLines={1}>
                            {user.email}
                          </Text>
                        </View>
                      </View>

                      <View style={styles.userSubInfoRow}>
                        {Boolean(user.employeeId) && (
                          <View style={styles.empIdBadge}>
                            <Text style={styles.empIdBadgeText}>ID: {user.employeeId}</Text>
                          </View>
                        )}
                        {Boolean(user.phoneNumber) && (
                          <Text style={styles.phoneText}>📞 {user.phoneNumber}</Text>
                        )}
                        {Boolean(isResident) && (
                          <TouchableOpacity
                            style={[
                              styles.verifyPillBadge,
                              user.verificationStatus === 'verified'
                                ? (user.confirmedByCenro ? styles.verifyPillCenro : styles.verifyPillVerified)
                                : user.verificationStatus === 'rejected'
                                ? styles.verifyPillRejected
                                : user.verificationImageUrl
                                ? styles.verifyPillPending
                                : styles.verifyPillUnsubmitted,
                            ]}
                            onPress={() => {
                              if (user.verificationImageUrl || user.verificationStatus === 'verified' || user.verificationStatus === 'rejected') {
                                setViewingIdUser(user);
                              }
                            }}
                            activeOpacity={user.verificationImageUrl || user.verificationStatus === 'verified' || user.verificationStatus === 'rejected' ? 0.7 : 1}
                          >
                            <MaterialIcons
                              name={
                                user.verificationStatus === 'verified'
                                  ? 'verified'
                                  : user.verificationStatus === 'rejected'
                                  ? 'cancel'
                                  : user.verificationImageUrl
                                  ? 'pending'
                                  : 'help-outline'
                              }
                              size={12}
                              color={
                                user.verificationStatus === 'verified'
                                  ? (user.confirmedByCenro ? '#0D9488' : '#059669')
                                  : user.verificationStatus === 'rejected'
                                  ? '#DC2626'
                                  : user.verificationImageUrl
                                  ? '#D97706'
                                  : '#64748B'
                              }
                            />
                            <Text
                              style={[
                                styles.verifyPillText,
                                user.verificationStatus === 'verified'
                                  ? (user.confirmedByCenro ? styles.verifyPillTextCenro : styles.verifyPillTextVerified)
                                  : user.verificationStatus === 'rejected'
                                  ? styles.verifyPillTextRejected
                                  : user.verificationImageUrl
                                  ? styles.verifyPillTextPending
                                  : styles.verifyPillTextUnsubmitted,
                              ]}
                            >
                              {user.verificationStatus === 'verified'
                                ? (user.confirmedByCenro ? 'CONFIRMED BY CENRO' : 'ID VERIFIED')
                                : user.verificationStatus === 'rejected'
                                ? 'ID REJECTED'
                                : user.verificationImageUrl
                                ? 'REVIEW ID'
                                : 'NO ID'}
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>

                    {/* Barangay Badge */}
                    <View style={{ width: 135, flexShrink: 0 }}>
                      {userBarangay ? (
                        <TouchableOpacity
                          style={[
                            styles.barangayBadge,
                            isCityScope && styles.barangayCityBadge,
                          ]}
                          onPress={() => setBarangayFilter(userBarangay)}
                          activeOpacity={0.7}
                        >
                          <MaterialIcons
                            name={isCityScope ? "location-city" : "location-on"}
                            size={13}
                            color={isCityScope ? "#0F766E" : "#0D9488"}
                          />
                          <Text
                            style={[
                              styles.barangayBadgeText,
                              isCityScope && styles.barangayCityBadgeText,
                            ]}
                            numberOfLines={1}
                          >
                            {userBarangay}
                          </Text>
                        </TouchableOpacity>
                      ) : (
                        <View style={styles.barangayUnassignedBadge}>
                          <MaterialIcons name="help-outline" size={12} color="#94A3B8" />
                          <Text style={styles.barangayUnassignedText}>Unassigned</Text>
                        </View>
                      )}
                    </View>

                    {/* Role Badge */}
                    <View style={{ width: 110, flexShrink: 0 }}>
                      <View
                        style={[
                          styles.roleBadge,
                          isProtected
                            ? styles.roleBadgeCicto
                            : isCenroAdmin
                            ? styles.roleBadgeAdmin
                            : isCoordinator
                            ? styles.roleBadgeCoordinator
                            : user.role === 'driver'
                            ? styles.roleBadgeDriver
                            : styles.roleBadgeUser,
                        ]}
                      >
                        <Text
                          style={[
                            styles.roleBadgeText,
                            isProtected
                              ? styles.roleBadgeTextCicto
                              : isCenroAdmin
                              ? styles.roleBadgeTextAdmin
                              : isCoordinator
                              ? styles.roleBadgeTextCoordinator
                              : user.role === 'driver'
                              ? styles.roleBadgeTextDriver
                              : styles.roleBadgeTextUser,
                          ]}
                        >
                          {isProtected
                            ? 'CICTO ADMIN'
                            : isCenroAdmin
                            ? 'CENRO'
                            : isCoordinator
                            ? 'COORDINATOR'
                            : user.role === 'driver'
                            ? 'DRIVER'
                            : 'RESIDENT'}
                        </Text>
                      </View>
                    </View>

                    {/* Status & Inactivity */}
                    <View style={{ width: 110, flexShrink: 0 }}>
                      <View style={styles.statusPill}>
                        <View
                          style={[
                            styles.statusDot,
                            { backgroundColor: isInactive ? '#EF4444' : '#10B981' },
                          ]}
                        />
                        <Text
                          style={[
                            styles.statusText,
                            { color: isInactive ? '#DC2626' : '#15803D' },
                          ]}
                        >
                          {isInactive ? 'INACTIVE' : 'ACTIVE'}
                        </Text>
                      </View>
                      {isInactive && (isResident || isCoordinator) && (
                        <Text style={styles.inactivitySubText} numberOfLines={1}>
                          {getInactivityDurationString(user)}
                        </Text>
                      )}
                    </View>

                    {/* Action Button (Option B: Enterprise Three Dots Menu) */}
                    <View style={styles.actionsCell}>
                      <TouchableOpacity
                        style={styles.moreActionBtn}
                        onPress={() => setActionMenuUser(user)}
                        accessibilityLabel={`Manage account for ${user.displayName || user.email}`}
                        activeOpacity={0.7}
                      >
                        <MaterialIcons name="more-vert" size={20} color="#475569" />
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        </ScrollView>
      </View>

      {/* Edit Resident / Assign Barangay Modal */}
      <Modal visible={isEditUserModalOpen} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeaderRow}>
              <View style={styles.modalHeaderIconBadge}>
                <MaterialIcons name="location-city" size={24} color="#0D9488" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>User Sector & Profile</Text>
                <Text style={styles.modalSub}>
                  Assign or change registered Danao City Barangay sector for this account.
                </Text>
              </View>
              <TouchableOpacity
                style={styles.modalCloseIconBtn}
                onPress={() => setIsEditUserModalOpen(false)}
                disabled={isUpdatingBarangay}
              >
                <MaterialIcons name="close" size={20} color="#64748B" />
              </TouchableOpacity>
            </View>

            {editingUser && (
              <View style={styles.userInfoBox}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={styles.userInfoBoxName}>{editingUser.displayName || 'Unnamed User'}</Text>
                  <View style={styles.roleBadgeUser}>
                    <Text style={styles.roleBadgeTextUser}>
                      {editingUser.role ? editingUser.role.toUpperCase() : 'RESIDENT'}
                    </Text>
                  </View>
                </View>
                <Text style={styles.userInfoBoxEmail}>{editingUser.email}</Text>
                {Boolean(editingUser.employeeId) && (
                  <Text style={styles.userInfoBoxEmpId}>Employee ID: {editingUser.employeeId}</Text>
                )}
              </View>
            )}

            {/* Barangay Selector for 42 Barangays */}
            <View style={[styles.formGroup, { zIndex: 1000, position: 'relative' }]}>
              <Text style={styles.formLabel}>ASSIGNED BARANGAY (42 DANAO BARANGAYS)</Text>
              <TouchableOpacity
                style={[
                  styles.dropdownBtn,
                  isEditModalBrgyDropdownOpen && styles.dropdownBtnActive,
                  !selectedBarangayForUser && { borderColor: '#CBD5E1', backgroundColor: '#F8FAFC' },
                ]}
                onPress={() => setIsEditModalBrgyDropdownOpen(!isEditModalBrgyDropdownOpen)}
                activeOpacity={0.8}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                  <MaterialIcons
                    name={selectedBarangayForUser ? 'location-on' : 'location-off'}
                    size={18}
                    color={selectedBarangayForUser ? '#0D9488' : '#64748B'}
                  />
                  <Text
                    style={[
                      styles.dropdownBtnText,
                      !selectedBarangayForUser && { color: '#64748B', fontWeight: '600' },
                    ]}
                    numberOfLines={1}
                  >
                    {selectedBarangayForUser ? (selectedBarangayForUser.toUpperCase() === 'CITY' ? 'CITY (City-Wide Jurisdiction)' : `Brgy. ${selectedBarangayForUser}`) : 'Unassigned (No Barangay Assigned)'}
                  </Text>
                </View>
                <MaterialIcons
                  name={isEditModalBrgyDropdownOpen ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
                  size={20}
                  color="#64748B"
                />
              </TouchableOpacity>

              {/* Quick Unassign / Selection Status Bar */}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                <Text style={{ fontSize: 12, color: '#64748B' }}>
                  {selectedBarangayForUser
                    ? (selectedBarangayForUser.toUpperCase() === 'CITY' ? 'Sector: CITY (City-Wide Jurisdiction)' : `Sector: Brgy. ${selectedBarangayForUser}`)
                    : 'Sector status: Unassigned'}
                </Text>
                {selectedBarangayForUser ? (
                  <TouchableOpacity
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                      backgroundColor: '#F1F5F9',
                      paddingHorizontal: 10,
                      paddingVertical: 5,
                      borderRadius: 6,
                      borderWidth: 1,
                      borderColor: '#CBD5E1',
                    }}
                    onPress={() => {
                      setSelectedBarangayForUser('');
                      setIsEditModalBrgyDropdownOpen(false);
                    }}
                  >
                    <MaterialIcons name="close" size={14} color="#64748B" />
                    <Text style={{ fontSize: 12, fontWeight: '700', color: '#475569' }}>
                      Clear to Unassigned
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                      backgroundColor: '#F0FDF4',
                      paddingHorizontal: 8,
                      paddingVertical: 4,
                      borderRadius: 6,
                      borderWidth: 1,
                      borderColor: '#BBF7D0',
                    }}
                  >
                    <MaterialIcons name="check-circle" size={14} color="#16A34A" />
                    <Text style={{ fontSize: 11, fontWeight: '700', color: '#16A34A' }}>
                      Unassigned Selected
                    </Text>
                  </View>
                )}
              </View>

              {isEditModalBrgyDropdownOpen && (
                <View style={styles.dropdownMenu}>
                  <View style={styles.dropdownSearchBox}>
                    <MaterialIcons name="search" size={16} color="#0D9488" />
                    <TextInput
                      style={styles.dropdownSearchInput}
                      placeholder="Type to filter barangays..."
                      placeholderTextColor="#94A3B8"
                      value={editModalBrgySearch}
                      onChangeText={setEditModalBrgySearch}
                      autoFocus
                    />
                    {editModalBrgySearch.trim() !== '' && (
                      <TouchableOpacity onPress={() => setEditModalBrgySearch('')}>
                        <MaterialIcons name="close" size={14} color="#94A3B8" />
                      </TouchableOpacity>
                    )}
                  </View>

                  <ScrollView
                    style={{ maxHeight: 220, ...(Platform.OS === 'web' ? ({ overflowY: 'auto' } as any) : {}) }}
                    contentContainerStyle={{ flexGrow: 1, paddingBottom: 6 }}
                    nestedScrollEnabled
                    showsVerticalScrollIndicator={true}
                    keyboardShouldPersistTaps="handled"
                  >
                    {/* Option to clear / unassign */}
                    <TouchableOpacity
                      style={[
                        styles.dropdownMenuItem,
                        !selectedBarangayForUser && styles.dropdownMenuItemSelected,
                        { borderBottomWidth: 1, borderBottomColor: '#E2E8F0', backgroundColor: !selectedBarangayForUser ? '#F0FDF4' : '#F8FAFC' },
                      ]}
                      onPress={() => {
                        setSelectedBarangayForUser('');
                        setIsEditModalBrgyDropdownOpen(false);
                      }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <MaterialIcons name="location-off" size={16} color={!selectedBarangayForUser ? '#16A34A' : '#64748B'} />
                        <Text
                          style={[
                            styles.dropdownMenuItemText,
                            !selectedBarangayForUser && { color: '#16A34A', fontWeight: '800' },
                          ]}
                        >
                          -- None (Unassigned) --
                        </Text>
                      </View>
                      {!selectedBarangayForUser && (
                        <MaterialIcons name="check" size={16} color="#16A34A" />
                      )}
                    </TouchableOpacity>

                    {/* Option for CITY (City-Wide Jurisdiction) */}
                    <TouchableOpacity
                      style={[
                        styles.dropdownMenuItem,
                        selectedBarangayForUser.toUpperCase() === 'CITY' && styles.dropdownMenuItemSelected,
                        { borderBottomWidth: 1, borderBottomColor: '#E2E8F0', backgroundColor: selectedBarangayForUser.toUpperCase() === 'CITY' ? '#F0FDFA' : '#FFFFFF' },
                      ]}
                      onPress={() => {
                        setSelectedBarangayForUser('CITY');
                        setIsEditModalBrgyDropdownOpen(false);
                      }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <MaterialIcons name="location-city" size={16} color={selectedBarangayForUser.toUpperCase() === 'CITY' ? '#0D9488' : '#0F766E'} />
                        <Text
                          style={[
                            styles.dropdownMenuItemText,
                            selectedBarangayForUser.toUpperCase() === 'CITY' && { color: '#0F766E', fontWeight: '800' },
                          ]}
                        >
                          CITY (City-Wide Jurisdiction)
                        </Text>
                      </View>
                      {selectedBarangayForUser.toUpperCase() === 'CITY' && (
                        <MaterialIcons name="check" size={16} color="#0D9488" />
                      )}
                    </TouchableOpacity>

                    {DANAO_CITY_BARANGAYS.filter((b) =>
                      b.toLowerCase().includes(editModalBrgySearch.trim().toLowerCase())
                    ).map((b) => {
                      const isSelected = selectedBarangayForUser === b;
                      return (
                        <TouchableOpacity
                          key={b}
                          style={[
                            styles.dropdownMenuItem,
                            isSelected && styles.dropdownMenuItemSelected,
                          ]}
                          onPress={() => {
                            setSelectedBarangayForUser(b);
                            setIsEditModalBrgyDropdownOpen(false);
                          }}
                        >
                          <Text
                            style={[
                              styles.dropdownMenuItemText,
                              isSelected && styles.dropdownMenuItemTextSelected,
                            ]}
                          >
                            {b}
                          </Text>
                          {isSelected && (
                            <MaterialIcons name="check" size={16} color="#0D9488" />
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
              )}
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => setIsEditUserModalOpen(false)}
                disabled={isUpdatingBarangay}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirm, isUpdatingBarangay && { opacity: 0.7 }]}
                onPress={handleSaveUserBarangay}
                disabled={isUpdatingBarangay}
              >
                {isUpdatingBarangay ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalConfirmText}>
                    {selectedBarangayForUser ? 'Save Sector' : 'Save as Unassigned'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Provision CENRO Modal */}
      <Modal visible={isCenroModalOpen} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { maxHeight: '92%' }]}>
            <View style={styles.modalHeaderRow}>
              <View style={styles.modalHeaderIconBadge}>
                <MaterialIcons name="admin-panel-settings" size={24} color="#0D9488" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Provision CENRO Administrator</Text>
                <Text style={styles.modalSub}>
                  Create official municipal administrative credentials for solid waste and fleet operations.
                </Text>
              </View>
              <TouchableOpacity
                style={styles.modalCloseIconBtn}
                onPress={() => setIsCenroModalOpen(false)}
                disabled={isSubmittingCenro}
              >
                <MaterialIcons name="close" size={20} color="#64748B" />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={{ flexShrink: 1 }}
              contentContainerStyle={{ gap: 16, paddingBottom: 4 }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
            >
            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>
                OFFICIAL EMAIL ADDRESS <Text style={styles.requiredAsterisk}>*</Text>
              </Text>
              <View style={styles.inputWithIcon}>
                <MaterialIcons name="email" size={18} color="#94A3B8" style={styles.inputLeftIcon} />
                <TextInput
                  style={styles.modalInputWithIcon}
                  placeholder="e.g. cenro.officer@danao.gov.ph"
                  placeholderTextColor="#94A3B8"
                  value={cenroEmail}
                  onChangeText={setCenroEmail}
                  autoCapitalize="none"
                />
              </View>
            </View>

            <View style={styles.formGroup}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={styles.formLabel}>ACCOUNT PASSWORD (EDITABLE)</Text>
                <TouchableOpacity
                  onPress={handleRegeneratePassword}
                  style={styles.regenerateBtn}
                  activeOpacity={0.7}
                >
                  <MaterialIcons name="refresh" size={14} color="#0D9488" />
                  <Text style={styles.regenerateText}>Regenerate</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.inputWithIcon}>
                <MaterialIcons name="lock" size={18} color="#0D9488" style={styles.inputLeftIcon} />
                <TextInput
                  style={[styles.modalInputWithIcon, { color: '#0F172A' }]}
                  value={cenroPassword}
                  onChangeText={setCenroPassword}
                  editable={true}
                  placeholder="Enter custom password or use generated"
                  placeholderTextColor="#94A3B8"
                  selectTextOnFocus
                  secureTextEntry={!showCenroPassword}
                />
                <TouchableOpacity
                  onPress={() => setShowCenroPassword((p) => !p)}
                  style={styles.inputRightAction}
                >
                  <MaterialIcons
                    name={showCenroPassword ? 'visibility-off' : 'visibility'}
                    size={18}
                    color="#64748B"
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleCopyPassword}
                  style={[styles.copyBtn, copiedPassword && styles.copyBtnSuccess]}
                  activeOpacity={0.7}
                >
                  <MaterialIcons
                    name={copiedPassword ? 'check' : 'content-copy'}
                    size={15}
                    color={copiedPassword ? '#166534' : '#0D9488'}
                  />
                  <Text style={[styles.copyBtnText, copiedPassword && styles.copyBtnTextSuccess]}>
                    {copiedPassword ? 'Copied!' : 'Copy'}
                  </Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.formHelper}>
                🔒 Specify a custom password (e.g. CENROAdmin2026!) or keep the generated password. If this email belongs to an existing user, their existing credentials are preserved and elevated to CENRO Admin.
              </Text>
            </View>

            <View style={[styles.formRow, (isDeptDropdownOpen || isDesigDropdownOpen) && { zIndex: 1000, elevation: 1000, position: 'relative' }]}>
              {/* Department Dropdown */}
              <View style={[styles.formGroup, { flex: 1, position: 'relative', zIndex: isDeptDropdownOpen ? 1000 : 10 }]}>
                <Text style={styles.formLabel}>DEPARTMENT</Text>
                <TouchableOpacity
                  style={[styles.dropdownBtn, isDeptDropdownOpen && styles.dropdownBtnActive]}
                  onPress={() => {
                    setIsDeptDropdownOpen(!isDeptDropdownOpen);
                    setIsDesigDropdownOpen(false);
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={styles.dropdownBtnText} numberOfLines={1}>
                    {cenroDepartment || 'Select Department'}
                  </Text>
                  <MaterialIcons
                    name={isDeptDropdownOpen ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
                    size={20}
                    color="#64748B"
                  />
                </TouchableOpacity>

                {isDeptDropdownOpen && (
                  <View style={styles.dropdownMenu}>
                    <ScrollView
                      style={{ maxHeight: 180, ...(Platform.OS === 'web' ? ({ overflowY: 'auto' } as any) : {}) }}
                      nestedScrollEnabled
                      showsVerticalScrollIndicator={true}
                      keyboardShouldPersistTaps="handled"
                    >
                      {CENRO_DEPARTMENTS.map((dept) => {
                        const isSelected = cenroDepartment === dept;
                        return (
                          <TouchableOpacity
                            key={dept}
                            style={[styles.dropdownMenuItem, isSelected && styles.dropdownMenuItemSelected]}
                            onPress={() => {
                              setCenroDepartment(dept);
                              setCenroProvisionPrivileges(getProvisionPrivilegePreset(dept, cenroDesignation));
                              setIsDeptDropdownOpen(false);
                            }}
                          >
                            <Text style={[styles.dropdownMenuItemText, isSelected && styles.dropdownMenuItemTextSelected]}>
                              {dept}
                            </Text>
                            {isSelected && (
                              <MaterialIcons name="check" size={16} color="#0D9488" />
                            )}
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  </View>
                )}
              </View>

              {/* Designation Dropdown */}
              <View style={[styles.formGroup, { flex: 1, position: 'relative', zIndex: isDesigDropdownOpen ? 1000 : 10 }]}>
                <Text style={styles.formLabel}>DESIGNATION</Text>
                <TouchableOpacity
                  style={[styles.dropdownBtn, isDesigDropdownOpen && styles.dropdownBtnActive]}
                  onPress={() => {
                    setIsDesigDropdownOpen(!isDesigDropdownOpen);
                    setIsDeptDropdownOpen(false);
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={styles.dropdownBtnText} numberOfLines={1}>
                    {cenroDesignation || 'Select Designation'}
                  </Text>
                  <MaterialIcons
                    name={isDesigDropdownOpen ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
                    size={20}
                    color="#64748B"
                  />
                </TouchableOpacity>

                {isDesigDropdownOpen && (
                  <View style={styles.dropdownMenu}>
                    <ScrollView
                      style={{ maxHeight: 180, ...(Platform.OS === 'web' ? ({ overflowY: 'auto' } as any) : {}) }}
                      nestedScrollEnabled
                      showsVerticalScrollIndicator={true}
                      keyboardShouldPersistTaps="handled"
                    >
                      {CENRO_DESIGNATIONS.map((desig) => {
                        const isSelected = cenroDesignation === desig;
                        return (
                          <TouchableOpacity
                            key={desig}
                            style={[styles.dropdownMenuItem, isSelected && styles.dropdownMenuItemSelected]}
                            onPress={() => {
                              setCenroDesignation(desig);
                              setCenroProvisionPrivileges(getProvisionPrivilegePreset(cenroDepartment, desig));
                              setIsDesigDropdownOpen(false);
                            }}
                          >
                            <Text style={[styles.dropdownMenuItemText, isSelected && styles.dropdownMenuItemTextSelected]}>
                              {desig}
                            </Text>
                            {isSelected && (
                              <MaterialIcons name="check" size={16} color="#0D9488" />
                            )}
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  </View>
                )}
              </View>
            </View>

            <View style={{ marginTop: 4, flexShrink: 1 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <Text style={styles.formLabel}>INITIAL OPERATIONAL PRIVILEGES</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={styles.privilegeStatChip}>
                    <MaterialIcons name="visibility" size={11} color="#0D9488" />
                    <Text style={styles.privilegeStatChipText}>
                      {SYSTEM_PRIVILEGES.filter((p) => hasReadPrivilege(cenroProvisionPrivileges, p.id)).length} Read
                    </Text>
                  </View>
                  <View style={[styles.privilegeStatChip, { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' }]}>
                    <MaterialIcons name="edit" size={11} color="#059669" />
                    <Text style={[styles.privilegeStatChipText, { color: '#065F46' }]}>
                      {SYSTEM_PRIVILEGES.filter((p) => hasWritePrivilege(cenroProvisionPrivileges, p.id)).length} Write
                    </Text>
                  </View>
                </View>
              </View>
              <Text style={{ color: '#64748B', fontSize: 11, lineHeight: 16, marginBottom: 8 }}>
                Changing department or designation updates default privileges. Select Read for audit-only, or Write (which automatically enables Read & Write).
              </Text>
              <ScrollView
                style={{ maxHeight: 220, borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 10 }}
                contentContainerStyle={{ padding: 8, gap: 8 }}
                nestedScrollEnabled
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator
              >
                {SYSTEM_PRIVILEGES.map((privilege) => {
                  const isRead = hasReadPrivilege(cenroProvisionPrivileges, privilege.id);
                  const isWrite = hasWritePrivilege(cenroProvisionPrivileges, privilege.id);
                  const isSelected = isRead || isWrite;
                  return (
                    <View
                      key={privilege.id}
                      style={[
                        styles.privilegeItemCard,
                        isSelected && styles.privilegeItemCardGranted,
                        { padding: 10, borderRadius: 10 },
                      ]}
                    >
                      <View style={[styles.privilegeIconWrap, isSelected && styles.privilegeIconWrapGranted, { width: 34, height: 34 }]}>
                        <MaterialIcons name={privilege.icon} size={18} color={isSelected ? '#0D9488' : '#64748B'} />
                      </View>
                      <View style={{ flex: 1, marginRight: 8 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <Text style={[styles.privilegeName, isSelected && styles.privilegeNameGranted, { fontSize: 12.5 }]}>
                            {privilege.name}
                          </Text>
                          <View
                            style={[styles.privilegeCatBadge, {
                              backgroundColor: privilege.category === 'operations' ? '#ECFDF5' : privilege.category === 'telemetry' ? '#EFF6FF' : privilege.category === 'reporting' ? '#FEF3C7' : '#F1F5F9'
                            }]}
                          >
                            <Text
                              style={[styles.privilegeCatBadgeText, {
                                color: privilege.category === 'operations' ? '#059669' : privilege.category === 'telemetry' ? '#2563EB' : privilege.category === 'reporting' ? '#D97706' : '#475569',
                                fontSize: 8.5,
                              }]}
                            >
                              {privilege.category.toUpperCase()}
                            </Text>
                          </View>
                        </View>
                        <Text style={{ color: '#64748B', fontSize: 10.5, lineHeight: 14, marginTop: 2 }}>
                          {privilege.description}
                        </Text>
                      </View>

                      {/* Right: Read & Write Action Buttons */}
                      <View style={styles.privilegeTogglesRow}>
                        <TouchableOpacity
                          style={[
                            styles.privilegeToggleChip,
                            isRead ? styles.privilegeToggleChipReadActive : styles.privilegeToggleChipInactive,
                            { paddingHorizontal: 8, paddingVertical: 5 },
                          ]}
                          onPress={() => handleToggleCenroProvisionRead(privilege.id)}
                          disabled={isSubmittingCenro}
                          activeOpacity={0.7}
                          accessibilityRole="checkbox"
                          accessibilityLabel={`Read ${privilege.name}`}
                          accessibilityState={{ checked: isRead }}
                        >
                          <View style={[styles.privilegeMiniBox, isRead && styles.privilegeMiniBoxReadActive, { width: 15, height: 15 }]}>
                            {isRead ? (
                              <MaterialIcons name="check" size={11} color="#FFFFFF" />
                            ) : null}
                          </View>
                          <Text style={[styles.privilegeToggleText, isRead && styles.privilegeToggleTextReadActive, { fontSize: 10.5 }]}>
                            Read
                          </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[
                            styles.privilegeToggleChip,
                            isWrite ? styles.privilegeToggleChipWriteActive : styles.privilegeToggleChipInactive,
                            { paddingHorizontal: 8, paddingVertical: 5 },
                          ]}
                          onPress={() => handleToggleCenroProvisionWrite(privilege.id)}
                          disabled={isSubmittingCenro}
                          activeOpacity={0.7}
                          accessibilityRole="checkbox"
                          accessibilityLabel={`Write ${privilege.name}`}
                          accessibilityState={{ checked: isWrite }}
                        >
                          <View style={[styles.privilegeMiniBox, isWrite && styles.privilegeMiniBoxWriteActive, { width: 15, height: 15 }]}>
                            {isWrite ? (
                              <MaterialIcons name="check" size={11} color="#FFFFFF" />
                            ) : null}
                          </View>
                          <Text style={[styles.privilegeToggleText, isWrite && styles.privilegeToggleTextWriteActive, { fontSize: 10.5 }]}>
                            Write
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
              </ScrollView>
            </View>

            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => setIsCenroModalOpen(false)}
                disabled={isSubmittingCenro}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirm, isSubmittingCenro && { opacity: 0.7 }]}
                onPress={handleProvisionCenro}
                disabled={isSubmittingCenro}
              >
                {isSubmittingCenro ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalConfirmText}>✨ Provision Account</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Deletion OTP Modal */}
      <Modal visible={deleteModalVisible} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.deleteHeaderIcon}>
              <MaterialIcons name="warning" size={28} color="#DC2626" />
            </View>
            <Text style={styles.modalTitle}>Security Account Deletion</Text>
            <Text style={styles.modalSub}>
              Permanently delete{' '}
              <Text style={{ fontWeight: '800' }}>
                {targetUserToDelete?.email || targetUserToDelete?.displayName || (targetUserToDelete?.id ? `Account (${targetUserToDelete.id.slice(0, 8)}...)` : 'this account')}
              </Text>{' '}
              from Authentication and Firestore.
            </Text>

            {deleteStep === 'confirm' ? (
              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.modalCancel}
                  onPress={() => setDeleteModalVisible(false)}
                  disabled={isDeleting}
                >
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalConfirm, { backgroundColor: '#DC2626' }]}
                  onPress={handleRequestDeletionOtp}
                  disabled={isDeleting}
                >
                  <Text style={styles.modalConfirmText}>
                    {isDeleting ? 'Generating PIN...' : 'Request Authorization PIN'}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View>
                {/* Security Authorization PIN Notice */}
                <View style={styles.pinDisplayCard}>
                  <View style={styles.pinDisplayHeader}>
                    <MaterialIcons name="security" size={16} color="#0F766E" />
                    <Text style={styles.pinDisplayTitle}>Type the PIN written below to confirm</Text>
                  </View>
                  {deleteGeneratedPin ? (
                    <Text style={styles.pinDisplayCode}>{deleteGeneratedPin}</Text>
                  ) : null}
                  <Text style={styles.pinDisplayHint}>
                    Type the 6-digit confirmation PIN above into the input field below to confirm deletion.
                  </Text>
                </View>

                <Text style={styles.otpLabel}>Enter Confirmation PIN:</Text>
                <TextInput
                  style={[styles.modalInput, styles.otpInput]}
                  placeholder="000000"
                  value={deleteOtpInput}
                  onChangeText={setDeleteOtpInput}
                  keyboardType="numeric"
                  maxLength={6}
                />
                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={styles.modalCancel}
                    onPress={() => setDeleteModalVisible(false)}
                    disabled={isDeleting}
                  >
                    <Text style={styles.modalCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalConfirm, { backgroundColor: '#DC2626' }]}
                    onPress={handleConfirmDeletion}
                    disabled={isDeleting}
                  >
                    <Text style={styles.modalConfirmText}>
                      {isDeleting ? 'Deleting...' : 'Confirm Deletion'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Elevate User Privileges Modal */}
      <Modal visible={isElevateModalOpen} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { maxWidth: 520 }]}>
            <View style={styles.modalHeaderRow}>
              <View style={styles.elevateHeaderIconBadge}>
                <MaterialIcons name="admin-panel-settings" size={24} color="#059669" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Elevate Account Privileges</Text>
                <Text style={styles.modalSub}>
                  Promote verified account to municipal administrative or coordinator level.
                </Text>
              </View>
              <TouchableOpacity
                style={styles.modalCloseIconBtn}
                onPress={() => setIsElevateModalOpen(false)}
                disabled={isSubmittingElevation}
              >
                <MaterialIcons name="close" size={20} color="#64748B" />
              </TouchableOpacity>
            </View>

            {targetUserToElevate && (
              <View style={styles.elevateUserCard}>
                <View style={styles.elevateUserAvatar}>
                  <Text style={styles.elevateUserAvatarText}>
                    {(targetUserToElevate.displayName || targetUserToElevate.email || 'U').charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.elevateUserName} numberOfLines={1}>
                    {targetUserToElevate.displayName || 'Unnamed User'}
                  </Text>
                  <Text style={styles.elevateUserEmail} numberOfLines={1}>
                    {targetUserToElevate.email}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                    <View style={isUserCoordinator(targetUserToElevate) ? styles.roleBadgeCoordinator : styles.roleBadgeUser}>
                      <Text style={isUserCoordinator(targetUserToElevate) ? styles.roleBadgeTextCoordinator : styles.roleBadgeTextUser}>
                        {isUserCoordinator(targetUserToElevate) ? 'COORDINATOR' : (targetUserToElevate.role ? targetUserToElevate.role.toUpperCase() : 'RESIDENT')}
                      </Text>
                    </View>
                    {Boolean(targetUserToElevate.barangay || targetUserToElevate.assignedBarangay) && (
                      <View style={styles.barangayBadge}>
                        <MaterialIcons name="location-on" size={11} color="#0D9488" />
                        <Text style={styles.barangayBadgeText}>
                          {targetUserToElevate.barangay || targetUserToElevate.assignedBarangay}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
              </View>
            )}

            <View style={{ gap: 8 }}>
              <Text style={styles.formLabel}>
                SELECT ELEVATED TARGET ROLE <Text style={styles.requiredAsterisk}>*</Text>
              </Text>
              
              {/* Option 1: CENRO Municipal Admin */}
              <TouchableOpacity
                style={[
                  styles.roleOptionCard,
                  elevateTargetRole === 'cenro' && styles.roleOptionCardSelected,
                ]}
                onPress={() => handleSelectElevateRole('cenro')}
                activeOpacity={0.85}
              >
                <View
                  style={[
                    styles.roleOptionRadio,
                    elevateTargetRole === 'cenro' && styles.roleOptionRadioSelected,
                  ]}
                >
                  {elevateTargetRole === 'cenro' && <View style={styles.roleOptionRadioInner} />}
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <MaterialIcons name="security" size={16} color={elevateTargetRole === 'cenro' ? '#059669' : '#64748B'} />
                    <Text style={[styles.roleOptionTitle, elevateTargetRole === 'cenro' && { color: '#065F46' }]}>
                      CENRO Municipal Administrator
                    </Text>
                  </View>
                  <Text style={styles.roleOptionSub}>
                    City Environment & Natural Resources Office. Grants municipal solid waste command, fleet dispatch, and admin portal access.
                  </Text>
                  <View style={[styles.roleOptionTag, elevateTargetRole === 'cenro' && styles.roleOptionTagSelected]}>
                    <Text style={[styles.roleOptionTagText, elevateTargetRole === 'cenro' && styles.roleOptionTagTextSelected]}>
                      Login: /admin/login
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>

              {/* Option 2: Barangay Coordinator */}
              <TouchableOpacity
                style={[styles.roleOptionCard, elevateTargetRole === 'mayor' && styles.roleOptionCardSelected]}
                onPress={() => handleSelectElevateRole('mayor')}
                activeOpacity={0.85}
              >
                <View style={[styles.roleOptionRadio, elevateTargetRole === 'mayor' && styles.roleOptionRadioSelected]}>
                  {elevateTargetRole === 'mayor' && <View style={styles.roleOptionRadioInner} />}
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <MaterialIcons name="account-balance" size={16} color="#0F766E" />
                    <Text style={[styles.roleOptionTitle, elevateTargetRole === 'mayor' && { color: '#065F46' }]}>Mayor’s Office Representative</Text>
                  </View>
                  <Text style={styles.roleOptionSub}>Restricted account for interagency group chat coordination. No CENRO operational access.</Text>
                  <View style={[styles.roleOptionTag, elevateTargetRole === 'mayor' && styles.roleOptionTagSelected]}>
                    <Text style={[styles.roleOptionTagText, elevateTargetRole === 'mayor' && styles.roleOptionTagTextSelected]}>Login: /admin/login</Text>
                  </View>
                </View>
              </TouchableOpacity>

              {/* Option 3: Barangay Coordinator */}
              <TouchableOpacity
                style={[
                  styles.roleOptionCard,
                  elevateTargetRole === 'coordinator' && styles.roleOptionCardSelected,
                ]}
                onPress={() => handleSelectElevateRole('coordinator')}
                activeOpacity={0.85}
              >
                <View
                  style={[
                    styles.roleOptionRadio,
                    elevateTargetRole === 'coordinator' && styles.roleOptionRadioSelected,
                  ]}
                >
                  {elevateTargetRole === 'coordinator' && <View style={styles.roleOptionRadioInner} />}
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <MaterialIcons name="eco" size={16} color={elevateTargetRole === 'coordinator' ? '#059669' : '#64748B'} />
                    <Text style={[styles.roleOptionTitle, elevateTargetRole === 'coordinator' && { color: '#065F46' }]}>
                      Barangay Environmental Coordinator
                    </Text>
                  </View>
                  <Text style={styles.roleOptionSub}>
                    Community environmental officer. Responsible for sector monitoring, illegal dumping reporting, and local collection tracking.
                  </Text>
                  <View style={[styles.roleOptionTag, elevateTargetRole === 'coordinator' && styles.roleOptionTagSelected]}>
                    <Text style={[styles.roleOptionTagText, elevateTargetRole === 'coordinator' && styles.roleOptionTagTextSelected]}>
                      Login: /admin/login
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>

            </View>

            {/* If Coordinator selected: Sector / Barangay Selector */}
            {elevateTargetRole === 'coordinator' && (() => {
              const otherCoordinatorForSelected = isBarangayAssignedToOther(elevateBarangay);
              const totalTaken = Object.keys(takenBarangaysMap).length;
              const totalAvailable = DANAO_CITY_BARANGAYS.filter((b) => !isBarangayAssignedToOther(b)).length;

              return (
                <View style={[styles.formGroup, { zIndex: 100, position: 'relative' }]}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={styles.formLabel}>
                      ASSIGNED BARANGAY (1:1 JURISDICTION) <Text style={styles.requiredAsterisk}>*</Text>
                    </Text>
                    <Text style={{ fontSize: 10, fontWeight: '700', color: '#059669' }}>
                      {totalAvailable} Available • {totalTaken} Assigned
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[
                      styles.dropdownBtn,
                      isElevateBrgyDropdownOpen && styles.dropdownBtnActive,
                      otherCoordinatorForSelected && { borderColor: '#EF4444', backgroundColor: '#FEF2F2' },
                    ]}
                    onPress={() => setIsElevateBrgyDropdownOpen(!isElevateBrgyDropdownOpen)}
                    activeOpacity={0.8}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                      <MaterialIcons
                        name="location-on"
                        size={18}
                        color={otherCoordinatorForSelected ? '#DC2626' : '#059669'}
                      />
                      <Text
                        style={[
                          styles.dropdownBtnText,
                          otherCoordinatorForSelected && { color: '#DC2626', fontWeight: '700' },
                        ]}
                        numberOfLines={1}
                      >
                        {elevateBarangay ? (elevateBarangay.toUpperCase() === 'CITY' ? 'CITY (City-Wide)' : `Brgy. ${elevateBarangay}`) : 'Select Assigned Barangay'}
                        {otherCoordinatorForSelected ? ' (Already Assigned)' : ''}
                      </Text>
                    </View>
                    <MaterialIcons
                      name={isElevateBrgyDropdownOpen ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
                      size={20}
                      color="#64748B"
                    />
                  </TouchableOpacity>

                  {/* Warning / Policy feedback */}
                  {otherCoordinatorForSelected ? (
                    <View style={[styles.brgyWarningBox, { borderColor: '#F59E0B', backgroundColor: '#FFFBEB' }]}>
                      <MaterialIcons name="swap-horiz" size={16} color="#D97706" />
                      <Text style={[styles.brgyWarningText, { color: '#B45309' }]}>
                        <Text style={{ fontWeight: '800' }}>Brgy. {elevateBarangay}</Text> is currently assigned to {otherCoordinatorForSelected.displayName || otherCoordinatorForSelected.email}. Confirming will transfer sector jurisdiction to {targetUserToElevate?.displayName || targetUserToElevate?.name || 'this officer'}.
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.brgyPolicyNotice}>
                      <MaterialIcons name="verified" size={14} color="#059669" />
                      <Text style={styles.brgyPolicyNoticeText}>
                        1:1 Policy: Only 1 coordinator per barangay. Brgy. {elevateBarangay} is verified available.
                      </Text>
                    </View>
                  )}

                  {isElevateBrgyDropdownOpen && (
                    <View style={styles.dropdownMenu}>
                      <View style={styles.dropdownSearchBox}>
                        <MaterialIcons name="search" size={16} color="#059669" />
                        <TextInput
                          style={styles.dropdownSearchInput}
                          placeholder="Filter 42 Danao barangays..."
                          placeholderTextColor="#94A3B8"
                          value={elevateBrgySearch}
                          onChangeText={setElevateBrgySearch}
                          autoFocus
                        />
                      </View>
                      <ScrollView
                        style={{ maxHeight: 200, ...(Platform.OS === 'web' ? ({ overflowY: 'auto' } as any) : {}) }}
                        nestedScrollEnabled
                        showsVerticalScrollIndicator
                      >
                        {/* Option for CITY (City-Wide Jurisdiction) */}
                        <TouchableOpacity
                          style={[
                            styles.dropdownMenuItem,
                            elevateBarangay.toUpperCase() === 'CITY' && styles.dropdownMenuItemSelected,
                            { borderBottomWidth: 1, borderBottomColor: '#E2E8F0', backgroundColor: elevateBarangay.toUpperCase() === 'CITY' ? '#F0FDFA' : '#FFFFFF' },
                          ]}
                          onPress={() => {
                            setElevateBarangay('CITY');
                            setIsElevateBrgyDropdownOpen(false);
                          }}
                          activeOpacity={0.7}
                        >
                          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: 8 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                              <MaterialIcons
                                name="location-city"
                                size={15}
                                color={elevateBarangay.toUpperCase() === 'CITY' ? '#059669' : '#0F766E'}
                              />
                              <Text
                                style={[
                                  styles.dropdownMenuItemText,
                                  elevateBarangay.toUpperCase() === 'CITY' && styles.dropdownMenuItemTextSelected,
                                  { fontWeight: '700' },
                                ]}
                                numberOfLines={1}
                              >
                                CITY (City-Wide Coordinator)
                              </Text>
                            </View>
                            {elevateBarangay.toUpperCase() === 'CITY' && (
                              <MaterialIcons name="check" size={16} color="#059669" />
                            )}
                          </View>
                        </TouchableOpacity>
                        {DANAO_CITY_BARANGAYS.filter((b) =>
                          b.toLowerCase().includes(elevateBrgySearch.trim().toLowerCase())
                        ).map((b) => {
                          const isSelected = elevateBarangay.toLowerCase() === b.toLowerCase();
                          const otherCoordinator = isBarangayAssignedToOther(b);
                          const isTaken = !!otherCoordinator;

                          return (
                            <TouchableOpacity
                              key={b}
                              style={[
                                styles.dropdownMenuItem,
                                isSelected && (isTaken ? styles.dropdownMenuItemSelectedTaken : styles.dropdownMenuItemSelected),
                              ]}
                              onPress={() => {
                                setElevateBarangay(b);
                                setIsElevateBrgyDropdownOpen(false);
                              }}
                              activeOpacity={0.7}
                            >
                              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: 8 }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                                  <MaterialIcons
                                    name="location-on"
                                    size={15}
                                    color={isTaken ? '#94A3B8' : isSelected ? '#059669' : '#64748B'}
                                  />
                                  <Text
                                    style={[
                                      styles.dropdownMenuItemText,
                                      isTaken && styles.dropdownMenuItemTextDisabled,
                                      isSelected && styles.dropdownMenuItemTextSelected,
                                    ]}
                                    numberOfLines={1}
                                  >
                                    {b}
                                  </Text>
                                </View>

                                {isTaken ? (
                                  <View style={styles.brgyTakenBadge}>
                                    <MaterialIcons name="lock" size={11} color="#DC2626" />
                                    <Text style={styles.brgyTakenBadgeText} numberOfLines={1}>
                                      Assigned: {otherCoordinator.displayName?.split(',')[0] || otherCoordinator.email?.split('@')[0]}
                                    </Text>
                                  </View>
                                ) : (
                                  <View style={styles.brgyAvailableBadge}>
                                    <Text style={styles.brgyAvailableBadgeText}>Available</Text>
                                  </View>
                                )}
                              </View>

                              {isSelected && (
                                <MaterialIcons
                                  name={isTaken ? 'error-outline' : 'check'}
                                  size={16}
                                  color={isTaken ? '#DC2626' : '#059669'}
                                />
                              )}
                            </TouchableOpacity>
                          );
                        })}
                      </ScrollView>
                    </View>
                  )}
                </View>
              );
            })()}

            {/* Official Employee ID field */}
            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>
                OFFICIAL EMPLOYEE ID <Text style={styles.requiredAsterisk}>*</Text>
              </Text>
              <View style={styles.inputWithIcon}>
                <MaterialIcons name="badge" size={18} color="#059669" style={styles.inputLeftIcon} />
                <TextInput
                  style={[styles.modalInputWithIcon, { color: '#0F172A', fontWeight: '700' }]}
                  placeholder={elevateTargetRole === 'cenro' ? 'e.g. CENRO-1024' : 'e.g. CENRO-COORD-003'}
                  placeholderTextColor="#94A3B8"
                  value={elevateEmployeeId}
                  onChangeText={setElevateEmployeeId}
                  autoCapitalize="characters"
                />
              </View>
            </View>

            {/* Info notice */}
            <View style={styles.elevateInfoBox}>
              <MaterialIcons name="info" size={18} color="#059669" style={{ marginTop: 1 }} />
              <Text style={styles.elevateInfoText}>
                The user&apos;s existing login password will remain active. They can immediately log in to the administrative portal at{' '}
                <Text style={{ fontWeight: '800' }}>/admin/login</Text>.
              </Text>
            </View>

            {/* Actions */}
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => setIsElevateModalOpen(false)}
                disabled={isSubmittingElevation}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              {(() => {
                const isTaken = elevateTargetRole === 'coordinator' && !!isBarangayAssignedToOther(elevateBarangay);
                const isBlocked = isSubmittingElevation;

                return (
                  <TouchableOpacity
                    style={[
                      styles.modalConfirm,
                      { backgroundColor: isTaken ? '#D97706' : '#059669' },
                      isBlocked && { opacity: 0.65 },
                    ]}
                    onPress={handleConfirmElevation}
                    disabled={isBlocked}
                  >
                    {isSubmittingElevation ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Text style={styles.modalConfirmText}>
                        {isTaken ? '🔄 Reassign & Elevate' : '✨ Elevate Account'}
                      </Text>
                    )}
                  </TouchableOpacity>
                );
              })()}
            </View>
          </View>
        </View>
      </Modal>

      {/* Resident Document / ID Verification Modal */}
      <Modal visible={Boolean(viewingIdUser)} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { maxWidth: 540 }]}>
            <View style={styles.modalHeaderRow}>
              <View style={[styles.modalHeaderIconBadge, { backgroundColor: '#FEF3C7' }]}>
                <MaterialIcons name="verified-user" size={24} color="#D97706" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Resident Validation Review</Text>
                <Text style={styles.modalSub}>
                  Inspect proof of residency document submitted during account registration.
                </Text>
              </View>
              <TouchableOpacity
                style={styles.modalCloseIconBtn}
                onPress={() => setViewingIdUser(null)}
                disabled={isVerifyingUser}
              >
                <MaterialIcons name="close" size={20} color="#64748B" />
              </TouchableOpacity>
            </View>

            {viewingIdUser && (
              <ScrollView style={{ maxHeight: 520 }} showsVerticalScrollIndicator={false}>
                {/* User & Barangay Summary */}
                <View style={styles.userInfoBox}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={styles.userInfoBoxName}>{viewingIdUser.displayName || viewingIdUser.name || 'Resident'}</Text>
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
                            ? styles.verifyPillTextRejected
                            : styles.verifyPillTextPending,
                        ]}
                      >
                        {viewingIdUser.verificationStatus === 'verified'
                          ? (viewingIdUser.confirmedByCenro ? 'CONFIRMED BY CENRO' : 'ID VERIFIED')
                          : (viewingIdUser.verificationStatus || 'PENDING').toUpperCase()}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.userInfoBoxEmail}>{viewingIdUser.email}</Text>
                  <Text style={styles.userInfoBoxEmpId}>
                    Registered Sector: {(() => {
                      const b = (viewingIdUser.barangay || viewingIdUser.assignedBarangay || '').trim() ||
                        (viewingIdUser.role === 'admin' || viewingIdUser.role === 'cenro' || viewingIdUser.role === 'cicto' || isUserCoordinator(viewingIdUser) ? 'CITY' : '');
                      if (!b) return 'Unassigned';
                      return b.toUpperCase() === 'CITY' ? 'CITY (City-Wide Jurisdiction)' : `Brgy. ${b}`;
                    })()}
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

                {/* Review Decision Actions / Verification Status Completion */}
                {viewingIdUser.verificationStatus === 'verified' ? (
                  <View style={styles.verifiedStatusBannerCard}>
                    <View style={styles.verifiedStatusHeaderRow}>
                      <MaterialIcons
                        name="verified"
                        size={22}
                        color={viewingIdUser.confirmedByCenro ? '#0D9488' : '#059669'}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.verifiedStatusTitle, viewingIdUser.confirmedByCenro && { color: '#0F766E' }]}>
                          {viewingIdUser.confirmedByCenro
                            ? 'Resident ID Verified • Confirmed by CENRO'
                            : 'Resident ID Officially Verified'}
                        </Text>
                        <Text style={styles.verifiedStatusSub}>
                          {viewingIdUser.confirmedByCenro
                            ? `Accepted and confirmed by CENRO (${viewingIdUser.cenroConfirmedBy || 'CENRO Office'}). Verification choices concluded.`
                            : `Verified by ${viewingIdUser.verifiedBy || 'CICTO Administrator'}. Document review is concluded.`}
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
                        <Text style={styles.rejectedStatusTitle}>Document Marked as Rejected</Text>
                        <Text style={styles.rejectedStatusSub}>
                          {viewingIdUser.rejectionReason
                            ? `Reason: ${viewingIdUser.rejectionReason}`
                            : 'This submission does not verify residency. The resident must re-upload a valid ID.'}
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
                ) : (
                  <View style={styles.verifyModalActionsRow}>
                    <TouchableOpacity
                      style={[styles.verifyBtnApprove, isVerifyingUser && { opacity: 0.6 }]}
                      onPress={() => handleApproveVerification(viewingIdUser)}
                      disabled={isVerifyingUser}
                      activeOpacity={0.8}
                    >
                      {isVerifyingUser ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <>
                          <MaterialIcons name="check-circle" size={18} color="#FFFFFF" style={{ marginRight: 6 }} />
                          <Text style={styles.verifyBtnApproveText}>Approve & Verify Resident</Text>
                        </>
                      )}
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.verifyBtnReject, isVerifyingUser && { opacity: 0.6 }]}
                      onPress={() => handleRejectVerification(viewingIdUser)}
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

      {/* Assign User Privileges Modal */}
      <Modal visible={isPrivilegesModalOpen} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { maxWidth: 640, maxHeight: '92%' }]}>
            <View style={styles.modalHeaderRow}>
              <View style={[styles.modalHeaderIconBadge, { backgroundColor: '#F0FDFA', borderColor: '#CCFBF1' }]}>
                <MaterialIcons name="security" size={24} color="#0D9488" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Assign Operational Privileges</Text>
                <Text style={styles.modalSub}>
                  Configure fine-grained system capabilities and administrative permissions.
                </Text>
              </View>
              <TouchableOpacity
                style={styles.modalCloseIconBtn}
                onPress={() => setIsPrivilegesModalOpen(false)}
                disabled={isSavingPrivileges}
              >
                <MaterialIcons name="close" size={20} color="#64748B" />
              </TouchableOpacity>
            </View>

            {privilegesUser && (
              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingRight: 6, paddingBottom: 16 }}
                showsVerticalScrollIndicator={true}
              >
                {/* Target User Info Card */}
                <View style={styles.userInfoBox}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={styles.userInfoBoxName}>{privilegesUser.displayName || 'Unnamed User'}</Text>
                    {(() => {
                      const isCenro = privilegesUser.role === 'admin' || privilegesUser.role === 'cenro';
                      const isCicto = privilegesUser.role === 'cicto' || isCictoEmail(privilegesUser.email);
                      const isCoord = isUserCoordinator(privilegesUser);
                      return (
                        <View style={[
                          styles.roleBadge,
                          isCicto ? styles.roleBadgeCicto : isCenro ? styles.roleBadgeAdmin : isCoord ? styles.roleBadgeCoordinator : styles.roleBadgeUser
                        ]}>
                          <Text style={[
                            styles.roleBadgeText,
                            isCicto ? styles.roleBadgeTextCicto : isCenro ? styles.roleBadgeTextAdmin : isCoord ? styles.roleBadgeTextCoordinator : styles.roleBadgeTextUser
                          ]}>
                            {isCicto ? 'CICTO ADMIN' : isCenro ? 'CENRO ADMIN' : isCoord ? 'COORDINATOR' : (privilegesUser.role ? privilegesUser.role.toUpperCase() : 'RESIDENT')}
                          </Text>
                        </View>
                      );
                    })()}
                  </View>
                  <Text style={styles.userInfoBoxEmail}>{privilegesUser.email}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                    {(() => {
                      const b = (privilegesUser.barangay || privilegesUser.assignedBarangay || '').trim() ||
                        (privilegesUser.role === 'admin' || privilegesUser.role === 'cenro' || privilegesUser.role === 'cicto' || isUserCoordinator(privilegesUser) ? 'CITY' : '');
                      const isCity = b.toUpperCase() === 'CITY';
                      return (
                        <View style={[styles.barangayBadge, isCity && styles.barangayCityBadge]}>
                          <MaterialIcons
                            name={isCity ? "location-city" : "location-on"}
                            size={12}
                            color={isCity ? "#0F766E" : "#0D9488"}
                          />
                          <Text style={[styles.barangayBadgeText, isCity && styles.barangayCityBadgeText]}>
                            {isCity ? 'CITY (City-Wide)' : `Brgy. ${b || 'Unassigned'}`}
                          </Text>
                        </View>
                      );
                    })()}
                    {privilegesUser.employeeId ? (
                      <View style={styles.empIdBadge}>
                        <MaterialIcons name="badge" size={12} color="#0369A1" />
                        <Text style={styles.empIdBadgeText}>ID: {privilegesUser.employeeId}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>

                {/* Quick Presets */}
                <View style={{ marginBottom: 14 }}>
                  <Text style={[styles.formLabel, { marginBottom: 8 }]}>QUICK PRESETS</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    <TouchableOpacity
                      style={[styles.presetPill, { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' }]}
                      onPress={() => handleApplyPrivilegePreset('all')}
                      activeOpacity={0.7}
                    >
                      <MaterialIcons name="bolt" size={14} color="#059669" />
                      <Text style={[styles.presetPillText, { color: '#065F46' }]}>Full Administrator (All)</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.presetPill, { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' }]}
                      onPress={() => handleApplyPrivilegePreset('field')}
                      activeOpacity={0.7}
                    >
                      <MaterialIcons name="local-shipping" size={14} color="#2563EB" />
                      <Text style={[styles.presetPillText, { color: '#1E40AF' }]}>Field Operations</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.presetPill, { backgroundColor: '#F5F3FF', borderColor: '#DDD6FE' }]}
                      onPress={() => handleApplyPrivilegePreset('auditor')}
                      activeOpacity={0.7}
                    >
                      <MaterialIcons name="visibility" size={14} color="#7C3AED" />
                      <Text style={[styles.presetPillText, { color: '#5B21B6' }]}>Auditor (Read-Only)</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.presetPill, { backgroundColor: '#FEF2F2', borderColor: '#FECACA' }]}
                      onPress={() => handleApplyPrivilegePreset('clear')}
                      activeOpacity={0.7}
                    >
                      <MaterialIcons name="clear-all" size={14} color="#DC2626" />
                      <Text style={[styles.presetPillText, { color: '#B91C1C' }]}>Clear All</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Privileges Checklist Header */}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <Text style={styles.formLabel}>GRANTED SYSTEM PRIVILEGES</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <View style={styles.privilegeStatChip}>
                      <MaterialIcons name="visibility" size={12} color="#0D9488" />
                      <Text style={styles.privilegeStatChipText}>
                        {SYSTEM_PRIVILEGES.filter(p => hasReadPrivilege(selectedPrivileges, p.id)).length} Read
                      </Text>
                    </View>
                    <View style={[styles.privilegeStatChip, { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' }]}>
                      <MaterialIcons name="edit" size={12} color="#059669" />
                      <Text style={[styles.privilegeStatChipText, { color: '#065F46' }]}>
                        {SYSTEM_PRIVILEGES.filter(p => hasWritePrivilege(selectedPrivileges, p.id)).length} Write
                      </Text>
                    </View>
                  </View>
                </View>

                <View style={{ gap: 9 }}>
                  {SYSTEM_PRIVILEGES.map(priv => {
                    const isRead = hasReadPrivilege(selectedPrivileges, priv.id);
                    const isWrite = hasWritePrivilege(selectedPrivileges, priv.id);
                    const isGranted = isRead || isWrite;
                    return (
                      <View
                        key={priv.id}
                        style={[
                          styles.privilegeItemCard,
                          isGranted && styles.privilegeItemCardGranted,
                        ]}
                      >
                        {/* Left: Privilege Icon */}
                        <View style={[styles.privilegeIconWrap, isGranted && styles.privilegeIconWrapGranted]}>
                          <MaterialIcons name={priv.icon} size={20} color={isGranted ? '#0D9488' : '#64748B'} />
                        </View>

                        {/* Middle: Title, Category Badge, and Description */}
                        <View style={{ flex: 1, marginRight: 8 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <Text style={[styles.privilegeName, isGranted && styles.privilegeNameGranted]}>
                              {priv.name}
                            </Text>
                            <View style={[styles.privilegeCatBadge, {
                              backgroundColor: priv.category === 'operations' ? '#ECFDF5' : priv.category === 'telemetry' ? '#EFF6FF' : priv.category === 'reporting' ? '#FEF3C7' : '#F1F5F9'
                            }]}>
                              <Text style={[styles.privilegeCatBadgeText, {
                                color: priv.category === 'operations' ? '#059669' : priv.category === 'telemetry' ? '#2563EB' : priv.category === 'reporting' ? '#D97706' : '#475569'
                              }]}>
                                {priv.category.toUpperCase()}
                              </Text>
                            </View>
                          </View>
                          <Text style={styles.privilegeDescription}>
                            {priv.description}
                          </Text>
                        </View>

                        {/* Right: Read & Write Action Buttons */}
                        <View style={styles.privilegeTogglesRow}>
                          <TouchableOpacity
                            style={[
                              styles.privilegeToggleChip,
                              isRead ? styles.privilegeToggleChipReadActive : styles.privilegeToggleChipInactive,
                            ]}
                            onPress={() => handleTogglePrivilegeRead(priv.id)}
                            activeOpacity={0.7}
                            accessibilityRole="checkbox"
                            accessibilityLabel={`Read permission for ${priv.name}`}
                            accessibilityState={{ checked: isRead }}
                          >
                            <View style={[styles.privilegeMiniBox, isRead && styles.privilegeMiniBoxReadActive]}>
                              {isRead ? (
                                <MaterialIcons name="check" size={13} color="#FFFFFF" />
                              ) : null}
                            </View>
                            <Text style={[styles.privilegeToggleText, isRead && styles.privilegeToggleTextReadActive]}>
                              Read
                            </Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={[
                              styles.privilegeToggleChip,
                              isWrite ? styles.privilegeToggleChipWriteActive : styles.privilegeToggleChipInactive,
                            ]}
                            onPress={() => handleTogglePrivilegeWrite(priv.id)}
                            activeOpacity={0.7}
                            accessibilityRole="checkbox"
                            accessibilityLabel={`Write permission for ${priv.name}`}
                            accessibilityState={{ checked: isWrite }}
                          >
                            <View style={[styles.privilegeMiniBox, isWrite && styles.privilegeMiniBoxWriteActive]}>
                              {isWrite ? (
                                <MaterialIcons name="check" size={13} color="#FFFFFF" />
                              ) : null}
                            </View>
                            <Text style={[styles.privilegeToggleText, isWrite && styles.privilegeToggleTextWriteActive]}>
                              Write
                            </Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </ScrollView>
            )}

            {/* Modal Actions */}
            <View style={[styles.modalActions, { marginTop: 16 }]}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => setIsPrivilegesModalOpen(false)}
                disabled={isSavingPrivileges}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirm, isSavingPrivileges && { opacity: 0.7 }]}
                onPress={handleSavePrivileges}
                disabled={isSavingPrivileges}
              >
                {isSavingPrivileges ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalConfirmText}>
                    Save Privileges ({SYSTEM_PRIVILEGES.filter(p => hasReadPrivilege(selectedPrivileges, p.id)).length})
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Enterprise Three Dots Action Menu Modal (Option B) */}
      <Modal
        visible={Boolean(actionMenuUser)}
        transparent
        animationType="fade"
        onRequestClose={() => setActionMenuUser(null)}
      >
        <TouchableOpacity
          style={styles.actionMenuBackdrop}
          activeOpacity={1}
          onPress={() => setActionMenuUser(null)}
        >
          <TouchableOpacity
            style={[styles.actionMenuCard, { maxHeight: '90%' }]}
            activeOpacity={1}
            onPress={(e) => e.stopPropagation?.()}
          >
            {actionMenuUser && (() => {
              const u = actionMenuUser;
              const isProt = u.role === 'cicto' || (u.email && isCictoEmail(u.email));
              const isCenro = u.role === 'admin' || u.role === 'cenro';
              const isCoord = isUserCoordinator(u);
              const isRes = u.role === 'resident' || u.role === 'user' || !u.role;
              const isDrv = u.role === 'driver';
              const isInactive = isUserInactive6Months(u) || u.disabled === true || u.status === 'inactive';
              const userBrgy = (u.barangay || u.assignedBarangay || '').trim();

              return (
                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 4 }}>
                  {/* Action Menu Header */}
                  <View style={styles.actionMenuHeader}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
                      <View style={[styles.actionMenuAvatar, isProt && styles.userAvatarCicto, { overflow: 'hidden' }]}>
                        {(u.photoURL || u.verificationImageUrl) ? (
                          <Image
                            source={{ uri: u.photoURL || u.verificationImageUrl }}
                            style={{ width: '100%', height: '100%' }}
                            resizeMode="cover"
                          />
                        ) : (
                          <Text style={[styles.actionMenuAvatarText, isProt && styles.userAvatarTextCicto]}>
                            {(u.displayName || u.email || 'U').charAt(0).toUpperCase()}
                          </Text>
                        )}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.actionMenuUserName} numberOfLines={1}>
                          {u.displayName || u.email?.split('@')[0]}
                        </Text>
                        <Text style={styles.actionMenuUserEmail} numberOfLines={1}>
                          {u.email}
                        </Text>
                      </View>
                    </View>
                    <TouchableOpacity
                      style={styles.actionMenuCloseBtn}
                      onPress={() => setActionMenuUser(null)}
                      accessibilityLabel="Close actions menu"
                    >
                      <MaterialIcons name="close" size={18} color="#64748B" />
                    </TouchableOpacity>
                  </View>

                  {/* Metadata Badges */}
                  <View style={styles.actionMenuMetaRow}>
                    <View style={styles.actionMenuMetaChip}>
                      <MaterialIcons name="shield" size={12} color="#0D9488" />
                      <Text style={styles.actionMenuMetaChipText}>
                        {isProt
                          ? 'CICTO ADMIN'
                          : isCenro
                          ? 'CENRO'
                          : isCoord
                          ? 'COORDINATOR'
                          : isDrv
                          ? 'DRIVER'
                          : 'RESIDENT'}
                      </Text>
                    </View>
                    <View style={styles.actionMenuMetaChip}>
                      <MaterialIcons name="location-on" size={12} color="#64748B" />
                      <Text style={styles.actionMenuMetaChipText}>
                        {userBrgy ? (userBrgy.toUpperCase() === 'CITY' ? 'CITY (City-Wide)' : `Brgy. ${userBrgy}`) : (isProt || isCenro || isCoord ? 'CITY' : 'Sector Unassigned')}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.actionMenuMetaChip,
                        {
                          borderColor: isInactive ? '#FECACA' : '#BBF7D0',
                          backgroundColor: isInactive ? '#FEF2F2' : '#F0FDF4',
                        },
                      ]}
                    >
                      <View
                        style={[
                          styles.statusDot,
                          { backgroundColor: isInactive ? '#EF4444' : '#10B981' },
                        ]}
                      />
                      <Text
                        style={[
                          styles.actionMenuMetaChipText,
                          { color: isInactive ? '#DC2626' : '#15803D' },
                        ]}
                      >
                        {isInactive ? 'INACTIVE' : 'ACTIVE'}
                      </Text>
                    </View>
                  </View>

                  {/* Account Profile & Verification Summary Card */}
                  <View
                    style={{
                      backgroundColor: '#F8FAFC',
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: '#E2E8F0',
                      padding: 12,
                      marginTop: 10,
                      marginBottom: 12,
                    }}
                  >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <Text style={{ fontSize: 10.5, fontWeight: '800', color: '#475569', letterSpacing: 0.5 }}>
                        ACCOUNT PROFILE & IDENTIFICATION
                      </Text>
                      {!!u.verificationStatus && (
                        <View
                          style={{
                            paddingHorizontal: 7,
                            paddingVertical: 2,
                            borderRadius: 4,
                            backgroundColor: u.verificationStatus === 'verified' ? '#DCFCE7' : '#FEF3C7',
                          }}
                        >
                          <Text
                            style={{
                              fontSize: 9.5,
                              fontWeight: '800',
                              color: u.verificationStatus === 'verified' ? '#166534' : '#B45309',
                            }}
                          >
                            {u.verificationStatus === 'verified' ? 'ID VERIFIED' : u.verificationStatus.toUpperCase()}
                          </Text>
                        </View>
                      )}
                    </View>

                    {/* Legal Name & Phone Breakdown */}
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 8 }}>
                      <View style={{ minWidth: 130, flex: 1 }}>
                        <Text style={{ fontSize: 9.5, fontWeight: '700', color: '#94A3B8' }}>FIRST NAME</Text>
                        <Text style={{ fontSize: 12, fontWeight: '700', color: '#1E293B' }}>
                          {u.firstName || u.displayName?.split(' ')[0] || '—'}
                        </Text>
                      </View>
                      <View style={{ minWidth: 50, flex: 0.4 }}>
                        <Text style={{ fontSize: 9.5, fontWeight: '700', color: '#94A3B8' }}>M.I.</Text>
                        <Text style={{ fontSize: 12, fontWeight: '700', color: '#1E293B' }}>
                          {u.middleInitial ? `${u.middleInitial}.` : '—'}
                        </Text>
                      </View>
                      <View style={{ minWidth: 130, flex: 1 }}>
                        <Text style={{ fontSize: 9.5, fontWeight: '700', color: '#94A3B8' }}>LAST NAME</Text>
                        <Text style={{ fontSize: 12, fontWeight: '700', color: '#1E293B' }}>
                          {u.lastName || (u.displayName?.includes(' ') ? u.displayName.split(' ').slice(-1)[0] : '—')}
                        </Text>
                      </View>
                    </View>

                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 8 }}>
                      <View style={{ minWidth: 140, flex: 1 }}>
                        <Text style={{ fontSize: 9.5, fontWeight: '700', color: '#94A3B8' }}>CONTACT NUMBER</Text>
                        <Text style={{ fontSize: 12, fontWeight: '600', color: '#1E293B' }}>
                          {u.phoneNumber || u.contactInfo || 'None registered'}
                        </Text>
                      </View>
                      <View style={{ minWidth: 140, flex: 1 }}>
                        <Text style={{ fontSize: 9.5, fontWeight: '700', color: '#94A3B8' }}>BARANGAY SECTOR</Text>
                        <Text style={{ fontSize: 12, fontWeight: '600', color: '#1E293B' }}>
                          {userBrgy ? (userBrgy.toUpperCase() === 'CITY' ? 'CITY (City-Wide Jurisdiction)' : `Brgy. ${userBrgy}`) : (isProt || isCenro || isCoord ? 'CITY (City-Wide Jurisdiction)' : 'Sector Unassigned')}
                        </Text>
                      </View>
                    </View>

                    {/* Uploaded Verification Picture / Document Preview */}
                    {u.verificationImageUrl ? (
                      <View
                        style={{
                          backgroundColor: '#FFFFFF',
                          borderRadius: 8,
                          borderWidth: 1,
                          borderColor: '#CBD5E1',
                          padding: 8,
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 10,
                          marginTop: 4,
                        }}
                      >
                        <TouchableOpacity
                          onPress={() => {
                            setActionMenuUser(null);
                            setViewingIdUser(u);
                          }}
                          activeOpacity={0.8}
                          style={{ position: 'relative' }}
                        >
                          <Image
                            source={{ uri: u.verificationImageUrl }}
                            style={{
                              width: 64,
                              height: 48,
                              borderRadius: 6,
                              backgroundColor: '#F1F5F9',
                              borderWidth: 1,
                              borderColor: '#94A3B8',
                            }}
                            resizeMode="cover"
                          />
                          <View
                            style={{
                              position: 'absolute',
                              bottom: 2,
                              right: 2,
                              backgroundColor: 'rgba(0,0,0,0.6)',
                              borderRadius: 4,
                              padding: 2,
                            }}
                          >
                            <MaterialIcons name="zoom-in" size={12} color="#FFFFFF" />
                          </View>
                        </TouchableOpacity>

                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 11.5, fontWeight: '700', color: '#1E293B' }} numberOfLines={1}>
                            {u.verificationIdType || 'Barangay Certificate / ID'}
                          </Text>
                          <Text style={{ fontSize: 10, color: '#64748B' }}>
                            Uploaded proof of residency picture
                          </Text>
                          {u.verifiedBy ? (
                            <Text style={{ fontSize: 9.5, color: '#059669', fontWeight: '600', marginTop: 2 }}>
                              Verified by {u.verifiedBy}
                            </Text>
                          ) : null}
                        </View>

                        <TouchableOpacity
                          style={{
                            paddingHorizontal: 9,
                            paddingVertical: 5,
                            borderRadius: 6,
                            backgroundColor: '#F0FDF4',
                            borderWidth: 1,
                            borderColor: '#86EFAC',
                          }}
                          onPress={() => {
                            setActionMenuUser(null);
                            setViewingIdUser(u);
                          }}
                          activeOpacity={0.7}
                        >
                          <Text style={{ fontSize: 10.5, fontWeight: '800', color: '#166534' }}>
                            Inspect ID
                          </Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <View
                        style={{
                          backgroundColor: '#FFFFFF',
                          borderRadius: 8,
                          borderWidth: 1,
                          borderColor: '#E2E8F0',
                          padding: 8,
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 8,
                          marginTop: 4,
                        }}
                      >
                        <MaterialIcons name="info-outline" size={16} color="#94A3B8" />
                        <Text style={{ fontSize: 11, color: '#64748B' }}>
                          No verification ID document uploaded yet.
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Actions List */}
                  {isProt ? (
                    <View style={styles.actionMenuProtectedNotice}>
                      <MaterialIcons name="lock" size={24} color="#0D9488" />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.actionMenuProtectedTitle}>Root Authority Protected</Text>
                        <Text style={styles.actionMenuProtectedSub}>
                          CICTO Super Administrator accounts hold immutable municipal root governance privileges and cannot be modified or suspended from this console.
                        </Text>
                      </View>
                    </View>
                  ) : (
                    <View style={styles.actionMenuList}>
                      {/* 1. Assign Operational Privileges */}
                      <TouchableOpacity
                        style={styles.actionMenuItem}
                        onPress={() => {
                          setActionMenuUser(null);
                          handleOpenPrivilegesModal(u);
                        }}
                        activeOpacity={0.7}
                      >
                        <View style={[styles.actionMenuIconWrap, { backgroundColor: '#F0FDFA' }]}>
                          <MaterialIcons name="security" size={18} color="#0D9488" />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.actionMenuItemTitle}>Assign Operational Privileges</Text>
                          <Text style={styles.actionMenuItemDesc}>
                            Configure granular system permissions ({SYSTEM_PRIVILEGES.filter((p) => hasReadPrivilege(u.privileges || [], p.id)).length} Read · {SYSTEM_PRIVILEGES.filter((p) => hasWritePrivilege(u.privileges || [], p.id)).length} Write)
                          </Text>
                        </View>
                        <MaterialIcons name="chevron-right" size={18} color="#94A3B8" />
                      </TouchableOpacity>

                      {/* 2. Elevate / Change Role */}
                      <TouchableOpacity
                        style={styles.actionMenuItem}
                        onPress={() => {
                          setActionMenuUser(null);
                          handleOpenElevateModal(u);
                        }}
                        activeOpacity={0.7}
                      >
                        <View style={[styles.actionMenuIconWrap, { backgroundColor: '#ECFDF5' }]}>
                          <MaterialIcons name="admin-panel-settings" size={18} color="#059669" />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.actionMenuItemTitle}>
                            {isRes ? 'Elevate Account Role' : 'Change Municipal Role'}
                          </Text>
                          <Text style={styles.actionMenuItemDesc}>
                            {isRes
                              ? 'Promote to CENRO Admin or Coordinator'
                              : 'Reassign official designation and operational tier'}
                          </Text>
                        </View>
                        <MaterialIcons name="chevron-right" size={18} color="#94A3B8" />
                      </TouchableOpacity>

                      {/* 3. Review Verification ID (if resident) */}
                      {isRes && (
                        <TouchableOpacity
                          style={styles.actionMenuItem}
                          onPress={() => {
                            setActionMenuUser(null);
                            if (u.verificationImageUrl) {
                              setViewingIdUser(u);
                            } else {
                              Alert.alert(
                                'No Verification Document',
                                `${u.displayName || u.email} has not submitted a government ID for verification yet.`
                              );
                            }
                          }}
                          activeOpacity={0.7}
                        >
                          <View style={[styles.actionMenuIconWrap, { backgroundColor: '#F5F3FF' }]}>
                            <MaterialIcons name="badge" size={18} color="#7C3AED" />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.actionMenuItemTitle}>Review Verification ID & Document Photo</Text>
                            <Text style={styles.actionMenuItemDesc}>
                              {u.verificationImageUrl
                                ? `Inspect submitted ${u.verificationIdType || 'ID Document'} (${(u.verificationStatus || 'pending').toUpperCase()})`
                                : 'No ID document submitted yet'}
                            </Text>
                          </View>
                          <MaterialIcons name="chevron-right" size={18} color="#94A3B8" />
                        </TouchableOpacity>
                      )}

                      {/* 4. Assign / Reassign Barangay Sector */}
                      <TouchableOpacity
                        style={styles.actionMenuItem}
                        onPress={() => {
                          setActionMenuUser(null);
                          handleOpenEditUser(u);
                        }}
                        activeOpacity={0.7}
                      >
                        <View style={[styles.actionMenuIconWrap, { backgroundColor: '#F0F9FF' }]}>
                          <MaterialIcons name="edit-location-alt" size={18} color="#0284C7" />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.actionMenuItemTitle}>Assign Barangay Sector</Text>
                          <Text style={styles.actionMenuItemDesc}>
                            {userBrgy
                              ? `Currently registered in Brgy. ${userBrgy}`
                              : 'Assign official Danao City sector'}
                          </Text>
                        </View>
                        <MaterialIcons name="chevron-right" size={18} color="#94A3B8" />
                      </TouchableOpacity>

                      {/* 5. Suspend / Reactivate (Residents, Coordinators, Drivers) */}
                      {!isCenro && (
                        <TouchableOpacity
                          style={styles.actionMenuItem}
                          onPress={() => {
                            setActionMenuUser(null);
                            handleToggleResidentStatus(u);
                          }}
                          activeOpacity={0.7}
                        >
                          <View
                            style={[
                              styles.actionMenuIconWrap,
                              { backgroundColor: isInactive ? '#F0FDF4' : '#FFFBEB' },
                            ]}
                          >
                            <MaterialIcons
                              name={isInactive ? 'play-arrow' : 'pause'}
                              size={18}
                              color={isInactive ? '#15803D' : '#D97706'}
                            />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.actionMenuItemTitle}>
                              {isInactive ? 'Reactivate Account' : 'Pause / Suspend Account'}
                            </Text>
                            <Text style={styles.actionMenuItemDesc}>
                              {isInactive
                                ? 'Restore login access and mobile app functions'
                                : 'Temporarily disable user access to the platform'}
                            </Text>
                          </View>
                          <MaterialIcons name="chevron-right" size={18} color="#94A3B8" />
                        </TouchableOpacity>
                      )}

                      {/* 6. Delete Account (Danger Zone) */}
                      <TouchableOpacity
                        style={[styles.actionMenuItem, styles.actionMenuItemDanger]}
                        onPress={() => {
                          setActionMenuUser(null);
                          handleOpenDelete(u);
                        }}
                        activeOpacity={0.7}
                      >
                        <View style={[styles.actionMenuIconWrap, { backgroundColor: '#FEE2E2' }]}>
                          <MaterialIcons name="delete-outline" size={18} color="#DC2626" />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.actionMenuItemTitle, { color: '#DC2626' }]}>
                            Delete Account
                          </Text>
                          <Text style={[styles.actionMenuItemDesc, { color: '#EF4444' }]}>
                            Permanently purge account with 2FA security PIN
                          </Text>
                        </View>
                        <MaterialIcons name="chevron-right" size={18} color="#F87171" />
                      </TouchableOpacity>
                    </View>
                  )}
                </ScrollView>
              );
            })()}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <ExportModal
        visible={isExportModalVisible}
        onClose={() => setIsExportModalVisible(false)}
        title="CICTO Identity & Access Directory"
        dataCount={filteredUsers.length}
        onExport={handleExportUsers}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  content: { padding: 28, paddingBottom: 60 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 24,
    gap: 16,
    flexWrap: 'wrap',
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
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
    marginTop: 4,
  },
  sub: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 4,
    maxWidth: 620,
    lineHeight: 18,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  staleCleanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
  },
  staleCleanBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#DC2626',
  },
  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#0D9488',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    shadowColor: '#0D9488',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 2,
  },
  exportBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  provisionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#0D9488',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    boxShadow: '0 4px 6px -1px rgba(13, 148, 136, 0.25)',
  },
  provisionBtnText: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  filterSection: {
    marginBottom: 16,
    gap: 12,
    position: 'relative',
  },
  filterBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    alignItems: 'center',
    position: 'relative',
  },
  searchBox: {
    flex: 1,
    minWidth: 260,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 12.5,
    color: '#0F172A',
    padding: 0,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  dropdownContainer: {
    position: 'relative',
  },
  filterDropdownBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    minWidth: 190,
    gap: 8,
  },
  filterDropdownBtnActive: {
    borderColor: '#0D9488',
    backgroundColor: '#F0FDFA',
  },
  filterDropdownBtnOpen: {
    borderColor: '#0D9488',
    boxShadow: '0 0 0 2px rgba(13, 148, 136, 0.15)',
  },
  dropdownBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  filterDropdownText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
    flex: 1,
  },
  filterDropdownTextActive: {
    color: '#0F766E',
    fontWeight: '800',
  },
  barangayDropdownMenu: {
    position: 'absolute',
    top: 44,
    left: 0,
    width: 270,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.1)',
    zIndex: 99999,
    elevation: 99999,
    overflow: 'hidden',
  },
  dropdownSearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    backgroundColor: '#F8FAFC',
    gap: 6,
  },
  dropdownSearchInput: {
    flex: 1,
    fontSize: 12,
    color: '#0F172A',
    padding: 0,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  barangayDropdownScroll: {
    maxHeight: 280,
    ...(Platform.OS === 'web'
      ? ({
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
        } as any)
      : {}),
  },
  barangayDropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F8FAFC',
  },
  barangayDropdownItemSelected: {
    backgroundColor: '#F0FDFA',
  },
  barangayDropdownItemText: {
    fontSize: 12,
    color: '#334155',
    fontWeight: '500',
  },
  barangayDropdownItemTextSelected: {
    color: '#0D9488',
    fontWeight: '800',
  },
  dropdownDivider: {
    height: 1,
    backgroundColor: '#E2E8F0',
    marginVertical: 4,
  },
  countBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: '#F1F5F9',
  },
  countBadgeText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#64748B',
  },
  noDropdownMatchText: {
    padding: 16,
    textAlign: 'center',
    color: '#94A3B8',
    fontSize: 11.5,
    fontStyle: 'italic',
  },
  roleTabsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterGroup: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  filterChipActive: {
    backgroundColor: '#0D9488',
    borderColor: '#0D9488',
  },
  filterChipText: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#64748B',
  },
  filterChipTextActive: {
    color: '#FFFFFF',
  },
  roleChipBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 5,
    backgroundColor: '#F1F5F9',
  },
  roleChipBadgeActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
  },
  roleChipBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748B',
  },
  roleChipBadgeTextActive: {
    color: '#FFFFFF',
  },
  activeFilterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#CCFBF1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    flexWrap: 'wrap',
  },
  activeFilterTags: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  activeFilterLabel: {
    fontSize: 10,
    fontWeight: '900',
    color: '#0F766E',
    letterSpacing: 0.8,
  },
  activeTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#CCFBF1',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  activeTagText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0F766E',
  },
  clearAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  clearAllBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
  },
  resultsSummaryRow: {
    marginBottom: 8,
    zIndex: 1,
  },
  resultsSummaryText: {
    fontSize: 11.5,
    color: '#64748B',
  },
  tableCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    overflow: 'hidden',
    zIndex: 1,
  },
  tableHead: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    backgroundColor: '#F8FAFC',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  th: {
    fontSize: 9.5,
    fontWeight: '900',
    color: '#64748B',
    letterSpacing: 0.8,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  userCell: {
    gap: 4,
  },
  userAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  userAvatarCicto: {
    backgroundColor: '#CCFBF1',
  },
  userAvatarText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#475569',
  },
  userAvatarTextCicto: {
    color: '#0F766E',
  },
  userName: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
  },
  userEmail: {
    fontSize: 11.5,
    color: '#64748B',
  },
  userSubInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginLeft: 40,
  },
  empIdBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#CCFBF1',
  },
  empIdBadgeText: {
    fontSize: 9.5,
    color: '#0D9488',
    fontWeight: '800',
  },
  phoneText: {
    fontSize: 10.5,
    color: '#64748B',
  },
  barangayBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#CCFBF1',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: 'flex-start',
    maxWidth: 130,
  },
  barangayBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0F766E',
  },
  barangayUnassignedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  barangayUnassignedText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#94A3B8',
  },
  barangayCityBadge: {
    backgroundColor: '#CCFBF1',
    borderColor: '#99F6E4',
  },
  barangayCityBadgeText: {
    color: '#0F766E',
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  roleBadgeCicto: { backgroundColor: '#F0FDFA' },
  roleBadgeAdmin: { backgroundColor: '#F0FDF4' },
  roleBadgeCoordinator: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  roleBadgeDriver: { backgroundColor: '#FEF3C7' },
  roleBadgeUser: { backgroundColor: '#F1F5F9' },
  roleBadgeText: { fontSize: 10, fontWeight: '800' },
  roleBadgeTextCicto: { color: '#0F766E' },
  roleBadgeTextAdmin: { color: '#166534' },
  roleBadgeTextCoordinator: { color: '#065F46' },
  roleBadgeTextDriver: { color: '#B45309' },
  roleBadgeTextUser: { color: '#475569' },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 10.5,
    fontWeight: '800',
  },
  inactivitySubText: {
    fontSize: 9.5,
    color: '#94A3B8',
    marginTop: 2,
  },
  actionsCell: {
    width: 80,
    flexShrink: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  moreActionBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionIconBtn: {
    width: 30,
    height: 30,
    borderRadius: 7,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionIconBtnDeactivate: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  actionIconBtnReactivate: {
    backgroundColor: '#F0FDF4',
    borderColor: '#BBF7D0',
  },
  actionIconBtnDelete: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  loaderContainer: {
    padding: 40,
    alignItems: 'center',
    gap: 12,
  },
  loaderText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#334155',
    marginTop: 8,
  },
  emptySub: {
    fontSize: 12,
    color: '#94A3B8',
    maxWidth: 320,
    textAlign: 'center',
  },
  emptyResetBtn: {
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#0D9488',
  },
  emptyResetBtnText: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    gap: 16,
    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
    overflow: 'visible',
  },
  modalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  modalHeaderIconBadge: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#CCFBF1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCloseIconBtn: {
    padding: 4,
  },
  deleteHeaderIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FEF2F2',
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
  },
  modalTitle: {
    fontSize: 16.5,
    fontWeight: '800',
    color: '#0F172A',
  },
  modalSub: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 17,
    marginTop: 2,
  },
  userInfoBox: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 12,
    gap: 4,
  },
  userInfoBoxName: {
    fontSize: 13.5,
    fontWeight: '800',
    color: '#0F172A',
  },
  userInfoBoxEmail: {
    fontSize: 11.5,
    color: '#64748B',
  },
  userInfoBoxEmpId: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0D9488',
    marginTop: 2,
  },
  formGroup: {
    gap: 6,
  },
  formLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#475569',
    letterSpacing: 0.5,
  },
  requiredAsterisk: {
    color: '#EF4444',
    fontWeight: '800',
  },
  formHelper: {
    fontSize: 11,
    color: '#64748B',
    fontStyle: 'italic',
  },
  formRow: {
    flexDirection: 'row',
    gap: 12,
  },
  inputWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  inputLeftIcon: {
    marginRight: 8,
  },
  inputRightAction: {
    padding: 6,
  },
  modalInputWithIcon: {
    flex: 1,
    paddingVertical: 10,
    fontSize: 13,
    color: '#0F172A',
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  modalInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: '#0F172A',
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  otpLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    marginTop: 4,
    marginBottom: 4,
  },
  otpInput: {
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 4,
    textAlign: 'center',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
    zIndex: 1,
  },
  modalCancel: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
  },
  modalConfirm: {
    flex: 1.3,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#0D9488',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 4px 6px -1px rgba(13, 148, 136, 0.25)',
  },
  modalConfirmText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  regenerateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 6,
    backgroundColor: '#F0FDFA',
  },
  regenerateText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0D9488',
  },
  readOnlyInputBox: {
    backgroundColor: '#F1F5F9',
    borderColor: '#CBD5E1',
  },
  readOnlyText: {
    fontWeight: '700',
    letterSpacing: 1,
    color: '#0F172A',
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: '#CCFBF1',
    marginLeft: 4,
  },
  copyBtnSuccess: {
    backgroundColor: '#DCFCE7',
  },
  copyBtnText: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#0D9488',
  },
  copyBtnTextSuccess: {
    color: '#166534',
  },
  dropdownBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 42,
  },
  dropdownBtnActive: {
    borderColor: '#0D9488',
    backgroundColor: '#FFFFFF',
    boxShadow: '0 0 0 2px rgba(13, 148, 136, 0.15)',
  },
  dropdownBtnText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: '#0F172A',
    flex: 1,
    marginRight: 6,
  },
  dropdownMenu: {
    position: 'absolute',
    top: 66,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.1)',
    zIndex: 99999,
    elevation: 99999,
    overflow: 'hidden',
  },
  dropdownMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  dropdownMenuItemSelected: {
    backgroundColor: '#F0FDFA',
  },
  dropdownMenuItemText: {
    fontSize: 12,
    color: '#334155',
    fontWeight: '500',
    flex: 1,
  },
  dropdownMenuItemTextSelected: {
    color: '#0D9488',
    fontWeight: '700',
  },
  elevateHeaderIconBadge: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  elevateUserCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 12,
  },
  elevateUserAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#059669',
    justifyContent: 'center',
    alignItems: 'center',
  },
  elevateUserAvatarText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  elevateUserName: {
    fontSize: 13.5,
    fontWeight: '800',
    color: '#0F172A',
  },
  elevateUserEmail: {
    fontSize: 11.5,
    color: '#64748B',
  },
  roleOptionCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
  },
  roleOptionCardSelected: {
    borderColor: '#059669',
    backgroundColor: '#F0FDF4',
  },
  roleOptionRadio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: '#94A3B8',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
  },
  roleOptionRadioSelected: {
    borderColor: '#059669',
  },
  roleOptionRadioInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#059669',
  },
  roleOptionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
  },
  roleOptionSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
    lineHeight: 15,
  },
  roleOptionTag: {
    alignSelf: 'flex-start',
    marginTop: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: '#F1F5F9',
  },
  roleOptionTagSelected: {
    backgroundColor: '#DCFCE7',
  },
  roleOptionTagText: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#475569',
  },
  roleOptionTagTextSelected: {
    color: '#166534',
  },
  elevateInfoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#CCFBF1',
    borderRadius: 8,
    padding: 10,
  },
  elevateInfoText: {
    fontSize: 11,
    color: '#0F766E',
    flex: 1,
    lineHeight: 16,
  },
  dropdownMenuItemDisabled: {
    backgroundColor: '#F8FAFC',
    opacity: 0.75,
  },
  dropdownMenuItemTextDisabled: {
    color: '#94A3B8',
    textDecorationLine: 'line-through',
  },
  dropdownMenuItemSelectedTaken: {
    backgroundColor: '#FEF2F2',
  },
  brgyTakenBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  brgyTakenBadgeText: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#DC2626',
    maxWidth: 140,
  },
  brgyAvailableBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  brgyAvailableBadgeText: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#166534',
  },
  brgyWarningBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 8,
    padding: 10,
    marginTop: 6,
  },
  brgyWarningText: {
    fontSize: 11,
    color: '#991B1B',
    flex: 1,
    lineHeight: 15,
  },
  brgyPolicyNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: 8,
    padding: 8,
    marginTop: 6,
  },
  brgyPolicyNoticeText: {
    fontSize: 11,
    color: '#166534',
    fontWeight: '600',
    flex: 1,
  },
  pinDisplayCard: {
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#99F6E4',
    borderRadius: 8,
    padding: 12,
    marginBottom: 14,
    alignItems: 'center',
  },
  pinDisplayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  pinDisplayTitle: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#0F766E',
  },
  pinDisplayCode: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 4,
    color: '#0F766E',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    marginVertical: 4,
  },
  pinDisplayHint: {
    fontSize: 11,
    color: '#115E59',
    textAlign: 'center',
    lineHeight: 15,
  },
  verifyPillBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  verifyPillVerified: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  verifyPillRejected: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  verifyPillPending: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  verifyPillUnsubmitted: {
    backgroundColor: '#F1F5F9',
    borderColor: '#E2E8F0',
  },
  verifyPillText: {
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  verifyPillTextVerified: {
    color: '#059669',
  },
  verifyPillTextRejected: {
    color: '#DC2626',
  },
  verifyPillTextPending: {
    color: '#D97706',
  },
  verifyPillTextUnsubmitted: {
    color: '#64748B',
  },
  docMetadataCard: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    gap: 6,
  },
  docMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  docMetaLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
  },
  docMetaValue: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
  },
  docImageContainer: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 10,
    marginBottom: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  docImageHeader: {
    fontSize: 10,
    fontWeight: '800',
    color: '#94A3B8',
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  fullDocImage: {
    width: '100%',
    height: 260,
    borderRadius: 8,
    backgroundColor: '#1E293B',
  },
  noDocImageBox: {
    height: 180,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noDocImageText: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 6,
    fontWeight: '600',
  },
  verifyModalActionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
    marginBottom: 10,
  },
  verifyBtnApprove: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#15803D',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  verifyBtnApproveText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  verifyBtnReject: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  verifyPillCenro: {
    backgroundColor: '#F0FDFA',
    borderColor: '#99F6E4',
  },
  verifyPillTextCenro: {
    color: '#0D9488',
  },
  verifiedStatusBannerCard: {
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: 12,
    padding: 14,
    marginTop: 4,
    marginBottom: 10,
    gap: 12,
  },
  verifiedStatusHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  verifiedStatusTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#15803D',
  },
  verifiedStatusSub: {
    fontSize: 11.5,
    color: '#166534',
    marginTop: 2,
    lineHeight: 16,
  },
  rejectedStatusBannerCard: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 12,
    padding: 14,
    marginTop: 4,
    marginBottom: 10,
    gap: 12,
  },
  rejectedStatusHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rejectedStatusTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#DC2626',
  },
  rejectedStatusSub: {
    fontSize: 11.5,
    color: '#991B1B',
    marginTop: 2,
    lineHeight: 16,
  },
  verifyModalCloseBtn: {
    height: 40,
    borderRadius: 8,
    backgroundColor: '#15803D',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  verifyModalCloseBtnDark: {
    height: 40,
    borderRadius: 8,
    backgroundColor: '#475569',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  verifyModalCloseBtnText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  verifyBtnRejectText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#DC2626',
  },

  // Assign Privileges Modal Styles (Consultant Revision #12)
  presetPill: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  presetPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  privilegeItemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  privilegeItemCardGranted: {
    backgroundColor: '#F0FDFA',
    borderColor: '#CCFBF1',
  },
  privilegeTogglesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  privilegeToggleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1.5,
  },
  privilegeToggleChipInactive: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
  },
  privilegeToggleChipReadActive: {
    backgroundColor: '#F0FDFA',
    borderColor: '#0D9488',
  },
  privilegeToggleChipWriteActive: {
    backgroundColor: '#ECFDF5',
    borderColor: '#059669',
  },
  privilegeMiniBox: {
    width: 16,
    height: 16,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  privilegeMiniBoxReadActive: {
    backgroundColor: '#0D9488',
    borderColor: '#0D9488',
  },
  privilegeMiniBoxWriteActive: {
    backgroundColor: '#059669',
    borderColor: '#059669',
  },
  privilegeToggleText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
  },
  privilegeToggleTextReadActive: {
    color: '#0F766E',
    fontWeight: '800',
  },
  privilegeToggleTextWriteActive: {
    color: '#065F46',
    fontWeight: '800',
  },
  privilegeStatChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F0FDFA',
    borderColor: '#CCFBF1',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  privilegeStatChipText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0F766E',
  },
  privilegeIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  privilegeIconWrapGranted: {
    backgroundColor: '#CCFBF1',
  },
  privilegeName: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#334155',
  },
  privilegeNameGranted: {
    color: '#0F766E',
    fontWeight: '800',
  },
  privilegeCatBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  privilegeCatBadgeText: {
    fontSize: 9,
    fontWeight: '800',
  },
  privilegeDescription: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
    lineHeight: 15,
  },

  // Option B: Action Menu Modal Styles
  actionMenuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  actionMenuCard: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.05)',
  },
  actionMenuHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    marginBottom: 12,
  },
  actionMenuAvatar: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#0D9488',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionMenuAvatarText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '900',
  },
  actionMenuUserName: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  actionMenuUserEmail: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 1,
  },
  actionMenuCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionMenuMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 14,
  },
  actionMenuMetaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  actionMenuMetaChipText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#475569',
  },
  actionMenuList: {
    gap: 7,
  },
  actionMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  actionMenuItemDanger: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  actionMenuIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  actionMenuItemTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
  },
  actionMenuItemDesc: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
    lineHeight: 14,
  },
  actionMenuProtectedNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    backgroundColor: '#F0FDFA',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CCFBF1',
    marginTop: 4,
  },
  actionMenuProtectedTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F766E',
  },
  actionMenuProtectedSub: {
    fontSize: 11.5,
    color: '#115E59',
    marginTop: 2,
    lineHeight: 16,
  },
});


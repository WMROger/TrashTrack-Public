import { MaterialIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  browserLocalPersistence,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import React, { useEffect, useState } from "react";
import {
  ImageBackground,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { auth, db } from "../../config/firebase";
import {
  HARDCODED_CICTO_ACCOUNT,
  ensureCictoProfileInFirestore,
  isCictoEmail,
  isCictoIdentifier,
  loginOrBootstrapCictoAccount,
} from "../../constants/cictoConfig";
import ErrorModal from "../ErrorModal";
import AdminButton from "./AdminButton";
import AdminInput from "./AdminInput";
import AgencySign from "./AgencySign";
import { SystemBrandingSettings, subscribeToSystemBranding, getCachedSystemBranding } from "../../services/systemBrandingService";

interface PortalLoginFormProps {
  portal: "cenro" | "cicto";
}

export default function PortalLoginForm({ portal }: PortalLoginFormProps) {
  const isCicto = portal === "cicto";
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [keepLoggedIn, setKeepLoggedIn] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [branding, setBranding] = useState<SystemBrandingSettings>(getCachedSystemBranding());

  useEffect(() => {
    const unsub = subscribeToSystemBranding((updated) => {
      setBranding(updated);
    });
    return () => unsub();
  }, []);
  const [errorModal, setErrorModal] = useState({
    visible: false,
    title: "Error",
    message: "",
    type: "error" as "error" | "warning" | "info" | "success",
  });

  // If already authenticated with the correct role, redirect immediately via onAuthStateChanged
  useEffect(() => {
    if (!auth || !db) return;

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) return;

      try {
        const userRef = doc(db, "users", currentUser.uid);
        let snap;
        try {
          snap = await getDocFromServer(userRef);
        } catch {
          snap = await getDoc(userRef);
        }

        if (snap.exists()) {
          const role = String(snap.data()?.role || "").toLowerCase().trim();
          const isUserCicto = role === "cicto" || role === "cicto_admin";
          const isUserCenro =
            role === "admin" ||
            role === "cenro" ||
            role === "coordinator" ||
            role === "barangay_coordinator" ||
            role === "cenro_officer" ||
            role === "mayor";

          if (isCicto && isUserCicto) {
            router.replace("/cicto/dashboard" as any);
          } else if (!isCicto && isUserCenro) {
            router.replace("/admin/dashboard" as any);
          }
        }
      } catch (err) {
        console.warn("Session verification warning in login form:", err);
      }
    });

    return () => unsubscribe();
  }, [isCicto, router]);

  const showError = (
    message: string,
    title = "Error",
    type: "error" | "warning" | "info" | "success" = "error",
  ) => {
    setErrorModal({
      visible: true,
      title,
      message,
      type,
    });
  };

  const closeErrorModal = () => {
    setErrorModal((prev) => ({ ...prev, visible: false }));
  };

  const handleLogin = async () => {
    const effectiveUsername = username.trim();
    const effectivePassword = password.trim();

    if (!effectiveUsername || !effectivePassword) {
      showError(
        "Please enter both username and password",
        "Validation Error",
        "warning",
      );
      return;
    }

    setIsLoading(true);

    try {
      if (isCicto) {
        // --- CICTO PORTAL AUTHENTICATION ---
        const rawUsername = effectiveUsername;

        if (Platform.OS === "web" && auth) {
          try {
            await setPersistence(auth, browserLocalPersistence);
          } catch {}
        }

        let authenticatedUser: any = null;
        if (isCictoIdentifier(rawUsername)) {
          const cictoUser = await loginOrBootstrapCictoAccount(
            rawUsername,
            effectivePassword,
          );
          authenticatedUser = cictoUser.user;
        } else {
          const userCredential = await signInWithEmailAndPassword(
            auth,
            rawUsername,
            effectivePassword,
          );
          authenticatedUser = userCredential.user;
        }

        // Verify the authenticated user has the CICTO role in Firestore
        let userRole = '';
        if (db && authenticatedUser) {
          const userRef = doc(db, 'users', authenticatedUser.uid);
          let snap = await getDoc(userRef);
          if (snap.exists()) {
            userRole = String(snap.data()?.role || '').toLowerCase().trim();
          }
        }

        const normEmail = String(authenticatedUser?.email || '').toLowerCase().trim();
        if (userRole !== 'cicto' && userRole !== 'cicto_admin') {
          if (isCictoEmail(normEmail) || isCictoIdentifier(rawUsername)) {
            if (authenticatedUser?.uid) {
              await ensureCictoProfileInFirestore(
                authenticatedUser.uid,
                normEmail || HARDCODED_CICTO_ACCOUNT.email,
                authenticatedUser.displayName || HARDCODED_CICTO_ACCOUNT.displayName,
              );
              userRole = 'cicto';
            }
          }
        }

        if (userRole !== 'cicto' && userRole !== 'cicto_admin') {
          await signOut(auth);
          showError(
            "Access Denied: This account does not have CICTO administrative privileges. Please ensure your account has been assigned the CICTO role.",
            "Access Denied",
            "error",
          );
          setIsLoading(false);
          return;
        }

        console.log(
          "CICTO authentication successful for:",
          authenticatedUser.email,
        );
        router.replace("/cicto/dashboard" as any);
        return;
      } else {
        // --- CENRO PORTAL AUTHENTICATION ---
        const rawUsername = username.trim();
        const trimmed = rawUsername.toLowerCase();

        // 🛑 STRICT SECURITY GUARD: Never allow CICTO specific credentials in the CENRO login portal
        if (
          isCictoIdentifier(rawUsername) ||
          rawUsername.toUpperCase().startsWith("CICTO-")
        ) {
          showError(
            "Access Denied: CICTO credentials cannot be used to log in to the CENRO portal. Please use the dedicated CICTO portal at /cicto.",
            "Access Denied",
            "error",
          );
          setIsLoading(false);
          return;
        }

        let email = trimmed;
        if (!trimmed.includes("@")) {
          if (trimmed === "admin" || trimmed === "cenro") {
            email = `${trimmed}@admin.com`;
          } else if (db) {
            // Check if user entered an Employee ID (e.g. COORD-XXX, CENRO-XXX)
            try {
              const upperEmpId = rawUsername.toUpperCase();
              if (upperEmpId.startsWith("CICTO-")) {
                showError(
                  "Access Denied: CICTO credentials cannot be used to log in to the CENRO portal. Please use the dedicated CICTO portal at /cicto.",
                  "Access Denied",
                  "error",
                );
                setIsLoading(false);
                return;
              }

              const empQ = query(
                collection(db, "users"),
                where("employeeId", "==", upperEmpId),
                limit(1),
              );
              const empSnap = await getDocs(empQ);
              if (!empSnap.empty && empSnap.docs[0].data()?.email) {
                email = empSnap.docs[0].data().email.toLowerCase().trim();
              } else {
                const identRef = doc(
                  db,
                  "identifiers",
                  "coordinator",
                  "items",
                  upperEmpId,
                );
                const identSnap = await getDoc(identRef);
                if (identSnap.exists() && identSnap.data()?.userId) {
                  const targetUserDoc = await getDoc(
                    doc(db, "users", identSnap.data().userId),
                  );
                  if (targetUserDoc.exists() && targetUserDoc.data()?.email) {
                    email = targetUserDoc.data().email.toLowerCase().trim();
                  }
                }
              }
            } catch (err) {
              console.warn("PortalLoginForm: employee ID lookup failed", err);
            }
          }

          if (!email.includes("@")) {
            showError(
              "Account not found for this ID. Please enter your full registered email address (e.g. yourname@gmail.com).",
              "Invalid Identifier",
              "warning",
            );
            setIsLoading(false);
            return;
          }
        }

        if (Platform.OS === "web" && auth) {
          try {
            await setPersistence(auth, browserLocalPersistence);
          } catch {}
        }
        const userCredential = await signInWithEmailAndPassword(
          auth,
          email,
          password,
        );
        const user = userCredential.user;

        if (db) {
          const userRef = doc(db, "users", user.uid);
          let userSnap;
          try {
            userSnap = await getDocFromServer(userRef);
          } catch {
            userSnap = await getDoc(userRef);
          }

          if (!userSnap.exists()) {
            // Check if this account was provisioned in Firestore under another ID or employee ID
            try {
              const normEmail = (user.email || email).toLowerCase().trim();

              const usersQ = query(
                collection(db, "users"),
                where("email", "==", normEmail),
                limit(5),
              );
              const usersSnap = await getDocs(usersQ);
              let foundAdminData: any = null;
              for (const d of usersSnap.docs) {
                const dData = d.data();
                if (
                  dData.role === "admin" ||
                  dData.role === "cenro" ||
                  dData.role === "coordinator" ||
                  (dData.employeeId &&
                    (String(dData.employeeId)
                      .toUpperCase()
                      .startsWith("CENRO-") ||
                      String(dData.employeeId)
                        .toUpperCase()
                        .startsWith("COORD-")))
                ) {
                  foundAdminData = { ...dData, id: d.id };
                  break;
                } else if (dData.role === "cicto" || dData.role === "cicto_admin") {
                  await signOut(auth);
                  showError(
                    "Access Denied: CICTO credentials cannot be used to log in to the CENRO portal. Please use the dedicated CICTO portal at /cicto.",
                    "Access Denied",
                    "error",
                  );
                  setIsLoading(false);
                  return;
                }
              }

              if (foundAdminData) {
                const targetRole =
                  foundAdminData?.role === "coordinator"
                    ? "coordinator"
                    : "admin";
                const empId =
                  foundAdminData?.employeeId ||
                  (targetRole === "coordinator"
                    ? `COORD-${Math.floor(1000 + Math.random() * 9000)}`
                    : `CENRO-${Math.floor(1000 + Math.random() * 9000)}`);
                await setDoc(
                  userRef,
                  {
                    ...(foundAdminData || {}),
                    uid: user.uid,
                    email: normEmail,
                    displayName:
                      foundAdminData?.displayName ||
                      foundAdminData?.name ||
                      (targetRole === "coordinator"
                        ? "Barangay Coordinator"
                        : "CENRO Administrator"),
                    name:
                      foundAdminData?.displayName ||
                      foundAdminData?.name ||
                      (targetRole === "coordinator"
                        ? "Barangay Coordinator"
                        : "CENRO Administrator"),
                    role: targetRole,
                    verified: true,
                    status: "active",
                    employeeId: empId,
                    department:
                      foundAdminData?.department ||
                      (targetRole === "coordinator"
                        ? "Barangay Environmental Operations"
                        : "Waste Management Operations"),
                    designation:
                      foundAdminData?.designation ||
                      (targetRole === "coordinator"
                        ? "Barangay Environmental Coordinator"
                        : "CENRO Field Officer"),
                    agency: "CENRO Danao City",
                    ...(foundAdminData?.barangay
                      ? {
                          barangay: foundAdminData.barangay,
                          assignedBarangay: foundAdminData.barangay,
                        }
                      : {}),
                    updatedAt: serverTimestamp(),
                    lastLogin: serverTimestamp(),
                  },
                  { merge: true },
                );

                if (empId) {
                  try {
                    const identType =
                      targetRole === "coordinator" ? "coordinator" : "cenro";
                    const identRef = doc(
                      db,
                      "identifiers",
                      identType,
                      "items",
                      empId,
                    );
                    await setDoc(
                      identRef,
                      { userId: user.uid, email: normEmail },
                      { merge: true },
                    );
                  } catch {}
                }

                if (foundAdminData?.id && foundAdminData.id !== user.uid) {
                  try {
                    await deleteDoc(doc(db, "users", foundAdminData.id));
                  } catch {}
                }

                router.replace("/admin/dashboard" as any);
                return;
              }
            } catch (checkErr) {
              console.warn(
                "Could not auto-heal unlinked CENRO user:",
                checkErr,
              );
            }

            await signOut(auth);
            showError(
              "User profile not found in database.",
              "Access Denied",
              "error",
            );
            return;
          }

          const userData = userSnap.data();
          let userRole = String(userData?.role || 'user').toLowerCase().trim();

          const isCictoAdmin = userRole === "cicto" || userRole === "cicto_admin";

          if (isCictoAdmin) {
            await signOut(auth);
            showError(
              "Access Denied: CICTO credentials cannot be used to log in to the CENRO portal. Please use the dedicated CICTO portal at /cicto.",
              "Access Denied",
              "error",
            );
            setIsLoading(false);
            return;
          }

          // Strictly reject driver accounts from CENRO admin portal
          if (userRole === "driver") {
            await signOut(auth);
            showError(
              "Access Denied: Driver accounts must log in through the dedicated Driver Portal at /driver-login.",
              "Driver Portal Required",
              "warning",
            );
            setIsLoading(false);
            return;
          }

          let isCenroAdmin =
            userRole === "admin" ||
            userRole === "cenro" ||
            userRole === "coordinator" ||
            userRole === "barangay_coordinator" ||
            userRole === "cenro_officer" ||
            userRole === "mayor";

          // If role in users doc is not admin, check if user was provisioned via CICTO
          if (!isCenroAdmin && !isCictoAdmin && db) {
            try {
              const normEmail = (user.email || email).toLowerCase().trim();

              // 1. Check if an admin record exists under another doc (e.g. employeeId or provision doc)
              const usersQ = query(
                collection(db, "users"),
                where("email", "==", normEmail),
                limit(5),
              );
              const usersSnap = await getDocs(usersQ);
              let foundAdminData: any = null;

              for (const d of usersSnap.docs) {
                const dData = d.data();
                if (
                  dData.role === "admin" ||
                  dData.role === "cenro" ||
                  dData.role === "coordinator" ||
                  dData.role === "cenro_officer" ||
                  (dData.employeeId &&
                    String(dData.employeeId).toUpperCase().startsWith("CENRO-"))
                ) {
                  foundAdminData = dData;
                  break;
                }
              }

              // 2. Check identifiers/cenro/items and identifiers/coordinator/items
              if (!foundAdminData) {
                try {
                  const idQ = query(
                    collection(db, "identifiers", "cenro", "items"),
                    where("email", "==", normEmail),
                    limit(1),
                  );
                  const idSnap = await getDocs(idQ);
                  if (!idSnap.empty) {
                    foundAdminData = idSnap.docs[0].data();
                  }
                } catch {}

                if (!foundAdminData) {
                  try {
                    const coordIdQ = query(
                      collection(db, "identifiers", "coordinator", "items"),
                      where("email", "==", normEmail),
                      limit(1),
                    );
                    const coordIdSnap = await getDocs(coordIdQ);
                    if (!coordIdSnap.empty) {
                      foundAdminData = coordIdSnap.docs[0].data();
                    }
                  } catch {}
                }
              }

              if (foundAdminData) {
                const targetRole =
                  foundAdminData.role === "coordinator"
                    ? "coordinator"
                    : "admin";
                await setDoc(
                  userRef,
                  {
                    uid: user.uid,
                    email: normEmail,
                    displayName:
                      foundAdminData.displayName ||
                      user.displayName ||
                      (targetRole === "coordinator"
                        ? "Barangay Coordinator"
                        : "CENRO Admin"),
                    name:
                      foundAdminData.displayName ||
                      user.displayName ||
                      (targetRole === "coordinator"
                        ? "Barangay Coordinator"
                        : "CENRO Admin"),
                    role: targetRole,
                    verified: true,
                    status: "active",
                    employeeId:
                      foundAdminData.employeeId ||
                      foundAdminData.id ||
                      (targetRole === "coordinator"
                        ? `COORD-${Math.floor(1000 + Math.random() * 9000)}`
                        : `CENRO-${Math.floor(1000 + Math.random() * 9000)}`),
                    department:
                      foundAdminData.department ||
                      (targetRole === "coordinator"
                        ? "Barangay Environmental Operations"
                        : "Waste Management Operations"),
                    designation:
                      foundAdminData.designation ||
                      (targetRole === "coordinator"
                        ? "Barangay Environmental Coordinator"
                        : "CENRO Field Officer"),
                    ...(foundAdminData.barangay
                      ? {
                          barangay: foundAdminData.barangay,
                          assignedBarangay: foundAdminData.barangay,
                        }
                      : {}),
                    updatedAt: serverTimestamp(),
                  },
                  { merge: true },
                );

                isCenroAdmin = true;
                router.replace("/admin/dashboard" as any);
                return;
              }
            } catch (healErr) {
              console.warn(
                "Could not check provisioned CENRO records:",
                healErr,
              );
            }
          }

          if (isCenroAdmin) {
            router.replace("/admin/dashboard" as any);
            return;
          } else if (userRole === "driver") {
            await signOut(auth);
            showError(
              "Driver accounts must use the driver portal.",
              "Wrong Portal",
              "warning",
            );
            return;
          } else {
            await signOut(auth);
            showError(
              "You do not have administrative privileges for this portal.",
              "Access Denied",
              "error",
            );
            return;
          }
        } else {
          await signOut(auth);
          showError(
            "Authentication service is currently unavailable.",
            "Access Error",
            "error",
          );
          return;
        }
      }
    } catch (error: any) {
      console.error("Portal login error:", error);

      let errorMessage =
        "Login failed. Please verify your credentials and try again.";
      if (
        error.code === "auth/user-not-found" ||
        error.code === "auth/invalid-credential"
      ) {
        errorMessage = isCicto
          ? "CICTO Administrator credentials incorrect. Please verify your password."
          : 'Invalid credentials. The password entered is incorrect, or the account is not registered in Firebase Authentication. Click "Forgot password?" or verify your credentials with CICTO.';
      } else if (error.code === "auth/wrong-password") {
        errorMessage = "Incorrect password.";
      } else if (error.code === "auth/invalid-email") {
        errorMessage = "Invalid email address format.";
      } else if (error.code === "auth/too-many-requests") {
        errorMessage =
          "Too many failed login attempts. Please wait a moment and try again.";
      }

      showError(errorMessage, "Authentication Failed", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    const rawInput = username.trim().toLowerCase();
    if (!rawInput || !rawInput.includes("@")) {
      showError(
        "Please enter your registered email address in the field above to receive a password reset link.",
        "Email Required",
        "info",
      );
      return;
    }

    setIsLoading(true);
    try {
      if (auth) {
        await sendPasswordResetEmail(auth, rawInput);
        showError(
          `Password reset instructions have been sent to ${rawInput}. Please check your inbox and spam folder.`,
          "Reset Link Sent",
          "success",
        );
      }
    } catch (err: any) {
      console.warn("Password reset error:", err);
      if (err.code === "auth/user-not-found") {
        showError(
          "No account found with this email in Firebase Authentication.",
          "Account Not Found",
          "error",
        );
      } else if (err.code === "auth/too-many-requests") {
        showError(
          "Too many password reset requests. Please wait a few moments and try again.",
          "Rate Limited",
          "warning",
        );
      } else {
        showError(
          err.message || "Failed to dispatch password reset email.",
          "Reset Failed",
          "error",
        );
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0F172A" }}>
      <ImageBackground
        source={
          branding.landingBgUrl
            ? { uri: branding.landingBgUrl }
            : require("@/assets/images/admin_login_bg_professional.jpg")
        }
        style={styles.fullScreenBackground}
        resizeMode="cover"
      >
        <View style={styles.backdropDimmer}>
          <ScrollView
            contentContainerStyle={styles.overlay}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.floatingCardContainer}>
              {/* Top Republic Ribbon */}
              <View
                style={[
                  styles.govRibbonBar,
                  isCicto ? styles.govRibbonBarCicto : styles.govRibbonBarCenro,
                ]}
              >
                <View style={styles.govRibbonFlagRow}>
                  <View
                    style={[styles.flagDot, { backgroundColor: "#0038A8" }]}
                  />
                  <View
                    style={[styles.flagDot, { backgroundColor: "#CE1126" }]}
                  />
                  <View
                    style={[styles.flagDot, { backgroundColor: "#FCD116" }]}
                  />
                  <Text
                    style={[
                      styles.govRibbonText,
                      isCicto
                        ? styles.govRibbonTextCicto
                        : styles.govRibbonTextCenro,
                    ]}
                  >
                    {isCicto
                      ? "GOV.PH • REPUBLIC OF THE PHILIPPINES • CICTO DANAO"
                      : "LGU DANAO • CITY ENVIRONMENT AND NATURAL RESOURCES"}
                  </Text>
                </View>
              </View>

              <View
                style={[
                  styles.loginFloatingCard,
                  isCicto ? styles.cictoCardAccent : styles.cenroCardAccent,
                ]}
              >
                {/* Minimalist Agency Seal / Sign */}
                <AgencySign type={isCicto ? "cicto" : "cenro"} size="medium" />

                {/* Dynamic Welcome Heading */}
                <View style={styles.headingWrapper}>
                  <Text
                    style={[
                      styles.welcomeText,
                      isCicto
                        ? styles.cictoWelcomeText
                        : styles.cenroWelcomeText,
                    ]}
                  >
                    {isCicto
                      ? "Welcome back, CICTO Admin"
                      : "Welcome back, CENRO Admin"}
                  </Text>
                  <Text style={styles.portalSubtitle}>
                    {isCicto
                      ? "Enter your CICTO administrative credentials to access system oversight, audits, and user governance."
                      : "Enter your CENRO administrator credentials to access waste operations and fleet dispatch."}
                  </Text>
                </View>

                {/* Login Form */}
                <View style={styles.form}>
                  <AdminInput
                    placeholder={isCicto ? "Email" : "Email"}
                    value={username}
                    onChangeText={setUsername}
                    icon="person"
                    editable={!isLoading}
                  />

                  <AdminInput
                    placeholder="Password"
                    value={password}
                    onChangeText={setPassword}
                    icon="lock"
                    secureTextEntry={!showPassword}
                    editable={!isLoading}
                    rightComponent={
                      <TouchableOpacity
                        onPress={() => setShowPassword(!showPassword)}
                        style={{ padding: 6 }}
                      >
                        <MaterialIcons
                          name={showPassword ? "visibility-off" : "visibility"}
                          size={20}
                          color="#94A3B8"
                        />
                      </TouchableOpacity>
                    }
                  />

                  {/* Form Options */}
                  <View style={styles.formOptions}>
                    <TouchableOpacity
                      style={styles.rememberOption}
                      onPress={() => setKeepLoggedIn(!keepLoggedIn)}
                      disabled={isLoading}
                      activeOpacity={0.7}
                    >
                      <View
                        style={[
                          styles.checkbox,
                          keepLoggedIn &&
                            (isCicto
                              ? styles.checkboxCheckedCicto
                              : styles.checkboxCheckedCenro),
                        ]}
                      >
                        {keepLoggedIn && (
                          <MaterialIcons
                            name="check"
                            size={14}
                            color="#FFFFFF"
                          />
                        )}
                      </View>
                      <Text style={styles.checkboxLabel}>
                        Keep me signed in
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={handleForgotPassword}
                      disabled={isLoading}
                      activeOpacity={0.7}
                      style={styles.forgotPasswordBtn}
                    >
                      <Text
                        style={[
                          styles.forgotPasswordText,
                          isCicto
                            ? styles.cictoForgotText
                            : styles.cenroForgotText,
                        ]}
                      >
                        Forgot password?
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {/* Login Action Button */}
                  <AdminButton
                    title={
                      isLoading
                        ? "Authenticating..."
                        : isCicto
                          ? "Sign In to CICTO Portal"
                          : "Sign In to CENRO Portal"
                    }
                    colorScheme={isCicto ? "teal" : "green"}
                    onPress={handleLogin}
                    disabled={isLoading}
                  />

                  {/* Portal Security Footnote */}
                  <View style={styles.securityFootnote}>
                    <MaterialIcons
                      name="verified-user"
                      size={13}
                      color="#64748B"
                    />
                    <Text style={styles.securityFootnoteText}>
                      {isCicto
                        ? "Protected under CICTO Administrative Oversight & Governance Framework"
                        : "City Environment and Natural Resources Office • Danao City Official Portal"}
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          </ScrollView>
        </View>
      </ImageBackground>

      <ErrorModal
        visible={errorModal.visible}
        title={errorModal.title}
        message={errorModal.message}
        type={errorModal.type}
        onClose={closeErrorModal}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fullScreenBackground: {
    flex: 1,
    width: "100%",
    height: "100%",
  },
  backdropDimmer: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.72)",
    justifyContent: "center",
  },
  overlay: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  floatingCardContainer: {
    width: "100%",
    maxWidth: 460,
    alignSelf: "center",
  },
  govRibbonBar: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: -1,
  },
  govRibbonBarCicto: {
    backgroundColor: "#042F2E",
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: "#115E59",
  },
  govRibbonBarCenro: {
    backgroundColor: "#064E3B",
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: "#059669",
  },
  govRibbonFlagRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  flagDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  govRibbonText: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  govRibbonTextCicto: {
    color: "#CCFBF1",
  },
  govRibbonTextCenro: {
    color: "#D1FAE5",
  },
  loginFloatingCard: {
    backgroundColor: "rgba(255, 255, 255, 0.98)",
    width: "100%",
    padding: 30,
    borderRadius: 24,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderWidth: 1.5,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.12,
    shadowRadius: 32,
    elevation: 10,
  },
  cenroCardAccent: {
    borderColor: "#D1FAE5",
  },
  cictoCardAccent: {
    borderColor: "#CCFBF1",
  },
  headingWrapper: {
    marginBottom: 20,
  },
  welcomeText: {
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  cenroWelcomeText: {
    color: "#1B4D3E",
  },
  cictoWelcomeText: {
    color: "#0F172A",
  },
  portalSubtitle: {
    fontSize: 13,
    color: "#64748B",
    lineHeight: 18,
  },
  form: {
    width: "100%",
  },
  formOptions: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 22,
    marginTop: 4,
  },
  rememberOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderWidth: 1.5,
    borderColor: "#CBD5E1",
    borderRadius: 5,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
  },
  checkboxCheckedCenro: {
    backgroundColor: "#059669",
    borderColor: "#059669",
  },
  checkboxCheckedCicto: {
    backgroundColor: "#0D9488",
    borderColor: "#0D9488",
  },
  checkboxLabel: {
    fontSize: 13,
    color: "#475569",
    fontWeight: "500",
  },
  encryptionPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#F0FDFA",
    borderWidth: 1,
    borderColor: "#CCFBF1",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  encryptionPillText: {
    fontSize: 10.5,
    fontWeight: "700",
    color: "#0F766E",
  },
  forgotPasswordBtn: {
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  forgotPasswordText: {
    fontSize: 12.5,
    fontWeight: "600",
  },
  cenroForgotText: {
    color: "#059669",
  },
  cictoForgotText: {
    color: "#0D9488",
  },
  securityFootnote: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    marginTop: 20,
  },
  securityFootnoteText: {
    fontSize: 11,
    color: "#94A3B8",
    textAlign: "center",
  },
});

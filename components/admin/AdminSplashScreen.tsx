import { MaterialIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";

export default function AdminSplashScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isMobile = width < 768;

  const handleEnterCenro = () => {
    router.replace("/cenro" as any);
  };

  const handleEnterCicto = () => {
    router.replace("/cicto" as any);
  };

  return (
    <View style={styles.container}>
      {/* Background Graphic (Desktop/Tablet) */}
      {!isMobile && (
        <Image
          source={require("@/assets/images/splash_admin_bg.png")}
          style={styles.backgroundImage}
          resizeMode="cover"
        />
      )}

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          isMobile ? styles.scrollContentMobile : styles.scrollContentDesktop,
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.mainSection, isMobile && styles.mainSectionMobile]}>
          {/* Header & Logo */}
          <View style={styles.headerBlock}>
            <Image
              source={require("@/assets/images/trashtrack_logo_driver.png")}
              style={[styles.logo, isMobile && styles.logoMobile]}
              resizeMode="contain"
            />
            <Text style={[styles.title, isMobile && styles.titleMobile]}>
              TrashTrack Portals
            </Text>
            <Text style={[styles.subtitle, isMobile && styles.subtitleMobile]}>
              Select your administrative clearance portal to authenticate and access oversight tools.
            </Text>
          </View>

          {/* Dual Portal Selection Cards */}
          <View style={[styles.cardsRow, isMobile && styles.cardsRowMobile]}>
            {/* CENRO Portal Card */}
            <TouchableOpacity
              style={[styles.portalCard, styles.cenroCard]}
              onPress={handleEnterCenro}
              activeOpacity={0.88}
            >
              <View style={styles.cardHeader}>
                <View style={[styles.iconCircle, styles.cenroIconCircle]}>
                  <MaterialIcons name="eco" size={26} color="#1B4D3E" />
                </View>
                <View style={styles.badgeWrapper}>
                  <Text style={[styles.badgeText, styles.cenroBadgeText]}>
                    MUNICIPAL
                  </Text>
                </View>
              </View>

              <Text style={styles.cardTitle}>CENRO Admin</Text>
              <Text style={styles.cardSub}>City Environment & Natural Resources</Text>

              <Text style={styles.cardDescription}>
                Dispatch garbage truck fleets, manage collection schedules, review citizen waste reports, and supervise municipal drivers.
              </Text>

              <View style={[styles.cardButton, styles.cenroButton]}>
                <Text style={styles.cardButtonText}>Enter CENRO Portal</Text>
                <MaterialIcons name="arrow-forward" size={18} color="#FFFFFF" />
              </View>
            </TouchableOpacity>

            {/* CICTO Portal Card */}
            <TouchableOpacity
              style={[styles.portalCard, styles.cictoCard]}
              onPress={handleEnterCicto}
              activeOpacity={0.88}
            >
              <View style={styles.cardHeader}>
                <View style={[styles.iconCircle, styles.cictoIconCircle]}>
                  <MaterialIcons name="security" size={26} color="#0F766E" />
                </View>
                <View style={styles.badgeWrapper}>
                  <Text style={[styles.badgeText, styles.cictoBadgeText]}>
                    CICTO
                  </Text>
                </View>
              </View>

              <Text style={styles.cardTitle}>CICTO Super Admin</Text>
              <Text style={styles.cardSub}>City Information & Communications Tech</Text>

              <Text style={styles.cardDescription}>
                Municipal technology governance, system health metrics, cross-agency commands, and data telemetry oversight.
              </Text>

              <View style={[styles.cardButton, styles.cictoButton]}>
                <Text style={styles.cardButtonText}>Enter CICTO Portal</Text>
                <MaterialIcons name="arrow-forward" size={18} color="#FFFFFF" />
              </View>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F4FDF4",
  },
  backgroundImage: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    width: "70%",
    height: "100%",
    opacity: 0.7,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 40,
    paddingHorizontal: 20,
  },
  scrollContentDesktop: {
    paddingHorizontal: "6%",
  },
  scrollContentMobile: {
    paddingHorizontal: 16,
  },
  mainSection: {
    width: "100%",
    maxWidth: 960,
    alignItems: "center",
    zIndex: 10,
  },
  mainSectionMobile: {
    maxWidth: "100%",
  },
  headerBlock: {
    alignItems: "center",
    marginBottom: 36,
  },
  logo: {
    width: 170,
    height: 70,
    marginBottom: 8,
  },
  logoMobile: {
    width: 140,
    height: 60,
  },
  title: {
    fontSize: 42,
    fontWeight: "900",
    color: "#1E3A2B",
    marginBottom: 10,
    letterSpacing: -0.8,
    textAlign: "center",
  },
  titleMobile: {
    fontSize: 30,
  },
  subtitle: {
    fontSize: 16,
    color: "#4A6B53",
    textAlign: "center",
    maxWidth: 580,
    lineHeight: 24,
  },
  subtitleMobile: {
    fontSize: 14,
    lineHeight: 20,
  },
  cardsRow: {
    flexDirection: "row",
    gap: 24,
    width: "100%",
    justifyContent: "center",
  },
  cardsRowMobile: {
    flexDirection: "column",
    gap: 16,
  },
  portalCard: {
    flex: 1,
    maxWidth: 440,
    backgroundColor: "rgba(255, 255, 255, 0.96)",
    borderRadius: 24,
    padding: 28,
    borderWidth: 1.5,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 4,
    justifyContent: "space-between",
  },
  cenroCard: {
    borderColor: "#A7F3D0",
  },
  cictoCard: {
    borderColor: "#99F6E4",
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: "center",
    alignItems: "center",
  },
  cenroIconCircle: {
    backgroundColor: "#ECFDF5",
  },
  cictoIconCircle: {
    backgroundColor: "#F0FDFA",
  },
  badgeWrapper: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: "#F1F5F9",
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  cenroBadgeText: {
    color: "#065F46",
  },
  cictoBadgeText: {
    color: "#0F766E",
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#0F172A",
    marginBottom: 4,
  },
  cardSub: {
    fontSize: 12,
    fontWeight: "600",
    color: "#64748B",
    marginBottom: 14,
  },
  cardDescription: {
    fontSize: 14,
    color: "#475569",
    lineHeight: 21,
    marginBottom: 24,
  },
  cardButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
  },
  cenroButton: {
    backgroundColor: "#1B4D3E",
  },
  cictoButton: {
    backgroundColor: "#0F766E",
  },
  cardButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
});

import { MaterialIcons } from "@expo/vector-icons";
import { canAccessOperationalTab } from "@/constants/accessPrivileges";
import React, { useEffect, useState } from "react";
import {
  Animated,
  Dimensions,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

interface AdminSidebarProps {
  activeTab: string;
  onTabPress: (tab: string) => void;
  isOpen?: boolean;
  onClose?: () => void;
  userRole?: string;
  assignedBarangay?: string;
  privileges?: string[] | null;
}

const SIDEBAR_WIDTH = 256;
const BREAKPOINT = 900;

const AdminSidebar: React.FC<AdminSidebarProps> = ({
  activeTab,
  onTabPress,
  isOpen = false,
  onClose,
  userRole,
  assignedBarangay,
  privileges,
}) => {
  const isCoordinator = userRole === "coordinator";
  const [windowWidth, setWindowWidth] = useState(
    Dimensions.get("window").width,
  );
  const slideAnim = useState(new Animated.Value(-SIDEBAR_WIDTH))[0];
  const navigationGroups = isCoordinator
    ? [
        {
          title: "FIELD OPERATIONS",
          items: [
            { id: "diesel-estimate", label: "TRIP & DIESEL LOG", icon: "local-gas-station" },
            { id: "route-optimization", label: "ROUTE & AI DISPATCH", icon: "alt-route" },
            {
              id: "collection-scheduler",
              label: "COLLECTION SCHEDULES",
              icon: "event-note",
            },
            {
              id: "trash-reports",
              label: "TRASH REPORTS",
              icon: "assignment",
            },
            {
              id: "truck-inventory",
              label: "FLEET INVENTORY",
              icon: "local-shipping",
            },
            {
              id: "fleet-monitoring",
              label: "FLEET MONITORING",
              icon: "location-searching",
            },
            {
              id: "driver-accounts",
              label: "DRIVER ACCOUNTS",
              icon: "recent-actors",
            },
          ],
        },
        {
          title: "COMMUNITY & AUDIT",
          items: [
            {
              id: "rewards",
              label: "ECO-REWARDS & MERCH",
              icon: "stars",
            },
            {
              id: "announcements",
              label: "ANNOUNCEMENTS",
              icon: "campaign",
            },
            {
              id: "service-feedback",
              label: "SERVICE FEEDBACK",
              icon: "rate-review",
            },
            {
              id: "logs",
              label: "OPERATIONAL LOGS",
              icon: "receipt-long",
            },
          ],
        },
      ]
    : [
        {
          title: "OPERATIONS & DISPATCH",
          items: [
            {
              id: "dashboard",
              label: "DASHBOARD",
              icon: "grid-view",
            },
            {
              id: "trash-reports",
              label: "TRASH REPORTS",
              icon: "assignment",
            },
            {
              id: "route-optimization",
              label: "ROUTE & AI DISPATCH",
              icon: "alt-route",
            },
            {
              id: "collection-scheduler",
              label: "COLLECTION SCHEDULES",
              icon: "event-note",
            },
            {
              id: "analytics",
              label: "WASTE ANALYTICS",
              icon: "bar-chart",
            },
          ],
        },
        {
          title: "FLEET & PERSONNEL",
          items: [
            { id: "diesel-estimate", label: "DIESEL ESTIMATE", icon: "local-gas-station" },
            {
              id: "truck-inventory",
              label: "FLEET INVENTORY",
              icon: "local-shipping",
            },
            {
              id: "fleet-monitoring",
              label: "FLEET MONITORING",
              icon: "location-searching",
            },
            {
              id: "driver-accounts",
              label: "ACCOUNTS DIRECTORY",
              icon: "recent-actors",
            },
          ],
        },
        {
          title: "COMMUNITY & AUDIT",
          items: [
            {
              id: "rewards",
              label: "ECO-REWARDS & MERCH",
              icon: "stars",
            },
            {
              id: "logs",
              label: "OPERATIONAL LOGS",
              icon: "receipt-long",
            },
            {
              id: "announcements",
              label: "ANNOUNCEMENTS",
              icon: "campaign",
            },
            {
              id: "service-feedback",
              label: "SERVICE FEEDBACK",
              icon: "rate-review",
            },
            {
              id: "operational-overrides",
              label: "SYSTEM OVERRIDES",
              icon: "report-problem",
            },
          ],
        },
      ];

  const visibleNavigationGroups = navigationGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => isCoordinator || canAccessOperationalTab(item.id, privileges)),
    }))
    .filter((group) => group.items.length > 0);

  const isNarrow = windowWidth < BREAKPOINT;

  useEffect(() => {
    const subscription = Dimensions.addEventListener("change", ({ window }) => {
      setWindowWidth(window.width);
      if (window.width >= BREAKPOINT && onClose) {
        onClose();
      }
    });
    return () => subscription?.remove();
  }, [onClose]);

  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: isOpen ? 0 : -SIDEBAR_WIDTH,
      duration: 250,
      useNativeDriver: false,
    }).start();
  }, [isOpen, slideAnim]);

  const handleItemPress = (id: string) => {
    onTabPress(id);
    if (isNarrow && onClose) onClose();
  };

  const sidebarContent = (
    <>
      <ScrollView
        style={styles.navigation}
        contentContainerStyle={[styles.navigationContent, isNarrow && { paddingTop: 36 }]}
        showsVerticalScrollIndicator={false}
      >
        {visibleNavigationGroups.map((group, groupIndex) => {
          const hasActiveChild = group.items.some((item) => item.id === activeTab);

          return (
            <View
              key={group.title}
              style={[
                styles.navGroupCard,
                groupIndex > 0 && { marginTop: 8 },
              ]}
            >
              <View style={styles.navGroupHeader}>
                <Text
                  style={[
                    styles.navGroupTitle,
                    hasActiveChild && styles.navGroupTitleActive,
                  ]}
                >
                  {group.title}
                </Text>
              </View>

              <View style={styles.navGroupItems}>
                {group.items.map((item) => {
                  const isActive = activeTab === item.id;
                  return (
                    <TouchableOpacity
                      key={item.id}
                      style={[
                        styles.navItem,
                        isActive && styles.activeNavItem,
                      ]}
                      onPress={() => handleItemPress(item.id)}
                      activeOpacity={0.7}
                    >
                      <MaterialIcons
                        name={item.icon as any}
                        size={17}
                        color={isActive ? "#FFFFFF" : "#6B7280"}
                      />
                      <Text
                        style={[
                          styles.navText,
                          isActive && styles.activeNavText,
                        ]}
                        numberOfLines={1}
                      >
                        {item.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.bottomSection}>
        {canAccessOperationalTab("cicto-commands", privileges) && (
          <TouchableOpacity
            style={[
              styles.cictoCommandBtn,
              activeTab === "cicto-commands" && styles.activeCictoCommandBtn,
            ]}
            onPress={() => handleItemPress("cicto-commands")}
            activeOpacity={0.8}
          >
            <View style={styles.cictoCommandIconWrap}>
              <MaterialIcons
                name="forum"
                size={16}
                color={activeTab === "cicto-commands" ? "#FFFFFF" : "#047857"}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={[
                  styles.cictoCommandTitle,
                  activeTab === "cicto-commands" && styles.activeCictoCommandTitle,
                ]}
                numberOfLines={1}
              >
                CICTO COMMAND & CHAT
              </Text>
              <Text
                style={[
                  styles.cictoCommandSub,
                  activeTab === "cicto-commands" && styles.activeCictoCommandSub,
                ]}
              >
                Direct Dispatch Sync
              </Text>
            </View>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[
            styles.supportBtn,
            activeTab === "support" && styles.activeSupportBtn,
          ]}
          onPress={() => handleItemPress("support")}
          activeOpacity={0.7}
        >
          <MaterialIcons
            name="help-outline"
            size={16}
            color={activeTab === "support" ? "#047857" : "#6B7280"}
          />
          <Text
            style={[
              styles.supportBtnText,
              activeTab === "support" && styles.activeSupportBtnText,
            ]}
          >
            SUPPORT & MANUAL
          </Text>
        </TouchableOpacity>
      </View>
    </>
  );

  // Wide screen: normal fixed sidebar
  if (!isNarrow) {
    return <View style={styles.sidebar}>{sidebarContent}</View>;
  }

  // Narrow screen: animated drawer overlay
  return (
    <>
      {/* Overlay backdrop */}
      {isOpen && <Pressable style={styles.overlay} onPress={onClose} />}

      {/* Sliding drawer */}
      <Animated.View
        style={[styles.drawer, { transform: [{ translateX: slideAnim }] }]}
      >
        <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
          <MaterialIcons name="close" size={24} color="#4B5563" />
        </TouchableOpacity>
        {sidebarContent}
      </Animated.View>
    </>
  );
};

const styles = StyleSheet.create({
  sidebar: {
    width: SIDEBAR_WIDTH,
    backgroundColor: "#F3F4F6",
    borderRightWidth: 1,
    borderRightColor: "#E5E7EB",
    justifyContent: "space-between",
  },
  navigation: {
    flex: 1,
    paddingHorizontal: 10,
    ...(Platform.OS === "web"
      ? {
          scrollbarWidth: "none" as any,
          msOverflowStyle: "none" as any,
        }
      : {}),
  },
  navigationContent: {
    paddingVertical: 4,
  },
  navGroupCard: {
    borderRadius: 8,
  },
  navGroupHeader: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginTop: 6,
    marginBottom: 2,
  },
  navGroupTitle: {
    fontSize: 10,
    fontWeight: "800",
    color: "#6B7280",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  navGroupTitleActive: {
    color: "#047857",
  },
  navGroupItems: {
    paddingLeft: 2,
    marginTop: 2,
    marginBottom: 4,
  },
  navItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 7,
    marginBottom: 2,
  },
  activeNavItem: {
    backgroundColor: "#1B4D3E",
  },
  navText: {
    fontSize: 11,
    marginLeft: 10,
    fontWeight: "600",
    color: "#4B5563",
    letterSpacing: 0.3,
    flex: 1,
  },
  activeNavText: {
    color: "#FFFFFF",
    fontWeight: "700",
  },

  bottomSection: {
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
    backgroundColor: "#F3F4F6",
    gap: 6,
  },
  cictoCommandBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ECFDF5",
    borderWidth: 1,
    borderColor: "#A7F3D0",
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 8,
    gap: 8,
  },
  activeCictoCommandBtn: {
    backgroundColor: "#10B981",
    borderColor: "#059669",
  },
  cictoCommandIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 6,
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  cictoCommandTitle: {
    fontSize: 10.5,
    fontWeight: "800",
    color: "#065F46",
    letterSpacing: 0.3,
  },
  activeCictoCommandTitle: {
    color: "#FFFFFF",
  },
  cictoCommandSub: {
    fontSize: 9,
    fontWeight: "600",
    color: "#047857",
  },
  activeCictoCommandSub: {
    color: "#ECFDF5",
  },
  supportBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 6,
    gap: 8,
  },
  activeSupportBtn: {
    backgroundColor: "#E5E7EB",
  },
  supportBtnText: {
    fontSize: 10.5,
    fontWeight: "700",
    color: "#6B7280",
    letterSpacing: 0.3,
  },
  activeSupportBtnText: {
    color: "#1F2937",
    fontWeight: "800",
  },

  // Responsive / narrow screen styles
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.4)",
    zIndex: 998,
  },
  drawer: {
    position: "absolute",
    top: 0,
    left: 0,
    bottom: 0,
    width: SIDEBAR_WIDTH,
    backgroundColor: "#F3F4F6",
    zIndex: 999,
    borderRightWidth: 1,
    borderRightColor: "#E5E7EB",
    justifyContent: "space-between",
    ...(Platform.OS === "web"
      ? { boxShadow: "4px 0 16px rgba(0,0,0,0.15)" }
      : {}),
  },
  closeBtn: {
    position: "absolute",
    top: 12,
    right: 12,
    zIndex: 10,
    padding: 4,
  },
});

export default AdminSidebar;

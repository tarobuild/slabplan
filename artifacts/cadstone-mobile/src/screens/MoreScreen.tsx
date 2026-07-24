import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import { Text, View } from "react-native";
import { Screen } from "../components/Screen";
import { Card, PrimaryButton, RowButton, Section, colors, styles } from "../components/ui";
import { formatPersonRole } from "../lib/format";
import { logout } from "../lib/api";
import { useAuthStore } from "../store/auth";
import type { MainTabParamList, RootStackParamList } from "../navigation/types";

type RootNav = NativeStackNavigationProp<RootStackParamList>;
type TabNav = BottomTabNavigationProp<MainTabParamList>;

export function MoreScreen() {
  const rootNavigation = useNavigation<RootNav>();
  const tabNavigation = useNavigation<TabNav>();
  const user = useAuthStore((state) => state.user);

  return (
    <Screen>
      <Card>
        <View style={local.avatar}>
          <Text style={local.avatarText}>{(user?.fullName ?? "C").slice(0, 1).toUpperCase()}</Text>
        </View>
        <Text style={local.name}>{user?.fullName ?? "SlabPlan user"}</Text>
        <Text style={styles.muted}>{user?.email}</Text>
        <Text style={local.role}>{formatPersonRole(user?.role)}</Text>
      </Card>

      <Section title="Tools">
        <RowButton
          title="Resources"
          subtitle="Company folders and references"
          icon="folder-open-outline"
          tone="blue"
          onPress={() => rootNavigation.navigate("Resources")}
        />
        <RowButton
          title="Schedule"
          subtitle="Upcoming field work"
          icon="calendar-clear-outline"
          tone="orange"
          onPress={() => tabNavigation.navigate("Schedule")}
        />
        <RowButton
          title="Account"
          subtitle="Session and device access"
          icon="person-circle-outline"
          tone="neutral"
          onPress={() => rootNavigation.navigate("Account")}
        />
      </Section>

      <PrimaryButton icon="log-out-outline" label="Sign out" onPress={() => void logout()} />
    </Screen>
  );
}

const local = {
  avatar: {
    alignItems: "center" as const,
    backgroundColor: "#EAF1FF",
    borderRadius: 8,
    height: 52,
    justifyContent: "center" as const,
    width: 52,
  },
  avatarText: {
    color: colors.blue,
    fontSize: 22,
    fontWeight: "900" as const,
  },
  name: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "900" as const,
  },
  role: {
    color: colors.orangeDark,
    fontSize: 13,
    fontWeight: "800" as const,
    textTransform: "uppercase" as const,
  },
};

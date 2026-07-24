import { Alert, StyleSheet, Text, View } from "react-native";
import { Screen } from "../components/Screen";
import { Card, PrimaryButton } from "../components/ui";
import { logout } from "../lib/api";
import { useAuthStore } from "../store/auth";

export function UnsupportedRoleScreen() {
  const user = useAuthStore((state) => state.user);
  const clearSession = useAuthStore((state) => state.clearSession);

  async function signOut() {
    try {
      await logout();
    } catch {
      await clearSession();
      Alert.alert("Signed out", "Your mobile session has been cleared.");
    }
  }

  return (
    <Screen contentStyle={screenStyles.content} scroll={false}>
      <Card style={screenStyles.card}>
        <View style={screenStyles.header}>
          <Text style={screenStyles.eyebrow}>SlabPlan Mobile</Text>
          <Text style={screenStyles.title}>Field access only</Text>
          <Text style={screenStyles.body}>
            {user?.fullName ? `${user.fullName}, this` : "This"} mobile app is for
            project managers and crew members working in the field. Admin setup stays
            in the web platform.
          </Text>
        </View>
        <PrimaryButton label="Sign out" onPress={signOut} />
      </Card>
    </Screen>
  );
}

const screenStyles = StyleSheet.create({
  body: {
    color: "#475569",
    fontSize: 16,
    lineHeight: 24,
  },
  card: {
    gap: 24,
  },
  content: {
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  eyebrow: {
    color: "#EA580C",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0,
    textTransform: "uppercase",
  },
  header: {
    gap: 10,
  },
  title: {
    color: "#0F172A",
    fontSize: 30,
    fontWeight: "800",
    lineHeight: 36,
  },
});

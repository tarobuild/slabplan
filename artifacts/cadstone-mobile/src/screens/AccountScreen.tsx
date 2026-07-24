import { Alert } from "react-native";
import { Screen } from "../components/Screen";
import { Card, InfoRow, PrimaryButton } from "../components/ui";
import { formatPersonRole } from "../lib/format";
import { logout } from "../lib/api";
import { useAuthStore } from "../store/auth";

export function AccountScreen() {
  const user = useAuthStore((state) => state.user);

  async function signOut() {
    try {
      await logout();
    } catch {
      Alert.alert("Sign out issue", "SlabPlan could not confirm logout, but this device session was cleared.");
    }
  }

  return (
    <Screen>
      <Card>
        <InfoRow label="Name" value={user?.fullName ?? "SlabPlan user"} icon="person-outline" tone="blue" />
        <InfoRow label="Email" value={user?.email ?? "Unknown"} icon="mail-outline" tone="neutral" />
        <InfoRow label="Role" value={formatPersonRole(user?.role)} icon="shield-checkmark-outline" tone="green" />
      </Card>
      <PrimaryButton icon="log-out-outline" label="Sign out" onPress={signOut} />
    </Screen>
  );
}

import Ionicons from "@expo/vector-icons/Ionicons";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { colors } from "./components/ui";
import { configureApiClient, refreshSession } from "./lib/api";
import { useAuthStore } from "./store/auth";
import type { MainTabParamList, RootStackParamList } from "./navigation/types";
import { AccountScreen } from "./screens/AccountScreen";
import { DailyLogDetailScreen } from "./screens/DailyLogDetailScreen";
import { FieldScheduleScreen } from "./screens/FieldScheduleScreen";
import { FolderFilesScreen } from "./screens/FolderFilesScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { JobDailyLogsScreen } from "./screens/JobDailyLogsScreen";
import { JobDetailScreen } from "./screens/JobDetailScreen";
import { JobFinancialsScreen } from "./screens/JobFinancialsScreen";
import { JobFilesScreen } from "./screens/JobFilesScreen";
import { JobScheduleScreen } from "./screens/JobScheduleScreen";
import { JobsScreen } from "./screens/JobsScreen";
import { LoginScreen } from "./screens/LoginScreen";
import { MoreScreen } from "./screens/MoreScreen";
import { MyLogsScreen } from "./screens/MyLogsScreen";
import { NewDailyLogScreen } from "./screens/NewDailyLogScreen";
import { ResourcesScreen } from "./screens/ResourcesScreen";
import { ScheduleItemScreen } from "./screens/ScheduleItemScreen";
import { UnsupportedRoleScreen } from "./screens/UnsupportedRoleScreen";

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<MainTabParamList>();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

function BootScreen() {
  return (
    <View style={{ alignItems: "center", backgroundColor: colors.appBg, flex: 1, justifyContent: "center" }}>
      <Text style={{ color: colors.muted, fontWeight: "700" }}>Opening SlabPlan...</Text>
    </View>
  );
}

const tabIcons: Record<keyof MainTabParamList, keyof typeof Ionicons.glyphMap> = {
  Home: "today-outline",
  Jobs: "briefcase-outline",
  Schedule: "calendar-clear-outline",
  Logs: "document-text-outline",
  More: "ellipsis-horizontal-circle-outline",
};

function MainTabs() {
  return (
    <Tabs.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.orange,
        tabBarInactiveTintColor: colors.faint,
        tabBarLabelStyle: { fontSize: 11, fontWeight: "700", paddingBottom: 2 },
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: 84,
          paddingTop: 8,
        },
      }}
    >
      <Tabs.Screen name="Home" component={HomeScreen} options={tabScreenOptions("Home")} />
      <Tabs.Screen name="Jobs" component={JobsScreen} options={tabScreenOptions("Jobs")} />
      <Tabs.Screen name="Schedule" component={FieldScheduleScreen} options={tabScreenOptions("Schedule")} />
      <Tabs.Screen name="Logs" component={MyLogsScreen} options={tabScreenOptions("Logs")} />
      <Tabs.Screen name="More" component={MoreScreen} options={tabScreenOptions("More")} />
    </Tabs.Navigator>
  );
}

function tabScreenOptions(routeName: keyof MainTabParamList) {
  return {
    tabBarIcon: ({ color, focused, size }: { color: string; focused: boolean; size: number }) => {
      const outline = tabIcons[routeName];
      const filled = outline.replace("-outline", "") as keyof typeof Ionicons.glyphMap;
      return <Ionicons name={focused ? filled : outline} color={color} size={size} />;
    },
  };
}

function RootNavigator() {
  const user = useAuthStore((state) => state.user);
  const isFieldUser = user?.role === "project_manager" || user?.role === "crew_member";

  return (
    <Stack.Navigator
      screenOptions={{
        contentStyle: { backgroundColor: colors.appBg },
        headerBackTitle: "Back",
        headerLargeTitle: true,
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.appBg },
        headerTintColor: colors.text,
        headerTitleStyle: { color: colors.text, fontWeight: "800" },
      }}
    >
      {user ? (
        isFieldUser ? (
          <>
            <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
            <Stack.Screen
              name="JobDetail"
              component={JobDetailScreen}
              options={({ route }) => ({ title: route.params.title })}
            />
            <Stack.Screen
              name="JobSchedule"
              component={JobScheduleScreen}
              options={{ title: "Job schedule" }}
            />
            <Stack.Screen
              name="JobDailyLogs"
              component={JobDailyLogsScreen}
              options={{ title: "Job daily logs" }}
            />
            <Stack.Screen
              name="JobFiles"
              component={JobFilesScreen}
              options={{ title: "Job files" }}
            />
            <Stack.Screen
              name="JobFinancials"
              component={JobFinancialsScreen}
              options={{ title: "Job financials" }}
            />
            <Stack.Screen
              name="ScheduleItem"
              component={ScheduleItemScreen}
              options={({ route }) => ({ title: route.params.title })}
            />
            <Stack.Screen
              name="DailyLogDetail"
              component={DailyLogDetailScreen}
              options={({ route }) => ({ title: route.params.title })}
            />
            <Stack.Screen
              name="FolderFiles"
              component={FolderFilesScreen}
              options={({ route }) => ({ title: route.params.title })}
            />
            <Stack.Screen
              name="Resources"
              component={ResourcesScreen}
              options={{ title: "Resources" }}
            />
            <Stack.Screen
              name="Account"
              component={AccountScreen}
              options={{ title: "Account" }}
            />
            <Stack.Screen
              name="NewDailyLog"
              component={NewDailyLogScreen}
              options={{ title: "New daily log" }}
            />
          </>
        ) : (
          <Stack.Screen
            name="UnsupportedRole"
            component={UnsupportedRoleScreen}
            options={{ headerShown: false }}
          />
        )
      ) : (
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  const hydrate = useAuthStore((state) => state.hydrate);
  const hydrated = useAuthStore((state) => state.hydrated);
  const refreshToken = useAuthStore((state) => state.refreshToken);
  const [ready, setReady] = useState(false);

  const configured = useMemo(() => {
    configureApiClient();
    return true;
  }, []);

  useEffect(() => {
    let mounted = true;

    async function boot() {
      await hydrate();
      if (!mounted) return;
      setReady(true);
    }

    void boot();
    return () => {
      mounted = false;
    };
  }, [hydrate]);

  useEffect(() => {
    if (hydrated && refreshToken) {
      void refreshSession();
    }
  }, [hydrated, refreshToken]);

  if (!configured || !ready) {
    return (
      <SafeAreaProvider>
        <BootScreen />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <NavigationContainer>
          <StatusBar style="dark" />
          <RootNavigator />
        </NavigationContainer>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

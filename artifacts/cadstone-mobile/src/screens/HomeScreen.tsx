import type { CompositeNavigationProp } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { dashboardGetDashboardHome, jobsGetJobs } from "@workspace/api-client-react";
import { Text, View } from "react-native";
import { Screen } from "../components/Screen";
import {
  Badge,
  EmptyState,
  ErrorState,
  LoadingState,
  MetricTile,
  PageTitle,
  RowButton,
  Section,
  colors,
  styles,
} from "../components/ui";
import { formatShortDate } from "../lib/format";
import type { MainTabParamList, RootStackParamList } from "../navigation/types";

type Nav = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList>,
  NativeStackNavigationProp<RootStackParamList>
>;

type SchedulePreview = {
  id: string;
  kind?: "schedule_item" | "job";
  title: string;
  jobTitle?: string | null;
  jobId?: string | null;
  startTime?: string | null;
  startDate?: string | null;
};

type TodoPreview = {
  id: string;
  title: string;
  isComplete?: boolean | null;
};

export function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const homeQuery = useQuery({
    queryKey: ["mobile", "dashboard", "home"],
    queryFn: () => dashboardGetDashboardHome(),
  });
  const jobsQuery = useQuery({
    queryKey: ["mobile", "jobs", "home-preview"],
    queryFn: () => jobsGetJobs({ page: 1, pageSize: 12 }),
  });

  if (homeQuery.isLoading) {
    return (
      <Screen>
        <PageTitle title="Today" />
        <LoadingState />
      </Screen>
    );
  }

  if (homeQuery.isError || !homeQuery.data) {
    return (
      <Screen>
        <PageTitle title="Today" />
        <ErrorState message="SlabPlan could not load your field workspace." onRetry={() => void homeQuery.refetch()} />
      </Screen>
    );
  }

  const data = homeQuery.data as {
    today: string;
    role: string;
    schedule?: { items: SchedulePreview[] };
    week?: { items: SchedulePreview[] };
    todos?: TodoPreview[];
    atRisk?: { jobsMissingLogs?: number; overdueScheduleItems?: number };
  };
  const scheduleItems = data.schedule?.items ?? data.week?.items ?? [];
  const openTodos = (data.todos ?? []).filter((todo) => !todo.isComplete);
  const jobs = jobsQuery.data?.jobs ?? [];
  const activeJobs = jobs.length;
  const nextItems = scheduleItems.slice(0, 4);
  const nextJob = jobs[0] ?? null;

  return (
    <Screen>
      <PageTitle eyebrow={formatShortDate(data.today)} title="My field work" subtitle="Assigned jobs, site reports, progress, and files." />

      <View style={local.metricGrid}>
        <MetricTile label="Active jobs" value={activeJobs} icon="briefcase-outline" tone="blue" />
        <MetricTile label="Schedule" value={scheduleItems.length} icon="calendar-clear-outline" tone="orange" />
        <MetricTile label="Open items" value={openTodos.length} icon="checkmark-done-outline" tone="green" />
      </View>

      <Section title="Quick actions">
        <RowButton
          title="Open jobs"
          subtitle="Jobsite actions and permitted files"
          icon="briefcase-outline"
          tone="blue"
          onPress={() => navigation.navigate("Jobs")}
        />
        <RowButton
          title={nextJob ? "Start site report" : "Site reports"}
          subtitle={nextJob ? nextJob.title : "Review field updates"}
          icon="document-text-outline"
          tone="orange"
          onPress={() =>
            nextJob
              ? navigation.navigate("NewDailyLog", { jobId: nextJob.id, title: nextJob.title })
              : navigation.navigate("Logs")
          }
        />
        <RowButton
          title="Shared resources"
          subtitle="Company folders and references"
          icon="folder-open-outline"
          tone="neutral"
          onPress={() => navigation.navigate("Resources")}
        />
      </Section>

      <Section
        title="Up next"
        action={<Badge label={`${nextItems.length} shown`} tone="neutral" />}
      >
        {nextItems.length === 0 && jobs.length === 0 ? (
          <EmptyState message="No assigned work is lined up." icon="calendar-outline" />
        ) : nextItems.length === 0 ? (
          jobs.slice(0, 3).map((job) => (
            <RowButton
              key={job.id}
              title={job.title}
              subtitle={job.clientName ?? "Assigned job"}
              detail={job.projectedStart ? formatShortDate(job.projectedStart) : undefined}
              icon="business-outline"
              tone="blue"
              onPress={() => navigation.navigate("JobDetail", { jobId: job.id, title: job.title })}
            />
          ))
        ) : (
          nextItems.map((item) => (
            <RowButton
              key={item.id}
              title={item.title}
              subtitle={item.jobTitle ?? "Job"}
              detail={item.startTime ?? (item.startDate ? formatShortDate(item.startDate) : undefined)}
              icon={item.kind === "job" ? "business-outline" : "calendar-number-outline"}
              tone={item.kind === "job" ? "blue" : "orange"}
              onPress={() =>
                item.kind === "job" && item.jobId
                  ? navigation.navigate("JobDetail", { jobId: item.jobId, title: item.jobTitle ?? item.title })
                  : navigation.navigate("ScheduleItem", { itemId: item.id, title: item.title })
              }
            />
          ))
        )}
      </Section>

      <Section title="Priority jobs">
        {jobsQuery.isLoading ? <LoadingState label="Loading jobs" /> : null}
        {!jobsQuery.isLoading && jobs.slice(0, 4).length === 0 ? (
          <EmptyState message="No jobs are assigned yet." icon="briefcase-outline" />
        ) : null}
        {jobs.slice(0, 4).map((job) => (
          <RowButton
            key={job.id}
            title={job.title}
            subtitle={job.clientName ?? "No client"}
            detail={job.status}
            icon="business-outline"
            tone="blue"
            onPress={() => navigation.navigate("JobDetail", { jobId: job.id, title: job.title })}
          />
        ))}
      </Section>

      {data.atRisk ? (
        <Text style={[styles.muted, { paddingHorizontal: 2 }]}>
          Missing logs: {data.atRisk.jobsMissingLogs ?? 0}  Overdue items: {data.atRisk.overdueScheduleItems ?? 0}
        </Text>
      ) : null}
    </Screen>
  );
}

const local = {
  metricGrid: {
    flexDirection: "row" as const,
    gap: 8,
  },
};

import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import { dailyLogsGetJobsJobIdDailyLogs } from "@workspace/api-client-react";
import { Screen } from "../components/Screen";
import { Badge, EmptyState, ErrorState, LoadingState, PageTitle, PrimaryButton, RowButton, Section } from "../components/ui";
import { formatShortDate, titleCaseStatus } from "../lib/format";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "JobDailyLogs">;

export function JobDailyLogsScreen({ navigation, route }: Props) {
  const query = useQuery({
    queryKey: ["mobile", "jobs", route.params.jobId, "daily-logs"],
    queryFn: () => dailyLogsGetJobsJobIdDailyLogs(route.params.jobId, { page: 1, pageSize: 50 }),
  });

  const logs = query.data?.logs ?? [];

  return (
    <Screen>
      <PageTitle title="Site reports" subtitle={route.params.title} />
      <PrimaryButton
        icon="create-outline"
        label="Start site report"
        onPress={() => navigation.navigate("NewDailyLog", { jobId: route.params.jobId, title: route.params.title })}
      />
      {query.isLoading ? <LoadingState label="Loading logs" /> : null}
      {query.isError ? (
        <ErrorState message="SlabPlan could not load daily logs for this job." onRetry={() => void query.refetch()} />
      ) : null}
      {!query.isLoading && logs.length === 0 ? (
        <EmptyState message="No site reports have been created for this job." icon="document-text-outline" />
      ) : null}
      {logs.length > 0 ? (
        <Section title="Jobsite reports" action={<Badge label={`${logs.length}`} tone="neutral" />}>
          {logs.map((log) => (
            <RowButton
              key={log.id}
              title={log.title || "Daily log"}
              subtitle={`${formatShortDate(log.logDate)}  ${log.createdByName ?? "SlabPlan"}`}
              detail={titleCaseStatus(log.status)}
              icon={log.status === "published" ? "checkmark-circle-outline" : "create-outline"}
              tone={log.status === "published" ? "green" : "orange"}
              onPress={() => navigation.navigate("DailyLogDetail", { logId: log.id, title: log.title ?? "Daily log" })}
            />
          ))}
        </Section>
      ) : null}
    </Screen>
  );
}

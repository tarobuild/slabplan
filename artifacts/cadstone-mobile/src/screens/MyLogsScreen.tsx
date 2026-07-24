import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { dailyLogAdminGetDailyLogsMine } from "@workspace/api-client-react";
import { Screen } from "../components/Screen";
import { Badge, EmptyState, ErrorState, LoadingState, PageTitle, RowButton, Section } from "../components/ui";
import { formatShortDate, titleCaseStatus } from "../lib/format";
import type { RootStackParamList } from "../navigation/types";

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function MyLogsScreen() {
  const navigation = useNavigation<Nav>();
  const query = useQuery({
    queryKey: ["mobile", "daily-logs", "mine"],
    queryFn: () => dailyLogAdminGetDailyLogsMine({ page: 1, pageSize: 50 }),
  });

  const logs = query.data?.logs ?? [];

  return (
    <Screen>
      <PageTitle title="Site reports" subtitle={`${logs.length} visible to your account`} />
      {query.isLoading ? <LoadingState label="Loading logs" /> : null}
      {query.isError ? (
        <ErrorState message="SlabPlan could not load your logs." onRetry={() => void query.refetch()} />
      ) : null}
      {!query.isLoading && logs.length === 0 ? <EmptyState message="No site reports yet." icon="document-text-outline" /> : null}
      {logs.length > 0 ? (
        <Section title="Recent reports" action={<Badge label={`${logs.length}`} tone="neutral" />}>
          {logs.map((log) => (
            <LogRow
              key={log.id}
              log={log}
              onPress={() => navigation.navigate("DailyLogDetail", { logId: log.id, title: log.title ?? "Daily log" })}
            />
          ))}
        </Section>
      ) : null}
    </Screen>
  );
}

function LogRow({
  log,
  onPress,
}: {
  log: {
    id: string;
    title?: string | null;
    jobTitle?: string | null;
    logDate: string;
    notes: string;
    status: string;
    createdByName?: string | null;
  };
  onPress: () => void;
}) {
  return (
    <RowButton
      title={log.title || "Daily log"}
      subtitle={`${log.jobTitle ?? "Job"}  ${formatShortDate(log.logDate)}`}
      detail={titleCaseStatus(log.status)}
      icon={log.status === "published" ? "checkmark-circle-outline" : "create-outline"}
      tone={log.status === "published" ? "green" : "orange"}
      onPress={onPress}
    />
  );
}

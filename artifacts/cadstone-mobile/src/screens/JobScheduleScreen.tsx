import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import { scheduleGetJobsJobIdSchedule } from "@workspace/api-client-react";
import { Screen } from "../components/Screen";
import { Badge, EmptyState, ErrorState, LoadingState, PageTitle, RowButton, Section } from "../components/ui";
import { formatDateRange, formatPercent, titleCaseStatus } from "../lib/format";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "JobSchedule">;

export function JobScheduleScreen({ navigation, route }: Props) {
  const query = useQuery({
    queryKey: ["mobile", "jobs", route.params.jobId, "schedule"],
    queryFn: () => scheduleGetJobsJobIdSchedule(route.params.jobId, { limit: 100 }),
  });

  const items = query.data?.data ?? [];

  return (
    <Screen>
      <PageTitle title="Schedule" subtitle={route.params.title} />
      {query.isLoading ? <LoadingState label="Loading schedule" /> : null}
      {query.isError ? (
        <ErrorState message="SlabPlan could not load this job schedule." onRetry={() => void query.refetch()} />
      ) : null}
      {!query.isLoading && items.length === 0 ? (
        <EmptyState message="No schedule items have been added." icon="calendar-outline" />
      ) : null}
      {items.length > 0 ? (
        <Section title="Timeline" action={<Badge label={`${items.length} items`} tone="neutral" />}>
          {items.map((item) => (
            <RowButton
              key={item.id}
              title={item.title}
              subtitle={`${formatDateRange(item.startDate, item.endDate)}${item.phaseName ? `  ${item.phaseName}` : ""}`}
              detail={item.isComplete ? "Done" : titleCaseStatus(item.status)}
              icon={item.isComplete ? "checkmark-circle-outline" : "calendar-number-outline"}
              tone={item.isComplete ? "green" : "orange"}
              onPress={() => navigation.navigate("ScheduleItem", { itemId: item.id, title: item.title })}
            />
          ))}
        </Section>
      ) : null}
      {items.some((item) => typeof item.progress === "number") ? (
        <Badge
          label={`${formatPercent(items.reduce((total, item) => total + (item.progress ?? 0), 0) / Math.max(items.length, 1))} average`}
          tone="green"
        />
      ) : null}
    </Screen>
  );
}

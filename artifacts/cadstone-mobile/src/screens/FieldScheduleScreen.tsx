import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { dashboardGetDashboardSchedule } from "@workspace/api-client-react";
import { useMemo } from "react";
import { Screen } from "../components/Screen";
import { Badge, EmptyState, ErrorState, LoadingState, PageTitle, RowButton, Section } from "../components/ui";
import { formatDateRange, formatPercent, titleCaseStatus } from "../lib/format";
import type { RootStackParamList } from "../navigation/types";

type Nav = NativeStackNavigationProp<RootStackParamList>;

type FieldScheduleItem = {
  id: string;
  kind?: "schedule_item" | "job";
  title: string;
  startDate: string;
  endDate: string;
  displayColor?: string | null;
  progress?: number | null;
  isComplete?: boolean | null;
  jobId?: string | null;
  jobTitle?: string | null;
  jobCity?: string | null;
  jobState?: string | null;
};

type FieldScheduleResponse = {
  items?: FieldScheduleItem[];
};

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function FieldScheduleScreen() {
  const navigation = useNavigation<Nav>();
  const range = useMemo(() => {
    const today = new Date();
    return {
      start: toIsoDate(addDays(today, -14)),
      end: toIsoDate(addDays(today, 45)),
    };
  }, []);

  const query = useQuery({
    queryKey: ["mobile", "field-schedule", range],
    queryFn: () => dashboardGetDashboardSchedule(range),
  });

  const items = (query.data as FieldScheduleResponse | undefined)?.items ?? [];

  return (
    <Screen>
      <PageTitle title="Schedule" subtitle={formatDateRange(range.start, range.end)} />
      {query.isLoading ? <LoadingState label="Loading schedule" /> : null}
      {query.isError ? (
        <ErrorState message="SlabPlan could not load your schedule." onRetry={() => void query.refetch()} />
      ) : null}
      {!query.isLoading && items.length === 0 ? (
        <EmptyState message="No schedule items in this range." icon="calendar-outline" />
      ) : null}
      {items.length > 0 ? (
        <Section title="Assigned timeline" action={<Badge label={`${items.length} items`} tone="neutral" />}>
          {items.map((item) => (
            <RowButton
              key={item.id}
              title={item.title}
              subtitle={`${item.jobTitle ?? "Job"}  ${formatDateRange(item.startDate, item.endDate)}`}
              detail={item.isComplete ? "Done" : `${formatPercent(item.progress)}`}
              icon={item.kind === "job" ? "business-outline" : item.isComplete ? "checkmark-circle-outline" : "calendar-number-outline"}
              tone={item.kind === "job" ? "blue" : item.isComplete ? "green" : "orange"}
              onPress={() =>
                item.kind === "job" && item.jobId
                  ? navigation.navigate("JobDetail", { jobId: item.jobId, title: item.jobTitle ?? item.title })
                  : navigation.navigate("ScheduleItem", { itemId: item.id, title: item.title })
              }
            />
          ))}
        </Section>
      ) : null}
    </Screen>
  );
}

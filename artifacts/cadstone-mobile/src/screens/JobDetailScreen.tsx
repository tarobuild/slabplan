import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import { jobsGetJobsId } from "@workspace/api-client-react";
import { Text, View } from "react-native";
import { Screen } from "../components/Screen";
import {
  Badge,
  Card,
  ErrorState,
  InfoRow,
  LoadingState,
  PrimaryButton,
  RowButton,
  Section,
  colors,
  styles,
} from "../components/ui";
import {
  formatCurrencyCents,
  formatJobLocation,
  formatPersonRole,
  formatShortDate,
  formatWorkDays,
  titleCaseStatus,
} from "../lib/format";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "JobDetail">;

export function JobDetailScreen({ navigation, route }: Props) {
  const { jobId } = route.params;
  const query = useQuery({
    queryKey: ["mobile", "jobs", jobId],
    queryFn: () => jobsGetJobsId(jobId),
  });

  if (query.isLoading) {
    return (
      <Screen>
        <LoadingState label="Loading job" />
      </Screen>
    );
  }

  if (query.isError || !query.data) {
    return (
      <Screen>
        <ErrorState message="SlabPlan could not load this job." onRetry={() => void query.refetch()} />
      </Screen>
    );
  }

  const job = query.data.job;

  return (
    <Screen>
      <Card>
        <View style={local.heroHead}>
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={local.title}>Jobsite actions</Text>
            <Text style={styles.muted}>{job.clientName ?? "No client"}</Text>
          </View>
          <Badge label={titleCaseStatus(job.status)} tone="blue" />
        </View>
        <Text style={local.location}>{formatJobLocation(job)}</Text>
        <PrimaryButton
          icon="create-outline"
          label="Start site report"
          onPress={() => navigation.navigate("NewDailyLog", { jobId: job.id, title: job.title })}
        />
      </Card>

      <Section title="Job tools">
        <RowButton
          title="Schedule"
          subtitle="Assigned tasks, progress, and task attachments"
          icon="calendar-clear-outline"
          tone="orange"
          onPress={() => navigation.navigate("JobSchedule", { jobId: job.id, title: job.title })}
        />
        <RowButton
          title="Site reports"
          subtitle="Daily logs, photos, videos, and files"
          icon="document-text-outline"
          tone="green"
          onPress={() => navigation.navigate("JobDailyLogs", { jobId: job.id, title: job.title })}
        />
        <RowButton
          title="Permitted files"
          subtitle="Folders selected by the office"
          icon="folder-open-outline"
          tone="blue"
          onPress={() => navigation.navigate("JobFiles", { jobId: job.id, title: job.title })}
        />
        {job.access?.financials ? (
          <RowButton
            title="Financials"
            subtitle="Read-only contract, invoice, and SOV access"
            icon="cash-outline"
            tone="green"
            onPress={() => navigation.navigate("JobFinancials", { jobId: job.id, title: job.title })}
          />
        ) : null}
      </Section>

      <Section title="Summary">
        <InfoRow label="Job type" value={titleCaseStatus(job.jobType)} icon="construct-outline" tone="neutral" />
        <InfoRow label="Contract type" value={titleCaseStatus(job.contractType)} icon="document-text-outline" tone="blue" />
        {job.access?.financials ? (
          <InfoRow
            label="Contract value"
            value={formatCurrencyCents(job.contractValueCents)}
            icon="cash-outline"
            tone="green"
          />
        ) : null}
        <InfoRow label="Square feet" value={job.squareFeet ?? "Not listed"} icon="resize-outline" tone="neutral" />
        <InfoRow label="Permit" value={job.permitNumber ?? "Not listed"} icon="shield-checkmark-outline" tone="neutral" />
      </Section>

      <Section title="Dates">
        <InfoRow label="Projected start" value={formatShortDate(job.projectedStart)} icon="play-outline" tone="green" />
        <InfoRow label="Projected finish" value={formatShortDate(job.projectedCompletion)} icon="flag-outline" tone="orange" />
        <InfoRow label="Actual start" value={formatShortDate(job.actualStart)} icon="play-circle-outline" tone="green" />
        <InfoRow label="Actual finish" value={formatShortDate(job.actualCompletion)} icon="flag" tone="orange" />
        <InfoRow label="Work days" value={formatWorkDays(job.workDays)} icon="calendar-outline" tone="blue" />
      </Section>

      <Section title="Office notes">
        <InfoRow label="Internal" value={job.internalNotes ?? "No internal notes."} icon="reader-outline" tone="blue" />
        <InfoRow label="Subs and vendors" value={job.subVendorNotes ?? "No vendor notes."} icon="people-outline" tone="neutral" />
      </Section>

      <Section title="Team">
        {job.projectManagerName ? (
          <InfoRow
            label="Project manager"
            value={job.projectManagerName}
            icon="person-circle-outline"
            tone="blue"
          />
        ) : null}
        {job.assignees.length === 0 ? (
          <EmptyTeam />
        ) : (
          job.assignees.map((assignee) => (
            <InfoRow
              key={assignee.id}
              label={formatPersonRole(assignee.role)}
              value={assignee.fullName ?? assignee.email}
              icon="person-outline"
              tone="neutral"
            />
          ))
        )}
      </Section>
    </Screen>
  );
}

function EmptyTeam() {
  return (
    <View style={local.emptyTeam}>
      <Text style={styles.muted}>No assignees listed.</Text>
    </View>
  );
}

const local = {
  emptyTeam: {
    padding: 16,
  },
  heroHead: {
    alignItems: "flex-start" as const,
    flexDirection: "row" as const,
    gap: 12,
  },
  location: {
    color: colors.steel,
    fontSize: 15,
    fontWeight: "700" as const,
    lineHeight: 21,
  },
  title: {
    color: colors.text,
    fontSize: 25,
    fontWeight: "900" as const,
    lineHeight: 31,
  },
};

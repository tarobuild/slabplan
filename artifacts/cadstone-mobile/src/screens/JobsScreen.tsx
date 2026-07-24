import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { jobsGetJobs } from "@workspace/api-client-react";
import { Text, View } from "react-native";
import { Screen } from "../components/Screen";
import { Badge, EmptyState, ErrorState, LoadingState, PageTitle, RowButton, Section, styles } from "../components/ui";
import { formatJobLocation, formatShortDate, titleCaseStatus } from "../lib/format";
import type { RootStackParamList } from "../navigation/types";

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function JobsScreen() {
  const navigation = useNavigation<Nav>();
  const query = useQuery({
    queryKey: ["mobile", "jobs"],
    queryFn: () => jobsGetJobs({ page: 1, pageSize: 50 }),
  });

  const jobs = query.data?.jobs ?? [];

  return (
    <Screen>
      <PageTitle title="Jobs" subtitle={`${jobs.length} visible to your account`} />
      {query.isLoading ? <LoadingState label="Loading jobs" /> : null}
      {query.isError ? (
        <ErrorState message="SlabPlan could not load jobs." onRetry={() => void query.refetch()} />
      ) : null}
      {!query.isLoading && jobs.length === 0 ? <EmptyState message="No jobs are assigned yet." icon="briefcase-outline" /> : null}

      {jobs.length > 0 ? (
        <Section title="Assigned work">
          {jobs.map((job) => (
            <RowButton
              key={job.id}
              title={job.title}
              subtitle={[job.clientName, formatJobLocation(job)].filter(Boolean).join("  ")}
              detail={titleCaseStatus(job.status)}
              icon="business-outline"
              tone="blue"
              onPress={() => navigation.navigate("JobDetail", { jobId: job.id, title: job.title })}
            />
          ))}
        </Section>
      ) : null}

      {jobs.some((job) => job.projectedStart) ? (
        <View style={{ gap: 8 }}>
          <Text style={styles.muted}>
            Next start: {formatShortDate(jobs.find((job) => job.projectedStart)?.projectedStart)}
          </Text>
          <Badge label="Synced with web" tone="green" />
        </View>
      ) : null}
    </Screen>
  );
}

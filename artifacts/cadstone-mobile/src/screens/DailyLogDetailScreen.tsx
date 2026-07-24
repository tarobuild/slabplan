import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  dailyLogsGetDailyLogsId,
  dailyLogsGetDailyLogsIdComments,
  dailyLogsPostDailyLogsIdComments,
  dailyLogsPostDailyLogsIdLike,
  dailyLogsPostDailyLogsIdPublish,
} from "@workspace/api-client-react";
import { useState } from "react";
import { Alert, Linking, Text, View } from "react-native";
import { Screen } from "../components/Screen";
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  Field,
  InfoRow,
  LoadingState,
  PrimaryButton,
  RowButton,
  Section,
  SecondaryButton,
  colors,
  styles,
} from "../components/ui";
import { formatFileSize, formatShortDate, titleCaseStatus } from "../lib/format";
import { getSignedFileViewUrl } from "../lib/api";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "DailyLogDetail">;

export function DailyLogDetailScreen({ route }: Props) {
  const queryClient = useQueryClient();
  const [comment, setComment] = useState("");
  const [savingComment, setSavingComment] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const detailQuery = useQuery({
    queryKey: ["mobile", "daily-log", route.params.logId],
    queryFn: () => dailyLogsGetDailyLogsId(route.params.logId),
  });
  const commentsQuery = useQuery({
    queryKey: ["mobile", "daily-log", route.params.logId, "comments"],
    queryFn: () => dailyLogsGetDailyLogsIdComments(route.params.logId),
  });

  async function addComment() {
    const body = comment.trim();
    if (!body) return;
    setSavingComment(true);
    try {
      await dailyLogsPostDailyLogsIdComments(route.params.logId, {
        body,
        parentCommentId: null,
        mentions: [],
        attachments: [],
        links: [],
      });
      setComment("");
      await commentsQuery.refetch();
    } catch {
      Alert.alert("Could not comment", "SlabPlan could not save your comment.");
    } finally {
      setSavingComment(false);
    }
  }

  async function toggleLike() {
    try {
      await dailyLogsPostDailyLogsIdLike(route.params.logId);
      await Promise.all([
        detailQuery.refetch(),
        queryClient.invalidateQueries({ queryKey: ["mobile", "daily-logs"] }),
      ]);
    } catch {
      Alert.alert("Could not update", "SlabPlan could not update this reaction.");
    }
  }

  async function publishLog() {
    setPublishing(true);
    try {
      await dailyLogsPostDailyLogsIdPublish(route.params.logId);
      await Promise.all([
        detailQuery.refetch(),
        queryClient.invalidateQueries({ queryKey: ["mobile", "daily-logs"] }),
        queryClient.invalidateQueries({ queryKey: ["mobile", "jobs"] }),
      ]);
    } catch {
      Alert.alert("Could not publish", "SlabPlan could not publish this daily log.");
    } finally {
      setPublishing(false);
    }
  }

  async function openFile(fileId: string) {
    try {
      const url = await getSignedFileViewUrl(fileId);
      await Linking.openURL(url);
    } catch {
      Alert.alert("Could not open file", "SlabPlan could not create a secure file link.");
    }
  }

  if (detailQuery.isLoading) {
    return (
      <Screen>
        <LoadingState label="Loading daily log" />
      </Screen>
    );
  }

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <Screen>
        <ErrorState message="SlabPlan could not load this daily log." onRetry={() => void detailQuery.refetch()} />
      </Screen>
    );
  }

  const log = detailQuery.data.log;
  const comments = commentsQuery.data?.comments ?? [];

  return (
    <Screen>
      <Card>
        <View style={local.headerRow}>
          <View style={{ flex: 1, gap: 5 }}>
            <Text style={local.title}>{log.title || "Site report"}</Text>
            <Text style={styles.muted}>{formatShortDate(log.logDate)}  {log.createdByName ?? "SlabPlan"}</Text>
          </View>
          <Badge label={titleCaseStatus(log.status)} tone={log.status === "published" ? "green" : "orange"} />
        </View>
        <Text style={local.notes}>{log.notes || "No notes added."}</Text>
        <View style={local.actionRow}>
          <SecondaryButton
            icon={log.likedByCurrentUser ? "heart" : "heart-outline"}
            label={`${log.likesCount ?? 0}`}
            onPress={() => void toggleLike()}
          />
          {log.status === "draft" ? (
            <SecondaryButton icon="cloud-upload-outline" label="Publish" loading={publishing} onPress={() => void publishLog()} />
          ) : null}
        </View>
      </Card>

      <Section title="Details">
        <InfoRow label="Visibility" value={log.visibilityLabel ?? "Internal"} icon="eye-outline" tone="blue" />
      </Section>

      <Section title="Attachments">
        {log.attachments.length === 0 ? (
          <EmptyState message="No attachments." icon="attach-outline" />
        ) : (
          log.attachments.map((attachment) => (
            <RowButton
              key={attachment.id}
              title={attachment.originalName}
              subtitle={formatFileSize(attachment.fileSize)}
              icon="attach-outline"
              tone="neutral"
              onPress={() => void openFile(attachment.fileId)}
            />
          ))
        )}
      </Section>

      <Section title="Todos">
        {log.todos.length === 0 ? (
          <EmptyState message="No todos on this log." icon="checkbox-outline" />
        ) : (
          log.todos.map((todo) => (
            <InfoRow
              key={todo.id}
              label={todo.isComplete ? "Done" : "Open"}
              value={todo.title}
              icon={todo.isComplete ? "checkmark-circle-outline" : "ellipse-outline"}
              tone={todo.isComplete ? "green" : "orange"}
            />
          ))
        )}
      </Section>

      <Section title="Comments">
        {commentsQuery.isLoading ? <LoadingState label="Loading comments" /> : null}
        {!commentsQuery.isLoading && comments.length === 0 ? (
          <EmptyState message="No comments yet." icon="chatbubble-outline" />
        ) : null}
        {comments.map((entry) => (
          <InfoRow
            key={entry.id}
            label={entry.author.fullName ?? "SlabPlan"}
            value={entry.body}
            icon="chatbubble-outline"
            tone="blue"
          />
        ))}
      </Section>

      <Card>
        <Field
          value={comment}
          onChangeText={setComment}
          placeholder="Add a comment"
          multiline
          numberOfLines={3}
          style={{ minHeight: 92 }}
        />
        <PrimaryButton icon="send-outline" label="Post comment" loading={savingComment} disabled={!comment.trim()} onPress={() => void addComment()} />
      </Card>
    </Screen>
  );
}

const local = {
  actionRow: {
    flexDirection: "row" as const,
    gap: 10,
  },
  headerRow: {
    alignItems: "flex-start" as const,
    flexDirection: "row" as const,
    gap: 10,
  },
  notes: {
    color: colors.steel,
    fontSize: 15,
    lineHeight: 22,
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "900" as const,
    lineHeight: 30,
  },
};

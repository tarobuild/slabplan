import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { scheduleGetScheduleItemsId } from "@workspace/api-client-react";
import { useState } from "react";
import { Alert, Linking, Text, View } from "react-native";
import { Screen } from "../components/Screen";
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  InfoRow,
  LabeledField,
  LoadingState,
  PrimaryButton,
  RowButton,
  Section,
  SecondaryButton,
  colors,
  styles,
} from "../components/ui";
import { formatDateRange, formatFileSize, formatPercent, formatTime, titleCaseStatus } from "../lib/format";
import { addScheduleItemNote, getSignedFileViewUrl, markScheduleItemComplete } from "../lib/api";
import type { RootStackParamList } from "../navigation/types";
import {
  captureJobsitePhoto,
  pickJobsiteFiles,
  pickJobsiteMedia,
  uploadScheduleItemAttachments,
  uploadSummary,
  type PendingUpload,
} from "../lib/uploads";

type Props = NativeStackScreenProps<RootStackParamList, "ScheduleItem">;

export function ScheduleItemScreen({ navigation, route }: Props) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [note, setNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const query = useQuery({
    queryKey: ["mobile", "schedule-item", route.params.itemId],
    queryFn: () => scheduleGetScheduleItemsId(route.params.itemId),
  });

  async function setProgress(progress: number) {
    if (!query.data?.item) return;
    setSaving(true);
    try {
      await markScheduleItemComplete(route.params.itemId, progress >= 100, progress);
      await Promise.all([
        query.refetch(),
        queryClient.invalidateQueries({ queryKey: ["mobile", "field-schedule"] }),
        queryClient.invalidateQueries({ queryKey: ["mobile", "dashboard", "home"] }),
      ]);
    } catch {
      Alert.alert("Could not update", "SlabPlan could not update this schedule item.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleComplete() {
    if (!query.data?.item) return;
    const next = !query.data.item.isComplete;
    await setProgress(next ? 100 : Math.min(query.data.item.progress ?? 0, 99));
  }

  async function addUploads(kind: "camera" | "media" | "files") {
    const picked =
      kind === "camera"
        ? await captureJobsitePhoto()
        : kind === "media"
          ? await pickJobsiteMedia()
          : await pickJobsiteFiles();
    if (picked.length === 0) return;
    setPendingUploads((current) => [...current, ...picked].slice(0, 20));
  }

  async function uploadProgressAttachments() {
    if (pendingUploads.length === 0) return;
    setUploading(true);
    try {
      await uploadScheduleItemAttachments(route.params.itemId, pendingUploads);
      setPendingUploads([]);
      await query.refetch();
    } catch {
      Alert.alert("Could not upload", "SlabPlan could not attach those files to this schedule item.");
    } finally {
      setUploading(false);
    }
  }

  async function saveFieldNote() {
    const trimmed = note.trim();
    if (!trimmed) {
      Alert.alert("Add a note", "Write the field update before saving.");
      return;
    }

    setSavingNote(true);
    try {
      await addScheduleItemNote(route.params.itemId, trimmed);
      setNote("");
      await query.refetch();
    } catch {
      Alert.alert("Could not save note", "SlabPlan could not add that field note.");
    } finally {
      setSavingNote(false);
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

  if (query.isLoading) {
    return (
      <Screen>
        <LoadingState label="Loading schedule item" />
      </Screen>
    );
  }

  if (query.isError || !query.data) {
    return (
      <Screen>
        <ErrorState message="SlabPlan could not load this schedule item." onRetry={() => void query.refetch()} />
      </Screen>
    );
  }

  const item = query.data.item;
  const timeLabel = [formatTime(item.startTime), formatTime(item.endTime)].filter(Boolean).join(" - ");

  return (
    <Screen>
      <Card>
        <View style={local.headerRow}>
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={local.title}>{item.title}</Text>
            <Text style={styles.muted}>{item.jobTitle ?? "Job"}</Text>
          </View>
          <Badge label={item.isComplete ? "Complete" : titleCaseStatus(item.status)} tone={item.isComplete ? "green" : "orange"} />
        </View>
        <Text style={local.progress}>{formatPercent(item.progress)} complete</Text>
        <View style={local.progressGrid}>
          {[0, 25, 50, 75, 100].map((value) => (
            <SecondaryButton
              key={value}
              label={`${value}%`}
              disabled={saving}
              onPress={() => void setProgress(value)}
            />
          ))}
        </View>
        <PrimaryButton
          icon={item.isComplete ? "ellipse-outline" : "checkmark-circle-outline"}
          label={item.isComplete ? "Mark incomplete" : "Mark complete"}
          loading={saving}
          onPress={toggleComplete}
        />
        {item.jobId ? (
          <SecondaryButton
            icon="briefcase-outline"
            label="Open job"
            onPress={() => navigation.navigate("JobDetail", { jobId: item.jobId!, title: item.jobTitle ?? "Job" })}
          />
        ) : null}
      </Card>

      <Section title="Timing">
        <InfoRow label="Date" value={formatDateRange(item.startDate, item.endDate)} icon="calendar-clear-outline" tone="orange" />
        {timeLabel ? <InfoRow label="Time" value={timeLabel} icon="time-outline" tone="blue" /> : null}
      </Section>

      {item.notes ? (
        <Card>
          <Text style={local.section}>Notes</Text>
          <Text style={styles.muted}>{item.notes}</Text>
        </Card>
      ) : null}

      <Card style={{ gap: 14 }}>
        <Text style={local.section}>Field update</Text>
        <LabeledField
          label="Note"
          multiline
          numberOfLines={4}
          onChangeText={setNote}
          placeholder="Progress made, blocker, material issue, site condition..."
          style={{ minHeight: 104 }}
          value={note}
        />
        <PrimaryButton
          icon="chatbubble-outline"
          label="Add field note"
          loading={savingNote}
          onPress={() => void saveFieldNote()}
        />
        <View style={local.buttonGrid}>
          <SecondaryButton icon="camera-outline" label="Camera" onPress={() => void addUploads("camera")} />
          <SecondaryButton icon="images-outline" label="Photos/videos" onPress={() => void addUploads("media")} />
        </View>
        <SecondaryButton icon="document-attach-outline" label="Files and drawings" onPress={() => void addUploads("files")} />
        <InfoRow
          label="Ready to upload"
          value={uploadSummary(pendingUploads)}
          icon="attach-outline"
          tone={pendingUploads.length > 0 ? "green" : "neutral"}
        />
        {pendingUploads.length > 0 ? (
          <View style={{ gap: 8 }}>
            {pendingUploads.slice(0, 5).map((upload, index) => (
              <Text key={`${upload.uri}-${index}`} style={styles.muted} numberOfLines={1}>
                {upload.kind === "photo" ? "Photo" : upload.kind === "video" ? "Video" : "File"}: {upload.name}
              </Text>
            ))}
            {pendingUploads.length > 5 ? <Text style={styles.muted}>+{pendingUploads.length - 5} more</Text> : null}
            <PrimaryButton
              icon="cloud-upload-outline"
              label="Attach to task"
              loading={uploading}
              onPress={() => void uploadProgressAttachments()}
            />
          </View>
        ) : null}
      </Card>

      <Section title="Assignees">
        {item.assignees.length === 0 ? (
          <EmptyState message="No assignees listed." icon="people-outline" />
        ) : (
          item.assignees.map((assignee) => (
            <InfoRow
              key={assignee.id}
              label="Assigned"
              value={assignee.fullName ?? assignee.email}
              icon="person-outline"
              tone="neutral"
            />
          ))
        )}
      </Section>

      <Section title="Todos">
        {item.relatedTodos.length === 0 ? (
          <EmptyState message="No linked todos." icon="checkbox-outline" />
        ) : (
          item.relatedTodos.map((todo) => (
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

      <Section title="Activity">
        {item.notesStream.length === 0 ? (
          <EmptyState message="No activity notes yet." icon="chatbubble-outline" />
        ) : (
          item.notesStream.map((note) => (
            <InfoRow
              key={note.id}
              label={note.authorName ?? "SlabPlan"}
              value={note.note}
              icon="chatbubble-outline"
              tone="blue"
            />
          ))
        )}
      </Section>

      <Section title="Attachments">
        {item.attachments.length === 0 ? (
          <EmptyState message="No attachments." icon="attach-outline" />
        ) : (
          item.attachments.map((attachment) => (
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
    </Screen>
  );
}

const local = {
  headerRow: {
    alignItems: "flex-start" as const,
    flexDirection: "row" as const,
    gap: 10,
  },
  progress: {
    color: colors.steel,
    fontSize: 14,
    fontWeight: "800" as const,
  },
  buttonGrid: {
    flexDirection: "row" as const,
    gap: 8,
  },
  progressGrid: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    gap: 8,
  },
  section: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "900" as const,
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "900" as const,
    lineHeight: 30,
  },
};

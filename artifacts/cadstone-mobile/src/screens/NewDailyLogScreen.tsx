import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQueryClient } from "@tanstack/react-query";
import { dailyLogsPostJobsJobIdDailyLogs } from "@workspace/api-client-react";
import { useState } from "react";
import { Alert, Text, View } from "react-native";
import { Screen } from "../components/Screen";
import { Card, InfoRow, LabeledField, PageTitle, PrimaryButton, SecondaryButton, colors, styles } from "../components/ui";
import type { RootStackParamList } from "../navigation/types";
import {
  captureJobsitePhoto,
  pickJobsiteFiles,
  pickJobsiteMedia,
  uploadDailyLogAttachments,
  uploadSummary,
  type PendingUpload,
} from "../lib/uploads";

type Props = NativeStackScreenProps<RootStackParamList, "NewDailyLog">;

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export function NewDailyLogScreen({ navigation, route }: Props) {
  const queryClient = useQueryClient();
  const [logDate, setLogDate] = useState(todayIsoDate());
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [uploads, setUploads] = useState<PendingUpload[]>([]);
  const [saving, setSaving] = useState(false);

  async function addUploads(kind: "camera" | "media" | "files") {
    const picked =
      kind === "camera"
        ? await captureJobsitePhoto()
        : kind === "media"
          ? await pickJobsiteMedia()
          : await pickJobsiteFiles();
    if (picked.length === 0) return;
    setUploads((current) => [...current, ...picked].slice(0, 20));
  }

  function clearUploads() {
    setUploads([]);
  }

  async function save() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(logDate)) {
      Alert.alert("Check the date", "Use YYYY-MM-DD format.");
      return;
    }

    if (!notes.trim()) {
      Alert.alert("Add notes", "Write what happened at the job site before saving.");
      return;
    }

    setSaving(true);
    try {
      const result = await dailyLogsPostJobsJobIdDailyLogs(route.params.jobId, {
        logDate,
        title: title.trim() || null,
        notes: notes.trim(),
        shareInternalUsers: true,
        shareSubsVendors: false,
        shareClient: false,
        isPrivate: false,
      });

      if (uploads.length > 0) {
        await uploadDailyLogAttachments(result.log.id, uploads);
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["mobile", "daily-logs", "mine"] }),
        queryClient.invalidateQueries({ queryKey: ["mobile", "jobs", route.params.jobId, "daily-logs"] }),
        queryClient.invalidateQueries({ queryKey: ["mobile", "dashboard", "home"] }),
      ]);

      navigation.replace("DailyLogDetail", {
        logId: result.log.id,
        title: result.log.title ?? "Site report",
      });
    } catch {
      Alert.alert("Could not save", "The site report was not saved. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <PageTitle title="Site report" subtitle={route.params.title} />

      <Card style={{ gap: 16 }}>
        <LabeledField
          label="Date"
          onChangeText={setLogDate}
          placeholder="YYYY-MM-DD"
          value={logDate}
        />
        <LabeledField
          label="Short title"
          onChangeText={setTitle}
          placeholder="What was worked on?"
          value={title}
        />
        <LabeledField
          label="Field notes"
          multiline
          numberOfLines={8}
          onChangeText={setNotes}
          placeholder="Work completed, blockers, visitors, weather, materials, safety notes..."
          style={{ minHeight: 170 }}
          value={notes}
        />
      </Card>

      <Card style={{ gap: 14 }}>
        <Text style={local.sectionTitle}>Attachments</Text>
        <View style={local.buttonGrid}>
          <SecondaryButton icon="camera-outline" label="Camera" onPress={() => void addUploads("camera")} />
          <SecondaryButton icon="images-outline" label="Photos/videos" onPress={() => void addUploads("media")} />
        </View>
        <SecondaryButton icon="document-attach-outline" label="Files and drawings" onPress={() => void addUploads("files")} />
        <InfoRow label="Selected" value={uploadSummary(uploads)} icon="attach-outline" tone={uploads.length > 0 ? "green" : "neutral"} />
        {uploads.length > 0 ? (
          <View style={{ gap: 8 }}>
            {uploads.slice(0, 5).map((upload, index) => (
              <Text key={`${upload.uri}-${index}`} style={styles.muted} numberOfLines={1}>
                {upload.kind === "photo" ? "Photo" : upload.kind === "video" ? "Video" : "File"}: {upload.name}
              </Text>
            ))}
            {uploads.length > 5 ? <Text style={styles.muted}>+{uploads.length - 5} more</Text> : null}
            <SecondaryButton icon="trash-outline" label="Clear attachments" onPress={clearUploads} />
          </View>
        ) : null}
      </Card>

      <PrimaryButton icon="checkmark-circle-outline" label="Save site report" loading={saving} onPress={save} />
    </Screen>
  );
}

const local = {
  buttonGrid: {
    flexDirection: "row" as const,
    gap: 8,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "900" as const,
  },
};

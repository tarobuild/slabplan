import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Alert, Linking, Text, View } from "react-native";
import { Screen } from "../components/Screen";
import { Badge, Card, EmptyState, ErrorState, InfoRow, LabeledField, LoadingState, PageTitle, PrimaryButton, RowButton, SecondaryButton, Section, colors } from "../components/ui";
import {
  folderPermissionAllowsUser,
  getSignedFileViewUrl,
  listFolderFiles,
  listJobFolders,
  listResourceFolders,
  type FileItem,
  type FolderItem,
} from "../lib/api";
import { formatFileSize, titleCaseStatus } from "../lib/format";
import type { RootStackParamList } from "../navigation/types";
import {
  captureJobsitePhoto,
  pickJobsiteFiles,
  pickJobsiteMedia,
  uploadFolderFiles,
  uploadSummary,
  type PendingUpload,
} from "../lib/uploads";
import { useAuthStore } from "../store/auth";

type Props = NativeStackScreenProps<RootStackParamList, "FolderFiles">;

export function FolderFilesScreen({ navigation, route }: Props) {
  const { folderId, scope, jobId, mediaType } = route.params;
  const user = useAuthStore((state) => state.user);
  const [uploads, setUploads] = useState<PendingUpload[]>([]);
  const [note, setNote] = useState("");
  const [uploading, setUploading] = useState(false);
  const query = useQuery({
    queryKey: ["mobile", "folders", scope, folderId, jobId, mediaType],
    queryFn: async () => {
      const [childFolders, fileList] = await Promise.all([
        scope === "resource"
          ? listResourceFolders(folderId)
          : listJobFolders({ jobId: jobId!, mediaType: mediaType!, parentId: folderId }),
        listFolderFiles({ folderId, scope }),
      ]);
      return {
        folder: fileList.folder ?? childFolders.currentFolder ?? null,
        folders: childFolders.folders,
        files: fileList.files,
      };
    },
  });

  async function openFile(fileId: string) {
    try {
      const url = await getSignedFileViewUrl(fileId);
      await Linking.openURL(url);
    } catch {
      Alert.alert("Could not open file", "SlabPlan could not create a secure file link.");
    }
  }

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

  async function sendUploads() {
    if (uploads.length === 0) return;
    if (mediaType === "photo" && !note.trim()) {
      Alert.alert("Add an upload note", "Office requires a short note with jobsite photos.");
      return;
    }
    setUploading(true);
    try {
      await uploadFolderFiles(folderId, uploads, note || "Uploaded from SlabPlan mobile.");
      setUploads([]);
      setNote("");
      await query.refetch();
    } catch {
      Alert.alert("Could not upload", "SlabPlan could not upload those files to this folder. Check folder permissions and try again.");
    } finally {
      setUploading(false);
    }
  }

  const folders = query.data?.folders ?? [];
  const files = query.data?.files ?? [];
  const currentFolder = query.data?.folder ?? null;
  const canUploadToCurrentFolder =
    scope === "job" && folderPermissionAllowsUser(currentFolder?.uploadingPermissions, user);
  const isEmpty = !query.isLoading && folders.length === 0 && files.length === 0;

  return (
    <Screen>
      <PageTitle title={route.params.title} subtitle={`${folders.length} folders  ${files.length} files`} />
      {query.isLoading ? <LoadingState label="Loading folder" /> : null}
      {query.isError ? (
        <ErrorState message="SlabPlan could not load this folder." onRetry={() => void query.refetch()} />
      ) : null}
      {isEmpty ? <EmptyState message="This folder is empty." icon="folder-open-outline" /> : null}

      {scope === "job" && currentFolder && !canUploadToCurrentFolder ? (
        <Section title="Access">
          <InfoRow
            label="View only"
            value="Office has not enabled mobile uploads for this folder."
            icon="lock-closed-outline"
            tone="neutral"
          />
        </Section>
      ) : null}

      {canUploadToCurrentFolder ? (
        <Card style={{ gap: 14 }}>
          <Text style={local.sectionTitle}>Upload to this folder</Text>
          <View style={local.buttonGrid}>
            <SecondaryButton icon="camera-outline" label="Camera" onPress={() => void addUploads("camera")} />
            <SecondaryButton icon="images-outline" label="Photos/videos" onPress={() => void addUploads("media")} />
          </View>
          <SecondaryButton icon="document-attach-outline" label="Files and drawings" onPress={() => void addUploads("files")} />
          <LabeledField
            label={mediaType === "photo" ? "Photo note" : "Upload note"}
            onChangeText={setNote}
            placeholder="What are these files for?"
            value={note}
          />
          <InfoRow label="Selected" value={uploadSummary(uploads)} icon="attach-outline" tone={uploads.length > 0 ? "green" : "neutral"} />
          {uploads.length > 0 ? (
            <PrimaryButton icon="cloud-upload-outline" label="Upload files" loading={uploading} onPress={() => void sendUploads()} />
          ) : null}
        </Card>
      ) : null}

      {folders.length > 0 ? (
        <Section title="Folders" action={<Badge label={`${folders.length}`} tone="neutral" />}>
          {folders.map((folder) => (
            <FolderRow
              key={folder.id}
              folder={folder}
              onPress={() =>
                navigation.push("FolderFiles", {
                  folderId: folder.id,
                  title: folder.title,
                  scope,
                  jobId,
                  mediaType,
                })
              }
            />
          ))}
        </Section>
      ) : null}

      {files.length > 0 ? (
        <Section title="Files" action={<Badge label={`${files.length}`} tone="neutral" />}>
          {files.map((file) => (
            <FileRow key={file.id} file={file} onOpen={() => void openFile(file.id)} />
          ))}
        </Section>
      ) : null}
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

function FolderRow({ folder, onPress }: { folder: FolderItem; onPress: () => void }) {
  return (
    <RowButton
      title={folder.title}
      subtitle={`${folder.fileCount ?? 0} files  ${folder.childFolderCount ?? 0} folders`}
      icon="folder-open-outline"
      tone="blue"
      onPress={onPress}
    />
  );
}

function FileRow({ file, onOpen }: { file: FileItem; onOpen: () => void }) {
  const name = file.originalName ?? file.filename ?? "File";
  return (
    <RowButton
      title={name}
      subtitle={`${formatFileSize(file.fileSize)}  ${file.uploadedByName ?? "SlabPlan"}`}
      detail={titleCaseStatus(file.mimeType?.split("/")[1] ?? "file")}
      icon={file.mimeType?.startsWith("image/") ? "image-outline" : "document-outline"}
      tone={file.storageStatus === "missing" ? "red" : "neutral"}
      onPress={onOpen}
    />
  );
}

import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { customFetch } from "@workspace/api-client-react";
import { formatFileSize } from "./format";

export type PendingUpload = {
  uri: string;
  name: string;
  mimeType: string;
  size?: number | null;
  durationMs?: number | null;
  kind: "photo" | "video" | "file";
};

type UploadResponse<T> = {
  attachments: T[];
};

function fallbackName(kind: PendingUpload["kind"], mimeType?: string | null) {
  const ext = mimeType?.includes("/") ? mimeType.split("/")[1] : kind === "file" ? "dat" : "jpg";
  return `slabplan-${kind}-${Date.now()}.${ext || "dat"}`;
}

function fromImageAsset(asset: ImagePicker.ImagePickerAsset): PendingUpload {
  const kind = asset.type === "video" ? "video" : "photo";
  const mimeType = asset.mimeType ?? (kind === "video" ? "video/quicktime" : "image/jpeg");
  return {
    uri: asset.uri,
    name: asset.fileName ?? fallbackName(kind, mimeType),
    mimeType,
    size: asset.fileSize ?? null,
    durationMs: asset.duration ?? null,
    kind,
  };
}

function fromDocumentAsset(asset: DocumentPicker.DocumentPickerAsset): PendingUpload {
  const mimeType = asset.mimeType ?? "application/octet-stream";
  return {
    uri: asset.uri,
    name: asset.name || fallbackName("file", mimeType),
    mimeType,
    size: asset.size ?? null,
    durationMs: null,
    kind: mimeType.startsWith("image/") ? "photo" : mimeType.startsWith("video/") ? "video" : "file",
  };
}

export async function pickJobsiteMedia(): Promise<PendingUpload[]> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return [];

  const result = await ImagePicker.launchImageLibraryAsync({
    allowsMultipleSelection: true,
    mediaTypes: ["images", "videos"],
    orderedSelection: true,
    quality: 0.82,
    selectionLimit: 20,
  });

  return result.canceled ? [] : result.assets.map(fromImageAsset);
}

export async function captureJobsitePhoto(): Promise<PendingUpload[]> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) return [];

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ["images"],
    quality: 0.82,
  });

  return result.canceled ? [] : result.assets.map(fromImageAsset);
}

export async function pickJobsiteFiles(): Promise<PendingUpload[]> {
  const result = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    multiple: true,
    type: "*/*",
  });

  return result.canceled ? [] : result.assets.map(fromDocumentAsset);
}

function buildUploadFormData(uploads: PendingUpload[], extra?: { note?: string | null }) {
  const formData = new FormData();

  for (const upload of uploads) {
    formData.append("files", {
      uri: upload.uri,
      name: upload.name,
      type: upload.mimeType,
    } as unknown as Blob);
  }

  const durations = uploads.map((upload) =>
    typeof upload.durationMs === "number" ? Math.max(1, Math.round(upload.durationMs / 1000)) : null,
  );
  if (durations.some((duration) => duration !== null)) {
    formData.append("videoDurations", JSON.stringify(durations));
  }
  if (extra?.note?.trim()) {
    formData.append("note", extra.note.trim());
  }

  return formData;
}

export async function uploadDailyLogAttachments<T = unknown>(
  logId: string,
  uploads: PendingUpload[],
): Promise<UploadResponse<T>> {
  return customFetch<UploadResponse<T>>(`/api/daily-logs/${logId}/attachments`, {
    method: "POST",
    body: buildUploadFormData(uploads),
  });
}

export async function uploadScheduleItemAttachments<T = unknown>(
  itemId: string,
  uploads: PendingUpload[],
): Promise<UploadResponse<T>> {
  return customFetch<UploadResponse<T>>(`/api/schedule-items/${itemId}/attachments`, {
    method: "POST",
    body: buildUploadFormData(uploads),
  });
}

export async function uploadFolderFiles<T = unknown>(
  folderId: string,
  uploads: PendingUpload[],
  note?: string | null,
): Promise<T> {
  return customFetch<T>(`/api/folders/${folderId}/files`, {
    method: "POST",
    body: buildUploadFormData(uploads, { note }),
  });
}

export function uploadSummary(uploads: PendingUpload[]): string {
  if (uploads.length === 0) return "No attachments selected";
  const totalBytes = uploads.reduce((sum, upload) => sum + (upload.size ?? 0), 0);
  const size = totalBytes > 0 ? ` • ${formatFileSize(totalBytes)}` : "";
  return `${uploads.length} selected${size}`;
}

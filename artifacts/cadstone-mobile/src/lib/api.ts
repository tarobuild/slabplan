import {
  ApiError,
  customFetch,
  setAuthFailureHandler,
  setAuthRefreshHandler,
  setAuthTokenGetter,
  setBaseUrl,
  setForbiddenHandler,
} from "@workspace/api-client-react";
import { Alert } from "react-native";
import { getApiBaseUrl } from "./config";
import { useAuthStore, type AuthUser } from "../store/auth";

export type FolderItem = {
  id: string;
  title: string;
  scope?: string | null;
  jobId?: string | null;
  parentFolderId?: string | null;
  mediaType?: string | null;
  childFolderCount?: number | null;
  fileCount?: number | null;
  viewingPermissions?: FolderPermissions;
  uploadingPermissions?: FolderPermissions;
};

export type FolderPermissions =
  | null
  | {
      admin?: boolean;
      project_manager?: boolean;
      crew_member?: boolean;
      internal?: boolean;
      users?: Record<string, boolean>;
    };

export type FileItem = {
  id: string;
  folderId: string;
  filename?: string | null;
  originalName?: string | null;
  fileSize?: number | null;
  mimeType?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  uploadedByName?: string | null;
  storageStatus?: string | null;
};

export type FolderListResponse = {
  currentFolder?: FolderItem | null;
  breadcrumb?: FolderItem[];
  folders: FolderItem[];
};

export type FileListResponse = {
  folder?: FolderItem | null;
  files: FileItem[];
};

type SignedFileResponse = {
  url: string;
  expiresAt: string;
  expiresIn: number;
};

type AuthResponse = {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  user: AuthUser;
};

type MobileAuthResponse = AuthResponse & {
  refreshToken: string;
};

const mobileHeaders = {
  "Content-Type": "application/json",
  "X-SlabPlan-Client": "mobile",
  "X-Requested-With": "XMLHttpRequest",
};

let configured = false;
let refreshPromise: Promise<string | null> | null = null;

function assertAuthResponse(value: unknown): MobileAuthResponse {
  if (!value || typeof value !== "object") {
    throw new Error("The server returned an invalid auth response.");
  }

  const payload = value as Partial<AuthResponse>;

  if (
    typeof payload.accessToken !== "string" ||
    typeof payload.refreshToken !== "string" ||
    !payload.user ||
    typeof payload.user.id !== "string" ||
    typeof payload.user.email !== "string"
  ) {
    throw new Error("The server did not return a complete mobile session.");
  }

  return payload as MobileAuthResponse;
}

export function configureApiClient(): void {
  if (configured) return;
  configured = true;

  setBaseUrl(getApiBaseUrl());
  setAuthTokenGetter(() => useAuthStore.getState().accessToken);
  setAuthRefreshHandler(refreshSession);
  setAuthFailureHandler(() => {
    void useAuthStore.getState().clearSession();
    Alert.alert("Session expired", "Please sign in again.");
  });
  setForbiddenHandler(({ method }) => {
    const message =
      method.toUpperCase() === "GET"
        ? "You do not have permission to view that."
        : "You do not have permission to do that.";
    Alert.alert("Permission needed", message);
  });
}

export async function login(email: string, password: string): Promise<void> {
  const response = await customFetch<AuthResponse>("/api/auth/login", {
    method: "POST",
    headers: mobileHeaders,
    body: JSON.stringify({ email, password }),
  });
  await useAuthStore.getState().setSession(assertAuthResponse(response));
}

export async function refreshSession(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const refreshToken = useAuthStore.getState().refreshToken;
    if (!refreshToken) return null;

    try {
      const response = await customFetch<AuthResponse>("/api/auth/refresh", {
        method: "POST",
        headers: mobileHeaders,
        body: JSON.stringify({ refreshToken }),
      });
      const session = assertAuthResponse(response);
      await useAuthStore.getState().setSession(session);
      return session.accessToken;
    } catch {
      await useAuthStore.getState().clearSession();
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export async function logout(): Promise<void> {
  try {
    await customFetch("/api/auth/logout", {
      method: "POST",
      headers: mobileHeaders,
    });
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) {
      throw error;
    }
  } finally {
    await useAuthStore.getState().clearSession();
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  return customFetch<T>(path, {
    method: "GET",
  });
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return customFetch<T>(path, {
    method: "POST",
    headers: mobileHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function folderPermissionAllowsUser(
  permissions: FolderPermissions | undefined,
  user: Pick<AuthUser, "id" | "role"> | null | undefined,
): boolean {
  if (!user) return false;
  if (permissions == null) return true;

  const explicit = permissions.users?.[user.id];
  if (typeof explicit === "boolean") return explicit;

  return permissions[user.role as keyof Omit<NonNullable<FolderPermissions>, "users">] === true ||
    permissions.internal === true;
}

export function buildAbsoluteApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${getApiBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function getSignedFileViewUrl(fileId: string): Promise<string> {
  const response = await apiPost<SignedFileResponse>(`/api/files/${fileId}/signed-view`);
  return buildAbsoluteApiUrl(response.url);
}

export async function markScheduleItemComplete(
  itemId: string,
  isComplete: boolean,
  progress?: number,
): Promise<unknown> {
  return apiPost(`/api/schedule-items/${itemId}/complete`, {
    isComplete,
    ...(typeof progress === "number" ? { progress } : {}),
  });
}

export async function addScheduleItemNote(itemId: string, note: string): Promise<unknown> {
  return apiPost(`/api/schedule-items/${itemId}/notes`, { note });
}

export async function listJobFolders({
  jobId,
  mediaType,
  parentId,
}: {
  jobId: string;
  mediaType: "document" | "photo" | "video";
  parentId?: string | null;
}): Promise<FolderListResponse> {
  const params = new URLSearchParams({ mediaType });
  if (parentId) params.set("parentId", parentId);
  return apiGet<FolderListResponse>(`/api/jobs/${jobId}/folders?${params.toString()}`);
}

export async function listResourceFolders(parentId?: string | null): Promise<FolderListResponse> {
  const params = new URLSearchParams();
  if (parentId) params.set("parentId", parentId);
  const query = params.toString();
  return apiGet<FolderListResponse>(`/api/resources/folders${query ? `?${query}` : ""}`);
}

export async function listFolderFiles({
  folderId,
  scope,
}: {
  folderId: string;
  scope: "job" | "resource";
}): Promise<FileListResponse> {
  const prefix = scope === "resource" ? "/api/resources/folders" : "/api/folders";
  return apiGet<FileListResponse>(`${prefix}/${folderId}/files`);
}

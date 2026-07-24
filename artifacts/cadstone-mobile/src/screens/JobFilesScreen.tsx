import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import { Screen } from "../components/Screen";
import { Badge, EmptyState, ErrorState, LoadingState, PageTitle, RowButton, Section } from "../components/ui";
import { listJobFolders, type FolderItem } from "../lib/api";
import { titleCaseStatus } from "../lib/format";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "JobFiles">;
type MediaType = "document" | "photo" | "video";

const MEDIA_TYPES: MediaType[] = ["document", "photo", "video"];

export function JobFilesScreen({ navigation, route }: Props) {
  const query = useQuery({
    queryKey: ["mobile", "jobs", route.params.jobId, "files"],
    queryFn: async () => {
      const groups = await Promise.all(
        MEDIA_TYPES.map(async (mediaType) => ({
          mediaType,
          folders: (await listJobFolders({ jobId: route.params.jobId, mediaType })).folders,
        })),
      );
      return groups.flatMap((group) =>
        group.folders.map((folder) => ({ ...folder, mediaType: group.mediaType })),
      );
    },
  });

  const folders = query.data ?? [];

  return (
    <Screen>
      <PageTitle title="Files" subtitle={route.params.title} />
      {query.isLoading ? <LoadingState label="Loading files" /> : null}
      {query.isError ? (
        <ErrorState message="SlabPlan could not load this job's folders." onRetry={() => void query.refetch()} />
      ) : null}
      {!query.isLoading && folders.length === 0 ? (
        <EmptyState message="No visible folders for this job." icon="folder-open-outline" />
      ) : null}
      {folders.length > 0 ? (
        <Section title="Folders" action={<Badge label={`${folders.length}`} tone="neutral" />}>
          {folders.map((folder) => (
            <FolderRow
              key={`${folder.mediaType}-${folder.id}`}
              folder={folder}
              onPress={() =>
                navigation.navigate("FolderFiles", {
                  folderId: folder.id,
                  title: folder.title,
                  scope: "job",
                  jobId: route.params.jobId,
                  mediaType: folder.mediaType as MediaType,
                })
              }
            />
          ))}
        </Section>
      ) : null}
    </Screen>
  );
}

function FolderRow({ folder, onPress }: { folder: FolderItem; onPress: () => void }) {
  return (
    <RowButton
      title={folder.title}
      subtitle={`${folder.fileCount ?? 0} files  ${folder.childFolderCount ?? 0} folders`}
      detail={titleCaseStatus(folder.mediaType)}
      icon={folder.mediaType === "photo" ? "images-outline" : folder.mediaType === "video" ? "videocam-outline" : "folder-open-outline"}
      tone={folder.mediaType === "photo" ? "green" : folder.mediaType === "video" ? "orange" : "blue"}
      onPress={onPress}
    />
  );
}

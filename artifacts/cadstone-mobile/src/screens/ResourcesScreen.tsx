import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import { Screen } from "../components/Screen";
import { Badge, EmptyState, ErrorState, LoadingState, PageTitle, RowButton, Section } from "../components/ui";
import { listResourceFolders, type FolderItem } from "../lib/api";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "Resources">;

export function ResourcesScreen({ navigation }: Props) {
  const query = useQuery({
    queryKey: ["mobile", "resources", "folders"],
    queryFn: () => listResourceFolders(),
  });

  const folders = query.data?.folders ?? [];

  return (
    <Screen>
      <PageTitle title="Resources" subtitle={`${folders.length} folders`} />
      {query.isLoading ? <LoadingState label="Loading resources" /> : null}
      {query.isError ? (
        <ErrorState message="SlabPlan could not load resources." onRetry={() => void query.refetch()} />
      ) : null}
      {!query.isLoading && folders.length === 0 ? (
        <EmptyState message="No resources are visible to this account yet." icon="folder-open-outline" />
      ) : null}
      {folders.length > 0 ? (
        <Section title="Company folders" action={<Badge label={`${folders.length}`} tone="neutral" />}>
          {folders.map((folder) => (
            <FolderRow
              key={folder.id}
              folder={folder}
              onPress={() =>
                navigation.navigate("FolderFiles", {
                  folderId: folder.id,
                  title: folder.title,
                  scope: "resource",
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
      icon="folder-open-outline"
      tone="blue"
      onPress={onPress}
    />
  );
}

import type { NavigatorScreenParams } from "@react-navigation/native";

export type MainTabParamList = {
  Home: undefined;
  Jobs: undefined;
  Schedule: undefined;
  Logs: undefined;
  More: undefined;
};

export type RootStackParamList = {
  Login: undefined;
  Main: NavigatorScreenParams<MainTabParamList> | undefined;
  JobDetail: { jobId: string; title: string };
  JobSchedule: { jobId: string; title: string };
  JobDailyLogs: { jobId: string; title: string };
  JobFiles: { jobId: string; title: string };
  JobFinancials: { jobId: string; title: string };
  ScheduleItem: { itemId: string; title: string };
  DailyLogDetail: { logId: string; title: string };
  FolderFiles: {
    folderId: string;
    title: string;
    scope: "job" | "resource";
    jobId?: string;
    mediaType?: "document" | "photo" | "video";
  };
  Resources: undefined;
  Account: undefined;
  UnsupportedRole: undefined;
  NewDailyLog: { jobId: string; title: string };
};

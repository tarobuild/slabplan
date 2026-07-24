import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import { Text, View } from "react-native";
import { Screen } from "../components/Screen";
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  InfoRow,
  LoadingState,
  PageTitle,
  Section,
  colors,
  styles,
} from "../components/ui";
import { apiGet } from "../lib/api";
import { formatCurrencyCents, formatPercent, formatShortDate, titleCaseStatus } from "../lib/format";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "JobFinancials">;

type TrackerLineItem = {
  id: string;
  description: string;
  scheduledValueCents: number;
  billedCents: number;
  percentComplete: string;
  isRemoved: boolean;
};

type TrackerArea = {
  id: string;
  name: string;
  floor?: string | null;
  lineItems: TrackerLineItem[];
};

type ChangeOrder = {
  id: string;
  number: string;
  description?: string | null;
  amountCents: number;
  status: string;
};

type Invoice = {
  id: string;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  totalCents: number;
  retentionHeldCents: number;
  netPaidCents: number;
};

type TrackerData = {
  tracker: {
    projectName?: string | null;
    contractDate?: string | null;
    currency?: string | null;
    retentionEnabled?: boolean | null;
  };
  areas: TrackerArea[];
  changeOrders: ChangeOrder[];
  invoices: Invoice[];
  totals: {
    billedCents: number;
    outstandingCents: number;
    changeOrderApprovedCents: number;
    contractWithChangesCents: number;
    retention: {
      enabled: boolean;
      retentionHeldCents: number;
      retentionOutstandingCents: number;
      netReceivedCents: number;
    };
  };
};

export function JobFinancialsScreen({ route }: Props) {
  const query = useQuery({
    queryKey: ["mobile", "jobs", route.params.jobId, "financials"],
    queryFn: () => apiGet<TrackerData>(`/api/jobs/${route.params.jobId}/financials`),
  });

  if (query.isLoading) {
    return (
      <Screen>
        <LoadingState label="Loading financials" />
      </Screen>
    );
  }

  if (query.isError || !query.data) {
    return (
      <Screen>
        <ErrorState
          message="SlabPlan could not load financial access for this job."
          onRetry={() => void query.refetch()}
        />
      </Screen>
    );
  }

  const data = query.data;
  const visibleAreas = data.areas.filter((area) => area.lineItems.some((line) => !line.isRemoved));

  return (
    <Screen>
      <PageTitle title="Financials" subtitle={route.params.title} />

      <Card>
        <View style={local.headerRow}>
          <View style={{ flex: 1, gap: 5 }}>
            <Text style={local.title}>{data.tracker.projectName ?? route.params.title}</Text>
            <Text style={styles.muted}>Read-only job financial access</Text>
          </View>
          <Badge label={data.tracker.currency ?? "USD"} tone="green" />
        </View>
        <InfoRow label="Contract date" value={formatShortDate(data.tracker.contractDate)} icon="calendar-outline" tone="orange" />
      </Card>

      <Section title="Overview">
        <InfoRow label="Contract with changes" value={formatCurrencyCents(data.totals.contractWithChangesCents)} icon="cash-outline" tone="green" />
        <InfoRow label="Billed" value={formatCurrencyCents(data.totals.billedCents)} icon="receipt-outline" tone="blue" />
        <InfoRow label="Outstanding" value={formatCurrencyCents(data.totals.outstandingCents)} icon="alert-circle-outline" tone="orange" />
        <InfoRow label="Approved change orders" value={formatCurrencyCents(data.totals.changeOrderApprovedCents)} icon="git-branch-outline" tone="neutral" />
        <InfoRow label="Net received" value={formatCurrencyCents(data.totals.retention.netReceivedCents)} icon="checkmark-circle-outline" tone="green" />
        {data.totals.retention.enabled ? (
          <InfoRow
            label="Retention held"
            value={formatCurrencyCents(data.totals.retention.retentionHeldCents)}
            icon="lock-closed-outline"
            tone="neutral"
          />
        ) : null}
      </Section>

      <Section title="Invoices" action={<Badge label={`${data.invoices.length}`} tone="neutral" />}>
        {data.invoices.length === 0 ? (
          <EmptyState message="No invoices have been applied." icon="receipt-outline" />
        ) : (
          data.invoices.map((invoice) => (
            <InfoRow
              key={invoice.id}
              label={invoice.invoiceNumber ?? "Invoice"}
              value={`${formatShortDate(invoice.invoiceDate)}  ${formatCurrencyCents(invoice.totalCents)} total  ${formatCurrencyCents(invoice.netPaidCents)} received`}
              icon="receipt-outline"
              tone="blue"
            />
          ))
        )}
      </Section>

      <Section title="Change orders" action={<Badge label={`${data.changeOrders.length}`} tone="neutral" />}>
        {data.changeOrders.length === 0 ? (
          <EmptyState message="No change orders have been added." icon="git-branch-outline" />
        ) : (
          data.changeOrders.map((changeOrder) => (
            <InfoRow
              key={changeOrder.id}
              label={`${changeOrder.number}  ${titleCaseStatus(changeOrder.status)}`}
              value={`${changeOrder.description ?? "Change order"}  ${formatCurrencyCents(changeOrder.amountCents)}`}
              icon="git-branch-outline"
              tone={changeOrder.status === "approved" ? "green" : changeOrder.status === "rejected" ? "red" : "orange"}
            />
          ))
        )}
      </Section>

      <Section title="Schedule of values" action={<Badge label={`${visibleAreas.length}`} tone="neutral" />}>
        {visibleAreas.length === 0 ? (
          <EmptyState message="No financial line items are available." icon="file-tray-outline" />
        ) : (
          visibleAreas.map((area) => (
            <View key={area.id} style={local.areaBlock}>
              <Text style={local.areaTitle}>{area.floor ? `${area.name}  ${area.floor}` : area.name}</Text>
              {area.lineItems.filter((line) => !line.isRemoved).map((line) => (
                <InfoRow
                  key={line.id}
                  label={formatPercent(Number(line.percentComplete))}
                  value={`${line.description}  ${formatCurrencyCents(line.billedCents)} billed of ${formatCurrencyCents(line.scheduledValueCents)}`}
                  icon="list-outline"
                  tone="neutral"
                />
              ))}
            </View>
          ))
        )}
      </Section>
    </Screen>
  );
}

const local = {
  areaBlock: {
    gap: 0,
  },
  areaTitle: {
    backgroundColor: colors.surfaceAlt,
    color: colors.steel,
    fontSize: 13,
    fontWeight: "900" as const,
    paddingHorizontal: 16,
    paddingVertical: 10,
    textTransform: "uppercase" as const,
  },
  headerRow: {
    alignItems: "flex-start" as const,
    flexDirection: "row" as const,
    gap: 10,
  },
  title: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "900" as const,
    lineHeight: 28,
  },
};

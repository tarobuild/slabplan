import Ionicons from "@expo/vector-icons/Ionicons";
import type { PropsWithChildren, ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from "react-native";

export type IconName = keyof typeof Ionicons.glyphMap;
export type Tone = "neutral" | "orange" | "green" | "red" | "blue";

export const colors = {
  appBg: "#F4F5F7",
  surface: "#FFFFFF",
  surfaceAlt: "#F9FAFB",
  border: "#D9DEE7",
  divider: "#E6E9EF",
  text: "#101827",
  muted: "#667085",
  faint: "#98A2B3",
  orange: "#F45A0B",
  orangeDark: "#C2410C",
  green: "#087443",
  red: "#B42318",
  blue: "#175CD3",
  steel: "#344054",
} as const;

const toneStyles = {
  neutral: {
    bg: "#EEF2F6",
    fg: "#344054",
    soft: "#F8FAFC",
  },
  orange: {
    bg: "#FFF1E8",
    fg: "#B93815",
    soft: "#FFF8F3",
  },
  green: {
    bg: "#E8F7EF",
    fg: "#067647",
    soft: "#F3FBF6",
  },
  red: {
    bg: "#FDECEC",
    fg: "#B42318",
    soft: "#FFF8F8",
  },
  blue: {
    bg: "#EAF1FF",
    fg: "#175CD3",
    soft: "#F5F8FF",
  },
} as const;

export function Icon({
  name,
  color = colors.steel,
  size = 20,
}: {
  name: IconName;
  color?: string;
  size?: number;
}) {
  return <Ionicons name={name} color={color} size={size} />;
}

export function PageTitle({
  title,
  subtitle,
  eyebrow,
}: {
  title: string;
  subtitle?: string;
  eyebrow?: string;
}) {
  return (
    <View style={styles.titleGroup}>
      {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function Section({
  title,
  children,
  action,
}: PropsWithChildren<{ title?: string; action?: ReactNode }>) {
  return (
    <View style={styles.sectionWrap}>
      {title || action ? (
        <View style={styles.sectionHeader}>
          {title ? <Text style={styles.sectionTitle}>{title}</Text> : <View />}
          {action}
        </View>
      ) : null}
      <View style={styles.group}>{children}</View>
    </View>
  );
}

export function Card({
  children,
  style,
}: PropsWithChildren<{ style?: ViewStyle | ViewStyle[] }>) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function RowButton({
  title,
  subtitle,
  detail,
  icon,
  tone = "neutral",
  onPress,
}: {
  title: string;
  subtitle?: string;
  detail?: string;
  icon?: IconName;
  tone?: Tone;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.rowButton, pressed ? styles.pressedSurface : null]}
    >
      {icon ? <IconBubble name={icon} tone={tone} /> : null}
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={2}>{title}</Text>
        {subtitle ? <Text style={styles.rowSubtitle} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {detail ? <Text style={styles.rowDetail} numberOfLines={1}>{detail}</Text> : null}
      <Icon name="chevron-forward" color={colors.faint} size={20} />
    </Pressable>
  );
}

export function InfoRow({
  label,
  value,
  icon,
  tone = "neutral",
}: {
  label: string;
  value: string;
  icon?: IconName;
  tone?: Tone;
}) {
  return (
    <View style={styles.infoRow}>
      {icon ? <IconBubble name={icon} tone={tone} size="small" /> : null}
      <View style={{ flex: 1 }}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue} numberOfLines={2}>{value}</Text>
      </View>
    </View>
  );
}

export function IconBubble({
  name,
  tone = "neutral",
  size = "regular",
}: {
  name: IconName;
  tone?: Tone;
  size?: "small" | "regular";
}) {
  const palette = toneStyles[tone];
  const dimension = size === "small" ? 30 : 38;
  return (
    <View style={[styles.iconBubble, { backgroundColor: palette.bg, height: dimension, width: dimension }]}>
      <Icon name={name} color={palette.fg} size={size === "small" ? 16 : 20} />
    </View>
  );
}

export function MetricTile({
  label,
  value,
  icon,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  icon: IconName;
  tone?: Tone;
}) {
  const palette = toneStyles[tone];
  return (
    <View style={[styles.metricTile, { backgroundColor: palette.soft }]}>
      <IconBubble name={icon} tone={tone} size="small" />
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel} numberOfLines={2}>{label}</Text>
    </View>
  );
}

export function Field(props: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor={colors.faint}
      {...props}
      style={[styles.input, props.multiline ? styles.inputMultiline : null, props.style]}
    />
  );
}

export function LabeledField({
  label,
  ...props
}: TextInputProps & { label: string }) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Field {...props} />
    </View>
  );
}

export function PrimaryButton({
  label,
  disabled,
  loading,
  icon,
  onPress,
}: {
  label: string;
  disabled?: boolean;
  loading?: boolean;
  icon?: IconName;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{
        busy: Boolean(loading),
        disabled: Boolean(disabled || loading),
      }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        pressed ? styles.buttonPressed : null,
        disabled || loading ? styles.buttonDisabled : null,
      ]}
    >
      {loading ? (
        <ActivityIndicator color="#FFFFFF" />
      ) : (
        <>
          {icon ? <Icon name={icon} color="#FFFFFF" size={18} /> : null}
          <Text style={styles.buttonText}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

export function SecondaryButton({
  label,
  disabled,
  loading,
  icon,
  onPress,
}: {
  label: string;
  disabled?: boolean;
  loading?: boolean;
  icon?: IconName;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{
        busy: Boolean(loading),
        disabled: Boolean(disabled || loading),
      }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.secondaryButton,
        pressed ? styles.secondaryButtonPressed : null,
        disabled || loading ? styles.buttonDisabled : null,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.orange} />
      ) : (
        <>
          {icon ? <Icon name={icon} color={colors.orangeDark} size={18} /> : null}
          <Text style={styles.secondaryButtonText}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

export function Badge({ label, tone = "neutral" }: { label: string; tone?: Tone }) {
  const palette = toneStyles[tone];
  return (
    <View style={[styles.badge, { backgroundColor: palette.bg }]}>
      <Text style={[styles.badgeText, { color: palette.fg }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

export function EmptyState({
  message,
  icon = "file-tray-outline",
}: {
  message: string;
  icon?: IconName;
}) {
  return (
    <View style={styles.empty}>
      <IconBubble name={icon} tone="neutral" />
      <Text style={styles.emptyText}>{message}</Text>
    </View>
  );
}

export function LoadingState({ label = "Loading SlabPlan" }: { label?: string }) {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.orange} />
      <Text style={styles.muted}>{label}</Text>
    </View>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <Card>
      <View style={styles.errorHead}>
        <IconBubble name="alert-circle-outline" tone="red" />
        <View style={{ flex: 1 }}>
          <Text style={styles.errorTitle}>Could not load</Text>
          <Text style={styles.muted}>{message}</Text>
        </View>
      </View>
      {onRetry ? <PrimaryButton label="Try again" icon="refresh" onPress={onRetry} /> : null}
    </Card>
  );
}

export const styles = StyleSheet.create({
  titleGroup: {
    gap: 5,
    paddingHorizontal: 2,
    paddingTop: 2,
  },
  eyebrow: {
    color: colors.orangeDark,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0,
    textTransform: "uppercase",
  },
  title: {
    color: colors.text,
    fontSize: 30,
    fontWeight: "800",
    lineHeight: 36,
  },
  subtitle: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 21,
  },
  sectionWrap: {
    gap: 8,
  },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 2,
  },
  sectionTitle: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0,
    textTransform: "uppercase",
  },
  group: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    overflow: "hidden",
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    padding: 14,
  },
  pressedSurface: {
    backgroundColor: colors.surfaceAlt,
  },
  rowButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderBottomColor: colors.divider,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 12,
    minHeight: 68,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  rowBody: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  rowTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 20,
  },
  rowSubtitle: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  rowDetail: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
    maxWidth: 96,
  },
  infoRow: {
    alignItems: "center",
    borderBottomColor: colors.divider,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 10,
    minHeight: 56,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  infoLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  infoValue: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 20,
    marginTop: 2,
  },
  iconBubble: {
    alignItems: "center",
    borderRadius: 8,
    justifyContent: "center",
  },
  metricTile: {
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    gap: 6,
    minHeight: 112,
    padding: 12,
  },
  metricValue: {
    color: colors.text,
    fontSize: 26,
    fontWeight: "900",
    lineHeight: 30,
  },
  metricLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 16,
  },
  fieldGroup: {
    gap: 7,
  },
  fieldLabel: {
    color: colors.steel,
    fontSize: 13,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.text,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: 13,
  },
  inputMultiline: {
    paddingTop: 12,
    textAlignVertical: "top",
  },
  button: {
    alignItems: "center",
    backgroundColor: colors.orange,
    borderRadius: 8,
    flexDirection: "row",
    gap: 8,
    minHeight: 50,
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  buttonPressed: {
    backgroundColor: colors.orangeDark,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  buttonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 46,
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  secondaryButtonPressed: {
    backgroundColor: "#FFF8F3",
  },
  secondaryButtonText: {
    color: colors.orangeDark,
    fontSize: 15,
    fontWeight: "800",
  },
  badge: {
    alignSelf: "flex-start",
    borderRadius: 6,
    maxWidth: 120,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "800",
    overflow: "hidden",
  },
  empty: {
    alignItems: "center",
    gap: 10,
    padding: 24,
  },
  emptyText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  loading: {
    alignItems: "center",
    gap: 10,
    padding: 24,
  },
  muted: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  errorHead: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  errorTitle: {
    color: colors.red,
    fontSize: 16,
    fontWeight: "800",
  },
});

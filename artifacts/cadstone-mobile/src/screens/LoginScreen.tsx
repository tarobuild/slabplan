import { useState } from "react";
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Screen } from "../components/Screen";
import { Card, LabeledField, PrimaryButton, colors } from "../components/ui";
import { login } from "../lib/api";
import { appBrand, loginContent } from "../lib/brand";

const appLogo = require("../../assets/slabplan-logo.png") as number;

export function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!email.trim() || !password) {
      Alert.alert(loginContent.missingTitle, loginContent.missingMessage);
      return;
    }

    setSubmitting(true);
    try {
      await login(email.trim(), password);
    } catch {
      Alert.alert(loginContent.failedTitle, loginContent.failedMessage);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen scroll={false} contentStyle={screenStyles.content}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={screenStyles.keyboard}
      >
        <View style={screenStyles.shell}>
          <View style={screenStyles.brandBlock}>
            <Image
              accessibilityLabel={appBrand.fullName}
              resizeMode="contain"
              source={appLogo}
              style={screenStyles.logo}
            />
            <View style={screenStyles.brandText}>
              <Text style={screenStyles.kicker}>FIELD APP</Text>
              <Text style={screenStyles.title}>{appBrand.shortName}</Text>
            </View>
          </View>

          <Card style={screenStyles.formCard}>
            <View style={screenStyles.heading}>
              <Text style={screenStyles.formTitle}>{loginContent.title}</Text>
              <Text style={screenStyles.subtitle}>{loginContent.subtitle}</Text>
            </View>
            <LabeledField
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              label={loginContent.emailLabel}
              onChangeText={setEmail}
              placeholder={loginContent.emailPlaceholder}
              textContentType="username"
              value={email}
            />
            <LabeledField
              autoCapitalize="none"
              autoComplete="current-password"
              label={loginContent.passwordLabel}
              onChangeText={setPassword}
              placeholder={loginContent.passwordPlaceholder}
              secureTextEntry
              textContentType="password"
              value={password}
            />
            <PrimaryButton
              icon="log-in-outline"
              label={loginContent.submitLabel}
              loading={submitting}
              onPress={submit}
            />
          </Card>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const screenStyles = StyleSheet.create({
  brandBlock: {
    alignItems: "center",
    gap: 12,
    marginBottom: 22,
  },
  brandText: {
    alignItems: "center",
    gap: 4,
  },
  content: {
    justifyContent: "flex-start",
    paddingHorizontal: 18,
    paddingTop: 104,
  },
  formCard: {
    gap: 18,
    padding: 18,
  },
  formTitle: {
    color: colors.text,
    fontSize: 26,
    fontWeight: "800",
    lineHeight: 32,
  },
  heading: {
    gap: 5,
    marginBottom: 2,
  },
  keyboard: {
    width: "100%",
  },
  kicker: {
    color: colors.orangeDark,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0,
  },
  logo: {
    height: 62,
    width: 118,
  },
  shell: {
    alignSelf: "center",
    maxWidth: 390,
    width: "100%",
  },
  subtitle: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 21,
  },
  title: {
    color: colors.text,
    fontSize: 32,
    fontWeight: "900",
    lineHeight: 39,
  },
});

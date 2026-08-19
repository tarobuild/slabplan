# SlabPlan Mobile App

The SlabPlan mobile app lives in `artifacts/cadstone-mobile`. It is a native
Expo/React Native app for iOS and Android that uses the same SlabPlan API,
users, roles, and tenant-isolated data as the web platform.

## Current operating status

The native app is included in the monorepo and must pass the normal typecheck
and test gates. It remains paused as the production-facing worker experience
until the owner approves a fresh native-app QA pass, preview, internal builds,
and store distribution. Field users should use the responsive SlabPlan web
app in the meantime.

Do not distribute Expo QR codes, preview builds, EAS builds, or app-store
releases as the active field path without owner approval.

## Field App Scope

The field surface includes:

- Existing-account sign-in and secure device session refresh.
- Role-aware Home, accessible jobs, job detail, and crew-readable summaries.
- Read-only job financials when the user has financial access.
- Mark assigned schedule items complete from job and field schedule detail.
- Add field notes and attach jobsite photos, videos, and files to schedule items.
- Job and personal daily logs, comments, reactions, publishing, and uploads.
- Attach camera photos, library photos/videos, and document-picker files to
  daily logs and permitted job folders.
- Browse company Resources and permission-aware job folders.
- Short-lived signed links for secure file viewing.

Office-heavy administration—clients, sales leads, reports, financial editing,
user management, schedule authoring, folder permissions, and advanced file
work—remains web-first until separately designed and QA-tested.

## Runtime configuration

Launch the app with an explicit API base URL:

```bash
EXPO_PUBLIC_SLABPLAN_API_BASE_URL=https://slabplan.replit.app pnpm --filter @workspace/cadstone-mobile start
```

For local testing, use the local API origin reachable from the simulator or
device. Do not hard-code production URLs in app code. The inherited
`EXPO_PUBLIC_CADSTONE_API_BASE_URL` name is accepted only as a compatibility
fallback while deployments migrate to the SlabPlan variable.

The `start:replit` script starts the Expo preview proxy on port `22477` and
runs Metro behind it. `start:tunnel` is available when direct preview routing
is unavailable.

## Release model

1. Mobile changes follow the same branch and review flow as the web app.
2. Expo Go, simulators, emulators, or internal builds provide preview QA.
3. Expo EAS creates native iOS and Android builds.
4. Apple App Store Connect and Google Play Console perform final review and
   distribution.

## Quality gates

Before owner review:

```bash
pnpm install
pnpm --filter @workspace/cadstone-mobile run typecheck
pnpm --filter @workspace/cadstone-mobile run test
pnpm typecheck
pnpm check-api-codegen
pnpm knip
pnpm --filter @workspace/cadstone run check-eager-bundle
```

Before a store build:

```bash
pnpm --filter @workspace/cadstone-mobile exec expo-doctor
pnpm --filter @workspace/cadstone-mobile exec eas build --profile preview --platform ios
pnpm --filter @workspace/cadstone-mobile exec eas build --profile preview --platform android
```

Manual QA must cover admin, project manager, and crew accounts, weak-signal
behavior, session refresh, permission denials, and daily-log creation.

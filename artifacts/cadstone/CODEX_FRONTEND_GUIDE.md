# CAD Stone Networks Frontend Build Guide

Use this guide to build the full UI inside the existing `artifacts/cadstone` React app. Do not re-scaffold the app, do not replace React Router, do not replace Zustand, and do not swap Axios for another client. Work inside the files that already exist.

Important accuracy note:

- As of April 7, 2026, the checked-in backend currently mounts these route groups: `auth`, `users`, `jobs`, `folders`, `files`, `leads` list only, and `activity`.
- The product brief also references expanded lead CRUD plus schedule and daily-log endpoints. Those routes are not present in `artifacts/api-server/src/routes` in this checkout today.
- Build the UI so live pages use the real routes that exist now.
- For the brief-only routes that are not mounted yet, scaffold the page UI and isolate those calls behind thin helper functions or TODO adapters so the pages are easy to finish when the backend lands.

## a. Project context

- Tech stack: React 18 + TypeScript + Vite, Tailwind CSS, shadcn/ui, Zustand, Axios, React Router v6.
- Base URL is `/`.
- API base is `/api`.
- Access token is stored in Zustand in `useAuthStore`.
- API calls must use `src/lib/api.ts`.
- All shadcn/ui imports must come from `@/components/ui/*`.
- Use Lucide React for all icons.
- Existing scaffold files to keep and extend:
  - `src/App.tsx`
  - `src/lib/api.ts`
  - `src/store/auth.ts`
  - `src/components/layout/AppLayout.tsx`
  - `src/components/layout/TopNav.tsx`
  - `src/components/layout/Sidebar.tsx`
  - `src/pages/login.tsx`
  - `src/pages/register.tsx`
  - `src/pages/dashboard.tsx`
  - `src/pages/jobs.tsx`
  - `src/pages/job-detail.tsx`
  - `src/pages/job-summary.tsx`
  - `src/pages/job-files-documents.tsx`
  - `src/pages/job-files-photos.tsx`
  - `src/pages/job-files-videos.tsx`
  - `src/pages/job-schedule.tsx`
  - `src/pages/job-daily-logs.tsx`
  - `src/pages/leads.tsx`
  - `src/pages/settings.tsx`

## b. Design rules

Use these exactly:

```text
Use shadcn/ui components everywhere — never hand-roll UI
White content backgrounds, #F9FAFB page background, #E5E7EB borders, 8px border-radius max
ALL creation forms are modals (shadcn/ui Dialog) — never inline
Information-dense layouts — compact tables, not oversized cards
Primary Blue #2563EB, Success #16A34A, Warning #F59E0B, Danger #DC2626
14px body text, system font or Inter
Every list needs search, sort, pagination, empty state
Every destructive action needs AlertDialog confirmation
Toasts top-right, 4s auto-dismiss, color-coded
```

Additional implementation rules:

- Keep the persistent shell in `AppLayout`.
- Use `Page background = #F9FAFB`, content surfaces = `white`, borders = `#E5E7EB`.
- Keep body text at `14px`.
- Prefer tables and split layouts over oversized card grids for list pages.
- Use `toast.success()` and `toast.error()` from `sonner`.

## c. Auth files already scaffolded

### `src/lib/api.ts`

This file already contains the shared Axios setup. Use it instead of creating a second API client.

- `authApi`:
  - Base URL: `/api`
  - `withCredentials: true`
  - Used for auth-specific calls like `POST /api/auth/login`, `POST /api/auth/register`, `POST /api/auth/refresh`, `POST /api/auth/logout`
- `api`:
  - Base URL: `/api`
  - `withCredentials: true`
  - Request interceptor reads `useAuthStore.getState().accessToken` and adds `Authorization: Bearer <token>`
  - Response interceptor handles `401` on non-auth routes by calling `POST /api/auth/refresh`, updating Zustand, then retrying the original request once
- Helpers already exported:
  - `refreshSession()`
  - `bootstrapAuthSession()`
  - `logoutSession()`

Do not replace this pattern. Extend it only if needed.

### `src/store/auth.ts`

This file already contains the in-memory auth store:

- `useAuthStore`
- Shape:
  - `user: AuthUser | null`
  - `accessToken: string | null`
  - `setAuth(user, accessToken)`
  - `clearAuth()`

Use it like this:

- On login success: `useAuthStore.getState().setAuth(data.user, data.accessToken)`
- On register success: same
- On logout: call `logoutSession()` or `clearAuth()`
- Do not persist the access token to localStorage or sessionStorage

### App bootstrap

`src/App.tsx` already calls `bootstrapAuthSession()` on mount before protected routes render. Keep that behavior. Do not remove the silent refresh flow.

## d. Complete API reference

### Live routes in the current server checkout

#### Auth

- `POST /api/auth/register`
  - Body:
    - `email: string`
    - `password: string`
    - `full_name: string`
  - Response:
    - `accessToken: string`
    - `expiresIn: number`
    - `user: { id, email, fullName, role, avatarUrl, phone, createdAt, updatedAt }`

- `POST /api/auth/login`
  - Body:
    - `email: string`
    - `password: string`
  - Response:
    - `accessToken: string`
    - `expiresIn: number`
    - `user: { id, email, fullName, role, avatarUrl, phone, createdAt, updatedAt }`

- `POST /api/auth/logout`
  - Body: none
  - Response:
    - `{ success: true }`
  - Effect: clears the refresh cookie

- `POST /api/auth/refresh`
  - Body: none
  - Uses the httpOnly refresh cookie
  - Response:
    - `accessToken: string`
    - `expiresIn: number`
    - `user: { id, email, fullName, role, avatarUrl, phone, createdAt, updatedAt }`

> Self-serve password reset is intentionally not exposed. Account passwords are
> managed directly by the admin (see `replit.md` → "Auth & password management").
> If the user UI offers a "Forgot password?" link, point it at a static contact
> message rather than an API call.

#### Jobs

- `GET /api/jobs?page&pageSize&search&status`
  - Query:
    - `page?: number`
    - `pageSize?: number`
    - `search?: string`
    - `status?: "open" | "closed" | "archived"`
  - Response:
    - `jobs: Array<{ id, title, status, city, state, streetAddress, zipCode, jobType, contractPrice, projectedStart, projectedCompletion, actualStart, actualCompletion, workDays, createdAt, updatedAt }>`
    - `pagination: { page, pageSize, totalItems, totalPages }`

- `POST /api/jobs`
  - Body:
    - `title: string`
    - `status?: "open" | "closed" | "archived"`
    - `streetAddress?: string | null`
    - `city?: string | null`
    - `state?: string | null`
    - `zipCode?: string | null`
    - `contractPrice?: string | number | null`
    - `jobType?: string | null`
    - `workDays?: Array<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun"> | null`
    - `projectedStart?: string | null`
    - `projectedCompletion?: string | null`
    - `actualStart?: string | null`
    - `actualCompletion?: string | null`
  - Response:
    - `{ job: JobDetail }`

- `GET /api/jobs/:id`
  - Response:
    - `{ job: { id, title, status, city, state, streetAddress, zipCode, jobType, contractPrice, projectedStart, projectedCompletion, actualStart, actualCompletion, workDays, createdAt, updatedAt, createdById, createdByName } }`

- `PUT /api/jobs/:id`
  - Body: same as `POST /api/jobs`
  - Response:
    - `{ job: JobDetail }`

- `DELETE /api/jobs/:id`
  - Response:
    - `{ success: true }`

#### Folders

- `GET /api/jobs/:jobId/folders?mediaType=document|photo|video&parentId=&all=`
  - Query:
    - `mediaType: "document" | "photo" | "video"`
    - `parentId?: string`
    - `all?: boolean`
  - Response:
    - `currentFolder: Folder | null`
    - `breadcrumb: Folder[]`
    - `folders: Array<Folder & { childFolderCount: number, fileCount: number }>`

- `POST /api/jobs/:jobId/folders`
  - Body:
    - `title: string`
    - `mediaType: "document" | "photo" | "video"`
    - `parentFolderId?: string | null`
  - Response:
    - `{ folder: Folder }`

- `PUT /api/folders/:id`
  - Body:
    - `title?: string`
    - `viewingPermissions?: Record<string, unknown> | null`
    - `uploadingPermissions?: Record<string, unknown> | null`
  - Response:
    - `{ folder: Folder }`

- `DELETE /api/folders/:id`
  - Response:
    - `{ success: true }`

- `POST /api/folders/:id/copy`
  - Body: none
  - Response:
    - `{ folder: Folder }`

- `PUT /api/folders/:id/move`
  - Body:
    - `destinationFolderId?: string | null`
  - Response:
    - `{ folder: Folder }`

- `POST /api/folders/:id/restore`
  - Response:
    - `{ folder: Folder }`

- `DELETE /api/folders/:id/purge`
  - Response:
    - `{ success: true }`

- `GET /api/folders/:id/download`
  - Response:
    - Binary zip stream

- `GET /api/jobs/:jobId/trash?mediaType=document|photo|video`
  - Response:
    - `{ folders: Folder[], files: File[] }`

- `DELETE /api/jobs/:jobId/trash?mediaType=document|photo|video`
  - Response:
    - `{ success: true }`

#### Files

- `GET /api/folders/:id/files`
  - Query:
    - `search?: string`
    - `uploadedBy?: string`
    - `fileTypes?: string | comma-separated string`
    - `from?: string`
    - `to?: string`
    - `sortBy?: "name_asc" | "name_desc" | "modified_newest" | "modified_oldest" | "added_newest" | "added_oldest"`
    - `includeDeleted?: boolean`
  - Response:
    - `{ folder: Folder, files: Array<{ id, folderId, filename, originalName, fileUrl, fileSize, mimeType, uploadedBy, uploadedByName, createdAt, updatedAt, deletedAt }> }`

- `POST /api/folders/:id/files`
  - Body:
    - `multipart/form-data`
    - field name is `files`
    - supports multiple files
  - Response:
    - `{ folder: Folder, files: File[] }`

- `PUT /api/files/:id`
  - Body:
    - `originalName: string`
  - Response:
    - `{ file: File }`

- `DELETE /api/files/:id`
  - Response:
    - `{ success: true }`

- `POST /api/files/:id/restore`
  - Response:
    - `{ file: File }`

- `DELETE /api/files/:id/purge`
  - Response:
    - `{ success: true }`

- `GET /api/files/:id/download`
  - Response:
    - Binary file stream

#### Leads

- `GET /api/leads`
  - Response:
    - `leads: Array<{ id, title, city, state, confidence, status, projectType, estimatedRevenueMin, estimatedRevenueMax, projectedSalesDate, createdAt, updatedAt }>`

#### Users

- `GET /api/users`
  - Response:
    - `{ users: Array<{ id, email, fullName, role, avatarUrl, phone, createdAt, updatedAt }> }`

- `GET /api/users/me`
  - Response:
    - `{ user: { id, email, fullName, role, avatarUrl, phone, createdAt, updatedAt } }`

- `PUT /api/users/me`
  - Body:
    - `fullName?: string`
    - `phone?: string`
    - `avatarUrl?: string`
  - Response:
    - `{ user: PublicUser }`

#### Activity

- `GET /api/activity?jobId&mediaType&folderId&limit`
  - Query:
    - `jobId: string`
    - `mediaType?: "document" | "photo" | "video"`
    - `folderId?: string`
    - `limit?: number`
  - Response:
    - `entries: Array<{ id, entityType, entityId, action, metadata, createdAt, userName }>`

### Product-brief endpoints that are not mounted in the current server checkout

These were requested in the product brief, but they are not present in `artifacts/api-server/src/routes` today. Build the page UI, keep the call sites isolated, and add TODO comments or thin adapter files so these pages can switch to live calls later.

- `POST /api/leads`
  - Intended payload, inferred from schema:
    - `title`
    - `streetAddress`
    - `city`
    - `state`
    - `zipCode`
    - `confidence`
    - `projectedSalesDate`
    - `estimatedRevenueMin`
    - `estimatedRevenueMax`
    - `status`
    - `projectType`
    - `notes`
    - `leadSource`

- `GET /api/leads/:id`
  - Intended response:
    - lead detail
    - contacts
    - assigned salespeople
    - tags
    - sources
    - attachments

- `PUT /api/leads/:id`
- `DELETE /api/leads/:id`
- `POST /api/leads/:id/contacts`
- `PUT /api/leads/:id/contacts/:contactId`
- `DELETE /api/leads/:id/contacts/:contactId`
- `POST /api/leads/:id/attachments`
- `DELETE /api/leads/:id/attachments/:attachmentId`
- `POST /api/leads/:id/convert-to-job`

- `GET /api/jobs/:jobId/schedule`
- `POST /api/jobs/:jobId/schedule`
- `GET /api/schedule-items/:id`
- `PUT /api/schedule-items/:id`
- `DELETE /api/schedule-items/:id`
  - Intended schedule item shape, inferred from schema and seed data:
    - `title`
    - `displayColor`
    - `startDate`
    - `workDays`
    - `endDate`
    - `isHourly`
    - `startTime`
    - `endTime`
    - `progress`
    - `reminder`
    - `notes`
    - `assigneeUserIds`

- `GET /api/jobs/:jobId/daily-logs?page&pageSize`
- `POST /api/jobs/:jobId/daily-logs`
- `GET /api/daily-logs/:id`
- `PUT /api/daily-logs/:id`
- `DELETE /api/daily-logs/:id`
- `POST /api/daily-logs/:id/publish`
- `POST /api/daily-logs/:id/attachments`
  - Intended daily-log shape, inferred from schema and seed data:
    - `logDate`
    - `title`
    - `notes`
    - `weatherData`
    - `includeWeather`
    - `includeWeatherNotes`
    - `weatherNotes`
    - `shareInternalUsers`
    - `shareSubsVendors`
    - `shareClient`
    - `isPrivate`
    - `tagNames`
    - `attachmentFileIds`
    - `publishedAt`

If you need these missing routes for UI development, add page-local mock adapters first. Do not pretend they are live.

## e. Page-by-page build instructions

### 1. `/login` and `/register`

- Files:
  - `src/pages/login.tsx`
  - `src/pages/register.tsx`
- Routes:
  - `/login`
  - `/register`
- Live API calls:
  - `POST /api/auth/login`
  - `POST /api/auth/register`
- Build requirements:
  - Use shadcn `Card`, `Input`, `Label`, `Button`
  - Keep forms compact and centered
  - On success call `useAuthStore.getState().setAuth(data.user, data.accessToken)`
  - Redirect to `/dashboard`
  - Show toast errors on failed auth
  - Add footer link between login and register

### 2. `AppLayout`

- Files:
  - `src/components/layout/AppLayout.tsx`
  - `src/components/layout/TopNav.tsx`
  - `src/components/layout/Sidebar.tsx`
- Routes:
  - Wrap every protected page
- Live API calls:
  - No required fetch on mount
  - Logout uses `POST /api/auth/logout`
- Build requirements:
  - Top nav:
    - logo
    - global search input stub
    - avatar dropdown with Profile, Settings, Logout
  - Sidebar:
    - global mode for `/dashboard`, `/jobs`, `/sales/leads`, `/settings`
    - job-context mode for `/jobs/:jobId/*`
  - Leave content inside `<Outlet />`

### 3. `/dashboard`

- File:
  - `src/pages/dashboard.tsx`
- Route:
  - `/dashboard`
- Live API calls:
  - `GET /api/jobs?page=1&pageSize=100`
  - `GET /api/leads`
  - `GET /api/users`
  - `GET /api/activity?jobId=<selected-job-id>` is live, but there is no global activity route without `jobId`
- Build requirements:
  - 4 stat cards
    - total jobs
    - open jobs
    - total leads
    - total users
  - quick actions row
  - recent activity feed
  - Because activity currently requires `jobId`, either:
    - pick the first open job and load its activity feed, or
    - show a “Select job for activity” state until the global activity endpoint exists

### 4. `/jobs`

- File:
  - `src/pages/jobs.tsx`
- Route:
  - `/jobs`
- Live API calls:
  - `GET /api/jobs?page&pageSize&search&status`
  - `POST /api/jobs`
- Build requirements:
  - Full-width compact table
  - Search input
  - Status filter
  - Pagination footer
  - Empty state
  - “+ Create Job” modal using `Dialog`
  - Row click navigates to `/jobs/:jobId/summary`

### 5. `/jobs/:id`

- Files:
  - `src/pages/job-detail.tsx`
  - `src/pages/job-summary.tsx`
- Routes:
  - `/jobs/:jobId`
  - `/jobs/:jobId/summary`
- Live API calls:
  - `GET /api/jobs/:id`
  - `PUT /api/jobs/:id`
- Build requirements:
  - Header with title, status badge, breadcrumb, edit/save action
  - Tabs
  - Summary tab editable form
  - Keep the route layout in `job-detail.tsx`
  - Keep the form implementation in `job-summary.tsx`

### 6. `/jobs/:id/files/documents`

- File:
  - `src/pages/job-files-documents.tsx`
- Route:
  - `/jobs/:jobId/files/documents`
- Live API calls:
  - `GET /api/jobs/:jobId/folders?mediaType=document&parentId=...`
  - `POST /api/jobs/:jobId/folders`
  - `PUT /api/folders/:id`
  - `DELETE /api/folders/:id`
  - `POST /api/folders/:id/copy`
  - `PUT /api/folders/:id/move`
  - `GET /api/folders/:id/files`
  - `POST /api/folders/:id/files`
  - `GET /api/folders/:id/download`
  - `GET /api/files/:id/download`
  - `DELETE /api/files/:id`
  - `GET /api/jobs/:jobId/trash?mediaType=document`
  - `DELETE /api/jobs/:jobId/trash?mediaType=document`
  - `GET /api/activity?jobId=:jobId&mediaType=document&folderId=:folderId`
- Build requirements:
  - root shows `Global Documents`
  - folder cards or rows
  - toolbar
  - grid/list toggle
  - breadcrumb
  - upload button and drag/drop
  - Create Folder modal
  - Activity modal
  - Filter sheet
  - Trash modal
  - Confirmation dialogs for delete and purge

### 7. `/jobs/:id/files/photos`

- File:
  - `src/pages/job-files-photos.tsx`
- Route:
  - `/jobs/:jobId/files/photos`
- Live API calls:
  - same folder/file endpoints as documents with `mediaType=photo`
- Build requirements:
  - flat folder structure
  - photo-only uploads
  - thumbnail grid
  - same toolbar pattern
  - no nested subfolders

### 8. `/jobs/:id/files/videos`

- File:
  - `src/pages/job-files-videos.tsx`
- Route:
  - `/jobs/:jobId/files/videos`
- Live API calls:
  - same folder/file endpoints as documents with `mediaType=video`
- Build requirements:
  - root includes `Global Videos`
  - video thumbnails
  - play icon + duration overlay
  - same toolbar pattern as photos/documents

### 9. `/sales/leads`

- File:
  - `src/pages/leads.tsx`
- Route:
  - `/sales/leads`
- Live API calls available now:
  - `GET /api/leads`
- Brief-only calls not mounted yet:
  - `POST /api/leads`
  - `GET /api/leads/:id`
  - `PUT /api/leads/:id`
  - `DELETE /api/leads/:id`
  - contacts, attachments, convert-to-job endpoints
- Build requirements:
  - full table
  - search
  - create modal UI
  - side `Sheet` with 3 tabs for details
  - Use live `GET /api/leads` now
  - Keep all create/detail/update logic behind helper functions so they can switch to live endpoints later

### 10. `/jobs/:id/schedule`

- File:
  - `src/pages/job-schedule.tsx`
- Route:
  - `/jobs/:jobId/schedule`
- Brief-only API calls, not currently mounted:
  - `GET /api/jobs/:jobId/schedule`
  - `POST /api/jobs/:jobId/schedule`
  - `GET /api/schedule-items/:id`
  - `PUT /api/schedule-items/:id`
  - `DELETE /api/schedule-items/:id`
- Build requirements:
  - Calendar view using `react-big-calendar`
  - List view
  - Gantt view using `frappe-gantt`
  - Create Schedule Item modal
  - Keep data access isolated in a helper file like `src/lib/schedule-api.ts`
  - If backend is still absent, render empty/loading states plus local stub adapters instead of hard errors

### 11. `/jobs/:id/daily-logs`

- File:
  - `src/pages/job-daily-logs.tsx`
- Route:
  - `/jobs/:jobId/daily-logs`
- Brief-only API calls, not currently mounted:
  - `GET /api/jobs/:jobId/daily-logs?page&pageSize`
  - `POST /api/jobs/:jobId/daily-logs`
  - `GET /api/daily-logs/:id`
  - `PUT /api/daily-logs/:id`
  - `DELETE /api/daily-logs/:id`
  - `POST /api/daily-logs/:id/publish`
  - `POST /api/daily-logs/:id/attachments`
- Build requirements:
  - card list
  - create modal
  - draft/publish states
  - weather fetch support
  - attach files
  - isolate all missing-route logic behind a helper module like `src/lib/daily-logs-api.ts`

### 12. `/settings`

- File:
  - `src/pages/settings.tsx`
- Route:
  - `/settings`
- Live API calls:
  - `GET /api/users/me`
  - `PUT /api/users/me`
- Build requirements:
  - profile form
  - save action
  - avatar URL field
  - keep it compact and information-dense

## f. Global patterns

### Toasts

- Use `import { toast } from "sonner"`
- Success:
  - `toast.success("Saved changes.")`
- Error:
  - `toast.error("Unable to save changes.")`
- Keep all toasts top-right, 4 second auto-dismiss

### Reusable delete confirmation

Create a reusable wrapper component such as:

- `src/components/confirm-action-dialog.tsx`

Use shadcn `AlertDialog` for:

- delete job
- delete folder
- delete file
- empty trash
- delete lead
- delete schedule item
- delete daily log

### Loading skeleton pattern

Create a reusable loading block such as:

- `src/components/page-loading-skeleton.tsx`

Use:

- `Skeleton` rows for tables
- `Skeleton` cards for dashboard stats
- `Skeleton` panes for detail sheets and tabs

### Empty state pattern

Create a reusable empty state component such as:

- `src/components/page-empty-state.tsx`

Pattern:

- icon
- title
- short description
- optional action button

### Shared implementation rules

- Keep API call logic close to each feature but behind helper functions when a route group is large
- Do not duplicate auth or retry logic outside `src/lib/api.ts`
- Do not use `fetch` directly for app data calls
- Use `Dialog` for all creation flows
- Use `AlertDialog` for destructive actions
- Use tables for dense lists
- Use `Sheet` for detail side panels
- Use `Tabs` for page sub-sections
- Use `ScrollArea` when panels can overflow

## Final instruction to Codex

Build the real UI on top of the existing scaffold. Keep the current route tree, keep the current auth store, keep the Axios client, and use live backend routes where they exist. For brief-only endpoints that are not mounted yet, build the page structure and isolate the missing calls so the UI can be completed without refactoring when those backend routes arrive.

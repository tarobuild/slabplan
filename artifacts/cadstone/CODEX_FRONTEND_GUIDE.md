# CAD Stone Networks — Codex Frontend Build Guide

This guide contains everything you need to build the complete frontend UI for this internal construction management tool. The backend API and database are already built and running. Your job is to replace the stub pages with fully functional implementations.

---

## Project Context

- **Framework**: React 18 + TypeScript + Vite
- **Router**: `wouter` (already installed and configured — do NOT switch to react-router-dom)
- **Styling**: Tailwind CSS v4 + shadcn/ui components
- **State**: Zustand (auth store at `src/store/auth.ts`)
- **HTTP**: Axios instance at `src/lib/api.ts` — always import this, never use fetch directly
- **Toasts**: `sonner` — `import { toast } from "sonner"` then `toast.success()`, `toast.error()`, `toast.warning()`
- **Icons**: lucide-react
- **Base path**: `/` (app runs at root)
- **API base**: `/api` (already configured in the axios instance)

---

## Authentication

The auth store (`src/store/auth.ts`) has:
```typescript
const { user, accessToken, setAuth, clearAuth } = useAuthStore();
// user: { id, email, fullName, role, avatarUrl, phone } | null
// setAuth(user, accessToken) — call after login/register
// clearAuth() — call after logout
```

The axios instance at `src/lib/api.ts`:
- Automatically attaches the Bearer token to every request
- Automatically calls `POST /api/auth/refresh` on 401 and retries
- Redirects to `/login` if refresh fails
- Always import as: `import api from "@/lib/api"`

---

## Non-Negotiable Design Rules

1. **Use shadcn/ui components everywhere** — all from `@/components/ui/*`. Never hand-roll buttons, inputs, dialogs, tables, badges.
2. **White content backgrounds** (`bg-white` or `bg-card`), **light gray page background** (`bg-background` = `#F9FAFB`), crisp `border-border` borders.
3. **ALL creation/edit forms are modals** — use shadcn/ui `Dialog`. Never show a form inline.
4. **Information-dense layouts** — compact tables, not oversized cards. Think Linear or Notion.
5. **Color palette**:
   - Primary: `text-primary` / `bg-primary` = `#2563EB`
   - Success green: `#16A34A` (use for won/success states)
   - Warning yellow: `#F59E0B` (use for warnings/in-negotiation)
   - Danger: `text-destructive` / `bg-destructive` = `#DC2626`
   - Neutral: `text-muted-foreground` = `#6B7280`
6. **14px body text** (`text-sm`). No ALL-CAPS labels.
7. **Every list/table needs**: search bar, sort controls, pagination, empty state.
8. **Every destructive action needs**: `AlertDialog` confirmation before executing.
9. **Toasts**: top-right, 4s auto-dismiss (already configured). Show for: all saves, deletes, uploads, publishes, errors.
10. Do not use emojis anywhere in the UI.

---

## Routing Structure (already set up in App.tsx)

```
/login                          → LoginPage (public)
/register                       → RegisterPage (public)
/dashboard                      → DashboardPage (protected)
/jobs                           → JobsPage (protected)
/jobs/:id                       → JobDetailPage — Summary tab (protected)
/jobs/:id/files/documents       → JobDetailPage — Documents tab (protected)
/jobs/:id/files/photos          → JobDetailPage — Photos tab (protected)
/jobs/:id/files/videos          → JobDetailPage — Videos tab (protected)
/jobs/:id/schedule              → JobDetailPage — Schedule tab (protected)
/jobs/:id/daily-logs            → JobDetailPage — Daily Logs tab (protected)
/sales/leads                    → LeadsPage (protected)
/settings                       → SettingsPage (already implemented)
```

The sidebar at `src/components/layout/Sidebar.tsx` automatically switches between global nav and job-context nav based on the current route. You don't need to touch the sidebar or top nav.

---

## API Reference

All calls go through `import api from "@/lib/api"`. Base URL is `/api`. All protected endpoints require auth (handled automatically by the axios interceptor).

### Auth
```
POST /api/auth/login            { email, password } → { user, accessToken }
POST /api/auth/register         { email, password, full_name } → { user, accessToken }
POST /api/auth/logout           → { success: true }
POST /api/auth/refresh          → { user, accessToken }
```

### Users
```
GET  /api/users                 → { users: User[] }
GET  /api/users/me              → User
PUT  /api/users/me              { full_name } → { user }
```

### Jobs
```
GET  /api/jobs                  ?page=1&pageSize=10&search=&status=open|closed|archived
                                → { jobs: Job[], total, page, pageSize }
POST /api/jobs                  { title, status?, streetAddress?, city?, state?, zipCode?,
                                  contractPrice?, jobType?, workDays?, projectedStart?,
                                  projectedCompletion?, actualStart?, actualCompletion? }
GET  /api/jobs/:id              → { job: JobWithCreatedBy }
PUT  /api/jobs/:id              same payload as POST
DELETE /api/jobs/:id            → { success: true }
```

Job status values: `"open"` | `"closed"` | `"archived"`
Job type values: `"countertops"` | `"backsplash"` | `"flooring"` | `"custom"`
Work days values: array of `"mon"` | `"tue"` | `"wed"` | `"thu"` | `"fri"` | `"sat"` | `"sun"`
Dates: `"YYYY-MM-DD"` string format
Contract price: string (decimal)

### Folders
```
GET  /api/jobs/:jobId/folders   ?mediaType=document|photo|video&parentId=
                                → { folders: Folder[] }
POST /api/jobs/:jobId/folders   { title, mediaType, parentFolderId? }
PUT  /api/folders/:id           { title }
DELETE /api/folders/:id         → { success: true }
POST /api/folders/:id/copy      → { folder }
PUT  /api/folders/:id/move      { targetParentId }
```

### Files
```
GET  /api/folders/:id/files     ?page=1&pageSize=20&sort=name_asc|name_desc|date_newest|date_oldest
                                → { files: FileRecord[], total, page, pageSize }
POST /api/folders/:id/files     multipart/form-data, field: "file"
                                → { file: FileRecord }
GET  /api/files/:id/download    → file stream (use as href with window.open or anchor tag)
DELETE /api/files/:id           → { success: true }
```

### Leads
```
GET  /api/leads                 → { leads: Lead[] }
POST /api/leads                 { title, streetAddress?, city?, state?, zipCode?,
                                  confidence?, projectedSalesDate?, status?,
                                  estimatedRevenueMin?, estimatedRevenueMax?,
                                  projectType?, notes?, leadSource? }
GET  /api/leads/:id             → { lead: LeadDetail } (with contacts, tags, sources, attachments)
PUT  /api/leads/:id             same payload as POST
DELETE /api/leads/:id           → { success: true }
POST /api/leads/:id/contacts    { firstName?, lastName?, displayName, streetAddress?,
                                  city?, state?, zipCode?, phone?, cellPhone?, email, label? }
PUT  /api/leads/:id/contacts/:contactId   same payload
DELETE /api/leads/:id/contacts/:contactId → { success: true }
POST /api/leads/:id/attachments multipart/form-data, field: "file"
DELETE /api/leads/:id/attachments/:attachmentId → { success: true }
POST /api/leads/:id/convert-to-job → { job: Job }
```

Lead status values: `"open"` | `"in_negotiation"` | `"won"` | `"lost"` | `"archived"`
Project type values: `"countertops"` | `"backsplash"` | `"flooring"` | `"custom"` | `"none"`

### Schedule Items
```
GET  /api/jobs/:jobId/schedule  ?startDate=&endDate= → { items: ScheduleItem[] }
POST /api/jobs/:jobId/schedule  { title, displayColor, startDate, workDays, endDate,
                                  isHourly?, startTime?, endTime?, progress?,
                                  reminder?, notes?, assigneeIds? }
GET  /api/schedule-items/:id    → { item: ScheduleItemDetail }
PUT  /api/schedule-items/:id    same payload as POST
DELETE /api/schedule-items/:id  → { success: true }
```

Display color values: `"red"` | `"blue"` | `"green"` | `"yellow"` | `"orange"` | `"purple"` | `"gray"`
Reminder values: `"none"` | `"1_day_before"` | `"3_days_before"` | `"1_week_before"`

### Daily Logs
```
GET  /api/jobs/:jobId/daily-logs ?page=1&pageSize=10 → { logs: DailyLog[], total, page, pageSize }
POST /api/jobs/:jobId/daily-logs { logDate, title?, notes, includeWeather?,
                                   shareInternalUsers?, shareSubsVendors?,
                                   shareClient?, isPrivate?, tagNames? }
GET  /api/daily-logs/:id         → { log: DailyLogDetail }
PUT  /api/daily-logs/:id         same payload as POST
DELETE /api/daily-logs/:id       → { success: true }
POST /api/daily-logs/:id/publish → { log }
POST /api/daily-logs/:id/attachments  multipart/form-data, field: "file"
```

### Activity Log
```
GET  /api/activity              ?entityType=&entityId=&page=1
                                → { entries: ActivityEntry[], total }
```

---

## Page Build Instructions

Build pages in this exact order. Each page lives in `src/pages/`. Replace the stub content.

---

### 1. `/dashboard` — `src/pages/dashboard.tsx`

**Layout**: Page title "Dashboard", 4 stat cards in a row, quick actions row, recent activity feed.

**Stat cards** — fetch counts from existing API endpoints:
- "Active Jobs" → call `GET /api/jobs?status=open&pageSize=1`, use `total` from response
- "Open Leads" → call `GET /api/leads`, count rows where `status === "open"`
- "Open Schedule Items" — call `GET /api/jobs` to get all job IDs, then for each job call schedule endpoint... (this is complex — simplify by showing total jobs, total leads, total from any available endpoint, or call a general count endpoint if the backend adds one)
- Actually for simplicity: show 4 cards with (1) total jobs, (2) open leads, (3) a "Quick Links" card linking to files, (4) a "Get Started" card. Use whatever counts are available from the existing endpoints.

**Quick actions row**: Three buttons side by side — "+ New Job", "+ New Lead", "+ Daily Log". Each opens its respective creation modal (reuse the same modal components you build for the list pages).

**Recent Activity feed**: Call `GET /api/activity?page=1` → shows last 20 entries. Each row: a small icon, description text, username, and relative timestamp ("2 hours ago" using date-fns `formatDistanceToNow`). Auto-refresh every 30 seconds.

---

### 2. `/jobs` — `src/pages/jobs.tsx`

**Toolbar**: Left — search input (debounced, 300ms). Right — "+ Create Job" button (primary blue, opens Dialog).

**Table** (shadcn/ui `Table` component, full width):
| Checkbox | Job Title (blue link → /jobs/:id) | Location (city, state) | Type | Status | Created | Contract Price |
- Each row is clickable → navigate to `/jobs/:id`
- Status badges: `"open"` = blue Badge, `"closed"` = gray, `"archived"` = light gray
- Contract price formatted as `$1,234.00`
- Data from `GET /api/jobs?page=&pageSize=10&search=&status=`

**Pagination footer**: "Showing 1-10 of 42" with Previous/Next buttons.

**Empty state**: Icon + "No jobs yet" + "Create your first job to get started." + Create Job button.

**Create Job Dialog** (shadcn/ui Dialog, ~600px wide):
Fields in a two-column grid:
- Title (full width, required)
- Job Type (Select: Countertops, Backsplash, Flooring, Custom)
- Street Address (full width)
- City | State (side by side)
- Zip Code | Contract Price (side by side, price with $ prefix)
- Projected Start | Projected Completion (date pickers, side by side)
Footer: Cancel, Create (primary blue)
On create: `POST /api/jobs`, toast.success("Job created"), refresh list, close dialog.

---

### 3. `/jobs/:id` — `src/pages/job-detail.tsx`

**Header**: 
```
Jobs > [Job Title]     (breadcrumb)
[Job Title]  [Status Badge]  [Edit button]
```

**shadcn/ui Tabs** with 6 tabs:
- Summary (default on /jobs/:id)
- Documents (active on /jobs/:id/files/documents)
- Photos (active on /jobs/:id/files/photos)
- Videos (active on /jobs/:id/files/videos)
- Schedule (active on /jobs/:id/schedule)
- Daily Logs (active on /jobs/:id/daily-logs)

Use wouter navigation to change the tab — clicking a tab navigates to its route. Detect the active tab from `useLocation()`.

**Summary Tab Content** (editable form):
Two-column layout for all fields:
- Title, Job Type, Street Address, City, State, Zip Code
- Contract Price, Projected Start, Projected Completion, Actual Start, Actual Completion
- Work Days (Mon-Sun checkboxes)
- Created By (read-only display with user name)
"Save Changes" button at bottom → `PUT /api/jobs/:id`, toast.success("Job saved")

**Files Tabs** (Documents / Photos / Videos): See section below.
**Schedule Tab**: See section below.
**Daily Logs Tab**: See section below.

---

### 4. Documents Section (`/jobs/:id/files/documents`)

Render inside the job detail page when the Documents tab is active.

**Toolbar** (horizontal bar at top):
Left side: help icon (?), gear icon, clock icon (opens Activity modal), share icon, filter funnel
Right side: "New" split button (main action = Create Folder, dropdown: Folder / Word Doc / Excel / From Global), "+ Upload" primary button

**View toggle**: Grid icon | List icon (two buttons, default = list)

**Sort dropdown**: "Sort by" → Name A-Z, Name Z-A, Modified Newest, Modified Oldest, Added Newest, Added Oldest

**Breadcrumb**: Documents > [Folder Name] > [Subfolder] (updates as user navigates)

**Root view** (no folder selected, `parentId=null`):
- Always show "Global Documents" folder card/row (this is the `isGlobal=true` folder with `mediaType='document'`)
- Show other folders from `GET /api/jobs/:jobId/folders?mediaType=document`

**Tile view — Folder card**:
```
┌─────────────────┐
│  FolderOpen icon │
│  Folder Name     │
│  "..." menu      │
└─────────────────┘
```
Click card → navigate into folder (set `currentFolderId` state). "..." menu → Rename (opens Dialog), Download (.zip), Copy share link (toast "Link copied"), Delete (AlertDialog confirmation → `DELETE /api/folders/:id`)

**List view — Folder row**: Checkbox | Name (link) | Modified | Added | Contents count | "..." menu

**Inside a folder** (currentFolderId set):
- Breadcrumb updates
- Shows subfolders + files from `GET /api/folders/:id/files`
- File row: Checkbox | icon by type (PDF/Word/Excel/image) | filename | uploaded by | modified | size | "..." menu (Download → `window.open("/api/files/:id/download")`), Rename, Delete)
- Supports nested subfolders (same folder pattern, just with parentId set)

**Create Folder Dialog**: Title (required), Parent folder dropdown (optional). `POST /api/jobs/:jobId/folders` with `mediaType: "document"`.

**File upload**: Click "+ Upload" → `<input type="file" accept=".pdf,.docx,.xlsx,.pptx,.txt,image/*">` → show progress bar → `POST /api/folders/:id/files` (FormData, field: "file") → toast.success("File uploaded")

**Drag and drop**: wrap the content area in a drop zone — on drop, upload each file to the current folder.

**Filter sidebar** (slides from right, use shadcn/ui Sheet): File type checkboxes (PDF, Word, Excel, Images, Video, Other), Date range (from/to), Uploaded by (user select), Clear all + Apply buttons.

**Activity Log modal** (clock icon): `GET /api/activity?entityType=folder&entityId=` → timeline list of 20 items with "Load more".

**Trash modal** (from More Actions → View trash): Deleted items from past 30 days. Restore button, Permanently Delete button, "Empty trash" button (red, AlertDialog).

---

### 5. Photos Section (`/jobs/:id/files/photos`)

Same pattern as Documents but:
- `mediaType: "photo"` in all API calls
- **Flat structure** — no nested subfolders. Only one level of folders.
- Upload accepts only `.jpg,.png,.gif,.webp`
- Inside a folder: "+ Add photos" button
- Tile view shows actual `<img>` thumbnails using the file's URL (construct from `/api/files/:id/download` or use `file.fileUrl` if populated)
- No Global Photos folder

---

### 6. Videos Section (`/jobs/:id/files/videos`)

Same pattern as Documents but:
- `mediaType: "video"` in all API calls
- Upload accepts only `.mp4,.mov,.avi,.webm`
- Inside a folder: "+ Add video" button
- Tile view shows `<video>` thumbnail with play icon overlay + duration if available
- Global Videos folder IS present at root (same as Global Documents pattern)

---

### 7. `/sales/leads` — `src/pages/leads.tsx`

**Toolbar**:
Left: help (?), gear, export icon, filter funnel (with active count badge)
Right: "+ Lead Opportunity" primary button → opens Create Lead Dialog

**Table** (full width, shadcn/ui Table):
| Checkbox | Title (blue link, click opens detail Sheet) | Created Date | Client Contact | Status badge | Age (days since created) | Confidence (% + small progress bar) | Est. Revenue Min |
- Click title → open lead detail side panel (Sheet)

**Status badges**:
- open → blue
- in_negotiation → yellow/amber
- won → green
- lost → gray
- archived → light gray

**Bottom bar**: View filter dropdown (All / Open / Won / Lost) | "..." menu (Export CSV, Delete selected) | Pagination
**Revenue summary**: "Total Estimated Revenue: $X" (sum of estimatedRevenueMin for all visible rows)
**Empty state**: "No leads yet — Create your first lead opportunity." + button

**Create Lead Dialog** (~700px wide, two-column layout):
Left column: Title (required), Street Address, City, State, Zip, Confidence (Slider 0-100 + number input), Projected Sales Date (date picker), Status (Select)
Right column: Client Contact (search or "New Contact" button), Salespeople (multi-select from `GET /api/users`), Project Type (Select), Est. Revenue Min (currency), Est. Revenue Max (currency), Lead Source (text), Tags (tag input)
Bottom (full width): Notes (textarea)
Footer: Cancel | Create

On create: `POST /api/leads`, toast.success("Lead created"), refresh list, close dialog.

**Lead Detail Side Panel** (shadcn/ui Sheet, `side="right"`, ~500px):
Header: Lead title, Status badge, X close button
Tabs: General | Activities | Proposals

**General Tab** (scrollable):
Contact Information section:
- Empty state: "Add a client contact" + "New Contact" button + "Choose Existing" button
- Populated: Contact card (display name, email, phone) with "..." menu (Edit, Remove)

Editable fields (all wired to `PUT /api/leads/:id` on Save):
- Title, Address fields, Confidence (slider), Projected sales date, Status (select), Project type (select)
- Salespeople (multi-select chips)
- Tags (pill inputs with add/remove)
- Est. revenue min/max
- Lead source
- Notes (large textarea)
- Attachments (file upload + file list with download/delete)

**Activities Tab**: Empty list + "+ Lead Activity" button + empty state "Log calls and appointments with your potential clients."

**Proposals Tab**: Empty state + "Convert to a Job for full proposal features" link

**Bottom action bar** (fixed at bottom of Sheet):
Left: "Created by [name] on [date]"
Center: "..." menu (Duplicate, Convert to job → `POST /api/leads/:id/convert-to-job` then navigate to new job, Delete → AlertDialog)
Right: Cancel | Save (primary blue)

**Add Client Contact Dialog**: firstName, lastName, displayName (required), address, phone, cellPhone, email (required), label. `POST /api/leads/:id/contacts`, toast.success.

---

### 8. Schedule Tab (`/jobs/:id/schedule`)

Toolbar: help, gear, clock (activity modal), "Schedule Offline" toggle, "More Actions" dropdown (Import from templates, Track conflicts, Notify assigned users, Delete all items, Export to PDF), Filter, "+ New Schedule Item"

**View mode toggle** (3 buttons): Calendar | List | Gantt (default to Calendar)

**Calendar View**:
Install and use `react-big-calendar` with `date-fns` localizer:
```bash
pnpm --filter @workspace/cadstone add -D react-big-calendar @types/react-big-calendar
```
- Data: `GET /api/jobs/:jobId/schedule` → map items to calendar events
- Granularity dropdown: Month / Week / Day / Agenda
- "Today" button, prev/next arrows, month/year display
- Today's date cell: blue circle on date number
- Weekend cells: light gray background, "Non-workday" label
- Schedule items as color-coded pills using `item.displayColor`
- Click event → open Schedule Item Detail modal

**List View** (shadcn/ui Table):
| Task Name (link) | Assigned To | Start Date | End Date | Duration | Progress (%) | Status | Actions (...) |
Click task name → open detail modal. Empty state: "No schedule items — Add a schedule item."

**Gantt View**:
Install and use `frappe-gantt`:
```bash
pnpm --filter @workspace/cadstone add -D frappe-gantt
```
Left panel: task list (name, start, duration, end). Right panel: timeline bars. Today marker (vertical red line). Zoom controls (+/-).
Empty state: "Balance multiple projects with Schedule" + "Add a Schedule item" button.

**Create Schedule Item Dialog** (tabs: Schedule Item Details | Related Items):
Schedule Item Details tab:
- Title (required)
- Display Color (colored swatch dropdown: red/blue/green/yellow/orange/purple/gray)
- Assignees (multi-select from `GET /api/users`)
- Start Date (required date picker)
- Work Days (number input, "business days")
- End Date (auto-calculated: start + work days skipping weekends; can be manually overridden)
- Hourly toggle (Switch) — when ON show Start Time and End Time inputs
- Progress (Slider 0-100)
- Reminder (Select: None, 1 day before, 3 days before, 1 week before)
- Notes (textarea)

Related Items tab:
- Predecessors: "Add predecessor" → search/select existing tasks. Dependency type (Select). Lag days (number).
- Tags (tag input)

Footer: Cancel | Save

`POST /api/jobs/:jobId/schedule` with all fields + `assigneeIds: string[]`

---

### 9. Daily Logs Tab (`/jobs/:id/daily-logs`)

**Toolbar**: help, gear, print icon, filter (with badge count), "+ Daily Log" button (opens modal)

**Card list** (vertical stack):
```
┌─────────────────────────────────────┐
│ Title                        [Date] │
│ Created by: User Name    [edit icon] │
│ Preview of notes (2-3 lines)  [...] │
│ [Tag1] [Tag2]              [Draft/Published badge] │
└─────────────────────────────────────┘
```
Click card → open log in a full-page modal or expanded view for editing.

**Filter sidebar** (shadcn/ui Sheet from right):
- Shared with (Select: All, Internal only, Shared with subs, Shared with client, Private)
- Keywords (text search)
- Created by (user select)
- Date range (from/to)
- Tags (checkboxes)
- Clear all + Apply

**Pagination**: "1-10 of 45"

**Empty state**: "No daily logs yet — Create a daily log to capture site progress, observations, and weather conditions." + button

**Create Daily Log Dialog** (~900px wide, two-column):
Left column (40%):
- Job (pre-filled, read-only display)
- Date (required date picker, default: today)
- Title (text input, optional)
- Tags (tag input)
- Share permissions (checkboxes): Internal Users (checked by default), Subs/Vendors, Client, Private
- Notify users (multi-select user chips)

Right column (60%):
- Attachments section: "Add" button (file upload) + "Create new doc" button + file list below
- Notes (large textarea, min-height 200px, placeholder: "Document today's work, observations, and important details...")
- Weather section:
  - "Include Weather Conditions" checkbox (checked by default)
  - When checked: auto-fetch from OpenWeatherMap API using job's city/state
    - API call: `GET https://api.openweathermap.org/data/2.5/weather?q={city},{state},US&appid={OPENWEATHER_API_KEY}&units=imperial`
    - Display as read-only card: Condition, Temp High, Temp Low, Wind Speed, Humidity, Precipitation
    - If API key missing or fetch fails: show "Weather unavailable" gracefully
  - "Include Weather Notes" checkbox → optional textarea when checked

Fixed bottom bar:
- Left: info icon + "Daily logs are auto-saved as drafts"
- Right: "Save as Draft" (secondary) | "Publish" (primary blue)

On "Save as Draft": `POST /api/jobs/:jobId/daily-logs` or `PUT /api/daily-logs/:id`, toast.success("Draft saved")
On "Publish": same save + `POST /api/daily-logs/:id/publish`, toast.success("Daily log published")

---

## Global Shared Components to Create

Create these in `src/components/`:

### `ConfirmDialog.tsx`
Reusable AlertDialog for all destructive actions:
```typescript
interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  onConfirm: () => void;
  loading?: boolean;
  destructive?: boolean;
}
```

### `EmptyState.tsx`
Consistent empty state component:
```typescript
interface EmptyStateProps {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}
```

### `LoadingSkeleton.tsx`
Skeleton loaders for list views using shadcn/ui `Skeleton`.

---

## Package Installation Notes

For calendar and Gantt features, run these in the shell before building those pages:
```bash
pnpm --filter @workspace/cadstone add -D react-big-calendar @types/react-big-calendar
pnpm --filter @workspace/cadstone add -D frappe-gantt
```

---

## Key Technical Notes

- **wouter params**: Use `import { useParams } from "wouter"` → `const { id } = useParams<{ id: string }>()`
- **wouter navigation**: `import { useLocation } from "wouter"` → `const [, navigate] = useLocation()`; `navigate("/dashboard")`
- **File uploads**: Use `FormData`, set field name to `"file"`, pass as `api.post(url, formData)` — axios handles content-type automatically
- **Dates**: Use `date-fns` for formatting — `format(new Date(dateStr), "MMM d, yyyy")`, `formatDistanceToNow(new Date(dateStr), { addSuffix: true })`
- **Currency**: Format with `new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(price))`
- **Debounced search**: Use `useState` + `useEffect` with a 300ms `setTimeout` for search inputs
- **Tags input**: Simple pattern — text input on Enter/comma adds a pill; click X on pill removes it
- **Multi-select users**: Dropdown with checkboxes, shows selected as chips/badges

---

## Seed Data Available for Testing

Log in with any of these credentials (password: `Cadstone123!` for all):
- `cruz.martinez@cadstone.internal` (admin)
- `maria.garcia@cadstone.internal` (project_manager)
- `jake.thompson@cadstone.internal` (crew_member)

5 jobs and 3 leads are pre-seeded in the database.

---

## Build Order (recommended)

1. Dashboard page (stat cards + activity feed)
2. Jobs list page + Create Job modal
3. Job detail page + Summary tab
4. Documents section (most complex — get this right first)
5. Photos section (simpler version of Documents)
6. Videos section (simpler version of Documents)
7. Leads list + Create Lead modal
8. Lead detail side panel (Sheet)
9. Schedule tab (Calendar view first, then List, then Gantt)
10. Daily Logs tab
11. Polish: confirm dialogs everywhere, loading skeletons, error boundaries

Good luck. Build it fully functional — real API calls, no mocked data.

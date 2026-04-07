# BuilderTrend vs CAD Stone Networks — Feature-by-Feature Comparison

**Date:** April 6, 2026
**Purpose:** Thorough side-by-side analysis of how BuilderTrend implements each feature vs. how our CAD Stone Networks build currently implements it, with specific gap analysis and fix recommendations.
**Context:** The client uses BuilderTrend today and wants an internal tool that replicates the 3 features they actually use — without all the extra noise. This document captures exactly how BT does it so we can match it where it matters.

---

## 1. OVERALL NAVIGATION & LAYOUT

### BuilderTrend
- **Top nav bar** (orange): Sales | Jobs | Project Management | Files | Messaging | Financial | Reports — each is a dropdown with sub-options
- **Left sidebar**: Job selector panel — shows all jobs with filter (1), sort arrows, search box, job cards with status badges ("Open"), info/email/home icons
- **"Back to Summary"** link at top-left above sidebar — always present when inside a job context
- **"New Job"** blue button at top of sidebar
- **Collapse toggle** (chevron) to hide/show sidebar
- **Global search bar** in top-right
- **User avatar** and notification icons in top-right
- **Breadcrumb navigation** inside content area (e.g., "Videos / ** Global Videos ** / Progress videos")

### Our Build (CAD Stone Networks)
- **Left sidebar** as primary navigation: Dashboard, Jobs, Schedule, Daily Logs, Documents, Photos, Videos, Sales/Leads, Settings
- **No top nav bar** — sidebar is the only navigation
- **No job selector sidebar** — jobs are accessed from a Jobs page table
- **Breadcrumb navigation** partially built (Documents has it but breadcrumb clicks are broken)

### Gaps
- BT's top nav + left job-selector is a fundamentally different layout from our sidebar-only nav. For a 5-person internal tool, our sidebar approach is simpler and fine. BUT we need the breadcrumbs to actually work.
- BT's left sidebar is a **job switcher** — you can jump between jobs while staying on the same feature page. Our build requires going back to the Jobs table to switch jobs. This is a minor UX difference that the client may or may not care about.

---

## 2. FILES — DOCUMENTS (Client's #1 Feature)

### BuilderTrend Documents
- **Accessed via**: Files dropdown → Documents (separate menu items for Documents, Photos, Videos)
- **Root level shows folders as tile cards** in a grid (gray background, gold folder icon, folder name, permission icons: tag, home, "..." context menu)
- **"Folders"** label with **"Select all"** checkbox
- **Toolbar**: "..." more actions (View trash, help, settings, activity), "+ Folder" split button with "Import" dropdown option
- **Sort by** dropdown with sort direction toggle
- **Grid/List toggle** (called "Tile" / "Table" internally) — Tile is default
- **Breadcrumb navigation**: "Documents / ** Global Documents ** / Change Orders" — each segment clickable
- **Folder context menu** (right-click or "..." button): Copy share link, Folder info, Rename, Download, Create QR code, View permissions, Delete
- **Inside a folder**: Toolbar changes to show "More actions" dropdown, "Add folder" text button, **"+ Upload"** primary blue button (this only appears inside folders)
- **File display in Table mode**: columns = checkbox, Name (with file icon), Shared with icons, Modified date, Added date, Size, Contents, Actions ("...")
- **Pagination**: "1-3 of 3 items" at bottom
- **Settings modal**: Auto-create folder for subs/vendors/clients, Default viewing permissions (Subs/Vendors, Clients)

### Our Build Documents
- Accessed via sidebar → Documents
- Root level shows folders as a **simple list** (no tile cards)
- "+ New Folder" button only (no split button, no Import)
- Inside a folder: file table with Name, Size, Uploaded By, Date columns
- Breadcrumb navigation exists but **clicking root "Documents" is broken**
- No Sort by dropdown
- No Grid/List toggle
- No folder context menu (no rename, delete, permissions, share link)
- No Select All checkbox
- Upload button only appears inside folders (same as BT, but missing at root)

### Critical Gaps to Fix
1. **Folder tile card view** — Folders should display as styled tile cards with icons, not plain list items
2. **Grid/List (Tile/Table) toggle** — Must add for all three file sections
3. **Sort by dropdown** — Need sort options (Name, Modified, Added)
4. **Folder context menu** — Right-click or "..." on folders needs: Rename, Delete, Download, View info
5. **Breadcrumb fix** — Root breadcrumb click must navigate back properly
6. **Select All checkbox** — For bulk operations
7. **"+ Folder" split button** with "Import" dropdown option

---

## 3. FILES — PHOTOS (Client's #1 Feature — Separate View)

### BuilderTrend Photos
- **Accessed via**: Files dropdown → Photos (separate icon from Documents — image/mountain icon)
- **Root level**: Same folder tile card architecture as Documents
- **Same toolbar pattern**: "...", help, settings, history, "+ Folder" split button with "Import"
- **Inside a folder**: Photos would display as a **thumbnail grid** — large image cards with the actual photo visible, filename below, and action icons
- **Grid/List toggle** present — Grid shows thumbnails, Table shows file listing
- **Settings**: Separate "Photo folders" section with auto-create folder for clients, viewing permissions, AND **uploading permissions** (additional field not in Documents)

### Our Build Photos
- Accessed via sidebar → Photos
- **Identical to Documents** — shows as file table with Name, Size, Uploaded By, Date
- No thumbnail grid view
- No image preview on click
- No lightbox viewer
- No Grid/List toggle

### Critical Gaps to Fix
1. **THUMBNAIL GRID VIEW** — This is THE #1 gap. Photos inside a folder must show as a responsive grid of actual image thumbnails, not a file table
2. **Image lightbox** — Clicking a photo should open a full-size preview overlay
3. **Grid/List toggle** — Default to Grid (thumbnails), allow switch to Table (file list)
4. The client specifically said "Another menu for videos and photos different from actual files" — our build has them as different sidebar items (good) but the DISPLAY is identical (bad)

---

## 4. FILES — VIDEOS (Client's #1 Feature — Separate View)

### BuilderTrend Videos
- **Accessed via**: Files dropdown → Videos (play button icon)
- **Root level**: Folder tile cards (e.g., "Global Videos" folder)
- **Inside a folder (Tile/Grid view)**: Video thumbnail cards with:
  - Large thumbnail image from the video
  - Semi-transparent **play button overlay** (circle with triangle)
  - Filename below (e.g., "20191107_103512.mp4")
  - Bottom icon bar: Purple play icon, comments icon, tag icon, share icon, "..." context menu
- **Inside a folder (Table view)**: Columns = checkbox, Name (with purple play icon), Shared with icons, Modified, Added, **Duration** (video-specific!), Contents, Actions
- **Pagination**: "1-3 of 3 items"
- **Video context menu**: Share | Video info, Download | Rename, Viewing permissions, Make a copy, Move to folder, Move to trash (red)
- **Toolbar inside folder**: "More actions" dropdown, "Add folder" text button, **"+ Upload"** primary blue button
- **Grid/List toggle** — Grid shows video thumbnails with play overlays, Table shows file listing with Duration column

### Our Build Videos
- Accessed via sidebar → Videos
- **Identical to Documents and Photos** — file table with Name, Size, Uploaded By, Date
- No video thumbnails
- No play button overlay
- No video player on click
- No Duration column in table view
- No Grid/List toggle

### Critical Gaps to Fix
1. **Video thumbnail grid** — Show video thumbnails with play button overlay in grid view
2. **Video player** — Clicking a video should open an inline player or modal player
3. **Duration column** — When in Table view, show video duration
4. **Grid/List toggle** — Default to Grid (thumbnails), allow switch to Table
5. **Video context menu** — Download, Rename, Move to folder, Delete (move to trash)

---

## 5. FILES — SHARED PATTERNS ACROSS ALL THREE SECTIONS

### What BuilderTrend Does Consistently
- All three sections share the **same root-level folder architecture** (tile cards, sort, grid/list toggle, select all)
- The **toolbar changes context** when you're at root level (shows "+ Folder" split button) vs. inside a folder (shows "More actions", "Add folder", "+ Upload")
- **Breadcrumb navigation** is always present inside folders
- **Folder info/create modal** has: Title, Parent folder dropdown, Viewing permissions (Subs/Vendors, Clients), Cancel/Create buttons
- **File Settings modal** (gear icon) has three sections: Document folders, Photo folders (with extra uploading permissions), Video folders, and Signature request
- **View trash** option in the "..." menu for recovering deleted files

### What Our Build Should Do
- Since this is an internal-only tool (~5 users, no clients/subs), we can simplify permissions. No need for Subs/Vendors/Clients toggles.
- BUT we must match the **visual separation**: Documents = file table view, Photos = thumbnail grid, Videos = thumbnail grid with play overlays
- Breadcrumbs, folder context menus, sort, and grid/list toggles should be consistent across all three

---

## 6. SCHEDULE

### BuilderTrend Schedule
- **Three sub-tabs**: Schedule | Baseline | Workday Exceptions
- **Three view modes**: Calendar | List | Gantt — toggled via radio buttons
- **Calendar view**: Full month calendar grid with day columns (Sun-Sat), "Non-workday" labels on weekends, today highlighted in blue, month navigation (< Month dropdown >), "Today" quick button, "Expand All"
- **List view**: Tabular list of schedule items with "View" dropdown
- **Gantt view**: Timeline bar chart (empty in test account)
- **Toolbar**: Settings gear, history icon, "Schedule Offline" toggle, "More Actions" dropdown, "Filter" button, **"New Schedule Item"** primary blue button
- **Schedule Item creation form** (full-page modal):
  - Title (required)
  - Display Color (color picker with named options like "Levi")
  - Assignees (multi-select)
  - Start Date (required), Work Days (required, with "day" unit), End Date (required)
  - Hourly toggle
  - Progress slider (0-100%)
  - Reminder dropdown (None, etc.)
  - **Bottom tabs**: Predecessors & Links (dependency management with Finish-to-Start types), Phases & Tags, Viewing, Notes (sub-tabs: All Notes, Internal Notes, Sub Notes, Client Notes), Files
  - **Save** split button (additional save options)
- **Empty state**: "Balance multiple projects with Schedule" with recommended templates (Service Work, Standard Pool)
- **Warning banner**: "Your schedule is offline and is unavailable to subs and clients"

### Our Build Schedule
- Single page with schedule item list (table view)
- "+ Add Item" button opens a modal
- Modal has: Title, Start Date, End Date, Work Days, Description
- Table shows: Title, Start Date, End Date, Work Days, Assignees, Status (blue dot)
- No Calendar view
- No Gantt view
- No List/Calendar/Gantt toggle
- No Assignees field in create modal
- No Progress tracking
- No Color coding
- No Reminder
- No Predecessors/dependencies
- No Notes sub-categories
- No Filter button

### Gaps to Fix (Prioritized for Client Need)
1. **Calendar view** — Add a month calendar view as the default, similar to BT. This is the most visual and useful view for a stone installation crew.
2. **Assignees field in create modal** — Must be able to assign schedule items to team members
3. **Status field** — Add clear status (Not Started, In Progress, Complete) instead of unmarked blue dot
4. **Progress percentage** — Simple 0-100% slider
5. **Notes field** — Add a text area for notes on each schedule item
6. **Color coding** — Nice to have for visual calendar distinction
7. Calendar/List toggle — Allow switching between calendar and list views
8. Gantt view is NOT needed for a 5-person stone company — skip this

---

## 7. DAILY LOGS

### BuilderTrend Daily Logs
- **Two-column form layout** for creating a daily log:
  - **Left column**: Title, Tags (multi-select), Permissions, Notify Users
  - **Right column**: Notes (rich text), Weather section with auto-populated data (Temperature, Wind speed, Humidity, Precipitation, weather icon)
- **"Publish"** button (not just "Save" — implies draft/publish workflow)
- **Daily Logs list**: Toolbar with icons, left sidebar as job selector, empty state pattern
- **Tags system** for categorizing logs
- **Permissions** control on individual logs
- **Notify Users** option to alert team members
- **Auto-populated weather** data based on job location — temperature, wind, humidity, precipitation with visual icon

### Our Build Daily Logs
- Create modal with: Title, Date, Weather (manual text), Crew Members (text), Work Performed (text area), Materials Used (text area), Notes (text area)
- Daily logs list in a table with columns
- No two-column layout
- No auto-populated weather
- No Tags
- No Permissions on individual logs
- No Notify Users
- No Publish/Draft workflow

### Gaps to Fix
1. **Auto-populated weather** — Use a weather API to auto-fill temperature, conditions, wind, humidity based on date and job location. This was called out in the spec.
2. **Two-column form layout** — Match BT's left/right column layout for the creation form
3. **Tags** — Add a tag/category system for daily logs
4. Weather fields should be structured (Temperature, Wind, Humidity, Precipitation) not a single text field

---

## 8. SALES / CRM (Lead Opportunities)

### BuilderTrend Sales
- **Accessed via**: Sales top nav dropdown with 5 sub-options:
  1. Lead Opportunities (gear icon)
  2. Lead Activities (phone icon)
  3. Lead Proposals (document icon)
  4. Lead Activity Calendar (calendar icon)
  5. Lead Map (map pin icon)
- This is a full CRM suite with lead tracking, activity logging, proposals, calendar, and geographic mapping

### Our Build Sales/Leads
- Accessed via sidebar → Sales/Leads
- Single page with leads table: Company, Contact, Status, Value, Source, Date
- "+ New Lead" button opens modal with: Company Name, Contact Name, Email, Phone, Source (dropdown), Status (dropdown), Estimated Value
- Lead rows are NOT clickable — can't view or edit lead details
- No lead detail view / side panel
- No activity tracking per lead
- No proposal generation
- No calendar view for activities

### Gaps to Fix (Remember: Client said CRM is SECONDARY, word-of-mouth business)
1. **Lead rows must be clickable** — Open a detail side panel or page showing all lead info with edit capability
2. **Contact fields in create modal** — Contact Name, Email, Phone must be added (some are missing)
3. **Notes/Description field** — Need a text area for lead notes
4. **Assigned To field** — Assign leads to team members
5. Lead Activities and Proposals are probably overkill for this client — skip unless requested
6. Lead Map — skip

---

## 9. JOB DETAIL / JOB SUMMARY

### BuilderTrend Job Detail
- **Job Summary Dashboard** (landing page when selecting a job):
  - Job name with **"Open"** status badge and "..." menu
  - Internal users clocked in count
  - "View time sheets" link
  - **Clients** section with "+" add button
  - **Project Managers** section with "+" add button
  - **PAST DUE / DUE TODAY / ACTION ITEMS** counters
  - **RECENT ACTIVITY FROM YOUR TEAM** feed with Filter button
  - Right sidebar: Updates shared with clients counter, Client Updates / Daily Logs toggle, **THIS WEEK'S AGENDA** daily calendar
- **Jobs dropdown** has: Summary, Job Info, Job Price Summary, Jobs List, Jobs Map, New Job From Scratch, New Job From Template
- **"New Job" button** always visible in left sidebar

### Our Build Job Detail
- Job detail page with tabs: Summary, Documents, Photos, Videos, Schedule, Daily Logs
- Summary tab shows: Job Name, Client Name, Status, Job Type, Address fields, Start Date, End Date, Work Days
- No dashboard-style overview
- No activity feed on job detail
- No Past Due / Due Today / Action Items counters
- No Clients or Project Managers sections
- No "This Week's Agenda" sidebar

### Gaps to Fix
1. **Save Changes button** — Currently no way to save edits on the Summary tab
2. **Description/Notes field** — Add a text area for job description
3. **Client/Contact link** — Field to associate a job with a client contact
4. **Assigned To** — Show and manage team members assigned to the job
5. The BT dashboard view is nice but may be overbuilt for 5 users. Our tabbed approach (Summary, Documents, Photos, Videos, Schedule, Daily Logs) is actually a good simplified pattern.

---

## 10. OVERALL UX/DESIGN PATTERNS

### What BuilderTrend Does Well That We Should Match
1. **Split buttons** — Primary action (+ Folder) with dropdown for secondary action (Import). Clean, saves space.
2. **Tile/Grid vs Table toggle** — Universally used in all file sections. Critical for Photos/Videos.
3. **Folder tile cards** — Visual, scannable, with permission icons and context menus.
4. **Breadcrumb navigation** — Always present inside folders, every segment clickable.
5. **Context menus on "..."** — Comprehensive actions (Rename, Delete, Download, Share, Permissions, Move).
6. **Empty states** — Friendly illustrations with clear CTAs ("Add a folder", "Add a Schedule item").
7. **Status badges** — Color-coded badges next to job names ("Open" in green).
8. **Warning banners** — Yellow banner for important status info.
9. **Form layouts** — Two-column forms for complex creation (Daily Logs), single-column for simpler forms.
10. **Pagination** — "1-3 of 3 items" pattern on file listings.

### What We Should NOT Copy (Unnecessary Noise)
1. Subs/Vendors/Clients permissions — Internal tool, no external users
2. "Schedule Offline" toggle — No client-facing schedule
3. Lead Proposals / Lead Map — Overkill for word-of-mouth business
4. Gantt chart — Overkill for 5-person crew
5. Time Clock / Financial / Reports nav items — Out of scope
6. Client Updates section — No clients using the system
7. Signature request settings — Not needed
8. QR code generation for folders — Not needed

---

## 11. PRIORITIZED FIX LIST (3 Phases)

### Phase 1 — CRITICAL (Ship Blockers)
| # | Item | Section | Why |
|---|------|---------|-----|
| 1 | Photo thumbnail grid view + lightbox | Photos | Client's #1 feature — must look different from Documents |
| 2 | Video thumbnail grid view + player | Videos | Client's #1 feature — must look different from Documents |
| 3 | Grid/List (Tile/Table) toggle | All Files | BT's core file browsing pattern |
| 4 | Fix breadcrumb navigation | Documents | Broken — root click doesn't navigate |
| 5 | Lead rows clickable → detail view | Sales | Can't view or edit leads after creation |
| 6 | Save Changes button on Job Summary | Jobs | Can't persist edits |
| 7 | Dashboard activity feed descriptions | Dashboard | Shows names but no actions |
| 8 | Build Settings page (Profile, Password) | Settings | Currently just a placeholder |

### Phase 2 — HIGH PRIORITY (Client Expectations)
| # | Item | Section | Why |
|---|------|---------|-----|
| 9 | Folder tile card design | All Files | Match BT's visual folder cards |
| 10 | Folder context menu (Rename, Delete, Download) | All Files | Basic folder management |
| 11 | Sort by dropdown | All Files | Users expect to sort files |
| 12 | Calendar view for Schedule | Schedule | Most useful view for daily crew planning |
| 13 | Assignees field in Schedule create modal | Schedule | Must assign work to team members |
| 14 | Auto-populated weather in Daily Logs | Daily Logs | BT has this, it was in the spec |
| 15 | Contact fields in Lead create modal | Sales | Contact Name, Email, Phone |
| 16 | Notes/Description field on jobs and leads | Jobs, Sales | Basic data capture |
| 17 | Select All checkbox for files | All Files | Bulk operations |
| 18 | Duration column for Videos in Table view | Videos | Video-specific metadata |

### Phase 3 — NICE TO HAVE (Polish)
| # | Item | Section | Why |
|---|------|---------|-----|
| 19 | "+ Folder" split button with "Import" dropdown | All Files | Matches BT pattern |
| 20 | Two-column layout for Daily Log form | Daily Logs | Matches BT's form design |
| 21 | Tags system for Daily Logs | Daily Logs | BT has it, useful for categorization |
| 22 | Progress % on schedule items | Schedule | Visual progress tracking |
| 23 | Color coding on schedule items | Schedule | Visual calendar distinction |
| 24 | Reminder dropdown on schedule items | Schedule | Notification feature |
| 25 | Status badges on job names | Jobs | "Open", "Closed", "In Progress" visual badges |
| 26 | Pagination on file listings | All Files | "1-3 of 3 items" pattern |
| 27 | "View trash" for deleted file recovery | All Files | Safety net for accidental deletes |
| 28 | Schedule Calendar/List toggle | Schedule | BT offers both views |
| 29 | Empty state illustrations | All Sections | Friendly empty states with clear CTAs |

---

## Summary

The client needs their CAD Stone Networks tool to feel like BuilderTrend's file management and project scheduling — just simplified for their 5-person crew. The **single biggest gap** right now is that Photos and Videos look identical to Documents (plain file tables). BuilderTrend's thumbnail grid with play overlays for videos and image previews for photos is exactly what the client is expecting when they said "another menu for videos and photos different from actual files."

Phase 1 items are non-negotiable for client delivery. Phase 2 will make it feel polished and complete. Phase 3 is bonus work that elevates the product.

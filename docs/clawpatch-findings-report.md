# clawpatch report

findings: 296

## medium: Generated JSON endpoints drop standard HeadersInit options

id: fnd_sig-feat-cli-command-0c9f0af104-_5df49db4dd
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: Node source lib/api-client-react (feat_cli-command_0c9f0af104)

evidence:
- lib/api-client-react/src/generated/api.ts:236-241 (billingPostCheckoutSessions)
- lib/api-client-react/src/custom-fetch.ts:81-91 (mergeHeaders)

The generated functions accept `options?: RequestInit`, whose `headers` may be a `Headers` instance or tuple array, but they spread `options.headers` into a plain object before passing it to `customFetch`. Spreading a `Headers` instance produces no header entries, and spreading a tuple array produces numeric object keys rather than header names. That silently drops caller-supplied headers such as `Authorization` or `X-*` on JSON-body endpoints even though `customFetch` itself is built to accept `HeadersInit`.

recommendation:
Normalize with `new Headers(options?.headers)` and set `Content-Type` on that `Headers` object, or delegate all header merging to `customFetch` by passing multiple `HeadersInit` sources without object-spreading `options.headers`. Regenerate from the fixed template/config rather than hand-editing generated files.

test analysis:
No linked tests exercise generated endpoint wrappers with non-plain-object `RequestInit.headers`.

suggested regression test:
Add a generated-client unit test that stubs `fetch`, calls a JSON-body endpoint with `headers: new Headers({ Authorization: 'Bearer t' })`, and asserts the outgoing request contains both Authorization and Content-Type.

minimum fix scope:
Update the API client generation template/config for JSON request headers and regenerate `lib/api-client-react/src/generated/api.ts`.

repro:
Call `billingPostCheckoutSessions(body, { headers: new Headers({ Authorization: 'Bearer token' }) })`; the generated wrapper constructs only `{ 'Content-Type': 'application/json' }`, so `customFetch` never sees the Authorization header.

## medium: CSV report mode is typed as JSON response objects

id: fnd_sig-feat-cli-command-0c9f0af104-_aae972b71d
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: Node source lib/api-client-react (feat_cli-command_0c9f0af104)

evidence:
- lib/api-client-react/src/generated/api.schemas.ts:2979-2982 (ReportsGetReportsArAgingParams)
- lib/api-client-react/src/generated/api.ts:13330-13337 (reportsGetReportsArAging)
- lib/api-client-react/src/generated/api.ts:13431-13438 (reportsGetReportsRevenue)
- lib/api-client-react/src/custom-fetch.ts:285-290 (inferResponseType)

The report parameter types explicitly expose `format=csv`, but the generated functions still promise JSON response models such as `ArAgingResponse` and `RevenueResponse`. At runtime, `customFetch` auto-detects `text/csv` as text, so consumers passing `{ format: 'csv' }` receive a string while TypeScript says they receive the JSON object. This is a runtime/API contract mismatch and can break export consumers that trust the generated types.

recommendation:
Represent CSV responses in the OpenAPI contract/codegen output, for example with overloads or a union keyed by `format`, and expose a text/blob download path for CSV report exports. Regenerate generated clients after updating the source spec/template.

test analysis:
No linked tests cover report endpoints in CSV mode or assert the generated client return shape for non-JSON media types.

suggested regression test:
Add a generated-client test that stubs a `text/csv` report response and verifies the CSV-mode TypeScript/API surface resolves to a text/blob type rather than the JSON report model.

minimum fix scope:
Fix report response typing in the API spec or generation configuration and regenerate `lib/api-client-react/src/generated/api.ts` plus related schema outputs.

repro:
Call `reportsGetReportsArAging({ format: 'csv' })` against a server returning `Content-Type: text/csv`; the resolved value is a CSV string, not an `ArAgingResponse`.

## low: Nullable query params serialize as literal null strings

id: fnd_sig-feat-cli-command-6ce07ef7b6-_08d59a2132
category: api-contract
confidence: medium
triage: contract-mismatch
status: open
feature: Node source lib/api-client-react/src (feat_cli-command_6ce07ef7b6)

evidence:
- lib/api-client-react/src/generated/api.ts:8484-8489 (getDailyLogsGetDailyLogsFeedUrl)
- lib/api-client-react/src/generated/api.schemas.ts:2725-2749 (DailyLogsGetDailyLogsFeedParams)

The generated type allows callers to pass null for daily-log feed date filters, but the URL builder sends those values as from=null and to=null. For optional date query parameters, null is normally represented by omission, while the literal string null is not a valid date value and can cause unnecessary 400 responses or different filtering semantics.

recommendation:
Have generated query serialization omit null values for optional query parameters, or remove null from these query parameter types if the server intentionally requires callers to omit unset filters.

test analysis:
No generated URL-builder tests cover nullable query parameters; existing daily-log frontend code only adds from/to when it has non-empty strings.

suggested regression test:
Add a URL-builder test asserting nullable optional query params are omitted when null, while defined string dates are serialized normally.

minimum fix scope:
Shared generated query serialization logic, plus any OpenAPI nullable query declarations that should instead be optional-only.

repro:
Call getDailyLogsGetDailyLogsFeedUrl({ from: null, to: null, limit: 25 }); it returns a URL containing from=null&to=null.

## low: CSV report mode is exposed through JSON-typed report clients

id: fnd_sig-feat-cli-command-6ce07ef7b6-_347cf6e170
category: api-contract
confidence: medium
triage: contract-mismatch
status: open
feature: Node source lib/api-client-react/src (feat_cli-command_6ce07ef7b6)

evidence:
- lib/api-client-react/src/generated/api.schemas.ts:2336-2342 (ReportFormatParamParameter)
- lib/api-client-react/src/generated/api.schemas.ts:2964-2982 (ReportsGetReportsArAgingParams)
- lib/api-client-react/src/generated/api.ts:13330-13337 (reportsGetReportsArAging)
- lib/api-client-react/src/custom-fetch.ts:285-290 (inferResponseType)

The generated params explicitly allow format=csv and document it as a CSV download, but the generated report function always promises the JSON response shape. For a CSV response with a text/* content type, customFetch auto-parses and returns a string, so TypeScript consumers can safely write q.data.rows even though the runtime value is not an ArAgingResponse when format is csv.

recommendation:
Model CSV as a separate operation/helper or add overloads/conditional return types for format=csv, with an explicit responseType of text or blob. Update the API spec/codegen source so generated clients match the alternate response format.

test analysis:
The existing frontend appears to build CSV hrefs directly instead of exercising the generated report clients in csv mode, and no api-client-react tests cover format-dependent response types.

suggested regression test:
Add a unit test for a generated report client with format=csv that mocks text/csv and asserts the public type/runtime contract is string or Blob, not the JSON response object.

minimum fix scope:
Report endpoint codegen/spec handling for format=csv across the generated report clients.

repro:
Call reportsGetReportsArAging({ format: ReportFormatParamParameter.csv }) against a CSV response; the resolved value is text, while the function type says ArAgingResponse.

## medium: Generated JSON wrappers drop non-plain RequestInit headers

id: fnd_sig-feat-cli-command-6ce07ef7b6-_cbd7212712
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: Node source lib/api-client-react/src (feat_cli-command_6ce07ef7b6)

evidence:
- lib/api-client-react/src/generated/api.ts:237-241 (billingPostCheckoutSessions)
- lib/api-client-react/src/generated/api.ts:637-641 (authPostAuthRegister)
- lib/api-client-react/src/custom-fetch.ts:81-87 (mergeHeaders)

The generated functions accept RequestInit, whose headers may be a Headers instance or tuple array, but they merge headers with object spread before calling customFetch. Spreading a Headers instance or array does not preserve its entries, so per-call headers such as Idempotency-Key, tenant headers, tracing headers, or explicit Authorization can be silently lost on JSON body requests. customFetch itself has a correct HeadersInit normalizer, but these wrappers overwrite options.headers before it can run.

recommendation:
Fix the codegen/template or mutator path so JSON wrappers merge headers with new Headers(options?.headers), then set a default Content-Type only when absent. Do not hand-edit the generated file without updating codegen.

test analysis:
No api-client-react/customFetch tests were present in the provided feature or found by the test search; existing consumers generally pass plain object headers or rely on the module-level auth token getter.

suggested regression test:
Add an api-client-react unit test that calls a generated JSON mutation with Headers and tuple-array headers and asserts fetch receives those headers plus the JSON content type.

minimum fix scope:
Generated JSON request header construction for api-client-react, ideally at the codegen template/mutator source.

repro:
Mock fetch, call authPostAuthRegister({}, { headers: new Headers([["Idempotency-Key", "abc"]]) }), and inspect the RequestInit passed to fetch; it contains Content-Type but not Idempotency-Key.

## medium: CLI wrapper can orphan the MCP server child process when the wrapper is terminated

id: fnd_sig-feat-cli-command-b2667ce576-_c345b2905d
category: concurrency
confidence: high
triage: confirmed-bug
status: open
feature: CLI command cadstone-mcp (feat_cli-command_b2667ce576)

evidence:
- lib/mcp-server/bin/cadstone-mcp.mjs:37-43
- lib/mcp-server/bin/cadstone-mcp.mjs:46-48

The shim starts a long-running child process but only mirrors child termination back to the wrapper. It does not handle SIGINT, SIGTERM, or SIGHUP on the wrapper and forward them to the spawned server. When a supervisor or MCP client terminates only the bin wrapper PID, the wrapper exits by default and the inherited-stdio child can continue running as an orphaned MCP server process.

recommendation:
Install signal handlers in the wrapper that forward termination signals to the child, guard against repeated forwarding, and exit after the child exits or after a short fallback timeout if it does not terminate.

test analysis:
No linked tests were provided for this feature, and the repository search found no mcp-server test/spec file covering the bin wrapper lifecycle or signal behavior.

suggested regression test:
Add a CLI lifecycle test that spawns lib/mcp-server/bin/cadstone-mcp.mjs with test env, sends SIGTERM to the wrapper process, and asserts the child process is also terminated and no orphan node process remains.

minimum fix scope:
Update lib/mcp-server/bin/cadstone-mcp.mjs to forward wrapper termination signals to the spawned child and cover that behavior with a focused process-lifecycle test.

repro:
Start cadstone-mcp with valid CADSTONE_API_URL and CADSTONE_PAT, send SIGTERM to the wrapper PID rather than the process group, then observe the spawned node/tsx process remains alive.

## medium: preinstall deletes alternate lockfiles before rejecting non-pnpm installs

id: fnd_sig-feat-config-7528cb5b98-7aac6_c5c59a893f
category: data-loss
confidence: high
triage: confirmed-bug
status: open
feature: Project config package.json (feat_config_7528cb5b98)

evidence:
- package.json:11 (scripts.preinstall)

The preinstall hook removes package-lock.json and yarn.lock before it checks whether the invoking package manager is pnpm. A developer or automation job that accidentally runs npm install or yarn install in this workspace will lose those files before receiving the intended error. Even if those lockfiles are not meant to be committed here, install policy enforcement should not destructively modify the working tree on a rejected command.

recommendation:
Check npm_config_user_agent first and exit for non-pnpm invocations before doing any cleanup. If stale lockfile cleanup is still desired for pnpm installs, run it only after the pnpm user-agent branch has been accepted, or replace deletion with a clear error telling the developer to remove the files intentionally.

test analysis:
No linked tests cover package-manager enforcement behavior or assert that rejected install attempts leave the working tree unchanged.

suggested regression test:
Add a small script-level test that runs the preinstall command with npm_config_user_agent set to an npm/yarn value in a temp directory containing package-lock.json and yarn.lock, then asserts the command fails and both files still exist.

minimum fix scope:
Update the root package.json preinstall command so the package-manager guard happens before any rm -f operation.

repro:
Create a package-lock.json or yarn.lock in the repository root, then run npm install. The preinstall script removes the file and then exits with "Use pnpm instead".

## medium: Locked default client can be hidden or ignored after the dialog opens

id: fnd_sig-feat-library-0033f73331-b1f7_7dc08dce83
category: bug
confidence: medium
triage: risk
status: open
feature: Node source artifacts/cadstone/src/components/jobs (feat_library_0033f73331)

evidence:
- artifacts/cadstone/src/components/jobs/CreateJobDialog.tsx:133-144 (CreateJobDialog)
- artifacts/cadstone/src/components/jobs/CreateJobDialog.tsx:224-227 (handleCreate)
- artifacts/cadstone/src/components/jobs/CreateJobDialog.tsx:308-310 (CreateJobDialog)

The form only copies defaultClientId on the closed-to-open transition. If the parent supplies or changes defaultClientId while the dialog is already open, the locked Select remains driven by the stale local form value. On submit, the code also prefers form.clientId over defaultClientId even though the comment says the locked defaultClientId is authoritative. This can submit a job for the wrong client, or submit the default client while the disabled UI still displays None.

recommendation:
When lockClient is true, derive both the displayed client value and submitted clientId from defaultClientId, or sync form.clientId from defaultClientId on lockClient/defaultClientId changes without resetting the rest of the form.

test analysis:
No linked tests were provided for this component, and the package test script only discovers src/**/*.test.ts files; none are included for this dialog behavior.

suggested regression test:
Render CreateJobDialog open without a default client, rerender with lockClient=true and a different defaultClientId, then assert the selector displays the locked client and the create-job POST payload uses that client instead of stale local state.

minimum fix scope:
CreateJobDialog client selection state and submit payload logic.

repro:
Open the dialog without defaultClientId, choose client A or leave None, then rerender it open with lockClient=true and defaultClientId for client B. The disabled client selector still shows A/None; submitting uses A if present, otherwise hidden B.

## medium: Primary contact creation failure is silently discarded

id: fnd_sig-feat-library-0033f73331-eafe_25757975b5
category: data-loss
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/cadstone/src/components/jobs (feat_library_0033f73331)

evidence:
- artifacts/cadstone/src/components/jobs/CreateJobDialog.tsx:186-200 (handleCreateClient)
- artifacts/cadstone/src/components/jobs/CreateJobDialog.tsx:208-214 (handleCreateClient)

When the user enters contact details for a new client, a failure from the contact endpoint is caught and ignored. The UI then clears the contact fields and shows a success toast, leaving the user with a client that lacks the entered primary contact and no indication that the contact data was not saved.

recommendation:
Surface the contact creation failure and avoid clearing the contact fields as if the full operation succeeded. Either make client plus primary-contact creation atomic on the API, or show a partial-success error that keeps the entered contact data available for retry.

test analysis:
No linked tests were provided for this component, and no included test asserts partial failure handling for the create-client flow.

suggested regression test:
Mock client creation to succeed and contact creation to reject, then assert an error is shown and the entered contact fields are not cleared under a plain success state.

minimum fix scope:
CreateJobDialog handleCreateClient error handling for the optional primary-contact POST.

repro:
Create a new client from the dialog with Contact Name populated while the /clients POST succeeds and the /clients/:id/contacts POST fails. The dialog clears the contact fields and reports success even though no contact was created.

## medium: Serializing schedule items drops the personal-to-do privacy flag

id: fnd_sig-feat-library-05c246fae7-6e30_c5b8ec0a1f
category: security
confidence: medium
triage: risk
status: open
feature: Node source artifacts/cadstone/src/pages/job-schedule (feat_library_05c246fae7)

evidence:
- artifacts/cadstone/src/pages/job-schedule/index.tsx:210-212 (JobSchedulePage)
- artifacts/cadstone/src/pages/job-schedule/draft.ts:35-74 (schedulePayloadFromItem)

The page models personal todos as schedule items, but the owned serializer used for schedule item payloads copies most persisted fields and never includes `isPersonalTodo`. Any save/publish path that serializes an edited personal todo through this helper can send a payload without the privacy flag, allowing the backend's default handling for omitted booleans to turn the private todo into a normal schedule item. That changes visibility semantics and can expose a user's personal todo to other schedule viewers.

recommendation:
Include `isPersonalTodo: item.isPersonalTodo ?? false` in `schedulePayloadFromItem` and keep it stable when updating existing draft records unless the user explicitly converts the item type.

test analysis:
No linked tests were provided for draft publishing or preserving personal-todo visibility flags during schedule item serialization.

suggested regression test:
Add a draft serialization/publish test that edits an item with `isPersonalTodo: true` and asserts the emitted payload still has `isPersonalTodo: true`.

minimum fix scope:
Update the draft payload serializer and add a focused regression test for personal todo preservation.

repro:
Create a personal todo, enter draft mode, edit that todo, then publish the draft. The payload produced from the edited record does not carry `isPersonalTodo: true`.

## low: Late-hour blocks can be clipped after drag creation

id: fnd_sig-feat-library-05c246fae7-8b1a_d0518dcaf1
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/cadstone/src/pages/job-schedule (feat_library_05c246fae7)

evidence:
- artifacts/cadstone/src/pages/job-schedule/drag.ts:1-4 (TIMED_GRID_TOTAL_MINUTES)
- artifacts/cadstone/src/pages/job-schedule/drag.ts:90-94 (minutesToTimeString)
- artifacts/cadstone/src/pages/job-schedule/calendar-utils.ts:239-245 (getDaySegmentBounds)

The drag grid spans `(19 - 6 + 1) * 60` minutes, so its maximum maps to 20:00. The day segment renderer, however, clamps hourly item end times to `DAY_END_HOUR` (19) before applying a minimum duration. Items created or dragged to 19:00-20:00 are therefore rendered as shortened blocks ending around 19:45, and previews use the same cap pattern. The saved schedule time and displayed block length diverge at the end of the day.

recommendation:
Separate the last displayed hour from the exclusive grid end hour, or clamp display bounds to `DAY_END_HOUR + 1` wherever `TIMED_GRID_TOTAL_MINUTES` maps to 20:00.

test analysis:
No linked calendar/drag tests were provided for end-of-day time conversion or rendering bounds.

suggested regression test:
Add a unit test asserting a 19:00-20:00 hourly item produces day bounds ending at 20, not 19.75 or 19.

minimum fix scope:
Adjust the shared time-bound constants or display-bound calculations and cover the last-hour case.

repro:
Drag-create a block in the last visible hour. The payload time can be 19:00-20:00, but the rendered day segment is capped against 19 rather than the 20:00 grid boundary.

## medium: Finish-based draft dependency resolution pushes successors too far forward

id: fnd_sig-feat-library-05c246fae7-e497_1bdcc164c2
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/cadstone/src/pages/job-schedule (feat_library_05c246fae7)

evidence:
- artifacts/cadstone/src/pages/job-schedule/draft.ts:122-132 (resolveDraftPredecessorStartDate)
- artifacts/cadstone/src/pages/job-schedule/draft.ts:171-180 (draftConflictReasons)

For `finish_to_finish` and `start_to_finish`, the conflict check correctly compares the item's end date to a required end date. The normalizer then tries to derive a new start date by calling `calculateBusinessEndDate(requiredEnd, workDays)`, but that helper calculates an end date starting from its first argument. A 3-day successor required to finish on Monday is therefore moved to start Monday and finish later, rather than starting earlier so it finishes on Monday. Draft normalization silently lengthens schedules whenever these dependency types are present.

recommendation:
Add a helper that subtracts business days from the required end date to compute the latest valid start for finish-based dependency types, then use it for `finish_to_finish` and `start_to_finish`.

test analysis:
No linked tests were provided for draft dependency normalization, and the covered files do not include assertions for `finish_to_finish` or `start_to_finish`.

suggested regression test:
Add unit cases for `normalizeDraftScheduleItems` covering `finish_to_finish` and `start_to_finish` with multi-day successors and workday exceptions.

minimum fix scope:
Fix `resolveDraftPredecessorStartDate` for finish-based dependencies and test those two dependency types.

repro:
In draft mode, create item B with `workDays: 3` and a `finish_to_finish` predecessor A ending on a Monday. Normalization will choose a candidate start on or after Monday, causing B to finish days after A instead of aligning its finish to the requirement.

## low: CSV and PDF export menu items dispatch indistinguishable actions

id: fnd_sig-feat-library-0975f542b2-c16d_2fd64e221e
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/cadstone/src/pages/job-schedule/views (feat_library_0975f542b2)

evidence:
- artifacts/cadstone/src/pages/job-schedule/views/BaselineTab.tsx:40 (BaselineTabProps.handleExport)
- artifacts/cadstone/src/pages/job-schedule/views/BaselineTab.tsx:98-99 (BaselineTab)
- artifacts/cadstone/src/pages/job-schedule/views/ExceptionsTab.tsx:81 (ExceptionsTabProps.handleExport)
- artifacts/cadstone/src/pages/job-schedule/views/ExceptionsTab.tsx:150-151 (ExceptionsTab)

The baseline and exceptions menus present separate CSV and PDF choices, but both choices call the same handler with only the export kind. Because the handler contract has no format argument, the parent cannot distinguish the requested output format from these calls. At least one menu label is therefore incorrect, and users selecting CSV will receive the same behavior as PDF.

recommendation:
Either remove the CSV options if only PDF is supported, or extend the handler contract to include a format parameter such as handleExport(kind, "csv" | "pdf") and implement separate CSV generation.

test analysis:
The feature declares no linked tests, and there is no owned test validating export menu actions or output formats.

suggested regression test:
Add a component test for BaselineTab and ExceptionsTab that clicks each export menu item and asserts distinct handler arguments for CSV versus PDF.

minimum fix scope:
Update the export handler prop type and both menu call sites, or relabel/remove the unsupported CSV actions.

repro:
Open Baseline or Workday Exceptions export menu and choose Export CSV; the click dispatches the same callback payload as Export PDF.

## medium: Schedule read-only mode is not enforced in calendar, list, and gantt view actions

id: fnd_sig-feat-library-0975f542b2-cb28_6373bf1102
category: security
confidence: medium
triage: risk
status: open
feature: Node source artifacts/cadstone/src/pages/job-schedule/views (feat_library_0975f542b2)

evidence:
- artifacts/cadstone/src/pages/job-schedule/views/CalendarView.tsx:53-94 (CalendarViewProps)
- artifacts/cadstone/src/pages/job-schedule/views/CalendarView.tsx:316 (CalendarView)
- artifacts/cadstone/src/pages/job-schedule/views/ListView.tsx:145-149 (ListView)
- artifacts/cadstone/src/pages/job-schedule/views/GanttView.tsx:205-209 (GanttView)
- artifacts/cadstone/src/pages/job-schedule/views/GanttView.tsx:454-458 (GanttView)

BaselineTab and ExceptionsTab explicitly receive canWrite and hide write controls for crew/read-only users, but CalendarView, ListView, and GanttView expose schedule creation, quick-create, draft mode, and drag entrypoints without any canWrite prop or local guard. If these views are rendered for a read-only role, the UI still opens write flows from cells, empty states, and the Gantt footer; even if the API later rejects the write, this violates the stated read-only UI boundary and can lead to attempted unauthorized mutations.

recommendation:
Thread canWrite into CalendarView, ListView, and GanttView. Hide or disable openQuickCreate/openNewItem/enterDraftMode and drag/resize handlers when canWrite is false, matching the BaselineTab and ExceptionsTab pattern.

test analysis:
The feature declares no linked tests, and the owned view files have no component-level checks asserting read-only behavior for calendar cells, empty states, Gantt draft mode, or drag surfaces.

suggested regression test:
Add role-gate coverage that renders each schedule view as a read-only user and asserts no New Schedule Item empty-state action, no quick-create dialog from calendar cells, no Gantt draft button action, and no drag commit attempts.

minimum fix scope:
Add canWrite to the affected view props and guard every creation, draft, and drag entrypoint in CalendarView, ListView, and GanttView.

repro:
Render the job schedule for a read-only user in calendar/list/gantt view with no active items. The toolbar write button can be hidden while clicking a calendar day, the list/gantt empty-state action, or the Gantt draft button still invokes the write callbacks.

## low: Transport failures leave an empty assistant placeholder in the transcript

id: fnd_sig-feat-library-0ab5896fc0-2899_584f72bb52
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/cadstone/src/components/agent (feat_library_0ab5896fc0)

evidence:
- artifacts/cadstone/src/components/agent/ChatPanel.tsx:235-249 (handleSend)
- artifacts/cadstone/src/components/agent/ChatPanel.tsx:328-337 (handleSend.onEvent)
- artifacts/cadstone/src/components/agent/ChatPanel.tsx:345-349 (handleSend.onError)

The SSE event-level error path writes an error message into the placeholder, but the transport-level onError path only shows a toast and clears busy/status. For non-OK responses, auth failures, network failures, or rejected sends that happen before an SSE error event, the empty assistant placeholder remains and ChatMessage renders it as an ellipsis, making a failed request look pending or incomplete in the transcript.

recommendation:
In onError, update or remove the current placeholder just like the event error branch does, and clear streamRef.current. Consider also reconciling/removing the optimistic user message when the server did not persist it.

test analysis:
There are no linked component tests for ChatPanel error paths, and the current logic has separate event-error and transport-error branches with different transcript behavior.

suggested regression test:
Stub streamSendMessage to invoke onError without emitting events, then assert the placeholder is replaced with an error message or removed and no spinner/ellipsis remains.

minimum fix scope:
artifacts/cadstone/src/components/agent/ChatPanel.tsx onError handling for the active placeholder.

repro:
Cause streamSendMessage to call onError before any SSE event, such as by expiring auth or forcing the POST to return a non-OK response. The toast appears, but the assistant bubble remains as an empty ellipsis.

## medium: Record citation links use query parameters the target views do not consume

id: fnd_sig-feat-library-0ab5896fc0-e60e_c428560df6
category: bug
confidence: medium
triage: risk
status: open
feature: Node source artifacts/cadstone/src/components/agent (feat_library_0ab5896fc0)

evidence:
- artifacts/cadstone/src/components/agent/Citation.tsx:49-62 (hrefFor)
- artifacts/cadstone/src/components/agent/ChatPanel.tsx:505-510 (ChatPanel)

CitationChip generates deep-link-looking URLs for folders, files, daily logs, and schedule items, and ChatPanel closes the assistant on click. In the inspected target views, the file browser and job daily-log/schedule pages do not read these file/folder/log/item query names; existing daily-log and schedule links elsewhere use focus for those record links. The result is that clicking an assistant citation often only lands on the generic section while hiding the assistant, instead of opening or focusing the cited record.

recommendation:
Either change CitationChip to emit URLs supported by the destination views, or add query-param handling in those views for the citation parameters. Keep the parameter names consistent with existing app deep-link conventions.

test analysis:
There are no linked tests for CitationChip navigation, and no integration test verifies that each AgentCitation kind lands on a selected target record.

suggested regression test:
Add route-level tests for CitationChip covering daily_log, schedule_item, file, and folder citations; assert the destination route receives a parameter that the target page handles and that clicking closes the panel only after navigation to a usable target.

minimum fix scope:
artifacts/cadstone/src/components/agent/Citation.tsx plus any destination page query handling needed for unsupported citation kinds.

repro:
Click an assistant citation for a daily log, schedule item, file, or folder. The panel closes and navigation occurs, but the target record is not selected or focused by the destination view.

## medium: Message history load can erase an in-flight optimistic reply

id: fnd_sig-feat-library-0ab5896fc0-fbe4_6468a92456
category: concurrency
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/cadstone/src/components/agent (feat_library_0ab5896fc0)

evidence:
- artifacts/cadstone/src/components/agent/ChatPanel.tsx:133-143 (ChatPanel)
- artifacts/cadstone/src/components/agent/ChatPanel.tsx:220-249 (handleSend)
- artifacts/cadstone/src/components/agent/ChatPanel.tsx:300-324 (handleSend.onEvent)

Selecting or creating a conversation starts listMessages(), but handleSend is enabled before that request settles. If the user sends while the message load is still in flight, the optimistic user and assistant placeholder are appended, then the older listMessages response can call setMessages(msgs) and replace the whole array. Later stream events only update a message whose id matches the removed placeholder, so deltas and the final persisted assistant id are dropped from the visible transcript until a reload or conversation switch.

recommendation:
Track message-loading state or a per-conversation request generation, and merge/ignore stale listMessages results once a local send has started. At minimum, only apply loaded messages if the active conversation and a load token still match and no newer optimistic messages exist for that conversation.

test analysis:
The feature lists no linked tests, and the cadstone test script only picks up src/**/*.test.ts; these TSX components do not have a race-oriented component test here.

suggested regression test:
Add a ChatPanel component test with delayed listMessages, send a prompt before resolving it, then emit delta/done events and assert the optimistic and assistant messages remain visible after the stale listMessages promise resolves.

minimum fix scope:
artifacts/cadstone/src/components/agent/ChatPanel.tsx message loading and send-state coordination.

repro:
Open the panel or switch to a conversation on a slow connection, send a prompt before listMessages resolves, then let the history request return after the optimistic append. The reply disappears or never renders even though the stream continues.

## medium: Concurrent first usage records can lose token accounting

id: fnd_sig-feat-library-124739d93c-1b93_5dfd0b6a54
category: concurrency
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/api-server/src/lib/agent (feat_library_124739d93c)

evidence:
- artifacts/api-server/src/lib/agent/usage.ts:154-189 (recordUsage)
- lib/db/src/schema/agent.ts:164-169 (agentUsageMonthly)
- artifacts/api-server/src/lib/agent/orchestrator.ts:377-387 (runAgentTurn)
- artifacts/api-server/test/agent-inflight.test.ts:145-152

recordUsage implements a read-then-insert path for a missing monthly usage row. When AGENT_MAX_INFLIGHT is configured above 1, two same-user turns at the start of a month can both observe no row, then both try to insert into the unique user/month index. One insert will fail with a unique violation instead of retrying as an update. runAgentTurn catches and only logs recordUsage failures, so that turn's tokens and request count are silently omitted from monthly caps and org budget accounting.

recommendation:
Make recordUsage atomic. Use an INSERT ... ON CONFLICT ... DO UPDATE path for the tenant and legacy uniqueness cases, or catch unique-violation and retry the increment update in the same logical operation.

test analysis:
The usage tests seed rows sequentially and exercise loadOrgUsageSnapshot. There is no concurrent recordUsage test, and the abort test only asserts returned token totals, not persisted metering under contention.

suggested regression test:
Call Promise.all with two recordUsage calls for the same fresh user/month/org while AGENT_MAX_INFLIGHT allows concurrency, then assert one row exists and its input/output/request totals include both calls.

minimum fix scope:
artifacts/api-server/src/lib/agent/usage.ts plus a focused DB-backed concurrency regression test.

## low: Contact tool results never produce citations

id: fnd_sig-feat-library-124739d93c-4eae_ac60a64baa
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/api-server/src/lib/agent (feat_library_124739d93c)

evidence:
- artifacts/api-server/src/lib/agent/tools.ts:15-16 (READ_ONLY_AGENT_TOOL_NAMES)
- artifacts/api-server/src/lib/agent/citations.ts:108-127 (ENTITY_HARVESTERS)
- artifacts/api-server/src/lib/agent/citations.ts:129-137 (TOOL_FALLBACK_HARVESTER)
- artifacts/api-server/src/lib/agent/citations.ts:163-210 (extractCitations)
- artifacts/api-server/src/routes/clients.ts:623-705

The agent exposes list_contacts and get_contact, and the client routes return wrappers named contacts/contact. extractCitations only harvests keys present in ENTITY_HARVESTERS, which omits contacts/contact. Because no citations are found, the fallback runs harvestClient on the wrapper object itself, not on the contained contact rows, so row.id is absent and nothing is emitted. The comment says contacts should roll up to clients, but the implementation does not use contact.clientId or unwrap the contact payload.

recommendation:
Add explicit contact harvesting. Either add a contact citation kind end-to-end, or implement a harvester that unwraps contacts/contact and emits a client citation using clientId, with an appropriate label strategy.

test analysis:
There are no extractCitations tests for list_contacts or get_contact; linked MCP tests cover tool availability, not citation extraction behavior.

suggested regression test:
Unit-test extractCitations('list_contacts', { contacts: [{ id: contactId, clientId, firstName: 'Ada', lastName: 'Lovelace' }] }) and extractCitations('get_contact', { contact: ... }) to assert the intended citation is returned.

minimum fix scope:
artifacts/api-server/src/lib/agent/citations.ts and a focused citation extraction test.

## medium: Workday exception date-only fields are generated as Date objects

id: fnd_sig-feat-library-16e8f5088c-086f_e81a4ef867
category: api-contract
confidence: medium
triage: contract-mismatch
status: open
feature: Node source lib/api-zod/src/generated/types#21 (feat_library_16e8f5088c)

evidence:
- lib/api-zod/src/generated/types/workdayException.ts:13-18 (WorkdayException)
- lib/api-zod/src/generated/types/workdayException.ts:27-28 (WorkdayException)

`startDate` and `endDate` represent calendar dates for schedule exceptions, but the generated response type gives them instant semantics via `Date`. For date-only API values like `YYYY-MM-DD`, converting to `Date` can shift the apparent local day in time zones west of UTC when callers use local date accessors or locale formatting. Timestamp fields such as `createdAt`/`updatedAt` may reasonably be instants, but schedule start/end dates should remain exact date strings to avoid off-by-one-day scheduling displays.

recommendation:
Configure generation so OpenAPI `format: date` fields remain `YYYY-MM-DD` strings while only true `date-time` fields are mapped or coerced to Date, then regenerate the generated types and schemas.

test analysis:
No linked tests were provided, and there is no visible regression test asserting that workday exception date-only fields round-trip as strings without timezone conversion.

suggested regression test:
Add a contract test for a workday exception response containing `startDate: "2026-01-01"` and `endDate: "2026-01-02"` that verifies the generated schema/type keeps those fields as strings and does not coerce them to Date.

minimum fix scope:
Adjust the api-zod/orval date mapping for date-only fields and regenerate the affected generated files.

repro:
In America/Los_Angeles, `new Date("2026-01-01").getDate()` evaluates against local time on December 31, 2025, so a workday exception starting on `2026-01-01` can render as the prior day if consumers follow the generated `Date` type.

## medium: Generated user request contracts accept invalid bodies

id: fnd_sig-feat-library-16e8f5088c-5a6c_2335de1d90
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: Node source lib/api-zod/src/generated/types#21 (feat_library_16e8f5088c)

evidence:
- lib/api-zod/src/generated/types/usersChangePasswordSchema.ts:9-14 (UsersChangePasswordSchema)
- lib/api-zod/src/generated/types/usersUpdateProfileSchema.ts:9-14 (UsersUpdateProfileSchema)
- lib/api-zod/src/generated/types/usersUpdateUserSchema.ts:10-20 (UsersUpdateUserSchema)

These exported request types are materially looser than the endpoint contracts they document. The password and profile bodies are reduced to arbitrary records, and the admin user update type documents a non-empty-body invariant while making every property optional. Consumers of @workspace/api-zod can compile and potentially locally validate request bodies that the real API rejects, such as an empty password change body or empty PATCH /users/{id} body.

recommendation:
Fix the source OpenAPI/codegen path so derived/refined user request schemas emit explicit properties and preserve non-empty-object refinements, then regenerate api-zod output instead of hand-editing these generated files.

test analysis:
No linked tests were provided, and the generated output shows no contract regression coverage for derived Zod request schemas or refinement preservation.

suggested regression test:
Add a codegen contract test asserting the generated password-change body requires `currentPassword` and `newPassword`, the profile body exposes only the intended editable profile fields, and the update-user body rejects `{}`.

minimum fix scope:
Update the source API spec or the schema-to-OpenAPI/codegen adapter for these user schemas, then run the API codegen for @workspace/api-zod.

repro:
Type-check a consumer with `const a: UsersChangePasswordSchema = {}; const b: UsersUpdateProfileSchema = { unexpected: true }; const c: UsersUpdateUserSchema = {};`. All are accepted by the generated contracts even though they do not satisfy the documented endpoint schemas.

## low: Generated report params allow custom ranges without required dates

id: fnd_sig-feat-library-1804188824-bd18_c8561bac1c
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: Node source lib/api-zod/src/generated/types#17 (feat_library_1804188824)

evidence:
- lib/api-zod/src/generated/types/reportsGetReportsArAgingParams.ts:13-27 (ReportsGetReportsArAgingParams)
- lib/api-zod/src/generated/types/reportsGetReportsRevenueParams.ts:13-27 (ReportsGetReportsRevenueParams)
- lib/api-zod/src/generated/types/reportsGetReportsPipelineParams.ts:13-27 (ReportsGetReportsPipelineParams)
- lib/api-zod/src/generated/types/reportsGetReportsDaysToPaymentParams.ts:13-27 (ReportsGetReportsDaysToPaymentParams)
- lib/api-zod/src/generated/types/reportsGetReportsJobsByStageParams.ts:13-27 (ReportsGetReportsJobsByStageParams)

Each generated report params type documents that `from` and `to` are required when `range=custom`, but the exported types make all three fields independently optional. Consumers of `@workspace/api-zod` can therefore compile calls such as `{ range: "custom" }` for every report endpoint even though the documented API contract requires dates, pushing the failure to runtime server validation instead of the shared contract package.

recommendation:
Fix the OpenAPI/codegen source rather than hand-editing generated files. Represent the report query shape as a union/discriminated type or add a generation override/refinement so `range: "custom"` requires both `from` and `to`, then regenerate `@workspace/api-zod`.

test analysis:
The feature declares no linked tests. Existing route-level report tests cover server validation, but they do not assert that the generated `@workspace/api-zod` exported params/types reject or prevent the invalid custom-range shape.

suggested regression test:
Add an `@workspace/api-zod` contract/type test that fails compilation or schema validation for `{ range: "custom" }` without `from` and `to`, and passes for `{ range: "custom", from: "2025-01-01", to: "2025-01-31" }`.

minimum fix scope:
Update the API spec/codegen configuration for the shared report query parameter model and regenerate the generated files.

repro:
Type-check a consumer assignment like `const p: ReportsGetReportsRevenueParams = { range: "custom" };`; it compiles even though the inline contract says `from` and `to` are required for custom ranges.

## medium: JobSummary date-only fields are generated as Date while matching job list fields remain YYYY-MM-DD strings

id: fnd_sig-feat-library-1b6b6be5c3-2b95_cbcaedda89
category: api-contract
confidence: medium
triage: contract-mismatch
status: open
feature: Node source lib/api-zod/src/generated/types#10 (feat_library_1b6b6be5c3)

evidence:
- lib/api-zod/src/generated/types/jobSummary.ts:26-27 (JobSummary)
- lib/api-zod/src/generated/types/jobListItem.ts:21-24 (JobListItem)

Projected start/completion are date-only schedule fields. JobListItem models them as YYYY-MM-DD strings with an explicit regex, while JobSummary models the same fields as Date objects. That creates endpoint-dependent types for the same date-only values and risks timezone-related day shifts when a date-only string is coerced into a Date and rendered in local time.

recommendation:
Change the JobSummary OpenAPI date-only fields to the same string-with-YYYY-MM-DD-pattern shape used by JobListItem, then regenerate the generated artifacts.

test analysis:
No tests were linked for this generated type group, and there is no included test that compares date-only field generation between JobSummary and JobListItem.

suggested regression test:
Add a generated-contract test that JobSummary.projectedStart/projectedCompletion are typed as string date-only values and share the same YYYY-MM-DD validation pattern as JobListItem.

minimum fix scope:
OpenAPI JobSummary projectedStart/projectedCompletion schemas plus regenerated api-zod/api-client outputs.

## medium: JobSummary cents fields are generated as bigint despite the safe JSON number contract

id: fnd_sig-feat-library-1b6b6be5c3-5432_df171b919f
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: Node source lib/api-zod/src/generated/types#10 (feat_library_1b6b6be5c3)

evidence:
- lib/api-zod/src/generated/types/jobSummary.ts:22-25 (JobSummary)
- lib/api-zod/src/generated/types/jobListItem.ts:34-45 (JobListItem)

The same job money fields are exposed as JSON-safe numbers in the list/detail contract, with comments explicitly saying they must never be bigint, but JobSummary exposes them as bigint. That makes client code consuming client detail or client-job summary responses type against values JSON cannot carry and that sibling job endpoints intentionally keep as safe integers. This can lead to incompatible arithmetic/serialization code and generated API type drift across endpoints for the same domain fields.

recommendation:
Fix the OpenAPI source for JobSummary money fields to use the same safe-integer schema as job list/detail fields, including the max safe integer bound that keeps generation on number, then regenerate the generated API artifacts instead of hand-editing this file.

test analysis:
No tests were linked for this generated type group, and there appears to be no contract test asserting JobSummary cents fields stay JSON-safe numbers across generated outputs.

suggested regression test:
Add a codegen/contract assertion that JobSummary.contractValueCents and JobSummary.amountPaidCents generate as number | null/undefined and not bigint, matching JobListItem and JobDetail.

minimum fix scope:
OpenAPI JobSummary schema plus regenerated api-zod/api-client outputs.

## medium: SSE batch helper returns undefined entries while promising R[]

id: fnd_sig-feat-library-1bf2a01f5b-65bb_18b271eee1
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: Node source lib/integrations-anthropic-ai/src (feat_library_1bf2a01f5b)

evidence:
- lib/integrations-anthropic-ai/src/batch/utils.ts:91-96 (batchProcessWithSSE)
- lib/integrations-anthropic-ai/src/batch/utils.ts:127-134 (batchProcessWithSSE)

On any per-item failure, the function continues and inserts undefined into the results array, but the public signature remains Promise<R[]>. Callers can type-check code that treats every element as R even though runtime values may be undefined, causing downstream crashes or silent partial-data processing. The cast hides the failure mode from TypeScript rather than making it part of the contract.

recommendation:
Either change the return type to Promise<Array<R | undefined>> or a structured result type with success/error fields, or reject the promise when any item fails instead of returning partial results. Avoid casting undefined to R.

test analysis:
No linked tests were declared for this feature, and there is no owned test asserting the resolved result shape when one item fails.

suggested regression test:
Add a test that makes one SSE item fail and asserts the chosen contract: either the promise rejects, or the returned array type/value explicitly represents the failed item.

minimum fix scope:
Update the batchProcessWithSSE result contract and corresponding failure handling in lib/integrations-anthropic-ai/src/batch/utils.ts, plus consumers if any rely on the current partial-success behavior.

repro:
Call batchProcessWithSSE<number, number>([1], async () => { throw new Error('boom'); }, sendEvent). TypeScript reports Promise<number[]>, but the resolved array is [undefined].

## medium: SSE retry handler checks the retry context instead of the thrown error

id: fnd_sig-feat-library-1bf2a01f5b-a335_fd46cc1079
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: Node source lib/integrations-anthropic-ai/src (feat_library_1bf2a01f5b)

evidence:
- lib/integrations-anthropic-ai/package.json:13
- lib/integrations-anthropic-ai/src/batch/utils.ts:116-121 (batchProcessWithSSE)

With p-retry v7, onFailedAttempt receives a retry context object, not the original thrown Error directly. Passing that object to isRateLimitError stringifies to a generic object value, so even a real 429/rate-limit failure is treated as non-rate-limit and the retry loop is aborted on the first failed attempt. The SSE helper therefore does not provide the advertised retry behavior for rate limits, and it may emit an unhelpful '[object Object]' style error instead of the original failure.

recommendation:
Destructure the p-retry context, for example onFailedAttempt: ({ error }) => { ... }, and pass that original error to isRateLimitError and AbortError. Alternatively use shouldRetry/shouldConsumeRetry with the original error to make the retry predicate explicit.

test analysis:
No linked tests were declared for this feature, and there is no owned regression test that forces batchProcessWithSSE through a first-attempt 429 followed by success.

suggested regression test:
Add a test where batchProcessWithSSE receives a processor that fails once with a 429/rate-limit error and then succeeds, asserting the result is returned, the processor was called twice, and no error progress event is emitted.

minimum fix scope:
Update lib/integrations-anthropic-ai/src/batch/utils.ts in batchProcessWithSSE and add focused coverage for the retry branch.

repro:
Call batchProcessWithSSE with a processor that throws Error('429 rate limit') on the first attempt and returns a value on the second. The current onFailedAttempt path aborts after the first failure instead of retrying and returning the value.

## low: Anthropic proxy ignores writes made through the exported client object

id: fnd_sig-feat-library-1bf2a01f5b-fc62_abeb28c82a
category: api-contract
confidence: medium
triage: contract-mismatch
status: open
feature: Node source lib/integrations-anthropic-ai/src (feat_library_1bf2a01f5b)

evidence:
- lib/integrations-anthropic-ai/src/client.ts:21-24 (anthropic)

The exported value is typed as an Anthropic instance, but the proxy only forwards property reads. Assignments such as replacing anthropic.messages for a test double write to the empty proxy target, while later reads always come from getAnthropicClient(), so the write is invisible. This diverges from normal object semantics for the SDK instance and makes otherwise valid test or configuration overrides fail silently.

recommendation:
Forward writes to the lazily-created client with a set trap, or expose an explicit testing/configuration hook rather than typing the proxy as a fully mutable Anthropic instance.

test analysis:
No linked tests were declared for this feature, and there is no owned test covering property assignment on the exported proxy.

suggested regression test:
Add a test that assigns a stub messages resource to the exported anthropic object and asserts subsequent reads/calls use the stub, or assert that mutation is intentionally unsupported through an explicit readonly wrapper type.

minimum fix scope:
Update lib/integrations-anthropic-ai/src/client.ts to either implement set/defineProperty forwarding or narrow the exported API so mutable Anthropic instance semantics are not promised.

repro:
Set process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY, assign (anthropic as any).messages = stub, then read anthropic.messages; the read returns the real client's messages resource rather than the assigned stub.

## medium: Global search cannot page past 200 matches from a single source

id: fnd_sig-feat-library-2076605eb7-6932_52139fca40
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/api-server/src/routes#3 (feat_library_2076605eb7)

evidence:
- artifacts/api-server/src/routes/search.ts:34-36
- artifacts/api-server/src/routes/search.ts:139
- artifacts/api-server/src/routes/search.ts:563-564

The API allows up to page 20 with pageSize 25, so callers can request offsets up to 475. But each source query is capped at 200 rows before the merged array is sliced. If a query has more than 200 matches in one source and few or none in other sources, page 9 and later will return an empty page and hasMore=false even though more rows exist.

recommendation:
Either lower the public max page/pageSize to the bounded fetch window, raise/derive MAX_PER_SOURCE_FETCH to cover MAX_PAGE * MAX_PAGE_SIZE + 1, or switch search to a source-aware cursor/union query that can correctly page beyond the per-source cap.

test analysis:
The feature lists no linked tests. Existing pagination coverage exercises early pages and page-number validation, but not a single-source result set beyond the 200-row per-source fetch cap.

suggested regression test:
Add an integration test that seeds more than 200 matching records in one searchable source, requests page 9 with pageSize 25, and asserts non-empty results plus correct hasMore behavior.

minimum fix scope:
artifacts/api-server/src/routes/search.ts and a focused search pagination test.

repro:
Seed at least 225 matching jobs and no other matching records, then request GET /search?q=<marker>&pageSize=25&page=9. The handler fetches only 200 job rows, slices from offset 200 to 225, and reports no results.

## high: Stripe webhook dedupe records events before successful processing

id: fnd_sig-feat-library-2076605eb7-a1e6_c799860207
category: data-loss
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/api-server/src/routes#3 (feat_library_2076605eb7)

evidence:
- artifacts/api-server/src/routes/stripe-webhook.ts:100-110 (handleStripeWebhook)
- artifacts/api-server/src/routes/stripe-webhook.ts:112-117 (handleStripeWebhook)

The webhook inserts the event id into billingEvents before applying the side effect. If processStripeEvent fails after that insert, Stripe will retry the same event id, but the retry takes the duplicate branch and skips processing entirely. A transient failure can permanently drop subscription/customer state updates while acknowledging the retry as received.

recommendation:
Track processing state separately from receipt, or wrap event processing and durable success marking in a transaction. Duplicate events should only be skipped after the original processing completed successfully; failed/pending events should be retried or reprocessed safely.

test analysis:
The feature lists no linked tests, and the inspected tests do not cover webhook retry behavior after a processing failure.

suggested regression test:
Add a webhook test that simulates a failure after billingEvents insertion, replays the same event id, and verifies the organization update is attempted on retry instead of being treated as a completed duplicate.

minimum fix scope:
artifacts/api-server/src/routes/stripe-webhook.ts plus webhook retry/idempotency coverage.

repro:
Force updateOrganizationFromStripeSubscription or handleCheckoutCompleted to throw after billingEvents insert, then replay the same signed Stripe event. The second delivery returns {received:true, duplicate:true} without updating the organization.

## medium: Invite URL misconfiguration mutates users before failing and loses the raw token

id: fnd_sig-feat-library-2076605eb7-fd71_8a014d040b
category: data-loss
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/api-server/src/routes#3 (feat_library_2076605eb7)

evidence:
- artifacts/api-server/src/routes/users.ts:43-59 (buildInviteUrl)
- artifacts/api-server/src/routes/users.ts:614-643 (POST /)
- artifacts/api-server/src/routes/users.ts:662-683 (POST /)
- artifacts/api-server/src/routes/users.ts:717-728 (POST /:id/invite)
- artifacts/api-server/src/routes/users.ts:829-839 (POST /:id/invite/resend)

buildInviteUrl can throw when the public URL env vars are missing. The invite, reissue, and resend handlers persist the hashed new token before calling email delivery or building the response URL. Because only the token hash is stored, a failure at that point returns 500 after invalidating or creating an invite whose raw token was never returned to the admin or emailed.

recommendation:
Preflight buildInviteUrl or otherwise validate required URL configuration before mutating user rows. For reissue/resend, avoid invalidating an existing token until the new raw token can be delivered or returned, or return a response that still exposes the new raw token when email delivery fails.

test analysis:
The feature lists no linked tests. Existing invite tests cover successful URL/email paths, but not the missing APP_PUBLIC_URL/REPLIT_DEV_DOMAIN failure path after a database mutation.

suggested regression test:
Add tests for invite creation, reissue, and resend with both URL env vars unset, asserting no user/token mutation occurs or that the raw token is still returned in a controlled error response.

minimum fix scope:
artifacts/api-server/src/routes/users.ts invite URL preflight/error handling and focused invite failure-path tests.

repro:
Unset APP_PUBLIC_URL and REPLIT_DEV_DOMAIN, then call POST /api/users or POST /api/users/:id/invite. The database row is created or updated with inviteTokenHash, but the request fails before the raw inviteToken/inviteUrl can be returned.

## medium: Out-of-order item loads can overwrite the currently selected item

id: fnd_sig-feat-library-2a7a94ca80-4f21_44430583ab
category: concurrency
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/cadstone/src/components/schedule (feat_library_2a7a94ca80)

evidence:
- artifacts/cadstone/src/components/schedule/ScheduleItemDialog.tsx:302-323 (loadItem)
- artifacts/cadstone/src/components/schedule/ScheduleItemDialog.tsx:359-378 (ScheduleItemDialog load effect)

The effect starts a new async load whenever itemId/open changes, but loadItem does not cancel stale requests or verify that the response still corresponds to the latest itemId before calling setItem and setValues. If the user opens item A, then item B before A's request resolves, a slower A response can overwrite B's dialog state.

recommendation:
Track the requested item id with a ref or request sequence, and only apply the response if it still matches the latest open itemId. Alternatively use AbortController/cancellation support in the API wrapper.

test analysis:
No linked tests cover rapid itemId changes or stale async responses for ScheduleItemDialog.

suggested regression test:
Add a component test with deferred api.get promises that verifies the dialog ignores an older response after itemId changes.

minimum fix scope:
ScheduleItemDialog loadItem/effect state application.

repro:
Mock api.get so the first item request resolves after the second. Open the dialog for item A, immediately switch to item B, then resolve B followed by A; the state will end on A even though itemId is B.

## high: Draft mode can fall through to live schedule mutations when draft callbacks are missing

id: fnd_sig-feat-library-2a7a94ca80-5dce_fd541532b4
category: data-loss
confidence: medium
triage: risk
status: open
feature: Node source artifacts/cadstone/src/components/schedule (feat_library_2a7a94ca80)

evidence:
- artifacts/cadstone/src/components/schedule/ScheduleItemDialog.tsx:150-157 (ScheduleItemDialogProps)
- artifacts/cadstone/src/components/schedule/ScheduleItemDialog.tsx:568-578 (handleSave)
- artifacts/cadstone/src/components/schedule/ScheduleItemDialog.tsx:915-919 (handleDelete)
- artifacts/cadstone/src/components/schedule/ScheduleItemDialog.tsx:634-645 (handleAddNote)

The props type allows draftMode without the corresponding draft mutation callbacks, and several handlers use live API calls as the fallback. A wiring omission in a draft/publish flow would persist, delete, or annotate real schedule items instead of failing loudly or keeping changes local.

recommendation:
Make draft props a discriminated union where draftMode: true requires all draft callbacks used by the component. Also add runtime guards that reject draft operations if the required callback is missing, rather than falling through to live API calls.

test analysis:
No linked tests were provided for this component, and the package test glob only covers src/**/*.test.ts; no matching ScheduleItemDialog or ScheduleQuickCreate tests were found.

suggested regression test:
Add a component-level test that renders with draftMode true and missing draft callbacks, triggers save/delete/note actions, and asserts no live api.post/api.put/api.delete calls occur.

minimum fix scope:
ScheduleItemDialog prop typing and all draft-mode mutation branches.

repro:
Render ScheduleItemDialog with draftMode={true} and omit onDraftSave or onDraftDelete; saving or deleting takes the non-draft api.post/api.put/api.delete path.

## medium: Manual end date edits are discarded on save

id: fnd_sig-feat-library-2a7a94ca80-c920_cea1fd6cfb
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/cadstone/src/components/schedule (feat_library_2a7a94ca80)

evidence:
- artifacts/cadstone/src/components/schedule/ScheduleItemDialog.tsx:531-539 (buildPayload)
- artifacts/cadstone/src/components/schedule/ScheduleItemDialog.tsx:1954-1961 (ScheduleItemDialog end date input)
- artifacts/cadstone/src/components/schedule/ScheduleItemDialog.tsx:269 (ScheduleItemDialog)

The UI has an editable end-date field and tracks manual end-date edits, but buildPayload always sends endDate as null. That means Save never persists the explicit date the user selected; the server is asked to recompute from startDate/workDays instead. This can change the saved end date for weekend/exception dates or any case where the manual date is intentionally different from the computed business end date.

recommendation:
When the user has manually edited the end date, send values.endDate in the payload. Alternatively remove the manual end-date affordance and always present the computed business date so the UI does not imply direct persistence.

test analysis:
No linked tests exercise the dialog payload built after editing the End Date field.

suggested regression test:
Add a test that changes the End Date input, saves, and asserts the API payload includes the selected endDate when manualEndDate is true.

minimum fix scope:
ScheduleItemDialog buildPayload and manualEndDate handling.

repro:
Open an item, enable Multi-day, manually choose an end date, then Save. The outgoing payload contains endDate: null rather than the chosen values.endDate.

## medium: Invalid rate-limit environment values can disable or break quotas

id: fnd_sig-feat-library-2d5fdf2953-1a06_158673ad1b
category: build-release
confidence: high
triage: risk
status: open
feature: Node source artifacts/api-server/src/lib#2 (feat_library_2d5fdf2953)

evidence:
- artifacts/api-server/src/lib/rate-limit.ts:237-246 (createAiParsePerUserRateLimit)
- artifacts/api-server/src/lib/rate-limit.ts:257-266 (createUploadPerUserRateLimit)
- artifacts/api-server/src/lib/rate-limit.ts:323-341 (createRateLimit)
- artifacts/api-server/src/lib/rate-limit.ts:344-353 (createRateLimit)
- artifacts/api-server/test/rate-limit.test.ts:93-117

The AI and upload limiters parse operational env vars with Number() but never validate that max/windowMs are finite positive integers. If a max env var is non-numeric, count > NaN is always false, remaining becomes NaN, and the limiter stops enforcing. If a window env var is invalid, the Postgres interval query fails and the middleware explicitly fails open. Empty or zero values can also block all traffic. These limiters protect paid AI calls and object-storage uploads, so a simple env typo can become either a quota bypass or a production outage.

recommendation:
Parse rate-limit env vars with a helper that rejects non-finite, non-integer, or non-positive values at startup, or falls back to defaults with a loud log. Validate createRateLimit options defensively before building middleware.

test analysis:
The rate-limit tests exercise valid numeric options and shared-bucket behavior, but they do not mutate AI_PARSE_PER_USER_MAX, AI_PARSE_PER_USER_WINDOW_MS, UPLOAD_PER_USER_MAX, or UPLOAD_PER_USER_WINDOW_MS to invalid values.

suggested regression test:
Add tests around the env-backed limiter constructors or a parsing helper for values like "abc", "", "0", and "-1", asserting they either throw during setup or use the documented default rather than producing NaN headers or fail-open behavior.

minimum fix scope:
Add validated env parsing in rate-limit.ts and cover invalid env cases in rate-limit tests.

## medium: URL query PII is ignored but still sent in Sentry events

id: fnd_sig-feat-library-2d5fdf2953-7d1c_e8f5bc9331
category: security
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/api-server/src/lib#2 (feat_library_2d5fdf2953)

evidence:
- artifacts/api-server/src/lib/pii-filter.ts:1-10
- artifacts/api-server/src/lib/pii-filter.ts:81-83 (valueContainsPii.normalizeString)
- artifacts/api-server/test/pii-filter.test.ts:78-86

valueContainsPii only returns a boolean; it does not mutate or redact the event payload. For any field whose key ends in url, the scanner drops everything after ? or # before looking for PII, so an event containing request.url = "https://example.test/path?email=alice@example.com" returns false and the original URL can still be sent to Sentry. The linked test codifies this broad skip for a phone-like token query parameter, but the implementation skips all query parameters, including explicit PII fields, which contradicts the stated PII backstop contract.

recommendation:
Do not blanket-skip URL queries. Parse URL fields and scan non-secret query parameter values, or drop the event whenever a URL contains a query string with email/phone/address patterns while still allowing known secret-token keys to be ignored deliberately.

test analysis:
The existing test only asserts that a phone-looking token in a query string is ignored. It does not include PII-bearing query keys such as email, phone, address, contact, or q, and it does not verify that the event payload is redacted before send.

suggested regression test:
Add a valueContainsPii test with { request: { url: "https://api.example.test/search?email=alice@example.com" } } and assert true, plus a separate allowlisted secret-token query case if that exception is still required.

minimum fix scope:
Update pii-filter URL handling and its tests.

## high: Resource and copied folders lose tenant scope

id: fnd_sig-feat-library-2d5fdf2953-bc67_88e6ea6b77
category: security
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/api-server/src/lib#2 (feat_library_2d5fdf2953)

evidence:
- artifacts/api-server/src/lib/file-manager.ts:582-593 (listResourceFolders)
- artifacts/api-server/src/lib/file-manager.ts:355-370 (getAllFoldersForJob)
- artifacts/api-server/src/lib/file-manager.ts:970-980 (createResourceFolder)
- artifacts/api-server/src/lib/file-manager.ts:1112-1131 (copyFolder)
- artifacts/api-server/src/lib/file-manager.ts:1144-1152 (copyFolder)

Resource folder listing accepts auth but does not apply organizationScopeCondition or any organization predicate; for resource scope it selects every non-deleted row with job_id null and scope resource. New resource folders are inserted without organizationId, and copyFolder also inserts copied folders/files without preserving currentFolder.organizationId/currentFile.organizationId. In a multi-tenant SaaS workspace, this can expose shared resource folders across tenants and can orphan copied job files/folders from tenant-scoped queries or cleanup paths.

recommendation:
Thread the active organization through resource folder creation/listing and enforce it in getAllFoldersForJob for resource scope. Preserve organizationId when copying folders and files, and add tenant-scoped tests for resource folder list/create/upload and copyFolder.

test analysis:
The linked tests cover annotations, PII filtering, and rate limiting. They do not exercise resource folders or assert organizationId preservation when folders/files are copied.

suggested regression test:
Create org A and org B resource folders, authenticate one user in org A, and assert listResourceFolders returns only org A rows. Add a copyFolder regression that seeds a job folder/file with organizationId and asserts every copied folder/file keeps that same organizationId.

minimum fix scope:
Update file-manager resource folder queries/writes and copyFolder inserts; adjust route params as needed to pass active organizationId.

## medium: Generated comment attachment response type cannot represent uploaded comment files

id: fnd_sig-feat-library-2ea4e52279-3225_a4f8573aee
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: Node source lib/api-zod/src/generated/types#5 (feat_library_2ea4e52279)

evidence:
- lib/api-zod/src/generated/types/dailyLogCommentAttachment.ts:9-12 (DailyLogCommentAttachment)
- lib/api-zod/src/generated/types/dailyLogComment.ts:20-21 (DailyLogComment)
- lib/api-zod/src/generated/types/dailyLogCommentAttachmentsCreatedResponse.ts:10-14 (DailyLogCommentAttachmentsCreatedResponse)

The generated group describes the comment attachment upload flow as file-backed: uploaded files are referenced by fileId in the follow-up comment create call. However, the generated read-side DailyLogComment.attachments element only exposes name, a required non-null url, and mimeType. The inspected route/frontend context confirms new comment attachments are persisted/read back as fileId/fileUrl with url nullable for legacy compatibility. This contract cannot type or validate those new attachments, so consumers using these generated types or zod schemas lose the authenticated file identifiers needed to preview/download uploaded comment attachments.

recommendation:
Update the OpenAPI source schema for DailyLogCommentAttachment to include fileId?: string | null and fileUrl?: string | null, and make url nullable or optional if file-backed attachments may not carry a legacy data URL. Regenerate api-zod/api-client outputs from the spec rather than hand-editing generated files.

test analysis:
The feature lists no linked tests, and the existing generated type snapshot does not exercise a comment attachment round trip through the generated response contract.

suggested regression test:
Add an API/codegen contract test that uploads a daily-log comment attachment, posts a comment with attachments: [{fileId}], fetches comments, and validates that the generated response schema/type preserves fileId/fileUrl and accepts url: null for the attachment.

minimum fix scope:
OpenAPI DailyLogCommentAttachment schema plus regenerated generated clients/schemas/types.

## high: PM-only at-risk drilldowns are routed behind an admin-only gate

id: fnd_sig-feat-library-2ed147a4c6-acfa_2e399e2012
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/cadstone/src/pages/at-risk (feat_library_2ed147a4c6)

evidence:
- artifacts/cadstone/src/pages/at-risk/MissingLogsPage.tsx:20-21 (MissingLogsAtRiskPage)
- artifacts/cadstone/src/pages/at-risk/PendingChangeOrdersPage.tsx:18-19 (PendingChangeOrdersAtRiskPage)
- artifacts/cadstone/src/App.tsx:171-179 (buildRouter)
- artifacts/cadstone/src/lib/role-access.ts:15-18 (ROLE_GATES)

Both owned pages explicitly render PM-only dashboard data and tell non-PM payloads that the list is only available to project managers, but the route that mounts them is guarded by ROLE_GATES.companyViews, which is admin-only. A project manager clicking the PM Home at-risk tiles is redirected to /403 before either drilldown page can mount. An admin can reach the URL, but the page rejects the admin-shaped /dashboard/home payload as not PM, so the feature is unusable for both relevant navigation paths.

recommendation:
Make the route gate match the page contract, for example by allowing project_manager on these two at-risk routes, or change the pages and backend payload they consume to an admin-supported contract. Add route coverage that clicks both PM Home at-risk tiles as a PM.

test analysis:
The existing home-role-routing e2e test only asserts that the PM at-risk tile is visible on Home; it never follows the tile links or opens either owned at-risk route.

suggested regression test:
Add an e2e test using PM_STATE that clicks home-pm-at-risk-missing-logs and home-pm-at-risk-cos, then asserts at-risk-missing-logs and at-risk-pending-cos render instead of /403.

minimum fix scope:
Update the route gate for the two at-risk routes and add PM navigation coverage for both drilldowns.

repro:
Sign in as a project_manager, navigate to /at-risk/missing-logs or click the PM Home missing-logs tile, and observe the /403 redirect. Sign in as admin and open the same URL; the page renders the non-PM message instead of a drilldown list.

## medium: Load failures fall through to empty success states

id: fnd_sig-feat-library-2ed147a4c6-c6bb_207fa5a53d
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/cadstone/src/pages/at-risk (feat_library_2ed147a4c6)

evidence:
- artifacts/cadstone/src/pages/at-risk/MissingLogsPage.tsx:23-25 (MissingLogsAtRiskPage)
- artifacts/cadstone/src/pages/at-risk/MissingLogsPage.tsx:49-67 (MissingLogsAtRiskPage)
- artifacts/cadstone/src/pages/at-risk/PendingChangeOrdersPage.tsx:21-23 (PendingChangeOrdersAtRiskPage)
- artifacts/cadstone/src/pages/at-risk/PendingChangeOrdersPage.tsx:47-65 (PendingChangeOrdersAtRiskPage)

When /dashboard/home fails with no cached data, React Query reports loading false, error set, and data undefined. These pages toast the error, but then continue rendering the non-loading branch where !data is treated the same as an empty successful result. That shows 'All open jobs have a recent daily log' or 'No pending change orders' and a zero count after a failed fetch, which can hide an at-risk condition behind a success message.

recommendation:
Render an explicit error state when error is present and data is absent, and only show empty success copy after a successful PM payload is available. If cached data is present with an error, make the stale/error state visually distinct.

test analysis:
There are no component or e2e tests for these owned pages' loading, empty, or failed-request branches; existing e2e coverage only checks high-level Home role routing.

suggested regression test:
Add component tests for both pages with the dashboard hook mocked to fail without data, asserting the empty success messages are not rendered and an error state is shown.

minimum fix scope:
Update both owned at-risk pages' render branches to handle error-without-data before the empty-state checks.

repro:
Mock useDashboardGetDashboardHome to return { data: undefined, isLoading: false, error: new Error('boom') } and render either page. MissingLogsPage displays the all-clear empty state; PendingChangeOrdersPage displays 'No pending change orders.'

## medium: Financial reports count invoice matching as cash collection

id: fnd_sig-feat-library-2f6cce8c1e-4c32_171e6a35fa
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/api-server/src/routes#2 (feat_library_2f6cce8c1e)

evidence:
- artifacts/api-server/src/routes/financials.ts:1546-1573 (applyInvoiceMatches)
- artifacts/api-server/src/routes/financials.ts:1603-1606 (applyInvoiceMatches)
- artifacts/api-server/src/routes/reports.ts:168-195 (loadArAging)
- artifacts/api-server/src/routes/reports.ts:316-335 (loadRevenue)
- artifacts/api-server/src/routes/reports.ts:500-532 (loadDaysToPayment)
- artifacts/api-server/test/financials.test.ts:379-428 (POST /financials/invoices applies AI matches to line items)

invoiceLinePayments are created when AI invoice line matches are applied to SOV line items, not when customer cash is received. applyInvoiceMatches also sets appliedAt immediately. The report layer then treats those allocation rows as paid/collected cash: A/R aging subtracts them from invoice total, revenue reports them as collectedCents, and days-to-payment measures invoiceDate to match application time. The financials test demonstrates an invoice with 25,000 cents of retention still outstanding but matches totaling the full invoice amount; A/R aging would compute zero outstanding for that invoice.

recommendation:
Separate SOV allocation/matching from actual collections. Reports should use explicit payment/collection records or a clearly defined collected field/date; if retained invoices are considered partially collected, A/R should leave retention outstanding until release/payment. Rename or avoid invoiceLinePayments in report cash calculations unless it truly represents cash receipt.

test analysis:
reports.test.ts only covers range parsing and percentile helpers. It does not seed invoices/payments or assert A/R, collected revenue, or days-to-payment semantics against financials invoices.

suggested regression test:
Add report integration tests that seed a tracker invoice with retention and full SOV matches, then assert A/R includes the retained outstanding amount and revenue collected does not equal gross matched amount until an actual payment/release record exists.

minimum fix scope:
artifacts/api-server/src/routes/reports.ts, the financials/report data model or query semantics for collections, and report integration tests.

repro:
Create a retained invoice like the financials test: totalCents 250000, retentionHeldCents 25000, netPaidCents 225000, and matches summing to 250000. GET /reports/ar-aging will subtract the full 250000 invoiceLinePayments sum and omit the 25000 retention receivable; /reports/revenue will count 250000 as collected in the match-created month; /reports/days-to-payment will use appliedAt rather than a real payment date.

## medium: MCP audit rows are written without organization scope

id: fnd_sig-feat-library-2f6cce8c1e-c9f5_100c73ab58
category: security
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/api-server/src/routes#2 (feat_library_2f6cce8c1e)

evidence:
- artifacts/api-server/src/routes/mcp.ts:37-56 (writeMcpAuditRow)
- artifacts/api-server/src/routes/mcp.ts:91-98 (mcpHandler.resolvePat)
- artifacts/api-server/src/routes/mcp.ts:218-227 (POST /mcp/audit)
- artifacts/api-server/test/mcp.test.ts:200-227 (MCP round-trip audit assertion)

The MCP audit writer bypasses writeActivity and inserts activity_log rows directly, but its payload does not carry organizationId. The HTTP MCP path discards the organization resolved from the PAT, and the stdio audit endpoint passes only patId/userId. In a tenant-scoped audit/activity system this either hides MCP audit events from org-scoped feeds or leaves them as unscoped rows that can be mishandled later.

recommendation:
Add organizationId to AuditPayload, pass resolved.organizationId from resolvePersonalAccessToken and auth.organizationId from /mcp/audit, and include it in the activityLog insert. Assert it in the MCP test.

test analysis:
mcp.test.ts queries activityLog directly by userId and does not select or assert organizationId, so null-scoped audit rows still satisfy the current test.

suggested regression test:
Extend the MCP round-trip test to create/use an org-scoped PAT and assert the mcp_tool_call activity row has that organizationId; also verify an org-scoped activity listing can see the row.

minimum fix scope:
artifacts/api-server/src/routes/mcp.ts and artifacts/api-server/test/mcp.test.ts.

repro:
Use an organization-scoped PAT to call an MCP tool. The test shows the row exists when queried directly by userId, but writeMcpAuditRow never sets organizationId, so any org-scoped activity query cannot reliably attribute that mcp_tool_call to the tenant.

## high: Company-wide workday exceptions are not tenant-scoped

id: fnd_sig-feat-library-2f6cce8c1e-e893_3dea8f9bec
category: security
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/api-server/src/routes#2 (feat_library_2f6cce8c1e)

evidence:
- artifacts/api-server/src/routes/schedule.ts:862-884 (loadAllWorkdayExceptions)
- artifacts/api-server/src/routes/schedule.ts:897-902 (getWorkdayExceptionsForJob)
- artifacts/api-server/src/routes/schedule.ts:1658-1679 (resolveWorkdayExceptionTargetJobIds)
- artifacts/api-server/src/routes/schedule.ts:2905-2919 (POST /jobs/:jobId/workday-exceptions)

Workday-exception reads load every exception in the database and then apply every appliesToAllJobs row to any requested job, with no active-organization predicate. The company-wide write path also expands to all active jobs globally, so creating or editing one tenant's company-wide non-workday can recalculate schedules for other tenants. The insert does not stamp organizationId either, which prevents later predicates from isolating the new row.

recommendation:
Stamp scheduleWorkdayExceptions and categories with the active organization and pass AuthContext or organizationId through loadAllWorkdayExceptions, getWorkdayExceptionsForJob, getWorkdayExceptionsByJob, getWorkdayExceptionOrThrow, listAllActiveJobIds, and all update/delete predicates. Also validate explicit jobIds belong to the active organization before storing or synchronizing them.

test analysis:
The included tests cover financials, MCP, and report helpers only; there is no schedule workday-exception test or multi-tenant isolation fixture.

suggested regression test:
Add a schedule route test with two organizations and two jobs. Create an appliesToAllJobs exception in org A, then assert org B's GET workday-exceptions does not return it and org B schedule items are not recalculated.

minimum fix scope:
artifacts/api-server/src/routes/schedule.ts plus focused schedule workday-exception tests.

repro:
As an admin in tenant A, create POST /api/jobs/<tenant-a-job>/workday-exceptions with appliesToAllJobs=true. The route resolves affected jobs through listAllActiveJobIds(), which selects every non-deleted job, then synchronizeAffectedJobSchedules recalculates schedules outside tenant A. GET /api/jobs/<tenant-b-job>/workday-exceptions also includes tenant A's appliesToAllJobs exception because getWorkdayExceptionsForJob filters only by appliesToAllJobs/jobIds.

## high: Lead detail requests can race and save the wrong lead's data

id: fnd_sig-feat-library-351877d7b9-4ddc_e74ccae6f7
category: data-loss
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/cadstone/src/pages#2 (feat_library_351877d7b9)

evidence:
- artifacts/cadstone/src/pages/leads.tsx:523-539 (openSheet)
- artifacts/cadstone/src/pages/leads.tsx:567-604 (handleSaveEdit)

Opening a lead starts an uncancelled detail request, and every response unconditionally replaces leadDetail/editForm. If the user opens lead A and then lead B before A's request completes, A can resolve last while sheetLeadId remains B. A subsequent save sends A-derived form data to id B, corrupting B's lead record.

recommendation:
Track the requested lead id or a monotonically increasing request id in openSheet, and only apply the response/final loading state when it still matches the current sheetLeadId/request. Alternatively use React Query keyed by lead id and render data only for the active id.

test analysis:
The linked tests are jobs and schedule smoke tests; they do not open lead detail sheets or simulate out-of-order lead detail responses.

suggested regression test:
Add a UI test that intercepts /api/leads/:id, delays the first clicked lead's response, opens a second lead, releases the first response, and asserts the sheet still shows/saves the second lead's details.

minimum fix scope:
artifacts/cadstone/src/pages/leads.tsx openSheet request handling and save preconditions.

repro:
Throttle the network, click one lead row, immediately click another lead row, let the first request resolve last, then edit and save. The save targets the second lead id with the first lead's loaded form data.

## medium: Concurrent inline job edits can overwrite each other

id: fnd_sig-feat-library-351877d7b9-a7e9_065cc2da66
category: concurrency
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/cadstone/src/pages#2 (feat_library_351877d7b9)

evidence:
- artifacts/cadstone/src/pages/jobs.tsx:559-603 (performInlineUpdate)
- artifacts/cadstone/src/pages/jobs.tsx:613-668 (handleInlineStatusChange/handleInlineProjectManagerChange/handleInlineDateChange)

Every inline editor performs its own GET of the full job, merges only one override, then PUTs the full payload. Two quick edits starting from the same base record, such as status and projected start, can both PUT full payloads with stale values for the other field; whichever finishes last reverts the earlier edit while both may show success toasts.

recommendation:
Serialize inline updates per job, or maintain a pending merged draft per job and have later requests include already-pending changes. Prefer a PATCH endpoint for partial job updates if the API supports adding one.

test analysis:
artifacts/cadstone/tests/e2e/jobs.spec.ts only creates a job, searches the list, and checks the detail page tabs; it never exercises inline list edits or overlapping mutations.

suggested regression test:
Add a component/integration test that delays PUT /jobs/:id, fires two inline edits on one job, resolves both requests, and asserts both edited fields persist.

minimum fix scope:
artifacts/cadstone/src/pages/jobs.tsx inline update orchestration around performInlineUpdate.

repro:
On /jobs, trigger two inline edits on the same row before the first mutation finishes, for example change status and then change projected start. If both GETs observe the original record, the later PUT will restore the field changed by the earlier PUT.

## medium: Changing the My Daily Logs client query param does not reload logs

id: fnd_sig-feat-library-351877d7b9-e942_ff8548927d
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/cadstone/src/pages#2 (feat_library_351877d7b9)

evidence:
- artifacts/cadstone/src/pages/my-daily-logs.tsx:52-57 (clientFilterId)
- artifacts/cadstone/src/pages/my-daily-logs.tsx:101-108 (loadLogs)
- artifacts/cadstone/src/pages/my-daily-logs.tsx:158-163 (load effect)
- artifacts/cadstone/src/pages/my-daily-logs.tsx:171-181 (clear client filter link)

clientFilterId is derived from the current URL and included in requestParams, but the effect that reloads logs only depends on debouncedSearch. Navigating from one client filter to another, or using the clear link, updates the displayed filter state without fetching the corresponding unfiltered/new-client logs until another search change or reload happens.

recommendation:
Use useSearchParams/useLocation for the client filter and include clientFilterId in the initial-load effect dependencies. Reset cursor/hasMore and reload whenever the client filter changes.

test analysis:
The linked e2e tests cover jobs and job schedule only; no test navigates My Daily Logs with a client query parameter or clears it.

suggested regression test:
Add a route-level test that loads /daily-logs/mine?client=A, then navigates to /daily-logs/mine or ?client=B and asserts the API is called with the updated clientId parameters and the list changes.

minimum fix scope:
artifacts/cadstone/src/pages/my-daily-logs.tsx client filter state and load effect dependencies.

repro:
Open /daily-logs/mine?client=<id>, wait for filtered logs, then click the clear client filter link. The chip disappears, but the existing filtered logs remain because loadLogs(null) is not called for the URL change.

## low: Company schedule crashes when an item has no start date

id: fnd_sig-feat-library-351877d7b9-fa72_79ed027caa
category: bug
confidence: medium
triage: risk
status: open
feature: Node source artifacts/cadstone/src/pages#2 (feat_library_351877d7b9)

evidence:
- artifacts/cadstone/src/pages/schedule.tsx:52-58 (formatDate)
- artifacts/cadstone/src/pages/schedule.tsx:245-253 (groupedByDate)
- artifacts/cadstone/src/pages/schedule.tsx:450-453 (default schedule rendering)

The grouping code substitutes the display dash string for missing startDate values, then passes that truthy string into formatDate. formatDate only handles null/undefined/empty values; with "—" it constructs an invalid Date and Intl.DateTimeFormat.format throws a RangeError, blanking the page for any unscheduled item in gantt/week/month views.

recommendation:
Keep the map key as a stable sentinel but render it directly, or pass null to formatDate for missing dates. For example, use a sentinel key like "__unscheduled__" and display "—" without date parsing.

test analysis:
artifacts/cadstone/tests/e2e/schedule.spec.ts exercises the job schedule page with explicit startDate/endDate values; it does not cover the company schedule page or unscheduled/null-date rows.

suggested regression test:
Add a component test or mocked Playwright route for /schedule returning one item with startDate null, then assert the company schedule page renders an unscheduled bucket instead of crashing.

minimum fix scope:
artifacts/cadstone/src/pages/schedule.tsx groupedByDate key/display handling.

repro:
Have /schedule return a row with startDate null or undefined and open the default company schedule view. The grouped date header calls formatDate("—") and throws.

## medium: Lead list response types expose JSON date fields as Date objects

id: fnd_sig-feat-library-351c0b5530-b753_65c010deba
category: api-contract
confidence: medium
triage: contract-mismatch
status: open
feature: Node source lib/api-zod/src/generated/types#13 (feat_library_351c0b5530)

evidence:
- lib/api-zod/src/generated/types/leadListItem.ts:27-36 (LeadListItem)

LeadListItem is documented as the row returned by GET /leads, but its date fields are typed as Date. JSON API responses carry date and date-time values as strings after parsing, so consumers using this exported type can write Date-object logic against values that are actually strings unless every response is explicitly parsed through a coercing schema first. This is especially risky for projectedSalesDate, which is a calendar date and loses its wire-format semantics when represented as Date.

recommendation:
Generate response wire types with string date fields, or split parsed schema output types from API wire response types so callers cannot confuse raw JSON with zod-coerced values.

test analysis:
The feature lists no linked tests, and the inspected generated type files have no test coverage asserting raw GET /leads response date types.

suggested regression test:
Add a contract/type test that the generated LeadListItem wire type represents projectedSalesDate, createdAt, and updatedAt as strings matching JSON responses, or add a test documenting that all consumers must parse through the zod response schema before using the Date output type.

minimum fix scope:
OpenAPI/codegen configuration for api-zod generated response date typing, then regenerate the generated files.

repro:
Use LeadListItem to type a parsed GET /leads JSON response and call lead.projectedSalesDate?.toISOString(); TypeScript accepts it, but a normal JSON response value like "2026-04-01" is a string and will throw at runtime.

## low: Contact create type contradicts its conditional required contract

id: fnd_sig-feat-library-351c0b5530-f2a1_3f25313249
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: Node source lib/api-zod/src/generated/types#13 (feat_library_351c0b5530)

evidence:
- lib/api-zod/src/generated/types/leadsContactCreateSchema.ts:9-18 (LeadsContactCreateSchema)
- lib/api-zod/src/generated/types/leadsContactCreateSchema.ts:14-25 (LeadsContactCreateSchema)

The schema documentation says displayName and email are required when sourceContactId is not provided, but the generated TypeScript interface marks sourceContactId, displayName, and email all optional. As a result, an empty object or a manually entered contact without email type-checks even though it violates the documented request contract and will be rejected by the server-side validation.

recommendation:
Represent the request body as a union, such as a clone variant requiring sourceContactId and a manual-create variant requiring displayName and email, or update the generated schema source so codegen emits the conditional requirement.

test analysis:
The feature lists no linked tests, and no included test asserts that the generated contact-create type rejects the no-sourceContactId/no-displayName/no-email case.

suggested regression test:
Add a type-level contract test using @ts-expect-error for `const bad: LeadsContactCreateSchema = {};` and positive cases for sourceContactId cloning and manual create with displayName plus email.

minimum fix scope:
OpenAPI schema for leads_contactCreateSchema and regenerated api-zod types.

repro:
const payload: LeadsContactCreateSchema = {}; compiles despite representing neither a clone request nor a valid new-contact request.

## low: Unassigned filter displays as all team members

id: fnd_sig-feat-library-3570aaf687-4996_277c7ebee0
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/cadstone/src/pages/job-schedule/components (feat_library_3570aaf687)

evidence:
- artifacts/cadstone/src/pages/job-schedule/components/AssigneeSelect.tsx:29-39 (AssigneeSelect)
- artifacts/cadstone/src/pages/job-schedule/components/AssigneeSelect.tsx:39 (AssigneeSelect)
- artifacts/cadstone/src/pages/job-schedule/components/AssigneeSelect.tsx:61-70 (AssigneeSelect)

The component has a distinct unassigned sentinel value, but the trigger label only resolves real users and otherwise falls back to "All team members". When the caller sets value to "__unassigned__", the popover item is selected correctly, but the closed control tells the user the filter is all team members, which misrepresents the active schedule filter.

recommendation:
Map the sentinel value explicitly before falling back, for example render "Unassigned" when value === "__unassigned__", a user full name for matching user ids, and "All team members" only for the empty value.

test analysis:
No linked tests were provided for AssigneeSelect state rendering or filter label behavior.

suggested regression test:
Add a component test that renders AssigneeSelect with value="__unassigned__" and asserts the trigger text is "Unassigned" while value="" still shows "All team members".

minimum fix scope:
Update AssigneeSelect trigger label derivation to handle the unassigned sentinel.

repro:
Render AssigneeSelect with value="__unassigned__" and any users array; the closed trigger displays "All team members" instead of "Unassigned".

## high: Draft publish can leave partial server writes that duplicate on retry

id: fnd_sig-feat-library-385510f50e-4960_7f38d31fba
category: data-loss
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/cadstone/src/pages/job-schedule/hooks (feat_library_385510f50e)

evidence:
- artifacts/cadstone/src/pages/job-schedule/hooks/useScheduleDraft.ts:381-389 (handlePublishDraft)
- artifacts/cadstone/src/pages/job-schedule/hooks/useScheduleDraft.ts:395-415 (handlePublishDraft)
- artifacts/cadstone/src/pages/job-schedule/hooks/useScheduleDraft.ts:423-426 (handlePublishDraft)

Publishing a draft performs independent POST, PUT, note, and DELETE requests directly from the client. If one request fails after earlier requests succeeded, the catch only shows a toast and leaves the draft in offline mode with draft IDs still unmapped. Retrying the same draft will POST the already-created draft items again, and deletes or updates that already succeeded are not reconciled. This can create duplicate schedule items or leave the persisted schedule only partly matching the draft.

recommendation:
Move draft publishing behind a server-side transactional/batch endpoint, or add client-side idempotency keys plus reconciliation of successful draft-id mappings before allowing retry. Do not clear or retry blindly after partial success.

test analysis:
The feature lists no linked tests, and the hook has no evidence of a test that simulates partial API failure during draft publish.

suggested regression test:
Add a publish-draft test that stubs the first create as successful and a later request as failing, then retries publish and asserts no duplicate create is issued for the already-created draft item.

minimum fix scope:
Change `handlePublishDraft` and the schedule API contract it calls so publish is atomic or idempotent across creates, updates, notes, and deletes.

repro:
Create a draft with two new schedule items, publish it, and make the second create/update request fail after the first POST succeeds. The UI remains in draft mode. Click publish again; the first draft item is posted a second time because no persisted ID mapping from the failed attempt is retained.

## medium: Stale schedule fetches can overwrite state after switching jobs

id: fnd_sig-feat-library-385510f50e-5782_d48be7bc57
category: concurrency
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/cadstone/src/pages/job-schedule/hooks (feat_library_385510f50e)

evidence:
- artifacts/cadstone/src/pages/job-schedule/hooks/useScheduleData.ts:59-82 (fetchItems)
- artifacts/cadstone/src/pages/job-schedule/hooks/useScheduleData.ts:170-183 (loadData)
- artifacts/cadstone/src/pages/job-schedule/hooks/useScheduleData.ts:194-204 (useScheduleData)

The hook starts new loads when `jobId` changes, but none of the async setters check that their response still belongs to the latest job. A slower response from the previous job can run after the component has already rendered a new `jobId`, replacing `items`, `baseline`, `settings`, workday exceptions, or history with stale data. That can make the user view or edit the wrong schedule until the next refresh.

recommendation:
Track a request sequence/current job ref or use an AbortController, and ignore all responses whose captured `jobId` is no longer current before calling state setters or `onItemsFetched`. Apply the same guard to history/settings/baseline/workday exception fetches and `refreshScheduleData`.

test analysis:
The feature lists no linked tests, and there is no included test covering overlapping job loads or out-of-order API responses.

suggested regression test:
Add a hook-level test with deferred promises for two different job IDs; resolve the second request first and the first request last, then assert the final state still contains only the second job's schedule data.

minimum fix scope:
Update `useScheduleData` async fetch/load functions to gate state updates by the latest job/request identity.

repro:
Navigate from job A's schedule to job B's schedule while job A's schedule request is still in flight. If job B loads first and job A resolves afterward, `fetchItems` from job A calls `setItems` and `onItemsFetchedRef.current` with job A records while the page is now on job B.

## low: Missing jobId leaves schedule loading forever

id: fnd_sig-feat-library-385510f50e-9ad0_b3716dfa61
category: bug
confidence: medium
triage: risk
status: open
feature: Node source artifacts/cadstone/src/pages/job-schedule/hooks (feat_library_385510f50e)

evidence:
- artifacts/cadstone/src/pages/job-schedule/hooks/useScheduleData.ts:48-49 (useScheduleData)
- artifacts/cadstone/src/pages/job-schedule/hooks/useScheduleData.ts:170-173 (loadData)
- artifacts/cadstone/src/pages/job-schedule/hooks/useScheduleData.ts:194-197 (useScheduleData)

`loading` starts as `true`, but `loadData` returns immediately when `jobId` is undefined and never sets loading to false or clears stale state. Because the option type explicitly allows `jobId: string | undefined`, a route/render without a resolved job ID can leave consumers stuck in a loading state indefinitely.

recommendation:
When `jobId` is missing, explicitly set `loading` to false and clear job-scoped state, or make `jobId` required before this hook is mounted.

test analysis:
The feature lists no linked tests, and there is no included hook test for the undefined-jobId path.

suggested regression test:
Render the hook with `jobId` undefined and assert that it does not remain loading after effects flush.

minimum fix scope:
Update `useScheduleData.loadData` or its effect to handle missing `jobId` as an idle state.

repro:
Render `useScheduleData` with `jobId` undefined. The effect calls `loadData`, `loadData` returns before the `finally`, and `loading` remains true.

## medium: Concurrent codegen runs can delete each other's staging output

id: fnd_sig-feat-library-3c1fcd1460-e7eb_fa737dcdd9
category: concurrency
confidence: high
triage: confirmed-bug
status: open
feature: Node source lib/api-spec/scripts (feat_library_3c1fcd1460)

evidence:
- lib/api-spec/scripts/codegen.mjs:74-90 (cleanupStrayDirs)
- lib/api-spec/scripts/codegen.mjs:252-275
- lib/api-spec/scripts/codegen.mjs:193-249 (replaceFilesAtomically)

The staging directory name is made unique per process, but cleanupStrayDirs deletes every directory matching __codegen_staging_* under both generated parents. Because it runs at process start and again on failure without a lock, a second codegen invocation can remove the staging directory of a first invocation while that first invocation is still running post-codegen or replacing files. If the first process has already moved some staged files, this can leave generated/ as a partial mix of old and new files before the first process fails.

recommendation:
Do not delete staging directories owned by other active processes. Use a lock file around codegen, or make cleanup only remove the current process's staging dir plus stale dirs proven inactive by age/metadata. On failure, clean only this run's staging dirs instead of all matching prefixes.

test analysis:
The feature lists no linked tests, and the script has no concurrency regression coverage for simultaneous codegen invocations or failure cleanup during another run.

suggested regression test:
Add an integration test that starts two wrapper instances with a stubbed orval command that creates per-PID staging dirs and blocks. Assert that one process's initial or failure cleanup does not remove the other process's staging directory and that generated/ is unchanged or fully swapped after both exit.

minimum fix scope:
Update lib/api-spec/scripts/codegen.mjs cleanup ownership/locking behavior and add a focused concurrency test around staging cleanup.

repro:
Start two `pnpm --filter @workspace/api-spec run codegen` processes at the same time. If one process reaches staging creation before the other runs cleanupStrayDirs, the second process can delete the first process's staging tree, causing ENOENT / missing staging failures or a partially swapped generated directory.

## medium: Convert-to-job date overrides are typed as Date for a JSON request body

id: fnd_sig-feat-library-3f1c7e3603-3c1d_3d5f815581
category: api-contract
confidence: medium
triage: contract-mismatch
status: open
feature: Node source lib/api-zod/src/generated/types#12 (feat_library_3f1c7e3603)

evidence:
- lib/api-zod/src/generated/types/leadConvertToJobBody.ts:11-20 (LeadConvertToJobBody)
- lib/api-zod/src/generated/types/leadConvertToJobBodyJob.ts:24-27 (LeadConvertToJobBodyJob)
- lib/api-zod/package.json:6-7

The exported api-zod request type for POST /leads/{id}/convert-to-job tells consumers to provide Date objects for date-only job overrides. A Date in a JSON request serializes as an ISO timestamp, not a YYYY-MM-DD calendar date, so callers following this type can send a wire shape the lead/job handlers typically reject for date-only fields. Neighboring generated request payloads in this package model the same kind of date-only fields as strings, so this source group is inconsistent with the established contract surface.

recommendation:
Fix the OpenAPI schema for LeadConvertToJobBody.job.projectedStart and projectedCompletion to be string date-only fields with a YYYY-MM-DD pattern and no date coercion, then regenerate api-zod output rather than hand-editing generated files.

test analysis:
The feature declares no linked tests. Existing lead contract coverage focuses on create/update lead date payloads, not the convert-to-job body generated here.

suggested regression test:
Add a contract test for LeadsPostLeadsIdConvertToJobBody that accepts { job: { projectedStart: "2026-04-01" } }, rejects ISO timestamps, and confirms the parsed value remains a string.

minimum fix scope:
OpenAPI convert-to-job body date field definitions plus regenerated api-zod/api-client artifacts and one focused contract test.

## medium: Advertised video formats can bypass the server duration cap when MIME is generic

id: fnd_sig-feat-library-461ca32f43-5118_1edfff74e2
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: Node source lib/api-zod/src (feat_library_461ca32f43)

evidence:
- lib/api-zod/src/uploads.ts:17-23 (MAX_VIDEO_DURATION_SECONDS)
- lib/api-zod/src/uploads.ts:31-44 (VIDEO_UPLOAD_EXTENSIONS / isVideoUpload)
- lib/api-zod/src/uploads.ts:150-151 (WIDE_UPLOAD_ACCEPT_EXTENSIONS)

The shared upload policy advertises .wmv, .flv, and .3gp as uploadable video formats, and the duration-cap comment says the API server enforces the video duration limit for bypassed/non-browser clients. However, isVideoUpload only checks MIME video/* or the narrower VIDEO_UPLOAD_EXTENSIONS list, which omits .wmv, .flv, and .3gp. A non-browser upload using application/octet-stream or no MIME for one of those accepted video extensions will not be probed, so an over-limit video can pass the server-side duration gate despite being in the product's accepted video set.

recommendation:
Make the duration-detection extension set cover every video extension in WIDE_UPLOAD_ACCEPT_EXTENSIONS, or split the accept list so unsupported video containers are not advertised as accepted videos. Prefer reusing one shared video-extension source for both accept generation and server duration detection.

test analysis:
The existing upload-video-duration tests cover extension-based detection for .mp4 with application/octet-stream, but they do not assert parity between the accepted video extension list and VIDEO_UPLOAD_EXTENSIONS, nor do they cover .wmv, .flv, or .3gp with missing/generic MIME.

suggested regression test:
Add a test that iterates the video entries advertised in WIDE_UPLOAD_ACCEPT_EXTENSIONS and asserts isVideoUpload(`clip${ext}`, "application/octet-stream") is true for each duration-capped video format, including .wmv, .flv, and .3gp.

minimum fix scope:
Update lib/api-zod/src/uploads.ts so video accept-list entries and isVideoUpload extension detection cannot drift, then add focused coverage in the upload duration tests.

repro:
Call isVideoUpload("long.wmv", "application/octet-stream") or isVideoUpload("long.flv", null); both return false even though WIDE_UPLOAD_ACCEPT_EXTENSIONS advertises those extensions as videos.

## medium: Boolean query strings parse `false` as `true`

id: fnd_sig-feat-library-4b062eff9f-1a9a_ca094bc88b
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: Node source lib/api-zod/src/generated (feat_library_4b062eff9f)

evidence:
- lib/api-zod/src/generated/api.ts:225-229 (UsersGetUsersQueryParams)
- lib/api-zod/src/generated/api.ts:3687-3690 (FilesGetFoldersIdFilesQueryParams)
- lib/api-zod/src/generated/api.ts:5307-5308 (DailyLogsGetDailyLogsFeedQueryParams)

Zod's boolean coercion follows JavaScript truthiness, so the HTTP query string value "false" parses to true. These schemas describe conventional boolean query flags where false should remain false, but generated validation will invert explicit false values for inactive users, soft-deleted files, and daily-log filters.

recommendation:
Generate boolean query schemas from an explicit string boolean parser, such as zod.enum(["true", "false"]).transform(v => v === "true"), or a shared helper that also accepts actual booleans if internal callers need them.

test analysis:
No linked tests were provided for the generated api-zod query schemas, and this file is generated, so endpoint tests may not exercise the exported schema behavior directly.

suggested regression test:
Add api-zod tests proving each generated boolean query parameter parses "true" to true and "false" to false, especially includeInactive, includeDeleted, hasAttachments, and hasComments.

minimum fix scope:
Update the OpenAPI-to-Zod generation path or post-generation transform for boolean query parameters, then regenerate lib/api-zod/src/generated/api.ts.

repro:
UsersGetUsersQueryParams.parse({ includeInactive: "false" }).includeInactive returns true; FilesGetFoldersIdFilesQueryParams.parse({ includeDeleted: "false" }).includeDeleted also returns true.

## medium: Date query filters reject documented URL string values

id: fnd_sig-feat-library-4b062eff9f-a158_96a64338ef
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: Node source lib/api-zod/src/generated (feat_library_4b062eff9f)

evidence:
- lib/api-zod/src/generated/api.ts:3903-3910 (DailyLogsGetJobsJobIdDailyLogsQueryParams)
- lib/api-zod/src/generated/api.ts:5305-5306 (DailyLogsGetDailyLogsFeedQueryParams)
- lib/api-zod/src/generated/api.ts:8251-8261 (DashboardGetDashboardScheduleQueryParams)

These are query-parameter schemas, and their own descriptions document YYYY-MM-DD URL values. zod.date() only accepts Date instances, so ordinary request query strings like `from=2026-05-01` or `start=2026-05-01` fail validation instead of parsing as the documented API contract implies.

recommendation:
Generate query date parameters as string schemas with the documented YYYY-MM-DD regex, or use zod.coerce.date() only if the public contract is intended to accept full date-time coercion semantics.

test analysis:
No linked tests were provided for these generated query schemas; endpoint tests may use server-local validators rather than importing api-zod.

suggested regression test:
Add api-zod tests that parse documented YYYY-MM-DD strings for daily log and dashboard schedule query filters, and reject malformed date strings.

minimum fix scope:
Adjust the OpenAPI date query generation rule and regenerate lib/api-zod/src/generated/api.ts.

repro:
DailyLogsGetJobsJobIdDailyLogsQueryParams.safeParse({ from: "2026-05-01" }) fails even though the field description says YYYY-MM-DD; DashboardGetDashboardScheduleQueryParams.safeParse({ start: "2026-05-01" }) fails for the same reason.

## medium: Older folder/file load responses can overwrite the active folder view

id: fnd_sig-feat-library-4c86d30c10-095d_74f1cce46a
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/cadstone/src/components (feat_library_4c86d30c10)

evidence:
- artifacts/cadstone/src/components/FileBrowser.tsx:340-363 (loadFolders)
- artifacts/cadstone/src/components/FileBrowser.tsx:366-376 (loadFiles)
- artifacts/cadstone/src/components/FileBrowser.tsx:431-443 (openFolder/navigateTo)

The component issues folder and file requests on navigation without cancellation, request sequencing, or checking that the response still matches the current job/folder. If a slower response for an older folder resolves after a faster response for the newly selected folder, it can replace folders/currentFolder/breadcrumb/files with stale data while currentFolderId points elsewhere. That can show the wrong file metadata under the wrong folder and make subsequent actions operate against inconsistent UI state.

recommendation:
Track a request id or AbortController per folder/file load and ignore responses that are not for the latest jobId/mediaType/scope/currentFolderId. Apply the same stale-response guard to loadFolders and loadFiles.

test analysis:
The included tests do not mount FileBrowser or simulate out-of-order API responses; they focus on ErrorBoundary, RoleGate, and PDF annotation utility behavior.

suggested regression test:
Add a FileBrowser test with deferred api.get promises for two folder navigations, resolve the second request first and the first request last, and assert the UI still shows the second folder's files and breadcrumb.

minimum fix scope:
artifacts/cadstone/src/components/FileBrowser.tsx: add stale-response protection around loadFolders/loadFiles and their navigation callers.

repro:
Throttle the network, open folder A, immediately open folder B, and let A's files/folders response resolve last. The rendered list can revert to A's response while the selected folder remains B.

## medium: Drag-and-drop uploads can use a stale folder id after navigating between folders

id: fnd_sig-feat-library-4c86d30c10-8c57_c62ac0219c
category: data-loss
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/cadstone/src/components (feat_library_4c86d30c10)

evidence:
- artifacts/cadstone/src/components/FileBrowser.tsx:822-859 (uploadFilesImmediately)
- artifacts/cadstone/src/components/FileBrowser.tsx:895-919 (onDrop)
- artifacts/cadstone/src/components/FileBrowser.tsx:922-927 (useDropzone)

The drop handler is memoized without depending on currentFolderId, isResourceScope, or uploadFilesImmediately. If the user opens folder A and then opens folder B where canUploadFiles remains true, React can keep the old onDrop closure. A drag/drop on B then calls an uploadFilesImmediately closure that builds the upload URL with A's folder id, silently filing the new upload in the previous folder.

recommendation:
Make the drop callback depend on the actual upload target, either by adding currentFolderId/isResourceScope/uploadFilesImmediately to the dependency list and memoizing uploadFilesImmediately with complete dependencies, or by passing the target folder id explicitly into a stable upload helper.

test analysis:
The included tests cover ErrorBoundary, RoleGate, and PDF annotation helpers only; there is no FileBrowser drag/drop test or hook-level test that changes folders between drops.

suggested regression test:
Add a FileBrowser test that mocks useDropzone/api, renders two upload-enabled folders, opens folder A then folder B, triggers the retained onDrop, and asserts the upload URL contains folder B's id.

minimum fix scope:
artifacts/cadstone/src/components/FileBrowser.tsx: fix drop/upload callback dependencies and preserve the single-upload behavior.

repro:
Open an upload-enabled folder, navigate directly to another upload-enabled folder in the same media type/scope, then drag files into the dropzone. The retained callback can post to the previous folder URL.

## medium: A second upload can start before the first upload is registered

id: fnd_sig-feat-library-4c86d30c10-abf1_8178e8c433
category: concurrency
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/cadstone/src/components (feat_library_4c86d30c10)

evidence:
- artifacts/cadstone/src/components/FileBrowser.tsx:537-565 (handleUploadSelection)
- artifacts/cadstone/src/components/FileBrowser.tsx:822-843 (uploadFilesImmediately)
- artifacts/cadstone/src/components/FileBrowser.tsx:895-917 (onDrop)

The guard checks uploadTask before async validation/probing, but uploadFilesImmediately does not set uploadTask until after probeVideoDurations completes. During that window another file selection or drop also sees uploadTask as null and can start a second upload. Because the component stores only one uploadTask, the later task overwrites progress/cancel state and either upload can clear the shared state while the other is still running.

recommendation:
Reserve the upload slot before asynchronous validation/probing or introduce a separate synchronous pending flag/ref that is set before awaiting. Ensure only the owning task can clear the shared task state in finally.

test analysis:
No included test exercises FileBrowser uploads, async video-duration probing, or multiple upload starts in quick succession.

suggested regression test:
Add a FileBrowser upload test with a deferred probeVideoDurations mock, trigger two upload starts before resolving the first probe, and assert only one uploadWithProgress call is made and the second attempt receives the wait/cancel message.

minimum fix scope:
artifacts/cadstone/src/components/FileBrowser.tsx: close the pre-upload async race for both file input and dropzone paths.

repro:
Start an instant upload with video files that take time to probe, then quickly select/drop another valid batch before the first call reaches setUploadTask.

## medium: Date-only query parameters are typed as Date objects

id: fnd_sig-feat-library-4f00ff98b1-4d6e_ed80283f1b
category: api-contract
confidence: medium
triage: contract-mismatch
status: open
feature: Node source lib/api-zod/src/generated/types#7 (feat_library_4f00ff98b1)

evidence:
- lib/api-zod/src/generated/types/dailyLogsGetJobsJobIdDailyLogsParams.ts:31-38 (DailyLogsGetJobsJobIdDailyLogsParams)
- lib/api-zod/src/generated/types/dashboardGetDashboardScheduleParams.ts:10-17 (DashboardGetDashboardScheduleParams)
- lib/api-zod/src/generated/types/dailyLogsGetDailyLogsFeedParams.ts:29-30 (DailyLogsGetDailyLogsFeedParams)

The generated parameter types describe date-only wire values as Date objects even where the comments state the API contract is YYYY-MM-DD. This makes the generated TypeScript contract reject the documented string form and encourages callers to pass Date instances, which common query serializers may encode as full ISO timestamps rather than date-only strings. That can produce server-side validation failures or timezone-dependent off-by-one date filters.

recommendation:
Fix the OpenAPI/codegen configuration so date-only query parameters generate as string types constrained/documented as YYYY-MM-DD, then regenerate the API zod/client artifacts rather than hand-editing generated files.

test analysis:
The feature lists no linked tests, and type-only generated artifacts are not covered by an assertion that date-format query params stay string-compatible.

suggested regression test:
Add a codegen drift/type assertion that the generated daily-log and dashboard schedule query param types accept YYYY-MM-DD strings and do not require Date instances.

minimum fix scope:
Update the API spec or orval type override for date-format query parameters and regenerate lib/api-zod/src/generated plus any sibling generated clients that share the same contract.

## medium: Concurrent notification toggles can overwrite each other

id: fnd_sig-feat-library-4f51d3f46f-112c_ae7fd70bdf
category: concurrency
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/cadstone/src/pages/settings (feat_library_4f51d3f46f)

evidence:
- artifacts/cadstone/src/pages/settings/NotificationsSection.tsx:94-102 (handleToggle)
- artifacts/cadstone/src/pages/settings/NotificationsSection.tsx:136-162 (NotificationsSection)

Each toggle sends only the changed key but replaces the whole local prefs object with the response. The UI only disables the switch whose key is currently in savingKey, so a user can toggle a second notification while the first request is still pending. If the responses resolve out of order, the later setPrefs(result.prefs) call can revert another in-flight toggle in the UI, and the user receives success toasts even though one visible preference may be stale or lost until a full reload/refetch.

recommendation:
Either serialize notification preference saves, disable all switches while any save is pending, or merge each successful response/key into the current local state while guarding against stale responses. Prefer invalidating/refetching the notification prefs query after successful mutations if the server response is authoritative.

test analysis:
The feature declares no linked tests, and there is no component test exercising multiple in-flight notification preference updates.

suggested regression test:
Add a NotificationsSection component test that stubs useUsersPutUsersMeNotificationPrefs with two deferred mutateAsync calls, toggles two different switches before resolving either request, resolves them out of order, and asserts the final checked state preserves both changes or that the second switch was disabled while the first save was pending.

minimum fix scope:
artifacts/cadstone/src/pages/settings/NotificationsSection.tsx

repro:
Open Settings > Notifications, quickly toggle two different notification switches before the first save completes, and resolve the two PUT requests out of order. The final rendered prefs can match the older response rather than both user changes.

## medium: Context menu max-height class does not dereference the Radix CSS variable

id: fnd_sig-feat-library-56213b531e-87ea_1fb6d2a604
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/cadstone/src/components/ui#2 (feat_library_56213b531e)

evidence:
- artifacts/cadstone/src/components/ui/context-menu.tsx:63 (ContextMenuContent)
- artifacts/cadstone/src/components/ui/dropdown-menu.tsx:66 (DropdownMenuContent)

The context menu content intends to cap height using Radix's available-height variable, but the Tailwind arbitrary value omits `var(...)`. That produces an invalid max-height value, so long context menus are not constrained to the viewport and can render off-screen instead of scrolling. The sibling dropdown menu uses the correct `max-h-[var(--...)]` form for the same Radix pattern.

recommendation:
Change the class to `max-h-[var(--radix-context-menu-content-available-height)]`.

test analysis:
The feature lists no tests, and there are no linked component or visual tests that open an oversized ContextMenu and assert viewport-constrained scrolling.

suggested regression test:
Add a component/e2e test that opens a ContextMenu with many items near the viewport edge and asserts the content height is at or below the Radix available height and has vertical scrolling.

minimum fix scope:
Update the max-height class in artifacts/cadstone/src/components/ui/context-menu.tsx.

repro:
Open a ContextMenu with enough items near the bottom of the viewport; the content can exceed the available viewport height instead of using the Radix available-height constraint and scrolling.

## low: InputGroupAddon cannot focus textarea controls

id: fnd_sig-feat-library-56213b531e-8fdc_32f496a592
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/cadstone/src/components/ui#2 (feat_library_56213b531e)

evidence:
- artifacts/cadstone/src/components/ui/input-group.tsx:69-74 (InputGroupAddon)
- artifacts/cadstone/src/components/ui/input-group.tsx:145-156 (InputGroupTextarea)

The component set supports both InputGroupInput and InputGroupTextarea, but addon clicks only search for an `input`. In textarea groups, clicking the addon label/icon/text does nothing instead of focusing the actual control, creating inconsistent behavior in a shared input wrapper.

recommendation:
Focus the shared control by data slot, for example `querySelector('[data-slot="input-group-control"]')`, and type-narrow to HTMLElement before calling focus.

test analysis:
The feature lists no tests, and there are no linked interaction tests for InputGroupAddon with either input or textarea controls.

suggested regression test:
Add a component test that renders InputGroupAddon with InputGroupTextarea, clicks the addon, and asserts the textarea is focused.

minimum fix scope:
Update the focus selector in artifacts/cadstone/src/components/ui/input-group.tsx.

repro:
Render `<InputGroup><InputGroupAddon>Notes</InputGroupAddon><InputGroupTextarea /></InputGroup>` and click the addon; focus remains outside the textarea.

## medium: CommandDialog renders an unlabeled Radix dialog

id: fnd_sig-feat-library-56213b531e-e888_8996d32ec8
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/cadstone/src/components/ui#2 (feat_library_56213b531e)

evidence:
- artifacts/cadstone/src/components/ui/command.tsx:7 (CommandDialog)
- artifacts/cadstone/src/components/ui/command.tsx:24-31 (CommandDialog)

Radix Dialog content requires an accessible title. CommandDialog does not render DialogTitle, does not import it, and its public props are Dialog root props rather than DialogContent props, so callers cannot add an aria-label to the content through this wrapper. Screen-reader users get an unlabeled dialog and Radix will warn at runtime.

recommendation:
Import `DialogTitle` and render an sr-only title inside `DialogContent`, or extend CommandDialog's API to require/provide an accessible title on the content.

test analysis:
The feature lists no tests, and there are no accessibility tests asserting that CommandDialog content has an accessible name.

suggested regression test:
Add a React Testing Library or Playwright accessibility check that renders CommandDialog and verifies the dialog role has an accessible name.

minimum fix scope:
Update CommandDialog in artifacts/cadstone/src/components/ui/command.tsx to provide a hidden title or a required accessible title prop.

repro:
Render `<CommandDialog open>` with a typical CommandInput/List child set; the dialog content has no accessible name and Radix emits its missing-title warning.

## high: New UI modules reference the React namespace without importing it

id: fnd_sig-feat-library-56213b531e-ec2c_8b2271652f
category: build-release
confidence: high
triage: risk
status: open
feature: Node source artifacts/cadstone/src/components/ui#2 (feat_library_56213b531e)

evidence:
- artifacts/cadstone/src/components/ui/empty.tsx:1-5 (Empty)
- artifacts/cadstone/src/components/ui/field.tsx:1-8 (FieldSet)
- artifacts/cadstone/package.json:10 (scripts.typecheck)

Both empty.tsx and field.tsx use React.ComponentProps / React.ReactNode type names, but empty.tsx has no React import and field.tsx only imports the useMemo binding. Under this package's TypeScript typecheck, those module-scoped React namespace references are unresolved unless React is imported as a namespace or the specific types are imported. This makes the cadstone typecheck fail when these files are included.

recommendation:
Add `import type * as React from "react"` to empty.tsx and change field.tsx to either `import * as React from "react"` or import the exact React types while keeping `useMemo`.

test analysis:
The feature lists no tests, and the package test script only runs `src/**/*.test.ts`; there are no linked tests for these component modules or their type-only exports.

suggested regression test:
Keep `pnpm --filter @workspace/cadstone typecheck` in CI for this package; no runtime test is needed for this compile-only regression.

minimum fix scope:
Update the React type imports in artifacts/cadstone/src/components/ui/empty.tsx and artifacts/cadstone/src/components/ui/field.tsx.

repro:
Run `pnpm --filter @workspace/cadstone typecheck`; TypeScript reports unresolved React namespace references in these files.

## medium: Generated pagination contracts disagree with runtime page/cursor behavior

id: fnd_sig-feat-library-5a3253952c-f9f7_aa914fab1a
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: Node source lib/api-zod/src/generated/types#14 (feat_library_5a3253952c)

evidence:
- lib/api-zod/src/generated/types/leadsGetLeadsParams.ts:46-50 (LeadsGetLeadsParams.cursor)
- lib/api-zod/src/generated/types/myDailyLogsResponse.ts:11-12 (MyDailyLogsResponse)
- lib/api-zod/src/generated/types/myDailyLogsResponsePagination.ts:10-18 (MyDailyLogsResponsePagination)

The generated types/docs tell clients that `?limit=N` without `cursor` enters cursor mode, and the daily-logs page-mode pagination type requires `limit` and `total`. Cross-checking the runtime cursor helper and `/daily-logs/mine` handler shows cursor mode is selected only by the presence of the `cursor` query key, while limit-only requests stay in page mode and the page-mode response contains `page`, `pageSize`, `totalItems`, and `totalPages` only. Clients generated from this contract can branch into cursor pagination incorrectly or reject/use fields that are absent at runtime.

recommendation:
Fix the OpenAPI source for shared cursor parameter descriptions and `MyDailyLogsResponse.pagination` so limit-only requests are documented as page mode and the offset branch only requires fields actually returned by the handler, then regenerate `lib/api-zod/src/generated`.

test analysis:
No linked tests are included for this generated source group. Existing runtime-oriented coverage can validate the handler/helper behavior while still allowing generated API artifacts to drift from that behavior.

suggested regression test:
Add a contract/codegen test that asserts `GET /daily-logs/mine?limit=N` is documented/generated as page-mode unless `cursor` is present, and that `MyDailyLogsResponsePagination`'s offset branch does not require `limit` or `total`.

minimum fix scope:
Update `lib/api-spec/openapi.yaml` pagination descriptions/schema for affected endpoints/components and regenerate the generated API Zod types.

repro:
Call `GET /api/daily-logs/mine?limit=10` without a `cursor` query key. The generated docs describe a `CursorPagination` response, but runtime behavior is page mode; the generated page-mode type also requires `limit` and `total` that the handler does not send.

## medium: Reservation and lookup failures silently disable idempotency for keyed writes

id: fnd_sig-feat-library-5a414a283a-3dc1_e54f0da0b0
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: Node source artifacts/api-server/src/middleware (feat_library_5a414a283a)

evidence:
- artifacts/api-server/src/middleware/idempotency.ts:216-219 (applyIdempotency)
- artifacts/api-server/src/middleware/idempotency.ts:245-248 (applyIdempotency)

A request that supplies a valid Idempotency-Key can still proceed after the middleware fails to reserve or look up its idempotency record. During a transient database error, two client retries can both execute the protected write because neither failure is surfaced to the client. For a feature whose purpose is duplicate-write prevention, failing open makes the API contract unreliable exactly when clients are retrying.

recommendation:
Fail closed for keyed write requests when reservation or lookup cannot be completed, for example by returning a 503/500 HttpError and asking the client to retry later.

test analysis:
No linked tests were included, and there is no included evidence of error-path assertions for idempotency store failures.

suggested regression test:
Mock the idempotency insert and lookup calls to reject and assert the downstream write handler is not invoked and the client receives an error response.

minimum fix scope:
Change applyIdempotency's reservation and lookup catch blocks to pass an error to next() instead of continuing unprotected.

repro:
Make db.insert(idempotencyKeys) reject for a POST with Idempotency-Key, then observe that the downstream handler still runs. Repeat the same request while the store is unavailable and the write can run multiple times.

## medium: Expired idempotency rows let the current retry run without a new reservation

id: fnd_sig-feat-library-5a414a283a-5860_9377fc2aa4
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: Node source artifacts/api-server/src/middleware (feat_library_5a414a283a)

evidence:
- artifacts/api-server/src/middleware/idempotency.ts:258-276 (applyIdempotency)

When a retry finds an expired idempotency row, the middleware deletes the row and immediately calls next() instead of reserving a fresh row for the current request. That current write then executes without replay protection and without persisting its response. A later retry with the same key can reserve a new row and execute the side effect again, which violates the idempotency-key contract for the first post-expiry retry.

recommendation:
After deleting an expired row, retry the reservation path in the same request or perform an atomic delete-and-insert/UPSERT that installs a new pending reservation before calling next().

test analysis:
No linked tests were included for this feature, and the stale-row branch has no evidence of coverage.

suggested regression test:
Seed an expired idempotency row, issue a write with the same key, assert the request creates a fresh pending/completed idempotency record, then assert a second identical request replays instead of executing the handler again.

minimum fix scope:
Update applyIdempotency's expired-row branch to re-reserve before continuing, and cover the expired-key retry path.

repro:
Create an expired idempotency_keys row for a valid write request, send that write with the same key, then send it again. The first request after expiry deletes the row and proceeds uncached; the second request sees no completed record and can execute again.

## low: Multipart idempotency fingerprints are ambiguous because fields are concatenated without framing

id: fnd_sig-feat-library-5a414a283a-9ed4_d2166cebe9
category: bug
confidence: medium
triage: risk
status: open
feature: Node source artifacts/api-server/src/middleware (feat_library_5a414a283a)

evidence:
- artifacts/api-server/src/middleware/idempotency.ts:66-70 (hashMultipartRequest)
- artifacts/api-server/src/middleware/idempotency.ts:91-94 (hashMultipartRequest)

The multipart hash uses ad hoc delimiters between attacker-controlled field names, field values, original filenames, and MIME metadata. Because those values are not length-prefixed or structurally encoded, distinct multipart requests can serialize to the same byte stream, for example by moving '=' or '|' characters between adjacent components. That can make a changed upload look like the same request and cause a replay instead of the intended 409 conflict.

recommendation:
Hash a canonical structured encoding with explicit lengths, or update each component separately with length prefixes and unambiguous type tags.

test analysis:
No linked tests were included, and the current implementation has no included collision-focused multipart fingerprint tests.

suggested regression test:
Add unit tests for hashMultipartRequest proving delimiter-bearing field names, field values, and filenames produce different hashes when the parsed multipart structure differs.

minimum fix scope:
Replace delimiter concatenation in hashMultipartRequest with length-prefixed or JSON-array canonical encoding for both fields and file metadata.

repro:
Construct two multipart bodies whose parsed field tuples serialize identically, such as one field named 'a=b' with value 'c' and another field named 'a' with value 'b=c'. Both feed the same string into the hash for that field slot.

## high: Unencoded path parameters allow MCP tools to escape their documented API routes

id: fnd_sig-feat-library-5b7b13a416-6c99_63e0df4591
category: security
confidence: high
triage: confirmed-bug
status: open
feature: Node source lib/mcp-server (feat_library_5b7b13a416)

evidence:
- lib/mcp-server/src/tools.ts:14 (idString)
- lib/mcp-server/src/tools.ts:153-157 (get_job)
- lib/mcp-server/src/tools.ts:1158-1175 (request)
- lib/mcp-server/src/api-client.ts:159-161 (ApiClient.buildUrl)

Tool path parameters are accepted as any non-empty string and interpolated into URL paths without encodeURIComponent or dot-segment rejection. Fetch/WHATWG URL resolution normalizes dot segments, so a call such as get_job with id '../users/me' resolves to /api/users/me instead of the documented /api/jobs/:id route while still being surfaced and audited as get_job. This undermines the MCP and in-app agent tool allowlist; the raw request tool also claims paths are under /api but can resolve outside that prefix with '/../...'. API authorization still applies, but the route boundary enforced by the tool layer is bypassable.

recommendation:
Encode every path segment before interpolation, tighten ID schemas to UUIDs where the REST route expects UUIDs, and reject path parameters containing slash, backslash, dot segments, or encoded separators. For the raw request tool, resolve with the URL API and reject any normalized pathname that does not start with /api/.

test analysis:
The feature declares no linked tests, and the mcp-server typecheck only verifies TypeScript types; it does not assert resolved fetch URLs for hostile path parameters.

suggested regression test:
Add mcp-server tests that call representative tools with ids like '../users/me' and '%2e%2e/users/me' and assert the request is rejected or encoded as a literal segment, plus a raw request test that rejects paths resolving outside /api/.

minimum fix scope:
Update ApiClient URL construction and all MCP tool path-parameter handling/schemas that interpolate caller-provided values into paths.

repro:
Invoke the get_job tool handler with {"id":"../users/me"} using a fetchImpl that records its URL; the recorded request resolves to http://<base>/api/users/me rather than a jobs endpoint.

## medium: Malformed base64 can be silently accepted and uploaded as corrupted file content

id: fnd_sig-feat-library-5b7b13a416-c1f9_4dd387c2d6
category: data-loss
confidence: high
triage: confirmed-bug
status: open
feature: Node source lib/mcp-server (feat_library_5b7b13a416)

evidence:
- lib/mcp-server/src/tools.ts:982-990 (attach_file)
- lib/mcp-server/src/tools.ts:993-1006 (attach_file)

Node Buffer.from(..., 'base64') is permissive: it ignores some invalid characters and can decode malformed strings without throwing. The try/catch therefore does not reliably detect invalid contentBase64. A caller can provide malformed input that decodes to truncated or garbage bytes and the tool will upload it as a successful file attachment, corrupting the stored file instead of failing loudly.

recommendation:
Validate base64 strictly before upload. Strip allowed whitespace if desired, reject invalid characters and impossible padding, then round-trip compare the canonical base64 encoding of the decoded buffer to the normalized input before constructing FormData.

test analysis:
The feature declares no linked tests, and typechecking cannot catch Buffer.from's permissive runtime decoding behavior.

suggested regression test:
Add attach_file unit tests with invalid base64, base64 with trailing junk, and valid padded/unpadded base64; assert invalid inputs return ApiError 400 and no multipart request is sent.

minimum fix scope:
Change attach_file contentBase64 validation in lib/mcp-server/src/tools.ts and add focused tests for the validation branch.

repro:
Call attach_file with contentBase64 such as 'not valid base64' or 'aGVsbG8=not-base64'; Buffer.from(..., 'base64') returns bytes without throwing, so the tool proceeds to upload those bytes.

## medium: Client money response types are generated as bigint while the client API uses JSON numbers

id: fnd_sig-feat-library-5dd87f7c99-7fa3_7b2eab6318
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: Node source lib/api-zod/src/generated/types#3 (feat_library_5dd87f7c99)

evidence:
- lib/api-zod/src/generated/types/clientListItem.ts:49-59 (ClientListItem)
- lib/api-zod/src/generated/types/clientDetailRollups.ts:13-18 (ClientDetailRollups)

These exported DTO types are part of @workspace/api-zod via package export of generated/types. The corresponding client list/detail response schemas and the frontend API client treat these rollup fields as numbers, and JSON responses cannot carry bigint values. Consumers importing ClientListItem or ClientDetailRollups from @workspace/api-zod will be told to handle bigint even though the parsed/runtime response contains numbers, which can cause type errors and incorrect arithmetic/formatting assumptions around money fields.

recommendation:
Fix the OpenAPI/codegen source so client list and client detail rollup money fields generate as bounded safe integer numbers, not bigint, then regenerate instead of hand-editing these generated files. This likely means replacing int64-style schema for these client response rollups with the same safe-integer number convention already used for job money payloads.

test analysis:
No linked tests are included for this source group. Existing contract coverage found in the repo focuses on jobs/leads request payload drift; it does not assert the generated client list/detail response money DTOs remain number typed.

suggested regression test:
Add a clients contract/codegen test that validates ClientsGetClientsResponse and ClientsGetClientsIdResponse accept safe integer money values and preserve them as JavaScript numbers, plus a compile-time assertion that ClientListItem and ClientDetailRollups are assignable from number-valued money fields.

minimum fix scope:
Update the API spec/codegen configuration for ClientListItem and ClientDetailRollups money fields, regenerate lib/api-zod and related generated clients, and add focused clients response contract coverage.

## medium: Per-file swaps can expose an inconsistent generated API tree to concurrent builds

id: fnd_sig-feat-library-5f56a5af57-3a9a_4420a1a5a1
category: concurrency
confidence: medium
triage: risk
status: open
feature: Node source lib/api-spec (feat_library_5f56a5af57)

evidence:
- lib/api-spec/orval.config.ts:33-36
- lib/api-spec/orval.config.ts:59-62
- lib/api-spec/scripts/codegen.mjs:193-200 (replaceFilesAtomically)
- lib/api-spec/scripts/codegen.mjs:219-249 (replaceFilesAtomically)

The generated output is split across multiple related files, but replaceFilesAtomically publishes them one at a time into the live `generated/` directory. During the replacement loop, a concurrent typecheck or bundle can observe a mixed old/new graph: for example, a newly moved file can import or re-export a companion file that has not been moved yet, or stale deletion can remove a file while another observed file still references it. Atomic per-file renames prevent torn individual files, but they do not provide a consistent snapshot of the generated module graph.

recommendation:
Publish generated output as a whole-tree snapshot rather than a visible sequence of independent file replacements. Practical options are to use a versioned generated directory with an atomic symlink or pointer swap, or serialize codegen against builds/checks with a lock. If per-file replacement is retained, keep readers from using the live tree until all dependent files are present and stale files are handled safely.

test analysis:
The feature lists no linked tests, and there is no owned test covering readers that compile or resolve imports while `replaceFilesAtomically` is midway through publishing a split Orval output tree.

suggested regression test:
Add a test harness around `replaceFilesAtomically` with a fake split generated tree and a hook between renames that attempts to resolve or typecheck the live generated directory, asserting no inconsistent old/new import graph is observable.

minimum fix scope:
Revise the publication strategy in `lib/api-spec/scripts/codegen.mjs` and add a targeted concurrent-reader regression test.

repro:
Generate a staged output where one generated file imports a newly added companion file. During `replaceFilesAtomically`, run a TypeScript build after the importing file has been renamed into `generated/` but before the companion file is renamed. The build can fail with a missing module or missing export even though each individual file write was atomic.

## medium: Concurrent codegen runs can delete each other's staging output

id: fnd_sig-feat-library-5f56a5af57-e144_f35a7714d8
category: concurrency
confidence: high
triage: confirmed-bug
status: open
feature: Node source lib/api-spec (feat_library_5f56a5af57)

evidence:
- lib/api-spec/scripts/codegen.mjs:72-90 (cleanupStrayDirs)
- lib/api-spec/scripts/codegen.mjs:252-255
- lib/api-spec/scripts/codegen.mjs:272-276

Each run gets its own pid-based staging directory, but cleanupStrayDirs removes every directory under the target parents whose name starts with the staging prefix, not just stale directories owned by the current process. A second codegen process started while the first is still generating can delete the first process's active staging tree; a failing process can also delete another active process's staging tree in the catch block. That makes the concurrency hardening unreliable and can cause failed or partially applied codegen runs.

recommendation:
Do not globally delete all staging-prefixed directories during an active run. Use a lock file around codegen, or only clean directories proven stale by age plus absence of a live owner process. On failure, remove only this run's own staging directory.

test analysis:
The feature lists no linked tests, and the owned files do not include a regression test that starts overlapping codegen processes or exercises cleanup during another active run.

suggested regression test:
Add a codegen helper test that creates two fake staging directories, marks one as active, invokes cleanup for the other run, and asserts the active directory is preserved; ideally also cover overlapping codegen invocations with a mocked orval step.

minimum fix scope:
Change `cleanupStrayDirs` ownership semantics in `lib/api-spec/scripts/codegen.mjs` and add a focused concurrency regression test.

repro:
Start two `pnpm --filter @workspace/api-spec run codegen` processes so the second enters cleanup after the first has created `lib/api-client-react/src/__codegen_staging_<pid>` or `lib/api-zod/src/__codegen_staging_<pid>`. The second removes the first staging directory, causing the first run to fail when post-codegen or replacement expects its staging files.

## medium: Audit hook failures turn successful tool side effects into client-visible tool errors

id: fnd_sig-feat-library-606f122189-0cac_094657e636
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: Node source lib/mcp-server/src (feat_library_606f122189)

evidence:
- lib/mcp-server/src/server.ts:72-83 (createCadstoneMcpServer)
- lib/mcp-server/src/server.ts:84-95 (createCadstoneMcpServer)
- lib/mcp-server/src/server.ts:127-156 (createCadstoneMcpServer)

The tool handler awaits auditHook after def.handler has already completed, but inside the same try block. If auditHook rejects, the catch path returns toToolError even though the underlying API request may already have created, updated, or deleted data. Resource reads have the same issue: content is fetched, then an audit failure is rethrown as a resource failure. This can mislead MCP clients into retrying non-idempotent writes and producing duplicates or inconsistent user feedback.

recommendation:
Isolate auditHook execution from tool/resource outcomes. Wrap audit calls in their own try/catch, log or otherwise surface audit telemetry separately, and never replace a successful tool result with an audit failure. For write tools, preserve the existing API result once the API call succeeds.

test analysis:
The existing MCP round-trip test covers successful audit rows and the stdio hook's internal error handling, but it does not inject a rejecting ToolAuditHook after a successful tool handler.

suggested regression test:
Add a server-level test with a fake tool or fetch-backed write and an auditHook that rejects; assert the tool result remains successful and the audit failure does not change the MCP response.

minimum fix scope:
lib/mcp-server/src/server.ts audit handling around registered tools and resources.

repro:
Create a server with a tool auditHook that throws, call create_lead through MCP, and observe that the REST write can complete while the tool result is returned as isError from the audit exception.

## medium: Malformed base64 can be silently uploaded as corrupt file content

id: fnd_sig-feat-library-606f122189-2c64_add1acdf09
category: data-loss
confidence: high
triage: confirmed-bug
status: open
feature: Node source lib/mcp-server/src (feat_library_606f122189)

evidence:
- lib/mcp-server/src/tools.ts:967-987 (attach_file)
- lib/mcp-server/src/tools.ts:989-1006 (attach_file)

The attach_file tool relies on Buffer.from(value, "base64") throwing for invalid base64, but Node's base64 decoder is permissive and silently ignores or decodes malformed characters. A value such as "not base64!" produces non-empty bytes, passes the zero-length guard, and is uploaded through requestMultipart, so callers can receive a successful file attachment containing corrupted bytes instead of a validation error.

recommendation:
Validate contentBase64 before decoding, for example by enforcing a canonical base64/base64url regex plus padding rules, decoding, then re-encoding and comparing normalized values before constructing FormData.

test analysis:
The MCP round-trip test only asserts that attach_file is listed in the tool surface; it does not call attach_file with invalid or valid file content.

suggested regression test:
Add a direct handler test for TOOL_DEFINITIONS.find(t => t.name === "attach_file") that passes malformed base64 and asserts an ApiError 400 is thrown before requestMultipart is called.

minimum fix scope:
lib/mcp-server/src/tools.ts attach_file validation, plus a focused MCP tool regression test.

repro:
Call attach_file with a valid folderId, filename, and mimeType, but contentBase64 set to "not base64!". Buffer.from decodes it to non-empty bytes and the handler proceeds to upload.

## medium: HTTP MCP disconnects do not abort in-flight REST fetches

id: fnd_sig-feat-library-606f122189-da21_50cf6d94e8
category: performance
confidence: medium
triage: risk
status: open
feature: Node source lib/mcp-server/src (feat_library_606f122189)

evidence:
- lib/mcp-server/src/api-client.ts:7-16 (ApiClientOptions)
- lib/mcp-server/src/api-client.ts:80-85 (ApiClient.request)
- lib/mcp-server/src/server.ts:6-13 (CreateCadstoneMcpServerOptions)
- lib/mcp-server/src/server.ts:40-47 (createCadstoneMcpServer)
- lib/mcp-server/src/http-transport.ts:100-111 (createMcpHttpHandler)

ApiClient already supports passing an AbortSignal into fetch, but CreateCadstoneMcpServerOptions has no signal field and createCadstoneMcpServer never forwards one. The HTTP transport close handler closes the transport and server when the client connection closes, but it does not abort the ApiClient fetch currently executing inside a tool handler. A slow REST/database-backed tool call can therefore continue after the MCP HTTP client disconnects, consuming server and database work for a response that cannot be delivered.

recommendation:
Create an AbortController per HTTP MCP request, abort it from the close handler, add signal to CreateCadstoneMcpServerOptions, and pass it into ApiClient. Ensure cleanup is idempotent so normal response close does not produce noisy errors.

test analysis:
The MCP round-trip test exercises normal client.close cleanup, but it does not simulate a dropped HTTP connection during a slow tool call or assert downstream fetch cancellation.

suggested regression test:
Add an HTTP transport test with a controllable fetchImpl that records the supplied signal; close the client connection while a tool call is pending and assert the signal is aborted.

minimum fix scope:
lib/mcp-server/src/http-transport.ts, lib/mcp-server/src/server.ts, and the CreateCadstoneMcpServerOptions type.

repro:
Use createMcpHttpHandler with a fetchImpl that does not resolve until signaled, start a tool call, close the HTTP response/request, and observe that fetchImpl never receives an AbortSignal abort event.

## high: Job PUT payloads omit AR cents and can erase contract/payment totals

id: fnd_sig-feat-library-6308651afe-11a3_6883195a96
category: data-loss
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/cadstone/src/pages#1 (feat_library_6308651afe)

evidence:
- artifacts/cadstone/src/pages/job-detail.tsx:230-256 (handleMarkComplete)
- artifacts/cadstone/src/pages/job-summary.tsx:383-404 (handleSave)
- artifacts/cadstone/src/pages/client-detail.tsx:459-466 (saveJobFields)

The job-detail code explicitly documents that PUT /jobs/:id replaces the whole record and missing fields become null, then builds a full replacement payload without contractValueCents or amountPaidCents. Job summary saves use the same generated PUT body and also omit those cents fields. Client detail preserves both fields when updating a job, which shows these fields are part of the intended replacement payload. Saving the job summary or marking a job complete can therefore wipe manually-entered AR totals and corrupt client/dashboard rollups.

recommendation:
Include contractValueCents and amountPaidCents in the hydrated Job type and every full PUT /jobs/:id payload, preserving the current API values unless the user is explicitly editing those fields. Alternatively replace these flows with a patch endpoint that only updates the changed fields.

test analysis:
The feature declares no linked tests, and the existing page code paths are not covered by a regression that seeds AR cents, performs an unrelated job save/complete action, and asserts the cents survive.

suggested regression test:
Add a frontend/API integration test that creates a job with contractValueCents and amountPaidCents, saves an unrelated field through the job summary and marks the job complete, then verifies both cents fields and client rollups remain unchanged except for status.

minimum fix scope:
Update job-detail.tsx and job-summary.tsx PUT payload construction, plus tests for preserving AR cents across non-financial job updates.

repro:
Set contractValueCents/amountPaidCents for a job from the client detail jobs table, then open the job summary and save any unrelated field or use Job actions -> Mark project complete. Reload the client detail rollups; the job's contract/paid values are cleared or no longer contribute.

## medium: Weather auto-fetch can save stale weather for the wrong date or job

id: fnd_sig-feat-library-6308651afe-7b47_8b44902865
category: concurrency
confidence: medium
triage: risk
status: open
feature: Node source artifacts/cadstone/src/pages#1 (feat_library_6308651afe)

evidence:
- artifacts/cadstone/src/pages/job-daily-logs.tsx:2705-2727 (DailyLogEditor weather effect)
- artifacts/cadstone/src/pages/job-daily-logs.tsx:2792-2798 (persist)

The weather effect debounces the request but does not cancel or guard the in-flight API call. If the user changes the date/job/address while an earlier /weather request is in flight, the earlier response can still call setValues and overwrite weatherData for the new current form state. The persist payload then sends values.weatherData without verifying it still matches the current jobId/logDate/address.

recommendation:
Track the request key (jobId, address, date) or use AbortController; only apply the response if it still matches the latest selected job/date/address, and ignore stale failures as well.

test analysis:
The feature declares no linked tests, and race ordering for delayed weather responses is not covered by the page code.

suggested regression test:
Add a component test with mocked delayed /weather responses where request A resolves after request B, then assert the saved payload contains only B's weatherData.

minimum fix scope:
Update the weather-fetch effect in job-daily-logs.tsx to cancel or ignore stale requests before setting weatherData or weatherMessage.

repro:
Open a daily log with weather enabled, change the log date or selected job twice quickly, and let the first slower weather request resolve after the second one. The form can display/save weatherData from the stale request.

## high: Removing an assignee does not revoke explicit folder grants

id: fnd_sig-feat-library-6308651afe-d2d4_d7b13d3df8
category: security
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/cadstone/src/pages#1 (feat_library_6308651afe)

evidence:
- artifacts/cadstone/src/pages/job-summary.tsx:173-188 (explicitFolderPermission)
- artifacts/cadstone/src/pages/job-summary.tsx:473-497 (saveFolderAccessDrafts)
- artifacts/cadstone/src/pages/job-summary.tsx:518-557 (handleSaveAssignees)

The page models permissions.users[userId] as an explicit per-user allow/deny that overrides broad role/internal access. handleSaveAssignees computes removed assignees and deletes the job assignment, but saveFolderAccessDrafts only iterates selectedAssignmentWorkers, so removed users are never written back as false or removed from folder viewing/uploading permission JSON. A worker who previously had an explicit folder allow can keep file access after being removed from the job.

recommendation:
When saving assignment changes, include toRemove users in folder permission updates and clear their explicit viewing/uploading entries or set them false for every non-global assignment folder before completing the removal. Prefer a server-side revoke in the assignee removal endpoint so all clients get the same guarantee.

test analysis:
The feature declares no linked tests, and there is no visible regression covering the security invariant that removing an assignee revokes per-user folder access.

suggested regression test:
Add an integration test that grants a user explicit folder access through the assignment UI/API, removes the user from the job, and verifies the folder ACL no longer allows that user to view or upload files.

minimum fix scope:
Update job-summary.tsx folder-access save logic, and ideally the job assignee DELETE API, to revoke explicit folder permissions for removed assignees.

repro:
Assign a worker to a job, grant them explicit view/upload access to a restricted job folder, save, then reopen assignment and remove that worker. Because the folder permission update only considers still-selected workers, the removed worker's permissions.users entry remains true.

## medium: Sentry PII filter skips obvious secret-bearing fields

id: fnd_sig-feat-library-6313510ad6-1fd0_bb182d3670
category: security
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/cadstone/src/lib#2 (feat_library_6313510ad6)

evidence:
- artifacts/cadstone/src/lib/sentry.ts:37-39 (eventContainsPii)
- artifacts/cadstone/src/lib/sentry.ts:62-66 (eventContainsPii)
- artifacts/cadstone/src/lib/sentry.ts:118-123 (initSentry)

The beforeSend hook drops events only when eventContainsPii returns true, but eventContainsPii entirely skips fields named token, secret, key, or dsn. That means an event containing explicit sensitive data such as extra.token or extra.api_key is allowed through unchanged. sendDefaultPii=false does not protect manually attached event extras or error context, so this creates an observability data-leak path.

recommendation:
Treat token/secret/dsn/api_key-like keys as sensitive and drop or scrub the event instead of skipping their values. Keep the false-positive avoidance only for benign identifiers such as id, uuid, and hash.

test analysis:
artifacts/cadstone/src/lib/sentry.test.ts reimplements the matcher and covers URL query stripping, but it does not assert behavior for object fields named token, secret, dsn, or api_key, nor does it exercise the actual beforeSend callback from sentry.ts.

suggested regression test:
Add a web Sentry filter test that feeds an event containing { extra: { token: 'abc123' } } or { extra: { api_key: 'secret' } } through the actual beforeSend path and asserts the event is dropped or redacted.

minimum fix scope:
Update artifacts/cadstone/src/lib/sentry.ts key handling and add focused coverage in artifacts/cadstone/src/lib/sentry.test.ts.

## medium: XHR upload timeout handler is never enabled

id: fnd_sig-feat-library-6313510ad6-a0ce_fa77337ef5
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/cadstone/src/lib#2 (feat_library_6313510ad6)

evidence:
- artifacts/cadstone/src/lib/uploads.ts:352-363 (sendOnce)
- artifacts/cadstone/src/lib/uploads.ts:435-443 (sendOnce)
- artifacts/cadstone/src/lib/uploads.ts:469-475 (uploadWithProgress)

XMLHttpRequest only fires ontimeout when xhr.timeout is set to a positive value. sendOnce installs an ontimeout handler and maps it to UPLOAD_NETWORK_TIMEOUT, but never assigns xhr.timeout and UploadOptions has no timeout setting. A stalled upload can therefore remain in the uploading state until the browser eventually fails it or the user aborts, and the retry path promised by the helper will not run for request timeouts.

recommendation:
Add a timeoutMs option or module-level default and assign xhr.timeout before xhr.send. Keep the existing ontimeout mapping and retry behavior.

test analysis:
artifacts/cadstone/src/lib/uploads.test.ts covers file validation and video-duration checks only; it has no XMLHttpRequest fake or uploadWithProgress tests that verify timeout configuration.

suggested regression test:
Add an uploadWithProgress unit test with a fake XMLHttpRequest that records the timeout property and asserts it is set to a positive value before send, then simulate ontimeout and assert the helper retries or rejects with UPLOAD_NETWORK_TIMEOUT as intended.

minimum fix scope:
Update artifacts/cadstone/src/lib/uploads.ts and add uploadWithProgress timeout coverage in artifacts/cadstone/src/lib/uploads.test.ts.

## low: Video metadata probe leaves timeout handles alive after early completion

id: fnd_sig-feat-library-6313510ad6-c4d6_05aa3f6f35
category: performance
confidence: high
triage: risk
status: open
feature: Node source artifacts/cadstone/src/lib#2 (feat_library_6313510ad6)

evidence:
- artifacts/cadstone/src/lib/uploads.ts:152-164 (defaultProbeDuration)
- artifacts/cadstone/src/lib/uploads.ts:159-163 (defaultProbeDuration)
- artifacts/cadstone/src/lib/uploads.test.ts:98-147 (validateVideoDurations tests)

When metadata loads or errors before the 8-second timeout, finish resolves and cleanup runs, but the timeout handle is not cleared. Each successful probe keeps its timer callback and captured objects alive until the full timeout expires. The impact is bounded by upload count, but repeated video selections can accumulate unnecessary timers and retained DOM/file references for several seconds.

recommendation:
Store the timeout handle and clear it in finish before cleanup/resolve. This keeps the current fail-open timeout behavior while releasing resources immediately on early completion.

test analysis:
The video-duration tests inject custom probe functions, so defaultProbeDuration's timer lifecycle is not exercised.

suggested regression test:
Add a test around the default probe path using stubbed document.createElement, URL.createObjectURL, setTimeout, and clearTimeout to assert clearTimeout is called when loadedmetadata finishes before the timeout.

minimum fix scope:
Update defaultProbeDuration in artifacts/cadstone/src/lib/uploads.ts and add focused timer cleanup coverage in artifacts/cadstone/src/lib/uploads.test.ts.

## low: Text labels cannot be reopened for content edits

id: fnd_sig-feat-library-663f6dd45e-2d43_d6ca7d2cfb
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/cadstone/src/components/files (feat_library_663f6dd45e)

evidence:
- artifacts/cadstone/src/components/files/pdf-annotation-editor.ts:31-53 (prepareEditorForExistingNote)
- artifacts/cadstone/src/components/files/pdf-annotation-editor.test.ts:82-87 (prepareEditorForExistingNote tests)
- artifacts/cadstone/src/components/files/PdfAnnotationLayer.tsx:912-918 (beginEditStickyNote)
- artifacts/cadstone/src/components/files/PdfAnnotationLayer.tsx:1157-1174 (PdfAnnotationLayer sticky note rendering)
- artifacts/cadstone/src/components/files/PdfAnnotationLayer.tsx:933-937 (handleAnnotationClick)

The editor helper and tests intentionally support reopening text_label annotations with editingId, but the component only wires that edit flow through StickyNotePin, which renders only sticky_note annotations. Clicking a text label in select mode only selects it for style changes; there is no reachable action that calls beginEditStickyNote for text_label content. Users can create text labels but cannot edit their text afterward.

recommendation:
Expose the existing reopen editor path for text_label annotations, for example via an Edit action in the selection style bar or a double-click/explicit edit control that calls prepareEditorForExistingNote for selected text labels.

test analysis:
The included editor tests verify the pure helper supports text_label, but no integration test verifies that the UI has a reachable text_label edit path.

suggested regression test:
Add a component-level test that selects or invokes edit on a text_label annotation and asserts the textarea opens prefilled and Save calls onUpdate with a content patch.

minimum fix scope:
PdfAnnotationLayer text_label selection/edit UI wiring and one integration regression test.

repro:
Create a text label, switch to select mode, and click the label. The style bar appears, but there is no editor or edit action for changing the label content.

## medium: Undoing a just-created annotation can still persist it

id: fnd_sig-feat-library-663f6dd45e-8f75_6377c6fad5
category: data-loss
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/cadstone/src/components/files (feat_library_663f6dd45e)

evidence:
- artifacts/cadstone/src/components/files/use-pdf-annotations.ts:233-244 (createAnnotation)
- artifacts/cadstone/src/components/files/use-pdf-annotations.ts:325-348 (undo)
- artifacts/cadstone/src/components/files/use-pdf-annotations.ts:174-196 (persistDraft)

createAnnotation schedules persistence 300ms later, but undoing a create before that timeout fires only removes the draft locally and pushes redo state. The timeout is not cancelled and persistDraft does not check whether the temp draft is still active before POSTing, so an annotation the user already undid can still be created on the server and appended back into UI state.

recommendation:
Track pending create timers by tempId and cancel them on undo/reset, or mark tempIds as cancelled and have persistDraft no-op before POSTing if the draft is no longer pending.

test analysis:
The included tests cover pure editor and geometry helpers only; they do not exercise usePdfAnnotations timers, optimistic drafts, or undo behavior.

suggested regression test:
Add a hook-level test with fake timers: create an annotation, call undo before advancing 300ms, advance timers, and assert api.post is not called and annotations remains empty.

minimum fix scope:
use-pdf-annotations create/undo/persistDraft pending-create lifecycle.

repro:
Create any PDF markup and immediately click Undo or press Ctrl/Cmd+Z within 300ms. After the timeout/API response, the undone markup is posted and reappears as a saved annotation.

## medium: Line and arrow creation can send negative dimensions

id: fnd_sig-feat-library-663f6dd45e-f4c8_2411c8fc17
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: Node source artifacts/cadstone/src/components/files (feat_library_663f6dd45e)

evidence:
- artifacts/cadstone/src/components/files/PdfAnnotationLayer.tsx:733-749 (finishStroke)
- artifacts/cadstone/src/components/files/use-pdf-annotations.ts:178-192 (persistDraft)
- artifacts/cadstone/src/components/files/pdf-annotation-geometry.ts:64-85 (applyDragToAnnotation)
- artifacts/cadstone/src/components/files/pdf-annotation-geometry.test.ts:173-194 (applyDragToAnnotation tests)

The create path for line and arrow stores raw deltas as normalizedW/normalizedH. Drawing from right to left or bottom to top makes one or both values negative, and persistDraft forwards those values directly to the API. The geometry helper and tests explicitly normalize endpoint edits to non-negative dimensions because the API rejects negatives, but initial line/arrow creation bypasses that normalization.

recommendation:
Normalize line/arrow drafts in finishStroke the same way endpoint drag updates do, or extract a shared endpoint-to-bbox helper and use it for both creation and updates.

test analysis:
The geometry tests cover endpoint movement after an annotation exists, but there is no test for PdfAnnotationLayer finishStroke creating a line or arrow with reversed drag direction.

suggested regression test:
Add a focused test around a shared line/arrow draft builder, or a component interaction test, asserting reversed drags produce non-negative normalizedW and normalizedH before createAnnotation is called.

minimum fix scope:
PdfAnnotationLayer line/arrow finishStroke geometry normalization plus a regression test.

repro:
In PDF markup mode, select Line or Arrow and drag from a lower/right point toward an upper/left point. The optimistic draft is created with negative normalizedW and/or normalizedH and the save request is likely rejected.

## medium: Create payload type permits a workday exception with no target jobs

id: fnd_sig-feat-library-6832c599ad-6fd0_e802b7d927
category: api-contract
confidence: medium
triage: contract-mismatch
status: open
feature: Node source lib/api-zod/src/generated/types#22 (feat_library_6832c599ad)

evidence:
- lib/api-zod/src/generated/types/workdayExceptionPayload.ts:10-12 (WorkdayExceptionPayload)
- lib/api-zod/src/generated/types/workdayExceptionPayload.ts:26-28 (WorkdayExceptionPayload)

The file documents a required invariant for POST bodies, but the exported request type does not encode it: callers can compile `{ title, type, startDate, endDate }`, or `{ appliesToAllJobs: false, jobIds: [] }`, even though the documented contract requires at least one target job unless the exception is company-wide. This weakens generated-client safety and can let invalid or no-op create requests reach runtime. The fix should be made in the OpenAPI source so generated types and validators agree with the documented invariant.

recommendation:
Model the invariant in the source OpenAPI schema, for example with `oneOf` branches for company-wide versus job-scoped creation and `minItems: 1` on the job-scoped `jobIds`, then regenerate the generated API/Zod/type files.

test analysis:
The feature lists no linked tests, and the generated interface itself has no type-level assertion that missing or empty `jobIds` is rejected when `appliesToAllJobs` is false.

suggested regression test:
Add a contract or route regression covering POST `/jobs/{jobId}/workday-exceptions` with `appliesToAllJobs` omitted/false and missing or empty `jobIds`, expecting rejection, plus a codegen/type assertion if the repo has a type-test pattern.

minimum fix scope:
Update the OpenAPI schema for `WorkdayExceptionPayload`, regenerate generated API/Zod/type outputs, and add a focused regression around the job target invariant.

## medium: JobSummary generated types drift from job JSON contract for cents and date-only fields

id: fnd_sig-feat-library-68e7204cf8-da2d_95d870fa38
category: api-contract
confidence: medium
triage: contract-mismatch
status: open
feature: Node source lib/api-zod/src/generated/types#10 (feat_library_68e7204cf8)

evidence:
- lib/api-zod/src/generated/types/jobSummary.ts:22-27 (JobSummary)
- lib/api-zod/src/generated/types/jobListItem.ts:21-24 (JobListItem)
- lib/api-zod/src/generated/types/jobListItem.ts:34-45 (JobListItem)

JobSummary represents the same job-facing API domain as JobListItem, but it exposes cents as bigint and date-only fields as Date. JSON responses cannot carry bigint values, and date-only fields elsewhere in this job contract are explicitly YYYY-MM-DD strings. Consumers of client detail/client-job listings typed through JobSummary can therefore compile code that expects bigint arithmetic or Date methods even though sibling job endpoints expose JSON-safe numbers and strings. Because these are generated files, the likely source is an OpenAPI schema shape drift rather than a hand-edit issue.

recommendation:
Fix the JobSummary schema in the OpenAPI source to use JSON-safe integer cents with the same maximum/description as other job money fields, and represent date-only values as YYYY-MM-DD strings with the same pattern convention. Then regenerate the API Zod/types instead of editing generated files directly.

test analysis:
No linked tests are included for this generated source group, and typecheck would not catch a wrong generated API contract when all generated consumers agree with the incorrect type.

suggested regression test:
Add an API contract/codegen drift test asserting JobSummary contractValueCents and amountPaidCents are number-compatible safe integers, and projectedStart/projectedCompletion are date strings matching YYYY-MM-DD rather than Date objects.

minimum fix scope:
OpenAPI JobSummary schema plus regenerated generated clients/Zod/types.

## medium: Drizzle behavior depends on a mutable postinstall patch

id: fnd_sig-feat-library-710c9f5545-cf93_be6262cede
category: build-release
confidence: medium
triage: risk
status: open
feature: Node source scripts (feat_library_710c9f5545)

evidence:
- package.json:12 (scripts.postinstall)
- scripts/patch-drizzle-errors.mjs:52-58

The workspace relies on a postinstall script that rewrites installed drizzle-orm files in node_modules. That makes runtime and test behavior depend on lifecycle scripts having run successfully, and it can diverge in installs that skip scripts or use deployment flows that materialize node_modules without rerunning postinstall. Because the patch is not represented as a package-manager-level patch, the lockfile alone does not describe the actual dependency contents.

recommendation:
Move this to a deterministic package patch mechanism such as pnpm `patchedDependencies`/`pnpm patch`, or handle the underlying cause message at the application/test assertion layer without mutating installed dependencies during postinstall.

test analysis:
No tests are linked for this feature, and ordinary test runs after a local install would only exercise the already-mutated node_modules path, not an install/deploy path where lifecycle scripts are skipped or the patch fails.

suggested regression test:
Add an install-time verification that fails if the committed package patch is not applied, or a script fixture test that runs against a temporary drizzle errors file and asserts the generated patch is deterministic without relying on the current node_modules contents.

minimum fix scope:
Replace the root postinstall dependency rewrite with a committed pnpm package patch or remove the dependency mutation and update callers/tests to inspect `error.cause` explicitly.

repro:
Install with lifecycle scripts disabled, for example `pnpm install --ignore-scripts`, then run code that expects DrizzleQueryError.message to include the underlying pg constraint message. The dependency files remain unpatched even though the same lockfile was installed.

## medium: Generated user request-body types accept arbitrary payloads

id: fnd_sig-feat-library-74cf25241d-2bbb_4bcf77bdfb
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: Node source lib/api-zod/src/generated/types#21 (feat_library_74cf25241d)

evidence:
- lib/api-zod/src/generated/types/usersChangePasswordSchema.ts:10-14 (UsersChangePasswordSchema)
- lib/api-zod/src/generated/types/usersUpdateProfileSchema.ts:10-14 (UsersUpdateProfileSchema)

Both generated request-body contracts collapse to an open index signature. That means TypeScript clients can compile calls such as an empty password-change body, a body missing newPassword/currentPassword, or arbitrary profile fields, even though these endpoints are documented as being derived from concrete server Zod schemas. The server may still reject bad requests at runtime, but the generated API contract no longer protects client code from shipping payloads that cannot satisfy the endpoint contract.

recommendation:
Fix the OpenAPI components that generate these types so the profile and password request bodies enumerate their actual properties, required fields, formats, and length constraints, then regenerate the API Zod/client artifacts instead of editing generated files by hand.

test analysis:
No linked tests are included for this feature, and the generated types themselves contain no compile-time assertion that these bodies expose the expected fields instead of a catch-all record.

suggested regression test:
Add a codegen regression test that asserts users_changePasswordSchema generates required currentPassword and newPassword string properties, and users_updateProfileSchema generates only the supported profile fields with their intended optionality.

minimum fix scope:
Update the source OpenAPI schema/body extraction for the two user self-service request bodies and regenerate lib/api-zod plus any generated API client types that consume the same components.

## medium: Date-only query parameters are generated as Date objects instead of API strings

id: fnd_sig-feat-library-765309b44d-1b6c_0b39e2dd3d
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: Node source lib/api-zod/src/generated/types#7 (feat_library_765309b44d)

evidence:
- lib/api-zod/src/generated/types/dailyLogsGetJobsJobIdDailyLogsParams.ts:31-38 (DailyLogsGetJobsJobIdDailyLogsParams)
- lib/api-zod/src/generated/types/dashboardGetDashboardScheduleParams.ts:10-17 (DashboardGetDashboardScheduleParams)
- lib/api-zod/src/generated/types/dailyLogsGetDailyLogsFeedParams.ts:29-30 (DailyLogsGetDailyLogsFeedParams)

These query parameters are documented as date-only HTTP query values in YYYY-MM-DD form, but the exported generated types require Date instances. That makes the public @workspace/api-zod contract disagree with the wire contract and with normal URL/search-param state, and it encourages callers to pass Date objects whose default string serialization is not YYYY-MM-DD. Because the files are generated, the root cause should be fixed in the OpenAPI/codegen pipeline rather than by hand-editing these files.

recommendation:
Regenerate these query parameter types as string/string|null for format: date query params, or adjust the codegen/post-codegen transform so API query params preserve wire-format strings while body/response date-time fields can still use Date where intended.

test analysis:
The feature lists no linked tests, and there is no type-level contract test here asserting that date-only query params remain YYYY-MM-DD strings in @workspace/api-zod.

suggested regression test:
Add a codegen contract/type assertion for DailyLogsGetJobsJobIdDailyLogsParams.from/to, DailyLogsGetDailyLogsFeedParams.from/to, and DashboardGetDashboardScheduleParams.start/end that expects string-based YYYY-MM-DD query values, then run the API codegen drift check.

minimum fix scope:
Update the OpenAPI/codegen configuration or post-codegen normalization for date-format query parameters and regenerate lib/api-zod/src/generated.

## low: Cursor parameter docs incorrectly say limit-only file listing returns cursor pagination

id: fnd_sig-feat-library-7c38ebf98a-41b1_9266cc46e9
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: Node source lib/api-zod/src/generated/types#8 (feat_library_7c38ebf98a)

evidence:
- lib/api-zod/src/generated/types/filesGetFoldersIdFilesParams.ts:31-37 (FilesGetFoldersIdFilesParams.cursor)

The generated parameter documentation tells clients that `?limit=N` without `page` or `pageSize` enters cursor mode and returns a cursor envelope. For this endpoint, the server/tested contract keeps limit-only requests in page mode; cursor mode requires an explicit `cursor` query key. Client authors following this generated type documentation can parse the wrong pagination shape or fail to continue paging.

recommendation:
Correct the shared cursor parameter description or override it for `/folders/{id}/files` so it only documents `?cursor=&limit=N` as the cursor bootstrap form, then regenerate generated types.

test analysis:
Backend pagination tests cover the runtime limit-only behavior, but this generated declaration's JSDoc is not asserted by the linked feature tests, and the feature's tests list is empty.

suggested regression test:
Add a generated-contract assertion for `FilesGetFoldersIdFilesParams` or the OpenAPI parameter description that rejects text claiming limit-only requests return a cursor envelope for `/folders/{id}/files`.

minimum fix scope:
Update the OpenAPI cursor parameter description used by this endpoint and regenerate lib/api-zod generated files.

## medium: Folder/file request body types are generated as open dictionaries

id: fnd_sig-feat-library-7c38ebf98a-b164_83fbcee3f8
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: Node source lib/api-zod/src/generated/types#8 (feat_library_7c38ebf98a)

evidence:
- lib/api-zod/src/generated/types/filesRenameFileSchema.ts:12-14 (FilesRenameFileSchema)
- lib/api-zod/src/generated/types/foldersFolderBodySchema.ts:12-14 (FoldersFolderBodySchema)
- lib/api-zod/src/generated/types/foldersFolderUpdateSchema.ts:12-14 (FoldersFolderUpdateSchema)
- lib/api-zod/src/generated/types/foldersMoveFolderSchema.ts:12-14 (FoldersMoveFolderSchema)

These generated request-body declarations erase all known body fields and allow any object, including empty objects and wrong property names. The adjacent generated comments say they are derived from concrete route schemas, but the exported client-facing contract no longer communicates required fields such as file/folder names or folder media type. This removes compile-time protection for write endpoints and can let client code ship requests that the server rejects at runtime.

recommendation:
Fix the OpenAPI/source schema generation so these components emit explicit properties, required arrays, nullability, and additionalProperties behavior, then regenerate the API Zod/types package instead of hand-editing generated files.

test analysis:
The feature lists no linked tests, and the existing codegen drift check can pass while preserving an overly broad generated schema because the generated output matches the broad OpenAPI component.

suggested regression test:
Add a codegen/API-contract test that asserts files_renameFileSchema and the folder body components include their expected OpenAPI properties and required fields, then verifies the generated TypeScript declarations reject empty or misspelled request bodies.

minimum fix scope:
Update the API spec/codegen source for the four affected request body components and regenerate lib/api-zod generated files.

## high: Backfilled file and folder rows lose tenant scope

id: fnd_sig-feat-library-7fdbc1c9e4-87e4_c0e31561c5
category: security
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/api-server/src/scripts (feat_library_7fdbc1c9e4)

evidence:
- artifacts/api-server/src/scripts/backfill-comment-attachments.ts:168-174 (processCommentRow)
- artifacts/api-server/src/scripts/backfill-comment-attachments.ts:131-141 (ensureCommentFolder)
- artifacts/api-server/src/scripts/backfill-comment-attachments.ts:287-300 (processCommentRow)
- artifacts/api-server/test/backfill-comment-attachments.test.ts:155-173

The script only carries dailyLogId/createdBy/attachments through the backfill and inserts both folders and files without organizationId. In this workspace, daily log comments, folders, and files are tenant-scoped records; creating migrated file metadata with null tenant scope breaks tenant-scoped access checks and can leave migrated attachments outside the intended tenant boundary. The included test verifies folder/file creation but never seeds or asserts an organizationId, so this regression would pass.

recommendation:
Read the comment's organizationId (directly from dailyLogComments or by joining dailyLogs), include it in the row model, scope ensureCommentFolder by organizationId, and write organizationId on both folders and files. If storage paths are expected to be tenant-prefixed, pass the organizationId into buildUploadPath as well.

test analysis:
The test fixture creates user/job/daily log rows without organization context and only asserts folder title plus file size/mime/id, not tenant metadata.

suggested regression test:
Create an organization-scoped daily log comment with a legacy data URL, run the backfill, and assert the generated folder and file rows both carry the same organizationId as the comment/daily log.

minimum fix scope:
Update backfill row selection/types, ensureCommentFolder lookup/insert, file insert values, and the backfill test fixture assertions for organization-scoped records.

## medium: Malformed data URLs can be preserved or converted into corrupt files

id: fnd_sig-feat-library-7fdbc1c9e4-f933_e651484b71
category: data-loss
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/api-server/src/scripts (feat_library_7fdbc1c9e4)

evidence:
- artifacts/api-server/src/scripts/backfill-comment-attachments.ts:71-80 (parseDataUrl)
- artifacts/api-server/src/scripts/backfill-comment-attachments.ts:186-190 (processCommentRow)
- artifacts/api-server/src/scripts/backfill-comment-attachments.ts:251-256 (processCommentRow)
- artifacts/api-server/src/scripts/backfill-comment-attachments.ts:259-266 (processCommentRow)
- artifacts/api-server/test/backfill-comment-attachments.test.ts:117-123

Empty data URLs such as data:image/png;base64, are classified as not legacy because parseDataUrl returns null, so rows containing only that value are skipped and mixed rows preserve it as if it were an external URL. Separately, Buffer.from(..., 'base64') is permissive and does not reliably throw for malformed non-empty base64, so the catch block does not enforce the intended drop behavior and can replace a legacy attachment with corrupt object-storage bytes. Both cases violate the script's stated goal that raw base64 is removed or unreadable entries are dropped.

recommendation:
Separate data-URL envelope detection from valid payload decoding. Treat any data:*;base64 URL as a legacy candidate, drop empty payloads, and validate non-empty base64 before writing, for example with a strict base64 character/padding check plus a decode/re-encode consistency check appropriate for accepted payloads.

test analysis:
The tests only use a valid tiny PNG data URL and cover external http URLs; they do not include empty, badly padded, or otherwise malformed base64 payloads.

suggested regression test:
Seed comments with data:image/png;base64, and data:image/png;base64,not-valid%% payloads, run the backfill, and assert no data: URL remains and no corrupt file row/storage write is produced for malformed entries.

minimum fix scope:
Update parse/decode handling in backfill-comment-attachments.ts and add malformed data URL cases to backfill-comment-attachments.test.ts.

## low: GET /jobs status filter is generated as an unrestricted string

id: fnd_sig-feat-library-8046f193a8-ad10_bbb4ce03a6
category: api-contract
confidence: medium
triage: contract-mismatch
status: open
feature: Node source lib/api-zod/src/generated/types#11 (feat_library_8046f193a8)

evidence:
- lib/api-zod/src/generated/types/jobsGetJobsParams.ts:27-30 (JobsGetJobsParams.status)
- lib/api-zod/src/generated/types/jobsJobPayloadSchemaStatus.ts:12-16 (JobsJobPayloadSchemaStatus)

The generated GET /jobs params type accepts any status string, while the job status domain in the same generated group is the closed set open/closed/archived. Local inspection of the route schema showed GET /jobs validates status with that same enum, so generated callers can typecheck and zod-parse values that the API will reject with 400. This is a contract drift in the generated surface rather than a runtime security issue.

recommendation:
Update the OpenAPI GET /jobs status query parameter to declare enum [open, closed, archived], then regenerate api-zod/api-client outputs.

test analysis:
The feature lists no linked tests. Existing job contract tests cover job body date, money, and POST clientId drift, but do not assert the GET /jobs query status enum.

suggested regression test:
Add a contract test that imports JobsGetJobsQueryParams from @workspace/api-zod and asserts safeParse({ status: 'open' }) succeeds while safeParse({ status: 'bogus' }) fails.

minimum fix scope:
lib/api-spec/openapi.yaml GET /jobs status query parameter plus regenerated generated clients/schemas.

## medium: Lead conversion date overrides are generated as Date objects instead of request strings

id: fnd_sig-feat-library-82007b1603-2103_0601689ba3
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: Node source lib/api-zod/src/generated/types#12 (feat_library_82007b1603)

evidence:
- lib/api-zod/src/generated/types/leadConvertToJobBody.ts:11-20 (LeadConvertToJobBody)
- lib/api-zod/src/generated/types/leadConvertToJobBodyJob.ts:24-27 (LeadConvertToJobBodyJob)

The generated type for the POST /leads/{id}/convert-to-job request body exposes projectedStart and projectedCompletion as Date values. The lead conversion API expects calendar-date strings in YYYY-MM-DD form; JSON-serializing a Date produces an ISO timestamp, so callers relying on this generated type can compile successfully while sending payloads the endpoint rejects or cannot interpret as intended. This also diverges from the project convention that date-only request fields remain strings rather than Date instances.

recommendation:
Fix the OpenAPI/codegen source so these date-only request fields generate as `string | null`, then regenerate generated clients and zod/types instead of hand-editing the generated file.

test analysis:
No linked tests were supplied for this source group. Existing checks may catch codegen drift, but they do not prove the generated api-zod request type matches the server's accepted payload shape for date-only fields.

suggested regression test:
Add a generated-type/codegen assertion for `LeadConvertToJobBodyJob` that `projectedStart` and `projectedCompletion` are `string | null | undefined` and not assignable from `Date`.

minimum fix scope:
Update the API spec/codegen configuration for the lead convert-to-job job override date fields and regenerate `lib/api-zod/src/generated` outputs.

## low: Sidebar drops caller DOM props on the mobile rendering path

id: fnd_sig-feat-library-8374fb8604-83a4_2849995f56
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: Node source artifacts/cadstone/src/components/ui#4 (feat_library_8374fb8604)

evidence:
- artifacts/cadstone/src/components/ui/sidebar.tsx:152-159 (Sidebar)
- artifacts/cadstone/src/components/ui/sidebar.tsx:181-188 (Sidebar)

Sidebar is typed as accepting div props and destructures className, but in the mobile branch className is never merged into the rendered SheetContent, while the remaining DOM props are spread onto the Radix Dialog root rather than a DOM node. Consumers that add responsive classes, inline style, data attributes, ids, or DOM handlers to Sidebar get those props on the desktop container but lose them on mobile, causing inconsistent behavior and making tests/selectors unreliable at mobile widths.

recommendation:
In the mobile branch, merge className into SheetContent and apply relevant DOM props to the visible sidebar content element or narrow the component props so DOM props are not advertised for mobile. Avoid spreading arbitrary div props onto SheetPrimitive.Root.

test analysis:
No linked tests are included for Sidebar responsive behavior or prop forwarding, and the current typecheck does not catch runtime prop loss through a spread into Radix Root.

suggested regression test:
Add a jsdom or component test that mocks useIsMobile to true, renders Sidebar with className and data-testid, and asserts the visible element with data-slot="sidebar" receives those props/classes.

minimum fix scope:
Update the Sidebar mobile branch in artifacts/cadstone/src/components/ui/sidebar.tsx to forward className and DOM attributes to SheetContent or an inner DOM wrapper consistently with the desktop branch.

repro:
Render <Sidebar className="custom-sidebar" data-testid="nav" /> under a mobile viewport. The rendered mobile SheetContent does not receive custom-sidebar, and data-testid is passed to Sheet root instead of the visible sidebar DOM element.

## low: Test sources are excluded from package typechecking

id: fnd_sig-feat-library-84af49a73d-8c24_ebdcded586
category: test-gap
confidence: medium
triage: test-gap
status: open
feature: Node package @workspace/cadstone (feat_library_84af49a73d)

evidence:
- artifacts/cadstone/tsconfig.json:3
- artifacts/cadstone/package.json:11

The package test script executes TypeScript test files through tsx, which transpiles and runs them but does not provide the same static typechecking as tsc. The package typecheck script uses this tsconfig, and the tsconfig excludes all *.test.ts files, so type errors in tests can pass the required typecheck and only fail later if they happen to cause runtime errors. This weakens tests as contract evidence for the package.

recommendation:
Add a dedicated test typecheck path, such as a tsconfig.test.json that includes src/**/*.test.ts, and wire it into the package or workspace checks; alternatively remove the test exclusion if that does not create unwanted build constraints.

test analysis:
No linked tests are included for this feature, and the existing package scripts run tests without statically checking test files.

suggested regression test:
Add a CI/package check that runs tsc against test files, then verify a deliberately invalid type in a src/**/*.test.ts file fails that check.

minimum fix scope:
artifacts/cadstone/tsconfig.json plus package/workspace check script wiring if a separate test tsconfig is used.

## low: Carousel navigation props can override required scroll behavior

id: fnd_sig-feat-library-878e461505-610e_54917e65f4
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: Node source artifacts/cadstone/src/components/ui#1 (feat_library_878e461505)

evidence:
- artifacts/cadstone/src/components/ui/carousel.tsx:213-215 (CarouselPrevious)
- artifacts/cadstone/src/components/ui/carousel.tsx:242-244 (CarouselNext)

CarouselPrevious and CarouselNext accept Button props, including onClick and disabled. Because props are spread after the internal disabled and onClick values, a caller adding an onClick for analytics or a custom disabled value replaces the carousel's own navigation logic. The components still render as previous/next controls but can stop scrolling or become enabled when scrolling is unavailable.

recommendation:
Destructure caller onClick and disabled, compose the click handler with scrollPrev/scrollNext, and keep the internal disabled state authoritative unless there is an explicit documented override prop.

test analysis:
No linked tests cover CarouselPrevious or CarouselNext with additional Button props.

suggested regression test:
Add a component test rendering CarouselNext with a caller onClick and assert a click both calls the caller handler and advances the Embla API, while disabled remains true when canScrollNext is false.

minimum fix scope:
artifacts/cadstone/src/components/ui/carousel.tsx

repro:
Render <CarouselNext onClick={() => {}} /> inside a carousel with multiple slides and click it. The supplied onClick overrides scrollNext, so the carousel does not advance.

## medium: Carousel steals horizontal arrow keys from interactive slide content

id: fnd_sig-feat-library-878e461505-85c7_fbc90f28d4
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/cadstone/src/components/ui#1 (feat_library_878e461505)

evidence:
- artifacts/cadstone/src/components/ui/carousel.tsx:86-94 (Carousel.handleKeyDown)
- artifacts/cadstone/src/components/ui/carousel.tsx:135-137 (Carousel)

The root carousel handles ArrowLeft and ArrowRight during the capture phase and always calls preventDefault. Any focused input, textarea, select-like widget, contentEditable area, or nested control inside a slide loses normal left/right cursor or selection behavior and instead scrolls the carousel. Because this is capture-phase, child components cannot reliably handle the key first.

recommendation:
Do not handle navigation keys from editable or interactive descendants. Prefer a guard such as checking event.target for input, textarea, select, button, [contenteditable], or elements with their own keyboard semantics before calling preventDefault, and consider using bubble phase unless capture is required.

test analysis:
No linked tests were supplied for this source group, and no components/ui carousel tests were found. Existing package tests are not exercising keyboard behavior in these components.

suggested regression test:
Add a jsdom or Playwright component test that focuses an input inside CarouselItem, presses ArrowLeft/ArrowRight, and asserts the input receives normal cursor behavior while the carousel does not scroll.

minimum fix scope:
artifacts/cadstone/src/components/ui/carousel.tsx

repro:
Render a CarouselItem containing an input, focus the input, type text, then press ArrowLeft. The cursor does not move left; the carousel consumes the event and scrolls to the previous slide.

## low: Breadcrumb advertises a separator prop but only forwards it to nav

id: fnd_sig-feat-library-878e461505-b6de_8aab7ecbcc
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: Node source artifacts/cadstone/src/components/ui#1 (feat_library_878e461505)

evidence:
- artifacts/cadstone/src/components/ui/breadcrumb.tsx:7-12 (Breadcrumb)

The Breadcrumb root type exposes separator?: React.ReactNode, which implies callers can configure the separator at the root. The implementation never consumes that prop and instead spreads it onto the DOM nav element. Passing a React element separator therefore has no visible effect and risks React DOM warnings or an invalid separator attribute.

recommendation:
Either remove separator from Breadcrumb's public props, or consume it and provide it through context/defaults used by BreadcrumbSeparator. In either case, strip separator before spreading DOM props onto nav.

test analysis:
No linked breadcrumb tests exercise the root separator prop or DOM prop forwarding.

suggested regression test:
Add a render test that passes a custom separator to Breadcrumb and asserts it is either rendered by BreadcrumbSeparator or rejected by the type/API, and that nav does not receive a separator attribute.

minimum fix scope:
artifacts/cadstone/src/components/ui/breadcrumb.tsx

repro:
Render <Breadcrumb separator={<span>/</span>}><BreadcrumbList>...</BreadcrumbList></Breadcrumb>. The rendered separators do not change because BreadcrumbSeparator does not receive the prop, and the separator value is passed to the nav element instead.

## low: Carousel reInit listener is never unsubscribed

id: fnd_sig-feat-library-878e461505-ce19_0a80f21d0a
category: performance
confidence: high
triage: risk
status: open
feature: Node source artifacts/cadstone/src/components/ui#1 (feat_library_878e461505)

evidence:
- artifacts/cadstone/src/components/ui/carousel.tsx:112-118 (Carousel.useEffect)

The effect subscribes the same callback to both Embla's reInit and select events, but cleanup only removes the select listener. If the Embla API instance is retained through setApi, plugins, or an API replacement, the old reInit subscription keeps the component callback alive and can call React state setters after the effect has been cleaned up.

recommendation:
Mirror subscriptions in cleanup: call api.off("reInit", onSelect) as well as api.off("select", onSelect).

test analysis:
There are no linked carousel lifecycle tests covering Embla event subscription cleanup.

suggested regression test:
Add a focused unit test with a mocked Embla API that records on/off calls and asserts cleanup unregisters both reInit and select listeners.

minimum fix scope:
artifacts/cadstone/src/components/ui/carousel.tsx

repro:
Mount a Carousel with setApi storing the Embla API, unmount or cause the effect to clean up, then trigger reInit on the retained API instance. The stale onSelect callback remains registered because only select was removed.

## medium: Activity cursor bootstrap contract is wrong for limit-only requests

id: fnd_sig-feat-library-87c7a6ccea-0a3f_ecc97c1566
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: Node source lib/api-zod/src/generated/types#1 (feat_library_87c7a6ccea)

evidence:
- lib/api-zod/src/generated/types/activityGetActivityParams.ts:42-53 (ActivityGetActivityParams)

The generated parameter contract tells consumers that sending only `?limit=N` starts cursor pagination and returns `pagination.nextCursor`. The actual activity route is explicit-cursor gated, so a limit-only request stays in page mode and does not return the cursor envelope. Consumers using this generated contract for infinite scroll can bootstrap with `limit` alone, then fail when `nextCursor` is absent.

recommendation:
Fix the OpenAPI source for the activity endpoint/cursor parameter so it documents `?cursor=&limit=N` as the cursor bootstrap for this route, or change the route to honor limit-only cursor mode. Regenerate generated API/Zod files instead of editing this file directly.

test analysis:
No linked tests were provided for this generated contract, and the mismatch is between generated docs/types and runtime pagination mode selection.

suggested regression test:
Add an API contract test for `GET /activity?limit=1` and `GET /activity?cursor=&limit=1` that asserts the documented pagination shape for each request.

minimum fix scope:
Update the source OpenAPI description or activity route pagination-mode logic, then regenerate `lib/api-zod/src/generated` and related generated clients.

repro:
Call `GET /api/activity?limit=10` and observe page-mode pagination rather than a cursor pagination object with `nextCursor`.

## high: Resource folder authorization ignores tenant ownership

id: fnd_sig-feat-library-8bc0d8327d-28b8_86b7a24366
category: security
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/api-server/src/lib#1 (feat_library_8bc0d8327d)

evidence:
- artifacts/api-server/src/lib/authorization.ts:607-627 (getFolderAccessOrThrow)
- artifacts/api-server/src/lib/authorization.ts:508-509 (resolveFolderScope)
- artifacts/api-server/src/lib/authorization.ts:584-604 (assertScopedFolderAccess)
- artifacts/api-server/src/lib/authorization.ts:646-665 (buildFolderVisibilityCondition)

getFolderAccessOrThrow loads a folder only by id and deletion state, then resource folders fall through assertScopedFolderAccess without any organization or parent-entity check. For non-admins, access is decided only by viewing/uploadingPermissions; for admins, manage is allowed. That means a resource folder from another tenant with broad permissions can be viewed or uploaded to by a user in the wrong active organization if they know or obtain the folder id.

recommendation:
Include organizationId in folder access records and require it to match the active auth organization for resource folders, or add an auth-aware organizationScopeCondition to the folder lookup for all direct folder access checks.

test analysis:
The linked tests do not include folder/resource authorization or cross-organization folder access cases.

suggested regression test:
Create a resource folder in org B with internal viewing/uploading permissions, authenticate a user in org A, and verify assertCanViewFolder and assertCanUploadToFolder reject the org B folder id.

minimum fix scope:
Folder access lookup and scoped folder authorization in artifacts/api-server/src/lib/authorization.ts, with resource-folder tenant isolation coverage.

## high: Activity redaction bypasses object-level access checks

id: fnd_sig-feat-library-8bc0d8327d-e50a_39c8b877aa
category: security
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/api-server/src/lib#1 (feat_library_8bc0d8327d)

evidence:
- artifacts/api-server/src/lib/activity-visibility.ts:145-163 (canViewFileForActivity)
- artifacts/api-server/src/lib/activity-visibility.ts:166-182 (visibleScheduleItemIds)
- artifacts/api-server/src/lib/activity-visibility.ts:185-202 (canViewDailyLogForActivity)
- artifacts/api-server/src/lib/activity-visibility.ts:218-242 (redactActivityRowForAuth)
- artifacts/api-server/src/lib/authorization.ts:836-857 (assertCanViewDailyLog)
- artifacts/api-server/src/lib/authorization.ts:927-940 (assertCanViewScheduleItem)

The activity redaction path reimplements access with narrower predicates than the canonical authorization helpers. File activity checks only folder permission JSON, schedule activity checks only schedule visibility flags, and daily-log activity checks only published/private flags; none of these paths enforce the job, lead, or active-organization access required by assertCanViewDailyLog and assertCanViewScheduleItem. As a result, activity rows or realtime payloads for public/internal objects can be exposed to users who cannot access the underlying job or tenant.

recommendation:
Have activity redaction use the canonical assertCanViewFile/assertCanViewFolder/assertCanViewDailyLog/assertCanViewScheduleItem behavior and translate 403/404 into null, or make the activity SQL predicates include the same job/lead/organization scoping as those helpers.

test analysis:
No included test exercises activity-visibility redaction, realtime payload filtering, or cross-job/tenant activity leakage.

suggested regression test:
Create activity for an org B job daily log, schedule item, and file with broad internal/public flags; authenticate a user in org A or a user without job access and verify redactActivityRowForAuth and redactRealtimePayloadForAuth return null.

minimum fix scope:
artifacts/api-server/src/lib/activity-visibility.ts and authorization-aligned regression tests for file, daily-log, and schedule activity redaction.

## high: Admin manage helpers bypass active-organization checks

id: fnd_sig-feat-library-8bc0d8327d-f413_6e9ee21240
category: security
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/api-server/src/lib#1 (feat_library_8bc0d8327d)

evidence:
- artifacts/api-server/src/lib/authorization.ts:321-337 (assertCanAccessJob)
- artifacts/api-server/src/lib/authorization.ts:408-413 (assertCanManageJob)
- artifacts/api-server/src/lib/authorization.ts:416-432 (assertCanAccessLead)
- artifacts/api-server/src/lib/authorization.ts:442-445 (assertCanManageLead)

The read helpers for admin users verify the target row belongs to the active organization, but the manage helpers return immediately for any admin. In this SaaS workspace, admin is tenant-admin, not global admin. Any route that uses assertCanManageJob or assertCanManageLead as its authorization gate can let a tenant admin modify or purge a job or lead from another organization by supplying its id.

recommendation:
Make manage helpers validate target access before granting admin manage rights, for example by calling assertCanAccessJob/auth-scoped job lookup in assertCanManageJob and assertCanAccessLead in assertCanManageLead before returning for admins.

test analysis:
The included tests cover token secrets, auth route exposure, at-risk pure helpers, and filename sanitization; they do not exercise authorization helpers or tenant-admin manage behavior.

suggested regression test:
Seed two organizations with an admin authenticated in org A, then assert that assertCanManageJob and assertCanManageLead reject org B record ids with 403 or 404.

minimum fix scope:
artifacts/api-server/src/lib/authorization.ts plus focused tenant-isolation tests for job and lead manage paths.

## high: Tenant scope helper fails open when auth has no active organization

id: fnd_sig-feat-library-8f1e0df2e4-1b9a_e6f075c152
category: security
confidence: medium
triage: risk
status: open
feature: Node source artifacts/api-server/src/lib#3 (feat_library_8f1e0df2e4)

evidence:
- artifacts/api-server/src/lib/tenant-scope.ts:5-6 (getActiveOrganizationId)
- artifacts/api-server/src/lib/tenant-scope.ts:13-14 (organizationScopeCondition)

The tenant predicate returns undefined when the authenticated context lacks organizationId. In Drizzle query builders, callers commonly pass optional predicates into and(...), so undefined means no tenant filter rather than a deny condition. Since organizationId is optional in auth contexts during migration, any route relying on this helper as its organization boundary can become globally scoped for a legacy or malformed authenticated request.

recommendation:
Fail closed when an authenticated request has no active organization. Either throw a 403/HttpError from the helper or return an always-false SQL predicate, and introduce a separately named helper for the few legacy/global paths that intentionally allow unscoped access.

test analysis:
The included tests exercise spreadsheet parsing and upload validation only; there is no tenant-scope test for a request whose auth exists but organizationId is missing.

suggested regression test:
Add a tenant-scope or route-level test that authenticates without organizationId and verifies tenant-scoped list/read queries return 403 or no rows rather than all organizations' rows.

minimum fix scope:
artifacts/api-server/src/lib/tenant-scope.ts plus any callers that intentionally need legacy unscoped behavior.

## medium: Legitimate filenames containing double dots are rejected as invalid stored URLs

id: fnd_sig-feat-library-8f1e0df2e4-60d9_88d22430f7
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/api-server/src/lib#3 (feat_library_8f1e0df2e4)

evidence:
- artifacts/api-server/src/lib/storage.ts:45-50 (fileUrlToRelativePath)
- artifacts/api-server/src/lib/storage.ts:110-116 (normalizeFileComponent)
- artifacts/api-server/src/lib/storage.ts:161-167 (buildStoredFileName)

buildStoredFileName preserves dots in the normalized basename, so an ordinary upload such as invoice..final.pdf can produce a stored filename containing '..'. Later storage path resolution rejects any relative path containing '..' anywhere, not just traversal path segments, causing writes/reads/deletes for those legitimate files to fail as invalid stored file URLs.

recommendation:
Normalize or collapse consecutive dots in stored filename components, or change fileUrlToRelativePath to reject only actual traversal segments after splitting the path. Keep rejecting '.', '..', absolute paths, NULs, and encoded traversal equivalents.

test analysis:
The included upload tests use simple fixture names like doc.pdf, photo.jpg, and logo.svg; they do not exercise storage path generation with valid filenames that contain consecutive dots.

suggested regression test:
Add a storage test for buildStoredFileName('invoice..final.pdf') followed by buildUploadPath and a stubbed writeUploadedBuffer/fetch path, asserting the generated URL is accepted and cannot traverse directories.

minimum fix scope:
artifacts/api-server/src/lib/storage.ts path validation and/or filename normalization.

## medium: SVG safety scan can miss scripts placed after the first 64 KB

id: fnd_sig-feat-library-8f1e0df2e4-9d5b_0d8014368a
category: security
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/api-server/src/lib#3 (feat_library_8f1e0df2e4)

evidence:
- artifacts/api-server/src/lib/upload-magic-bytes.ts:488-501 (validateSvg)
- artifacts/api-server/src/lib/upload-magic-bytes.ts:507-513 (validateSvg)
- artifacts/api-server/test/upload-magic-bytes.test.ts:542-551

validateSvg only reads the first 64 KB and then applies the forbidden-pattern checks to that prefix. A valid SVG can include a root element early and place an inline script, event handler, foreignObject, or javascript: URL later in the file, bypassing the upload-time SVG safety gate while the existing test only covers a tiny SVG with the script near the start.

recommendation:
Inspect the entire SVG up to the upload size limit using streaming text scanning, or reject SVGs whose full contents cannot be scanned. At minimum, continue reading after root detection and scan all chunks for the forbidden constructs before accepting the file.

test analysis:
The included SVG tests use small safe/unsafe fixtures; they do not include a padded SVG where the dangerous content appears beyond SVG_SCAN_BYTES.

suggested regression test:
Add an upload-magic-bytes test that builds an SVG with a valid <svg> root, more than 64 KB of harmless padding, and then a <script> tag, and assert it returns UPLOAD_SVG_UNSAFE.

minimum fix scope:
artifacts/api-server/src/lib/upload-magic-bytes.ts SVG validation and the associated upload-magic-bytes test fixtures.

## medium: Generated request body contracts accept arbitrary objects

id: fnd_sig-feat-library-8f23e7c835-be6a_cf5f646fff
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: Node source lib/api-zod/src/generated/types#8 (feat_library_8f23e7c835)

evidence:
- lib/api-zod/src/generated/types/filesRenameFileSchema.ts:12-14 (FilesRenameFileSchema)
- lib/api-zod/src/generated/types/foldersFolderBodySchema.ts:12-14 (FoldersFolderBodySchema)
- lib/api-zod/src/generated/types/foldersFolderUpdateSchema.ts:12-14 (FoldersFolderUpdateSchema)
- lib/api-zod/src/generated/types/foldersMoveFolderSchema.ts:12-14 (FoldersMoveFolderSchema)

These exported API request body types are documented as derived from concrete server-side schemas, but they expose only an unrestricted string index signature. As a result, callers of the generated API/Zod package get no compile-time contract for rename, create-folder, update-folder, or move-folder payloads, and invalid bodies such as missing required fields or misspelled property names type-check until the server rejects them at runtime. The linked OpenAPI components are similarly generic, so this appears to be a source contract generation gap rather than a harmless local alias.

recommendation:
Fix the OpenAPI schema generation for zod-derived request bodies so these components include their real properties, required fields, enum/nullability constraints, and additionalProperties behavior, then regenerate `@workspace/api-zod` and related generated clients.

test analysis:
The feature lists no linked tests, and the generated artifacts do not include a drift/assertion test proving that zod-derived request body components are expanded into concrete OpenAPI schemas.

suggested regression test:
Add a codegen or API-spec test that asserts `files_renameFileSchema` requires `originalName`, `folders_folderBodySchema` requires `title` and `mediaType`, `folders_folderUpdateSchema` exposes permission/title fields, and `folders_moveFolderSchema` exposes `destinationFolderId`; then run the generated TypeScript output through type assertions rejecting invalid payload shapes.

minimum fix scope:
OpenAPI/zod schema extraction for the affected request body components plus regenerated generated files.

repro:
Type-check any generated client call using one of these bodies with an empty or unrelated object; for example a folder creation body of `{}` satisfies `FoldersFolderBodySchema` because the interface has no required properties.

## high: Direct upload downloads can bypass tenant isolation for resource files

id: fnd_sig-feat-library-9dbbbaa277-6cfb_73530fe663
category: security
confidence: medium
triage: risk
status: open
feature: Node source artifacts/api-server/src (feat_library_9dbbbaa277)

evidence:
- artifacts/api-server/src/app.ts:147-157
- artifacts/api-server/src/app.ts:158-165

The route attaches an active organization, but the owned code never constrains the direct /uploads lookup to that organization. It authorizes and then fetches metadata by fileUrl alone. In the current linked authorization/file-manager code, resource-folder access falls back to folder permissions such as internal and does not enforce organization ownership, so a user from another tenant who learns a resource file URL can be authorized and streamed the object. Tenant isolation is explicitly a security boundary for this workspace, so path knowledge must not be enough across organizations.

recommendation:
Make upload-path authorization and the metadata lookup tenant-scoped. Prefer resolving the file row once by fileUrl plus active organization, returning the authorized file id/metadata from the authorization path, and streaming only that resolved row. Resource folders should carry and enforce organizationId before production multi-tenancy.

test analysis:
No tests are linked for this feature. The existing upload smoke coverage only checks that unauthenticated /uploads requests return 401; it does not create two organizations or exercise direct resource-file URLs across tenants.

suggested regression test:
Add an API test that creates two organizations, a resource folder/file in org A, authenticates a user whose active organization is org B, and asserts GET /uploads/<orgA-resource-path> returns 403 or 404 while an org A user can fetch it.

minimum fix scope:
artifacts/api-server/src/app.ts plus the upload-path authorization/file access lookup that backs assertCanAccessUploadPath.

repro:
Create org A and org B. In org A, upload a resource-folder document whose fileUrl is /uploads/organizations/<orgA>/resources/document/<name>. Authenticate as an active org B user with an internal role and request that URL via GET /uploads/organizations/<orgA>/resources/document/<name>. The route should return 403 or 404, but the current path-only authorization/lookup path can allow the stream.

## medium: Boot-time migrations can race across multiple server instances

id: fnd_sig-feat-library-9dbbbaa277-a42a_ca536721dc
category: concurrency
confidence: medium
triage: risk
status: open
feature: Node source artifacts/api-server/src (feat_library_9dbbbaa277)

evidence:
- artifacts/api-server/src/index.ts:59-68 (bootstrap)
- artifacts/api-server/src/index.ts:99-103 (bootstrap)

Every process applies pending migrations during bootstrap before binding the HTTP server. In a rolling or autoscaled deployment, two fresh instances can execute this block against the same database at the same time. The owned code does not establish a deployment-wide lock around applyMigrations before calling it, so concurrent bootstraps can both observe a migration as pending and then contend on DDL or the migrations ledger insert, causing one instance to fail startup or leaving partially-applied idempotent DDL paths dependent on migration details.

recommendation:
Serialize boot-time migrations with a database advisory lock or move migration execution to a single deploy job. If keeping boot-time migration, acquire the lock before reading pending migration state and release it after all migrations are committed; other instances should wait and then re-read the ledger.

test analysis:
No tests are linked for this feature. Existing migration-runner coverage is single-process and does not exercise two bootstraps or two pools applying the same pending migration concurrently.

suggested regression test:
Add a migration-runner or bootstrap-level test that starts two applyMigrations calls against the same test database with a deliberately delayed migration and asserts both complete cleanly with only one ledger insert per migration.

minimum fix scope:
artifacts/api-server/src/index.ts and/or lib/db/src/migrate.ts to add cross-process database locking around the migration application.

repro:
Deploy or start two api-server processes simultaneously against a database with at least one pending migration. Both enter bootstrap and call applyMigrations before either binds; one process can fail on DDL conflicts or the workspace_schema_migrations filename uniqueness insert after the other commits.

## medium: Date-only lead field is generated as Date instead of a wire-safe YYYY-MM-DD string

id: fnd_sig-feat-library-a40619dffb-5980_8559517713
category: api-contract
confidence: medium
triage: contract-mismatch
status: open
feature: Node source lib/api-zod/src/generated/types#13 (feat_library_a40619dffb)

evidence:
- lib/api-zod/src/generated/types/leadListItem.ts:27 (LeadListItem.projectedSalesDate)

projectedSalesDate is a calendar-date field, but this generated type exposes it as Date. Consumers of @workspace/api-zod can treat a date-only API value as a timestamp object, which risks timezone day shifts and can lead callers to send ISO timestamps back to endpoints that expect YYYY-MM-DD strings. This also diverges from the generated React client types in this workspace, which expose the same lead list field as string|null.

recommendation:
Change the OpenAPI/source schema for projectedSalesDate responses so generated api-zod types keep this field as a YYYY-MM-DD string, then regenerate generated clients/schemas.

test analysis:
No tests are linked for this feature, and codegen drift checks would not catch the semantic mismatch because the generated file is internally consistent with the current spec.

suggested regression test:
Add an API contract/codegen test asserting LeadListItem.projectedSalesDate is typed and validated as a YYYY-MM-DD string, not Date.

minimum fix scope:
OpenAPI schema for lead list response projectedSalesDate plus regenerated api-zod/api-client outputs.

## low: Lead contact create type accepts bodies the documented API contract rejects

id: fnd_sig-feat-library-a40619dffb-ed40_5fefc29411
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: Node source lib/api-zod/src/generated/types#13 (feat_library_a40619dffb)

evidence:
- lib/api-zod/src/generated/types/leadsContactCreateSchema.ts:9-10 (LeadsContactCreateSchema)
- lib/api-zod/src/generated/types/leadsContactCreateSchema.ts:14-25 (LeadsContactCreateSchema)

The generated interface documents a conditional requirement: either sourceContactId is present, or displayName and email are required. The actual type makes all three optional, so TypeScript consumers can construct {} or {displayName:null,email:null} as valid create bodies even though the documented API contract says those requests are invalid. That weakens the generated package as a contract boundary and pushes failures to runtime 400s.

recommendation:
Represent the request body as a union/discriminated shape in the OpenAPI source if possible, or add a hand-authored exported helper type that enforces sourceContactId vs displayName/email before callers submit contact create requests.

test analysis:
No tests are linked for this generated type group, and plain codegen checks only verify that generated files match the current spec, not that the spec models the conditional requirement described in its own documentation.

suggested regression test:
Add a type-level/API contract test that rejects a LeadsContactCreateSchema value without sourceContactId and without non-null displayName/email, while accepting the clone and manual-create variants.

minimum fix scope:
Lead contact create request schema/type generation and associated contract test.

## low: Generated ApiError classification ignores problem+json detail/title messages

id: fnd_sig-feat-library-a42ba23c9b-1134_67c09910ef
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: Node source artifacts/cadstone/src/lib#1 (feat_library_a42ba23c9b)

evidence:
- artifacts/cadstone/src/lib/api-errors.ts:10-12
- artifacts/cadstone/src/lib/api-errors.ts:21-35 (classifyGeneratedApiError)
- artifacts/cadstone/src/lib/agent-api.ts:193-198 (streamSendMessage)
- artifacts/cadstone/src/lib/api-errors.test.ts:90-99

The generated-client branch explicitly handles problem+json data, but only reads data.message. Problem+json commonly carries user-facing text in detail or title, and another owned caller already parses detail/title for API errors. For generated mutation hooks, a 4xx ApiError with { detail: 'Email already taken' } falls through to the caller fallback instead of showing the server-provided reason.

recommendation:
In classifyGeneratedApiError, extract the first non-empty string from message, detail, then title before falling back. Keep the 401/403 marker behavior unchanged.

test analysis:
api-errors.test builds only AxiosError instances for server-message cases. It never constructs an imported ApiError, and the covered payload uses message rather than problem+json detail/title.

suggested regression test:
Add classifyApiError tests for ApiError status 422 with data.detail, data.title, and blank values, asserting generated errors preserve server problem text before using the fallback.

minimum fix scope:
artifacts/cadstone/src/lib/api-errors.ts and artifacts/cadstone/src/lib/api-errors.test.ts.

repro:
Construct an ApiError with status 422 and data { detail: 'Email already taken' }, then pass it to classifyApiError(err, 'Could not save'). The result is { kind: 'toast', message: 'Could not save' } instead of the problem detail.

## medium: Agent message streaming bypasses the normal 401 refresh and retry path

id: fnd_sig-feat-library-a42ba23c9b-c973_3727d3b9eb
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/cadstone/src/lib#1 (feat_library_a42ba23c9b)

evidence:
- artifacts/cadstone/src/lib/agent-api.ts:173-185 (streamSendMessage)
- artifacts/cadstone/src/lib/agent-api.ts:193-203 (streamSendMessage)
- artifacts/cadstone/src/lib/api.ts:112-130 (initializeInterceptors)
- artifacts/cadstone/src/lib/api.ts:194-202 (refreshSession)

streamSendMessage uses raw fetch because EventSource cannot send Authorization, but it only reads the current access token once. Unlike axios calls, a 401 response is surfaced directly to the UI and never calls refreshSession or retries with the refreshed token. Users with an expired access token but valid refresh cookie can keep using normal API calls while agent sends fail until some other path refreshes auth.

recommendation:
Import/use refreshSession in streamSendMessage. On the first 401 from the streaming POST, refresh once, rebuild the Authorization header from the returned token, and retry the streaming request before surfacing an error. Preserve abort handling across the retry.

test analysis:
The included tests cover API error classification, role access, uploads, percent math, and a schedule e2e flow, but there is no test for agent-api streaming or expired-token recovery.

suggested regression test:
Add a streamSendMessage unit test with mocked fetch returning 401 then a valid SSE response, and mocked refreshSession returning a new token; assert the second request uses the refreshed Authorization header and emits events.

minimum fix scope:
artifacts/cadstone/src/lib/agent-api.ts plus a focused test for the 401 refresh/retry branch.

repro:
Let the access token expire while the refresh cookie is still valid, then submit an agent message. The POST returns 401, streamSendMessage calls onError/onDone, and no retry is attempted; an axios-backed request in the same state would refresh and retry.

## medium: Yearly workday exceptions do not match ranges that cross New Year

id: fnd_sig-feat-library-a42ba23c9b-ecd4_27794b878e
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/cadstone/src/lib#1 (feat_library_a42ba23c9b)

evidence:
- artifacts/cadstone/src/lib/schedule.ts:325-329 (dateMatchesException)
- artifacts/cadstone/tests/e2e/schedule.spec.ts:41-128

For sameEveryYear exceptions the comparison is lexicographic on MM-DD strings. A recurring range such as Dec 24 through Jan 2 has start='12-24' and end='01-02', so no date can satisfy value >= start && value <= end. That makes recurring holiday shutdowns or other annual non-workday/extra-workday periods spanning New Year invisible to classifyWorkday, calculateBusinessEndDate, and calculateWorkDaysBetween.

recommendation:
Teach dateMatchesException to handle same-year comparable ranges where start > end as a wraparound interval, e.g. value >= start || value <= end. Keep the existing inclusive behavior for non-wrapping ranges.

test analysis:
The included schedule e2e test only creates, reschedules, and completes one item through the API; it does not exercise classifyWorkday or recurring workday exceptions, especially a Dec/Jan range.

suggested regression test:
Add schedule helper unit coverage for sameEveryYear exceptions where startDate slices after endDate, asserting both late-December and early-January dates match and a mid-year date does not.

minimum fix scope:
artifacts/cadstone/src/lib/schedule.ts dateMatchesException plus a focused schedule helper test.

repro:
Call classifyWorkday(new Date('2026-12-31T00:00:00'), [{ id:'x', title:'Holiday shutdown', type:'non_workday', startDate:'2026-12-24', endDate:'2027-01-02', sameEveryYear:true, categoryId:null, categoryName:null, appliesToAllJobs:true, jobIds:[], notes:null }]). It returns the default weekday classification instead of the exception.

## medium: Generated type models JSON timestamp as Date

id: fnd_sig-feat-library-a6a21e81e1-5b5a_ea9450d77d
category: api-contract
confidence: medium
triage: contract-mismatch
status: open
feature: Node source lib/api-zod/src/generated/types#1 (feat_library_a6a21e81e1)

evidence:
- lib/api-zod/src/generated/types/adminRecentLead.ts:16 (AdminRecentLead.createdAt)

This generated API type claims `createdAt` is a `Date`, but API responses over JSON carry timestamps as strings unless the generated client explicitly deserializes them. A consumer typed against `AdminRecentLead` can call Date methods or pass the value to code requiring a Date while the runtime value from `fetch`/JSON parsing is still a string, causing crashes or subtle formatting bugs. The surrounding generated types use plain type-only declarations and do not show any runtime transformation in this owned group.

recommendation:
Regenerate this schema so date-time response fields are typed as `string`, or add/verify a generated runtime transformer that converts this field to `Date` before exposing it under `AdminRecentLead`. Keep the OpenAPI contract and generated client behavior consistent.

test analysis:
No linked tests were provided for this generated type group, and type-only tests would not catch the runtime JSON/string mismatch unless they assert the generated contract or parse a fixture response.

suggested regression test:
Add an API-codegen contract test that asserts `AdminRecentLead.createdAt` is typed according to the actual generated client behavior, preferably using a fixture JSON response from the admin home endpoint.

minimum fix scope:
OpenAPI schema/codegen configuration for this field plus regenerated `lib/api-zod` outputs.

## medium: Custom range selection issues report requests without required dates

id: fnd_sig-feat-library-a7c3a67c65-6f3e_5406a64d7f
category: bug
confidence: medium
triage: risk
status: open
feature: Node source artifacts/cadstone/src/pages/reports (feat_library_a7c3a67c65)

evidence:
- artifacts/cadstone/src/pages/reports/shared.tsx:48-51 (ReportToolbar)
- artifacts/cadstone/src/pages/reports/shared.tsx:155-160 (rangeToReportParams)
- artifacts/cadstone/src/pages/reports/revenue.tsx:28 (RevenueReport)
- artifacts/cadstone/src/pages/reports/pipeline.tsx:29 (PipelineReport)
- artifacts/cadstone/src/pages/reports/days-to-payment.tsx:21 (DaysToPaymentReport)

Selecting the Custom preset immediately updates report state to { range: "custom" } even when both date inputs are still blank. rangeToReportParams then sends only range=custom, so the active report query and CSV URL can request a custom report without from/to. If the API requires explicit bounds for custom ranges, the UI enters an avoidable error state before the user can finish entering dates; if the API falls back to defaults, the screen and export silently no longer reflect the user's selected range.

recommendation:
Do not issue custom report requests until both dates are present, or keep the previous non-custom range active until the user supplies a complete custom range. Also disable or withhold the CSV href for incomplete custom ranges so export behavior matches the visible report.

test analysis:
No tests are included for the report toolbar or custom range query-param generation.

suggested regression test:
Render a range-based report, select Custom with empty dates, and assert the report hook is not called with { range: "custom" } until both from and to are populated; also assert the CSV URL includes both dates once complete.

minimum fix scope:
Update shared range handling in artifacts/cadstone/src/pages/reports/shared.tsx and the range-based report callers that currently invoke hooks unconditionally.

repro:
Open Revenue, Pipeline, or Days to Payment; change Date range to Custom before choosing dates. The generated query params contain range=custom without from/to, and the report request fires with those incomplete params.

## medium: Device weather fallback requests location even when server weather is available

id: fnd_sig-feat-library-b36586ca45-3558_48bee114fd
category: security
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/cadstone/src/pages/home (feat_library_b36586ca45)

evidence:
- artifacts/cadstone/src/pages/home/MyDayPage.tsx:64-76 (MyDayPage)
- artifacts/cadstone/src/pages/home/MyDayPage.tsx:295-304 (useDeviceForecastFallback)
- artifacts/cadstone/src/pages/home/MyDayPage.tsx:307-313 (useDeviceForecastFallback)

The fallback hook only checks whether a forecast exists, not whether the page already has a server weather log to display. For payloads with forecast=null and weather non-null, the UI can render the weather card, but the effect still prompts for precise device location and sends lat/lng to /weather. That is unnecessary location collection and can replace job/weather-log context with a current-location forecast.

recommendation:
Gate device geolocation behind the absence of both forecast and weather, or behind an explicit user action. If cached device forecasts remain, scope the cache by authenticated user/tenant or clear it on account changes.

test analysis:
No tests were included around the weather fallback branches or geolocation side effects.

suggested regression test:
Add a MyDayPage test with forecast=null and weather populated that stubs navigator.geolocation and asserts getCurrentPosition is not called.

minimum fix scope:
Change MyDayPage/useDeviceForecastFallback to accept a shouldFetch flag based on forecast and weather availability, then cover the branch with a focused test.

repro:
Load My Day with forecast null and weather populated. The page displays the weather log path, but the effect still invokes navigator.geolocation and, if allowed, requests /weather with the device coordinates.

## medium: PM home can crash when at-risk samples are absent

id: fnd_sig-feat-library-b36586ca45-7e96_ac84d5e634
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/cadstone/src/pages/home (feat_library_b36586ca45)

evidence:
- artifacts/cadstone/src/pages/home/PMHomePage.tsx:85-87 (PMHomePage)
- artifacts/cadstone/src/pages/home/PMHomePage.tsx:93-103 (PMHomePage)
- artifacts/cadstone/src/pages/home/types.ts:70-84 (PmHome)

PMHomePage unconditionally dereferences atRisk.samples.overdue, missingLogJobs, and pendingChangeOrders. The frontend type expects samples to be an object, but the inspected dashboard home backend has a no-accessible-jobs path that returns samples as an empty array. A PM with no accessible jobs can therefore receive a PM payload that renders into undefined.map and crashes the Home page.

recommendation:
Normalize the dashboard payload so samples is always { overdue: [], missingLogJobs: [], pendingChangeOrders: [] }, and optionally defensively default samples in PMHomePage before rendering.

test analysis:
No PM home tests were included for the zero-accessible-jobs payload shape, and the client-side narrowed type masks the backend mismatch.

suggested regression test:
Add a PM home render test using a zero-count payload with empty sample arrays, plus an API test that /dashboard/home returns the documented samples object for PM users with no accessible jobs.

minimum fix scope:
Fix the dashboard home PM zero-jobs response shape or add a local normalization guard in PMHomePage; backend normalization is the stronger contract fix.

repro:
Use a PM account with zero accessible jobs and load Home; the PM payload reaches PMHomePage, then the first tooltip expression tries atRisk.samples.overdue.map and throws.

## medium: Open leads drill-down always requests an invalid page size

id: fnd_sig-feat-library-b36586ca45-c944_4b195ea492
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: Node source artifacts/cadstone/src/pages/home (feat_library_b36586ca45)

evidence:
- artifacts/cadstone/src/pages/home/MobileDrillTile.tsx:258-266 (OpenLeadsDrill)
- artifacts/cadstone/src/pages/home/AdminHomePage.tsx:42-49 (AdminHomePage)
- artifacts/cadstone/src/pages/home/PMHomePage.tsx:55-61 (PMHomePage)

The mobile open-leads sheet hard-codes pageSize=200. The inspected /leads API contract and route validation cap pageSize at 100, so tapping this tile on mobile sends an invalid request and falls into the catch path, showing "Couldn't load leads." instead of the drill-down list.

recommendation:
Use a contract-valid request, preferably the generated client or api.get("/leads", { params: { pageSize: 100, status: "open" } }), and paginate if the drill-down needs more than one page.

test analysis:
No tests were included for the home mobile drill-downs or for validating their API request parameters against the generated contract.

suggested regression test:
Add a MobileDrillTile/OpenLeadsDrill test that opens the sheet, asserts the request uses a valid pageSize, and verifies leads render instead of the error state.

minimum fix scope:
Update OpenLeadsDrill request parameters and add focused coverage for the open-leads sheet.

repro:
Open Home on a mobile viewport as an admin or PM, tap the Open leads tile, and observe GET /leads?pageSize=200 returning 400 with the sheet showing the load error.

## medium: Cursor-enabled schedule request has no cursor pagination response type

id: fnd_sig-feat-library-b491d29e2b-5de8_7a1f0548c8
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: Node source lib/api-zod/src/generated/types#18 (feat_library_b491d29e2b)

evidence:
- lib/api-zod/src/generated/types/scheduleGetJobsJobIdScheduleParams.ts:23-32 (ScheduleGetJobsJobIdScheduleParams)
- lib/api-zod/src/generated/types/scheduleListResponse.ts:11-14 (ScheduleListResponse)
- lib/api-zod/src/generated/types/scheduleListResponsePagination.ts:9-14 (ScheduleListResponsePagination)

The generated params explicitly expose cursor mode and document that callers should read and echo pagination.nextCursor, but the generated ScheduleListResponse type always uses the offset-only pagination shape with required page, totalItems, and totalPages and no hasMore or nextCursor. Any TypeScript or Zod consumer of this generated contract will reject or be unable to type cursor responses from the same endpoint.

recommendation:
Model ScheduleListResponse.pagination as a union of the offset pagination shape and CursorPagination for schedule list endpoints that accept cursor, then regenerate the generated api-zod and client artifacts from the OpenAPI source.

test analysis:
The feature lists no linked tests, and a static type/codegen check would not fail if the OpenAPI source generated this internally inconsistent contract.

suggested regression test:
Add a contract/codegen test that asserts GET /jobs/{jobId}/schedule with a cursor parameter has a response pagination schema including hasMore and nextCursor, or a union with CursorPagination, and that generated types expose those fields.

minimum fix scope:
Update the ScheduleListResponse pagination schema in the API spec and regenerate the generated type and Zod artifacts.

## low: Toast close button has no accessible name

id: fnd_sig-feat-library-bdb1316a8d-6883_48ad95d6c5
category: bug
confidence: medium
triage: risk
status: open
feature: Node source artifacts/cadstone/src/components/ui#5 (feat_library_bdb1316a8d)

evidence:
- artifacts/cadstone/src/components/ui/toast.tsx:75-85 (ToastClose)
- artifacts/cadstone/src/components/ui/toaster.tsx:26 (Toaster)

The shared ToastClose renders only an X icon and the app-level Toaster uses it without passing aria-label, title text, or sr-only text. That leaves the close control unnamed for screen-reader users, so dismissing toasts is not discoverable through assistive technology.

recommendation:
Give ToastClose a default accessible name, for example aria-label="Close" on the Radix close primitive or a visually hidden "Close" text node inside the button, while still allowing callers to override it via props if needed.

test analysis:
No linked tests were included for these UI primitives, and the package test command only targets src/**/*.test.ts; there is no evidence of an accessibility assertion for rendered toast controls.

suggested regression test:
Render Toaster with a toast and assert the close button is discoverable by role and accessible name, e.g. getByRole('button', { name: /close/i }).

minimum fix scope:
Update ToastClose in artifacts/cadstone/src/components/ui/toast.tsx and add/adjust a focused UI test for the toast close control.

## medium: Completing a personal to-do sends a partial full-item update that resets schedule fields

id: fnd_sig-feat-library-c6278f7252-9b5c_cdc0eb1807
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/cadstone/src/pages/job-schedule/dialogs (feat_library_c6278f7252)

evidence:
- artifacts/cadstone/src/pages/job-schedule/dialogs/TodosSheet.tsx:112-124 (handleTogglePersonalTodo)
- artifacts/cadstone/src/pages/job-schedule/dialogs/TodosSheet.tsx:91-101 (handleAddPersonalTodo)

The create path deliberately sets personal to-dos to `showOnGantt: false`, but the completion toggle PUT only sends a small subset of the schedule item fields. The server's PUT /schedule-items/{id} uses the same full schedule payload as create and applies defaults for omitted fields, so this toggle can reset omitted properties such as showOnGantt, display color, phase, tags, predecessors, reminder, and visibility. The immediate user-visible regression is that checking off a personal to-do can make it appear on the Gantt timeline even though the panel says personal to-dos are only visible to the current user and the create path excludes them from Gantt.

recommendation:
Send a complete schedule-item payload when toggling, preserving all existing mutable fields from the item, or add/use a narrow completion endpoint that only updates `isComplete` and `progress`. At minimum preserve `showOnGantt: item.showOnGantt ?? false`, visibility flags, displayColor, reminder, tags, predecessors, phaseId, notes, and any other fields required by the full PUT contract.

test analysis:
The feature declares no linked tests, and the existing dialog code has no regression coverage for the exact PUT payload emitted by the personal to-do checkbox.

suggested regression test:
Add a component or route-level regression test that creates a personal to-do with `showOnGantt: false` plus non-default metadata, toggles completion through the sheet, and asserts the outgoing update or persisted item preserves all unrelated fields.

minimum fix scope:
Update `TodosSheet.handleTogglePersonalTodo` to call a narrow completion API or build a full preserving payload; add focused regression coverage for toggling personal to-dos.

repro:
Create a personal to-do from the sheet, then toggle its checkbox. Inspect the subsequent PUT payload: it omits showOnGantt and other existing fields, so the backend applies its defaults during the full update.

## low: Rapid phase additions can share the same temporary id and update together

id: fnd_sig-feat-library-c6278f7252-f62f_7fcee42d7a
category: bug
confidence: medium
triage: risk
status: open
feature: Node source artifacts/cadstone/src/pages/job-schedule/dialogs (feat_library_c6278f7252)

evidence:
- artifacts/cadstone/src/pages/job-schedule/dialogs/SettingsDialog.tsx:132-145 (SettingsDialog)
- artifacts/cadstone/src/pages/job-schedule/dialogs/SettingsDialog.tsx:162-188 (SettingsDialog)

New phases use `Date.now()` as the only uniqueness source, and later edits identify rows by that id. If two Add Phase actions land in the same millisecond, React receives duplicate keys and each name/color edit maps over both matching ids, causing the two draft phases to mirror each other and potentially save duplicate or wrong phase records.

recommendation:
Use a collision-resistant client id for unsaved phases, such as `crypto.randomUUID()` where available or a monotonic counter/ref scoped to the dialog instance.

test analysis:
No linked tests exercise repeated Add Phase interactions or assert uniqueness of client-side draft phase ids.

suggested regression test:
Add a SettingsDialog test that forces `Date.now()` to return a constant, clicks Add Phase twice, edits one row, and asserts only that row changes after the fix.

minimum fix scope:
Replace the temporary phase id generation in `SettingsDialog` with a guaranteed-unique id source and cover duplicate-id behavior.

repro:
Trigger the Add Phase button twice within one millisecond, for example via a double activation or synthetic click loop, then edit one of the two new rows. Both rows with the same temporary id are treated as the same row.

## low: Custom report range params are typed as valid without required dates

id: fnd_sig-feat-library-ca46e5b43a-3504_2261c9d5aa
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: Node source lib/api-zod/src/generated/types#17 (feat_library_ca46e5b43a)

evidence:
- lib/api-zod/src/generated/types/reportsGetReportsArAgingParams.ts:13-27 (ReportsGetReportsArAgingParams)
- lib/api-zod/src/generated/types/reportsGetReportsDaysToPaymentParams.ts:13-27 (ReportsGetReportsDaysToPaymentParams)
- lib/api-zod/src/generated/types/reportsGetReportsJobsByStageParams.ts:13-27 (ReportsGetReportsJobsByStageParams)
- lib/api-zod/src/generated/types/reportsGetReportsPipelineParams.ts:13-27 (ReportsGetReportsPipelineParams)
- lib/api-zod/src/generated/types/reportsGetReportsRevenueParams.ts:13-27 (ReportsGetReportsRevenueParams)

Each report params type documents that `from` and `to` are required when `range=custom`, but the generated TypeScript contract makes both fields optional unconditionally. A consumer can therefore compile calls such as `{ range: "custom" }` for these endpoints even though the documented API contract requires dates, pushing the error to runtime/server validation instead of catching it at the generated API boundary.

recommendation:
Model the report query as a discriminated union or update the OpenAPI source/codegen so `range: "custom"` requires `from` and `to`, while preset ranges keep them optional. Regenerate these generated files rather than editing them manually.

test analysis:
The feature lists no linked tests, and normal typecheck only verifies that the generated declarations compile; it does not include negative type tests for invalid API parameter combinations.

suggested regression test:
Add a type-level regression test or generated-code snapshot asserting that `{ range: "custom" }` is rejected for each report params type unless both `from` and `to` are present.

minimum fix scope:
Update the source OpenAPI/codegen representation for the shared report range query parameters and regenerate the api-zod generated types.

repro:
Assign `const params: ReportsGetReportsRevenueParams = { range: "custom" };` in a TypeScript consumer. It typechecks despite the generated documentation requiring both `from` and `to` for custom ranges.

## medium: Client picker cannot find clients beyond the first 100 returned rows

id: fnd_sig-feat-library-cbe0c767fa-df01_c7de03c16d
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/cadstone/src/components/dashboard (feat_library_cbe0c767fa)

evidence:
- artifacts/cadstone/src/components/dashboard/ClientPickerDialog.tsx:52-56 (ClientPickerDialog)
- artifacts/cadstone/src/components/dashboard/ClientPickerDialog.tsx:74-82 (ClientPickerDialog)

The dialog fetches a single fixed page of 100 clients and then performs all searching locally over that truncated array. In a tenant with more than 100 non-archived clients, any client outside the first page is impossible to discover or select from this picker, blocking job creation for that client through this flow.

recommendation:
Drive the picker search from the API using the search query parameter and/or paginate/load all pages until exhausted. At minimum, surface pagination or a server-backed search request so every accessible active client can be selected.

test analysis:
No tests are listed for this feature, and the package test command only covers existing src/**/*.test.ts files. There is no included test exercising picker behavior with more than 100 clients or server-backed search.

suggested regression test:
Add a ClientPickerDialog test that mocks /clients returning a first page without the searched client, enters a search term for a later-page client, and verifies the component issues a server-backed search or pagination request and renders the matching client.

minimum fix scope:
Update ClientPickerDialog data loading/search behavior and add focused component coverage for large client lists.

repro:
Create more than 100 non-archived clients where the desired client sorts outside the first returned page, open the job client picker, and search for that client by company name. The local filter only searches the already-loaded first page, so the client never appears.

## medium: Admin mobile bottom nav can wrap into a second row

id: fnd_sig-feat-library-cc1737eb15-28b4_7194d503eb
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/cadstone/src/components/layout (feat_library_cc1737eb15)

evidence:
- artifacts/cadstone/src/components/layout/MobileBottomNav.tsx:64-81 (MobileBottomNav)
- artifacts/cadstone/src/components/layout/MobileBottomNav.tsx:129-154 (MobileBottomNav)
- artifacts/cadstone/src/components/layout/AppLayout.tsx:28 (AppLayout)

For a non-field user that passes the client and company-view gates, MobileBottomNav renders four primary tabs plus the More button into a four-column grid. The fifth item wraps to a second row, while AppLayout reserves only a single bottom-nav row, so mobile content can be obscured and the nav layout breaks for admin-style users.

recommendation:
Cap the bottom nav to four total items, move one admin tab into More, or make the grid/padding dynamically match the rendered item count.

test analysis:
No linked tests were supplied, and there is no role-specific mobile navigation layout test covering the admin/non-field tab count.

suggested regression test:
Render MobileBottomNav with an admin user at a mobile viewport and assert the primary nav has four total visible cells or that its height matches the reserved AppLayout bottom padding.

minimum fix scope:
Change MobileBottomNav tab composition or grid sizing, and update AppLayout padding if the intended bottom nav height can vary.

repro:
Log in as an admin/non-field user on a <768px viewport. The bottom nav receives Home, Clients, Schedule, Logs, and More, but the grid has only four columns.

## medium: Keyboard shortcuts ignore the role-gated navigation model

id: fnd_sig-feat-library-cc1737eb15-7747_a5bdfc1b3f
category: security
confidence: medium
triage: risk
status: open
feature: Node source artifacts/cadstone/src/components/layout (feat_library_cc1737eb15)

evidence:
- artifacts/cadstone/src/components/layout/KeyboardShortcuts.tsx:37-42 (buildShortcutGroups)
- artifacts/cadstone/src/components/layout/KeyboardShortcuts.tsx:129-145 (handleKeyDown)
- artifacts/cadstone/src/components/layout/TopNav.tsx:61-66 (TopNav)
- artifacts/cadstone/src/components/layout/MobileBottomNav.tsx:64-69 (MobileBottomNav)

The visible navigation deliberately hides client/lead-style routes from field users, but the global shortcut handler still advertises and navigates to those routes for every user. If downstream route guards catch it, field users get an avoidable 403/dead-end; if any target route is missing a guard, the shortcut becomes a client-side permission bypass.

recommendation:
Build shortcut groups and route handling from the same role gates used by the nav, or ignore restricted shortcut sequences for roles that cannot access the target route.

test analysis:
No linked tests were supplied, and there is no keyboard shortcut test that exercises project_manager or crew_member roles against hidden routes.

suggested regression test:
Add a keyboard shortcut test with a field-user auth store that presses g+c and asserts navigation is not attempted and the shortcut help does not list Clients.

minimum fix scope:
Update KeyboardShortcuts to read the current role and gate both displayed shortcuts and key handling for Clients/Leads consistently with the route/nav role model.

repro:
Log in as a project_manager or crew_member, press g then c. The normal nav does not expose Clients, but the shortcut attempts to navigate to /clients.

## medium: Tablet widths lose all primary navigation

id: fnd_sig-feat-library-cc1737eb15-f206_b9c71f606c
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/cadstone/src/components/layout (feat_library_cc1737eb15)

evidence:
- artifacts/cadstone/src/components/layout/TopNav.tsx:151-152 (TopNav)
- artifacts/cadstone/src/components/layout/MobileBottomNav.tsx:123-127 (MobileBottomNav)
- artifacts/cadstone/src/components/layout/Sidebar.tsx:21-23 (AppLayout)

Between the md and lg breakpoints, the mobile bottom nav is already hidden, while both the desktop top navigation and sidebar are still hidden until lg. At widths such as 900px, authenticated users lose the primary route navigation entirely except for incidental controls like logo/account/search.

recommendation:
Align the breakpoints so one primary navigation surface is always visible, for example keep MobileBottomNav visible until lg or show the top nav/sidebar starting at md. Adjust the main bottom padding breakpoint to match the bottom nav visibility.

test analysis:
No linked tests were provided, and the package test script only covers src/**/*.test.ts; there is no responsive layout assertion for md-to-lg widths in the supplied feature.

suggested regression test:
Add a Playwright layout test at a 900px-wide authenticated viewport that asserts at least one primary navigation link such as Jobs or Clients is visible.

minimum fix scope:
Update breakpoint classes in AppLayout, TopNav, and/or MobileBottomNav so navigation visibility and content padding use the same breakpoint contract.

repro:
Open an authenticated app page at a viewport around 900px wide. The top primary nav and sidebar are hidden because they require lg, and the bottom nav is hidden because md:hidden has applied.

## medium: API server typecheck omits two referenced workspace projects

id: fnd_sig-feat-library-d32e142395-14cf_8ac2337d40
category: build-release
confidence: medium
triage: risk
status: open
feature: Node package @workspace/api-server (feat_library_d32e142395)

evidence:
- artifacts/api-server/package.json:14 (scripts.typecheck)
- artifacts/api-server/tsconfig.json:16-20 (references)

The package tsconfig declares project references to ../../lib/integrations-anthropic-ai and ../../lib/mcp-server, but the package-level typecheck script only builds ../../lib/db and ../../lib/api-zod before running tsc -p. TypeScript project references consume referenced project declaration outputs; in a clean checkout or CI cache miss, stale or missing declaration outputs for the omitted references can make @workspace/api-server typechecking fail or typecheck against stale types.

recommendation:
Change the typecheck script to build all referenced projects, or use tsc --build tsconfig.json --noEmit if compatible with the repo's build setup. Keep the script and tsconfig references in sync when adding references.

test analysis:
The feature declares no linked tests, and the manifest script itself is the release/build path under review. Ordinary unit tests would not detect a clean-workspace project-reference build ordering problem unless they execute this package typecheck from a clean output state.

suggested regression test:
Add a CI/package check that removes referenced project build outputs and runs pnpm --filter @workspace/api-server run typecheck.

minimum fix scope:
artifacts/api-server/package.json

repro:
From a clean workspace with no built declaration outputs for lib/integrations-anthropic-ai or lib/mcp-server, run pnpm --filter @workspace/api-server run typecheck.

## low: Root validation script omits required workspace checks

id: fnd_sig-feat-library-d3a8e6ffda-b838_a0a2196f2d
category: build-release
confidence: medium
triage: risk
status: open
feature: Node package workspace (feat_library_d3a8e6ffda)

evidence:
- package.json:19 (scripts.validate)
- AGENTS.md:39-46

The repository instructions define knip and the cadstone eager-bundle check as required checks, but the root validate script only runs typecheck and API codegen verification. Any CI, release, or local workflow that relies on `pnpm validate` can pass while missing dead-code/dependency regressions or eager bundle failures that the project explicitly requires before completion.

recommendation:
Either include `pnpm knip` and `pnpm --filter @workspace/cadstone run check-eager-bundle` in `scripts.validate`, or document that `validate` is intentionally partial and add a separate script for the full required check suite.

test analysis:
No linked tests exercise package scripts or compare the root validation command against the required checks documented in AGENTS.md.

suggested regression test:
Add a package-script policy check that asserts the root full-validation script includes all commands listed as required checks, or update CI to invoke those commands directly.

minimum fix scope:
Root package script configuration in package.json, plus any CI command that currently depends on `pnpm validate`.

## medium: Daily log date query filters reject documented YYYY-MM-DD strings

id: fnd_sig-feat-library-d549797742-52d2_b4b3c029d7
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: Node source lib/api-zod/src/generated (feat_library_d549797742)

evidence:
- lib/api-zod/src/generated/api.ts:3903-3910 (DailyLogsGetJobsJobIdDailyLogsQueryParams)
- lib/api-zod/src/generated/api.ts:5305-5306 (DailyLogsGetDailyLogsFeedQueryParams)

The generated query schemas require actual Date instances, but query parameters arrive as strings and the description explicitly documents YYYY-MM-DD. A valid request like ?from=2026-05-01 will fail generated contract validation unless a caller pre-converts it to Date, which is inconsistent with the URL/query contract and with nearby generated report date filters that validate string dates.

recommendation:
Generate these date query parameters as zod.coerce.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()/nullish(), or otherwise use a shared date-query parser that accepts documented URL string values.

test analysis:
The feature lists no linked tests, and there is no included contract test asserting that daily-log query date strings are accepted.

suggested regression test:
Add contract tests for both daily-log query schemas asserting that { from: "2026-05-01", to: "2026-05-31" } parses successfully and malformed date strings fail.

minimum fix scope:
Fix the OpenAPI/codegen mapping for date query parameters on daily-log endpoints and regenerate the generated Zod schemas.

repro:
DailyLogsGetJobsJobIdDailyLogsQueryParams.safeParse({ from: "2026-05-01" }).success is false even though the field is documented as a YYYY-MM-DD query value.

## medium: Cents fields are generated as unconstrained numbers

id: fnd_sig-feat-library-d549797742-5bca_1cc19de265
category: api-contract
confidence: medium
triage: contract-mismatch
status: open
feature: Node source lib/api-zod/src/generated (feat_library_d549797742)

evidence:
- lib/api-zod/src/generated/api.ts:93-98 (FinancialsPostJobsJobidFinancialsChangeOrdersParseResponse)
- lib/api-zod/src/generated/api.ts:567-581 (ClientsGetClientsResponse)

Money fields named and described as cents should be whole integer amounts, but the generated schemas accept any JavaScript number. Fractional cents such as 12.34 and unsafe integer-sized values would pass generated validation, weakening contract tests and allowing bad API responses or AI-extracted financial data to be treated as valid.

recommendation:
Generate cents and other OpenAPI integer fields with zod.number().int(), plus safe/min/max bounds where the API contract requires them.

test analysis:
The feature lists no linked tests, and the generated schemas shown here do not include integer or safe-integer assertions for cents values.

suggested regression test:
Add contract tests that fractional cents fail for change-order parse responses and client financial rollups, while whole integer cents pass.

minimum fix scope:
Update the api-zod generation/post-processing for integer money fields and regenerate lib/api-zod/src/generated/api.ts.

repro:
FinancialsPostJobsJobidFinancialsChangeOrdersParseResponse.safeParse({ number: "CO-1", description: null, amountCents: 12.34, fileId: null }).success would be true.

## medium: Query boolean schemas coerce "false" to true

id: fnd_sig-feat-library-d549797742-d72e_3b9f7ac6d8
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: Node source lib/api-zod/src/generated (feat_library_d549797742)

evidence:
- lib/api-zod/src/generated/api.ts:224-230 (UsersGetUsersQueryParams)
- lib/api-zod/src/generated/api.ts:5305-5308 (DailyLogsGetDailyLogsFeedQueryParams)

These are URL query schemas, so callers commonly provide string values such as "false". Zod's boolean coercion follows JavaScript truthiness, so any non-empty string, including "false" and "0", parses as true. That makes filters like includeInactive=false, hasAttachments=false, or hasComments=false behave as if the caller requested true.

recommendation:
Generate boolean query parameters with an explicit string-to-boolean parser, for example accepting true/false/1/0 and rejecting other values, instead of zod.coerce.boolean().

test analysis:
The feature lists no linked tests, and the generated schema has no local regression covering false-like query strings.

suggested regression test:
Add contract tests that parse { includeInactive: "false" }, { hasAttachments: "false" }, and { hasComments: "false" } and assert the parsed values are false.

minimum fix scope:
Adjust the api-zod generation/post-processing for boolean query parameters and regenerate lib/api-zod/src/generated/api.ts.

repro:
UsersGetUsersQueryParams.parse({ includeInactive: "false" }).includeInactive evaluates to true; DailyLogsGetDailyLogsFeedQueryParams.parse({ hasAttachments: "false" }).hasAttachments evaluates to true.

## medium: Cursor schedule responses are not represented in the generated response type

id: fnd_sig-feat-library-d6b01cc456-442c_1389855f64
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: Node source lib/api-zod/src/generated/types#18 (feat_library_d6b01cc456)

evidence:
- lib/api-zod/src/generated/types/scheduleGetJobsJobIdScheduleParams.ts:22-32 (ScheduleGetJobsJobIdScheduleParams.cursor)
- lib/api-zod/src/generated/types/scheduleGetJobsJobIdScheduleParams.ts:26-28 (ScheduleGetJobsJobIdScheduleParams.cursor)
- lib/api-zod/src/generated/types/scheduleListResponse.ts:11-14 (ScheduleListResponse)
- lib/api-zod/src/generated/types/scheduleListResponsePagination.ts:9-14 (ScheduleListResponsePagination)

The generated params expose cursor mode and explicitly document a cursor envelope containing pagination.nextCursor, but the generated response type only allows the offset pagination shape with page, limit, totalItems, and totalPages. Consumers using the generated API contract cannot type-safely read hasMore/nextCursor from cursor-mode responses, and validators generated from the same shape will reject or strip the documented cursor envelope depending on usage.

recommendation:
Change the OpenAPI schema behind ScheduleListResponse.pagination to model both offset and cursor envelopes, for example a oneOf/union of {page, limit, totalItems, totalPages} and {limit, hasMore, nextCursor}, then regenerate api-zod and API clients.

test analysis:
No linked tests were provided for this generated type group. Existing runtime pagination tests can pass while the generated TypeScript/Zod response contract remains too narrow because they do not compile against or validate this generated ScheduleListResponsePagination type.

suggested regression test:
Add a contract/codegen test that imports the generated schedule list response type or schema and asserts that cursor-mode pagination exposes hasMore and nextCursor while offset-mode pagination still exposes totalItems and totalPages.

minimum fix scope:
Update the API spec schedule list pagination schema and regenerate generated API Zod/types/clients; do not hand-edit these generated files.

repro:
Call the schedule list endpoint through generated types with a cursor query and then try to access response.pagination.nextCursor; TypeScript reports that nextCursor does not exist on ScheduleListResponsePagination even though the cursor parameter documentation says the server returns it.

## low: Pagination ellipsis hides its screen-reader label

id: fnd_sig-feat-library-d73391b856-09f2_4afa016cfa
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/cadstone/src/components/ui#3 (feat_library_d73391b856)

evidence:
- artifacts/cadstone/src/components/ui/pagination.tsx:98-104 (PaginationEllipsis)

`aria-hidden` on the outer ellipsis span removes the whole subtree from the accessibility tree, including the nested `sr-only` text. The component appears to intend to expose “More pages” to screen readers, but the current markup makes the ellipsis completely silent.

recommendation:
Move `aria-hidden` to the decorative icon only, or remove the nested `sr-only` label if the ellipsis is intentionally decorative. If the label is intended, keep the outer element visible to assistive tech.

test analysis:
No linked tests were provided, and the package typecheck does not validate accessibility tree behavior.

suggested regression test:
Add an accessibility-focused render test that verifies `PaginationEllipsis` exposes “More pages” to assistive technology, or explicitly documents/tests that it is decorative.

minimum fix scope:
Update `PaginationEllipsis` markup in `artifacts/cadstone/src/components/ui/pagination.tsx` and add a small render/accessibility assertion.

repro:
Render `PaginationEllipsis` and query the accessible tree for the “More pages” label; it is hidden because an ancestor has `aria-hidden`.

## medium: Progress drops the value before it reaches the Radix root

id: fnd_sig-feat-library-d73391b856-20d6_5ab3343af7
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: Node source artifacts/cadstone/src/components/ui#3 (feat_library_d73391b856)

evidence:
- artifacts/cadstone/src/components/ui/progress.tsx:9-20 (Progress)

The wrapper consumes `value` to move the visual indicator but never passes it to `ProgressPrimitive.Root`. Consumers rendering `<Progress value={50} />` will see a half-filled bar, while the Radix root remains in its default indeterminate state, so ARIA attributes and Radix data attributes such as current value/state are wrong for assistive tech and any styling/tests keyed off the primitive state.

recommendation:
Pass `value={value}` through to `ProgressPrimitive.Root` while keeping the indicator transform based on the same value.

test analysis:
No linked tests were provided for the UI source group, and typecheck does not catch prop forwarding omissions that still produce valid JSX.

suggested regression test:
Add a React DOM test that renders `<Progress value={50} />` and asserts the root progressbar exposes the expected current value/state attributes while the indicator transform remains at 50%.

minimum fix scope:
Update `artifacts/cadstone/src/components/ui/progress.tsx` to forward `value` to `ProgressPrimitive.Root` and add focused coverage for the wrapper.

repro:
Render `<Progress value={50} />` and inspect the root progressbar element; the indicator transform reflects 50%, but the root does not receive the `value` prop from this wrapper.

## low: Toast update handle requires a full toast object instead of allowing partial updates

id: fnd_sig-feat-library-de17e471c5-a430_fbe0b00fe0
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: Node source artifacts/cadstone/src/hooks (feat_library_de17e471c5)

evidence:
- artifacts/cadstone/src/hooks/use-toast.ts:124-129 (toast.update)
- artifacts/cadstone/src/hooks/use-toast.ts:36-38 (Action)

The reducer and action type support partial toast updates, but the public handle returned by `toast()` types `update` as requiring `ToasterToast`, including internal fields like `id` and toast props callers should not have to supply. Runtime behavior overwrites `id` anyway, so this is a TypeScript API mismatch that makes legitimate partial updates such as `update({ title: "Done" })` fail typechecking.

recommendation:
Change the returned update signature to accept `Partial<Toast>` or `Partial<ToasterToast>` while preserving the generated id internally.

test analysis:
No linked tests exercise the TypeScript contract of the returned toast handle or partial update calls.

suggested regression test:
Add a compile-time usage fixture or hook test that creates a toast and updates only its title/description without providing internal fields.

minimum fix scope:
Adjust the `toast.update` parameter type in `artifacts/cadstone/src/hooks/use-toast.ts` and add focused API usage coverage.

repro:
Call `const t = toast({ title: "Saving" }); t.update({ title: "Saved" });` in a TypeScript consumer; the call is rejected because `update` expects `ToasterToast`, not `Partial<ToasterToast>`.

## medium: Breadcrumb setter hooks are private despite being the only API for page overrides

id: fnd_sig-feat-library-de17e471c5-eead_4a441ac439
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: Node source artifacts/cadstone/src/hooks (feat_library_de17e471c5)

evidence:
- artifacts/cadstone/src/hooks/use-breadcrumbs.tsx:41-50 (useSetBreadcrumbs)
- artifacts/cadstone/src/hooks/use-breadcrumbs.tsx:55-58 (useClearBreadcrumbs)

The file exports BreadcrumbsProvider and useBreadcrumbsOverride, but the hooks that actually let a page set or clear breadcrumb overrides are module-private. The comment explicitly describes useSetBreadcrumbs as the page-facing API, so downstream pages cannot import it without a TypeScript error and breadcrumb overrides cannot be used through this module's public surface.

recommendation:
Export the intended page-facing hook or remove the dead private API and replace it with a public hook whose contract matches current consumers.

test analysis:
No tests are linked for this source group, and there is no import/export contract test covering the hooks module's public API.

suggested regression test:
Add a small TypeScript-facing test or consumer fixture that imports `useSetBreadcrumbs` from the hooks module and verifies a mounted page can override and then clear provider state on unmount.

minimum fix scope:
Update `artifacts/cadstone/src/hooks/use-breadcrumbs.tsx` exports and add focused coverage for the exported breadcrumb override hook.

repro:
Attempt to import `useSetBreadcrumbs` or `useClearBreadcrumbs` from `artifacts/cadstone/src/hooks/use-breadcrumbs.tsx`; TypeScript reports that the module has no exported member.

## low: Generated pagination docs still claim limit-only requests select cursor mode

id: fnd_sig-feat-library-e4dccc9bab-9c06_cd6392ea18
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: Node source lib/api-zod/src/generated/types#14 (feat_library_e4dccc9bab)

evidence:
- lib/api-zod/src/generated/types/leadsGetLeadsParams.ts:45-55 (LeadsGetLeadsParams.cursor)
- lib/api-zod/src/generated/types/myDailyLogsResponse.ts:10-16 (MyDailyLogsResponse)

The generated public types document `?limit=N` without `cursor` as returning the cursor envelope, but the current pagination contract keeps limit-only requests in page mode and only treats a present `cursor` parameter as cursor mode. Generated consumers following these comments can request `limit` alone and then incorrectly expect `pagination.nextCursor` instead of the page pagination fields/counts the API actually returns.

recommendation:
Fix the OpenAPI cursor/limit descriptions so they say `?cursor=&limit=N` opts into cursor mode and `?limit=N` alone stays in page mode, then regenerate `lib/api-zod` and client artifacts from the spec.

test analysis:
Runtime pagination tests cover the server behavior, but this generated type group has no linked codegen/assertion test that fails when the emitted TypeScript documentation contradicts that behavior.

suggested regression test:
Add an API contract/codegen assertion that generated cursor parameter documentation and affected response descriptions do not describe limit-only requests as cursor mode.

minimum fix scope:
Update the shared CursorParam description and affected response descriptions in `lib/api-spec/openapi.yaml`, then run API codegen.

## medium: Stripe subscription updates can overwrite multiple organizations when customer and subscription IDs disagree

id: fnd_sig-feat-library-e7651c6552-42bc_875995114d
category: data-loss
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/api-server/src/routes#1 (feat_library_e7651c6552)

evidence:
- artifacts/api-server/src/routes/billing.ts:193-215 (updateOrganizationFromStripeSubscription)

When both customerId and subscriptionId are present, the update matches any organization with either external ID and then writes both IDs, status, and planKey to every matched row. If stale data or a mismatched webhook payload has customerId on one organization and subscriptionId on another, both tenants get overwritten with the same billing state. Billing identifiers should resolve to exactly one organization, not fan out through OR.

recommendation:
Resolve a single target organization first. Prefer the subscription ID when present, otherwise customer ID; if both are present and point to different rows, log and reject/quarantine the event. Alternatively require an AND match once both IDs are known and use checkout metadata organizationId as the authoritative binding.

test analysis:
auth.test.ts does not exercise billing webhook reconciliation or multi-organization Stripe identifier mismatches.

suggested regression test:
Add a billing route/unit test that seeds two organizations with split Stripe identifiers, invokes updateOrganizationFromStripeSubscription with both IDs, and asserts only one row updates or that the mismatch is rejected.

minimum fix scope:
artifacts/api-server/src/routes/billing.ts updateOrganizationFromStripeSubscription plus a targeted billing reconciliation test.

repro:
Seed organization A with stripeCustomerId = 'cus_A' and organization B with stripeSubscriptionId = 'sub_B'. Call updateOrganizationFromStripeSubscription({ customerId: 'cus_A', subscriptionId: 'sub_B', status: 'active', planKey: 'pro' }). Both rows match the OR predicate and are updated to the same customer/subscription/status/plan.

## medium: Deleting a tenant client nulls live job client IDs instead of reassigning them to the Unknown client

id: fnd_sig-feat-library-e7651c6552-47bf_efa89c4f82
category: data-loss
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/api-server/src/routes#1 (feat_library_e7651c6552)

evidence:
- artifacts/api-server/src/routes/clients.ts:562-575 (DELETE /:id)
- artifacts/api-server/src/routes/clients.ts:229-252 (GET / clients rollup)
- artifacts/api-server/src/routes/clients.ts:635-677 (GET /:id/jobs)

For normal tenant-scoped requests getActiveOrganizationId(req.auth!) is truthy, so deleting a client sets each live job's clientId to null. Those jobs no longer belong to any client row, which contradicts the route comment and removes them from client-first navigation and client rollups. The relationship is lost even though the jobs remain live.

recommendation:
Create or resolve a tenant-scoped Unknown client and assign live jobs to that row, or keep the existing client link until a safe reassignment target exists. Do not write null for live tenant jobs unless the product explicitly supports unassigned clients in all client-first views.

test analysis:
auth.test.ts is unrelated to clients, and the included tests do not cover client deletion side effects on jobs or tenant Unknown-client behavior.

suggested regression test:
Add a client deletion test that creates an organization, client, and live job, deletes the client, and asserts the job is reassigned to an accessible Unknown client rather than having clientId null.

minimum fix scope:
artifacts/api-server/src/routes/clients.ts client deletion transaction plus a tenant-scoped Unknown-client fixture/helper and regression test.

repro:
In an organization, create a client with a live job, then DELETE /api/clients/:id. The transaction updates the job to clientId null. Subsequent client list/detail endpoints cannot show that job under the Unknown client because they only query jobs by concrete client IDs.

## high: /dashboard/home ignores active organization scoping and can leak tenant data

id: fnd_sig-feat-library-e7651c6552-f327_ff9f4ce930
category: security
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/api-server/src/routes#1 (feat_library_e7651c6552)

evidence:
- artifacts/api-server/src/routes/dashboard.ts:96-136
- artifacts/api-server/src/routes/dashboard.ts:524-570 (buildCrewHome)
- artifacts/api-server/src/routes/dashboard.ts:953-1073 (buildAdminHome)
- artifacts/api-server/src/routes/dashboard.ts:1205-1213

The rest of dashboard.ts demonstrates that dashboard data is expected to be tenant-scoped. The new role-aware home endpoint does not apply the active organization condition to its crew and admin queries. In a multi-tenant workspace, an admin in one active organization can receive global job, lead, invoice, client, and schedule aggregates, and a crew user can see their schedule/log/todo rows from another organization if the same user belongs to multiple tenants.

recommendation:
Add organizationScopeCondition(auth, ...) to every business table used by buildCrewHome and buildAdminHome, including joined jobs/clients/financial tables. Consider failing when /dashboard/home has no active organization rather than returning global data.

test analysis:
The linked test file is auth.test.ts and only covers JWT upload-secret behavior plus absence of password reset routes. It has no tenant fixtures or dashboard/home assertions.

suggested regression test:
Add an API/server test that seeds two organizations with jobs, leads, schedule items, daily logs, invoices, and clients, authenticates with org A active, calls /dashboard/home for admin and crew roles, and asserts no org B IDs or aggregates appear.

minimum fix scope:
artifacts/api-server/src/routes/dashboard.ts buildCrewHome/buildAdminHome and tenant-scoped tests for /dashboard/home.

repro:
Create org A and org B with distinct jobs/leads/schedule items. Authenticate with auth.organizationId set to org A as an admin or as a crew user who also has rows in org B. GET /api/dashboard/home. The response can include org B counts/items because these queries do not filter by auth.organizationId.

## medium: Trailing-dot filenames bypass dangerous extension blocking

id: fnd_sig-feat-library-e96f464c64-4696_669a97c39e
category: security
confidence: high
triage: confirmed-bug
status: open
feature: Node source lib/api-zod/src (feat_library_e96f464c64)

evidence:
- lib/api-zod/src/uploads.ts:88-104 (DANGEROUS_UPLOAD_EXTENSIONS)
- lib/api-zod/src/uploads.ts:171-177 (extensionOf)
- lib/api-zod/src/uploads.ts:180-182 (isDangerousUploadFileName)

The shared dangerous-extension gate checks only the substring after the final dot. A filename like `payload.exe.` produces `.` instead of `.exe`, so `isDangerousUploadFileName` returns false even though the stated contract is to refuse dangerous extensions anywhere in the app. Trailing dots and spaces are commonly normalized away by Windows tooling/download flows, so this can allow an executable or script through the upload blocklist under a name that may later be treated as the dangerous file type.

recommendation:
Normalize the basename before extracting the extension, at minimum trimming trailing dots and ASCII whitespace before `lastIndexOf(".")`, then ensure upload consumers use this shared helper rather than duplicate extension extraction.

test analysis:
The upload-related tests cover ordinary dangerous names such as `payload.exe`, `run.bat`, `deploy.sh`, and `evil.html`, but they do not include normalized-equivalent filenames with trailing dots or spaces.

suggested regression test:
Add cases asserting `isDangerousUploadFileName("payload.exe.")`, `isDangerousUploadFileName("payload.exe ")`, and server/client upload validation for those names are rejected with the same dangerous-extension error as `payload.exe`.

minimum fix scope:
Update `lib/api-zod/src/uploads.ts` extension normalization and route frontend/backend dangerous-extension checks through it, plus add regression coverage for trailing-dot/trailing-space dangerous filenames.

repro:
Call `isDangerousUploadFileName("payload.exe.")` or `isDangerousUploadFileName("deploy.sh ")`; both should be blocked by policy but are not with the current final-dot/final-space handling.

## high: reset-db can wipe production without destructive confirmation or rollback

id: fnd_sig-feat-library-f0eba389b5-2545_493601dd61
category: data-loss
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/api-server/scripts (feat_library_f0eba389b5)

evidence:
- artifacts/api-server/scripts/reset-db.mjs:27-37 (parseDbFlag)
- artifacts/api-server/scripts/reset-db.mjs:80-81 (resetTarget)
- artifacts/api-server/scripts/reset-db.mjs:107-117 (main)

The destructive reset path accepts --db=production as the only production-specific guard and then immediately truncates every public base table except workspace_schema_migrations. Unlike seed-users and wipe-prod-data, there is no --i-know-what-im-doing confirmation, pause, dry-run, or explicit transaction. A mistaken invocation with SUPABASE_DATABASE_URL set will hard-clear production application data, and any failure after TRUNCATE will not roll the data back.

recommendation:
Either remove the production target from reset-db entirely or require the same explicit confirmation used by wipe-prod-data. Wrap the TRUNCATE plus verification in BEGIN/COMMIT with rollback on failure, or delegate production wipes to wipe-prod-data only.

test analysis:
No reset-db tests are present. Existing script tests cover production confirmation for seed-users and read-only behavior for audit-storage-drift, but not this destructive reset script.

suggested regression test:
Add a reset-db parse/guard test asserting --db=production without --i-know-what-im-doing is rejected, and an integration-style fake pg client test asserting TRUNCATE is executed inside a transaction only after confirmation.

minimum fix scope:
artifacts/api-server/scripts/reset-db.mjs

repro:
Set SUPABASE_DATABASE_URL and run `node artifacts/api-server/scripts/reset-db.mjs --db=production`; parseDbFlag selects the production target and resetTarget issues TRUNCATE directly.

## medium: Overbroad '..' validation can classify valid upload names as orphaned and delete their rows

id: fnd_sig-feat-library-f0eba389b5-483f_b06f401624
category: data-loss
confidence: medium
triage: risk
status: open
feature: Node source artifacts/api-server/scripts (feat_library_f0eba389b5)

evidence:
- artifacts/api-server/scripts/lib/supabase-storage.mjs:39-47 (fileUrlToObjectName)
- artifacts/api-server/scripts/cleanup-orphan-file-rows.mjs:144-153 (classifyRows)
- artifacts/api-server/scripts/cleanup-orphan-file-rows.mjs:309-311 (main)

fileUrlToObjectName rejects any relative upload path containing the substring '..', not just path traversal segments. A legitimate stored URL such as /uploads/jobs/contract..final.pdf or a generated name containing consecutive dots is treated as malformed. cleanup-orphan-file-rows then puts malformed URLs in the orphan set and hard-deletes their files rows, even if the storage object exists.

recommendation:
Validate path traversal by splitting the relative path into segments and rejecting only empty/absolute/NUL segments and segments equal to `..` or `.` as appropriate. Then probe storage before deleting rows whose names are syntactically valid object keys.

test analysis:
The included feature lists no cleanup tests. Existing path validation coverage checks traversal-like inputs but does not cover benign filenames containing consecutive dots, nor the cleanup script's delete classification.

suggested regression test:
Add a fileUrlToObjectName test for `/uploads/job-1/contract..final.pdf` and a cleanup classification test proving that such a row is probed via storage.objectExists instead of immediately entering the orphan delete set.

minimum fix scope:
artifacts/api-server/scripts/lib/supabase-storage.mjs and artifacts/api-server/scripts/cleanup-orphan-file-rows.mjs

repro:
Given a files row with file_url `/uploads/job-1/contract..final.pdf`, classifyRows calls fileUrlToObjectName, receives an invalid URL error from the substring check, and includes that row in the DELETE set without probing storage.

## medium: pg_dump receives the database URL, including credentials, as a process argument

id: fnd_sig-feat-library-f0eba389b5-6231_20e7317acb
category: security
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/api-server/scripts (feat_library_f0eba389b5)

evidence:
- artifacts/api-server/scripts/db-backup.mjs:52
- artifacts/api-server/scripts/db-backup.mjs:141-144 (runBackup)
- artifacts/api-server/package.json:16 (scripts.backup:db)

Postgres connection URLs commonly contain the username and password. Passing the full URL as a pg_dump argv element exposes those credentials through process listings and scheduler/runtime diagnostics while the backup is running. The script otherwise keeps secrets in environment variables, but this spawn call moves the database secret into a more observable channel.

recommendation:
Parse the URL and pass non-secret connection options through PGHOST, PGPORT, PGDATABASE, PGUSER, and PGPASSWORD in the child environment, or use a temporary .pgpass file with restricted permissions. Do not include the password-bearing URL in argv.

test analysis:
No tests assert that backup subprocess arguments avoid secrets, and this is not exercised by typecheck or package script smoke tests.

suggested regression test:
Unit-test construction of pg_dump spawn options so argv contains only non-secret flags and the password is supplied through a less exposed mechanism.

minimum fix scope:
artifacts/api-server/scripts/db-backup.mjs

repro:
Run backup:db with SUPABASE_DATABASE_URL containing a password and inspect the process list while pg_dump is active; the connection string appears in pg_dump's command arguments.

## medium: Backup scripts can crash before alerting on missing storage configuration

id: fnd_sig-feat-library-f0eba389b5-caf4_4955f477eb
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: Node source artifacts/api-server/scripts (feat_library_f0eba389b5)

evidence:
- artifacts/api-server/scripts/lib/supabase-storage.mjs:14-20 (getSupabaseStorageConfig)
- artifacts/api-server/scripts/db-backup.mjs:108
- artifacts/api-server/scripts/db-backup.mjs:269-283
- artifacts/api-server/scripts/db-backup-check.mjs:66
- artifacts/api-server/scripts/db-backup-check.mjs:205-214

createSupabaseStorage throws synchronously when SUPABASE_URL, SUPABASE_STORAGE_BUCKET, or SUPABASE_SERVICE_ROLE_KEY is missing. Both db-backup and db-backup-check call it at module top level, before their guarded main/catch paths run. That means a common scheduled-deployment misconfiguration exits as an uncaught module error and bypasses the pino failure log and sendBackupAlert path these scripts are designed to provide.

recommendation:
Move storage creation inside the try-protected execution path, or wrap all top-level initialization in an async main that catches configuration failures and calls sendBackupAlert when alert transports are configured.

test analysis:
There are no backup script tests that execute the modules with missing storage env vars; the existing tests do not cover top-level initialization failure ordering.

suggested regression test:
Add a child-process test for db-backup and db-backup-check with SUPABASE_URL unset and BACKUP_ALERT_WEBHOOK_URL pointed at a local test server, asserting the process logs the scripted failure event and attempts an alert instead of crashing during module evaluation.

minimum fix scope:
artifacts/api-server/scripts/db-backup.mjs and artifacts/api-server/scripts/db-backup-check.mjs

repro:
Unset SUPABASE_URL and run `pnpm --filter @workspace/api-server run backup:db` or `backup:check`; the module throws while evaluating `const storage = createSupabaseStorage()` before the catch block can call sendBackupAlert.

## medium: Generated client DTO types expose cents fields as bigint while schemas and consumers use numbers

id: fnd_sig-feat-library-f8b1506752-1e3f_69eac5675b
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: Node source lib/api-zod/src/generated/types#3 (feat_library_f8b1506752)

evidence:
- lib/api-zod/src/generated/types/clientListItem.ts:45-59 (ClientListItem)
- lib/api-zod/src/generated/types/clientDetailRollups.ts:13-18 (ClientDetailRollups)
- lib/api-zod/package.json:6-7

These generated exported DTO types describe JSON API money rollups as bigint. The same package's generated Zod response schemas validate these fields as numbers, and the React API client generated from the same OpenAPI contract also exposes them as numbers. A consumer importing response types from @workspace/api-zod can therefore write bigint-only arithmetic or comparisons against values that are actually JSON numbers at runtime, and TypeScript assignments between parsed Zod output and exported DTO types will fail. This is especially risky because the package exports generated types through its public entrypoint.

recommendation:
Fix the OpenAPI/codegen mapping for these cents rollup fields so @workspace/api-zod emits number types consistently with the Zod schemas and the API client, likely by removing int64 where values are bounded to safe integers or configuring the generator not to map these JSON integers to bigint. Regenerate generated clients/schemas instead of hand-editing generated files.

test analysis:
No linked tests were provided for this feature. Existing inspected contract tests focus job payload cents bounds, not assignability between generated @workspace/api-zod response types and their generated Zod parse outputs for client list/detail responses.

suggested regression test:
Add a type-level contract check in @workspace/api-zod that parses representative GET /clients and GET /clients/{id} payloads with the generated Zod schemas and assigns the parsed values to ClientListResponse and ClientDetailResponse. The test should fail if parsed numeric cents fields are typed as bigint.

minimum fix scope:
OpenAPI/codegen configuration for the affected client list/detail rollup cents fields plus regenerated @workspace/api-zod outputs.

## medium: Recursive workspace build can run two frontend builds into the same output directory

id: fnd_sig-feat-release-241e2effc4-6585_d47fd9b25e
category: build-release
confidence: medium
triage: risk
status: open
feature: Package script build (@workspace/api-server) (feat_release_241e2effc4)

evidence:
- artifacts/api-server/package.json:9 (scripts.build)
- package.json:13 (scripts.build)
- artifacts/cadstone/package.json:8 (scripts.build)

The root release build runs every workspace package build recursively, including @workspace/cadstone and @workspace/api-server. The api-server build script then starts another @workspace/cadstone build before running its own build. Because api-server does not declare cadstone as a package dependency, pnpm's recursive build can schedule the top-level cadstone build and the nested cadstone build concurrently. Both Vite builds write to the same cadstone dist output, while the api-server build later copies that output into dist/public, making the release artifact nondeterministic or vulnerable to a partially cleaned/rebuilt frontend directory.

recommendation:
Make exactly one build step own the frontend artifact. For example, keep @workspace/api-server `build` as `node ./build.mjs` and have the root/deploy pipeline explicitly run `pnpm --filter @workspace/cadstone run build` before `pnpm --filter @workspace/api-server run build:server`, or adjust the root recursive build so it does not also run cadstone independently when api-server is orchestrating it.

test analysis:
No linked tests exercise the workspace-root recursive build graph or concurrent package-script execution. Existing build smoke tests only assert the bundle after a build has already completed, so they would not reliably catch an intermittent artifact race.

suggested regression test:
Add a CI/script-level check for the root release build path that ensures the frontend build is invoked once, or replace the recursive root build with explicit ordered package scripts and test that `dist/public` exists after that command.

minimum fix scope:
Update the package-script orchestration so @workspace/cadstone build is invoked in only one place for the root release build path.

repro:
Run `pnpm run build` from the workspace root with default recursive concurrency; observe that the root recursive cadstone build and the nested cadstone build from @workspace/api-server can overlap and target the same Vite output directory.

## medium: Root build runs non-release workspace builds

id: fnd_sig-feat-release-51170e0f9c-caff_6f091511c4
category: build-release
confidence: high
triage: risk
status: open
feature: Package script build (feat_release_51170e0f9c)

evidence:
- package.json:13 (scripts.build)

The release entrypoint uses an unfiltered recursive build, so any workspace package with a build script becomes part of the root production build. In this workspace that includes non-release packages such as artifacts/mockup-sandbox, which is explicitly outside the production migration surface and should not be changed. This makes production builds depend on sandbox build health and can write sandbox build output as a side effect of running the root build.

recommendation:
Replace the recursive build with explicit production targets, for example running the existing web and API build scripts in sequence, or use pnpm filters that include only release packages and exclude mockup-sandbox.

test analysis:
No tests or build smoke checks are linked for this package script, and the current script behavior depends on workspace package discovery rather than an asserted allowlist.

suggested regression test:
Add a package-script or CI check that verifies the root build command only targets production packages and excludes artifacts/mockup-sandbox.

minimum fix scope:
Update the root package.json build script to use an explicit allowlist of release build targets.

## medium: api-server typecheck omits two referenced workspace libraries

id: fnd_sig-feat-release-7ce64f739d-528d_70972b68de
category: build-release
confidence: medium
triage: risk
status: open
feature: Package script typecheck (@workspace/api-server) (feat_release_7ce64f739d)

evidence:
- artifacts/api-server/package.json:14 (typecheck)

The api-server tsconfig references four workspace libraries, and api-server source imports both @workspace/integrations-anthropic-ai and @workspace/mcp-server. This package script only builds ../../lib/db and ../../lib/api-zod before running tsc for api-server, so a package-scoped typecheck can depend on stale or missing declaration output for the two omitted referenced projects. The root typecheck may mask this by building all libs first, but the package script itself is not self-contained for clean package-level release checks.

recommendation:
Build every api-server TypeScript project reference in this script, or replace the hand-picked list with a build invocation that follows the api-server project references, such as using build mode on artifacts/api-server/tsconfig.json when compatible with the desired no-emit behavior.

test analysis:
No linked tests or script-level checks were included for this feature, and the repository-level typecheck path can prebuild the omitted libraries before this package script runs, hiding the package-scoped failure mode.

suggested regression test:
In CI or a script test, run the @workspace/api-server typecheck from a clean workspace without prebuilt lib/*/dist outputs and assert it succeeds.

minimum fix scope:
Update artifacts/api-server/package.json typecheck to include all referenced workspace libraries or delegate to a single project-reference-aware TypeScript build command.

## low: No regression test covers the new job schedule route mapping

id: fnd_sig-feat-route-1e7e9e31af-65af84_7b49f6becd
category: test-gap
confidence: high
triage: test-gap
status: open
feature: React route /jobs/:jobId/schedule (feat_route_1e7e9e31af)

evidence:
- artifacts/cadstone/src/App.tsx:209-217 (buildRouter)
- artifacts/cadstone/package.json:10

The semantic feature is the React Router mapping for /jobs/:jobId/schedule, but the included tests only exercise unrelated helpers/components and do not mount App/buildRouter or assert that this URL reaches JobSchedulePage behind the protected shell. A route typo, misplaced nesting, or import change could break the claimed route without any listed test failing.

recommendation:
Add a focused router regression test that renders the app routes with an authenticated user and asserts /jobs/test-job/schedule resolves to the schedule page outlet rather than NotFound or the default daily-logs redirect.

test analysis:
The linked tests cover ErrorBoundary, RoleGate, PDF annotation helpers, API error classification, percent confirmation, role access helpers, and Sentry filtering. None references App.tsx, /jobs/:jobId/schedule, or JobSchedulePage.

suggested regression test:
Mock the lazy page modules, seed useAuthStore with an authenticated user, render the router at /jobs/job-1/schedule in a memory/router-compatible setup, and assert the JobSchedulePage sentinel is rendered.

minimum fix scope:
Add a route-level test for App.tsx/buildRouter or extract the route tree enough to test this path without booting the full Vite app.

## low: No route-level coverage for /sales/leads access behavior

id: fnd_sig-feat-route-24dfdd725f-4ea5de_392190508a
category: test-gap
confidence: high
triage: test-gap
status: open
feature: React route /sales/leads (feat_route_24dfdd725f)

evidence:
- artifacts/cadstone/src/App.tsx:202-204 (buildRouter)
- artifacts/cadstone/src/components/auth/RoleGate.test.ts:98-121 (renderRoutePattern)
- artifacts/cadstone/src/lib/role-access.test.ts:12-16 (hasRoleAccess)

The claimed feature is the concrete React route `/sales/leads`, guarded by `ROLE_GATES.sales`. The associated RoleGate tests exercise a synthetic `/sales` route with a hard-coded allow-list that includes `project_manager`, while the role-access tests assert `ROLE_GATES.sales` excludes `project_manager`. Because no included test renders the actual App route or uses `ROLE_GATES.sales` for `/sales/leads`, a future change could remove, misroute, or incorrectly gate `/sales/leads` without these tests failing.

recommendation:
Add a focused route test for `/sales/leads` that uses the same route gate as App.tsx and asserts admin access plus project_manager/crew_member denial or redirect behavior according to the intended product rule.

test analysis:
The current RoleGate test validates the generic route-element pattern on `/sales`, not the App route declaration, and it does not use `ROLE_GATES.sales`. The role-access test validates the helper policy but not that `/sales/leads` is wired to that policy.

suggested regression test:
Render a minimal route tree matching App.tsx with `<RoleGate allow={ROLE_GATES.sales}>` and a child route at `/sales/leads`; assert an admin sees the LeadsPage sentinel and a project_manager/crew_member lands on the expected redirect target.

minimum fix scope:
A frontend unit test under `artifacts/cadstone/src` covering the `/sales/leads` route gate; exporting a small route factory or extracting the sales route fragment may be needed if testing the full App router is too heavy.

## low: Route wiring for /sales is not covered by a route-level test

id: fnd_sig-feat-route-35ed9ed596-4adf56_e044f48122
category: test-gap
confidence: medium
triage: test-gap
status: open
feature: React route /sales (feat_route_35ed9ed596)

evidence:
- artifacts/cadstone/src/App.tsx:187-190 (buildRouter)

The feature under review is the React Router declaration for `/sales`, but the included tests only cover lower-level helpers and a generic RoleGate route pattern. They do not render the App router or assert that `/sales` and `/sales/leads` resolve to LeadsPage under `ROLE_GATES.sales`. This leaves route regressions such as removing the alias, pointing one path at the wrong page, or changing the gate untested.

recommendation:
Add a focused router/App test that stubs auth as an allowed sales role and asserts `/sales` and `/sales/leads` render the LeadsPage module, plus a disallowed role redirects as intended.

test analysis:
RoleGate.test verifies RoleGate behavior with a local allow list, and role-access.test verifies ROLE_GATES.sales membership, but neither composes those with the actual App.tsx route declaration.

suggested regression test:
Render the App router or extracted buildRouter with an admin auth store state and initial path `/sales`, mock `@/pages/leads` with a sentinel component, and assert the sentinel renders. Repeat for `/sales/leads` and for a crew_member redirect.

minimum fix scope:
Add route-level coverage for the `/sales` App.tsx declaration without changing production routing.

## low: Route registration is not covered by any linked test

id: fnd_sig-feat-route-3940fa7274-6af134_f02e498943
category: test-gap
confidence: high
triage: test-gap
status: open
feature: React route /jobs/:jobId/files/videos (feat_route_3940fa7274)

evidence:
- artifacts/cadstone/src/App.tsx:192-197 (buildRouter)
- artifacts/cadstone/package.json:9-12

The feature is the React Router mapping for /jobs/:jobId/files/videos, but the linked tests exercise generic components and helper functions rather than App.tsx route composition. A typo in the nested path, removing the route, or wiring the wrong page component would not be caught by the included tests.

recommendation:
Add a focused route-registration test for App.tsx/buildRouter or an integration-level router test that navigates to /jobs/job-1/files/videos with an authenticated user and asserts the videos page module/sentinel renders.

test analysis:
The associated tests cover ErrorBoundary, RoleGate, PDF annotation helpers, API error handling, percent confirmation, role-access helpers, and Sentry filtering. None imports App.tsx or verifies the /jobs/:jobId/files/videos route.

suggested regression test:
Mock the lazy page modules and auth bootstrap/store, render App or buildRouter under a test DOM at /jobs/job-1/files/videos, then assert the JobFilesVideosPage sentinel is present after suspense resolves.

minimum fix scope:
Add route-level test coverage for this App.tsx route without changing production behavior.

## low: /settings/company admin routing has no route-level regression coverage

id: fnd_sig-feat-route-44cc0fa2cc-2f3238_5f11df9b44
category: test-gap
confidence: medium
triage: test-gap
status: open
feature: React route /settings/company (feat_route_44cc0fa2cc)

evidence:
- artifacts/cadstone/src/App.tsx:224-236 (buildRouter)
- artifacts/cadstone/src/components/auth/RoleGate.test.ts:98-172 (renderRoutePattern)
- artifacts/cadstone/src/lib/role-access.test.ts:29-33 (hasRoleAccess)

The route is security-sensitive because /settings/company is only reachable through the AdminRoute wrapper in App.tsx. The included tests cover RoleGate routing and the role-access helper, but this feature uses AdminRoute instead, and none of the linked tests mount the App route tree or assert that /settings/company renders for admins and redirects for non-admins. A future route refactor could move CompanySection outside the AdminRoute wrapper while the current tests still pass.

recommendation:
Add a focused route regression test for /settings/company that exercises the same route nesting as App.tsx and asserts admin access plus non-admin denial.

test analysis:
RoleGate.test.ts intentionally validates RoleGate route-element behavior for /sales, while role-access.test.ts validates helper predicates. Neither test covers AdminRoute or the concrete /settings/company route declaration.

suggested regression test:
Mount the settings route pattern with a MemoryRouter/createMemoryRouter, seed useAuthStore with admin and crew/project-manager users, and assert that /settings/company renders CompanySection only for admin while non-admin users land on the expected forbidden/profile route.

minimum fix scope:
Add or extend frontend routing tests; no production route change is required.

## low: Route has no default test coverage

id: fnd_sig-feat-route-4b16cfda69-ee50b4_782f27f8b6
category: test-gap
confidence: high
triage: test-gap
status: open
feature: React route /jobs/:jobId/daily-logs (feat_route_4b16cfda69)

evidence:
- artifacts/cadstone/src/App.tsx:192-200 (buildRouter)
- artifacts/cadstone/package.json:12-13
- artifacts/cadstone/src/components/auth/RoleGate.test.ts:119-121 (renderRoutePattern)

The feature is the React Router mapping for /jobs/:jobId/daily-logs, but the linked/default unit tests do not import App.tsx or assert that this nested route resolves to JobDailyLogsPage. The RoleGate route tests exercise a synthetic /sales route, and the package's default test command only runs src/**/*.test.ts while Playwright e2e is a separate script. A typo in the daily-logs child path or an accidental target-component swap could therefore pass the associated unit test command.

recommendation:
Add a focused App/router smoke test under artifacts/cadstone/src that starts at /jobs/test-job/daily-logs with an authenticated store and asserts that the JobDailyLogsPage route marker renders, or otherwise make the route table testable and assert this route entry directly.

test analysis:
The included tests cover ErrorBoundary, RoleGate behavior on /sales, PDF helpers, API error handling, percent math, role-access helpers, and Sentry filtering; none assert App.tsx's /jobs/:jobId/daily-logs route declaration.

suggested regression test:
Create artifacts/cadstone/src/App.test.tsx that mocks @/pages/job-daily-logs to render a stable marker, seeds useAuthStore with a user, renders App at /jobs/job-1/daily-logs in JSDOM, and asserts the marker appears after bootstrap completes.

minimum fix scope:
One focused frontend route smoke test; no production route logic change is required unless the test exposes a rendering issue.

## medium: PM at-risk route is gated as admin-only

id: fnd_sig-feat-route-5c64e4ba34-da275a_41a9299d6e
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: React route /at-risk/pending-change-orders (feat_route_5c64e4ba34)

evidence:
- artifacts/cadstone/src/App.tsx:171-179 (buildRouter)
- artifacts/cadstone/src/lib/role-access.test.ts:12-16 (hasRoleAccess)
- artifacts/cadstone/src/pages/at-risk/PendingChangeOrdersPage.tsx:12-19 (PendingChangeOrdersAtRiskPage)
- artifacts/cadstone/src/pages/home/PMHomePage.tsx:97-104 (PMHomePage)

The pending change orders drill-down is explicitly a PM Home destination and the page itself only renders PM data, but App.tsx places the route under ROLE_GATES.companyViews. The included role-access test establishes that project_manager does not pass companyViews, so a PM clicking the PM Home tile is redirected to /403 before the PM-only page can render. Admins are allowed through the route gate, but the page then treats non-PM payloads as unavailable, so the current gate is inverted for the intended consumer.

recommendation:
Move /at-risk/pending-change-orders out of the companyViews gate or introduce a dedicated at-risk/PM gate that admits project_manager and matches the backend/dashboard-home contract. Apply the same review to the sibling at-risk route if it shares the same PM-only intent.

test analysis:
The linked RoleGate and role-access tests verify the gate mechanics and companyViews role membership, but they do not mount App.tsx routes or assert that the PM Home tile destination is reachable by a project_manager.

suggested regression test:
Add a route-level test or Playwright flow that authenticates as a project_manager, navigates to /at-risk/pending-change-orders, and asserts data-testid="at-risk-pending-cos" renders instead of the /403 page.

minimum fix scope:
Update the App.tsx route gate for the at-risk pending change orders route and add coverage for project_manager access to that route.

repro:
Sign in as a project_manager, open /dashboard, click the Pending change orders at-risk tile, or navigate directly to /at-risk/pending-change-orders. The route redirects to /403 instead of rendering PendingChangeOrdersAtRiskPage.

## low: No route-level coverage protects the /files/videos compatibility redirect

id: fnd_sig-feat-route-5f001d10d9-5a54d9_2f57610328
category: test-gap
confidence: high
triage: test-gap
status: open
feature: React route /files/videos (feat_route_5f001d10d9)

evidence:
- artifacts/cadstone/src/App.tsx:182-191 (buildRouter)
- artifacts/cadstone/package.json:12
- artifacts/cadstone/src/components/auth/RoleGate.test.ts:98-130 (renderRoutePattern)

The reviewed feature is the explicit /files/videos route, but the included tests only exercise generic RoleGate routing and unrelated helpers/components. There is no test that mounts App routing or FilesRedirect and asserts that /files/videos sends admins to /clients and field users to /jobs. Because this is a backward-compatibility route meant to keep bookmarks from 404ing, a future route cleanup or role-change could break the compatibility path without any current test failure.

recommendation:
Add a focused router test for the legacy file redirects, covering /files/videos at minimum for admin and non-admin authenticated users, plus optionally the sibling /files, /files/documents, and /files/photos redirects.

test analysis:
The package test command runs *.test.ts files, but the included tests do not reference FilesRedirect or /files/videos. RoleGate.test uses a synthetic /sales route and does not exercise App.tsx's route table or the FilesRedirect target selection.

suggested regression test:
Create an App routing or extracted route-table test that seeds useAuthStore with an admin user, navigates to /files/videos, and asserts the final location is /clients; repeat with a crew_member or project_manager and assert /jobs.

minimum fix scope:
Test-only change in artifacts/cadstone, or export/extract enough of the route construction to make the legacy redirect behavior testable without broad App bootstrapping.

## low: No route-level regression test covers the /files/photos redirect

id: fnd_sig-feat-route-78580f4a1a-4190b1_038bc881f4
category: test-gap
confidence: high
triage: test-gap
status: open
feature: React route /files/photos (feat_route_78580f4a1a)

evidence:
- artifacts/cadstone/src/App.tsx:101-105 (FilesRedirect)
- artifacts/cadstone/src/App.tsx:188-190 (buildRouter)
- artifacts/cadstone/src/components/auth/RoleGate.test.ts:98-138 (renderRoutePattern)

The feature is a compatibility route whose observable behavior depends on App.tsx route wiring and FilesRedirect's role branch. The included route-oriented test only builds a small RoleGate fixture around /sales; the rest of the linked tests cover unrelated helpers. A future removal of /files/photos or a wrong redirect target would not be caught by the current cadstone test suite.

recommendation:
Add a focused route regression test for /files/photos that sets the auth store and asserts admin users are redirected to /clients while project_manager and crew_member users are redirected to /jobs. Include the protected-route case if the test builds the full router.

test analysis:
The current linked tests do not import App.tsx, buildRouter, or FilesRedirect, and they do not reference /files/photos. RoleGate.test.ts validates generic RoleGate redirects using a synthetic /sales route, not the top-level files compatibility routes.

suggested regression test:
Create an App route test using MemoryRouter/createMemoryRouter-compatible routing or a small exported test hook for buildRouter, seed useAuthStore with each role, navigate to /files/photos, and assert the final rendered location/landing sentinel for /clients and /jobs.

minimum fix scope:
Add route-level test coverage for FilesRedirect or expose the router construction in a test-only-safe way; no production behavior change is required.

## low: Settings route table has no direct regression coverage

id: fnd_sig-feat-route-820574536f-0602b7_00d888c025
category: test-gap
confidence: high
triage: test-gap
status: open
feature: React route /settings (feat_route_820574536f)

evidence:
- artifacts/cadstone/src/App.tsx:224-247 (buildRouter)
- artifacts/cadstone/src/components/auth/RoleGate.test.ts:138-172 (<RoleGate /> route-element pattern)
- artifacts/cadstone/package.json:12 (scripts.test)

The semantic feature is the App.tsx /settings route tree, including an index redirect, public user settings, admin-only settings children, billing redirects, and the backward-compatible /settings/users redirect. The linked tests exercise generic RoleGate behavior and unrelated helper modules, but none render the App route table or assert that these settings URLs resolve to the intended layout/guards. A typo, missing child route, or broken redirect in this route table would not be caught by the included unit tests.

recommendation:
Add a focused routing test that builds the relevant route tree and asserts /settings redirects to /settings/profile, /settings/profile renders under SettingsLayout for an authenticated user, /settings/team is admin-only, and /settings/users redirects to /settings/team.

test analysis:
The associated RoleGate test uses a synthetic /sales route to validate the guard component. The other linked tests cover ErrorBoundary, PDF annotation helpers, API error helpers, percent confirmation, role-access helpers, and Sentry filtering; they do not mount App.tsx or exercise the /settings routes.

suggested regression test:
Create an App routing smoke test, or export a testable route builder, using a memory router with seeded auth-store state for admin and non-admin users. Assert the settings index redirect, the profile route, admin-only child routing, /billing and /billing/success redirects, and the /settings/users compatibility redirect.

minimum fix scope:
Test-only change covering the /settings route declarations in artifacts/cadstone/src/App.tsx.

## low: Reports route wiring has no regression coverage

id: fnd_sig-feat-route-c49b39d4a6-e241ae_f27900c2d9
category: test-gap
confidence: high
triage: test-gap
status: open
feature: React route /reports (feat_route_c49b39d4a6)

evidence:
- artifacts/cadstone/src/App.tsx:197-205 (buildRouter)

The feature adds a protected nested /reports route with an index redirect and five child report routes, but the linked tests exercise ErrorBoundary, RoleGate in isolation, PDF annotation helpers, API error helpers, percent math, role access helpers, and Sentry filtering. None mount App/buildRouter or assert that /reports redirects to /reports/ar-aging, that report children render under ReportsLayout, or that unauthorized roles land on /403. A route regression here would currently be caught only by manual navigation or broader end-to-end coverage outside the included evidence.

recommendation:
Add a focused router test for the /reports tree that sets auth state, renders the app route pattern or exported router builder, and verifies the index redirect, at least one child route, and the RoleGate /403 behavior for a disallowed role.

test analysis:
The included RoleGate tests verify generic redirect behavior using a synthetic /sales route, and role-access tests verify several gates, but neither covers ROLE_GATES.reports nor the actual /reports route declaration in App.tsx.

suggested regression test:
Add an App routing test that initializes an admin user at /reports, asserts navigation resolves to /reports/ar-aging or the AR aging report content, then initializes a disallowed user at /reports and asserts the /403 page renders.

minimum fix scope:
Test-only change in artifacts/cadstone route coverage; no production route changes are required.

## low: Register route has no route-level regression coverage

id: fnd_sig-feat-route-c7552c80f5-c19d77_a8f96bea6b
category: test-gap
confidence: high
triage: test-gap
status: open
feature: React route /register (feat_route_c7552c80f5)

evidence:
- artifacts/cadstone/src/App.tsx:146-148 (buildRouter)
- artifacts/cadstone/package.json:9-13
- artifacts/cadstone/src/components/auth/RoleGate.test.ts:91-133 (renderRoutePattern)

The owned route declaration places /register behind PublicOnlyRoute, but the included tests cover ErrorBoundary, RoleGate, annotation helpers, API error helpers, percent math, role access, and Sentry filtering. None exercises App.tsx or verifies that /register renders RegisterPage for signed-out users, shows the loading guard while auth bootstrap is pending, or redirects authenticated users. Because the route is lazy-loaded and guarded, a regression in path wiring or guard placement could ship while the current unit tests still pass.

recommendation:
Add a focused App/router test for /register that mocks or controls auth store/bootstrap state and asserts the signed-out render path plus authenticated redirect behavior.

test analysis:
The existing RoleGate route test validates a different guard pattern for protected role-gated routes; /register uses PublicOnlyRoute in App.tsx and is not referenced by the included tests.

suggested regression test:
Render the App router or buildRouter-equivalent with MemoryRouter/createMemoryRouter for initial path /register, assert RegisterPage is rendered when ready=true and user=null, assert /dashboard navigation when a user exists, and assert the loading screen when ready=false.

minimum fix scope:
Add route-level test coverage around App.tsx PublicOnlyRoute /register behavior; no production code change is implied by this finding.

## low: Route is present but has no route-level coverage

id: fnd_sig-feat-route-ca9f14fea0-fbdc64_dae2524c93
category: test-gap
confidence: high
triage: test-gap
status: open
feature: React route /accept-invite (feat_route_ca9f14fea0)

evidence:
- artifacts/cadstone/src/App.tsx:154-158 (buildRouter)
- artifacts/cadstone/package.json:12
- artifacts/cadstone/src/components/auth/RoleGate.test.ts:93-124 (renderRoutePattern)

The new /accept-invite route is declared only in App.tsx under PublicOnlyRoute, but the linked tests exercise ErrorBoundary, RoleGate, PDF annotation helpers, API error helpers, percent math, role access, and Sentry filtering. None import App.tsx, build the application router, or assert that /accept-invite resolves to the invite screen instead of being redirected or falling through to NotFound. A future typo, route nesting change, or guard regression could break invite links without failing the included test suite.

recommendation:
Add a focused App routing test for /accept-invite, covering at least signed-out access with a token and the signed-in redirect behavior. If direct App rendering is too heavy, expose or test the router construction path with lightweight page mocks.

test analysis:
The current associated tests do not render App.tsx or navigate to /accept-invite. RoleGate.test.ts has route-element coverage for RoleGate-specific nesting, but it does not cover PublicOnlyRoute or the AcceptInvitePage route declaration.

suggested regression test:
Create an App route test that initializes the auth store as signed out, navigates to /accept-invite?token=test-token, and asserts the invite activation UI is reachable; then initialize a signed-in user and assert the same URL redirects to /dashboard.

minimum fix scope:
Frontend test-only change under artifacts/cadstone, with no production route changes required.

## low: Catch-all route is only reachable after authentication

id: fnd_sig-feat-route-f9d1fe0cf6-b8acbe_83b1f37b19
category: bug
confidence: medium
triage: risk
status: open
feature: React route /* (feat_route_f9d1fe0cf6)

evidence:
- artifacts/cadstone/src/App.tsx:160-161 (buildRouter)
- artifacts/cadstone/src/App.tsx:248-249 (buildRouter)
- artifacts/cadstone/src/App.tsx:87-98 (ProtectedRoute)

The wildcard NotFoundPage route is nested under ProtectedRoute. For any unknown URL while signed out, React Router can match the wildcard branch, but ProtectedRoute renders the /login redirect before AppLayout and NotFoundPage are reached. That means the semantic route is not actually a global /* not-found route; unauthenticated users get login for bad URLs and, after login, may land on dashboard rather than seeing a 404 for the original invalid path.

recommendation:
Place a public catch-all NotFoundPage route outside the ProtectedRoute branch if unknown public URLs should render 404s, or explicitly document and test that all unknown app URLs intentionally require authentication before showing a not-found state.

test analysis:
The linked tests exercise ErrorBoundary, RoleGate, API-error helpers, and unrelated file/role utilities. They do not render App.tsx or assert wildcard routing behavior for signed-out users.

suggested regression test:
Add a router test that initializes auth with no user, navigates to an unknown path such as /missing-route, and asserts the intended result: NotFoundPage if the catch-all is meant to be public, or /login if auth-before-404 is intentional.

minimum fix scope:
Adjust only the App.tsx route tree around the wildcard route, plus a focused router regression test.

repro:
Start with no authenticated user and visit /definitely-not-a-route. The matched wildcard route is guarded by ProtectedRoute, so the rendered result is a Navigate to /login instead of NotFoundPage.

## low: Legacy /files redirects are not covered by route tests

id: fnd_sig-feat-route-fdbf1a777f-3cba5e_6d4f72fda2
category: test-gap
confidence: high
triage: test-gap
status: open
feature: React route /files (feat_route_fdbf1a777f)

evidence:
- artifacts/cadstone/src/App.tsx:101-105 (FilesRedirect)
- artifacts/cadstone/src/App.tsx:188-191
- artifacts/cadstone/src/components/auth/RoleGate.test.ts:98-130 (renderRoutePattern)

The feature is a backward-compatibility route whose behavior depends on the authenticated user's role. The linked tests cover RoleGate patterns and role helper behavior, but they never mount the /files routes or assert that admins land on /clients while field users land on /jobs. A future edit could remove one of the legacy /files paths or invert the redirect target while all listed tests still pass.

recommendation:
Add a focused router test for /files, /files/documents, /files/photos, and /files/videos that seeds the auth store for admin and non-admin roles and asserts the final route target.

test analysis:
RoleGate.test.ts builds a separate MemoryRouter around /sales, /dashboard, and /403; the other linked tests exercise unrelated file annotation, API error, percent, and Sentry helpers. None imports App.tsx, buildRouter, or FilesRedirect.

suggested regression test:
In a new App route test, render the app router or an exported route builder with seeded useAuthStore users and assert /files redirects to /clients for admin and /jobs for project_manager/crew_member, including the three legacy subpaths.

minimum fix scope:
Frontend test coverage only; no production code change is required unless route internals need to be exported to make the test practical.

## medium: Package scripts expose unsafe Drizzle schema mutation commands without an enforced throwaway-database guard

id: fnd_sig-feat-service-1452ee5999-26aa_13d80a6ff4
category: data-loss
confidence: high
triage: confirmed-bug
status: open
feature: Node package @workspace/db (feat_service_1452ee5999)

evidence:
- lib/db/package.json:13-19 (scripts)
- lib/db/README.md:6-12
- lib/db/README.md:55-57

The manifest makes destructive or workflow-bypassing database operations first-class pnpm scripts. The README explicitly says push-force can lose production data and that generated migrations are intentionally not used, but those restrictions are only advisory. If a developer has DATABASE_URL pointed at dev/prod, `pnpm --filter @workspace/db push-force` can mutate the live schema outside the idempotent migration runner, and `generate` can create migration artifacts that violate the documented source-of-truth workflow.

recommendation:
Remove the `generate`, `db:generate`, `push`, `db:push`, and `push-force` scripts, or replace them with wrapper scripts that fail unless an explicit throwaway-database guard is satisfied, such as a dedicated `ALLOW_UNSAFE_DB_PUSH=throwaway` flag plus validation that the target database name/host is local or scratch-only.

test analysis:
No linked tests were supplied for the package manifest scripts, and this risk is a developer-command safety gap rather than behavior exercised by unit tests.

suggested regression test:
Add a small script-level test for any retained unsafe wrapper that proves it exits nonzero without the explicit throwaway guard and with production-like DATABASE_URL values.

minimum fix scope:
Update lib/db/package.json scripts and, if wrappers are introduced, add the guard script and its focused test.

## medium: Schema parity normalization can hide table/constraint drift

id: fnd_sig-feat-service-1f3633d7a3-9fcc_7656ed8099
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: Node source lib/db/src/scripts (feat_service_1f3633d7a3)

evidence:
- lib/db/src/scripts/verify-schema-parity.ts:110-169 (normalize)
- lib/db/src/scripts/verify-schema-parity.ts:150-152 (normalize)

The parity checker sorts every retained pg_dump line globally after removing CREATE TABLE block structure. That makes column lines independent of their owning table, so a migration/schema mismatch that moves or omits a same-text column under a different table can normalize to the same output. The dedicated daily_log_settings_singleton filter also drops the only lines that prove the singleton uniqueness exists, so one side can lose that data-integrity constraint and still compare equal. This undermines the script's stated role of catching semantic migration/schema drift before release.

recommendation:
Normalize per statement/block instead of globally sorting all lines. Keep each CREATE TABLE block associated with its table name, sort only column lines within that block, and canonicalize the daily_log_settings uniqueness into a stable semantic line rather than deleting it.

test analysis:
No tests are linked for this feature, and the script has no unit coverage around normalize false-negative cases.

suggested regression test:
Add normalize tests with two synthetic pg_dump inputs that differ only by moving a column between tables, and another pair where one side lacks the daily_log_settings singleton unique enforcement. Both should produce unequal normalized output.

minimum fix scope:
Refactor `normalize` in `lib/db/src/scripts/verify-schema-parity.ts` and add focused tests for block-aware normalization.

repro:
Create two schema dumps where dump A has `CREATE TABLE public.a (\n  shared integer\n); CREATE TABLE public.b ();` and dump B has `CREATE TABLE public.a (); CREATE TABLE public.b (\n  shared integer\n);`. After this normalize implementation, both contain the same sorted table headers and `shared integer` line, so the mismatch is hidden. Similarly, remove the daily_log_settings singleton unique index/constraint from one dump: the remaining singleton line is filtered away.

## medium: Test database setup can drop any database named in the environment

id: fnd_sig-feat-service-1f3633d7a3-fb0b_de0d16551b
category: data-loss
confidence: high
triage: confirmed-bug
status: open
feature: Node source lib/db/src/scripts (feat_service_1f3633d7a3)

evidence:
- lib/db/src/scripts/setup-test-db.ts:45-83 (recreateDatabase)
- lib/db/src/scripts/setup-test-db.ts:128-136 (main)

`setup-test-db` is intentionally destructive, but it trusts TEST_DATABASE_URL/CADSTONE_TEST_DATABASE_URL completely. If a developer shell or CI job accidentally points either variable at a non-test database, the script terminates active sessions, drops that database, recreates it, and runs `drizzle-kit push --force`. There is no guard that the target database name is disposable, despite the repo conventions treating push-force as throwaway-only.

recommendation:
Require a hard guard before destructive operations, such as allowing only database names that end with `_test` or `_parity_*`, or requiring an explicit confirmation env var containing the exact database name for non-default targets. Log the fully qualified target before the guard and fail closed.

test analysis:
No tests are linked for this feature, and destructive-script safety is not exercised by the existing package scripts shown here.

suggested regression test:
Add a unit test around target validation that accepts `cadstone_test` and rejects `cadstone`, `postgres`, and arbitrary non-test names before `recreateDatabase` can open a client.

minimum fix scope:
Add target-name validation to `setup-test-db.ts` before `recreateDatabase`, and cover the validation helper with focused tests.

repro:
Run `TEST_DATABASE_URL=postgres://user:pass@host:5432/app_dev pnpm setup-test-db`. The script targets `app_dev`, terminates sessions, drops it, recreates it, and pushes the schema.

## low: Linked auth E2E spec is not run by the declared test command

id: fnd_sig-feat-service-3aa6f1b4db-be20_fcd11dc48a
category: test-gap
confidence: high
triage: test-gap
status: open
feature: Node source artifacts/cadstone/src/store (feat_service_3aa6f1b4db)

evidence:
- artifacts/cadstone/package.json:9-11 (scripts.test)
- artifacts/cadstone/tests/e2e/auth.spec.ts:1

The feature metadata links artifacts/cadstone/tests/e2e/auth.spec.ts with command pnpm --dir artifacts/cadstone test, but the package test script only runs Node test files under src/**/*.test.ts. This Playwright spec under tests/e2e is only covered by the separate test:e2e script, so the declared feature test command can pass without exercising the associated auth behavior.

recommendation:
Update the feature/test mapping to use pnpm --dir artifacts/cadstone test:e2e for this spec, or add an appropriate src/**/*.test.ts unit test if the intended check is the package test script.

test analysis:
The included Playwright spec is present, but the command associated with this feature does not invoke Playwright or include tests/e2e paths.

minimum fix scope:
Correct the test command for this feature or add a package script that explicitly runs the linked auth E2E spec.

repro:
Run pnpm --dir artifacts/cadstone test; the command expands only src/**/*.test.ts and does not execute tests/e2e/auth.spec.ts.

## high: Seed CLI can write fixed demo credentials into production

id: fnd_sig-feat-service-5398b56df2-0611_656696942f
category: security
confidence: high
triage: confirmed-bug
status: open
feature: Node source lib/db/src (feat_service_5398b56df2)

evidence:
- lib/db/src/seed.ts:23 (DEFAULT_SEED_PASSWORD)
- lib/db/src/seed.ts:208-228 (upsertUser)
- lib/db/src/seed-cli.ts:4-5 (main)
- lib/db/src/index.ts:40-65

The seed path has no production guard. Because the shared db module deliberately uses SUPABASE_DATABASE_URL when NODE_ENV is production, running the package seed script in a production environment will upsert known demo users and reset their password hashes to a hard-coded password from source. That creates known-login accounts and also writes demo jobs/leads/files into the live database.

recommendation:
Make seedDatabase or seed-cli fail when NODE_ENV=production unless an explicit, narrowly named override is set, and avoid returning/printing static credentials for any environment that can point at shared infrastructure.

test analysis:
No seed tests are linked, and the existing migration-runner tests only exercise migration behavior, not seed safety under production env selection.

suggested regression test:
Add a seed-cli/seedDatabase test that sets NODE_ENV=production with SUPABASE_DATABASE_URL and asserts the seed path rejects before any inserts or password hashing occur unless the explicit override is present.

minimum fix scope:
Add an environment guard at the start of seedDatabase or seed-cli and cover it with a focused unit test.

repro:
Set NODE_ENV=production and SUPABASE_DATABASE_URL to a production database, then run `pnpm --filter @workspace/db seed`; seedDatabase will hash DEFAULT_SEED_PASSWORD and upsert the seed users.

## medium: Migration runner has no cross-process lock

id: fnd_sig-feat-service-5398b56df2-43c8_5eacb846de
category: concurrency
confidence: high
triage: confirmed-bug
status: open
feature: Node source lib/db/src (feat_service_5398b56df2)

evidence:
- lib/db/src/migrate.ts:202-208 (applyMigrations)
- lib/db/src/migrate.ts:213-220 (applyMigrations)
- lib/db/src/migrate.ts:247-258 (applyMigrations)

applyMigrations reads the migration ledger once, then executes each missing SQL file and inserts its ledger row without taking an advisory lock or table lock. If two app instances boot against the same database, both can observe the same migration as pending. One instance may commit first while the other still runs the same migration and then fails on duplicate ledger insert or conflicting DDL, causing an avoidable deploy/startup failure.

recommendation:
Serialize migration application with a PostgreSQL advisory lock around the full applyMigrations critical section. After acquiring the lock, re-read the ledger before applying files, and release the lock in finally.

test analysis:
The linked migrate-runner test checks a second serial pass is a no-op, but it does not run two migration runners concurrently against the same scratch database.

suggested regression test:
Add a scratch-database test that starts two applyMigrations calls concurrently and asserts both resolve, only one applies each file, and the second reports skipped after waiting for the lock.

minimum fix scope:
Add lock acquisition/release in applyMigrations and re-read existingRows after the lock is held.

repro:
On a database with at least one pending migration, run two applyMigrations(pool) calls concurrently in separate processes or Promise.all calls. Both can read the same existingRows before either inserts the new filename; the loser will attempt the same migration and fail.

## medium: Seed relation rewrites are not transactional

id: fnd_sig-feat-service-5398b56df2-8a21_d76df8bc1a
category: data-loss
confidence: medium
triage: risk
status: open
feature: Node source lib/db/src (feat_service_5398b56df2)

evidence:
- lib/db/src/seed.ts:479-489 (upsertScheduleItem)
- lib/db/src/seed.ts:546-566 (upsertDailyLog)
- lib/db/src/seed.ts:572-906 (seedDatabase)

The seed routine updates parent rows and then deletes/reinserts child relations such as schedule assignees, daily-log tags, and daily-log attachments without a surrounding transaction. If the process crashes or a later insert fails after one of the deletes, previously existing relation rows are committed as deleted while the replacement rows may be missing, leaving a partially seeded database.

recommendation:
Run the full seed operation, or at least each parent-plus-child rewrite, inside a transaction. Prefer a transaction-scoped Drizzle client passed through the upsert helpers so failures roll back the relation deletes and parent updates together.

test analysis:
There are no linked seed tests that simulate mid-seed failures or assert rollback semantics for child relation replacement.

suggested regression test:
Add a seed test that starts from existing schedule/daily-log relations, injects a failure after the child delete, and asserts the original rows remain after seedDatabase rejects.

minimum fix scope:
Thread a transaction client through seedDatabase and the upsert helpers, and wrap destructive child rewrites in that transaction.

repro:
Run seedDatabase against an existing seeded database and force an error after `delete(scheduleItemAssignees)` or `delete(dailyLogTags)` but before the matching insert, for example by interrupting the process or injecting a constraint failure. The delete has already committed because no transaction scopes the seed run.

## medium: Invite links default to the legacy CAD Stone production domain

id: fnd_sig-feat-service-71c27e94b6-7bb8_74add6425e
category: build-release
confidence: high
triage: risk
status: open
feature: Node source lib/db/scripts (feat_service_71c27e94b6)

evidence:
- lib/db/scripts/wipe-and-seed-admins.mjs:10 (PUBLIC_HOST)
- lib/db/scripts/wipe-and-seed-admins.mjs:104-105

When APP_PUBLIC_URL is omitted, the script prints admin invite URLs on the old CAD Stone production domain. In this Stone Track workspace that can send operators to the wrong product and can leak valid invite tokens to the legacy domain via request logs or analytics if someone follows the printed link. A white-label workspace should fail loudly when its public host is not configured instead of falling back to the legacy production URL.

recommendation:
Remove the cadstonesystems.com default and require APP_PUBLIC_URL to be set explicitly, or default only to a local development URL when the database target has already been validated as local/disposable.

test analysis:
No tests are linked for URL generation or environment validation in this script.

suggested regression test:
Add a test that runs without APP_PUBLIC_URL and verifies the script exits with a clear configuration error before generating invite links.

minimum fix scope:
Change PUBLIC_HOST initialization and validation in lib/db/scripts/wipe-and-seed-admins.mjs.

## medium: Wipe and admin seeding are not atomic

id: fnd_sig-feat-service-71c27e94b6-8be8_d6a1311ac4
category: data-loss
confidence: high
triage: confirmed-bug
status: open
feature: Node source lib/db/scripts (feat_service_71c27e94b6)

evidence:
- lib/db/scripts/wipe-and-seed-admins.mjs:74-76
- lib/db/scripts/wipe-and-seed-admins.mjs:80-102
- lib/db/scripts/wipe-and-seed-admins.mjs:114-117

The script commits the TRUNCATE before inserting replacement admin users. If bcrypt hashing, token generation, schema constraints, gen_random_uuid availability, or any INSERT fails after the truncate, the catch handler only reports failure and leaves the database wiped with no seeded admin accounts. For a destructive maintenance script, truncate plus seed should succeed or roll back as a unit.

recommendation:
Wrap the wipe and all admin inserts in a single transaction with BEGIN/COMMIT and ROLLBACK on failure. Keep client.end() in finally after rollback attempts.

test analysis:
No tests are included for partial failure behavior, and there is no evidence of a harness that simulates insert failure after TRUNCATE.

suggested regression test:
Add a test using a mocked pg Client that makes the first admin INSERT fail and asserts the script issues ROLLBACK rather than leaving the TRUNCATE committed.

minimum fix scope:
Add transaction handling around the TRUNCATE and insert loop in lib/db/scripts/wipe-and-seed-admins.mjs.

## high: Destructive wipe can run against any configured database without a safety gate

id: fnd_sig-feat-service-71c27e94b6-a769_d1fcff33f5
category: data-loss
confidence: high
triage: confirmed-bug
status: open
feature: Node source lib/db/scripts (feat_service_71c27e94b6)

evidence:
- lib/db/scripts/wipe-and-seed-admins.mjs:5-8 (DATABASE_URL)
- lib/db/scripts/wipe-and-seed-admins.mjs:74-76

The script accepts whatever SUPABASE_DATABASE_URL is present and immediately truncates all listed application tables with CASCADE. Because there is no explicit confirmation token, environment allowlist, local-only check, or dry-run mode, a misconfigured shell or copied production DSN can irreversibly wipe a real database. The destructive behavior is intentional, but the missing guard is the defect.

recommendation:
Add a hard safety gate before connecting or truncating, such as requiring a typed confirmation environment variable containing the database host/name, rejecting known production hosts, and refusing to run unless NODE_ENV or an explicit WIPE_AND_SEED_ADMINS_CONFIRM flag marks the target as disposable. Print the target database identity before the final confirmation.

test analysis:
No tests are linked for this script, and package.json only exposes generic workspace checks; there is no test asserting that destructive scripts refuse unsafe targets.

suggested regression test:
Add a script-level test that runs with a representative production-looking SUPABASE_DATABASE_URL and verifies the process exits before issuing TRUNCATE unless the explicit confirmation variable is present.

minimum fix scope:
Update lib/db/scripts/wipe-and-seed-admins.mjs to validate the target database and require explicit confirmation before TRUNCATE.

## low: Exported lead status values omit a database-accepted status

id: fnd_sig-feat-service-9d8d01c5ff-40b6_ee11ba9b13
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: Node source lib/db/src/schema (feat_service_9d8d01c5ff)

evidence:
- lib/db/src/schema/index.ts:63-69 (leadStatuses)
- lib/db/src/schema/index.ts:518-520 (leads)

The public schema export leadStatuses does not include qualified, while the leads.status check constraint explicitly allows it. Any package consumer using the exported constant as the source of truth will reject or omit a valid database status, and the duplicated literals make future drift likely.

recommendation:
Add qualified to leadStatuses and prefer deriving route/API validation lists from the exported constant where feasible.

test analysis:
No linked tests were provided for this feature, and there is no schema-level drift test ensuring exported status constants match the database constraints.

suggested regression test:
Assert that leadStatuses includes every status accepted by leads_status_check, including qualified.

minimum fix scope:
Update the leadStatuses export and add a focused drift test for lead status values.

## medium: Idempotency records are keyed across all tenants for the same user

id: fnd_sig-feat-service-9d8d01c5ff-b36b_b9b0d235dd
category: security
confidence: high
triage: confirmed-bug
status: open
feature: Node source lib/db/src/schema (feat_service_9d8d01c5ff)

evidence:
- lib/db/src/schema/index.ts:1262-1267 (idempotencyKeys)
- lib/db/src/schema/index.ts:1279-1284 (idempotencyKeys)

The table has an organization_id column, but the uniqueness boundary for replay reservations ignores it. In a multi-tenant account where the same user can act in multiple organizations, reusing the same Idempotency-Key on the same method/path can collide across tenants. That can block a valid write for the second tenant or replay a response created under the first tenant if the request hash matches, violating tenant isolation for an operation whose state is explicitly tenant-bearing.

recommendation:
Scope idempotency uniqueness by organization_id and ensure reservation, lookup, update, and delete paths populate and filter by the active organization. If legacy null organization rows must remain, use separate partial unique indexes for organization_id is not null and organization_id is null.

test analysis:
No linked tests were provided for this feature, and the schema alone has no assertion that idempotency keys are isolated for the same user across two organizations.

suggested regression test:
Create a user with memberships in two organizations, issue the same write request path with the same Idempotency-Key in each active organization, and assert two independent idempotency rows/responses are produced rather than a replay or conflict.

minimum fix scope:
Change the idempotency_keys schema/index and the idempotency middleware's conflict target and lookup predicates to include active organization scope.

## medium: Root resource folder names are globally unique instead of tenant-scoped

id: fnd_sig-feat-service-9d8d01c5ff-f7e4_85e0547dc1
category: security
confidence: high
triage: confirmed-bug
status: open
feature: Node source lib/db/src/schema (feat_service_9d8d01c5ff)

evidence:
- lib/db/src/schema/index.ts:382-385 (folders)
- lib/db/src/schema/index.ts:440-444 (folders)

Resource folders carry organization_id, but the root resource-folder uniqueness constraint only uses title and media_type. Two different tenants cannot both create an undeleted root resource folder with the same title/media type, and the duplicate-key failure leaks that another tenant already used the name while denying a legitimate tenant-local folder.

recommendation:
Include organization_id in the resource folder unique indexes, with a separate legacy-null partial index only if null organization rows must remain supported.

test analysis:
No linked tests were provided for this feature, and the schema has no tenant-pair test that creates identical resource root folders in separate organizations.

suggested regression test:
Insert two organizations and create a root resource folder with the same title, mediaType, and scope for each; assert both inserts succeed and duplicate names are only rejected within the same organization.

minimum fix scope:
Update the folders resource unique indexes and corresponding migration to make root and child resource-folder uniqueness tenant-scoped.

## high: Test database setup can drop any database named in TEST_DATABASE_URL

id: fnd_sig-feat-service-a21ae31491-7553_288a202a30
category: data-loss
confidence: high
triage: confirmed-bug
status: open
feature: Node source lib/db/src/scripts (feat_service_a21ae31491)

evidence:
- lib/db/src/scripts/setup-test-db.ts:9-18 (resolveTestDatabaseUrl)
- lib/db/src/scripts/setup-test-db.ts:51-82 (recreateDatabase)
- lib/db/src/scripts/setup-test-db.ts:125-128 (main)

setup-test-db is destructive and accepts any TEST_DATABASE_URL or CADSTONE_TEST_DATABASE_URL. If that environment variable is accidentally pointed at a shared, staging, or production database, the script connects to the cluster maintenance database and drops/recreates the named database without a guard that the target is local or test-named. The AGENTS.md rules also treat migrations and test setup as sensitive production boundaries, so this should fail closed before issuing DROP DATABASE.

recommendation:
Add an explicit safety gate before recreateDatabase runs. For example, require the database name to include `_test` or `test`, require localhost/127.0.0.1 unless an explicit override such as `ALLOW_DESTRUCTIVE_TEST_DB_RESET=1` is set, and print the resolved target before failing. Keep the override noisy and documented only for disposable CI databases.

test analysis:
No tests are linked for these scripts, and none of the included files exercise refusal behavior for unsafe database URLs.

suggested regression test:
Add a unit test around the target validation helper showing that production-like hosts or database names are rejected, while the default local cadstone_test URL and an explicitly allowed disposable CI URL pass.

minimum fix scope:
Add and call a validation helper in setup-test-db.ts before opening the maintenance connection; optionally share the same validation with ensure-test-db before it invokes setup-test-db.

repro:
Set TEST_DATABASE_URL to a reachable non-test PostgreSQL database URL and run `pnpm --filter @workspace/db setup-test-db`; the script will connect to `/postgres`, terminate sessions, then drop and recreate the target database name.

## high: Wipe and reseed are not atomic

id: fnd_sig-feat-service-c45232b908-3e74_6a6fa8d333
category: data-loss
confidence: high
triage: confirmed-bug
status: open
feature: Node source lib/db/scripts (feat_service_c45232b908)

evidence:
- lib/db/scripts/wipe-and-seed-admins.mjs:72-75
- lib/db/scripts/wipe-and-seed-admins.mjs:79-105
- lib/db/scripts/wipe-and-seed-admins.mjs:117-120

The script truncates all data and then performs multiple asynchronous bcrypt operations and INSERTs outside a transaction. If bcrypt fails, a database constraint changes, the connection drops, or the second INSERT fails, the catch block only reports the error after the TRUNCATE has already committed. That can leave the database wiped with zero or only one admin account seeded.

recommendation:
Wrap the destructive operation and all admin inserts in a single transaction using BEGIN, COMMIT, and ROLLBACK. Only print success and invite links after COMMIT succeeds.

test analysis:
No tests are linked for this script, so there is no failure-injection coverage for post-truncate insert errors or transaction rollback behavior.

suggested regression test:
Add a database integration test or mocked pg client test that forces the second admin INSERT to fail and asserts the script issues ROLLBACK and does not leave the truncation committed.

minimum fix scope:
Update lib/db/scripts/wipe-and-seed-admins.mjs so TRUNCATE and all INSERT statements execute within one transaction with rollback on any error.

## medium: Raw invite tokens are persisted alongside their hashes

id: fnd_sig-feat-service-c45232b908-3f30_f97e90577b
category: security
confidence: medium
triage: risk
status: open
feature: Node source lib/db/scripts (feat_service_c45232b908)

evidence:
- lib/db/scripts/wipe-and-seed-admins.mjs:48-56 (generateInvite)
- lib/db/scripts/wipe-and-seed-admins.mjs:92-101

The script generates a high-entropy invite token and stores both the SHA-256 hash and the raw token in the users table. Persisting the raw bearer token weakens the protection provided by the hash: anyone with read access to the database can redeem the invite directly until expiration, instead of needing the out-of-band link.

recommendation:
Persist only invite_token_hash and expiration for new invites, and remove invite_token from this insert path unless a documented legacy compatibility path still requires it. If the column must remain, write NULL for newly generated invites.

test analysis:
No tests are linked for invite creation in this script, and there is no included assertion about whether raw invite tokens should remain absent from persistent storage.

suggested regression test:
Add a test for the admin seeding path that captures INSERT parameters and asserts the raw invite token is not written to the database while the hash and expiration are.

minimum fix scope:
Change the INSERT in lib/db/scripts/wipe-and-seed-admins.mjs to avoid persisting invite.token and align the column list/placeholders accordingly.

## critical: Destructive wipe can run against any configured database without a safety gate

id: fnd_sig-feat-service-c45232b908-489b_488a7836b9
category: data-loss
confidence: high
triage: confirmed-bug
status: open
feature: Node source lib/db/scripts (feat_service_c45232b908)

evidence:
- lib/db/scripts/wipe-and-seed-admins.mjs:5-9
- lib/db/scripts/wipe-and-seed-admins.mjs:72-75

The script takes whatever SUPABASE_DATABASE_URL is present and immediately truncates 50 tables with identity reset and cascade. There is no environment allowlist, database-name/host guard, explicit confirmation token, dry-run mode, or production-domain rejection before the destructive operation. A developer shell or CI job with a production or shared Supabase URL would irreversibly delete application data.

recommendation:
Add a hard safety gate before connecting or truncating: require an explicit destructive confirmation environment variable, reject known production/shared hosts or database names, and ideally require a local/test database marker. Consider printing the target host/database and aborting unless an exact confirmation value is supplied.

test analysis:
No tests are linked for this feature, and the package manifest exposes no script-specific test around destructive database safety.

suggested regression test:
Add a script-level test or small guard module test that sets SUPABASE_DATABASE_URL to a representative production/shared URL and asserts the script aborts before issuing TRUNCATE unless the explicit confirmation gate is present.

minimum fix scope:
Modify lib/db/scripts/wipe-and-seed-admins.mjs to validate the target database and require an explicit destructive confirmation before client.connect() or any TRUNCATE query.

## medium: Migration application has no cross-process lock

id: fnd_sig-feat-service-d1efec95ee-4203_51736ae77e
category: concurrency
confidence: high
triage: confirmed-bug
status: open
feature: Node source lib/db/src (feat_service_d1efec95ee)

evidence:
- lib/db/src/migrate.ts:207-216 (applyMigrations)
- lib/db/src/migrate.ts:229-258 (applyMigrations)

Two processes can call applyMigrations against the same database at the same time, both read the ledger before either inserts the pending migration row, and both try to execute the same SQL. The second process can fail on DDL conflicts or the ledger primary key insert, which turns a normal multi-instance deploy or concurrent CLI/server boot into a startup failure even though migrations are otherwise idempotent.

recommendation:
Acquire a Postgres advisory lock for the whole migration run before reading workspace_schema_migrations, and release it in finally. Keep the ledger read and migration application inside the locked section.

test analysis:
The inspected migration tests exercise baseline and idempotent sequential runs, but there is no test that runs applyMigrations concurrently against the same database.

suggested regression test:
Add a migration-runner test that launches two applyMigrations calls in parallel against the same scratch database and asserts both complete without duplicate DDL/ledger failures, with one applying and the other skipping after the lock.

minimum fix scope:
lib/db/src/migrate.ts applyMigrations locking around ledger read, baseline backfill, and per-file application.

repro:
Start two Node processes that call applyMigrations() simultaneously against a database with at least one pending migration; both can observe the same missing filename before either commits, then one fails while applying the already-applied migration or inserting the duplicate ledger row.

## high: Seed command can create known-password admin users against production

id: fnd_sig-feat-service-d1efec95ee-e5bc_130c0c6916
category: security
confidence: medium
triage: risk
status: open
feature: Node source lib/db/src (feat_service_d1efec95ee)

evidence:
- lib/db/src/seed.ts:23-30 (DEFAULT_SEED_PASSWORD)
- lib/db/src/seed.ts:208-228 (upsertUser)
- lib/db/src/seed.ts:572-576 (seedDatabase)
- lib/db/src/seed-cli.ts:11-24 (main)

The seed path hashes a hard-coded password, upserts a seed admin, updates matching existing users to that password, and prints it. The comments say it is dev-only, but there is no runtime guard preventing the CLI from running with production environment variables. If invoked against production, this creates or resets privileged accounts to a known credential and leaks that credential to logs/stdout.

recommendation:
Add an explicit production guard to seedDatabase or seed-cli that refuses to run when NODE_ENV=production unless a deliberate, audited override is provided. Prefer generating a random seed password per run and avoid printing it in production-like environments.

test analysis:
No linked tests were provided for this feature, and the inspected seed code has no test asserting production refusal or password handling.

suggested regression test:
Add a seed-cli test that sets NODE_ENV=production and asserts the command refuses to run without an explicit override, and another test that confirms non-production seeding still works.

minimum fix scope:
lib/db/src/seed-cli.ts and/or lib/db/src/seed.ts production-environment guard and password generation/printing behavior.

repro:
Run the db seed CLI with NODE_ENV=production and SUPABASE_DATABASE_URL pointed at a real database; seedDatabase will upsert the listed admin user with password Cadstone123! and seed-cli will print the password.

## high: Tenant-scoped child rows can reference parents from other tenants

id: fnd_sig-feat-service-e722b7a400-8a16_f75d6f922f
category: security
confidence: high
triage: confirmed-bug
status: open
feature: Node source lib/db/src/schema (feat_service_e722b7a400)

evidence:
- lib/db/src/schema/agent.ts:109-114 (agentMessages)
- lib/db/src/schema/index.ts:614-630 (leadAttachments)
- lib/db/src/schema/index.ts:766-785 (scheduleItemAttachments)

These tables store an organization_id but only enforce single-column foreign keys to their parents. The database therefore accepts rows whose tenant column does not match the referenced conversation, lead, schedule item, or file tenant. In a multi-tenant SaaS where tenant isolation is a security boundary, any missed application-side validation can create cross-tenant message/file associations and expose or corrupt another tenant's data.

recommendation:
Enforce tenant consistency at the database boundary: make tenant-scoped organization_id columns non-null where legacy nulls are no longer allowed, add parent unique keys on (id, organization_id), and replace single-column child FKs with composite FKs such as (file_id, organization_id) -> files(id, organization_id) and (lead_id, organization_id) -> leads(id, organization_id).

test analysis:
No linked tests were supplied for this feature, and the schema has no constraint-level test that tries to insert cross-tenant attachment/message rows and expects rejection.

suggested regression test:
Add DB integration tests that seed two organizations and assert inserts linking org A lead/schedule/conversation rows to org B file/conversation parents fail at the database constraint level.

minimum fix scope:
Schema and migration updates for tenant-scoped relationship tables that duplicate organization_id and reference another tenant-owned table.

## low: Exported leadStatuses omits DB-valid qualified status

id: fnd_sig-feat-service-e722b7a400-da8e_8fac4283af
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: Node source lib/db/src/schema (feat_service_e722b7a400)

evidence:
- lib/db/src/schema/index.ts:63-69 (leadStatuses)
- lib/db/src/schema/index.ts:518-520 (leads)

The schema exports leadStatuses as the reusable TypeScript status list, but the database constraint accepts an additional value, qualified. Code deriving validation, filters, or UI options from the exported constant will reject or omit rows that the database can store.

recommendation:
Add qualified to leadStatuses or derive the DB check and exported status list from one shared source so they cannot drift.

test analysis:
No linked tests were supplied, and there is no contract test asserting exported schema constants match their database check constraints.

suggested regression test:
Add a schema contract test that verifies leadStatuses contains every literal accepted by leads_status_check, including qualified.

minimum fix scope:
Update lib/db/src/schema/index.ts leadStatuses and any generated contracts that depend on it if applicable.

## medium: Tenant-scoped uniqueness constraints omit organization_id

id: fnd_sig-feat-service-e722b7a400-ec3b_3552ea3484
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: Node source lib/db/src/schema (feat_service_e722b7a400)

evidence:
- lib/db/src/schema/index.ts:383 (folders)
- lib/db/src/schema/index.ts:435-443 (folders)
- lib/db/src/schema/index.ts:1262-1284 (idempotencyKeys)

Both folders and idempotency keys carry organization_id, but their uniqueness constraints are not tenant-scoped. Resource folders with the same title/media under different tenants will collide globally, and the same user using the same idempotency key on the same route in two organizations can collide or replay/block the wrong tenant's request.

recommendation:
Include organization_id in tenant-scoped unique indexes, with explicit partial indexes if legacy null organization rows must remain supported temporarily.

test analysis:
No linked tests were supplied, and there is no schema-level test covering duplicate resource folder names or idempotency keys across two organizations for the same user.

suggested regression test:
Add DB integration tests that insert the same resource folder name/media in two organizations and the same user/key/method/path in two organizations, expecting both inserts to succeed while duplicates within one organization still fail.

minimum fix scope:
Update affected unique indexes and add migrations for folders and idempotency_keys.

## high: Test script can inherit production mode and bypass the test DATABASE_URL

id: fnd_sig-feat-test-suite-039c65f754-5_26338ae015
category: data-loss
confidence: high
triage: confirmed-bug
status: open
feature: Package script test (@workspace/api-server) (feat_test-suite_039c65f754)

evidence:
- artifacts/api-server/package.json:13 (scripts.test)
- lib/db/src/index.ts:40-61
- artifacts/api-server/test/rate-limit.test.ts:1-4

The package test command sets DATABASE_URL but does not force NODE_ENV=test or clear SUPABASE_DATABASE_URL. The shared DB module chooses SUPABASE_DATABASE_URL whenever NODE_ENV is production, and at least some tests import @workspace/db at module load before they can sanitize process.env. Running the package test from a shell or CI job with NODE_ENV=production and SUPABASE_DATABASE_URL present would cause tests to connect to the Supabase database instead of the intended test database, despite the script's DATABASE_URL override.

recommendation:
Set NODE_ENV=test in both pretest and test scripts, and defensively blank SUPABASE_DATABASE_URL for the test invocation so DATABASE_URL/TEST_DATABASE_URL is the only DB source used by tests.

test analysis:
The existing tests run under whatever environment the package script provides; they do not validate the package-script environment contract itself, and several tests try to repair env vars only after module loading has already happened.

suggested regression test:
Add a small script-level smoke check that executes an @workspace/db import through the package test environment with NODE_ENV=production and SUPABASE_DATABASE_URL set to a sentinel value, then asserts the test harness still resolves the configured test database.

minimum fix scope:
artifacts/api-server/package.json scripts.pretest and scripts.test environment prefixes.

repro:
Run the package test with NODE_ENV=production and SUPABASE_DATABASE_URL set; tests that import @workspace/db at top level will initialize the pool from SUPABASE_DATABASE_URL before any per-test environment setup runs.

## medium: Full api-server test suite runs shared-database tests concurrently

id: fnd_sig-feat-test-suite-039c65f754-6_ac289beb38
category: concurrency
confidence: high
triage: confirmed-bug
status: open
feature: Package script test (@workspace/api-server) (feat_test-suite_039c65f754)

evidence:
- artifacts/api-server/package.json:13 (scripts.test)
- artifacts/api-server/test/rate-limit.test.ts:14-24
- artifacts/api-server/test/audit-fixes.test.ts:130-135

The script invokes Node's test runner across every api-server test file without constraining test-file concurrency. These tests share the same Postgres database and at least two suites wipe the same rate_limit_buckets table during setup. With parallel test-file execution, one suite can delete buckets while another is asserting rate-limit state, producing nondeterministic failures or masking real rate-limit behavior.

recommendation:
Either run the package test suite serially with the Node test runner's test concurrency set to 1, or provision an isolated database/schema per test process and remove shared-table destructive setup from concurrently running suites.

test analysis:
This is a harness-level scheduling issue. Individual tests can pass in isolation, and the current script does not include a deterministic stress or repeated parallel run that would expose the race reliably.

suggested regression test:
Add a CI check or package-script smoke target that runs the api-server suite with the intended serialized settings and fails if the test command omits the serialization flag.

minimum fix scope:
artifacts/api-server/package.json scripts.test, plus any needed follow-up to document or enforce the chosen shared-DB isolation strategy.

repro:
Run the full package test repeatedly on a machine where Node's test runner executes files in parallel; races are possible when rate-limit.test.ts and audit-fixes.test.ts overlap around their setup and assertions.

## low: Duplicate test ids make the tile ambiguous in strict UI tests

id: fnd_sig-feat-ui-flow-00e6136aa5-2c90_ca32e3e66d
category: maintainability
confidence: high
triage: risk
status: open
feature: React component MobileDrillTile (feat_ui-flow_00e6136aa5)

evidence:
- artifacts/cadstone/src/pages/home/MobileDrillTile.tsx:69-82 (MobileDrillTile)

The mobile button and desktop Link are both mounted at the same time and both receive the same data-testid, with visibility controlled only by CSS classes. Strict locators such as Playwright's getByTestId(testId).click() will match two elements and fail unless every test adds extra visible filtering.

recommendation:
Give breakpoint-specific test ids, omit the test id from the hidden counterpart, or expose distinct mobileTestId/desktopTestId props while preserving existing callers deliberately.

test analysis:
There are no linked component or e2e tests for this tile, so the duplicate locator issue is not exercised.

suggested regression test:
Render the component and assert the intended mobile and desktop controls can each be selected unambiguously at their breakpoint.

minimum fix scope:
Adjust MobileDrillTile's test-id assignment and add a small locator-focused test.

repro:
Render MobileDrillTile with a testId and use a strict getByTestId locator to click it; the locator resolves to both the hidden mobile/desktop counterpart and the visible element.

## medium: Drilldowns filter only the first fetched page

id: fnd_sig-feat-ui-flow-00e6136aa5-2db0_984440ab67
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: React component MobileDrillTile (feat_ui-flow_00e6136aa5)

evidence:
- artifacts/cadstone/src/pages/home/MobileDrillTile.tsx:147-164 (ActiveJobsDrill)
- artifacts/cadstone/src/pages/home/MobileDrillTile.tsx:324-346 (OpenScheduleDrill)

The active-jobs and schedule drilldowns fetch a single capped page and then apply the open-item filter locally. If eligible rows are beyond that first page, the sheet omits them or can show an empty state even though the home tile count indicates open records exist.

recommendation:
Push filters into the API request where supported, and either page through results until the drilldown has the intended set or clearly render a capped result with a continuation path.

test analysis:
No linked tests exercise paginated API responses or compare the drilldown contents with the summary count.

suggested regression test:
Mock paginated jobs and schedule responses where open records appear after the first page, then verify the drilldown still surfaces them or explicitly indicates the list is capped.

minimum fix scope:
Update ActiveJobsDrill and OpenScheduleDrill data loading to avoid first-page-only client-side filtering, plus focused tests for paginated responses.

repro:
Seed more than the fetched page size with non-open rows ordered before open rows, then open the mobile drilldown. The component only evaluates the first response page and excludes eligible records on later pages.

## high: Open-leads drilldown requests an invalid page size

id: fnd_sig-feat-ui-flow-00e6136aa5-4e2c_22b3e57beb
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: React component MobileDrillTile (feat_ui-flow_00e6136aa5)

evidence:
- artifacts/cadstone/src/pages/home/MobileDrillTile.tsx:257-265 (OpenLeadsDrill)

The leads API pageSize contract caps requests at 100, but this component requests pageSize=200. The request is rejected before any rows load, so the mobile Open leads sheet falls into the catch path and displays "Couldn't load leads." instead of the drilldown list.

recommendation:
Change the request to a valid pageSize, preferably with server-side status filtering and pagination handling rather than a hard-coded over-limit value.

test analysis:
No linked tests are provided for MobileDrillTile or the mobile Open leads drilldown path.

suggested regression test:
Mock the leads API to reject pageSize values above 100 and verify the component sends an allowed request and renders returned open leads in the sheet.

minimum fix scope:
Update OpenLeadsDrill's API request and add a focused component or e2e test for opening the mobile Open leads tile.

repro:
On a mobile viewport, open the Open leads tile. The component issues GET /leads?pageSize=200; the API rejects the query size and the sheet renders the generic leads error state.

## low: KbdGroup advertises div props but renders a kbd element

id: fnd_sig-feat-ui-flow-011e991e27-bfcc_4476ab5a7d
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: React component kbd (feat_ui-flow_011e991e27)

evidence:
- artifacts/cadstone/src/components/ui/kbd.tsx:18-24 (KbdGroup)

The component's public TypeScript contract says callers are configuring a div, but the implementation emits a kbd element. That exposes the wrong DOM semantics for a grouping wrapper and can mislead consumers that pass div-oriented props, refs, tests, or accessibility expectations. The sibling group components in this UI layer also use divs for group wrappers, so this looks like a concrete implementation mismatch rather than an intentional keyboard-token element.

recommendation:
Change KbdGroup to render a div, or if the kbd element is intentional, change the prop type and name to match the actual element semantics.

test analysis:
No linked tests were provided for this component, so there is no assertion on the rendered tag or public prop contract.

suggested regression test:
Add a small render test that mounts KbdGroup and asserts the root element is a DIV with data-slot="kbd-group" while Kbd still renders a KBD.

minimum fix scope:
Update KbdGroup's root element in artifacts/cadstone/src/components/ui/kbd.tsx and add focused component coverage if the project has an established UI test harness.

## medium: Stale client detail requests can overwrite the current deep link

id: fnd_sig-feat-ui-flow-0276b2855a-46aa_f24eeda0af
category: concurrency
confidence: medium
triage: risk
status: open
feature: React component clients (feat_ui-flow_0276b2855a)

evidence:
- artifacts/cadstone/src/pages/clients.tsx:284-292 (ClientsPage)
- artifacts/cadstone/src/pages/clients.tsx:303-309 (openDetail)
- artifacts/cadstone/src/pages/clients.tsx:317-318 (openDetail)

Each client query-param change launches openDetail, but the async response is applied unconditionally. If the URL changes from client A to client B while A's request is still in flight, A can resolve after B and replace selected with the wrong client. The sheet then exposes edit and delete actions for a client that no longer matches the URL.

recommendation:
Gate the response by request identity before calling setSelected/setLoadingDetail, or move detail loading to a query keyed by deepLinkClientId with cancellation/stale response handling. Also avoid clearing the current query param from a stale failed request.

test analysis:
There are no linked clients-page tests exercising rapid deep-link changes or stale detail responses.

suggested regression test:
Mock two /clients/:id responses with controlled delays, switch the client query param from A to B, resolve B first and A last, and assert the sheet still displays B and loading state remains tied to the latest request.

minimum fix scope:
Add stale-response protection in openDetail/useEffect for artifacts/cadstone/src/pages/clients.tsx.

repro:
Throttle network, navigate to /clients?client=<A>, immediately navigate to /clients?client=<B>, and let the A request finish last. The sheet can show A while the URL points at B.

## medium: Date-only job starts render one day early in western time zones

id: fnd_sig-feat-ui-flow-0276b2855a-94c6_0aca408b0e
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: React component clients (feat_ui-flow_0276b2855a)

evidence:
- artifacts/cadstone/src/pages/clients.tsx:169-170 (fmtDate)
- artifacts/cadstone/src/pages/clients.tsx:964-965 (ClientsPage)

The API convention for date fields is YYYY-MM-DD date-only strings. JavaScript parses that form as UTC midnight; in time zones west of UTC, formatting with local toLocaleDateString displays the previous calendar day. A job with projectedStart "2026-05-20" renders as May 19 for America/Los_Angeles users, so the client jobs tab can show incorrect schedule dates.

recommendation:
Format date-only strings without constructing a UTC Date, for example split YYYY-MM-DD and create a local Date with new Date(year, month - 1, day), or use a date-only formatter already used elsewhere in the app.

test analysis:
No linked tests were provided for this component, and the local test search only found role-access tests mentioning clients, not date rendering in clients.tsx.

suggested regression test:
Render the clients jobs tab with projectedStart "2026-05-20" under a TZ such as America/Los_Angeles and assert the displayed date is May 20, 2026.

minimum fix scope:
Update fmtDate in artifacts/cadstone/src/pages/clients.tsx and cover date-only formatting behavior.

repro:
Run in a Pacific-time browser or Node process: new Date("2026-05-20").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) returns May 19, 2026.

## medium: Progress fill ignores Radix max prop

id: fnd_sig-feat-ui-flow-03f52e0319-9b9b_b9f03f1758
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: React component progress (feat_ui-flow_03f52e0319)

evidence:
- artifacts/cadstone/src/components/ui/progress.tsx:9-14 (Progress)
- artifacts/cadstone/src/components/ui/progress.tsx:15-20 (Progress)

The component accepts all Radix Progress Root props and forwards them, including max, but the visual indicator always treats value as a 0-100 percentage. Consumers using the documented Radix API with a non-default max, such as value=5 and max=10, will get ARIA semantics for 50% progress while the rendered bar visually shows only 5%. That creates an accessibility/visual contract mismatch.

recommendation:
Destructure max with the same default Radix uses and compute the displayed percentage as value / max * 100, clamped to [0, 100]. Preserve explicit null/undefined handling for indeterminate or empty states rather than relying on value || 0.

test analysis:
The feature metadata lists no linked tests, and the package test glob only covers src/**/*.test.ts; no component test is included for Progress max/value rendering behavior.

suggested regression test:
Add a React/jsdom test that renders Progress with value={5} max={10} and asserts the indicator transform corresponds to 50% fill, plus a default max case such as value={25}.

minimum fix scope:
Update artifacts/cadstone/src/components/ui/progress.tsx to honor max when calculating the indicator transform and add focused component coverage for default and custom max values.

repro:
Render <Progress value={5} max={10} />. The Root receives max=10, but the Indicator transform becomes translateX(-95%), leaving a 5% fill instead of the expected 50%.

## low: Nested dashboard paths render duplicate Home breadcrumbs

id: fnd_sig-feat-ui-flow-042fe16d18-c6f4_bf7f6306f6
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: React component Breadcrumbs (feat_ui-flow_042fe16d18)

evidence:
- artifacts/cadstone/src/components/layout/Breadcrumbs.tsx:15 (SEGMENT_LABELS)
- artifacts/cadstone/src/components/layout/Breadcrumbs.tsx:40-52 (deriveFromPath)
- artifacts/cadstone/src/components/layout/Breadcrumbs.tsx:80-90 (Breadcrumbs)

For a nested route such as /dashboard/jobs, deriveFromPath includes the first segment dashboard and labels it Home, while the component also always prepends a separate Home link to /dashboard. The rendered trail becomes Home > Home > Jobs, with the second Home linking to the same dashboard target. This is confusing navigation and an accessibility/readability regression for any route under /dashboard/*.

recommendation:
When deriving fallback breadcrumbs, strip a leading dashboard segment because the component already renders the Home crumb, or skip rendering the static Home crumb when the derived list already starts at /dashboard.

test analysis:
No linked tests are included for this component, and the package test script only targets src/**/*.test.ts; there is no evidence of a breadcrumb rendering test for nested dashboard paths.

suggested regression test:
Add a React router rendering test for /dashboard/jobs asserting the breadcrumb labels are Home, Jobs rather than Home, Home, Jobs.

minimum fix scope:
Update Breadcrumbs.tsx fallback derivation/rendering logic and add a focused component test for nested dashboard routes.

repro:
Render Breadcrumbs inside a router at /dashboard/jobs with no override. The first static crumb is Home, and the first derived crumb is also Home because the dashboard segment is mapped to Home.

## low: Clear all briefly restores the stale keyword query

id: fnd_sig-feat-ui-flow-07f4246440-14a6_8d301f9e7a
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: React component daily-logs (feat_ui-flow_07f4246440)

evidence:
- artifacts/cadstone/src/pages/daily-logs.tsx:121-128 (CompanyDailyLogsPage)
- artifacts/cadstone/src/pages/daily-logs.tsx:185-199 (CompanyDailyLogsPage)
- artifacts/cadstone/src/pages/daily-logs.tsx:265-268 (clearAllFilters)

clearAllFilters clears searchInput and URL params, but it does not clear debouncedSearch immediately. On the next render, the URL-sync effect still sees the old debouncedSearch value and writes keywords back into the URL before the 300ms debounce updates it to empty. The feed params also continue using the stale keyword during that window, causing an avoidable extra filtered request and visible loading/flicker risk after the user asked to clear all filters.

recommendation:
When clearing all filters, also clear debouncedSearch synchronously, or separate URL synchronization so clearing URL params cannot be overwritten by a stale debounced value. A small helper that updates searchInput, debouncedSearch, and searchParams together would keep the states consistent.

test analysis:
No linked tests exercise Clear all with an existing keyword plus another filter, so the stale debouncedSearch state transition is unguarded.

suggested regression test:
Render with ?keywords=foo&clientId=abc, click Clear all, advance only a microtask but not the 300ms debounce, and assert keywords is not restored and the feed hook is not called with keywords: "foo" after the clear action.

minimum fix scope:
Update clearAllFilters or the keyword URL-sync effect in artifacts/cadstone/src/pages/daily-logs.tsx and cover the clear-all state transition.

repro:
Start with a URL containing both keywords and a chip-producing filter, for example ?keywords=foo&clientId=abc. Click Clear all. Before the debounce fires, the URL-sync effect can re-add keywords=foo and the feed query is built with keywords: "foo" despite the input being cleared.

## low: False boolean query values create misleading active filters

id: fnd_sig-feat-ui-flow-07f4246440-a1b7_e7b972fcec
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: React component daily-logs (feat_ui-flow_07f4246440)

evidence:
- artifacts/cadstone/src/pages/daily-logs.tsx:107-113 (CompanyDailyLogsPage)
- artifacts/cadstone/src/pages/daily-logs.tsx:196-197 (CompanyDailyLogsPage)
- artifacts/cadstone/src/pages/daily-logs.tsx:384-387 (CompanyDailyLogsPage)
- artifacts/cadstone/src/pages/daily-logs.tsx:276-283 (CompanyDailyLogsPage)

The component accepts any non-empty URL value as an active filter, but the checkbox only appears checked for the string "true". A URL such as ?hasAttachments=false therefore renders an unchecked checkbox while still showing an active "Has attachments" chip and sends hasAttachments: false to the feed request. The UI only exposes positive filters, so this makes malformed or shared URLs misleading and may invert the server-side filter.

recommendation:
Normalize boolean URL filters when deriving filters: only keep "true" for these positive filters, or add explicit UI states and labels for false values. Do not send hasAttachments/hasComments when the URL value is not a supported UI state.

test analysis:
No linked tests were provided for this feature, and the component has no evidence of coverage for URL-derived boolean filter normalization.

suggested regression test:
Render CompanyDailyLogsPage in a MemoryRouter with initial search params ?hasAttachments=false&hasComments=false, assert the checkboxes are unchecked, no active positive chips are shown, and the feed hook is called without those boolean params.

minimum fix scope:
Update filter parsing for hasAttachments and hasComments in artifacts/cadstone/src/pages/daily-logs.tsx and add a focused component test for URL boolean normalization.

repro:
Open the page with ?hasAttachments=false. The Has attachments checkbox is unchecked, but an active Has attachments chip is rendered and the query params passed to useDailyLogsGetDailyLogsFeed include hasAttachments: false.

## low: Package test command excludes TSX component tests

id: fnd_sig-feat-ui-flow-07f4246440-daf4_d80a8fb85d
category: test-gap
confidence: medium
triage: test-gap
status: open
feature: React component daily-logs (feat_ui-flow_07f4246440)

evidence:
- artifacts/cadstone/package.json:10-13
- artifacts/cadstone/src/pages/daily-logs.tsx:300-558 (CompanyDailyLogsPage)

This feature is implemented as a TSX React component, but the package test script only matches src/**/*.test.ts. A conventional daily-logs.test.tsx component test for the URL filters, debounce behavior, and pagination UI would not run under pnpm test unless it avoided JSX or used a .test.ts extension. That makes future regression coverage easy to add incorrectly and silently skip.

recommendation:
Expand the package test glob to include TSX tests, for example src/**/*.test.{ts,tsx}, and add focused tests for this component's URL/filter behavior.

test analysis:
The feature metadata lists no linked tests, and the current test command would not pick up a normal TSX component test file.

suggested regression test:
Add a minimal src/pages/daily-logs.test.tsx smoke test and verify pnpm --filter @workspace/cadstone test runs it under the updated glob.

minimum fix scope:
Update artifacts/cadstone/package.json test script and add at least one TSX component test for daily-logs.

repro:
Add src/pages/daily-logs.test.tsx and run pnpm --filter @workspace/cadstone test; the current glob does not include that file.

## medium: Financials access hiding is only applied to the tab, not the routed content

id: fnd_sig-feat-ui-flow-08aea57dd1-7a25_380783bba2
category: security
confidence: medium
triage: risk
status: open
feature: React component job-detail (feat_ui-flow_08aea57dd1)

evidence:
- artifacts/cadstone/src/pages/job-detail.tsx:97-101 (visibleTabs)
- artifacts/cadstone/src/pages/job-detail.tsx:450-470
- artifacts/cadstone/src/pages/job-detail.tsx:475-476

The component uses job.access.financials to hide the Financials tab, but it always renders the child route Outlet. A user who directly enters /jobs/:jobId/financials can still mount the financials route even when the tab would be hidden. If the child page or API does not repeat the same authorization check, this becomes a financial-data exposure path.

recommendation:
Enforce the financials access decision at the route/content boundary as well as in navigation. Redirect or render an access-denied state before mounting the financials child route, and keep backend authorization as the source of truth.

test analysis:
The feature lists no tests, and no included test covers direct navigation to a hidden tab route for a user without financial access.

suggested regression test:
Add a route-level test that renders JobDetailPage at /jobs/:id/financials with access.financials false and asserts that the financials child content is not mounted.

minimum fix scope:
Add a guard in artifacts/cadstone/src/pages/job-detail.tsx or the financials child route, plus a direct-navigation authorization regression test.

repro:
Use a non-admin user whose loaded job has access.financials false, then navigate directly to /jobs/<id>/financials instead of clicking tabs. This component does not block the Outlet from rendering.

## medium: Background refresh failures keep rendering a stale job

id: fnd_sig-feat-ui-flow-08aea57dd1-b933_a7e9ae45f2
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: React component job-detail (feat_ui-flow_08aea57dd1)

evidence:
- artifacts/cadstone/src/pages/job-detail.tsx:188-211 (loadJob)
- artifacts/cadstone/src/pages/job-detail.tsx:218
- artifacts/cadstone/src/pages/job-detail.tsx:304

The refresh subscription calls loadJob(false), which does not clear the existing job before fetching. If that fetch later fails, for example because the job was deleted or access was revoked elsewhere, the catch only sets error and leaves the old job in state. The not-found branch also requires !job, so the page keeps displaying and acting on stale job data despite the failed refresh.

recommendation:
When a background load fails with a not-found/forbidden response, clear job state or navigate away. More generally, make loadJob distinguish transient failures from invalid job state and ensure stale job data is not kept after authoritative 404/403 responses.

test analysis:
The feature lists no tests, and there is no included test covering data-refresh failure after a successful initial load.

suggested regression test:
Add a component test that first resolves jobsGetJobsId with a job, then triggers the jobs refresh callback with a rejected 404/403 response, and asserts that stale job details and actions are no longer rendered.

minimum fix scope:
Update loadJob error handling in artifacts/cadstone/src/pages/job-detail.tsx and add a focused component test for refresh failure behavior.

repro:
Load an existing job, have it deleted or made inaccessible in another session, then trigger a jobs data refresh. The refresh request fails, but the old header, tabs, outlet context, and admin actions remain visible.

## medium: Job loads can race and render the wrong job for the current route

id: fnd_sig-feat-ui-flow-08aea57dd1-ee0e_a82a6532c4
category: concurrency
confidence: high
triage: confirmed-bug
status: open
feature: React component job-detail (feat_ui-flow_08aea57dd1)

evidence:
- artifacts/cadstone/src/pages/job-detail.tsx:188-216 (loadJob)
- artifacts/cadstone/src/pages/job-detail.tsx:475-476

loadJob captures the current jobId but does not cancel the request or verify that the response still belongs to the active route before calling setJob. If a user navigates from job A to job B and the request for A resolves after B, the header and Outlet context can show job A while jobId still points at B.

recommendation:
Track a request sequence or use an abort signal/effect cleanup so only the latest jobId request can update state. Clear or ignore responses whose id no longer matches the active route.

test analysis:
The feature lists no tests, and no included test exercises rapid route changes with out-of-order job fetch completion.

suggested regression test:
Add a component test that mocks two jobsGetJobsId calls, resolves the second route's request first and the first route's request last, then asserts that only the current route's job is rendered.

minimum fix scope:
Guard the asynchronous loadJob state updates in artifacts/cadstone/src/pages/job-detail.tsx and add a route-change race regression test.

repro:
Throttle the network, open /jobs/A, quickly navigate to /jobs/B, and let the /jobs/A request resolve last. The page can render A's title/status while child routes receive the B jobId.

## low: Hidden tabs leave the mobile tab grid with an empty fifth column

id: fnd_sig-feat-ui-flow-08aea57dd1-f14a_2c3d2b19e4
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: React component job-detail (feat_ui-flow_08aea57dd1)

evidence:
- artifacts/cadstone/src/pages/job-detail.tsx:97-101 (visibleTabs)
- artifacts/cadstone/src/pages/job-detail.tsx:448-450

When the Financials tab is filtered out for users without access, visibleTabs has four entries, but the mobile nav is still forced to grid-cols-5. That leaves an empty column and compresses the available tabs instead of distributing them across the row.

recommendation:
Make the mobile grid column count match visibleTabs.length, or use a grid layout that auto-fits the rendered tab count.

test analysis:
The feature lists no tests, and no visual/layout test covers the non-financial-access tab set on mobile.

suggested regression test:
Add a responsive component or Playwright snapshot test for a non-financial-access user and assert the four visible tabs occupy the row without an empty fifth slot.

minimum fix scope:
Adjust the nav class generation in artifacts/cadstone/src/pages/job-detail.tsx and add a focused responsive rendering test if visual regressions are covered in this project.

repro:
Render the job detail page on a mobile-width viewport as a non-admin user with access.financials false. The nav has four links laid into a five-column grid, leaving unused space.

## medium: Project manager picker offers crew members as project managers

id: fnd_sig-feat-ui-flow-0ddbfdfe1f-30fc_aaa4e6fcab
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: React component client-detail (feat_ui-flow_0ddbfdfe1f)

evidence:
- artifacts/cadstone/src/pages/client-detail.tsx:354-356 (ClientDetailPage)
- artifacts/cadstone/src/pages/client-detail.tsx:291-319 (InlinePmPicker)
- artifacts/cadstone/src/pages/client-detail.tsx:455-458 (saveJobFields)

The PM picker is populated with both project_manager and crew_member users, but every selected option is sent as projectManagerId. That allows an admin using this page to store a crew member in the project-manager field, producing misleading UI and inconsistent role semantics for downstream job access and reporting.

recommendation:
Fetch only project_manager users for this picker, or include role in WorkerOption and filter options to role === "project_manager" before rendering/selecting.

test analysis:
There are no linked tests for the client-detail PM picker option set or for rejecting crew_member users in this field.

suggested regression test:
Add a client-detail UI test with one project_manager and one crew_member in the users response, then assert only the project_manager can be selected for PM assignment.

minimum fix scope:
artifacts/cadstone/src/pages/client-detail.tsx worker option loading/filtering for InlinePmPicker.

repro:
As an admin, open a client detail job row, open the PM picker, select a crew member returned by /users?roles=project_manager,crew_member, and save. The component sends that crew member id as projectManagerId.

## medium: New jobs created from client detail do not refresh the visible client jobs or rollups

id: fnd_sig-feat-ui-flow-0ddbfdfe1f-9637_9e40e47fc6
category: bug
confidence: medium
triage: risk
status: open
feature: React component client-detail (feat_ui-flow_0ddbfdfe1f)

evidence:
- artifacts/cadstone/src/pages/client-detail.tsx:390-393 (ClientDetailPage)
- artifacts/cadstone/src/pages/client-detail.tsx:1062-1067 (ClientDetailPage)
- artifacts/cadstone/src/components/jobs/CreateJobDialog.tsx:262-264 (CreateJobDialog)

Client detail renders the in-place CreateJobDialog for the current client, but it does not pass onCreated and only listens for the clients refresh event. The dialog closes and invalidates jobs/navigation, not clients. After creating a job from this page, client.jobs and rollups remain the pre-create state until some other client refetch happens or the user reloads.

recommendation:
Pass an onCreated handler that calls refetch, or have the dialog invalidate clients when it creates a job attached to a client. If using the event bus, subscribe client-detail to the jobs refresh event only when that is intended to refetch this client.

test analysis:
The linked financials rollup test revisits client detail after financial edits; it does not create a job through the embedded client-detail dialog and assert the page updates in place.

suggested regression test:
Add an e2e test that creates a job from /clients/:clientId and asserts the Jobs tab count/list and Active jobs rollup update without a hard reload.

minimum fix scope:
artifacts/cadstone/src/pages/client-detail.tsx CreateJobDialog usage, with optional shared invalidation adjustment in artifacts/cadstone/src/components/jobs/CreateJobDialog.tsx.

repro:
Open /clients/:clientId with no jobs or a known jobs count, click New Job, complete the dialog, and observe the job list/count/rollup remains unchanged after the dialog closes.

## medium: Overlapping inline saves can revert each other because each edit sends a full stale job payload

id: fnd_sig-feat-ui-flow-0ddbfdfe1f-b6f5_998e549446
category: concurrency
confidence: medium
triage: risk
status: open
feature: React component client-detail (feat_ui-flow_0ddbfdfe1f)

evidence:
- artifacts/cadstone/src/pages/client-detail.tsx:408-469 (saveJobFields)
- artifacts/cadstone/src/pages/client-detail.tsx:654-655
- artifacts/cadstone/src/pages/client-detail.tsx:920-935
- artifacts/cadstone/src/pages/client-detail.tsx:813-849

The component exposes many independent inline controls for the same job. Each control starts by GETting the current job, builds a full replacement payload from that snapshot, applies only its single override, then PUTs the full payload. If a user changes two fields quickly, both requests can read the same old snapshot; whichever PUT finishes last can restore the other field to the old value. This can lose status, date, money, or PM edits without an error.

recommendation:
Serialize per-job inline saves, disable other controls while a save is in flight, or use a partial update endpoint so each request only updates the intended field. At minimum, re-read after queued saves and merge against the latest local pending state before PUT.

test analysis:
No linked tests cover concurrent or rapid multi-field inline edits on client-detail; the existing referenced e2e test only covers financial rollup invalidation on navigation.

suggested regression test:
Add a component or e2e test that delays the first PUT, performs two inline edits against the same job, then asserts both edited fields persist after both responses resolve.

minimum fix scope:
artifacts/cadstone/src/pages/client-detail.tsx save orchestration for per-job inline edits; optionally add an API partial-update endpoint if the current full PUT contract is the root cause.

repro:
On a client with one job, quickly change the job status and a money/date field before the first save completes. If both saveJobFields calls fetch the pre-edit job, the later PUT includes the old value for the first field and reverts it.

## medium: Missing React type import can break typecheck under module TS settings

id: fnd_sig-feat-ui-flow-1a23bdb976-440f_1ee1410eaa
category: build-release
confidence: medium
triage: risk
status: open
feature: React component PdfMarkupToolbar (feat_ui-flow_1a23bdb976)

evidence:
- artifacts/cadstone/src/components/files/PdfMarkupToolbar.tsx:34 (ToolButtonProps)
- artifacts/cadstone/package.json:8

PdfMarkupToolbar.tsx is an ES module and references the React namespace only for the ReactNode type, but the file does not import React or ReactNode. In strict modern React/TypeScript configurations using the automatic JSX runtime, JSX itself does not require a React value import, but type references such as React.ReactNode still need an available React namespace or explicit type import. If the project tsconfig does not allow the UMD React global in modules, this component fails the package typecheck.

recommendation:
Add an explicit type import, for example `import type { ReactNode } from "react"`, and change the prop to `children: ReactNode`.

test analysis:
The linked tests exercise annotation editor and geometry helper modules only; they do not import or typecheck the toolbar component directly.

suggested regression test:
Keep `pnpm --dir artifacts/cadstone typecheck` in the verification path for this component, or add a lightweight component import/type smoke test if the package typecheck is not run in CI.

minimum fix scope:
One-line type import plus replacing `React.ReactNode` with `ReactNode` in `PdfMarkupToolbar.tsx`.

repro:
Run `pnpm --dir artifacts/cadstone typecheck`; TypeScript configurations that do not expose the React namespace in modules report the missing/UMD React namespace at `children: React.ReactNode`.

## low: ResizableHandle drops caller-provided children

id: fnd_sig-feat-ui-flow-1a496e6650-825a_3165d50be9
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: React component resizable (feat_ui-flow_1a496e6650)

evidence:
- artifacts/cadstone/src/components/ui/resizable.tsx:21-40 (ResizableHandle)

The public prop type is based on React.ComponentProps<typeof ResizablePrimitive.PanelResizeHandle>, so callers can supply primitive props including children. Those children are included in ...props at line 24 and spread at line 33, but JSX children at lines 35-39 override props.children. As a result, any custom handle content passed by a caller is silently discarded.

recommendation:
Either destructure children and render children ?? built-in handle content, or intentionally narrow the wrapper API with Omit<..., "children"> so callers cannot pass children that will be ignored.

test analysis:
No linked tests were provided for this component, and the repository search did not find a resizable component test.

suggested regression test:
Add a component test that renders ResizableHandle with custom children and verifies the child is present, or verifies TypeScript rejects children if the intended API disallows custom content.

minimum fix scope:
Update ResizableHandle's prop handling and add focused coverage for custom or disallowed children.

repro:
Render <ResizableHandle><span data-testid="custom" /></ResizableHandle> inside a panel group; the custom span will not appear because the wrapper replaces children with the withHandle branch.

## low: ResizablePanelGroup does not forward the primitive ref

id: fnd_sig-feat-ui-flow-1a496e6650-b4b7_85930fc6ea
category: api-contract
confidence: medium
triage: contract-mismatch
status: open
feature: React component resizable (feat_ui-flow_1a496e6650)

evidence:
- artifacts/cadstone/src/components/ui/resizable.tsx:6-17 (ResizablePanelGroup)
- artifacts/cadstone/package.json:86

react-resizable-panels PanelGroup exposes an imperative ref for layout operations. This wrapper is typed from the primitive props but is implemented as a plain function component, so a ref passed to ResizablePanelGroup is not forwarded to ResizablePrimitive.PanelGroup. Consumers using the local UI wrapper lose access to getLayout/setLayout behavior and can hit React's function-component ref warning.

recommendation:
Implement ResizablePanelGroup with React.forwardRef using React.ElementRef<typeof ResizablePrimitive.PanelGroup> and React.ComponentPropsWithoutRef<typeof ResizablePrimitive.PanelGroup>, then pass ref={ref} to the primitive.

test analysis:
No linked tests exercise ref behavior or the primitive imperative API through this wrapper.

suggested regression test:
Add a focused React test that mounts ResizablePanelGroup with a ref and verifies the ref receives the primitive handle expected from react-resizable-panels.

minimum fix scope:
Refactor only ResizablePanelGroup to forward refs and add a targeted ref behavior test.

repro:
Create a ref and pass it to <ResizablePanelGroup ref={groupRef} direction="horizontal">...</ResizablePanelGroup>; groupRef.current remains unavailable through the wrapper instead of receiving the primitive imperative handle.

## medium: Text labels have helper support for editing but no UI path opens the editor

id: fnd_sig-feat-ui-flow-1b41600c54-2498_1e4af774cf
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: React component PdfAnnotationLayer (feat_ui-flow_1b41600c54)

evidence:
- artifacts/cadstone/src/components/files/pdf-annotation-editor.test.ts:82-87 (prepareEditorForExistingNote test)
- artifacts/cadstone/src/components/files/PdfAnnotationLayer.tsx:912-918 (beginEditStickyNote)
- artifacts/cadstone/src/components/files/PdfAnnotationLayer.tsx:1157-1174 (PdfAnnotationLayer sticky note overlay)
- artifacts/cadstone/src/components/files/PdfAnnotationLayer.tsx:1136-1155 (SelectionStyleBar rendering)

The editor helper and tests explicitly support reopening text_label annotations for update, but PdfAnnotationLayer only wires beginEditStickyNote through StickyNotePin, and StickyNotePin is rendered only for sticky_note annotations. Selecting a text_label exposes only the style bar, so users cannot edit label text after creating it despite the tested helper behavior.

recommendation:
Add a text_label edit affordance in select mode, such as an Edit button in SelectionStyleBar for text labels or opening the existing editor on click/double-click, using prepareEditorForExistingNote and resolveEditorSubmit.

test analysis:
The included editor tests validate the pure helper behavior but do not render PdfAnnotationLayer or assert that a text_label annotation has a reachable Edit control.

suggested regression test:
Add a React component test that renders a text_label annotation in select mode, triggers the intended edit action, and asserts the textarea opens prefilled and submit calls onUpdate with a content patch.

minimum fix scope:
PdfAnnotationLayer text_label selection/edit UI wiring.

repro:
Create a text label, switch to select mode, and click the label. The label can be selected/moved/styled, but no Edit action opens the textarea with existing content.

## medium: Backward line and arrow creation emits negative size fields that the geometry contract rejects

id: fnd_sig-feat-ui-flow-1b41600c54-b1c5_dff217a553
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: React component PdfAnnotationLayer (feat_ui-flow_1b41600c54)

evidence:
- artifacts/cadstone/src/components/files/PdfAnnotationLayer.tsx:733-749 (finishStroke)
- artifacts/cadstone/src/components/files/use-pdf-annotations.ts:181-191 (persistDraft)
- artifacts/cadstone/src/components/files/pdf-annotation-geometry.ts:64-85 (applyDragToAnnotation)
- artifacts/cadstone/src/components/files/pdf-annotation-geometry.test.ts:185-194 (applyDragToAnnotation test)

For line/arrow creation, dragging left or upward makes dx or dy negative, and the hook sends those values unchanged to the create API. The geometry helper and tests establish that normalizedW/normalizedH are size fields kept non-negative because the API rejects negatives, so the initial create path violates the same contract that edit/resize paths enforce.

recommendation:
Make the creation path use the same endpoint normalization as the edit path, or change the API/annotation representation consistently if arrows need signed endpoint deltas to preserve direction.

test analysis:
The geometry tests cover endpoint dragging after an annotation exists, but no test covers PdfAnnotationLayer.finishStroke or creating line/arrow annotations in reverse directions.

suggested regression test:
Add a component/helper-level test for finishing a line or arrow stroke from [0.8,0.8] to [0.2,0.2] and assert the draft sent to onCreate satisfies the API size contract.

minimum fix scope:
PdfAnnotationLayer line/arrow finishStroke serialization, plus representation/API changes if arbitrary arrow direction must be preserved.

repro:
Select the line or arrow tool and drag from a lower-right point toward an upper-left point. The draft is built with negative normalizedW/normalizedH and then posted unchanged.

## medium: Undoing a just-created annotation before the debounce fires still saves it

id: fnd_sig-feat-ui-flow-1b41600c54-bdd7_fca4aa52f4
category: concurrency
confidence: high
triage: confirmed-bug
status: open
feature: React component PdfAnnotationLayer (feat_ui-flow_1b41600c54)

evidence:
- artifacts/cadstone/src/components/files/use-pdf-annotations.ts:224-244 (createAnnotation)
- artifacts/cadstone/src/components/files/use-pdf-annotations.ts:174-196 (persistDraft)
- artifacts/cadstone/src/components/files/use-pdf-annotations.ts:325-348 (undo)

createAnnotation schedules persistence after 300ms but undo() only removes the local draft and moves the history entry to redo; it does not cancel the timer or mark the draft canceled. If the user draws markup and immediately clicks Undo before the timeout fires, persistDraft still POSTs the removed draft and appends the server annotation, so an explicitly undone annotation is saved and reappears without a matching undo entry.

recommendation:
Track pending create timers by tempId and cancel them on undo, or make persistDraft check that the draft is still pending before POSTing. Also remove or update related history entries when a pending create is canceled.

test analysis:
The included tests exercise pure geometry/editor helpers only; there is no hook test with fake timers covering create debounce plus undo.

suggested regression test:
Add a usePdfAnnotations test with fake timers: call createAnnotation, call undo before advancing 300ms, advance timers, and assert api.post was not called and annotations/drafts remain empty.

minimum fix scope:
use-pdf-annotations pending-create debounce and undo handling.

repro:
Draw any annotation, click Undo within 300ms, then wait for the delayed persist. The annotation is still POSTed and appended after the undo removed the draft.

## medium: NavigationMenuTrigger exposes primitive props but breaks Radix asChild composition

id: fnd_sig-feat-ui-flow-2204d0e77e-e3b8_9a55820f79
category: api-contract
confidence: medium
triage: contract-mismatch
status: open
feature: React component navigation-menu (feat_ui-flow_2204d0e77e)

evidence:
- artifacts/cadstone/src/components/ui/navigation-menu.tsx:47-61 (NavigationMenuTrigger)
- artifacts/cadstone/package.json:48

The wrapper advertises the full Radix Trigger prop surface by using ComponentPropsWithoutRef<typeof NavigationMenuPrimitive.Trigger>, which includes Radix primitive composition props such as asChild. However, the wrapper always renders the caller's children plus a whitespace text node and a ChevronDown icon inside the primitive trigger. When asChild is supplied, Radix Slot-style primitives require a single element child to clone; this wrapper supplies multiple children, so a consumer trying to render a trigger as a router link/custom button can hit a runtime render error instead of getting the advertised primitive behavior.

recommendation:
Either explicitly omit/disable asChild from the wrapper prop type, or support it by composing the icon into the single child in a controlled way. A common low-risk fix is to define a local prop type that omits asChild if this trigger is always meant to render as a button.

test analysis:
No linked tests were provided for this feature, and the package test script only discovers src/**/*.test.ts files; there is no included smoke test for NavigationMenuTrigger composition props.

suggested regression test:
Add a component smoke test that renders NavigationMenuTrigger with ordinary children and also verifies the chosen asChild contract: either rendering with asChild works, or TypeScript rejects asChild on the exported wrapper type.

minimum fix scope:
artifacts/cadstone/src/components/ui/navigation-menu.tsx

repro:
Render NavigationMenuTrigger with asChild and a single anchor child, for example <NavigationMenuTrigger asChild><a href="/jobs">Jobs</a></NavigationMenuTrigger>. The wrapper adds the space and ChevronDown siblings, so the primitive receives more than the one child required for asChild composition.

## low: Addon clicks do not focus textarea controls

id: fnd_sig-feat-ui-flow-255de9cccb-266a_24fc69b0d4
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: React component input-group (feat_ui-flow_255de9cccb)

evidence:
- artifacts/cadstone/src/components/ui/input-group.tsx:65-70 (InputGroupAddon)
- artifacts/cadstone/src/components/ui/input-group.tsx:137-151 (InputGroupTextarea)

InputGroup exposes both input and textarea controls, but the addon click behavior only searches for an input element. In a group using InputGroupTextarea, clicking a non-button addon silently does nothing instead of focusing the control, creating inconsistent behavior between the two supported control types.

recommendation:
Focus the declared group control rather than a hard-coded input, for example query `[data-slot=input-group-control]` and call focus on it when it is a focusable HTMLElement, while preserving the button exclusion.

test analysis:
No tests are linked for this component, and the provided package test script only runs existing src/**/*.test.ts files; no component test is included for addon focus behavior.

suggested regression test:
Add a React/jsdom component test that renders InputGroupAddon with InputGroupTextarea, clicks the addon, and asserts the textarea receives focus.

minimum fix scope:
Update InputGroupAddon's click handler in artifacts/cadstone/src/components/ui/input-group.tsx and add a focused component test if the project has a UI test harness.

repro:
Render InputGroup with InputGroupAddon and InputGroupTextarea, then click the addon text/icon. The textarea is not focused because the click handler only queries for input.

## medium: Error report posts full URL including query strings and fragments

id: fnd_sig-feat-ui-flow-2a52004b4e-9f5c_2c1d6926e1
category: security
confidence: high
triage: confirmed-bug
status: open
feature: React component ErrorBoundary (feat_ui-flow_2a52004b4e)

evidence:
- artifacts/cadstone/src/components/ErrorBoundary.tsx:65-68 (ErrorBoundary.componentDidCatch)

The boundary serializes window.location.href into the client-error payload. In a SaaS app, URLs commonly carry reset tokens, invite codes, OAuth callback parameters, signed-file parameters, search text, or tenant/customer identifiers. Any render error on those pages will persist the full URL into the crash-reporting sink, widening exposure of secrets or sensitive user input beyond the page request itself.

recommendation:
Report only a sanitized URL, for example origin + pathname, or explicitly redact/allowlist query parameters before serializing. Avoid sending fragments entirely.

test analysis:
ErrorBoundary.test.ts only asserts fallback rendering and getDerivedStateFromError state. It does not mock fetch or inspect the telemetry payload.

suggested regression test:
Mock global fetch, set the JSDOM URL to one with sensitive query/hash components, render a throwing child, and assert the posted JSON omits query parameters and fragment values.

minimum fix scope:
Update ErrorBoundary.componentDidCatch to build a sanitized URL for the client-error payload and add a focused ErrorBoundary test around the serialized payload.

repro:
Visit a route such as /reset-password?token=secret-token#frag and trigger a render error under ErrorBoundary; the POST body sent to /api/_client-error includes the complete href with token and fragment.

## medium: Cached device forecast is trusted without shape validation

id: fnd_sig-feat-ui-flow-31d73a9a76-67f4_7215ceef43
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: React component MyDayPage (feat_ui-flow_31d73a9a76)

evidence:
- artifacts/cadstone/src/pages/home/MyDayPage.tsx:35-41 (readStoredDeviceForecast)
- artifacts/cadstone/src/pages/home/types.ts:17-28 (CrewForecast)
- artifacts/cadstone/src/pages/home/MyDayPage.tsx:65 (MyDayPage)
- artifacts/cadstone/src/pages/home/MyDayPage.tsx:241-248 (ForecastStrip)
- artifacts/cadstone/src/pages/home/MyDayPage.tsx:262 (ForecastStrip)

The sessionStorage payload is a serialization boundary and can contain stale app-version data, corrupted valid JSON, or user-edited values. The code only checks that fetchedAt is a number and data is truthy before treating data as CrewForecast. A payload with missing temperatureHigh/temperatureLow passes and renders NaN temperatures because undefined !== null. A payload with a non-renderable condition value can crash React when ForecastStrip renders it. The existing catch only handles invalid JSON, not valid JSON with the wrong shape.

recommendation:
Validate cached data with a narrow type guard or Zod schema before returning status ok. Treat missing required fields, non-finite numbers, non-string condition/icon/fetchedAt, and non-nullable fields with null/undefined as cache misses; remove the bad sessionStorage entry before fetching fresh data.

test analysis:
The feature metadata lists no linked tests, and the inspected package test script only discovers src/**/*.test.ts. No included test exercises malformed sessionStorage data for MyDayPage.

suggested regression test:
Add a MyDayPage component test that seeds sessionStorage with a fresh but malformed device forecast, renders with forecast:null and weather:null, and asserts the component does not render NaN or crash and instead starts the fallback loading/error path.

minimum fix scope:
Change readStoredDeviceForecast to validate parsed.data against the CrewForecast runtime shape and clear invalid cache entries.

repro:
In a browser session before loading My Day with no server forecast, write the device forecast storage key to a fresh fetchedAt and malformed data, for example data containing condition:"Sunny" and precipitation:0 but no temperatureHigh/temperatureLow. The page accepts the cache and renders NaN temperature text; with condition as an object, ForecastStrip can throw a React child rendering error.

## low: Device forecast TTL is not enforced after mount

id: fnd_sig-feat-ui-flow-31d73a9a76-d5e8_a7b3e6b1e1
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: React component MyDayPage (feat_ui-flow_31d73a9a76)

evidence:
- artifacts/cadstone/src/pages/home/MyDayPage.tsx:21 (FORECAST_TTL_MS)
- artifacts/cadstone/src/pages/home/MyDayPage.tsx:36-41 (readStoredDeviceForecast)
- artifacts/cadstone/src/pages/home/MyDayPage.tsx:65 (MyDayPage)
- artifacts/cadstone/src/pages/home/MyDayPage.tsx:298-299 (useDeviceForecastFallback)
- artifacts/cadstone/src/pages/home/MyDayPage.tsx:339-342 (useDeviceForecastFallback)

The TTL is checked when reading sessionStorage and during the initial effect, but activeForecast later trusts any ok deviceForecast state without rechecking its age. Because the effect only depends on serverForecast, time passing does not trigger a refetch when the cached forecast crosses the one-hour TTL. A user who leaves the SPA route mounted can keep seeing an expired forecast indefinitely, including across the 'Today' label becoming inaccurate after midnight.

recommendation:
Either include a timer that invalidates/refetches when fetchedAt reaches FORECAST_TTL_MS, or compute activeForecast with the same TTL check and transition expired ok state back to idle/loading. Include the current dashboard date if forecasts should not survive a day boundary.

test analysis:
No linked tests were provided for this component, and there is no included test that advances timers or verifies cache expiry behavior.

suggested regression test:
Add a component/hook test using fake timers: initialize a valid cached forecast just inside the TTL, render MyDayPage, advance time beyond the TTL, and assert the stale forecast is no longer rendered and a fresh geolocation/weather fetch is attempted or a loading state appears.

minimum fix scope:
Update useDeviceForecastFallback/MyDayPage cache handling so ok cached state is invalidated when its TTL expires while the component remains mounted.

repro:
Seed sessionStorage with an otherwise valid device forecast whose fetchedAt is just under one hour old, render MyDayPage with forecast:null and weather:null, then leave the component mounted past the TTL. The effect will not rerun because serverForecast did not change, and activeForecast continues rendering the stale ok state.

## low: reInit event handler is not removed during effect cleanup

id: fnd_sig-feat-ui-flow-34e5fde7fe-c5fd_96cc395d79
category: performance
confidence: medium
triage: risk
status: open
feature: React component carousel (feat_ui-flow_34e5fde7fe)

evidence:
- artifacts/cadstone/src/components/ui/carousel.tsx:112-118 (Carousel)

The component registers the same callback for both Embla's reInit and select events, but cleanup unregisters only select. If the Embla API instance is retained or reused across effect teardown, the stale reInit listener can continue calling the old state setters after the component/effect lifecycle has ended, and repeated mounts can accumulate obsolete listeners.

recommendation:
Unregister the reInit listener in the cleanup alongside select, using the same api instance captured by the effect.

test analysis:
No linked tests exercise carousel mount/unmount or Embla event subscription cleanup behavior.

suggested regression test:
Mount the carousel with a controllable Embla API mock, unmount it, and assert that off is called for both select and reInit handlers.

minimum fix scope:
Update the Carousel effect cleanup in artifacts/cadstone/src/components/ui/carousel.tsx to call api.off("reInit", onSelect).

## medium: Failed sends leave optimistic messages in the transcript

id: fnd_sig-feat-ui-flow-354f3a5fa5-550f_0932c57288
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: React component ChatPanel (feat_ui-flow_354f3a5fa5)

evidence:
- artifacts/cadstone/src/components/agent/ChatPanel.tsx:235-249 (ChatPanel)
- artifacts/cadstone/src/components/agent/ChatPanel.tsx:345-349 (ChatPanel)
- artifacts/cadstone/src/components/agent/ChatMessage.tsx:207 (ChatMessage)

handleSend appends an optimistic user message and an empty assistant placeholder before the network request is known to have succeeded. The stream-level onError path only shows a toast and clears busy/status, so HTTP failures, authorization failures, stale usage-limit failures, or network errors leave a user bubble that was not accepted and an assistant bubble rendered as an ellipsis. That can make failed sends look like saved conversation history until a full reload replaces the local state.

recommendation:
In the stream onError handler, reconcile the optimistic entries: remove the optimistic user and placeholder when no persisted user_message was received, or replace the placeholder with an explicit failed-send message and mark it non-persisted. Keep the existing event error path separate because that path may already have persisted the user turn.

test analysis:
The feature declares no tests, and the included files show no component test covering failed stream startup or non-2xx send responses.

suggested regression test:
Mock streamSendMessage so it calls onError without a prior user_message event; assert that ChatPanel does not leave the optimistic user bubble plus empty assistant ellipsis in the rendered message list.

minimum fix scope:
Update ChatPanel's stream onError reconciliation for the optimistic user and assistant placeholder, with a focused component test for failed send startup.

## low: Conversation-list failures are treated as empty history and can create extra conversations

id: fnd_sig-feat-ui-flow-354f3a5fa5-6c17_d72dd1c2eb
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: React component ChatPanel (feat_ui-flow_354f3a5fa5)

evidence:
- artifacts/cadstone/src/components/agent/ChatPanel.tsx:82-89 (refreshConversations)
- artifacts/cadstone/src/components/agent/ChatPanel.tsx:111-120 (ChatPanel)

refreshConversations collapses every listConversations failure into an empty array. The open-without-active-conversation effect interprets that empty array as 'no conversations exist' and calls createConversation. A transient list failure can therefore create a new conversation and hide the original load error instead of failing visibly or retrying, which pollutes server-side conversation history and may select the wrong chat.

recommendation:
Let refreshConversations distinguish failure from an actual empty list, for example by throwing, returning null, or surfacing a typed result. Only auto-create a conversation after a successful list response confirms there are no conversations.

test analysis:
The feature declares no tests, and there is no included test asserting the open-panel behavior when listConversations rejects.

suggested regression test:
Mock listConversations to reject while createConversation is observable; open ChatPanel with no active conversation and assert createConversation is not called and an error state/toast is surfaced.

minimum fix scope:
Change refreshConversations and the no-active-conversation effect to avoid auto-creation on list failures, plus a focused regression test.

## medium: String tool inputs are rendered without size limits

id: fnd_sig-feat-ui-flow-3ba2ed2e3f-2351_f5522794c7
category: performance
confidence: high
triage: risk
status: open
feature: React component ChatMessage (feat_ui-flow_3ba2ed2e3f)

evidence:
- artifacts/cadstone/src/components/agent/ChatMessage.tsx:24-31 (formatInput)
- artifacts/cadstone/src/components/agent/ChatMessage.tsx:94-95 (ToolCallRow)
- artifacts/cadstone/src/lib/agent-api.ts:21-24 (AgentToolCall)

Non-string tool inputs are capped at 600 characters after JSON serialization, but string inputs bypass that cap entirely. Since tool call input is typed as unknown and comes from streamed agent/network data, a large string argument can be inserted wholesale into the DOM when the row is expanded, causing browser jank or memory pressure in the chat UI.

recommendation:
Apply the same preview limit to string inputs, ideally through a shared truncate helper used for both raw strings and serialized JSON. Consider indicating truncation explicitly in the UI.

test analysis:
The feature lists no tests, and there is no linked component test exercising large string tool inputs or expanded tool-call rendering.

suggested regression test:
Add a ChatMessage component test that renders a tool call with a long string input, expands it, and asserts the displayed text is capped and includes a truncation marker.

minimum fix scope:
Update formatInput in artifacts/cadstone/src/components/agent/ChatMessage.tsx and add focused component coverage for long string inputs.

repro:
Render ChatMessage with an assistant tool call whose input is a multi-megabyte string, expand the tool row, and observe the component render the full payload instead of the same bounded preview used for JSON inputs.

## low: Button defaults to form submission when no type is provided

id: fnd_sig-feat-ui-flow-4085351c66-3d8c_371dfe83bb
category: bug
confidence: medium
triage: risk
status: open
feature: React component button (feat_ui-flow_4085351c66)

evidence:
- artifacts/cadstone/src/components/ui/button.tsx:50-56 (Button)

When asChild is false, this renders a native <button> and forwards props without setting a default type. In HTML, a button inside a form defaults to type="submit", so ordinary UI actions such as opening a picker, toggling a panel, or canceling inside a form can accidentally submit the form unless every call site remembers to pass type="button". This is a concrete component-level footgun because the shared Button abstracts the native element but does not preserve the safer default for non-submit actions.

recommendation:
Set type="button" by default when rendering the native button, while still allowing callers to override with type="submit" or type="reset". Avoid injecting type when asChild is true because Slot may target non-button elements.

test analysis:
The feature lists no linked tests, and the package test script only discovers src/**/*.test.ts files; no provided test asserts Button behavior inside forms.

suggested regression test:
Add a React/jsdom test that renders Button inside a form, clicks it without a type prop, and asserts the submit handler is not called; also assert type="submit" still submits.

minimum fix scope:
Update artifacts/cadstone/src/components/ui/button.tsx to default native Button type to "button" only when asChild is false, and add a focused component test.

repro:
Render <form onSubmit={...}><Button onClick={...}>Open</Button></form> and click the button; the form submit handler fires even though the caller did not request submit behavior.

## low: React component tests with JSX would be skipped by the package test command

id: fnd_sig-feat-ui-flow-46581a1669-3a21_15ca9a41f6
category: test-gap
confidence: medium
triage: test-gap
status: open
feature: React component Sidebar (feat_ui-flow_46581a1669)

evidence:
- artifacts/cadstone/package.json:12
- artifacts/cadstone/src/components/layout/Sidebar.tsx:124 (Sidebar)

The package test script only matches .test.ts files. Sidebar is a React .tsx component, and normal render tests for it would usually be authored as .test.tsx. Those tests would not run under pnpm test, which makes future coverage for this component easy to add but silently ineffective.

recommendation:
Expand the test glob to include TSX tests, for example src/**/*.test.{ts,tsx}, and add Sidebar render tests under a filename that the script executes.

test analysis:
The feature lists no linked tests, and the current package-level command excludes the conventional .test.tsx pattern needed for JSX render tests.

suggested regression test:
Add a minimal Sidebar.test.tsx smoke test and verify pnpm --filter @workspace/cadstone test executes it.

minimum fix scope:
Update artifacts/cadstone/package.json test script and add at least one executable Sidebar component test.

repro:
Add src/components/layout/Sidebar.test.tsx and run pnpm --filter @workspace/cadstone test; the current glob only includes src/**/*.test.ts, so the .tsx test file is not selected.

## medium: Sidebar only ever loads the first 200 jobs

id: fnd_sig-feat-ui-flow-46581a1669-452b_dd1ecf43b1
category: bug
confidence: medium
triage: risk
status: open
feature: React component Sidebar (feat_ui-flow_46581a1669)

evidence:
- artifacts/cadstone/src/components/layout/Sidebar.tsx:150-152 (loadJobs)
- artifacts/cadstone/src/components/layout/Sidebar.tsx:222-228 (Sidebar)
- artifacts/cadstone/src/components/layout/Sidebar.tsx:288 (Sidebar)

The component requests a fixed pageSize=200 and treats that one response as the complete job universe for filtering, search, grouping, and the displayed count. If the API honors pagination and the tenant/user has more than 200 jobs, jobs beyond the first page are invisible in the sidebar and cannot be found by the sidebar search, with no indication that results are truncated.

recommendation:
Either fetch all pages needed for the sidebar, switch the endpoint to a purpose-built complete navigation summary, or make the sidebar explicitly server-paginated/search-backed so counts and search results are not computed from a truncated client-side list.

test analysis:
The feature lists no linked tests, and the component has no evidence of a pagination boundary test around /jobs?pageSize=200.

suggested regression test:
Mock /jobs as a paginated endpoint with more than 200 jobs and assert the sidebar either fetches subsequent pages or exposes a server-backed way to find jobs not present in the first response.

minimum fix scope:
Update Sidebar's job-loading strategy and add a component/API mock test for the >200 jobs case.

repro:
Create or mock 201 visible jobs from /jobs with the 201st job only available on the next page. Mount Sidebar and search for that job title; it will not render because Sidebar never requests any page beyond /jobs?pageSize=200.

## low: Overlapping job loads can show stale data or a false error

id: fnd_sig-feat-ui-flow-46581a1669-973d_8da7de7657
category: concurrency
confidence: high
triage: confirmed-bug
status: open
feature: React component Sidebar (feat_ui-flow_46581a1669)

evidence:
- artifacts/cadstone/src/components/layout/Sidebar.tsx:147-168 (loadJobs)
- artifacts/cadstone/src/components/layout/Sidebar.tsx:175 (Sidebar)
- artifacts/cadstone/src/components/layout/Sidebar.tsx:522-527 (Sidebar)

Multiple code paths can call loadJobs while a prior request is still pending: mount, navigation refresh events, and Retry. The responses are applied unconditionally. A slower older success can overwrite newer job data, and a slower older failure can set errorMessage after a newer retry has succeeded, leaving the sidebar with valid jobs plus an erroneous error banner.

recommendation:
Track a monotonically increasing request id or use AbortController/cancellation so only the latest loadJobs invocation may update jobs or errorMessage. Clear error only when the latest request starts and ignore settlements from superseded requests.

test analysis:
There are no linked tests exercising delayed, out-of-order /jobs responses or Retry behavior.

suggested regression test:
Use deferred promises for two /jobs calls, resolve the newer call first, then reject the older call, and assert the rendered sidebar keeps the successful jobs without showing the stale error.

minimum fix scope:
Add latest-request guarding inside Sidebar's loadJobs path and cover overlapping request settlement order.

repro:
Mock the first /jobs request to reject after a delay and a second /jobs request to resolve immediately. Trigger Retry before the first request settles. After the second request populates jobs, let the first rejection settle; Sidebar will set the error banner from the stale request.

## medium: Lowering progress below 100 keeps the item marked complete

id: fnd_sig-feat-ui-flow-48bec060e7-b4d1_5a7726328b
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: React component ScheduleItemDialog (feat_ui-flow_48bec060e7)

evidence:
- artifacts/cadstone/src/components/schedule/ScheduleItemDialog.tsx:531-553 (buildPayload)
- artifacts/cadstone/src/components/schedule/ScheduleItemDialog.tsx:2075-2085 (Progress Slider)

The completion control treats 100 percent as complete and unchecking completion lowers 100 to 99, but the progress slider only sets isComplete to true at 100 and never clears it below 100. If a user opens a completed item, drags progress to 50, and saves, buildPayload sends progress: 50 with isComplete: true, leaving the schedule item completed even though the user lowered progress.

recommendation:
When slider progress drops below 100, set isComplete to false, or make the UI explicitly separate completion from progress and remove the implicit 100-percent completion coupling.

test analysis:
The feature metadata lists no linked tests, and there is no component test exercising progress/completion interactions.

suggested regression test:
Add a component test that starts from a completed item, changes the slider below 100, saves, and asserts the outgoing payload has isComplete: false and the selected progress value.

minimum fix scope:
The Progress slider onValueChange state update in ScheduleItemDialog.

repro:
Open an item with isComplete true and progress 100, drag the Progress slider to 50, then save. The payload built by buildPayload still contains isComplete: true.

## high: Draft mode falls back to live API mutations when draft handlers are omitted

id: fnd_sig-feat-ui-flow-48bec060e7-d1a3_d76ebf9a6a
category: data-loss
confidence: high
triage: confirmed-bug
status: open
feature: React component ScheduleItemDialog (feat_ui-flow_48bec060e7)

evidence:
- artifacts/cadstone/src/components/schedule/ScheduleItemDialog.tsx:150-157 (ScheduleItemDialogProps)
- artifacts/cadstone/src/components/schedule/ScheduleItemDialog.tsx:568-578 (handleSave)
- artifacts/cadstone/src/components/schedule/ScheduleItemDialog.tsx:633-644 (handleAddNote)
- artifacts/cadstone/src/components/schedule/ScheduleItemDialog.tsx:915-918 (handleDelete)
- artifacts/cadstone/src/components/schedule/ScheduleItemDialog.tsx:875-894 (handleCopy)

The prop type permits draftMode without the draft callbacks, but the draft branches use optional-handler checks and otherwise execute the normal network writes. An integration mistake can therefore save, copy, add notes to, or delete real schedule items while the UI is in draft mode, despite other draft-mode guards telling users to publish before live attachment/to-do changes.

recommendation:
Make the props a discriminated union where draftMode: true requires onDraftSave, onDraftAddNote, and onDraftDelete as appropriate, or explicitly fail in each draft-mode action when the required callback is missing. Do not fall through from draftMode to live API calls.

test analysis:
The feature metadata lists no linked tests, and no ScheduleItemDialog tests were present under the cadstone src test glob during inspection.

suggested regression test:
Add a component test that renders with draftMode true and omitted draft handlers, triggers save/copy/delete/add-note paths, and asserts no api.post/put/delete calls occur and a visible error/toast is produced.

minimum fix scope:
ScheduleItemDialog props and every draftMode branch that currently falls through to live api calls.

repro:
Render ScheduleItemDialog with draftMode={true}, an existing item, and no onDraftDelete. Open the delete confirmation and confirm; the component calls DELETE /schedule-items/{id} instead of failing locally or using a draft deletion handler.

## low: Parsed change-order fileId is captured but dropped on save

id: fnd_sig-feat-ui-flow-49ac4171ba-48c3_8dc12593c2
category: data-loss
confidence: medium
triage: risk
status: open
feature: React component job-financials (feat_ui-flow_49ac4171ba)

evidence:
- artifacts/cadstone/src/pages/job-financials.tsx:809-815 (coDraft)
- artifacts/cadstone/src/pages/job-financials.tsx:838-853 (performCoParse)
- artifacts/cadstone/src/pages/job-financials.tsx:881-886 (saveParsedChangeOrder)

The Upload CO parse flow stores the returned fileId in coDraft, but the confirm-save POST omits it. The user-uploaded source document is therefore not associated with the saved change order from this UI flow, making the source file hard to recover from the change-order record and leaving an unused field in component state.

recommendation:
Carry the parsed fileId through the save path if change orders should retain their source document, including any needed API/schema support. If the file is intentionally only stored in the Financials folder, remove fileId from coDraft and the parse response handling to avoid implying a link that does not exist.

test analysis:
The CO upload e2e test mocks a parse response with fileId but only asserts number, description, amountCents, and areaId on the creation POST; it does not verify source document linkage or cleanup.

suggested regression test:
Extend the Upload CO e2e test to assert the parsed fileId is either included in the confirmed save request or explicitly discarded with a tested cleanup/no-link behavior.

minimum fix scope:
Decide the contract for parsed CO source files, then update the frontend save payload and corresponding API/schema support or remove the unused fileId handling.

repro:
Upload a CO document, let parse return a fileId, then click Save change order. Inspect the POST body: it contains number, description, amountCents, and areaId, but no fileId.

## medium: Uncontrolled SOV edit inputs can show stale values after tracker reloads

id: fnd_sig-feat-ui-flow-49ac4171ba-c1ab_0c92fe115f
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: React component job-financials (feat_ui-flow_49ac4171ba)

evidence:
- artifacts/cadstone/src/pages/job-financials.tsx:212-213 (SovLineItemRow)
- artifacts/cadstone/src/pages/job-financials.tsx:253-258 (SovLineItemRow)
- artifacts/cadstone/src/pages/job-financials.tsx:268-276 (SovLineItemRow)
- artifacts/cadstone/src/pages/job-financials.tsx:699-704 (load)

React only applies defaultValue when an input mounts. This page reloads tracker data into state, but rows keep the same line-item key, so description, qty, rate, and percent inputs can retain old DOM values when the server returns changed values for the same line item. The scheduled value input has a value-based key, but the other editable financial fields do not, so manual Refresh, server-side normalization, or another user's update can leave editable cells displaying stale financial data.

recommendation:
Either make these inputs controlled with local draft state that syncs when li changes, or give each uncontrolled input a stable key that includes the persisted value, matching the scheduled-value input's remount strategy.

test analysis:
Existing financials e2e coverage fills inputs and waits for PATCH, but does not assert that a subsequent GET changing the same line-item id updates the visible input values.

suggested regression test:
Add a component or Playwright test that serves two GET /financials responses for the same line item id with different qty/rate/percent values, triggers Refresh or a save reload, and asserts the input values change to the second response.

minimum fix scope:
Update SovLineItemRow editable inputs in artifacts/cadstone/src/pages/job-financials.tsx and add a focused stale-refresh regression test.

repro:
Render a line item, then have GET /financials return the same line item id with a changed qty, rate, description, or percentComplete after Refresh or a mutation reload. The underlying props update, but the already-mounted input continues to display its old defaultValue.

## medium: Manual Add CO silently creates zero-dollar change orders for canceled or invalid amounts

id: fnd_sig-feat-ui-flow-49ac4171ba-fd63_461441cf58
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: React component job-financials (feat_ui-flow_49ac4171ba)

evidence:
- artifacts/cadstone/src/pages/job-financials.tsx:1027-1031 (addChangeOrder)
- artifacts/cadstone/src/pages/job-financials.tsx:1047-1053 (addChangeOrder)

If the user cancels the amount prompt, amountStr is undefined and the code posts amountCents 0. If the user enters a non-numeric value such as "abc", Number(...) is NaN and the `|| 0` fallback also posts amountCents 0. That creates a pending financial record the user did not validly confirm, and it can later affect change-order totals if approved.

recommendation:
Abort when the amount prompt returns undefined, validate the trimmed value with Number.isFinite before posting, and surface an error for invalid input instead of coercing it to zero. Keep negative amount handling consistent with the intended product rules.

test analysis:
The feature metadata lists no tests. The discovered CO e2e coverage exercises the AI parsed Upload CO dialog, not the manual prompt-based Add CO path or invalid/canceled amount input.

suggested regression test:
Add a Playwright test that stubs window.prompt for Add CO with a valid number followed by cancel/invalid amount, then asserts no change-order POST is made and an error or no-op occurs.

minimum fix scope:
Update addChangeOrder amount handling in artifacts/cadstone/src/pages/job-financials.tsx and add focused e2e coverage for the manual Add CO flow.

repro:
Open Job Financials as an admin, click Add CO, enter a CO number, optionally enter a description, then cancel the Amount prompt or type a non-numeric amount. The page still sends POST /financials/change-orders with amountCents: 0.

## low: Week number custom component renders a data cell instead of a row header

id: fnd_sig-feat-ui-flow-4f9a229e55-0a88_c6c28f254a
category: api-contract
confidence: medium
triage: contract-mismatch
status: open
feature: React component calendar (feat_ui-flow_4f9a229e55)

evidence:
- artifacts/cadstone/src/components/ui/calendar.tsx:157-160 (Calendar)

When `showWeekNumber` is enabled, react-day-picker treats week numbers as row headers and supplies header-style props to the `WeekNumber` component. This override renders a `td`, so those semantics are either lost or forwarded to the wrong native table element, weakening accessibility for calendars that display week numbers.

recommendation:
Render the custom `WeekNumber` as a `th` and keep the inner div for sizing/alignment.

test analysis:
The feature lists no linked tests, and there is no calendar accessibility/render test covering the optional week-number path.

suggested regression test:
Render `Calendar` with `showWeekNumber` enabled and assert each week number cell is a `TH` row header while preserving the expected sizing class on the inner wrapper.

minimum fix scope:
Change the `WeekNumber` override root element in `artifacts/cadstone/src/components/ui/calendar.tsx` from `td` to `th`.

## low: Month grid styles are attached to a deprecated classNames key

id: fnd_sig-feat-ui-flow-4f9a229e55-f42e_e519aed497
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: React component calendar (feat_ui-flow_4f9a229e55)

evidence:
- artifacts/cadstone/src/components/ui/calendar.tsx:85 (Calendar)
- artifacts/cadstone/package.json:81

The component depends on react-day-picker v9, where the rendered month grid classNames key is `month_grid`; `table` is the deprecated v8-era key and is not used for the month grid. As written, the intended `w-full border-collapse` styling is dead, so the calendar grid can render without the component's intended width and table-collapse styling.

recommendation:
Rename the `table` classNames entry to `month_grid` and preserve the existing class string, optionally merging `defaultClassNames.month_grid` like the other v9 keys.

test analysis:
The feature lists no linked tests, and the package test script only discovers `src/**/*.test.ts` files, so no component render assertion guards the DayPicker classNames contract.

suggested regression test:
Add a jsdom render test for `Calendar` that queries the element with `role="grid"` and asserts it includes `w-full` and `border-collapse`.

minimum fix scope:
Update `artifacts/cadstone/src/components/ui/calendar.tsx` classNames key from `table` to `month_grid`.

## low: Accept-invite UI flow has no linked regression coverage

id: fnd_sig-feat-ui-flow-5081cdc63b-5f65_05d33296ff
category: test-gap
confidence: high
triage: test-gap
status: open
feature: React component accept-invite (feat_ui-flow_5081cdc63b)

evidence:
- artifacts/cadstone/src/pages/accept-invite.tsx:53-105 (AcceptInvitePage)
- artifacts/cadstone/package.json:12-13 (scripts.test)

This is an auth-adjacent flow that validates user input, handles missing tokens, posts credentials over the network, stores auth state, and navigates on success, but the feature metadata lists no tests and the included package manifest only shows the generic test entrypoint. Without targeted coverage, regressions in token handling, validation failures, success login wiring, and duplicate-submit behavior are unlikely to be caught at the component level.

recommendation:
Add focused tests for missing token rendering, password length/mismatch validation, successful accept-invite auth/navigate behavior, API error handling, and duplicate-submit suppression.

test analysis:
No tests are linked to this feature, and no included test file exercises AcceptInvitePage behavior.

suggested regression test:
Create a component test for AcceptInvitePage under the package test command that mocks router search params, useAuthStore, authPostAuthAcceptInvite, and toast behavior for the main success and validation branches.

minimum fix scope:
Add tests under artifacts/cadstone/src for AcceptInvitePage and ensure the package test script runs them.

## low: Duplicate submits can send multiple single-use invite acceptance requests

id: fnd_sig-feat-ui-flow-5081cdc63b-cd1a_b28b799252
category: concurrency
confidence: medium
triage: risk
status: open
feature: React component accept-invite (feat_ui-flow_5081cdc63b)

evidence:
- artifacts/cadstone/src/pages/accept-invite.tsx:77-105 (AcceptInvitePage.handleSubmit)
- artifacts/cadstone/src/pages/accept-invite.tsx:152-159 (AcceptInvitePage)

The submit handler sets the loading state but does not synchronously bail out when a submission is already in progress. A rapid double-click or repeated Enter submit can invoke the handler twice before the disabled button state is committed, resulting in two POSTs for a single-use invite token. That can produce conflicting success/error toasts or leave the user seeing an error after the first request already accepted the invite and navigated.

recommendation:
Add an in-handler duplicate-submit guard, preferably backed by a ref for synchronous protection, and keep the existing disabled UI state for feedback.

test analysis:
The feature declares no linked tests, and the component has no evidence of a submit-race regression test in the included files.

suggested regression test:
Add a React component test that renders AcceptInvitePage, mocks authPostAuthAcceptInvite, fires two rapid submit events with valid matching passwords, and asserts the API client is called exactly once.

minimum fix scope:
artifacts/cadstone/src/pages/accept-invite.tsx

repro:
Open /accept-invite?token=<valid-token>, enter matching valid passwords, then double-click Activate account or fire two submit events before React re-renders the disabled button. The component has no in-handler `if (submitting) return` guard, so both requests can be started.

## medium: Non-field mobile nav can render five items in a four-column grid

id: fnd_sig-feat-ui-flow-5280bd9137-4b47_1995a5f392
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: React component MobileBottomNav (feat_ui-flow_5280bd9137)

evidence:
- artifacts/cadstone/src/components/layout/MobileBottomNav.tsx:53-68 (MobileBottomNav)
- artifacts/cadstone/src/components/layout/MobileBottomNav.tsx:111-133 (MobileBottomNav)
- artifacts/cadstone/src/components/layout/MobileBottomNav.tsx:136-153 (MobileBottomNav)

For non-field users with both client and company-view access, primaryTabs contains Home, Clients, Schedule, and Logs. The component then always adds the More button, producing five list items inside a grid hard-coded to four columns. On mobile this wraps the fifth item into a second row or otherwise distorts the bottom navigation, making the fixed bottom nav taller than expected and potentially covering page content.

recommendation:
Constrain primaryTabs to at most three items when the More button is present, move one non-field destination into the More sheet, or make the grid column count reflect the actual rendered item count and ensure page bottom spacing accounts for the resulting height.

test analysis:
No tests are linked for this component, and the package test script only targets src/**/*.test.ts files; there is no included regression coverage for mobile layout across role combinations.

suggested regression test:
Add a component test that renders MobileBottomNav with a non-field role having clients and companyViews access and asserts the bottom nav exposes exactly four primary controls, or asserts the grid class/column count matches the rendered item count.

minimum fix scope:
Update MobileBottomNav primary tab selection or grid sizing, plus a focused component test for role-dependent mobile nav item counts.

repro:
Render MobileBottomNav for an authenticated non-field role where hasRoleAccess(role, ROLE_GATES.clients) and hasRoleAccess(role, ROLE_GATES.companyViews) both return true; the bottom nav renders five items in a grid-cols-4 container.

## low: Breadcrumb ellipsis accessibility label is hidden from assistive tech

id: fnd_sig-feat-ui-flow-55763438a0-f685_cf385a739a
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: React component breadcrumb (feat_ui-flow_55763438a0)

evidence:
- artifacts/cadstone/src/components/ui/breadcrumb.tsx:95-102 (BreadcrumbEllipsis)

BreadcrumbEllipsis includes sr-only text labeled 'More', which indicates the component intends to expose a nonvisual label. However, aria-hidden="true" is set on the parent span, so the icon and the sr-only text are both removed from the accessibility tree. Screen reader users will not be told that breadcrumb items are collapsed or omitted.

recommendation:
Remove aria-hidden from the wrapper and mark only the MoreHorizontal icon as aria-hidden, or provide an accessible label on the wrapper while keeping decorative children hidden.

test analysis:
No linked accessibility or rendering tests were provided for BreadcrumbEllipsis.

suggested regression test:
Render BreadcrumbEllipsis and assert that an accessible 'More' label is exposed while the SVG icon remains decorative.

minimum fix scope:
Adjust BreadcrumbEllipsis accessibility attributes in artifacts/cadstone/src/components/ui/breadcrumb.tsx and add a focused accessibility/rendering assertion.

## low: Breadcrumb separator prop is accepted but never applied

id: fnd_sig-feat-ui-flow-55763438a0-fb5d_b82fc936e2
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: React component breadcrumb (feat_ui-flow_55763438a0)

evidence:
- artifacts/cadstone/src/components/ui/breadcrumb.tsx:7-12 (Breadcrumb)

The exported Breadcrumb type advertises a separator prop, but the component never destructures or uses it; it spreads all props onto the underlying nav. Consumers can pass a custom separator and TypeScript will accept it, but the rendered breadcrumbs will not change, and the custom value may be forwarded as an invalid DOM attribute on nav.

recommendation:
Either remove separator from the Breadcrumb public props, or implement it deliberately through the breadcrumb components without forwarding it to the nav element.

test analysis:
No linked tests were provided for the breadcrumb component or its custom separator behavior.

suggested regression test:
Render Breadcrumb with a custom separator and multiple items, then assert the custom separator appears between items and is not present as an attribute on the nav element.

minimum fix scope:
Update artifacts/cadstone/src/components/ui/breadcrumb.tsx to consume or remove the separator prop, plus a focused component test if the prop remains public.

## low: Recent lead rows drop the selected lead id

id: fnd_sig-feat-ui-flow-5f2c947cdd-8222_bbbe7d8e26
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: React component AdminHomePage (feat_ui-flow_5f2c947cdd)

evidence:
- artifacts/cadstone/src/pages/home/AdminHomePage.tsx:159-163 (AdminHomePage)
- artifacts/cadstone/src/pages/home/MobileDrillTile.tsx:287-290 (OpenLeadsDrill)

The admin recent-leads list renders each row as a Link, but every row navigates to the generic leads page. The mobile open-leads drill-down in the same home flow preserves the selected lead with ?lead=<id>, so clicking a recent lead from AdminHomePage loses the item context and forces the user to locate it again.

recommendation:
Build the recent lead Link target with the lead id, matching OpenLeadsDrill, for example /sales/leads?lead=<encoded id>.

test analysis:
No linked tests assert row-level navigation targets for the AdminHomePage recent-leads list.

suggested regression test:
Add a component test that renders a recent lead and asserts its anchor href includes /sales/leads?lead=<id>.

minimum fix scope:
Change the recentLeads map Link target in artifacts/cadstone/src/pages/home/AdminHomePage.tsx.

repro:
Render AdminHomePage with two recentLeads, click either row, and observe navigation goes to /sales/leads with no lead query parameter.

## medium: Financial amounts are rounded to whole dollars

id: fnd_sig-feat-ui-flow-5f2c947cdd-979b_c93ea3f89c
category: bug
confidence: medium
triage: risk
status: open
feature: React component AdminHomePage (feat_ui-flow_5f2c947cdd)

evidence:
- artifacts/cadstone/src/pages/home/AdminHomePage.tsx:126-142 (AdminHomePage)
- artifacts/cadstone/src/pages/home/types.ts:151-156 (formatCents)

AdminHomePage displays cent-denominated balances, including exact past-due invoice remaining amounts, through formatCents. That helper divides by 100 but formats with maximumFractionDigits: 0, so $123.45 renders as $123 and $123.50 renders as $124. This can visibly misstate A/R, client balances, contract value, and invoice balances.

recommendation:
Format cent-denominated financial values with two fraction digits, or use the app's shared precise cents formatter. If dashboard KPI totals are intentionally rounded, use a separate explicitly rounded formatter and keep invoice/client balance rows precise.

test analysis:
No linked tests exercise AdminHomePage currency rendering or edge cases with non-dollar cent values.

suggested regression test:
Add a component test that renders AdminHomePage with cent values such as 12345 and asserts the displayed invoice/client balance is $123.45, or separately asserts intentional rounded KPI formatting if that distinction is desired.

minimum fix scope:
Update formatCents in artifacts/cadstone/src/pages/home/types.ts or split precise and rounded formatters, then adjust AdminHomePage call sites accordingly.

repro:
Render AdminHomePage with a pastDueInvoices row where totalCents is 12345 and paidCents is 0; the row displays $123 instead of $123.45.

## medium: Assistant access state stays true while checking the next route

id: fnd_sig-feat-ui-flow-630d05eb06-009e_7113ec05ab
category: security
confidence: high
triage: confirmed-bug
status: open
feature: React component TopNav (feat_ui-flow_630d05eb06)

evidence:
- artifacts/cadstone/src/components/layout/TopNav.tsx:90-104 (TopNav)
- artifacts/cadstone/src/components/layout/TopNav.tsx:187-193 (TopNav)

When the route or job id changes, the effect starts a new /agent/access request but leaves the previous canUseAssistant value in place until that request resolves. A user who had assistant access on one route can navigate to a job or context where access should be denied and still see and click the assistant button during the pending check, or longer if the request hangs. This is a stale permission signal in a control that opens privileged assistant UI.

recommendation:
Reset canUseAssistant to false before starting each access check, and only show the button after a positive response for the current route/job id. Prefer aborting the request or tracking a request key so late responses cannot affect the wrong context.

test analysis:
The feature metadata lists no tests, and the included files do not contain a route-change scenario for assistant access state.

suggested regression test:
Render TopNav with a mocked router and api client. Return canUseAssistant=true for the first job, navigate to a second job with the access request unresolved or false, and assert the assistant button is hidden immediately and only appears after a true response for the current job.

minimum fix scope:
artifacts/cadstone/src/components/layout/TopNav.tsx assistant-access useEffect and a focused component test for route changes

repro:
Mock /agent/access to return true on /jobs/allowed, then delay or deny the request for /jobs/denied. Navigate from /jobs/allowed to /jobs/denied and observe that the Open assistant button remains rendered until the second request settles.

## low: Toast close control has no accessible name

id: fnd_sig-feat-ui-flow-6b16c627f9-4a37_92eb73d933
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: React component toast (feat_ui-flow_6b16c627f9)

evidence:
- artifacts/cadstone/src/components/ui/toast.tsx:62-76 (ToastClose)

The close button renders only an icon and does not provide a default accessible name such as aria-label="Close" or screen-reader text. Consumers can pass one through props, but the shared UI primitive produces an unlabeled dismiss button by default, so toast close controls are announced only as a generic button in assistive technology.

recommendation:
Give ToastClose a default accessible label while still allowing consumers to override it, for example destructure aria-label with a default of "Close" and pass it to ToastPrimitives.Close.

test analysis:
No tests were linked for this component, and the package test script only targets src/**/*.test.ts, so there is no visible accessibility regression coverage for the toast primitive.

suggested regression test:
Add a jsdom React test that renders ToastClose inside the Radix toast context and asserts the close control is discoverable by role and accessible name, e.g. screen.getByRole('button', { name: /close/i }).

minimum fix scope:
Update ToastClose in artifacts/cadstone/src/components/ui/toast.tsx and add a focused component accessibility test if the existing test setup supports React DOM rendering.

repro:
Render a toast with <ToastClose /> and inspect the accessibility tree or query it with Testing Library: getByRole('button', { name: /close/i }) will fail because no accessible name is present.

## medium: Client search only covers the first 100 clients

id: fnd_sig-feat-ui-flow-74a015d611-b79e_f547ccbfdc
category: bug
confidence: medium
triage: risk
status: open
feature: React component ClientPickerDialog (feat_ui-flow_74a015d611)

evidence:
- artifacts/cadstone/src/components/dashboard/ClientPickerDialog.tsx:46-56 (ClientPickerDialog)
- artifacts/cadstone/src/components/dashboard/ClientPickerDialog.tsx:74-83 (ClientPickerDialog)

The request uses a paginated-looking `pageSize=100` query and stores only that single response page. The search box then filters only the locally loaded `clients` array. In tenants/accounts with more than 100 non-archived clients, any client outside the first response page is invisible and cannot be found by searching, which breaks the picker for larger customer lists.

recommendation:
Either fetch all pages for this picker, add debounced server-side search that queries the full client set, or use a dedicated pick-list endpoint with pagination/search semantics surfaced in the UI.

test analysis:
No linked tests were provided, and there is no evidence of a test covering a client list larger than the hard-coded page size.

suggested regression test:
Add a test with a mocked first page of 100 clients and an additional matching client outside that page, then verify the chosen fix can find/select the out-of-page client.

minimum fix scope:
Update the client-loading/search behavior in `ClientPickerDialog`; API/client helper changes may be needed if the existing endpoint requires explicit pagination metadata.

repro:
Create more than 100 non-archived clients such that the desired client is not returned on the first `/clients?pageSize=100&status=all` page. Open the picker and search for that client's exact company name; the component reports no match because it only searches the first page.

## medium: Failed reload leaves stale clients selectable

id: fnd_sig-feat-ui-flow-74a015d611-dd26_873e1e00f7
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: React component ClientPickerDialog (feat_ui-flow_74a015d611)

evidence:
- artifacts/cadstone/src/components/dashboard/ClientPickerDialog.tsx:38-40 (ClientPickerDialog)
- artifacts/cadstone/src/components/dashboard/ClientPickerDialog.tsx:45-61 (ClientPickerDialog)
- artifacts/cadstone/src/components/dashboard/ClientPickerDialog.tsx:111-124 (ClientPickerDialog)

The component keeps the previous successful `clients` array across opens. On a later open, if `/clients` fails, the catch only shows a toast and never clears the old data or enters an error-only state. Once `loading` becomes false, the old `filtered` list is rendered and remains selectable, so a user can assign/select a client from stale data after the current load failed.

recommendation:
Clear `clients` when starting a fresh load or in the error path, and render an explicit failed-load state that does not expose selectable stale rows unless the UI clearly marks them as cached and intentionally allows that behavior.

test analysis:
No linked tests were provided for this component, and the package test script only indicates generic `src/**/*.test.ts` discovery, so there is no evidence of a test exercising reopen-after-failure behavior.

suggested regression test:
Add a component test that mocks one successful client load followed by a rejected reload, then asserts that the stale client row is not selectable after the second request fails.

minimum fix scope:
Update `ClientPickerDialog` load/error state handling and add a focused component test for stale-data suppression.

repro:
Open the dialog once with a successful client response, close it, then reopen while the `/clients?pageSize=100&status=all` request fails. After the toast, the previously loaded clients are shown and their buttons still call `onSelect(client.id)`.

## low: CommandEmpty drops its default styling when callers pass className

id: fnd_sig-feat-ui-flow-7806f2d2cc-69a8_e48263e2c1
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: React component command (feat_ui-flow_7806f2d2cc)

evidence:
- artifacts/cadstone/src/components/ui/command.tsx:68-75 (CommandEmpty)
- artifacts/cadstone/src/components/ui/command.tsx:55-63 (CommandList)

CommandEmpty accepts the primitive props as a single props object, so caller-provided className remains inside props. Because props is spread after the hard-coded className, any custom className replaces the default empty-state padding, centering, and text size. Sibling command wrappers destructure className and merge it with cn, so this exported wrapper has an inconsistent customization contract and can silently regress layout when consumers add styling.

recommendation:
Change CommandEmpty to destructure className and merge it with the defaults: ({ className, ...props }, ref) => <CommandPrimitive.Empty ref={ref} className={cn("py-6 text-center text-sm", className)} {...props} />.

test analysis:
No linked tests were provided for this feature, and the existing searched usages do not pass className to CommandEmpty, so this wrapper API behavior is not exercised.

suggested regression test:
Add a component test that renders CommandEmpty with a custom className and asserts the rendered element retains the default classes and includes the custom class.

minimum fix scope:
Update only CommandEmpty in artifacts/cadstone/src/components/ui/command.tsx and add focused coverage for className merging.

repro:
Render <CommandEmpty className="text-red-500">No results</CommandEmpty>; the resulting element receives only the caller className instead of preserving py-6 text-center text-sm plus the custom class.

## medium: Context menu max-height class emits invalid CSS variable value

id: fnd_sig-feat-ui-flow-7c26e9571c-9cfe_772e26afe1
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: React component context-menu (feat_ui-flow_7c26e9571c)

evidence:
- artifacts/cadstone/src/components/ui/context-menu.tsx:63 (ContextMenuContent)

Tailwind arbitrary values in square brackets are emitted as the raw CSS value, so max-h-[--radix-context-menu-content-available-height] becomes an invalid max-height value instead of reading the Radix custom property. The component also sets overflow-y-auto, indicating the menu is intended to clamp to Radix's available viewport height; with the invalid max-height, long context menus can extend off-screen instead of scrolling.

recommendation:
Change the class to use a valid CSS variable reference, for example max-h-[var(--radix-context-menu-content-available-height)], or Tailwind's custom-property shorthand if supported consistently by this project.

test analysis:
The feature lists no linked tests, and there is no evidence of a visual or interaction test covering long context-menu overflow behavior.

suggested regression test:
Add a Playwright component/e2e case that opens a context menu with many items near the viewport edge and asserts the content height is constrained to the viewport and scrolls.

minimum fix scope:
Update the ContextMenuContent max-height class in artifacts/cadstone/src/components/ui/context-menu.tsx.

repro:
Render ContextMenuContent with enough ContextMenuItem children to exceed the viewport height. The generated max-height declaration is invalid, so the menu is not constrained to --radix-context-menu-content-available-height and bottom items can be unreachable.

## medium: Slider thumb cannot be given an accessible name

id: fnd_sig-feat-ui-flow-838d2b2244-ae95_8442b1bac3
category: bug
confidence: medium
triage: risk
status: open
feature: React component slider (feat_ui-flow_838d2b2244)

evidence:
- artifacts/cadstone/src/components/ui/slider.tsx:9-16 (Slider)
- artifacts/cadstone/src/components/ui/slider.tsx:21 (Slider)

The wrapper forwards all caller props to SliderPrimitive.Root but hardcodes SliderPrimitive.Thumb with no way to pass per-thumb aria-label or aria-labelledby. Radix slider thumbs are the focusable controls, so consumers cannot label the actual slider control through this component. Screen-reader users can encounter an unnamed slider even if callers try to label the root.

recommendation:
Expose thumb props or an explicit label prop and apply it to SliderPrimitive.Thumb. If the component is intended to support multiple thumbs later, accept a thumbLabels array and render one Thumb per value.

test analysis:
The feature metadata lists no linked tests, and the package test script only discovers src/**/*.test.ts, so there is no component accessibility test covering the rendered slider thumb.

suggested regression test:
Add a jsdom/React test that renders <Slider thumbAriaLabel="Progress" value={[50]} /> and asserts the focusable role="slider" element has accessible name "Progress".

minimum fix scope:
Update artifacts/cadstone/src/components/ui/slider.tsx to pass an accessible-name prop to SliderPrimitive.Thumb and add a focused component test if the local test setup supports React DOM accessibility assertions.

repro:
Render this component as a setting control and inspect the focusable slider thumb with an accessibility tree or screen reader; the component API only allows props on Root, while the Thumb receives no accessible-name props.

## medium: Citation identifiers are interpolated into routes without URL encoding

id: fnd_sig-feat-ui-flow-850b8f72ac-42e7_3d442bd9f6
category: security
confidence: high
triage: confirmed-bug
status: open
feature: React component Citation (feat_ui-flow_850b8f72ac)

evidence:
- artifacts/cadstone/src/components/agent/Citation.tsx:31-58 (hrefFor)

Citation IDs and job IDs come from the agent/API boundary, but hrefFor places them directly into path segments and query strings. Values containing characters such as '/', '?', '#', '&', or '=' can change the generated route or add/override query parameters, causing the chip to navigate to a different entity/view than the citation represents. Text rendering is escaped by React, but URL construction still needs component-level encoding.

recommendation:
Encode every dynamic route component with encodeURIComponent before interpolation, including citation.id and citation.jobId. Consider centralizing citation URL construction so future citation kinds cannot skip encoding.

test analysis:
No linked tests are included for CitationChip or hrefFor, and the package test script only discovers `src/**/*.test.ts`, while this feature lists no tests.

suggested regression test:
Add a CitationChip test that renders citations with reserved URL characters in `id` and `jobId`, then asserts the produced `href` contains encoded values and does not create extra query parameters.

minimum fix scope:
Update hrefFor in artifacts/cadstone/src/components/agent/Citation.tsx and add focused component or helper coverage.

repro:
Render a lead citation with id `abc&client=victim`; the Link target becomes `/sales/leads?lead=abc&client=victim` instead of preserving the full lead id as the `lead` parameter.

## low: Indeterminate checkboxes render as fully checked

id: fnd_sig-feat-ui-flow-88a2c9a21a-5444_8e976b2eca
category: bug
confidence: medium
triage: risk
status: open
feature: React component checkbox (feat_ui-flow_88a2c9a21a)

evidence:
- artifacts/cadstone/src/components/ui/checkbox.tsx:7-10 (Checkbox)
- artifacts/cadstone/src/components/ui/checkbox.tsx:19-22 (Checkbox)

The wrapper exposes the full Radix checkbox Root prop surface, which includes indeterminate checked/defaultChecked states, but the indicator always renders a checkmark whenever Radix shows the indicator. A mixed checkbox will therefore look selected rather than partially selected, which can mislead users in bulk-select or hierarchical selection flows even though the underlying aria state is mixed.

recommendation:
Render a distinct indeterminate glyph for checked="indeterminate"/data-state="indeterminate", or narrow the component props if this wrapper intentionally does not support Radix's indeterminate state.

test analysis:
No linked tests were provided for this component, so there is no assertion distinguishing checked and indeterminate rendering.

suggested regression test:
Add a component test that renders checked and indeterminate checkboxes and asserts the indeterminate state uses a different visual indicator, such as a minus icon or state-specific element.

minimum fix scope:
Update artifacts/cadstone/src/components/ui/checkbox.tsx to handle the Radix indeterminate state and add a focused component test.

repro:
Render <Checkbox checked="indeterminate" /> and compare its visual state to <Checkbox checked />; both show the same checkmark.

## low: ItemGroup exposes list semantics without listitem children

id: fnd_sig-feat-ui-flow-8a0725ed31-1330_62ad74046b
category: bug
confidence: medium
triage: risk
status: open
feature: React component item (feat_ui-flow_8a0725ed31)

evidence:
- artifacts/cadstone/src/components/ui/item.tsx:8-15 (ItemGroup)
- artifacts/cadstone/src/components/ui/item.tsx:54-70 (Item)

ItemGroup always renders role="list", but Item renders a plain div by default and does not provide role="listitem". The documented composition implied by the component names is ItemGroup containing Item instances, so assistive technologies can receive a list container whose children are not exposed as list items. This can make item counts/navigation unreliable for screen-reader users, especially when the group is used as the semantic list primitive for repeated UI content.

recommendation:
Either remove the default role="list" from ItemGroup and leave semantics to callers, or make Item provide role="listitem" when used in an ItemGroup-compatible composition. If asChild is used, document and/or enforce that the slotted child carries appropriate list item semantics when inside ItemGroup.

test analysis:
The feature lists no linked tests, and there is no accessibility or rendered DOM assertion covering the relationship between ItemGroup and Item.

suggested regression test:
Render <ItemGroup><Item>One</Item><Item>Two</Item></ItemGroup> and assert the list exposes two listitem descendants, or assert no list role is emitted if the component remains purely presentational.

minimum fix scope:
artifacts/cadstone/src/components/ui/item.tsx

## low: Preview index is not normalized before being stored

id: fnd_sig-feat-ui-flow-8cbf8c2ba4-a8c5_4937af55db
category: bug
confidence: medium
triage: risk
status: open
feature: React component file-preview-context (feat_ui-flow_8cbf8c2ba4)

evidence:
- artifacts/cadstone/src/components/files/file-preview-context.tsx:16-19 (FilePreviewProvider.open)
- artifacts/cadstone/src/components/files/FilePreview.tsx:128-139 (FilePreview)

The provider accepts an arbitrary index and stores it unchanged. FilePreview clamps only for rendering, but its navigation callbacks continue from the unclamped internal index. If open(files, 10) is called for a 3-file set, the UI renders file 3 via safeIndex, but the next navigation computes (10 + 1) % 3 = 2, so it appears stuck on the same file instead of wrapping to file 1. Large negative indices can also keep producing negative modulo values that clamp back to the first file. This is a small but real UI-flow bug at the provider boundary because the context API exposes index as caller-controlled input.

recommendation:
Clamp or modulo-normalize index in FilePreviewProvider.open before saving state, e.g. clamp to [0, files.length - 1], or normalize wrapping semantics deliberately. FilePreview can keep its defensive safeIndex as a fallback.

test analysis:
The linked tests cover PDF annotation editor and geometry helpers only; they do not render FilePreviewProvider/FilePreview or exercise out-of-range context indexes and navigation.

suggested regression test:
Add a component test for FilePreviewProvider/FilePreview that opens a three-file list with an out-of-range initial index and verifies that clicking Next advances from the displayed clamped item according to the intended order.

minimum fix scope:
Normalize the index in artifacts/cadstone/src/components/files/file-preview-context.tsx; optionally add a focused FilePreview navigation test.

repro:
Call useFilePreview().open([a,b,c], 10), then press ArrowRight or click Next. The preview initially shows c, and Next still shows c instead of wrapping to a.

## low: AdminRoute authorization flow lacks direct test coverage

id: fnd_sig-feat-ui-flow-8d19e52fe0-a252_b488dbb000
category: test-gap
confidence: high
triage: test-gap
status: open
feature: React component AdminRoute (feat_ui-flow_8d19e52fe0)

evidence:
- artifacts/cadstone/src/components/AdminRoute.tsx:13-17 (AdminRoute)
- artifacts/cadstone/package.json:12
- artifacts/cadstone/src/components/auth/RoleGate.test.ts:138-172

The feature's only behavior is route authorization: admins should render the nested outlet and every other store state should navigate to /403. The linked tests exercise the analogous RoleGate route-element pattern, including allowed roles, denied roles, signed-out state, and redirect landing pages, but none of the included tests import or render AdminRoute itself. A regression that changes AdminRoute's redirect target, drops replace, or stops rendering the Outlet would not be caught by the current component tests.

recommendation:
Add an AdminRoute test using the same MemoryRouter/Routes pattern as RoleGate.test.ts: verify admin renders the protected child route, crew_member/project_manager redirect to the /403 sentinel route, and null user redirects to /403 under the documented ProtectedRoute assumption.

test analysis:
ErrorBoundary and PDF tests cover unrelated components/helpers. RoleGate.test.ts covers a similar route guard but imports RoleGate, not AdminRoute, so AdminRoute can regress independently while the existing tests still pass.

suggested regression test:
Create artifacts/cadstone/src/components/AdminRoute.test.ts that sets useAuthStore roles, renders <Route element={<AdminRoute />}><Route path="/settings/team" ... /></Route> plus a /403 sentinel in MemoryRouter, and asserts admin sees the protected marker while non-admin and null user see the forbidden marker.

minimum fix scope:
Add focused AdminRoute route-rendering tests under artifacts/cadstone/src/components; no production code change is required unless the desired redirect semantics differ.

## low: Forwarded ref types do not match rendered elements

id: fnd_sig-feat-ui-flow-9102cc0085-50dc_aae031626d
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: React component alert (feat_ui-flow_9102cc0085)

evidence:
- artifacts/cadstone/src/components/ui/alert.tsx:35-43 (AlertTitle)
- artifacts/cadstone/src/components/ui/alert.tsx:47-55 (AlertDescription)

AlertTitle advertises a forwarded HTMLParagraphElement ref but renders an h5 heading element, and AlertDescription advertises paragraph attributes/ref while rendering a div. Consumers can type refs and props against the exported contract, but receive a different DOM element at runtime. This can break code that depends on element-specific typing, DOM assumptions, or tests asserting the forwarded element type.

recommendation:
Align the generic ref and prop types with the rendered tags, for example use HTMLHeadingElement for AlertTitle and HTMLDivElement plus React.HTMLAttributes<HTMLDivElement> for AlertDescription, or change the rendered tags to match the advertised paragraph contract.

test analysis:
No tests are linked for this component, and there is no ref-forwarding or rendered-element assertion covering the exported component contract.

suggested regression test:
Add a component test that renders AlertTitle and AlertDescription with refs and asserts the refs point to H5 and DIV elements respectively, matching the TypeScript component contracts after the fix.

minimum fix scope:
Update the React.forwardRef generic element types and HTMLAttributes types in artifacts/cadstone/src/components/ui/alert.tsx to match the actual rendered elements.

## low: Pagination ellipsis hides its screen-reader label

id: fnd_sig-feat-ui-flow-95a19268ad-7647_113213cbb3
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: React component pagination (feat_ui-flow_95a19268ad)

evidence:
- artifacts/cadstone/src/components/ui/pagination.tsx:79-88 (PaginationEllipsis)

The ellipsis wrapper is marked aria-hidden, which removes the wrapper and all descendants from the accessibility tree. That makes the nested sr-only label unreachable, so assistive technology receives neither the visual ellipsis nor the intended "More pages" text.

recommendation:
Remove aria-hidden from the wrapper if the sr-only label should be announced, or remove the sr-only text and document the ellipsis as purely decorative. Prefer exposing a concise label such as aria-label="More pages" while hiding only the icon if needed.

test analysis:
No tests were provided for this component, and the package test command only targets src/**/*.test.ts; there is no accessibility assertion for PaginationEllipsis.

suggested regression test:
Add a React Testing Library accessibility test that renders PaginationEllipsis and asserts the element or accessible name "More pages" is present in the accessibility tree.

minimum fix scope:
Update PaginationEllipsis in artifacts/cadstone/src/components/ui/pagination.tsx and add focused component coverage if the project has UI test utilities.

## low: EmptyDescription advertises paragraph props but renders a div

id: fnd_sig-feat-ui-flow-9d61345e28-5381_2622eb670e
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: React component empty (feat_ui-flow_9d61345e28)

evidence:
- artifacts/cadstone/src/components/ui/empty.tsx:54-63 (EmptyDescription)

The component's public TypeScript contract says it accepts props for a `<p>`, but the implementation renders a `<div>`. That creates a semantic/API mismatch for consumers and tests: callers reasonably expecting paragraph semantics from the type and component name will not get them in the DOM. It can also make accessibility or DOM-structure assertions fail once consumers depend on the rendered element type.

recommendation:
Render a `<p>` for `EmptyDescription`, or change the prop type to `React.ComponentProps<"div">` if the intended contract is a div. Prefer aligning the element with the description semantics unless existing callers require a div.

test analysis:
No linked tests are included for this component, and the package test script only targets `src/**/*.test.ts`; there is no evidence of a DOM-level test asserting the rendered tag or semantics.

suggested regression test:
Add a component test that renders `EmptyDescription` and asserts the root element is the intended tag, including that custom className and children are preserved.

minimum fix scope:
Update `EmptyDescription`'s rendered element or prop type in `artifacts/cadstone/src/components/ui/empty.tsx`, plus a focused component test if this UI library has a React test harness.

## medium: Missing-log drill-down can silently omit jobs when the count exceeds the sample list

id: fnd_sig-feat-ui-flow-9f09f14ff6-2753_94ae1fc4f0
category: bug
confidence: medium
triage: risk
status: open
feature: React component MissingLogsPage (feat_ui-flow_9f09f14ff6)

evidence:
- artifacts/cadstone/src/pages/at-risk/MissingLogsPage.tsx:25 (MissingLogsAtRiskPage)
- artifacts/cadstone/src/pages/at-risk/MissingLogsPage.tsx:45-58 (MissingLogsAtRiskPage)
- artifacts/cadstone/src/pages/home/types.ts:65-70 (PmHome)

The page presents itself as a drill-down list for all jobs missing logs and displays the aggregate jobsMissingLogs count, but it renders only atRisk.samples.missingLogJobs. The shared type contract keeps missingLogJobs under a samples object, separate from the aggregate count, so if the backend returns a capped sample smaller than jobsMissingLogs, the UI will claim N jobs need attention while only exposing the sample rows with no indication that more jobs exist. That can cause project managers to miss at-risk jobs.

recommendation:
Use a real list endpoint for this drill-down, or extend the dashboard contract to guarantee missingLogJobs is complete for this page and encode that guarantee outside the samples bucket. At minimum, detect jobsMissingLogs > missingLogJobs.length and show a clear incomplete-list state instead of silently rendering a partial list.

test analysis:
No linked tests were provided for this component, and there is no test exercising a payload where the aggregate count exceeds the sample array length.

suggested regression test:
Add a component test that mocks useDashboardGetDashboardHome with jobsMissingLogs greater than samples.missingLogJobs.length and asserts the page either fetches/renders the full list or shows an explicit incomplete/truncated warning.

minimum fix scope:
Update MissingLogsPage and, if needed, the dashboard/home API contract or route data source so the drill-down renders a complete list or clearly marks partial results.

repro:
Return a PM dashboard payload with atRisk.jobsMissingLogs = 25 and atRisk.samples.missingLogJobs containing 10 jobs; the card title says 25 jobs need attention, but only 10 navigable rows are rendered and there is no overflow/truncation state.

## low: Navigation uses an unclamped raw index after clamping the displayed file

id: fnd_sig-feat-ui-flow-a19a93cce9-037b_6cd79f84c8
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: React component FilePreview (feat_ui-flow_a19a93cce9)

evidence:
- artifacts/cadstone/src/components/files/FilePreview.tsx:131-139 (FilePreview)
- artifacts/cadstone/src/components/files/FilePreview.tsx:143-150 (FilePreview.goPrev/goNext)
- artifacts/cadstone/src/components/files/FilePreview.tsx:205 (FilePreview)

The UI displays current using safeIndex, but prev/next compute from the raw index state. With three files and initialIndex 99, the displayed file is clamped to index 2, but clicking Next computes (99 + 1) % 3 = 1, so navigation jumps from the last displayed file to the second file instead of wrapping to the first. The clamping implies out-of-range initialIndex is tolerated, but navigation then behaves inconsistently.

recommendation:
Clamp the stored index when opening or compute prev/next from the clamped safeIndex rather than the raw state value.

test analysis:
The linked tests do not cover FilePreview navigation or out-of-range initialIndex behavior.

suggested regression test:
Add a component test that opens with an out-of-range initialIndex and asserts Previous/Next navigation proceeds from the clamped visible file.

minimum fix scope:
Adjust FilePreview index initialization/update or goPrev/goNext handlers.

repro:
Open FilePreview with files.length === 3 and initialIndex === 99, then click Next; it displays file index 1 instead of wrapping from clamped index 2 to index 0.

## high: Absolute preview URLs can be fetched through the authenticated API client

id: fnd_sig-feat-ui-flow-a19a93cce9-21f7_b964f62c80
category: security
confidence: medium
triage: risk
status: open
feature: React component FilePreview (feat_ui-flow_a19a93cce9)

evidence:
- artifacts/cadstone/src/components/files/FilePreview.tsx:29-32 (PreviewFile.viewUrl)
- artifacts/cadstone/src/components/files/FilePreview.tsx:109-116 (buildAuthFetchUrl)
- artifacts/cadstone/src/components/files/FilePreview.tsx:253 (PreviewHeader.handleDownload)
- artifacts/cadstone/src/components/files/FilePreview.tsx:363-364 (PreviewBody)

The component explicitly accepts absolute viewUrl/directUrl values and passes them to the shared authenticated API client. If any file metadata or attachment record can carry a malicious absolute URL, opening the preview or clicking download can make the browser issue an API-client request to an attacker-controlled origin. Because the local comments describe this as the authenticated API client path, this risks leaking bearer headers or other request metadata whenever the client interceptor attaches auth to arbitrary axios URLs and the attacker permits CORS.

recommendation:
Only allow same-origin, API-relative preview/download paths through the authenticated api client. Reject absolute external URLs, normalize and validate allowed path prefixes, and use a separate unauthenticated fetch path only for intentionally public external URLs.

test analysis:
The linked tests cover PDF annotation editor and geometry helpers only; they do not mount FilePreview or assert URL validation/authenticated fetch behavior.

suggested regression test:
Add a FilePreview/buildAuthFetchUrl unit test that passes https://example.invalid/file as viewUrl/directUrl and asserts it is rejected or not sent to the authenticated api client.

minimum fix scope:
Constrain buildAuthFetchUrl and every caller that passes its result into api.get.

repro:
Render FilePreview with a file whose viewUrl is https://attacker.example/collect and no inline directUrl, then open the preview or click Download; buildAuthFetchUrl returns the external URL and api.get is invoked with it.

## low: Inline data/blob text files fall through to the unsupported view

id: fnd_sig-feat-ui-flow-a19a93cce9-970d_cae7c6211b
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: React component FilePreview (feat_ui-flow_a19a93cce9)

evidence:
- artifacts/cadstone/src/components/files/FilePreview.tsx:33-34 (PreviewFile.directUrl)
- artifacts/cadstone/src/components/files/FilePreview.tsx:57-64 (inferKind)
- artifacts/cadstone/src/components/files/FilePreview.tsx:357-360 (PreviewBody)
- artifacts/cadstone/src/components/files/FilePreview.tsx:417-429 (PreviewBody)

For text files with an inline data: or blob: directUrl, the effect stores the URL in blobUrl but never reads it into textContent. The render branch for text only displays when textContent is non-null, so a valid inline text attachment such as data:text/plain,hello is reported as unsupported even though the component supports text previews for fetched blobs.

recommendation:
When directUrl is present and kind is text, read it with fetch(directUrl).then(r => r.text()) or equivalent and populate textContent instead of only setting blobUrl.

test analysis:
The included tests are for pdf-annotation-editor and pdf-annotation-geometry; none exercise FilePreview with inline data/blob text URLs.

suggested regression test:
Add a React component test for a text/plain data URL that verifies the preview renders the decoded text rather than UnsupportedView.

minimum fix scope:
Update PreviewBody's directUrl branch for kind === "text" and add focused coverage.

repro:
Render FilePreview with { name: "note.txt", mimeType: "text/plain", directUrl: "data:text/plain,hello" }; after loading, the component reaches UnsupportedView instead of showing the text.

## low: Missing test coverage for route-derived job file navigation

id: fnd_sig-feat-ui-flow-a4ad9f3cf7-46d2_538ee49369
category: test-gap
confidence: high
triage: test-gap
status: open
feature: React component job-files-documents (feat_ui-flow_a4ad9f3cf7)

evidence:
- artifacts/cadstone/src/pages/job-files-documents.tsx:13-32 (JobFilesDocumentsPage)

The component builds job-scoped links from the route parameter and renders the document FileBrowser, but the feature declares no linked tests. A regression in the route parameter usage, tab targets, active document tab styling, or FileBrowser mediaType/defaultView wiring would not be caught by the included test set.

recommendation:
Add a focused React component test that renders this page under a MemoryRouter route with a concrete jobId and asserts the three tab hrefs, the active Documents tab state, and that FileBrowser is invoked with mediaType="document" and defaultView="list".

test analysis:
The feature metadata lists an empty tests array, and no test file is included as first-class evidence for this component.

suggested regression test:
Render JobFilesDocumentsPage at /jobs/job-123/files/documents and assert links resolve to /jobs/job-123/files/documents, /jobs/job-123/files/photos, and /jobs/job-123/files/videos; mock FileBrowser and assert it receives mediaType document and defaultView list.

minimum fix scope:
Add a component-level test for artifacts/cadstone/src/pages/job-files-documents.tsx using the existing test runner and React test utilities already used in the project.

## medium: Drill-down page can silently show only dashboard samples, not the full pending change order list

id: fnd_sig-feat-ui-flow-b6282a3319-e92f_8143ed82e0
category: bug
confidence: medium
triage: risk
status: open
feature: React component PendingChangeOrdersPage (feat_ui-flow_b6282a3319)

evidence:
- artifacts/cadstone/src/pages/at-risk/PendingChangeOrdersPage.tsx:11-14 (PendingChangeOrdersAtRiskPage)
- artifacts/cadstone/src/pages/at-risk/PendingChangeOrdersPage.tsx:44-46 (PendingChangeOrdersAtRiskPage)
- artifacts/cadstone/src/pages/at-risk/PendingChangeOrdersPage.tsx:61-81 (PendingChangeOrdersAtRiskPage)
- artifacts/cadstone/src/pages/home/types.ts:69-76 (PmHome)

The page is presented as a drill-down list for all pending change orders, and its header displays the aggregate pendingChangeOrders count, but the rows come only from atRisk.samples.pendingChangeOrders. If /dashboard/home samples are capped for the home tile, the page can show a count such as 12 pending while rendering only the sampled rows with no pagination, truncation notice, or path to the omitted records. That makes the drill-down materially incomplete.

recommendation:
Back this page with an endpoint that returns the complete pending change order collection for the active PM scope, or explicitly render pagination/limit messaging and a navigation path when the aggregate count exceeds the sample length.

test analysis:
No linked tests are included for this component, and none assert behavior when pendingChangeOrders is greater than samples.pendingChangeOrders.length.

suggested regression test:
Render the component with a PM dashboard payload where atRisk.pendingChangeOrders is greater than atRisk.samples.pendingChangeOrders.length and assert that the UI either fetches/renders all rows or clearly indicates the list is truncated with an appropriate next action.

minimum fix scope:
artifacts/cadstone/src/pages/at-risk/PendingChangeOrdersPage.tsx plus the API/client contract if a complete list endpoint is added.

## medium: Mobile Reports navigation uses the Sales role gate instead of the Reports gate

id: fnd_sig-feat-ui-flow-b7e1f9a459-13db_d5e33fefe4
category: security
confidence: high
triage: confirmed-bug
status: open
feature: React component AppLayout (feat_ui-flow_b7e1f9a459)

evidence:
- artifacts/cadstone/src/components/layout/TopNav.tsx:67-72 (TopNav)
- artifacts/cadstone/src/components/layout/MobileBottomNav.tsx:91-97 (MobileBottomNav)

AppLayout renders TopNav for desktop and MobileBottomNav for mobile, but the same Reports destination is guarded by different role gates in the two navigation surfaces. Desktop uses ROLE_GATES.reports while mobile uses ROLE_GATES.sales. This can expose the Reports link to roles that only have Sales access, and hide it from roles that have Reports access but not Sales access.

recommendation:
Change MobileBottomNav's Reports item to use ROLE_GATES.reports so mobile and desktop navigation enforce the same access rule.

test analysis:
No tests are listed for AppLayout or MobileBottomNav, and no included test asserts role-gated navigation parity between desktop and mobile.

suggested regression test:
Add a MobileBottomNav role-gating test that enables reports and verifies Reports visibility follows ROLE_GATES.reports, not ROLE_GATES.sales.

minimum fix scope:
Update the Reports MoreItem in artifacts/cadstone/src/components/layout/MobileBottomNav.tsx and cover the role matrix with a focused component test.

repro:
Enable the reports feature and sign in on a mobile-width viewport with a role that has ROLE_GATES.sales but not ROLE_GATES.reports; the More sheet will include Reports even though desktop navigation would not. Conversely, a reports-only role would lose the mobile Reports link.

## medium: Keyboard shortcuts bypass the role-gated navigation model

id: fnd_sig-feat-ui-flow-b7e1f9a459-592b_441a06d342
category: security
confidence: medium
triage: risk
status: open
feature: React component AppLayout (feat_ui-flow_b7e1f9a459)

evidence:
- artifacts/cadstone/src/components/layout/KeyboardShortcuts.tsx:35-43 (buildShortcutGroups)
- artifacts/cadstone/src/components/layout/KeyboardShortcuts.tsx:129-139 (KeyboardShortcuts.handleKeyDown)
- artifacts/cadstone/src/components/layout/TopNav.tsx:51-75 (TopNav)

AppLayout mounts KeyboardShortcuts globally, but the shortcut map always advertises and executes g c and g l navigation for every authenticated role. The visible top navigation deliberately removes Clients and office-only routes for field users, so this creates an alternate navigation path around the role-gated UI. If route-level guards are incomplete on any target page, this becomes an authorization bypass; even with guards it exposes inaccessible flows and contradicts the intended role model.

recommendation:
Build shortcut groups and route handling from the same role gates used by TopNav/MobileBottomNav, or omit and ignore shortcuts to routes the current role cannot access.

test analysis:
No tests are listed for AppLayout or KeyboardShortcuts, and no included test asserts role-specific shortcut visibility or navigation behavior.

suggested regression test:
Add a KeyboardShortcuts component test that renders with a crew_member/project_manager user, opens the help overlay, asserts Clients/Leads shortcuts are absent, and verifies g+c/g+l do not call navigate.

minimum fix scope:
Update KeyboardShortcuts to use the current role for both displayed shortcut groups and keydown route dispatch, reusing ROLE_GATES/hasRoleAccess or an equivalent shared helper.

repro:
Sign in as a project_manager or crew_member, press '?' and observe Clients/Leads shortcuts are shown, then press 'g' followed by 'c' or 'l' and the app navigates to /clients or /leads despite those routes being absent from the role-specific primary nav.

## low: React TSX component tests would be skipped by the package test script

id: fnd_sig-feat-ui-flow-bb5a0ca65e-cc95_c53d4c3b3d
category: test-gap
confidence: medium
triage: test-gap
status: open
feature: React component dialog (feat_ui-flow_bb5a0ca65e)

evidence:
- artifacts/cadstone/package.json:14
- artifacts/cadstone/src/components/ui/dialog.tsx:1-95 (DialogContent)

The owned feature is implemented in a .tsx React component, but the package test command only discovers files matching src/**/*.test.ts. A conventional regression test for this dialog component written as src/components/ui/dialog.test.tsx would not run under pnpm --filter @workspace/cadstone test, leaving accessibility and rendering regressions for this UI flow easy to miss.

recommendation:
Update the test script to include TSX test files, for example src/**/*.test.{ts,tsx}, or document and enforce a project convention that React component tests must use .test.ts with a DOM setup.

test analysis:
The feature metadata lists no linked tests, and the current package test glob excludes the natural .test.tsx filename pattern for React component tests.

suggested regression test:
Add a dialog.test.tsx smoke test that renders DialogContent inside Dialog and verifies the close button accessible name and portal content, then confirm it is executed by the package test command.

minimum fix scope:
artifacts/cadstone/package.json test script and one focused React component test

## medium: Blur timer closes the worker list while focus is still inside it

id: fnd_sig-feat-ui-flow-bbdfed9757-fc17_5a5d1d147c
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: React component WorkerAssignmentPicker (feat_ui-flow_bbdfed9757)

evidence:
- artifacts/cadstone/src/components/WorkerAssignmentPicker.tsx:99-110 (WorkerAssignmentPicker)

The input blur handler always schedules the picker closed after 150ms, but focus is allowed to move from the input to one of the rendered worker option buttons. A keyboard user can tab from the search input into the list, then the timeout removes the list while focus is on an option, preventing normal keyboard selection unless Enter is pressed inside the timeout window. The same stale timeout can also hide the list after the input has already regained focus.

recommendation:
Track whether focus remains inside the picker container, or use onBlur with relatedTarget/currentTarget containment checks. If a delay is still needed for mouse clicks, store the timeout id in a ref, clear it on focus and unmount, and do not close when the next focused element is inside the component.

test analysis:
The linked tests cover ErrorBoundary, RoleGate, and PDF annotation helpers; none render WorkerAssignmentPicker or exercise focus/keyboard behavior for its option list.

suggested regression test:
Add a JSDOM React test for WorkerAssignmentPicker that focuses the input, tabs or programmatically moves focus to an option button, advances timers past 150ms, and asserts the option remains mounted and can call onChange when activated.

minimum fix scope:
WorkerAssignmentPicker focus/blur handling and a focused component-level regression test.

repro:
Focus the search input with an empty query, press Tab to move focus to the first worker option, wait more than 150ms, then press Enter. The option has been unmounted by the input blur timeout instead of remaining selectable while focus is within the picker.

## medium: EmptyState actions accept href but render non-navigating buttons

id: fnd_sig-feat-ui-flow-c5d592030b-2ae1_590662fd22
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: React component EmptyState (feat_ui-flow_c5d592030b)

evidence:
- artifacts/cadstone/src/components/EmptyState.tsx:6-9 (EmptyStateAction)
- artifacts/cadstone/src/components/EmptyState.tsx:48-56 (EmptyState)
- artifacts/cadstone/src/components/EmptyState.tsx:59-66 (EmptyState)

The public action shape advertises href for both primary and secondary actions, but the component never consumes it. A caller that passes an href-only action gets a visible button with no navigation target and no click handler, so the CTA appears enabled while doing nothing.

recommendation:
Either implement href handling for both action slots, for example by rendering a Link/anchor through the Button component when href is present, or remove href from EmptyStateAction if navigation is not supported.

test analysis:
The linked tests exercise ErrorBoundary, RoleGate, and PDF annotation helpers. None render EmptyState or assert action behavior, so an href-only CTA can regress without test failure.

suggested regression test:
Add an EmptyState component test that renders primary and secondary href actions and asserts they produce navigable link elements with the expected destinations, plus an onClick-only action case.

minimum fix scope:
artifacts/cadstone/src/components/EmptyState.tsx action rendering, with a focused EmptyState test.

repro:
Render <EmptyState title="No jobs" action={{ label: "Create job", href: "/jobs/new" }} /> and click the action. The rendered element is a type="button" Button with no onClick and no anchor/link, so navigation never occurs.

## medium: Settings can be overwritten with defaults after a silent settings-load failure

id: fnd_sig-feat-ui-flow-c943fb5b21-3336_7f80106e37
category: data-loss
confidence: medium
triage: risk
status: open
feature: React component job-daily-logs (feat_ui-flow_c943fb5b21)

evidence:
- artifacts/cadstone/src/pages/job-daily-logs.tsx:347-358 (DEFAULT_SETTINGS)
- artifacts/cadstone/src/pages/job-daily-logs.tsx:3436-3452 (loadReferenceData)
- artifacts/cadstone/src/pages/job-daily-logs.tsx:3468-3470 (loadReferenceData)
- artifacts/cadstone/src/pages/job-daily-logs.tsx:3493-3497 (handleSaveSettings)

The page initializes settings from DEFAULT_SETTINGS, suppresses the settings GET redirect, and does nothing if that request rejects. An admin can still open the settings dialog and save, causing handleSaveSettings to PUT the default/incomplete settings object over the persisted settings. A transient 500/network error on the initial GET is enough to make existing defaults such as defaultNotes and share/notify behavior disappear on save.

recommendation:
Track whether settings loaded successfully. Disable the settings dialog/save path or show a blocking error until current settings are loaded, and surface settings-load failures to admins instead of silently falling back to defaults.

test analysis:
No linked tests were provided, and no tests were found for the settings load/save failure path.

suggested regression test:
Add a test that mocks /daily-logs/settings failure, opens settings as an admin, and asserts save is disabled or does not PUT DEFAULT_SETTINGS.

minimum fix scope:
Add a settingsLoaded/settingsLoadError state and gate SettingsDialog opening or saving on a successful settings fetch.

repro:
Make /daily-logs/settings fail for an admin while the page loads, open Daily Log Settings, and click Save. The client sends DEFAULT_SETTINGS to /daily-logs/settings.

## low: Comment attachment preview object URLs leak when the sheet closes

id: fnd_sig-feat-ui-flow-c943fb5b21-5a35_48ff2acf4c
category: performance
confidence: high
triage: risk
status: open
feature: React component job-daily-logs (feat_ui-flow_c943fb5b21)

evidence:
- artifacts/cadstone/src/pages/job-daily-logs.tsx:2224-2234 (handleCommentFiles)
- artifacts/cadstone/src/pages/job-daily-logs.tsx:2256-2267 (CommentsSheet cleanup)
- artifacts/cadstone/src/pages/job-daily-logs.tsx:2157-2167 (CommentsSheet close reset)

The cleanup effect has an empty dependency array, so its closure sees the initial attachments array rather than later uploaded drafts. Closing the sheet resets attachments without revoking their previewUrl values, and the component remains mounted, so every abandoned attachment can retain a blob URL until page unload.

recommendation:
Revoke preview URLs before clearing attachments on close, and either keep the cleanup effect synchronized with the latest attachments via a ref or include attachments in a cleanup that revokes URLs removed from state.

test analysis:
No linked tests were provided, and no tests were found for CommentsSheet attachment cleanup.

suggested regression test:
Add a jsdom test that stubs URL.createObjectURL/revokeObjectURL, attaches a file, closes the sheet, and asserts revokeObjectURL was called for the draft preview.

minimum fix scope:
Adjust CommentsSheet close/unmount cleanup to revoke current draft attachment preview URLs exactly once.

repro:
Open comments, attach one or more images, then close the comments sheet without sending or removing them. The attachment state is cleared, but those object URLs are not revoked.

## medium: Stale weather requests can overwrite the selected job/date weather

id: fnd_sig-feat-ui-flow-c943fb5b21-60f5_4f51393e61
category: concurrency
confidence: high
triage: confirmed-bug
status: open
feature: React component job-daily-logs (feat_ui-flow_c943fb5b21)

evidence:
- artifacts/cadstone/src/pages/job-daily-logs.tsx:2683-2727 (DailyLogDialog weather effect)
- artifacts/cadstone/src/pages/job-daily-logs.tsx:2792-2800 (persist)

The effect only clears the debounce timeout. Once a /weather request has started, a slower response from an earlier job or date still calls setValues and writes weatherData without checking that the current job/date still matches the request. That stale weatherData is then submitted in persist.

recommendation:
Track a request id or AbortController for weather fetches, and before applying success or failure state verify the response still matches the current selected job/address/date. Also avoid clearing weatherData from stale failures.

test analysis:
No linked tests were provided, and no test references this weather effect or stale response handling.

suggested regression test:
Add a component/helper test that resolves two mocked /weather calls out of order and asserts only the latest job/date response updates weatherData.

minimum fix scope:
Add stale-response protection inside the weather useEffect and cover out-of-order success/failure cases.

repro:
Open a new log with weather enabled, change the date or job address twice quickly, and have the first /weather request resolve after the second. The UI can show/save the first request's weather for the second selection.

## medium: Daily-log default dates and date presets use UTC instead of the user's local day

id: fnd_sig-feat-ui-flow-c943fb5b21-eb8d_daec8581f0
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: React component job-daily-logs (feat_ui-flow_c943fb5b21)

evidence:
- artifacts/cadstone/src/pages/job-daily-logs.tsx:400-405 (todayString)
- artifacts/cadstone/src/pages/job-daily-logs.tsx:511-529 (getDateRangeForPreset)
- artifacts/cadstone/src/pages/job-daily-logs.tsx:637-641 (buildDefaultForm)

Daily logs are entered as date-only local job records, but the default form date and all relative date presets derive the day from UTC. In US time zones, opening the page in the late afternoon/evening can make a new daily log default to tomorrow and make the Today/Past/Next filters query the wrong date range, which can persist logs under the wrong day and fetch weather for the wrong day.

recommendation:
Build YYYY-MM-DD strings from local calendar components for UI date defaults and presets, or explicitly use the job/site timezone if the product has one. Avoid toISOString/getUTC* for date-only form values.

test analysis:
No linked tests were provided, and an rg search found no tests covering todayString or getDateRangeForPreset.

suggested regression test:
Add tests that freeze time in America/Los_Angeles near UTC midnight and assert a new daily log and the Today/Past/Next presets use the local date.

minimum fix scope:
Update todayString, toDateOnly/toQueryDate, and addDays/getDateRangeForPreset to operate on local date-only values, then cover the helper behavior with timezone-sensitive tests.

repro:
In a negative UTC offset such as America/Los_Angeles, mock the browser clock to 2026-05-19 18:00 local time. Opening the create dialog sets logDate to 2026-05-20, and the Today filter also queries 2026-05-20.

## low: Input accepts and forwards a conflicting ref prop

id: fnd_sig-feat-ui-flow-cda56e1cb5-9240_e73faed3a3
category: api-contract
confidence: medium
triage: contract-mismatch
status: open
feature: React component input (feat_ui-flow_cda56e1cb5)

evidence:
- artifacts/cadstone/src/components/ui/input.tsx:5-13 (Input)
- artifacts/cadstone/src/components/ui/input.tsx:11-13 (Input)

React.ComponentProps<"input"> includes ref-capable intrinsic props, but this component also receives ref through React.forwardRef. Because the rest props are spread after ref={ref}, a ref carried in a spread props object can override the forwarded ref at the underlying input. This makes the component's public typing suggest two ref channels and can cause the explicit forwardRef ref not to receive the DOM node when both are present. The usual contract is ComponentPropsWithoutRef<"input">, with the forwarded ref as the only ref path.

recommendation:
Change the props type to React.ComponentPropsWithoutRef<"input"> and keep the forwarded ref applied directly. Optionally place {...props} before ref={ref} as a defensive ordering improvement.

test analysis:
No tests were included for this component, and package test discovery only targets src/**/*.test.ts, so this ref contract is currently unverified.

suggested regression test:
Add a small React/JSDOM test that renders Input with a forwarded ref and verifies the ref receives the native HTMLInputElement. If retaining spread prop compatibility is important, also assert that a ref inside spread props cannot override the forwarded ref.

minimum fix scope:
artifacts/cadstone/src/components/ui/input.tsx

repro:
Create an object typed as React.ComponentProps<"input"> with a ref callback, then render <Input {...object} ref={outerRef} />. The spread ref can replace the forwarded ref on the native input because {...props} is applied after ref={ref}.

## low: EmptyState render and action behavior has no linked test coverage

id: fnd_sig-feat-ui-flow-ced0250ddd-69fe_3b4112afa2
category: test-gap
confidence: high
triage: test-gap
status: open
feature: React component EmptyState (feat_ui-flow_ced0250ddd)

evidence:
- artifacts/cadstone/src/pages/job-schedule/components/EmptyState.tsx:16-24 (EmptyState)

The component has user-visible rendering and an optional click path, but the feature metadata lists no tests. A regression could remove the empty-state copy, always show or hide the action button, or stop invoking the callback without being caught by the linked test set.

recommendation:
Add a focused React component test covering title and description rendering, absence of the button when action props are missing, presence of the button when both action props are supplied, and invocation of onAction on click.

test analysis:
The feature lists no linked tests, so there is no first-class evidence that this component's render contract or click behavior is covered.

suggested regression test:
Create EmptyState.test.tsx that renders EmptyState with and without actionLabel/onAction and asserts visible text, button visibility, and callback invocation after a user click.

minimum fix scope:
Add a component-level test for EmptyState; production code does not need to change unless the intended action rendering contract differs.

## low: More options can carry a blank title that quick save rejects

id: fnd_sig-feat-ui-flow-cff7ea3da8-1d6c_006737eac2
category: bug
confidence: medium
triage: risk
status: open
feature: React component ScheduleQuickCreate (feat_ui-flow_cff7ea3da8)

evidence:
- artifacts/cadstone/src/components/schedule/ScheduleQuickCreate.tsx:139-146 (handleQuickSave)
- artifacts/cadstone/src/components/schedule/ScheduleQuickCreate.tsx:183-187 (handleQuickMoreOptions)
- artifacts/cadstone/src/components/schedule/ScheduleQuickCreate.tsx:127-136 (buildState)

The quick-create save path enforces a non-empty trimmed title before creating an item, but the More options path closes the dialog and forwards the raw state without the same normalization or validation. A user can enter only spaces, click More options, and the downstream flow receives a state that this component itself considers invalid. That can produce inconsistent validation behavior or accidentally prefill an invalid title in the full editor.

recommendation:
Apply the same title normalization and required-title validation before calling onMoreOptions, or intentionally pass a normalized empty title and ensure the full editor treats it as an unsaved draft with visible validation.

test analysis:
No linked tests are included for ScheduleQuickCreate, and the package test script only covers src/**/*.test.ts; this component has no listed test coverage for the More options flow.

suggested regression test:
Add a React component test that enters whitespace in the title, clicks More options, and asserts onMoreOptions is not called while the required-title error is shown, or asserts the agreed normalized draft behavior if blank titles are intentionally allowed in the full editor.

minimum fix scope:
ScheduleQuickCreate handleQuickMoreOptions/buildState title handling plus a focused component test for the More options validation path.

repro:
Open the quick-create dialog, type spaces in the Title field, then click More options. The component calls onMoreOptions with title set to the whitespace string instead of showing the required-title error used by Create.

## medium: Undo before the delayed save still persists the new annotation

id: fnd_sig-feat-ui-flow-d53d0c57c5-067c_13e57591d7
category: data-loss
confidence: high
triage: confirmed-bug
status: open
feature: React component PdfViewer (feat_ui-flow_d53d0c57c5)

evidence:
- artifacts/cadstone/src/components/files/PdfViewer.tsx:64-70 (PdfViewer)
- artifacts/cadstone/src/components/files/use-pdf-annotations.ts:224-244 (createAnnotation)
- artifacts/cadstone/src/components/files/use-pdf-annotations.ts:325-348 (undo)
- artifacts/cadstone/src/components/files/use-pdf-annotations.ts:174-196 (persistDraft)

Creating markup schedules persistence 300 ms later, but undoing that create before the timeout only removes the optimistic draft and does not cancel the pending timeout or mark the draft as canceled. When the timer fires, persistDraft still POSTs the removed draft and appends the server annotation, so a user-visible undo can be silently reversed and an unwanted annotation is saved.

recommendation:
Track the create timer per tempId and clear it when undo removes an unpersisted create, when the file changes, and when annotations are disabled. Also guard persistDraft by checking that the draft tempId is still present and still belongs to the current file before POSTing.

test analysis:
The included tests cover pure editor and geometry helpers only; they do not exercise usePdfAnnotations timers, optimistic drafts, or undo/redo behavior.

suggested regression test:
Add a hook/component test with fake timers: call createAnnotation, call undo before advancing 300 ms, advance timers, and assert api.post was not called and no annotation is added.

minimum fix scope:
artifacts/cadstone/src/components/files/use-pdf-annotations.ts plus an async undo regression test.

repro:
Enter markup mode, draw a pen/highlighter stroke, immediately press Cmd/Ctrl+Z within 300 ms, then wait for the delayed POST. The draft is removed at first, but the annotation is later created and appears again.

## medium: Stale annotation load responses can overwrite the current file's annotations

id: fnd_sig-feat-ui-flow-d53d0c57c5-c56c_038b293e58
category: concurrency
confidence: high
triage: confirmed-bug
status: open
feature: React component PdfViewer (feat_ui-flow_d53d0c57c5)

evidence:
- artifacts/cadstone/src/components/files/PdfViewer.tsx:40-41 (PdfViewer)
- artifacts/cadstone/src/components/files/use-pdf-annotations.ts:127-149 (refresh)
- artifacts/cadstone/src/components/files/use-pdf-annotations.ts:151-161 (usePdfAnnotations)
- artifacts/cadstone/src/components/files/PdfViewer.tsx:153-169 (PdfViewer)

refresh writes whatever network response resolves last into shared hook state, and the effect that runs on fileId changes has no cleanup, abort, or request identity check. If file A's annotation request is slow and the viewer switches to file B, file B can load correctly and then be overwritten by file A's late response. PdfViewer will then render old-file annotations on the current PDF, and edit/delete actions will target the current fileId with stale annotation IDs.

recommendation:
Use an AbortController or monotonically increasing request id/current fileId ref in refresh. Ignore success, error, and loading completion from stale requests after fileId changes, and clear annotations for the new file before accepting only its matching response.

test analysis:
The linked tests do not cover usePdfAnnotations network loading or rapid file changes; they only validate editor submit and geometry calculations.

suggested regression test:
Add a test that mocks api.get with two deferred promises, switches fileId from A to B, resolves B first and A second, and asserts the final annotations remain B's data.

minimum fix scope:
artifacts/cadstone/src/components/files/use-pdf-annotations.ts plus a hook/component test for out-of-order refreshes.

repro:
Open PDF A and delay GET /files/A/annotations, switch the same viewer instance to PDF B and let GET /files/B/annotations resolve, then resolve A's request. The annotation layer for B receives A's annotations.

## low: Sidebar setOpen does not preserve functional updater semantics

id: fnd_sig-feat-ui-flow-d6cdcc5730-19b8_c845755993
category: api-contract
confidence: medium
triage: contract-mismatch
status: open
feature: React component sidebar (feat_ui-flow_d6cdcc5730)

evidence:
- artifacts/cadstone/src/components/ui/sidebar.tsx:36 (SidebarContextProps)
- artifacts/cadstone/src/components/ui/sidebar.tsx:74-86 (SidebarProvider.setOpen)
- artifacts/cadstone/src/components/ui/sidebar.tsx:89-92 (SidebarProvider.toggleSidebar)

The provider implementation accepts a React-style functional updater and the internal toggle path uses that form, but it evaluates the updater against the render-captured open value and then commits a plain boolean. Multiple updater calls in one batch can collapse into one state transition instead of composing like React state updates. The exported context type also narrows setOpen to boolean-only, so consumers of useSidebar cannot use the safer updater form even though the provider implementation expects it.

recommendation:
Type setOpen as React.Dispatch<React.SetStateAction<boolean>> or an equivalent union, and implement uncontrolled updates by passing the updater through _setOpen(prev => next). For controlled usage, consider allowing onOpenChange to accept the same updater shape or document that controlled callers receive resolved booleans only.

test analysis:
No linked tests were provided for the sidebar context API, batched toggles, or controlled/uncontrolled state behavior.

suggested regression test:
Add a component-level test that calls the exposed setOpen functional updater twice in one React act() block and asserts the final expanded/collapsed state is unchanged.

minimum fix scope:
artifacts/cadstone/src/components/ui/sidebar.tsx

repro:
Inside a SidebarProvider render cycle, invoke setOpen(v => !v) twice before React rerenders; expected React updater semantics would return to the original state, but both calls compute from the same captured open value and leave the sidebar toggled once.

## medium: Home errors render as a permanent loading state

id: fnd_sig-feat-ui-flow-de94fcc35e-297e_89bc74d369
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: React component index (feat_ui-flow_de94fcc35e)

evidence:
- artifacts/cadstone/src/pages/home/index.tsx:21-26 (HomePage)
- artifacts/cadstone/src/pages/home/index.tsx:31-47 (HomePage)

When the dashboard request fails, React Query commonly reports an error with isLoading false and data undefined. This component toasts the error, but then the `isLoading || !data` branch still renders the loading skeleton, so the Home page appears to be loading indefinitely instead of showing a retry/error state. The user gets only a transient toast and no persistent page-level indication that loading failed.

recommendation:
Handle `error && !data` before the loading fallback and render a persistent error state with a retry action, or otherwise distinguish initial loading from failed/no-data states.

test analysis:
No tests were supplied for this feature, and the package test script only discovers `src/**/*.test.ts`; there is no linked HomePage error-state test in the provided evidence.

suggested regression test:
Add a HomePage component test that mocks `useDashboardGetDashboardHome` to return `{ isLoading: false, data: undefined, error }` and asserts the loading skeleton is not rendered while a persistent failure message or retry control is rendered.

minimum fix scope:
Update `artifacts/cadstone/src/pages/home/index.tsx` to branch on request errors before the `!data` loading fallback and add a focused component test.

repro:
Have `/dashboard/home` return a non-2xx response. After the toast appears, the page remains on `data-testid="home-loading"` because `!data` is still true.

## medium: Stale search results remain clickable while a new query or page is loading

id: fnd_sig-feat-ui-flow-df09c4a9cc-a3d1_89aa32ef44
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: React component GlobalSearch (feat_ui-flow_df09c4a9cc)

evidence:
- artifacts/cadstone/src/components/layout/GlobalSearch.tsx:168-178 (GlobalSearch)
- artifacts/cadstone/src/components/layout/GlobalSearch.tsx:386-399 (GlobalSearch)
- artifacts/cadstone/src/components/layout/GlobalSearch.tsx:400-410 (GlobalSearch)

When a new debounced query or page is requested, the component sets loading but keeps the previous response. The render path only shows the loading state when response is null; otherwise it continues rendering results derived from the old response. During that window the user can click stale options that do not match the current query/page and navigate to the wrong record.

recommendation:
Clear or separately mark the response as stale when starting a fetch for a new query/page, and render a loading/disabled state instead of clickable old results. Another option is to store the query/page associated with each response and only render results when it matches the current request key.

test analysis:
No linked tests were provided for GlobalSearch, and the package test script only establishes the test runner rather than covering this debounce/loading transition.

suggested regression test:
Add a component test that resolves the first /search request, changes the input to a second query while holding the second request pending, and asserts the first query's result is no longer clickable/rendered as an active option.

minimum fix scope:
Update GlobalSearch request state handling and add a focused component test for stale-result suppression during pending fetches.

repro:
Search for a term with results, then type a different two-character query or click Next while the new request is pending. The old result list remains visible and selectable until the new response arrives.

## low: Top-level menubar content is missing the close animation trigger

id: fnd_sig-feat-ui-flow-e6f7d63c9d-04e6_cacc19a93f
category: bug
confidence: medium
triage: risk
status: open
feature: React component menubar (feat_ui-flow_e6f7d63c9d)

evidence:
- artifacts/cadstone/src/components/ui/menubar.tsx:95 (MenubarSubContent)
- artifacts/cadstone/src/components/ui/menubar.tsx:118 (MenubarContent)

MenubarContent includes closed-state fade and zoom-out classes but omits the matching data-[state=closed]:animate-out class that is present on MenubarSubContent and the other animated Radix overlays in this component set. The closed-state effect utilities are therefore not activated for the root menubar content, so top-level menus animate in but close abruptly while submenus close with the intended animation.

recommendation:
Add data-[state=closed]:animate-out to the MenubarContent class list alongside data-[state=open]:animate-in.

test analysis:
The feature lists no tests, and there is no component-level assertion that the root menubar content includes the full closed-state animation class set.

suggested regression test:
Add a small render test for MenubarContent that opens and closes a menu and asserts the content className includes both data-[state=open]:animate-in and data-[state=closed]:animate-out, or add a snapshot-style class contract test for the exported UI wrapper.

minimum fix scope:
One class string change in artifacts/cadstone/src/components/ui/menubar.tsx.

## medium: Unassigned selection is rendered as All team members

id: fnd_sig-feat-ui-flow-eb685ca8df-eb6f_64b77489e8
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: React component AssigneeSelect (feat_ui-flow_eb685ca8df)

evidence:
- artifacts/cadstone/src/pages/job-schedule/components/AssigneeSelect.tsx:28-38 (AssigneeSelect)
- artifacts/cadstone/src/pages/job-schedule/components/AssigneeSelect.tsx:59-66 (AssigneeSelect)

The component has a first-class Unassigned option that writes the sentinel value "__unassigned__", but the closed trigger label only looks up matching users and otherwise falls back to "All team members". When the selected value is "__unassigned__", selectedUser is undefined, so the control displays the same label as the all-users state while the active filter is actually unassigned. This misrepresents the selected filter and can lead users to believe no assignee filter is active.

recommendation:
Derive the trigger label from all supported values, for example render "Unassigned" when value === "__unassigned__", "All team members" when value === "", otherwise the matched user's fullName with an explicit missing-user fallback if needed.

test analysis:
The feature lists no linked tests, and there is no included component test asserting the trigger label for the sentinel Unassigned value.

suggested regression test:
Render AssigneeSelect with value="__unassigned__" and assert that the trigger text is "Unassigned" rather than "All team members"; also assert the empty string value still renders "All team members".

minimum fix scope:
Update AssigneeSelect's selected label derivation and add a focused component test for empty, unassigned, and concrete user values.

## medium: Contact creation failures are silently treated as a successful client create

id: fnd_sig-feat-ui-flow-ec976c715b-1be5_4cdb60cfdd
category: data-loss
confidence: high
triage: confirmed-bug
status: open
feature: React component CreateJobDialog (feat_ui-flow_ec976c715b)

evidence:
- artifacts/cadstone/src/components/jobs/CreateJobDialog.tsx:186-200 (handleCreateClient)
- artifacts/cadstone/src/components/jobs/CreateJobDialog.tsx:208-214 (handleCreateClient)

If the user enters a contact name, the component posts the client first and then posts the primary contact. Any contact-post error is swallowed, after which the UI selects the new client, clears the contact fields, hides the create-client form, and shows a success toast. The user-provided contact name is lost from the UI with no indication that it was not saved.

recommendation:
Do not silently swallow the contact failure. Either fail the whole inline client creation visibly, keep the entered contact fields for retry, or surface a partial-success warning that the client exists but the contact was not saved.

test analysis:
No linked tests cover the inline client creation path or the partial-failure case between client and contact creation.

suggested regression test:
Mock successful `POST /clients` and failed `POST /clients/{id}/contacts`; assert the user sees an error or partial-success warning and the contact fields are not cleared as if fully saved.

minimum fix scope:
Change the catch block around contact creation and the subsequent success/clear behavior in `CreateJobDialog.tsx`.

repro:
Enter company and contact fields, make `POST /clients/{id}/contacts` fail while `POST /clients` succeeds. The dialog reports success and clears the contact data, but no contact exists.

## low: Client is presented as optional even though job submission rejects missing client

id: fnd_sig-feat-ui-flow-ec976c715b-75bf_e3c368b646
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: React component CreateJobDialog (feat_ui-flow_ec976c715b)

evidence:
- artifacts/cadstone/src/components/jobs/CreateJobDialog.tsx:227-231 (handleCreate)
- artifacts/cadstone/src/components/jobs/CreateJobDialog.tsx:323-328 (CreateJobDialog)

The first step allows progressing with only a title, the select placeholder says the client link is optional, and the menu includes a `None` choice. Final submission then rejects the same state and sends the user back to step 1. That is a contract mismatch between the UI flow and the payload validation path, causing users to fill the second step for a job that cannot be submitted.

recommendation:
Make the client requirement consistent: either allow the API payload to omit `clientId`, or mark the client field as required and block Step 1 until a client is selected or created.

test analysis:
No linked tests exercise the no-client path through the two-step form.

suggested regression test:
Render the dialog, enter only a title, leave the client unset, and assert the user cannot advance past step 1 if `clientId` is required.

minimum fix scope:
Update the client select labeling and Step 1 validation in `CreateJobDialog.tsx`, or change the submit payload/validation if client truly should be optional.

repro:
Open the dialog, enter a title, leave Client as None, click Next, then click Create Job. The dialog refuses submission with a client-required error after the user has already completed step 2.

## medium: Locked dialog can submit a stale client id after the parent changes the locked client

id: fnd_sig-feat-ui-flow-ec976c715b-d69d_07141de6de
category: bug
confidence: medium
triage: risk
status: open
feature: React component CreateJobDialog (feat_ui-flow_ec976c715b)

evidence:
- artifacts/cadstone/src/components/jobs/CreateJobDialog.tsx:129-144 (CreateJobDialog)
- artifacts/cadstone/src/components/jobs/CreateJobDialog.tsx:224-228 (handleCreate)
- artifacts/cadstone/src/components/jobs/CreateJobDialog.tsx:308-310 (CreateJobDialog)

When `lockClient` is true, the prop-selected client is supposed to be authoritative, but the form only copies `defaultClientId` on the closed-to-open transition. If the parent changes `defaultClientId` while the dialog remains open, the disabled select still reads from the old `form.clientId`, and submit uses `form.clientId || defaultClientId`, so the stale client wins. That can create the job under the wrong client.

recommendation:
When `lockClient` is true, derive the submitted client id directly from `defaultClientId`, or synchronize `form.clientId` when the locked default changes without resetting unrelated fields.

test analysis:
No linked tests are provided for this component, and the package test command only runs existing `src/**/*.test.ts` files.

suggested regression test:
Render the dialog open with `lockClient` and one `defaultClientId`, rerender with another `defaultClientId`, submit, and assert the mutation payload uses the new locked id.

minimum fix scope:
Update `CreateJobDialog.tsx` client-id selection logic for the locked-client path.

repro:
Open with `lockClient=true` and `defaultClientId='client-a'`, then update the prop to `defaultClientId='client-b'` without closing the dialog. Submit the job; the payload uses `client-a`.

## medium: Dropzone uploads can target the previously opened folder

id: fnd_sig-feat-ui-flow-f46319771b-4f02_a449e38c5b
category: data-loss
confidence: high
triage: confirmed-bug
status: open
feature: React component FileBrowser (feat_ui-flow_f46319771b)

evidence:
- artifacts/cadstone/src/components/FileBrowser.tsx:822-859 (uploadFilesImmediately)
- artifacts/cadstone/src/components/FileBrowser.tsx:895-920 (onDrop)

The memoized dropzone callback calls uploadFilesImmediately, which builds the upload URL from currentFolderId, but the callback dependency list does not include currentFolderId, isResourceScope, or uploadFilesImmediately. If a user opens one uploadable folder and then another where canUploadFiles remains true, React can reuse the old onDrop closure. Dropping or using the dropzone picker in the second folder can POST the file to the first folder, placing private job/resource files in the wrong folder and potentially under the wrong folder permissions.

recommendation:
Include the actual values used by the callback in the dependency list, preferably by wrapping uploadFilesImmediately in useCallback with currentFolderId, isResourceScope, uploadTask, and other used values, then depending on that stable callback from onDrop. Alternatively pass the active folder id explicitly into the drop handler at invocation time.

test analysis:
The linked tests cover ErrorBoundary, RoleGate, and PDF annotation helpers; they do not mount FileBrowser, navigate between folders, or assert the dropzone upload URL after navigation.

suggested regression test:
Mount FileBrowser with mocked api/useDropzone, open two uploadable folders with different ids, invoke the registered drop callback after the second navigation, and assert uploadWithProgress receives the second folder id in its URL.

minimum fix scope:
FileBrowser dropzone callback dependencies and upload helper callback structure.

repro:
Open uploadable Folder A, then open uploadable Folder B without changing role/media/upload state. Drop a file on Folder B's dropzone. The stale onDrop closure can call uploadFilesImmediately from the Folder A render and send the request to /folders/A/files or /resources/folders/A/upload.

## medium: Upload in-flight guard is set after async validation/probing

id: fnd_sig-feat-ui-flow-f46319771b-ce83_832c8952e3
category: concurrency
confidence: high
triage: confirmed-bug
status: open
feature: React component FileBrowser (feat_ui-flow_f46319771b)

evidence:
- artifacts/cadstone/src/components/FileBrowser.tsx:895-917 (onDrop)
- artifacts/cadstone/src/components/FileBrowser.tsx:822-854 (uploadFilesImmediately)

The component intends to allow only one tracked upload, but both guards check uploadTask before asynchronous validation and video-duration probing. During that gap uploadTask remains null, so a second drop/picker action or double submit can pass the same guard. Each invocation can then start uploadWithProgress and overwrite the single uploadTask state, producing duplicate uploads and a progress/cancel UI attached only to the latest task.

recommendation:
Set a synchronous pending/upload lock before awaiting validation/probing, or store an in-flight ref that is flipped immediately at the start of upload selection/drop/submit and cleared in finally. Keep uploadTask for UI progress, but do not use delayed React state alone as the concurrency guard.

test analysis:
The included tests do not exercise FileBrowser upload interactions or concurrent selection/drop timing; they only cover unrelated components/helpers.

suggested regression test:
With mocked delayed validators, invoke the FileBrowser drop handler twice in the same tick and assert only one uploadWithProgress call is made and the second attempt reports the existing-upload message.

minimum fix scope:
FileBrowser upload selection/drop/submit concurrency guard.

repro:
Use a video file or a mocked slow validateSelectedFilesAsync/probeVideoDurations, trigger two drops before the first probe resolves, and observe two uploadWithProgress calls while only one uploadTask is tracked.

## low: FieldError renders an empty alert when there are no displayable messages

id: fnd_sig-feat-ui-flow-f674c75a36-1e07_4bcedc2b24
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: React component field (feat_ui-flow_f674c75a36)

evidence:
- artifacts/cadstone/src/components/ui/field.tsx:197-213 (FieldError)
- artifacts/cadstone/src/components/ui/field.tsx:215-227 (FieldError)

When errors is an empty array, or an array whose entries have no message, the memoized content becomes an empty <ul>. React elements are truthy, so the later !content guard does not suppress output and FieldError renders an empty role="alert" region. That creates a visible/accessible error container without any error text, which can add unintended spacing and cause assistive technologies to announce an alert with no actionable content.

recommendation:
Filter errors down to non-empty message strings before deciding what to render, and return null when that filtered list is empty. Use the filtered list for both the single-message and multiple-message paths.

test analysis:
No linked tests were provided for this component, and artifacts/cadstone/package.json only shows a general src/**/*.test.ts test command without evidence of FieldError coverage.

suggested regression test:
Add a FieldError component test that asserts errors={[]} and errors={[undefined, { message: undefined }]} render nothing, while one and multiple valid messages still render the expected alert content.

minimum fix scope:
Update FieldError in artifacts/cadstone/src/components/ui/field.tsx and add a focused component test for empty and message-bearing errors.

repro:
Render <FieldError errors={[]} /> or <FieldError errors={[undefined, { message: undefined }]} />. The component returns a div with role="alert" containing an empty list instead of null.

## medium: Leads shortcut navigates to an undefined route

id: fnd_sig-feat-ui-flow-fc348a3304-ef2c_33713fb2cc
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: React component KeyboardShortcuts (feat_ui-flow_fc348a3304)

evidence:
- artifacts/cadstone/src/components/layout/KeyboardShortcuts.tsx:39-42 (buildShortcutGroups)
- artifacts/cadstone/src/components/layout/KeyboardShortcuts.tsx:131-140 (KeyboardShortcuts.handleKeyDown)
- artifacts/cadstone/src/App.tsx:202-204 (buildRouter)

The help overlay advertises g+l as the Leads shortcut, and the handler routes it to /leads. The router defines the leads page at /sales and /sales/leads, so pressing g then l falls through to the wildcard/not-found route instead of opening leads.

recommendation:
Change the g+l target to the actual leads route, likely `/sales` or `/sales/leads`, and keep the overlay label aligned with the destination.

test analysis:
The feature declares no linked tests, and there is no evidence of a KeyboardShortcuts route-mapping test covering the g+l sequence.

suggested regression test:
Render KeyboardShortcuts under a memory router, dispatch `keydown` events for `g` then `l`, and assert navigation targets the defined leads route.

minimum fix scope:
Update the route mapping in KeyboardShortcuts and add a focused keyboard navigation regression test.

repro:
In the app, press `g` then `l`. The component calls `navigate('/leads')`; because the router only mounts LeadsPage at `/sales` and `/sales/leads`, the user lands on the not-found route.

## low: Non-admin users are shown and can trigger admin-only navigation shortcuts

id: fnd_sig-feat-ui-flow-fc348a3304-fe05_20cdcf3d36
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: React component KeyboardShortcuts (feat_ui-flow_fc348a3304)

evidence:
- artifacts/cadstone/src/components/layout/KeyboardShortcuts.tsx:35-45 (buildShortcutGroups)
- artifacts/cadstone/src/components/layout/KeyboardShortcuts.tsx:130-145 (KeyboardShortcuts.handleKeyDown)
- artifacts/cadstone/src/lib/role-access.ts:7-9 (ROLE_GATES)

Only the `n` create-job shortcut is gated on `isAdmin`; the Clients and Leads/Sales shortcuts are always displayed and always handled. Those destinations are admin-only routes, so project managers and crew members are offered shortcuts that either redirect away, 403, or not-found instead of matching their available navigation.

recommendation:
Build navigation shortcuts from the same role gates as the primary navigation, or gate the clients and leads/sales shortcuts on admin access just like the `n` shortcut.

test analysis:
The feature declares no linked tests, and the existing implementation has no visible role-based assertion for the shortcut overlay or key handler.

suggested regression test:
Render KeyboardShortcuts with non-admin auth state and assert the overlay omits Clients/Leads shortcuts and the key handler does not navigate for those sequences.

minimum fix scope:
Apply role-aware filtering to both shortcutGroups and the keydown route handler, then cover admin and non-admin behavior.

repro:
Sign in as a project_manager or crew_member, open the shortcut overlay with `?`, observe Clients and Leads shortcuts, then press `g` then `c` or `g` then `l`. The component attempts navigation to admin-only or invalid destinations.

## low: Default horizontal orientation is not reflected in the DOM attribute

id: fnd_sig-feat-ui-flow-fcf800f712-32dd_58047c07c8
category: bug
confidence: medium
triage: risk
status: open
feature: React component button-group (feat_ui-flow_fcf800f712)

evidence:
- artifacts/cadstone/src/components/ui/button-group.tsx:18-20 (buttonGroupVariants)
- artifacts/cadstone/src/components/ui/button-group.tsx:24-35 (ButtonGroup)

The styling layer defaults ButtonGroup to horizontal, but the rendered data-orientation attribute is populated from the raw prop. When orientation is omitted, the element is styled horizontally while data-orientation is absent. Any consumer CSS, tests, or accessibility tooling that reads this explicit data attribute sees no orientation for the default state.

recommendation:
Default the function parameter as orientation = "horizontal" before using it for both buttonGroupVariants and data-orientation.

test analysis:
No linked tests assert the rendered DOM contract for ButtonGroup's default orientation.

suggested regression test:
Render ButtonGroup without props and assert the root has data-orientation="horizontal".

minimum fix scope:
Change ButtonGroup's prop destructuring default and add a focused render test.

repro:
Render <ButtonGroup /> without an orientation prop and inspect the root element; it has horizontal classes from the default variant but no data-orientation="horizontal" attribute.

## medium: Select-trigger rules never match the local SelectTrigger component

id: fnd_sig-feat-ui-flow-fcf800f712-afc0_19b744cf30
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: React component button-group (feat_ui-flow_fcf800f712)

evidence:
- artifacts/cadstone/src/components/ui/button-group.tsx:8 (buttonGroupVariants)

The button group's select-specific layout depends on direct children carrying data-slot="select-trigger". The local SelectTrigger component inspected in artifacts/cadstone/src/components/ui/select.tsx does not set that attribute, so these rules do not apply when a SelectTrigger is grouped with buttons. The grouped select keeps its normal w-full styling and misses the intended right-edge rounding fix, producing incorrect button-group layout for a supported child type implied by this component's own CSS.

recommendation:
Add data-slot="select-trigger" to SelectTrigger, or change ButtonGroup's selectors to match the actual local SelectTrigger markup. Prefer aligning the shared UI components on the data-slot convention if this button-group was imported from that pattern.

test analysis:
No tests are linked for this feature, and the package test script only picks up src/**/*.test.ts files; there is no included component test covering a ButtonGroup with SelectTrigger children.

suggested regression test:
Add a React/jsdom test that renders ButtonGroup with SelectTrigger and asserts the trigger has the expected data-slot or that the grouped-select class selector can match it.

minimum fix scope:
Update the SelectTrigger markup or the selector contract used by buttonGroupVariants, plus a focused component test.

repro:
Render <ButtonGroup><Button>Save</Button><Select><SelectTrigger>...</SelectTrigger></Select></ButtonGroup>. The SelectTrigger will not match the data-slot selector in buttonGroupVariants, so the width/rounding adjustments on line 8 are skipped.

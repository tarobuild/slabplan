# SlabPlan marketing product-claim audit

Last audited: 2026-08-02

The public marketing page may use illustrative company names, addresses, amounts,
dates, and field photos. Feature statements must map to implemented SlabPlan
workflows. This audit records that mapping so future marketing changes do not
turn sample content into unsupported product promises.

| Public claim                                                                                                 | Implemented behavior                                                                                                                              | Primary evidence                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Leads can hold contacts, site details, scope, files, confidence, and projected value, then convert into jobs | Lead records include the marketed fields and the conversion workflow carries lead context into a job                                              | `artifacts/cadstone/src/pages/leads.tsx`, `artifacts/cadstone/src/pages/leads/ConvertLeadDialog.tsx`, `artifacts/api-server/src/routes/leads.ts`               |
| Jobs connect project details, schedules, daily activity, files, and financials                               | The job workspace routes each of these workflows through a shared job record                                                                      | `artifacts/cadstone/src/pages/job-detail.tsx`, `artifacts/cadstone/src/App.tsx`                                                                                |
| Field teams can use My Day, schedule context, and daily logs                                                 | Role-aware home views and daily logs expose notes, weather, sharing, notifications, custom fields, tags, attachments, comments, and media         | `artifacts/cadstone/src/pages/home/MyDayPage.tsx`, `artifacts/cadstone/src/pages/job-daily-logs.tsx`, `artifacts/api-server/src/routes/daily-logs.ts`          |
| Financial workflows cover schedules of values, invoices, payments, change orders, and retention              | Job financial routes and UI implement each listed record type and job-level totals                                                                | `artifacts/cadstone/src/pages/job-financials.tsx`, `artifacts/api-server/src/routes/financials.ts`                                                             |
| Supported estimate and invoice documents can be parsed                                                       | Financial import workflows parse supported documents into reviewable estimate and invoice data                                                    | `artifacts/api-server/src/routes/financials.ts`, `artifacts/cadstone/src/pages/job-financials.tsx`                                                             |
| The assistant shows tool activity and citations, saves/pins conversations, and tracks monthly usage          | Assistant messages render tool calls and citations; conversation state supports pinning; the composer displays and enforces a per-user token cap  | `artifacts/cadstone/src/components/agent/ChatPanel.tsx`, `artifacts/cadstone/src/components/agent/ChatMessage.tsx`, `artifacts/api-server/src/routes/agent.ts` |
| Global search finds jobs, clients, leads, files, and schedule items                                          | Search returns those five scoped result types                                                                                                     | `artifacts/cadstone/src/components/layout/GlobalSearch.tsx`, `artifacts/api-server/src/routes/search.ts`                                                       |
| Reports include A/R aging, monthly revenue, pipeline/win rate, payment speed, and jobs by stage              | Each report has a routed screen and API endpoint                                                                                                  | `artifacts/cadstone/src/pages/reports`, `artifacts/api-server/src/routes/reports.ts`                                                                           |
| Company records and private files are isolated                                                               | Authenticated data queries apply organization/access scope; file delivery uses authorization checks, protected storage, and expiring access links | `artifacts/api-server/src/lib/tenant-scope.ts`, `artifacts/api-server/src/routes/files.ts`, `artifacts/api-server/src/lib/storage.ts`                          |
| Full Access costs $250/month for up to 25 team members                                                       | The billing plan advertises $250 and 25 seats, and user creation enforces the seat limit                                                          | `artifacts/api-server/src/lib/stripe.ts`, `artifacts/api-server/src/routes/users.ts`                                                                           |
| Checkout and billing management use Stripe without SlabPlan storing raw card details                         | Checkout and customer-portal sessions are created by the server with Stripe-hosted payment handling                                               | `artifacts/api-server/src/routes/billing.ts`, `artifacts/api-server/src/lib/stripe.ts`                                                                         |

## Illustrative content policy

- Sample workspace data must remain clearly labeled as illustrative.
- Generated field imagery must not be represented as a real customer project.
- Marketing previews should mirror real fields and actions. They must not invent
  structured product data such as labor totals or installation percentages unless
  that data is actually implemented.
- Production application paths must continue to use live tenant data and must not
  import any marketing sample records.

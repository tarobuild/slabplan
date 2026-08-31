# SlabPlan Demo Tenant

This folder provisions the fictional **Summit Ridge Stoneworks Demo** tenant.
All names, companies, addresses, telephone numbers, transactions, jobs, leads,
and documents are synthetic. The workflow does not read from or write to the
original CAD Stone repository or customer data.

## Contents

- `generate_demo_pdfs.py` creates five watermarked client-demo PDFs in
  `output/pdf/`.
- `provision_demo_tenant.mjs` creates four role accounts, clients, jobs,
  leads, schedules, daily logs, financials, and private file uploads through
  SlabPlan's production APIs.
- Generated passwords live only in `tmp/slabplan-demo-credentials.json` with
  mode `0600`. The file is ignored by Git.
- `--rotate-logins --execute` applies staged `nextEmail` and `nextPassword`
  values from that private file, then removes the staged values.

## Provisioning

```bash
node scripts/demo/provision_demo_tenant.mjs --generate-credentials
node scripts/demo/provision_demo_tenant.mjs --register-owner --execute
node scripts/demo/provision_demo_tenant.mjs --activation-sql
node scripts/demo/provision_demo_tenant.mjs --populate --execute
node scripts/demo/provision_demo_tenant.mjs --rotate-logins --execute
node scripts/demo/provision_demo_tenant.mjs --verify
```

Run the printed activation SQL in the SlabPlan Supabase project after owner
registration and before population. It marks only the matching demo tenant as
non-billable; no Stripe customer or subscription is created.

The provisioner is designed to be rerun. It finds existing accounts, clients,
jobs, leads, schedule items, logs, financial lines, and exact file uploads
before creating missing records.

## Demo Roles

| Persona | SlabPlan role | Intended walkthrough |
| --- | --- | --- |
| Avery Cole | Admin / owner | Company dashboard, users, jobs, financials, files |
| Elena Ruiz | Project manager | Clients, leads, schedules, daily logs |
| Marcus Lee | Crew member | Assigned jobs, field schedule, daily logs; no financials |
| Priya Shah | Drafter | Jobs, CAD tasks, layout approvals; no financials |

## Password Rotation

Use the admin's **reissue setup link** action for a role account, then set a
new unique password through the normal invite-acceptance flow. To rotate the
owner password, use the authenticated password-change page or the public
forgot-password flow. Do not add passwords to this README, source files,
commits, tickets, or deployment logs.

## Refreshing The Demo

The provisioner adds missing content and does not remove activity created
during demonstrations. For a full reset, create a new demo organization with
new plus-address tags, run the same workflow, verify it, and then archive the
old demo organization. Do not delete or reseed a real customer tenant.

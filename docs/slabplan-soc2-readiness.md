# SlabPlan SOC 2 Readiness

Status: **Not independently attested**

Last reviewed: **September 26, 2026**

Proposed initial scope: **Security Trust Services Criteria**

This is a readiness plan, not an audit report or evidence that every control
below is operating. Management approval, a qualified independent CPA firm,
and verified operating evidence are still required. Detailed findings and
access inventories belong in restricted evidence storage, not this public
source repository.

## Current position

Replit and Supabase maintain SOC 2 Type II attestations for services within
their respective compliance boundaries. SlabPlan can use those reports as
vendor evidence, but provider compliance does not make Taro Build or SlabPlan
SOC 2 attested. SlabPlan must establish and operate its own controls and
complete an examination by an independent CPA firm. Type I examines control
design at a specified date; Type II also examines operating effectiveness
over an agreed period. A Type I report is not a prerequisite for Type II.

Customer-facing wording that reflects the current status:

> SlabPlan runs on infrastructure providers that maintain SOC 2 Type II
> attestations. SlabPlan does not currently claim its own independent SOC 2
> report.

Do not use "SOC 2 certified", "SOC 2 compliant", or "SOC 2 verified" to
describe SlabPlan. After an examination, describe the actual report type,
scope, period, and any qualifications accurately. SOC 2 is an attestation,
not a product certification or a guarantee against security incidents.

## System boundary

The intended examination boundary includes:

- SlabPlan's Replit production application and deployment configuration.
- Supabase Postgres, Auth, and private object storage used by SlabPlan.
- GitHub source control and release workflow for the SlabPlan repository.
- Administrative access, secrets, monitoring, backups, incident handling, and
  vendor management used to operate the service.
- Personnel and contractors with logical access to production systems or
  customer information.

Stripe, Anthropic, Sentry, Google Workspace, GitHub, Replit, and Supabase must
be maintained in the vendor inventory with current purpose, data categories,
access, contract owner, and assurance evidence.

## Readiness workstreams

1. Assign a control owner and approve written information-security, access,
   change-management, incident-response, vendor-risk, retention, and business-
   continuity policies.
2. Inventory production assets, data flows, subprocessors, privileged accounts,
   and customer-data classifications.
3. Enforce MFA for every administrative provider account and document
   quarterly access reviews and prompt offboarding.
4. Require reviewed pull requests, passing CI, intentional releases, protected
   production secrets, and traceable emergency changes.
5. Define vulnerability intake, dependency review, patch timelines, annual
   penetration testing, and remediation evidence.
6. Enable and retain the logs required for access, authentication, deployment,
   database, and security-event evidence. Supabase connection logging must be
   explicitly evaluated because it is not enabled by default for every plan.
7. Document backup scope, retention, restore ownership, recovery objectives,
   and recurring restore tests for database records and private files.
8. Run and record incident-response and business-continuity tabletop exercises.
9. Complete vendor due diligence and obtain current assurance reports where
   plan eligibility and confidentiality terms permit.
10. Engage a qualified SOC 2 readiness adviser or CPA firm, remediate gaps,
    choose Type I or Type II timing, and begin the formal evidence period.

## Evidence cadence

These are proposed operating targets, not universal SOC 2 requirements or
claims of completed reviews. Agree them with management and the auditor.

| Evidence                                 | Minimum cadence                   |
| ---------------------------------------- | --------------------------------- |
| Privileged-access and user-access review | Quarterly                         |
| Vendor assurance and subprocessor review | Annually and on material change   |
| Vulnerability and dependency review      | Continuous, with a monthly record |
| Backup restore test                      | Quarterly and material changes    |
| Incident-response tabletop               | At least annually                 |
| Business-continuity test                 | At least annually                 |
| Policy review and approval               | Annually                          |
| Production change evidence               | Every release                     |

## Audit entry gates

Engage the auditor early to agree on scope. Do not represent the system as
audit-ready until the following are evidenced:

- The system description and control matrix have named owners.
- Required policies are approved and operating.
- Administrative MFA and access reviews are evidenced.
- Production changes, incidents, vulnerabilities, backups, and vendors produce
  retrievable evidence.
- Known high-risk findings have owners and due dates.
- Management and the selected auditor agree on scope, criteria, period, and
  complementary user-entity controls.

## Open findings

- The August dependency snapshot is historical, not a current assurance.
  The September 26 review identified additional runtime advisories and
  applies compatible patches. Retain the complete before/after audit output;
  distinguish deployed dependency paths from mobile and sandbox dependencies.
- Remaining React Router advisories require a separately tested major-version
  migration or documented applicability analysis. Mobile dependencies must
  be reviewed and remediated before a mobile release.
- Technical tests and a successful database restore do not establish
  personnel controls, provider MFA, independent review, private-file recovery,
  log retention, or incident-response readiness. Maintain explicit evidence
  and unresolved findings for each, with owners and due dates.
- Shared demonstration accounts must contain synthetic data only. Do not use
  demo credentials for customer tenants or privileged provider access.

## Auditor Handoff

Management must supply the legal entity operating SlabPlan, authorized
signatory, service commitments, customer scope, and personnel/vendor roster.
Ask an independent CPA firm to confirm its license, independence, peer review,
proposed criteria, system boundary, evidence expectations, report restrictions,
and a written fee quote. Do not treat a readiness platform purchase as an
audit engagement. No auditor engagement or audit period is confirmed here.

Keep policies explicitly marked draft until management adopts them. Never
backdate approvals, access reviews, tests, or observation-period evidence.
Store signed policies, provider reports, inventories, questionnaires, and
audit findings outside the public GitHub repository with named-user access.

## Primary references

- Replit information security: <https://docs.replit.com/teams/information-security/overview>
- Replit shared responsibility: <https://docs.replit.com/references/security/shared-responsibility-model>
- Supabase SOC 2 compliance: <https://supabase.com/docs/guides/security/soc-2-compliance>
- Supabase shared responsibility: <https://supabase.com/docs/guides/deployment/shared-responsibility-model>
- AICPA SOC 2 overview: <https://www.aicpa-cima.com/topic/audit-assurance/audit-and-assurance-greater-than-soc-2>

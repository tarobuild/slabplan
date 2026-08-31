# SlabPlan SOC 2 Readiness

Status: **Not independently attested**  
Last reviewed: **August 19, 2026**  
Initial scope: **Security Trust Services Criterion**

## Current position

Replit and Supabase maintain SOC 2 Type II attestations for services within
their respective compliance boundaries. SlabPlan can use those reports as
vendor evidence, but provider compliance does not make Taro Build or SlabPlan
SOC 2 attested. SlabPlan must operate its own controls, collect evidence over an
observation period, and complete an examination by an independent CPA firm.

Approved public wording:

> SlabPlan runs on infrastructure providers that maintain SOC 2 Type II
> attestations. SlabPlan does not currently claim its own independent SOC 2
> report.

Do not use "SOC 2 certified", "SOC 2 compliant", or "SOC 2 verified" to
describe SlabPlan until an auditor has issued the applicable report.

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

| Evidence                                 | Minimum cadence                   |
| ---------------------------------------- | --------------------------------- |
| Privileged-access and user-access review | Quarterly                         |
| Vendor assurance and subprocessor review | Annually and on material change   |
| Vulnerability and dependency review      | Continuous, with a monthly record |
| Backup restore test                      | At least annually                 |
| Incident-response tabletop               | At least annually                 |
| Business-continuity test                 | At least annually                 |
| Policy review and approval               | Annually                          |
| Production change evidence               | Every release                     |

## Audit entry gates

Do not schedule an examination period until all of the following are true:

- The system description and control matrix have named owners.
- Required policies are approved and operating.
- Administrative MFA and access reviews are evidenced.
- Production changes, incidents, vulnerabilities, backups, and vendors produce
  retrievable evidence.
- Known high-risk findings have owners and due dates.
- Management and the selected auditor agree on scope, criteria, period, and
  complementary user-entity controls.

## Open findings

- On August 19, 2026, `pnpm audit --prod --audit-level high` reported 11
  high-severity transitive advisories. Every high-severity path was confined to
  `artifacts/cadstone-mobile` dependencies from Expo or React Native and is not
  included in the current Replit web/API deployment. Upgrade and re-audit the
  mobile dependency tree before any mobile production release. The complete
  audit also reported 15 moderate and 4 low advisories requiring routine
  triage.

## Primary references

- Replit information security: <https://docs.replit.com/teams/information-security/overview>
- Replit shared responsibility: <https://docs.replit.com/references/security/shared-responsibility-model>
- Supabase SOC 2 compliance: <https://supabase.com/docs/guides/security/soc-2-compliance>
- Supabase shared responsibility: <https://supabase.com/docs/guides/deployment/shared-responsibility-model>
- AICPA SOC 2 overview: <https://www.aicpa-cima.com/topic/audit-assurance/audit-and-assurance-greater-than-soc-2>

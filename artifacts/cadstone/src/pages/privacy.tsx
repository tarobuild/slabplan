import { LegalPage, type LegalSection } from "@/components/legal/LegalPage"
import { useDocumentTitle } from "@/hooks/use-document-title"
import { LEGAL_CONTACT_EMAIL } from "@/lib/legal"

const sections: LegalSection[] = [
  {
    title: "Information we collect",
    paragraphs: [
      <p>
        We collect account and company details such as names, work email addresses, phone numbers,
        roles, company names, and subscription information.
      </p>,
      <p>
        We also process information your company submits to SlabPlan, including customer and job
        records, schedules, daily logs, estimates, invoices, photos, videos, documents, comments,
        and AI prompts.
      </p>,
      <p>
        Technical information may include IP address, browser and device details, timestamps,
        security events, diagnostic data, and usage activity needed to operate and protect the
        service.
      </p>,
    ],
  },
  {
    title: "How we use information",
    paragraphs: [
      <p>
        We use information to provide, secure, maintain, troubleshoot, and improve SlabPlan;
        authenticate users; process subscriptions; deliver requested email; support customers;
        prevent abuse; and comply with legal obligations.
      </p>,
    ],
  },
  {
    title: "Company-controlled information",
    paragraphs: [
      <p>
        Your company controls the business records and files submitted to its workspace. Workspace
        administrators decide who can access that information. Direct privacy requests concerning
        company-controlled records should normally be directed to that company first.
      </p>,
    ],
  },
  {
    title: "AI processing",
    paragraphs: [
      <p>
        When you deliberately use an AI feature, the information needed for that request may be sent
        to our AI service provider, currently Anthropic. Do not submit information to an AI workflow
        unless your company is authorized to process it that way.
      </p>,
      <p>
        We meter AI usage and keep operational records needed for billing, security, debugging, and
        auditability.
      </p>,
    ],
  },
  {
    title: "Service providers",
    paragraphs: [
      <p>
        We use service providers to operate SlabPlan, including Replit for application hosting,
        Supabase for database and private object storage, Stripe for billing, Anthropic for
        requested AI processing, Sentry for error monitoring, Google Workspace for transactional
        email, and GitHub for source and backup automation.
      </p>,
      <p>
        These providers process information only as needed to perform services for us under their
        applicable terms and safeguards. We do not sell personal information.
      </p>,
    ],
  },
  {
    title: "Storage, retention, and deletion",
    paragraphs: [
      <p>
        Production database records and private files are stored with Supabase. We retain
        information while an account is active and as reasonably needed for support, security,
        billing, backup restoration, dispute resolution, and legal compliance.
      </p>,
      <p>
        Deletion requests may take time to flow through encrypted backups and may be limited where
        retention is legally required. Companies should export needed records before closing an
        account.
      </p>,
    ],
  },
  {
    title: "Security",
    paragraphs: [
      <p>
        We use access controls, encrypted connections, private object storage, tenant-scoped
        application controls, backups, monitoring, and other safeguards designed to protect
        information. No method of storage or transmission is completely secure.
      </p>,
    ],
  },
  {
    title: "Cookies and sessions",
    paragraphs: [
      <p>
        SlabPlan uses essential cookies and local browser storage for authentication, security,
        application preferences, and resumable uploads. We do not use these technologies to sell
        personal information.
      </p>,
    ],
  },
  {
    title: "Your choices and rights",
    paragraphs: [
      <p>
        You may update profile information in the service and may request access, correction, or
        deletion of personal information by contacting {LEGAL_CONTACT_EMAIL}. Some requests must be
        handled by the company that controls the relevant workspace.
      </p>,
      <p>
        Depending on where you live, applicable law may provide additional rights. We may verify
        identity and authority before completing a request.
      </p>,
    ],
  },
  {
    title: "Children and international use",
    paragraphs: [
      <p>
        SlabPlan is a business service and is not directed to children under 16. Information may be
        processed in the United States and other locations where our providers operate.
      </p>,
    ],
  },
  {
    title: "Changes and contact",
    paragraphs: [
      <p>
        We may update this Privacy Policy as the service or legal requirements change. We will post
        the revised policy with a new effective date and may request renewed acceptance for material
        changes.
      </p>,
      <p>Privacy questions and requests may be sent to {LEGAL_CONTACT_EMAIL}.</p>,
    ],
  },
]

export default function PrivacyPage() {
  useDocumentTitle("Privacy Policy")
  return (
    <LegalPage
      title="SlabPlan Privacy Policy"
      effectiveDate="August 19, 2026"
      introduction={
        <p>
          This Privacy Policy explains how Taro Build collects, uses, shares, and protects
          information when companies and their authorized users use SlabPlan.
        </p>
      }
      sections={sections}
    />
  )
}

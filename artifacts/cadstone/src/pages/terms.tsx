import { LegalPage, type LegalSection } from "@/components/legal/LegalPage"
import { useDocumentTitle } from "@/hooks/use-document-title"
import { LEGAL_CONTACT_EMAIL } from "@/lib/legal"

const sections: LegalSection[] = [
  {
    title: "The service",
    paragraphs: [
      <p>
        SlabPlan is a business operations platform for stone, fabrication, installation, and
        construction companies. It includes job, client, schedule, file, financial, reporting, and
        AI-assisted workflows.
      </p>,
      <p>
        You may use the service only for lawful business purposes and in accordance with these
        Terms.
      </p>,
    ],
  },
  {
    title: "Accounts and company workspaces",
    paragraphs: [
      <p>
        You must provide accurate account information, protect login credentials, and promptly
        remove access for people who should no longer use your company workspace. Your company is
        responsible for activity performed through its accounts.
      </p>,
      <p>
        Workspace owners and administrators control user roles and access. You are responsible for
        ensuring those permissions are appropriate for the information stored in SlabPlan.
      </p>,
    ],
  },
  {
    title: "Subscriptions and payment",
    paragraphs: [
      <p>
        Paid subscriptions are billed through Stripe at the price and interval shown at checkout.
        Unless the checkout states otherwise, subscriptions renew automatically until canceled.
      </p>,
      <p>
        Fees are non-refundable except where required by law or expressly agreed in writing. We may
        suspend paid features when payment is overdue, while providing a reasonable opportunity to
        resolve the account.
      </p>,
    ],
  },
  {
    title: "Your data and files",
    paragraphs: [
      <p>
        You retain ownership of the business data, documents, photos, videos, and other content you
        submit. You grant us the limited rights needed to host, process, back up, transmit, and
        display that content to operate and support SlabPlan.
      </p>,
      <p>
        You represent that you have the rights and permissions required to upload and process the
        content, including any personal information belonging to your customers, workers, or
        subcontractors.
      </p>,
    ],
  },
  {
    title: "AI-assisted features",
    paragraphs: [
      <p>
        AI features can make mistakes and may produce incomplete or inaccurate results. They are
        tools for business assistance, not professional engineering, architectural, legal, safety,
        or accounting advice.
      </p>,
      <p>
        You must review AI output before relying on it for bids, measurements, schedules,
        purchasing, fabrication, installation, compliance, or safety decisions.
      </p>,
    ],
  },
  {
    title: "Acceptable use",
    paragraphs: [
      <p>
        You may not misuse the service, probe or bypass security controls, access another
        company&apos;s information, introduce malicious code, interfere with availability, infringe
        intellectual property, or use SlabPlan for illegal, deceptive, or abusive activity.
      </p>,
    ],
  },
  {
    title: "Confidentiality and security",
    paragraphs: [
      <p>
        Each party will protect the other party&apos;s non-public business information using
        reasonable care and use it only for the relationship. We maintain administrative and
        technical safeguards designed to protect customer data, but no internet service can
        guarantee absolute security.
      </p>,
      <p>
        You must notify us promptly at {LEGAL_CONTACT_EMAIL} if you suspect unauthorized account
        access or a security incident involving SlabPlan.
      </p>,
    ],
  },
  {
    title: "Service changes and availability",
    paragraphs: [
      <p>
        We may improve, modify, or discontinue features. We aim to provide a reliable service but do
        not guarantee uninterrupted or error-free operation. Planned maintenance and events outside
        our reasonable control may affect availability.
      </p>,
    ],
  },
  {
    title: "Termination and data export",
    paragraphs: [
      <p>
        You may cancel the subscription through the available billing controls or by contacting us.
        We may suspend or terminate access for material breach, unlawful use, security risk, or
        nonpayment.
      </p>,
      <p>
        Before cancellation, you are responsible for exporting information you need. After
        termination, we may retain or delete data according to our Privacy Policy, legal
        obligations, backup cycles, and any written agreement with your company.
      </p>,
    ],
  },
  {
    title: "Disclaimers and liability",
    paragraphs: [
      <p>
        To the maximum extent permitted by law, SlabPlan is provided on an &quot;as is&quot; and
        &quot;as available&quot; basis without implied warranties of merchantability, fitness for a
        particular purpose, or non-infringement.
      </p>,
      <p>
        To the maximum extent permitted by law, Taro Build will not be liable for indirect,
        incidental, special, consequential, exemplary, or punitive damages, lost profits, or lost
        business. Our aggregate liability arising from the service will not exceed the fees your
        company paid for SlabPlan during the twelve months before the event giving rise to the
        claim.
      </p>,
    ],
  },
  {
    title: "General terms",
    paragraphs: [
      <p>
        These Terms and any applicable order or written service agreement are the complete agreement
        for SlabPlan. California law governs these Terms, without regard to conflict-of-law rules.
        If a provision is unenforceable, the remaining provisions continue in effect.
      </p>,
      <p>
        We may update these Terms and will post a new effective date. Material changes may require
        renewed acceptance. Questions may be sent to {LEGAL_CONTACT_EMAIL}.
      </p>,
    ],
  },
]

export default function TermsPage() {
  useDocumentTitle("Terms of Service")
  return (
    <LegalPage
      title="SlabPlan Terms of Service"
      effectiveDate="August 19, 2026"
      introduction={
        <p>
          These Terms govern access to SlabPlan, a service operated by Taro Build. By creating or
          activating an account, you agree to them on behalf of yourself and, when applicable, your
          company.
        </p>
      }
      sections={sections}
    />
  )
}

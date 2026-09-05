import type { Metadata } from "next";
import { LegalShell } from "@/components/legal-shell";
import { SITE_CONTACT_EMAIL, SITE_NAME, SITE_OPERATOR } from "@/lib/site";

export const metadata: Metadata = {
  title: "Terms",
  description: `Terms of service for ${SITE_NAME}.`,
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <LegalShell title="Terms of service" updated="2026-09-05">
      <p>
        {SITE_NAME} (&ldquo;the service&rdquo;) is operated by <strong>{SITE_OPERATOR}</strong>. By
        creating an account you agree to these terms.
      </p>

      <section>
        <h2>What the service does</h2>
        <p>
          The service accepts records of AI agent activity that you send to it, stores them, and lets
          you review and export them as an audit packet. It is a record-keeping tool. It does not run
          your agents and makes no claim about whether your agents behaved correctly.
        </p>
      </section>

      <section>
        <h2>Your account</h2>
        <ul>
          <li>You are responsible for keeping your password and API keys confidential.</li>
          <li>An API key is shown only once, at creation; a revoked key stops working immediately.</li>
          <li>One account, one organization — do not share credentials across parties.</li>
        </ul>
      </section>

      <section>
        <h2>Acceptable use</h2>
        <p>Do not use the service to:</p>
        <ul>
          <li>store data you have no right to store, including other people&rsquo;s personal data;</li>
          <li>attempt to reach another organization&rsquo;s records;</li>
          <li>disrupt, overload or probe the service outside a coordinated disclosure.</li>
        </ul>
      </section>

      <section>
        <h2>Your data</h2>
        <p>
          You keep ownership of everything you send. We store and process it only to provide the
          service, as described in the{" "}
          <a href="/privacy">privacy policy</a>. You can export it at any time and request deletion
          by email.
        </p>
      </section>

      <section>
        <h2>Availability and liability</h2>
        <p>
          The service is provided as-is, without warranty. It is not a legal compliance certification
          and does not by itself satisfy any regulatory requirement. To the extent permitted by law,
          the operator is not liable for indirect or consequential loss arising from its use. Keep
          your own copies of exports you need to retain.
        </p>
      </section>

      <section>
        <h2>Changes and termination</h2>
        <p>
          These terms may change; material changes will be reflected in the date above. You may close
          your account at any time. We may suspend an account that breaches the acceptable-use
          section.
        </p>
      </section>

      <section>
        <h2>Contact</h2>
        <p>
          <a href={`mailto:${SITE_CONTACT_EMAIL}`}>{SITE_CONTACT_EMAIL}</a>
        </p>
      </section>
    </LegalShell>
  );
}

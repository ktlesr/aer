import type { Metadata } from "next";
import { LegalShell } from "@/components/legal-shell";
import { SITE_CONTACT_EMAIL, SITE_NAME, SITE_OPERATOR } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy",
  description: `What ${SITE_NAME} stores, why, and how to have it deleted.`,
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <LegalShell title="Privacy policy" updated="2026-09-05">
      <p>
        {SITE_NAME} is operated by <strong>{SITE_OPERATOR}</strong>. It records what AI agents did
        during a run so the record can later be audited. This page describes every category of data
        the service holds.
      </p>

      <section>
        <h2>Account data</h2>
        <p>
          When you create an account we store your <strong>email address</strong>, an optional{" "}
          <strong>name</strong>, and — if you sign up with a password — a{" "}
          <strong>bcrypt hash of that password</strong>. The password itself is never stored. If you
          sign in with Google we store the Google account identifier and the profile email and name
          Google returns; we do not receive or store your Google password.
        </p>
      </section>

      <section>
        <h2>Agent run data</h2>
        <p>
          The data your own agents send through the API: run metadata, event timestamps, event types
          and durations, and the redaction findings produced during a run.
        </p>
        <p>
          <strong>Sensitive values are redacted before storage.</strong> Where an agent handled a
          value we classify as sensitive, we store a SHA-256 hash of it and the location it was found
          in — never the original value. The same applies to API keys: only a hash is stored, and the
          key itself is shown once, at creation.
        </p>
      </section>

      <section>
        <h2>Who can see it</h2>
        <p>
          Every record is scoped to an organization and a project, resolved from your credentials on
          each request. You can only read data belonging to your own organization. We do not sell
          data, do not share it with third parties, and do not use it to train models.
        </p>
      </section>

      <section>
        <h2>Cookies</h2>
        <p>
          A single session cookie keeps you signed in. There is no advertising, analytics or
          third-party tracking on this site.
        </p>
      </section>

      <section>
        <h2>Retention and deletion</h2>
        <p>
          Run data is retained until you delete it or your retention window elapses. To delete your
          account and everything under it, email{" "}
          <a href={`mailto:${SITE_CONTACT_EMAIL}`}>{SITE_CONTACT_EMAIL}</a> from your account address.
        </p>
      </section>

      <section>
        <h2>Contact</h2>
        <p>
          Questions about this policy, or about data we hold:{" "}
          <a href={`mailto:${SITE_CONTACT_EMAIL}`}>{SITE_CONTACT_EMAIL}</a>.
        </p>
      </section>
    </LegalShell>
  );
}

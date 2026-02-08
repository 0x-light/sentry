export function TosPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-2xl px-6 py-12">
        <a
          href="/"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          ← Back to Sentry
        </a>

        <h1 className="text-2xl font-semibold mt-8 mb-6">Terms of Service</h1>
        <p className="text-sm text-muted-foreground mb-8">
          Last updated: February 8, 2026
        </p>

        <div className="space-y-6 text-sm leading-relaxed text-muted-foreground">
          <section>
            <h2 className="text-base font-medium text-foreground mb-2">1. Acceptance of Terms</h2>
            <p>
              By accessing or using Sentry ("the Service"), you agree to be bound by these Terms of
              Service. If you do not agree to these terms, you may not use the Service.
            </p>
          </section>

          <section>
            <h2 className="text-base font-medium text-foreground mb-2">2. Description of Service</h2>
            <p>
              Sentry provides market monitoring and signal detection tools for informational purposes
              only. The Service aggregates and analyzes publicly available data to generate alerts and
              insights. Nothing provided by the Service constitutes financial, investment, or trading
              advice.
            </p>
          </section>

          <section>
            <h2 className="text-base font-medium text-foreground mb-2">3. User Accounts</h2>
            <p>
              To access certain features, you may need to create an account. You are responsible for
              maintaining the confidentiality of your credentials and for all activity under your
              account. You agree to provide accurate information and to notify us immediately of any
              unauthorized use.
            </p>
          </section>

          <section>
            <h2 className="text-base font-medium text-foreground mb-2">4. Acceptable Use</h2>
            <p>You agree not to:</p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>Use the Service for any unlawful purpose</li>
              <li>Attempt to gain unauthorized access to the Service or its systems</li>
              <li>Interfere with or disrupt the integrity or performance of the Service</li>
              <li>Reverse engineer, decompile, or disassemble any part of the Service</li>
              <li>Resell, redistribute, or sublicense access to the Service without permission</li>
              <li>Use automated means to scrape or extract data beyond normal usage</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-medium text-foreground mb-2">5. Intellectual Property</h2>
            <p>
              All content, features, and functionality of the Service — including text, graphics,
              logos, and software — are owned by Sentry and protected by applicable intellectual
              property laws. You may not copy, modify, or distribute any part of the Service without
              prior written consent.
            </p>
          </section>

          <section>
            <h2 className="text-base font-medium text-foreground mb-2">6. Subscriptions &amp; Billing</h2>
            <p>
              Some features require a paid subscription. By subscribing, you authorize us to charge
              your payment method on a recurring basis. You may cancel at any time; cancellation takes
              effect at the end of the current billing period. Refunds are issued at our discretion.
            </p>
          </section>

          <section>
            <h2 className="text-base font-medium text-foreground mb-2">7. Disclaimer of Warranties</h2>
            <p>
              The Service is provided "as is" and "as available" without warranties of any kind,
              whether express or implied. We do not guarantee the accuracy, completeness, or
              timeliness of any information provided through the Service. Use of the Service is at
              your own risk.
            </p>
          </section>

          <section>
            <h2 className="text-base font-medium text-foreground mb-2">8. Limitation of Liability</h2>
            <p>
              To the fullest extent permitted by law, Sentry and its affiliates shall not be liable
              for any indirect, incidental, special, consequential, or punitive damages, including
              loss of profits, data, or goodwill, arising from your use of the Service. Our total
              liability shall not exceed the amount you paid us in the 12 months preceding the claim.
            </p>
          </section>

          <section>
            <h2 className="text-base font-medium text-foreground mb-2">9. Privacy</h2>
            <p>
              Your use of the Service is also governed by our privacy practices. We collect only the
              information necessary to provide and improve the Service. We do not sell your personal
              data to third parties.
            </p>
          </section>

          <section>
            <h2 className="text-base font-medium text-foreground mb-2">10. Termination</h2>
            <p>
              We reserve the right to suspend or terminate your access at any time, with or without
              cause or notice. Upon termination, your right to use the Service ceases immediately.
              Provisions that by their nature should survive termination will remain in effect.
            </p>
          </section>

          <section>
            <h2 className="text-base font-medium text-foreground mb-2">11. Changes to Terms</h2>
            <p>
              We may update these Terms from time to time. Continued use of the Service after changes
              are posted constitutes acceptance of the revised Terms. We encourage you to review this
              page periodically.
            </p>
          </section>

          <section>
            <h2 className="text-base font-medium text-foreground mb-2">12. Contact</h2>
            <p>
              If you have questions about these Terms, you can reach us at the contact information
              provided on our website.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}

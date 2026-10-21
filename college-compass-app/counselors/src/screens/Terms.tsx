/** Counselor terms — plain-English draft; a lawyer must review before launch. */
import { OPERATOR, PRICE_MONTHLY, PRICE_YEARLY, REVIEW_SLA, SUPPORT_EMAIL } from "../constants";

export const TERMS_VERSION = "Draft · October 21, 2026";

export function Terms() {
  return (
    <article className="cp-narrow cp-prose py-12">
      <p className="cc-pill bg-warn/15 text-warn" style={{ background: "color-mix(in srgb, var(--warn) 14%, transparent)" }}>
        Draft — have a lawyer review before launch
      </p>
      <h1 className="cp-h2 mt-3">Counselor listing terms</h1>
      <p className="text-subhead text-text-muted">{TERMS_VERSION}</p>
      <p>These terms are between you (the counselor or practice creating a listing) and {OPERATOR}, the operator of College Compass (“we”). By creating or submitting a listing you agree to them.</p>

      <h2>1. What a listing is</h2>
      <p>College Compass is an iPhone app that helps high-school students and their parents build a college list. The “Get expert help” directory shows paid listings from independent counselors. A listing is advertising: it does not make you our employee, partner or agent, and we do not refer, match, vet or endorse counselors beyond the review described below.</p>

      <h2>2. Who can list</h2>
      <ul>
        <li>You are 18 or older and offer college admissions counseling or educational consulting to families in the United States.</li>
        <li>You provide services as an independent professional or business, and you have the right to list the credentials, memberships and experience you describe.</li>
        <li>We may decline or remove any listing at our discretion, including before approval.</li>
      </ul>

      <h2>3. Accurate information</h2>
      <p>Everything on your listing must be true, current and yours: your name, title, photo, credentials, memberships, experience, specialties, the states you serve and your contact details. Keep it up to date. Do not claim or imply admission outcomes, special access to colleges, or results you cannot promise.</p>

      <h2>4. No guarantees</h2>
      <p>You must not guarantee or imply guaranteed admission, scholarships or financial-aid outcomes in your listing or in your dealings with families who find you through the app. We make no guarantee about how many families will see or contact you.</p>

      <h2>5. Working with minors</h2>
      <p>Most app users are under 18. The app has no messaging; families contact you through your website, phone or email. When a minor contacts you, involve a parent or guardian promptly and keep a parent present or informed in your work with the student. You are responsible for complying with all laws that apply to working with minors, including background-check and mandatory-reporting rules in your state. Do not contact students through, or on the basis of, the app other than replying to a family who reached out to you.</p>

      <h2>6. Professional conduct</h2>
      <p>Treat families respectfully and honestly, protect their personal information, and follow the ethical standards of your profession (for example NACAC, IECA or HECA principles). Listings may not be used for anything other than college counseling and closely related services.</p>

      <h2>7. Review and changes</h2>
      <p>We review every new listing and every later change before it is shown, normally within {REVIEW_SLA}. While a change is under review your previously approved listing stays live. We may ask for proof of credentials.</p>

      <h2>8. Fees and cancellation</h2>
      <ul>
        <li>Listing fees are ${PRICE_MONTHLY} per month or ${PRICE_YEARLY} per year, billed in advance by Stripe. Prices may change with at least 30 days' notice by email; a change applies from your next renewal.</li>
        <li>Founding listings are free for the period shown in your billing page. We'll email you before that period ends.</li>
        <li>You can cancel at any time from the billing page. Your listing stays visible until the end of the period you have paid for, and is then hidden. Fees already paid are not refunded, except where the law requires.</li>
        <li>If a payment fails, your listing may be hidden after a short grace period until payment is made.</li>
      </ul>

      <h2>9. Reports, suspension and removal</h2>
      <p>Families can report a listing from the app. We may hide, suspend or remove a listing at any time if we receive credible reports, if a listing breaks these terms or the law, or if it could harm users or the app's reputation. We'll normally tell you why by email. Removal for a violation does not entitle you to a refund.</p>

      <h2>10. Your content and our use of it</h2>
      <p>You keep ownership of the text and photo you provide and grant us a non-exclusive licence to show them in College Compass, on the counselor website and in material that describes the directory, for as long as you are listed. You confirm you have the right to use the photo and any marks you include.</p>

      <h2>11. Privacy</h2>
      <p>We store the information you enter, your account email and Stripe billing identifiers. We never share student data with counselors, and the app sends no information about a student when it shows the directory. See the <a href="../privacy.html">privacy policy</a>.</p>

      <h2>12. Liability</h2>
      <p>The directory is provided “as is”. To the fullest extent allowed by law, {OPERATOR} is not liable for indirect or consequential losses, lost business, or disputes between you and families, and our total liability for anything connected to your listing is limited to the fees you paid us in the twelve months before the claim.</p>

      <h2>13. Changes to these terms</h2>
      <p>We may update these terms. We'll post the new version here and email you at least 30 days before material changes take effect. Keeping your listing after that date means you accept them.</p>

      <h2>14. Contact</h2>
      <p>
        {OPERATOR} · <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
      </p>
    </article>
  );
}

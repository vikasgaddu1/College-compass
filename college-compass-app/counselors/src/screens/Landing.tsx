/** Public landing page for counselors — the link outreach points to. */
import { CounselorCard } from "@/components/CounselorCard";
import { toCounselor } from "@/data/counselors";
import { APP_NAME, FOUNDING_COUNT, PRICE_MONTHLY, PRICE_YEARLY, REVIEW_SLA } from "../constants";
import { go } from "../router";

/** A made-up counselor for the preview (not a real person). */
export const SAMPLE_COUNSELOR = toCounselor({
  id: "sample",
  name: "Jordan Avery",
  title: "Independent college counselor",
  city: "Raleigh",
  states: ["NC", "VA"],
  specialties: ["stem", "essays", "financial_aid"],
  modes: ["virtual", "in_person"],
  credentials: "M.Ed. · IECA professional member · 12 years in admissions",
  bio: "I help students find colleges where they'll thrive — and tell their story in a way admissions readers remember. Families get a clear plan, honest odds, and calm through senior year.",
  website: "https://example.com",
  phone: "(919) 555-0100",
  email: "hello@example.com",
})!;

export function PhonePreview({ children }: { children: React.ReactNode }) {
  return (
    <div className="cp-phone" aria-label="Preview of the listing in the iPhone app">
      <div className="cp-phone-screen">
        <div className="cp-phone-notch" aria-hidden />
        <p className="mb-1 text-footnote font-semibold text-accent">‹ Back</p>
        <h3 className="text-title2">Get expert help</h3>
        <p className="mb-3 mt-1 text-caption text-text-muted">Independent counselors who help families with applications. Counselors pay to be listed — listings never affect your college list.</p>
        {children}
      </div>
    </div>
  );
}

export function Landing() {
  const pricing = () => document.getElementById("pricing")?.scrollIntoView({ behavior: "smooth", block: "start" });
  return (
    <div>
      <section className="cp-hero">
        <h1 className="cp-h1">Be the counselor families find</h1>
        <p className="cp-lede">
          {APP_NAME} is a free iPhone app that helps high-school students and parents build a balanced college list. When they want expert help, they find you.
        </p>
        <div className="mx-auto mt-8 flex max-w-md flex-col gap-2 sm:flex-row sm:justify-center">
          <button type="button" className="cc-btn cc-btn-primary cc-press whitespace-nowrap sm:w-auto" onClick={() => go("/signin")}>
            Get your free founding listing
          </button>
          <button type="button" className="cc-btn cc-btn-quiet cc-press whitespace-nowrap sm:w-auto" onClick={pricing}>
            See pricing
          </button>
        </div>
        <p className="mt-3 text-footnote text-text-muted">No card needed to start. Reviewed by a person within {REVIEW_SLA}.</p>
      </section>

      <section className="cp-section" aria-labelledby="how">
        <h2 id="how" className="cp-h2 text-center">How it works</h2>
        <div className="cp-grid cp-grid-3 mt-6">
          {[
            ["Create your profile", "Photo, bio, credentials, the states you serve and how to reach you. Takes about ten minutes."],
            ["We review it", `A person checks every listing within ${REVIEW_SLA} and lets you know by email.`],
            ["Families find you", "Students and parents in the states you serve see your card under “Get expert help” and contact you directly."],
          ].map(([t, d], i) => (
            <div key={t} className="cc-card p-5">
              <span className="cp-step-n">{i + 1}</span>
              <h3 className="mt-3 text-headline">{t}</h3>
              <p className="mt-1 text-subhead text-text-muted">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="cp-section" aria-labelledby="look">
        <div className="cp-grid cp-grid-2 items-center">
          <div>
            <h2 id="look" className="cp-h2">What your listing looks like</h2>
            <p className="text-body text-text-muted">This is the real card families see in the app, with a sample counselor. Every listing carries a “Paid listing” label so families know how the directory works, and three ways to reach you: your website, a call or an email — contact happens directly between you and the family.</p>
            <ul className="mt-4 space-y-2 text-subhead">
              <li>• Shown to families in the states you choose, or nationwide for virtual practices</li>
              <li>• Filtered by specialty: STEM, arts, essays, financial aid, athletics and more</li>
              <li>• Order rotates daily, so no one is always first</li>
              <li>• Edit any time — changes go live after a quick re-review while your current listing stays up</li>
            </ul>
          </div>
          <PhonePreview>
            <CounselorCard counselor={SAMPLE_COUNSELOR} preview />
          </PhonePreview>
        </div>
      </section>

      <section className="cp-section" id="pricing" aria-labelledby="pricing-h">
        <h2 id="pricing-h" className="cp-h2 text-center">Founding offer</h2>
        <div className="cc-card mx-auto mt-6 max-w-2xl p-6 text-center" style={{ borderColor: "var(--accent)" }}>
          <span className="cc-pill bg-accent-soft text-accent">Limited to our first {FOUNDING_COUNT} counselors</span>
          <p className="mt-3 text-title3">Free founding listing for our first {FOUNDING_COUNT} counselors</p>
          <p className="mt-2 text-body text-text-muted">Free until 3 months after the public App Store launch. No card needed to start — we'll email you well before anything changes.</p>
          <div className="mt-5">
            <button type="button" className="cc-btn cc-btn-primary cc-press sm:w-auto" onClick={() => go("/signin")}>
              Claim a founding listing
            </button>
          </div>
        </div>
        <p className="mt-8 text-center text-subhead text-text-muted">After the founding period, listings are simple and flat:</p>
        <div className="cp-grid cp-grid-2 mx-auto mt-4 max-w-2xl">
          <div className="cc-card p-5">
            <div className="cp-price">
              ${PRICE_MONTHLY}
              <small> / month</small>
            </div>
            <p className="mt-2 text-subhead text-text-muted">Cancel anytime. Your listing stays up until the end of the month you paid for.</p>
          </div>
          <div className="cc-card p-5">
            <div className="cp-price">
              ${PRICE_YEARLY}
              <small> / year</small>
            </div>
            <p className="mt-2 text-subhead text-text-muted">Two months free compared with monthly. Cancel anytime; listed through the end of the year you paid for.</p>
          </div>
        </div>
        <p className="mt-4 text-center text-footnote text-text-muted">No commissions, no lead fees, no contracts. One flat listing fee, billed by Stripe.</p>
      </section>

      <section className="cp-section" aria-labelledby="trust">
        <h2 id="trust" className="cp-h2 text-center">What we stand for</h2>
        <div className="cp-grid cp-grid-2 mt-6">
          {[
            ["Student data stays with the family", "We never sell or share student data. The app keeps a student's answers on their phone, and nothing about a student is sent to counselors — ever."],
            ["Listings never touch recommendations", "A student's college list comes from their own answers and research. Paying for a listing never changes what the app suggests."],
            ["Families contact you directly", "Your website, phone and email are on the card. There's no middleman, no messaging inbox, and no commission on your services."],
            ["Every counselor is reviewed", "A person reads every profile and every change before it goes live, and families can report a listing from the app."],
          ].map(([t, d]) => (
            <div key={t} className="cc-card p-5">
              <h3 className="text-headline">{t}</h3>
              <p className="mt-1 text-subhead text-text-muted">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="cp-section cp-faq" aria-labelledby="faq">
        <h2 id="faq" className="cp-h2 text-center">Questions</h2>
        <div className="cp-narrow mt-6">
          {[
            ["Who can list?", "Independent educational consultants and college counselors who work with families in the United States. School-based counselors are welcome to list a private practice."],
            ["Do I need to be in a professional association?", "No. Membership isn't required, though credentials and memberships (IECA, HECA, NACAC, a counseling degree or certificate) help families trust your listing — add them to the credentials line."],
            ["How do families contact me?", "From your card: Visit website, Call or Email. Contact goes straight from the family to you; the app has no messaging and never sends you a family's data."],
            ["Can I list in several states, or virtually?", "Yes. Choose every state you serve, or “Nationwide (virtual)” to appear for families anywhere. Mark whether you meet virtually, in person or both."],
            ["What happens if I cancel?", "Your listing stays live until the end of the period you've paid for, then it's hidden. Your profile is kept so you can come back later."],
            ["Is my information public?", "Only what you put on your listing: your name, title, photo, bio, credentials, states, specialties and the contact details you choose to show. Your account email and billing details are never shown."],
            ["Are you affiliated with colleges or the Common App?", "No. Tierwise is an independent research aid, and listed counselors are independent professionals who are not affiliated with any college or university, the College Board, ACT or the Common Application. The app says so to families, and listings must not suggest otherwise."],
          ].map(([q, a]) => (
            <details key={q}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="py-10 text-center">
        <h2 className="cp-h2">Ready when you are</h2>
        <p className="text-body text-text-muted">Create your profile in about ten minutes.</p>
        <div className="mt-5">
          <button type="button" className="cc-btn cc-btn-primary cc-press sm:w-auto" onClick={() => go("/signin")}>
            Get your free founding listing
          </button>
        </div>
      </section>
    </div>
  );
}

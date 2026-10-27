# College Compass — App Store owner checklist

Everything the owner (Vikas / Gaddu LLC) must do to get **College Compass** from this repo into TestFlight and the App Store. Engineering work is done in the repo; the steps below need an Apple account, a Mac (optional) and your judgment.

- Bundle ID: `com.gaddu.collegecompass` · Display name: **College Compass** · Version `1.0.0` (build number = GitHub run number in CI) · iOS 15+ · iPhone + iPad
- Stack: Capacitor 6 wrapping the same Vite/React build as the web app (`npm run build:ios` uses relative asset paths; the web build is unchanged)
- ChatGPT sign-in: OpenAI's **self-serve path for open-source, locally run apps** (no client ID or approval needed). The app runs a loopback listener on `127.0.0.1` for the sign-in redirect; see [CHATGPT_SIGNIN.md](./CHATGPT_SIGNIN.md)
- Custom URL scheme: `collegecompass://` (return path for the partner client-ID flow and the "Return to College Compass" button on the sign-in page)
- CocoaPods is used for native dependencies (Capacitor 6 has no Swift Package Manager mode; SPM arrived in Capacitor 7). GitHub's macOS runners and any Mac with Xcode can run it.

---

## 0. What exists in the repo vs. what still needs you

| Done in the repo | Needs the owner |
| --- | --- |
| Xcode project `ios/App/App.xcodeproj` (+ workspace, Podfile), Info.plist, URL scheme, privacy manifest | Apple Developer Program membership, App ID, App Store Connect record |
| App icon (1024 px, opaque) + adaptive launch screen | Signing certificate + provisioning profile (or Xcode automatic signing on a Mac) |
| `src/platform` native seam (in-app browser sign-in, loopback listener plugin, deep link, CapacitorHttp) | Nothing for sign-in in the iOS app (self-serve path, see section 9); a partner client ID only for the web build |
| CI: simulator compile check on every push; manual TestFlight job | GitHub secrets, App Store metadata, screenshots, review submission |

The iOS project was generated on Linux. It has **never been opened in Xcode or built by a human**: the first CI run (or your first build on a Mac) is the real compile check. `pod install` and `xcodebuild` could not run on Linux, so `ios/App/Podfile.lock` and `ios/App/Pods/` do not exist yet. CI creates them each run; commit `Podfile.lock` after your first Mac build for reproducible pods.

---

## 1. Apple Developer Program enrollment

1. Enroll at <https://developer.apple.com/programs/enroll/>. You can enroll as an **individual** or as an **organization** (Gaddu LLC). An organization needs a D-U-N-S number, a legal-entity check and a website; allow days to weeks. Individual enrollment is faster but the seller name shown on the App Store will be your personal name.
2. Decide the seller name now: it is public and hard to change.
3. Fee: USD 99 per year. Turn on two-factor authentication for the Apple ID.
4. Accept the **Paid Applications / Free Apps agreement** in App Store Connect (Business). A free app only needs the Free Apps agreement.

## 2. Create the App ID and the App Store Connect record

1. <https://developer.apple.com/account> → Certificates, Identifiers & Profiles → **Identifiers** → `+` → App IDs → App → Description `College Compass`, Bundle ID **Explicit** `com.gaddu.collegecompass`. No capabilities are needed (no push, no Sign in with Apple, no associated domains). App Attest (below) needs no capability either.
2. <https://appstoreconnect.apple.com> → Apps → `+` → New App:
   - Platforms: iOS · Name: `College Compass` (must be unique store-wide; if taken use e.g. `College Compass: Find Your Fit`, 30 chars max) · Primary language: English (U.S.)
   - Bundle ID: `com.gaddu.collegecompass` · SKU: `college-compass-ios` · User access: Full Access
3. The record must exist **before** the first upload, or the upload is rejected.

## 3. Signing: two ways

### A. On a Mac (simplest for the first build)

```bash
cd college-compass-app
npm ci
npm run cap:sync        # tsc + vite build (relative base) + cap sync ios + pod install
npx cap open ios
```

In Xcode: target **App** → Signing & Capabilities → tick *Automatically manage signing* → choose your Team. Product → Archive → Distribute App → App Store Connect → Upload. Commit `ios/App/Podfile.lock` afterwards.

### B. From CI, cloud-managed signing (recommended: no Mac, no certificate files)

You only need an **App Store Connect API key with the Admin role** and your **Team ID**. The workflow runs Xcode with `-allowProvisioningUpdates` and the key, so Xcode creates/uses a cloud-managed distribution certificate and the App Store profile in your account, then uploads the build straight to App Store Connect.

**API key** — App Store Connect → Users and Access → Integrations → App Store Connect API → Team Keys → `+`, name `College Compass CI`, access **Admin** (cloud signing needs Admin). Note the *Key ID* and the *Issuer ID* (shown above the key list); download the `.p8` once (it cannot be downloaded again).

**Team ID** — developer.apple.com → Account → Membership details → *Team ID* (10 characters). Save it as the repository **variable** `APPLE_TEAM_ID` (not secret).

### C. From CI with your own certificate (only if you don't want an Admin key)

You need an **Apple Distribution certificate** (exported as `.p12`), an **App Store provisioning profile**, and an **App Store Connect API key** (App Manager is enough here).

**Distribution certificate without a Mac** (OpenSSL):

```bash
openssl req -new -newkey rsa:2048 -nodes -keyout dist.key -out dist.csr \
  -subj "/CN=Gaddu LLC/emailAddress=you@example.com"
# developer.apple.com → Certificates → + → "Apple Distribution" → upload dist.csr → download distribution.cer
openssl x509 -inform DER -in distribution.cer -out dist.pem
# -legacy keeps the .p12 importable by macOS `security import` when using OpenSSL 3
openssl pkcs12 -export -legacy -inkey dist.key -in dist.pem -out dist.p12 -password pass:CHOOSE_A_PASSWORD
base64 -w0 dist.p12 > dist.p12.b64     # macOS: base64 -i dist.p12 -o dist.p12.b64
```

(On a Mac you can instead create the CSR in Keychain Access, then export the certificate + key as `.p12`.) Keep `dist.key` and `dist.p12` private; an organization can have only a few distribution certificates.

**Provisioning profile** — Profiles → `+` → *App Store Connect* (distribution) → App ID `com.gaddu.collegecompass` → select the certificate above → name it e.g. `College Compass App Store` → download `.mobileprovision` → `base64 -w0 College_Compass_App_Store.mobileprovision`.

The workflow reads the team ID and profile name from the profile itself and fails early if the profile is for a different bundle ID.

## 4. GitHub secrets (Settings → Secrets and variables → Actions)

| Secret | Value |
| --- | --- |
| `APP_STORE_CONNECT_KEY_ID` | Key ID of the API key |
| `APP_STORE_CONNECT_ISSUER_ID` | Issuer ID (UUID at top of the API keys page) |
| `APP_STORE_CONNECT_KEY_P8` | Full contents of the `.p8` file (or its base64) |
| `IOS_DIST_CERT_P12_BASE64` | option C only: base64 of `dist.p12` |
| `IOS_DIST_CERT_PASSWORD` | option C only: the `.p12` password |
| `IOS_PROVISION_PROFILE_BASE64` | option C only: base64 of the `.mobileprovision` |

Repository **variable** `APPLE_TEAM_ID` — your 10-character Team ID (option B). If the three option-C secrets are all set, the workflow uses them instead.
| `VITE_CC_CHATGPT_CLIENT_ID` | **Leave empty for the iOS build**: the native app then uses OpenAI's self-serve sign-in path (section 9). Set it only if OpenAI issues a partner client ID you want the iOS app to use instead. |

Optional repository **variable** (not secret): `VITE_CC_TOKEN_RELAY` — URL of the stateless token relay, only if OpenAI's token endpoint blocks browser CORS (see CHATGPT_SIGNIN.md). Native builds do not need it (CapacitorHttp has no CORS limits).

The web deploy workflow (`deploy.yml`) builds the web app separately; give it the same `VITE_CC_CHATGPT_CLIENT_ID` if the web version should support sign-in.

## 5. Run the build and TestFlight

Workflow: `.github/workflows/ios.yml`.

- **Every push** to `app-v2` or `main` that touches `college-compass-app/**`: macOS runner, Xcode 16, Node 20, `npm ci`, `npm test`, `npm run cap:sync`, then an unsigned simulator build with `xcodebuild -workspace ios/App/App.xcworkspace -scheme App -sdk iphonesimulator -configuration Debug -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build`. The simulator `.app` is attached to the run (7 days).
- **TestFlight upload**: Actions → *iOS app (Capacitor)* → Run workflow → tick **upload** (Xcode defaults to `latest-stable`, see below). With option B the `testflight` job archives with automatic, cloud-managed signing and exports with `destination: upload`, which uploads to App Store Connect. With option C it imports the certificate into a temporary keychain, installs the profile, archives with manual signing (App target only), exports the IPA and uploads it with `xcrun altool`. The key and any keychain are wiped afterwards. If something required is missing, the job logs which items and skips signing/upload.
- The build number is `github.run_number`, so every upload is unique and increasing. Bump `MARKETING_VERSION` (currently `1.0.0`, in the Xcode project) for each store release.
- After upload, App Store Connect processes the build (usually 5-30 minutes) and emails you. Then: TestFlight → the build → add **Internal Testing** testers (App Store Connect users, no review). **External** testers need a short Beta App Review. Export compliance is pre-answered by `ITSAppUsesNonExemptEncryption = false` (the app only uses HTTPS/standard OS encryption, which is exempt).
- **Xcode / SDK requirement.** Apple raises the minimum SDK for uploads every spring (iOS 18 SDK / Xcode 16 from April 2025; Xcode 26 / iOS 26 SDK was announced for April 2026). Check <https://developer.apple.com/news/upcoming-requirements/>. That is why the compile job pins Xcode 16 (as specified) while the TestFlight job takes an `xcode_version` input defaulting to `latest-stable`. Capacitor 6.2 was written for Xcode 15/16; if a newer Xcode breaks the build, upgrade Capacitor (7+ adds SPM and newer Xcode support; the platform seam in `src/platform` does not change).

### App Attest: nothing to enable for TestFlight / App Store builds

The app uses Apple App Attest (`ios/App/App/AppAttestPlugin.swift`) to protect the shared college database. **No portal step is needed and the TestFlight upload is unaffected:**

- Apple: *"After distributing your app through TestFlight, the App Store, or the Apple Developer Enterprise Program, your app ignores the entitlement you set and uses the production environment."* Without the entitlement, apps run from Xcode use the App Attest *sandbox*. So release builds need no `com.apple.developer.devicecheck.appattest-environment` entitlement, and the App ID needs no "App Attest" capability.
- Therefore the default build carries **no entitlements file**. `CODE_SIGN_ENTITLEMENTS` is `$(CC_APP_ATTEST_ENTITLEMENTS)`, empty unless you set it. This matters for the CI: the archive is built unsigned (`CODE_SIGNING_ALLOWED=NO`) and signed at export by cloud-managed signing. The signed app's entitlements must be in its provisioning profile (otherwise: "Provisioning profile … doesn't include the … entitlement"), and whether `-allowProvisioningUpdates` with an API key would switch on the App Attest capability on the App ID by itself — and whether an unsigned archive even carries the entitlement to the export step — is not documented. Leaving it out removes that risk entirely and costs nothing.
- The CI simulator smoke test logs `appattest_supported=false` (the Simulator has no App Attest) — informational only.
- Before TestFlight users can attest, the database migration and the `attest` Edge Function must be deployed (Actions → *Shared college data (Supabase)*: jobs **migrate** and **functions**). Until then, contributions are simply sent unattested.

**Optional — only to test the *production* App Attest environment from a build you run from Xcode:**
1. <https://developer.apple.com/account> → Certificates, Identifiers & Profiles → **Identifiers** → `com.gaddu.collegecompass` → **Capabilities** tab → tick **App Attest** → **Save** → confirm (existing profiles become invalid; automatic signing regenerates them).
2. Build with the setting `CC_APP_ATTEST_ENTITLEMENTS=App/AppAttest.entitlements` (Xcode: target App → Build Settings → `+` → Add User-Defined Setting, or on the `xcodebuild` command line). That file sets the environment to `production`.

Without step 2, Xcode builds attest in the sandbox; the server refuses sandbox keys unless `attest_allow_development` is on (`docs/SHARED_DATA.md`), and the app then just contributes unattested. Don't add the setting to the TestFlight job — it isn't needed there.

## 6. App Store listing draft

| Field | Value | Limit |
| --- | --- | --- |
| Name | College Compass | 30 |
| Subtitle | AI college search & odds bands | 30 (exactly 30) |
| Promotional text | Build a balanced college list with honest odds bands, net-price estimates and sources. Your data stays on your phone. | 170 |
| Keywords | college search,college list,admissions,odds,net price,financial aid,SAT,ACT,GPA,reach,safety | 100 (92 used) |
| Category | Primary: **Education** · Secondary (optional): Reference | |
| Price | Free (no in-app purchases) | |
| Support URL | https://vikasgaddu1.github.io/College-compass/app/support.html | required |
| Privacy Policy URL | https://vikasgaddu1.github.io/College-compass/app/privacy.html | required |
| Marketing URL | (optional) https://vikasgaddu1.github.io/College-compass/ | |
| Copyright | `2026 Gaddu LLC` (or your personal name, matching the seller) | |

**The support and privacy pages must be live before you submit.** They are static files in `public/` of the web app; verify both URLs open in a browser. The privacy policy must say what section 7 says.

### Description (about 2,500 of 4,000 characters)

```text
College Compass helps high school students and their families build a smart, balanced college list without spending weeks in spreadsheets.

Tell the app about yourself in a few quick questions: your state, GPA, test scores (or none), the rigor of your courses, activities, intended majors or interests, budget, and preferences for region, size and setting. Any interest works, from engineering and nursing to business, art, education or "still deciding."

Then College Compass researches colleges for you using your own ChatGPT account. Several AI research agents work in parallel, so cards appear as each college finishes. You can also name colleges you already like and the app will research those first.

WHAT YOU GET
- A balanced list: high reach, reach, target, likely and safety schools
- Honest admission-odds BANDS, not false promises, with a plain-language "why" behind every band
- Estimated net price based on your family's income band, plus scholarships the research found
- Fit scores weighted by what matters to you: academics, affordability, outcomes, location and odds
- A detail page for every college: your numbers next to theirs, plans and deadlines (ED, EA, RD), programs for your majors, costs, outcomes and tappable sources
- Data year and a confidence badge on every college, so you know how much to trust it
- A shortlist with your own notes
- Ask: chat with ChatGPT about your list and get help comparing schools

BUILT FOR HONESTY
Admission odds are estimates computed on your device from published figures such as Common Data Set data, plus documented heuristics. They are not predictions or guarantees. The app shows its sources, flags uncertain data and says "unknown" instead of guessing. Always confirm deadlines, costs and requirements on each college's official website.

PRIVATE BY DESIGN
There is no College Compass account and no developer server. Your profile, research, shortlist and notes stay on your device. You can export or delete everything in Settings at any time. AI requests go directly from your phone to OpenAI under your own ChatGPT account; the app's developer never sees them.

WHAT YOU NEED
A ChatGPT Plus or Pro account is required for the AI research, which is the heart of the app. College Compass uses your plan's usage allowance, so no extra subscription is sold in the app. (A free ChatGPT account can sign in, but research needs a paid plan.)

College Compass is an independent app. It is not affiliated with, endorsed by or sponsored by OpenAI or any college or university listed.
```

Notes on the copy: it says "estimates", names the ChatGPT requirement up front, and carries the non-affiliation line. Do not add rankings, "guaranteed" or "get into your dream school" claims; they conflict with the app's honesty rules and with App Review guideline 2.3.

### Screenshots (required)

Take these from the simulator or a device with sample data (use demo mode so no real student data appears).

- iPhone 6.9" (1320 x 2868) — required. 6.5" is optional if 6.9" is supplied.
- iPad 13" (2064 x 2752) — required because the app runs on iPad. If you would rather skip iPad, set `TARGETED_DEVICE_FAMILY = 1` in the Xcode project (iPhone only) before the first submission.
- Suggested shots: welcome, a questions screen, research progress, "Your list" with odds bands, a college detail page, the Ask chat, Settings (export/delete).
- App icon: `docs/app-store/icon-1024.png` (1024 x 1024, opaque, no alpha), same file as the one in the Xcode asset catalog. Regenerate with `python3 ios/tools/make_icons.py`.

### Age rating

Answer Apple's questionnaire honestly in App Store Connect (App Information → Age Rating). Guidance for the current answers:

- Violence, sexual content, profanity, gambling, horror, drugs/alcohol, contests: **None**.
- Unrestricted web access: **No** (the sign-in page opens in an in-app browser limited to the OpenAI login flow; links to college sources open in the browser when tapped).
- The Ask feature is an AI chat (ChatGPT) and research results are AI-generated. Answer any question about AI/chatbot or generated content truthfully (Yes) and see what rating Apple computes. Expect a low rating (about 4+ to 12+); the intended audience is high-school students and their parents, so do **not** choose the Kids Category.
- ChatGPT itself requires users to be at least 13 (with parental permission under 18). Say so on the support page. Owner decision: whether to state a minimum age of 13 in the description.

## 7. App Privacy ("nutrition label") answers

App Store Connect → App Privacy. Facts to answer from:

- The developer operates **no server and no account system**. Profile, research results, shortlist, notes and tokens are stored on the device only. Export/delete are in Settings.
- AI requests (the student's answers, the college list) go **directly from the phone to OpenAI** (`api.openai.com`, `auth.openai.com`) under the **student's own ChatGPT account**. The developer never receives, relays or stores them. (The optional token relay, if ever deployed, is stateless and forwards token requests only.)
- No analytics, no advertising SDKs, no tracking, no third-party SDKs that collect data.
- **Shared college database (Supabase, developer-operated).** The app looks up college names there, and — when "Share research to help other students" is on (default) — sends researched **college facts** (admit rates, costs, deadlines, programs, sources) to it. Nothing about the student is sent. A random per-install ID (stored server-side only as a salted hash) and a salted hash of the network address (kept up to two days, for rate limiting) are processed. See `docs/SHARED_DATA.md`.

- **Apple App Attest** (iPhone app only, `docs/SHARED_DATA.md` → "Security: Apple App Attest"). When sharing research, the app proves the contribution comes from the genuine app: it creates a key in the device's Secure Enclave that only this app can use, has Apple attest it once, and signs each contribution with it. The server receives the key's public key and identifier (a hash of that public key), Apple's attestation certificates and receipt, and a signature per contribution. None of it identifies the student or the device (App Attest exposes no device identifier; a reinstall makes a new key). **This changes no App Privacy answer** — it is part of the same college-facts contribution, not linked to the user, not used for tracking. If you took the conservative position on the install ID below, the same reasoning (and answer) covers the App Attest key.

Recommended answers (updated for the shared database):

1. *Do you or your third-party partners collect data from this app?* → **Yes.** Declare:
   - **Usage Data → Product Interaction** (which colleges were researched, as college facts) — *not linked to the user's identity*, *not used for tracking*, purpose **App Functionality**.
   - **Identifiers → Device ID**: *No* (the install ID is random, app-generated and stored only as a hash; Apple's "Device ID" means device-level identifiers such as the advertising identifier — still, if you prefer the conservative position, declare it as *not linked, not tracking, App Functionality*).
   - Everything else (contact info, health, financial info, location, user content about the student) → **not collected**.
   The previous answer ("Data Not Collected") no longer applies once sharing is on by default.
2. *Tracking* → **No** (no ATT prompt, `NSPrivacyTracking = false` in `ios/App/App/PrivacyInfo.xcprivacy`).

**Owner judgment call.** Apple's definition of "collect" is data transmitted off the device in a way that you or your partners can access. Direct traffic to the user's own OpenAI account is not accessible to you, which is the basis for "Data Not Collected". If you prefer the conservative position (and some reviewers are strict about third-party AI), declare **User Content → Other User Content** (and, if the profile questions include them, **Other Data Types**) as *collected by a third party (OpenAI)*, **not linked to identity by you**, **not used for tracking**, purpose **App Functionality**. Over-declaring is never rejected; under-declaring can be. Keep the privacy policy and the label consistent with each other.

The app also ships a privacy manifest (`PrivacyInfo.xcprivacy`) declaring product-interaction data (not linked, not tracking, App Functionality), no tracking, and the UserDefaults required-reason API (`CA92.1`, used by the on-device storage plugin).

## 8. App Review information and notes

Provide, under App Review Information:

- **Contact**: your name, phone, email.
- **Sign-in required**: Yes → provide a dedicated **reviewer ChatGPT Plus (or Pro) account** (see plan below). Sign-in works in the native app with any ChatGPT Plus/Pro account; no OpenAI approval or client ID is involved.
- **Notes** (paste and adjust):

```text
College Compass helps high school students build a balanced college list. The student answers a short questionnaire; the app then uses AI (the user's own ChatGPT account) to research colleges and computes admission-odds bands on-device.

HOW TO REVIEW WITHOUT A ChatGPT ACCOUNT: on the Welcome screen choose "Try the demo" (demo mode). It loads sample research data so every screen can be explored offline: the questions, the balanced list with odds bands, college details, shortlist and Settings. [Confirm this label matches the final UI before submitting.]

HOW TO REVIEW THE LIVE AI FLOW: tap "Continue with ChatGPT" and sign in with the reviewer account below (a ChatGPT Plus account; any ChatGPT Plus or Pro account works). Sign-in opens an in-app browser with OpenAI's login page. After login, OpenAI redirects to a sign-in listener that runs inside the app on the phone itself (127.0.0.1, OpenAI's sign-in method for open-source apps that run locally); the browser then closes and the app continues. Research then runs against that ChatGPT account's own usage allowance; the developer has no server in the loop. College Compass is free and open source: <public GitHub repo URL>.
Reviewer account: <email>  Password: <password>
(If a verification code is requested, please use the attached screen recording; the code goes to an inbox the developer monitors: <contact>.)

There is no College Compass account, no in-app purchase and no data collected by the developer. All profile and research data stays on the device and can be exported or deleted in Settings > Delete everything. Admission odds are estimates and are labelled as such.
```

**Reviewer-account plan (do before submitting):**

1. Create a **new** ChatGPT account used only for review, on **ChatGPT Plus** (or Pro): plan usage, which the research needs, isn't available on a free account. Disable anything that blocks a reviewer: avoid SMS 2FA; if OpenAI forces an email one-time code, use an inbox you actively monitor and say so in the notes.
2. Verify the whole flow on a clean TestFlight install with that account, then sign out and sign in again (the second sign-in reuses this device's issued client ID). If the app is killed while the login page is open, sign-in can't finish (the listener lived in the app); check that tapping "Continue with ChatGPT" again works.
3. Attach a **screen recording** of a full live run as a fallback; demo mode is the primary path if the account is unavailable.
4. Make sure the account has usage available on review days.
5. Rotate the password after approval.

Reviewers also test: sign-out, **Settings → Delete everything** (this satisfies the account/data-deletion expectation, since there is no first-party account), and the privacy-policy link.

## 9. Guideline notes (owner's judgment calls flagged)

- **2.1 App completeness / 2.3 accurate metadata.** Demo mode plus a working reviewer account (section 8) avoid the most common rejection: "could not sign in". Screenshots must show the real UI.
- **4.2 Minimum functionality (not a repackaged website).** The binary contains the whole app and works without a network for stored data (nothing is loaded from a remote URL: `capacitor.config.ts` has no `server.url`, and the service worker is disabled in the native app). Native integration in use: SFSafariViewController sign-in via `@capacitor/browser` with an in-app Network.framework loopback listener (`LoopbackAuthPlugin.swift`), custom URL scheme deep link and cold-start handling via `@capacitor/app`, native HTTP (`CapacitorHttp`), native launch screen and status-bar/safe-area handling, on-device odds/fit/ranking engine, on-device persistence with export/import/delete, light/dark mode. Haptics (`@capacitor/haptics`) is bundled and can be used by the UI for feedback; only list it in review notes if the UI actually calls it. Keep the in-app experience clearly app-like (tab bar, sheets, no browser chrome).
- **4.8 Login services.** Sign in with Apple is required for apps that use a third-party login to set up or authenticate the user's *primary account in the app*. College Compass has **no first-party account**; "Continue with ChatGPT" only connects the user's own existing third-party ChatGPT plan so the app can act as a client of that service (guideline 4.8 exempts apps that are a client for a specific third-party service where the user signs in to that third-party account directly to access their content). We therefore do not offer Sign in with Apple. **This is a judgment call.** If App Review disagrees, answer in the Resolution Center with the facts above first; the fallbacks are adding Sign in with Apple or another login that meets 4.8's privacy criteria (which would add little here since the app has no account to log into).
- **5.1.1 / 5.1.2 Privacy and third-party AI.** Apple's updated 5.1.2(i) (late 2025; re-read the current wording) expects an app to **clearly disclose where personal data is shared with third parties, including third-party AI, and to get explicit permission first**. The student's profile (state, GPA, scores, income band, interests) is sent to OpenAI to run the research. Strong recommendation for the UI owner: the first-run "You're using your ChatGPT plan" sheet should also state plainly that the answers are sent to OpenAI under the user's ChatGPT account, link to the privacy policy, and require an explicit "Agree and continue" before the first research request. Also link the privacy policy inside Settings.
- **5.2 Intellectual property.** Use "Continue with ChatGPT" wording per OpenAI's branding rules, do not use OpenAI logos beyond what their guidelines permit, keep the non-affiliation sentence. College names are used descriptively.
- **1.4 / 5.1.4 Minors.** The audience includes teenagers. No third-party ad networks, no tracking, no social features, no contact collection. The counselor directory is a paid listing of independent counselors, labelled "Paid listing" on every card, with no in-app messaging. Do not enable the Kids Category.
- **3.1.1 / 3.1.3 Payments and the counselor link.** Counselors pay for listings on the website (Stripe), never inside the app; the app shows no prices and no purchase flow. The Counselors tab has one informational link, "Are you a counselor? Learn about being listed", to the counselor website's landing page. **Release the app in the United States storefront only** (App Store Connect → Pricing and Availability): since the 2025 Epic v. Apple ruling, US apps may link to purchases outside the app, and Apple currently charges no commission on them; a court is setting what Apple may charge in future. Outside the US the link would breach anti-steering rules. If the rules change, remove the link (`COUNSELOR_INFO_URL` in `src/data/counselors.ts`, rendered in `src/screens/Counselors.tsx`).
- **Export compliance.** Already answered in `Info.plist` (`ITSAppUsesNonExemptEncryption = false`). If App Store Connect still asks, answer that the app uses only standard encryption (HTTPS) exempt under the relevant provisions.

### ChatGPT sign-in eligibility

The iOS app signs in through OpenAI's **self-serve path for open-source, locally run apps**: the first sign-in registers the install with `client_id=dynamic_agent_client`, OpenAI issues a per-device client ID (`oaiapp_…`), and the redirect goes to a loopback listener on `127.0.0.1` inside the app. No client ID, partner approval or secret is needed, so TestFlight builds can sign in today. Leave `VITE_CC_CHATGPT_CLIENT_ID` empty for the iOS build.

Eligibility caveat, stated factually: OpenAI documents this self-serve path for **open-source, locally run** apps. College Compass qualifies because it is free, its source is public on GitHub, and it runs entirely on the phone. A **paid** app or one whose AI calls run on a **remotely hosted** server would need OpenAI's partner interest form and a client ID instead. Keep the repository public and the app free while using this path.

Users need **ChatGPT Plus or Pro** for research (plan usage). Free accounts can sign in but research won't run. Do not submit for review until a TestFlight build has completed sign-in and a research run on a physical iPhone with the reviewer account. Details: [CHATGPT_SIGNIN.md](./CHATGPT_SIGNIN.md).

## 10. Pre-submission test pass (physical iPhone, TestFlight build)

- [ ] Cold install launches with the compass launch screen (light and dark appearance), no white flash
- [ ] Demo mode works fully offline
- [ ] "Continue with ChatGPT" opens the in-app browser; after login the browser closes by itself and the app continues
- [ ] Sign out, then sign in again (reuses this device's issued client ID; no second registration)
- [ ] Closing the in-app browser with Done shows "Sign-in was cancelled." and the button works again
- [ ] Cancelling/denying at OpenAI returns to the app with a friendly error
- [ ] Research runs, can be cancelled, resumed after backgrounding; token refresh after 1 hour
- [ ] Safe areas: notch/Dynamic Island, home indicator, keyboard; iPad portrait and landscape
- [ ] Settings → export, import, sign out, delete everything
- [ ] Airplane mode shows stored data and a clear message for AI actions
- [ ] Privacy policy and support pages open from inside the app
- [ ] App Attest (after the Supabase **migrate** + **functions** jobs ran): research one college with sharing on, then in the Supabase SQL editor `select attested, count(*) from public.contributions where created_at > now() - interval '1 hour' group by 1;` shows `attested = true`. If it shows only `false`, the app silently fell back — check the `attest` function's logs.

## 11. Submit

App Store Connect → the app → the 1.0 version: upload screenshots, description, keywords, URLs, select the processed build, fill App Privacy, Age Rating, Content Rights (you use third-party names descriptively; you have the right to the content you ship), Pricing (Free) and Availability (**United States only**, see section 9), add the review notes and reviewer account, choose manual or automatic release, then **Add for Review → Submit**. Typical review takes 1-2 days; reply to any Resolution Center message promptly with the facts in sections 7-9.

## Appendix: repo map for the native build

| Path | Purpose |
| --- | --- |
| `capacitor.config.ts` | appId, appName, `webDir: dist`, splash settings, no remote server URL |
| `ios/App/App.xcodeproj`, `ios/App/Podfile` | Xcode project (iOS 15.0, v1.0.0, build 1), CocoaPods plugins |
| `ios/App/App/Info.plist` | display name, `collegecompass` URL scheme, portrait (iPad: all), ATS (arbitrary loads off, `NSAllowsLocalNetworking` on for the 127.0.0.1 sign-in listener), encryption flag |
| `ios/App/App/LoopbackAuthPlugin.swift`, `ios/App/App/MainViewController.swift` | in-app Capacitor plugin: 127.0.0.1 loopback listener for ChatGPT sign-in; bridge view controller that registers it (Main.storyboard) |
| `ios/App/App/PrivacyInfo.xcprivacy` | app privacy manifest |
| `ios/App/App/AppAttestPlugin.swift`, `ios/App/App/AppAttest.entitlements` | Apple App Attest for shared-research contributions (`DCAppAttestService`); the entitlements file is opt-in only (see "App Attest" in section 5) |
| `ios/App/App/Assets.xcassets` | AppIcon (1024 single-size), LaunchLogo, LaunchBackground (light/dark) |
| `ios/App/App/Base.lproj/LaunchScreen.storyboard` | launch screen: centered mark on the app background colour |
| `ios/tools/make_icons.py` | regenerates the icon and launch logo (Pillow) |
| `src/platform/index.ts` | web/native seam: `isNative`, `openAuthUrl`, `onAuthRedirect`, `closeAuthBrowser`, `postForm`, `redirectUri`, `startLoopback`, `supportsSelfServeSignIn` |
| `.github/workflows/ios.yml` (repo root) | simulator compile check + manual TestFlight job |
| `package.json` scripts | `build:ios`, `cap:sync`, `cap:open` |

/**
 * The AI-assistance notice (wording approved by the owner — change it only with them).
 *
 * Shown in full once before the first research run (Settings → About Tierwise keeps it available),
 * in the PDF report and on the privacy page; the short line sits under AI-derived figures.
 * Pure constants, so the report builder and the native bundle can use them without React.
 */

export const APP_NAME = "Tierwise";

/** Heading of the full notice ("About Tierwise."). */
export const AI_NOTICE_TITLE = `About ${APP_NAME}`;

/** Body of the full notice; read after the title as "About Tierwise. Tierwise uses …". */
export const AI_NOTICE_FULL =
  `${APP_NAME} uses artificial intelligence and public data, including the U.S. Department of Education's College Scorecard, to help you research colleges. ` +
  "AI can make mistakes. Admission chances, costs, deadlines and program details are estimates that may be incomplete or out of date. " +
  "Always verify important information with each college's official sources before you make decisions. " +
  `${APP_NAME} is an independent research aid: it does not make or predict admission decisions, and it is not affiliated with or endorsed by any college or university, the College Board, ACT, or the Common Application.`;

/** Title and body as one plain-text paragraph (ICS, share text, plain exports). */
export const AI_NOTICE_PARAGRAPH = `${AI_NOTICE_TITLE}. ${AI_NOTICE_FULL}`;

/** One line under lists, odds and other AI-derived figures. */
export const AI_NOTICE_SHORT = "AI-assisted estimates — verify with each college. Not an admission decision.";

/** The chat tab's variant (answers, not estimates). */
export const AI_NOTICE_CHAT = "AI answers can be wrong — verify with each college.";

/** Counselor directory / portal: one sentence on the counselors' independence. */
export const COUNSELOR_INDEPENDENCE = "Counselors are independent professionals and are not affiliated with any college or university, the College Board, ACT, or the Common Application.";

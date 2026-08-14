/**
 * When an export may be followed by a full-screen ad.
 *
 * This is the rule, with no SDK and no React Native in it, so the part that has
 * to be right can be tested. `showExportInterstitial` is the thin layer that
 * carries it out.
 *
 * Where an interstitial goes is the entire design. AdMob's policies are specific
 * about the format, and export is the only moment in this app that is a genuine
 * break rather than an interruption:
 *
 * - **After the export finishes**, never before it starts. An ad in front of an
 *   action the user just asked for is the unexpected-interruption case, and it
 *   arrives under a thumb already travelling toward the button they pressed.
 * - **Never during.** A full-screen ad over a progress state is an ad shown
 *   while content loads, which the policies name outright.
 * - **Never after a failure.** Following "your video did not render" with an ad
 *   is hostile, and it is the moment a user is least likely to have meant the
 *   tap that dismisses it.
 * - **Capped.** Three cuts exported in a row is one person working, not three
 *   opportunities.
 */

/**
 * Long enough that a working session is not punctuated by ads, short enough that
 * the placement still exists. Exporting is not a thing people do in bursts of
 * ten, so this mostly means "once per sitting".
 */
export const INTERSTITIAL_MIN_GAP_MS = 5 * 60_000;

export type InterstitialDecision = {
  readonly show: boolean;
  /** Why not, for the test to name rather than infer from a boolean. */
  readonly because: 'ready' | 'export-failed' | 'too-soon' | 'no-unit' | 'not-filled' | 'not-foreground';
};

export type InterstitialContext = {
  readonly exportSucceeded: boolean;
  readonly unitId: string | null;
  /**
   * Whether an ad was actually requested and filled. Consent is not asked here:
   * it gates the *request*, which happens long before this — checking it again
   * at presentation would be checking the wrong end.
   */
  readonly adFilled: boolean;
  /**
   * Whether the app is the thing the user is looking at.
   *
   * An export can take minutes and people put their phone down during one. An ad
   * presented to a backgrounded app is an impression nobody saw, which is an
   * invalid impression and the account's problem rather than the user's — and if
   * it survives to the next foreground it arrives with no connection at all to
   * anything the user just did, which is the interruption this placement was
   * chosen to avoid.
   */
  readonly appActive: boolean;
  readonly lastShownAt: number | null;
  readonly now: number;
};

export function decideInterstitial(context: InterstitialContext): InterstitialDecision {
  // Checked before consent and before the unit, because it is the one that is
  // about the user rather than about the account: a failed export must not be
  // followed by an ad even in a build where everything else is in place.
  if (!context.exportSucceeded) return { show: false, because: 'export-failed' };
  if (!context.appActive) return { show: false, because: 'not-foreground' };
  if (context.unitId === null) return { show: false, because: 'no-unit' };
  if (!context.adFilled) return { show: false, because: 'not-filled' };
  if (context.lastShownAt !== null && context.now - context.lastShownAt < INTERSTITIAL_MIN_GAP_MS) {
    return { show: false, because: 'too-soon' };
  }
  return { show: true, because: 'ready' };
}

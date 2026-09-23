# Editing and AI Creation workspaces

Both workspaces operate on the same project, assets and timeline. Navigation
does not generate media, approve a candidate or replace an edited clip.

- **Video Editing** opens the existing timeline and media bin.
- **AI Creation** starts with Video for direct generation, or Writer for a
  reviewed script workflow. Image and Voice remain independently accessible.
- Switching back to Creation remembers the last creation tool for this open
  session. Existing desktop `openvideo-workspace-tab` values are still readable.
- Desktop Creation includes a Project media drawer backed by the same assets
  as the editor's media bin, with explicit **Add & open editor** placement.
- Desktop completed video results offer **Import & open editor**. Import makes
  the asset available in the editor's media bin; it does not insert a clip.
  Approved Writer candidates offer **Add approved & open editor**, which uses
  the existing explicit placement operation.
- Mobile Library is available in either mode. **Add & open editor** uses the
  existing append operation and changes mode only on success.

Desktop studios remain mounted as before. Mobile editing and creation screens
mount lazily and remain mounted while the project is open, preserving drafts
and pending generation across mode changes. Hidden editing pauses playback.
Returning to editing reloads externally changed assets/timelines; an unchanged
document retains its editing state. External changes invalidate local undo.
The editor also observes background job completion while it is already visible;
its own saved edits do not trigger a reload or reset undo.
Leaving the project still ends this screen session; this is not cross-project
or process-restart draft persistence.

Provider consent, spend prompts, approval gates and unsupported-platform notices
are unchanged. This phase does not redesign the storyboard board, introduce
automatic paid generation, change agent permissions, or publish a release.

## Manual acceptance checks

On desktop and a mobile development client:

1. Open a project, switch to Creation, enter a prompt without generating, then
   switch to Editing and back. The same tool and draft should remain.
2. Edit a timeline, move the playhead and switch modes without changing media.
   Returning should preserve editing state; mobile hidden playback must pause.
3. Import a completed video on desktop or select a saved result in mobile
   Library. Confirm the documented import/placement distinction above.
4. Add media from another screen, return to mobile Editing and confirm the
   updated timeline is visible. Re-generating alone must not replace a cut.
5. Check keyboard navigation on desktop and screen reader navigation on mobile.
   Hidden screens must not receive accessibility focus.
6. Verify provider consent still precedes generation. No mode switch should
   issue a generation request.

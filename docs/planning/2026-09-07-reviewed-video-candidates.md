# Reviewed video candidates and continuity approval

Issue: #327

## Outcome

A provider result is a candidate, not an edit. OpenScene records attempts against an approved Writer shot, lets the creator preview and compare them, and requires a human continuity review before one candidate becomes the approved take. Importing, approving, and placing on the timeline remain separate actions.

## Shared decision rule

Approval requires all of the following:

- the generation completed;
- its output was imported into the local project;
- identity, wardrobe/props, setting/palette, motion direction, and boundary match were each reviewed;
- no dimension failed; and
- an accepted warning has an explanatory note.

Only one generation may be approved for a shot. Approving a replacement rejects the previously approved take without deleting its asset or history. Deleting the approved output asset returns its generation to pending.

## Desktop boundary

The renderer receives a path-free `video-tool-asset://video-preview/<job-id>` URL. Electron main validates the opaque job ID, completion state, output directory, regular-file identity, symlink state, and byte range before streaming. Filesystem paths remain in main.

## Mobile boundary

Generated videos are first saved to the project library. They do not alter the timeline until the user previews the candidate, completes the same shared quality gate, and presses **Approve to timeline**. A redo leaves the old approved clip in place until the replacement is approved.

## Explicit exclusions

- Grok browser-session generation and sign-in changes are left on issue #326.
- Automatic AI scoring is not presented as a trustworthy continuity judgment.
- Provider cancellation and cross-process job resumption remain separate lifecycle work.

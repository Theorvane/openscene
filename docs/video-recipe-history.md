# Saved videos and prompts

Successful desktop jobs are imported into the current local project when
completion is observed. The exact submitted prompt, asset ID, model/provider,
operation, duration, aspect ratio and creation time are saved in optional
`ai.videoHistory`. Mobile saves video assets and this history together after
each successful generation and redo. No timeline clip is inserted or replaced.

Open **Saved videos & prompts** in Video Generation to view persisted results
after reopening. **Prepare regeneration** copies only the saved prompt into
the editable composer. It does not spend money. Review model, operation,
duration and aspect ratio from the displayed original record, reselect any
reference images/driving video, then use the existing Generate/consent flow.
Reference bytes, transient paths, credentials and provider secrets are not
stored in the recipe. A generated child records its parent; originals remain.
Exact visual reproduction is not promised and seeds are not captured.

Limitations:

- Applies to newly completed jobs, not automatic reconstruction of old prompts.
- Desktop must observe completion while the originating project is open;
  a closed app or switched project is not a background archive worker.
- If importing/saving fails, a visible error asks the user to retry Import
  before closing. Media may already be imported when metadata save fails.
- Deleted media is marked unavailable while its prompt is retained.
- New builds read old projects. Older strict-schema builds may reject projects
  saved with videoHistory; do not downgrade a project without a backup.
- History is limited to 10,000 records; a full history fails visibly instead of
  silently deleting old records. Lists initially render only 20 results.

Verification: test schema roundtrips, original preservation, duplicate imports,
bad/secret fields, missing media; test history UI with mocked IPC. Repeat on a
mobile development client for native playback and consent when available.

# Writer Studio — manual creative pipeline

Writer now works in four separate, human-reviewed steps on desktop and mobile:

1. **Develop idea:** expand a short premise into a creative treatment, audience promise, distinctive angle, hooks, characters, stakes, escalation, payoff and ending. Identify assumptions and research needs.
2. **Screenplay:** write the full action, spoken dialogue/narration, character bible, transitions and timing estimate. This is not a shot-list summary.
3. **Segments & scenes:** map the approved screenplay to numbered segments, scenes, continuity states and timed shot intentions. Preserve coverage of the story.
4. **Video prompts:** convert the approved breakdown into editable production scenes and shots with character/style bible, camera instructions, action, dialogue, sound and exclusions.

## How to use

Choose a source (short idea, existing content or rewrite of a saved script), language, duration, audience, tone and optional style/emotional goal. A rewrite also goes through the concept review; it does not jump straight into shots.

Generate runs **one** text-provider request for the selected stage. The material sent is disclosed beside the button: brief, old script for rewrite, approved upstream documents, revision notes and the current stage draft when regenerating. Desktop retains its configured AgentRouter Codex CLI transport; Gemini uses the existing adapter. AgentRouter remains visibly unavailable on mobile.

Read and edit the complete result. **Save draft** stores work locally without approval; **Approve & save this stage** records your review. The next stage is unlocked, not generated. Select **Continue**, then explicitly generate that next document. The stage review checklist is an editorial aid, not an automated quality score.

For revisions, save manual edits, enter specific revision notes, then regenerate the current stage. The saved draft is included as source, so the model sees the edits. Regeneration produces an unsaved replacement; Discard returns to saved text.

Changing an upstream document revokes downstream approvals while keeping downstream text for review. Changing the brief requires returning to step 1 and generating a revised concept. Saved drafts and approvals reopen with the project. Unsaved drafts/edits must be saved before leaving the project or closing the app.

At step 4, expand a scene to edit individual shot fields, or edit the advanced JSON to change scene structure and the bible. Incomplete JSON can be saved as a draft, but cannot be approved. Approval checks the production contract and requires the sum of shot durations to exactly match the brief. The screenplay from approved step 2 is authoritative: a technical prompt pass cannot replace it with a summary.

After all four approvals, **Create production scenes** explicitly adds the script and planning graph. It creates no media, generation jobs or charges. Reopening the project does not allow accidentally importing the identical approved pipeline twice.

In **Video**, select an approved Writer shot to load its prompt and duration into the composer. Review the video model, visual preset, references and price/consent controls before rendering. If the provider does not support the exact planned duration, choose another model or revise the shot; the handoff does not silently round it. Reference files are not attached automatically. Mobile retains its existing spend confirmation.

## Data and compatibility

- `writerStages.ts`: portable stage identities, persisted artifact shape and prerequisite rules.
- `writerWorkflow.ts`: stage-aware request validation, schemas, creative directions and response validation. Old unstaged requests remain supported for compatibility; the UIs use staged requests.
- `writerPipeline.ts`: saving/approval, invalidation, shot editing, explicit final apply and video-composer handoff.
- `useWriterPipeline.ts`: shared interaction controller; each surface injects its own React hooks, avoiding a second React instance in Metro. No keys, filesystem access or network calls.
- `AiProjectDocument.writerPipeline` is optional, so existing projects remain readable. It stores the credential-free brief and stage artifacts locally. Older app versions unaware of this field may reject a project saved by this version; keep backups when downgrading.
- Writing-only provider responses use `{ title, screenplay }`, normalized into the existing bridge envelope with empty production arrays. They cannot pass the final production apply gate.

## Verification and limits

Automated coverage includes stage skipping, manual-edit propagation, invalidation, reopen/persistence, invalid JSON draft recovery, exact runtime approval, screenplay preservation, rewrite ancestry, duplicate import prevention, shot editing and handoff, shared UI contracts, and mocked provider requests. No paid live generation is part of the automated tests.

Editorial quality, factual accuracy, spoken-word timing and the artistic coherence of a generated film still need human review. Prompt instructions cannot guarantee views or audience retention. Reading a checklist does not verify factual claims. The final structured validator checks data consistency and timing, not whether a joke lands or a story is compelling.

This iteration does not add thinking controls, autonomous stage advancement, automatic reference selection, or batch rendering of the full script.

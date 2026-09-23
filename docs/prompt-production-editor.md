# Prompt-led production editor

Desktop generation now uses a left prompt/settings pane, a right selected-source preview, and a lower Video / Voice / Subtitles plan navigator. Mobile uses the same selection model in a vertically stacked preview/navigator above the composer. Selection alone does not overwrite a prompt or spend money. Edit selected prompt is explicit, confirms replacement of non-empty text, and retains the existing generation and approval flow.

Approved Writer shots supply planned start times. Completed approved candidates are preferred, then unreviewed completed candidates; rejected takes are not selected for a shot. Stored recipe history provides unplaced takes and their original prompts. Audio without placement is labelled unplaced. Narration cue times appear as planned captions, not burned-in subtitles. Missing media retains prompt inspection.

This first slice is a plan navigator and single-source preview, not a synchronized multitrack playback engine, draggable timeline, automatic assembly, or natural-language edit executor. Audio inline preview on mobile is explicitly unavailable; use Voice. Desktop uses the existing protected playback bridge. No filesystem paths, network calls or paid providers are added to shared selection rules.

## Planned-time inspection

Timed Writer shots and narration cues use their start/duration rather than uniform card widths on desktop. Unplaced media remains outside that plan. A slider selects a planned instant; mobile offers one-second stepping and direct segment selection. Half-open intervals choose exactly one adjacent shot at a cut, and no shot at the total end. Source-relative seek pauses preview and clamps to available media duration. Captions are labelled as belonging to the inspected instant, not a running subtitle overlay. Native source controls still play one original asset, not the assembled plan. Readiness counts distinguish missing media, unreviewed takes and approved shots, without approving or generating anything.

## Voice placement

Saved audio can be explicitly appended to the first audio track using existing timeline placement rules. Desktop placement participates in editor undo/unsaved state; **Save arrangement** saves the current timeline, including other pending edits. Mobile appends and saves immediately using its existing project store. Both navigators read placed audio from the real timeline, preserving repeated clips, source trim, and speed-adjusted duration; unplaced audio stays separate. Selecting a placed voice previews its source from the trim start on desktop, not a processed/mixed render. Mobile inline audio remains unavailable. Plan scrubbing still inspects video/captions only. Arbitrary voice positioning, multitrack playback, and copying this arrangement during the generation-to-editing handoff are not implemented in this slice.

## Reference and reuse decision

OpenMontage's staged script/scene/media/composition workflow informed the interaction design.

Follow-up code reading covered `pipeline_defs/cinematic.yaml`, the manifest loading/order portions of `lib/pipeline_loader.py`, the opening scene-time contract in `schemas/artifacts/scene_plan.schema.json`, and the routing/input surface of `tools/video/video_compose.py`. Observed main revision: `08e2151fa02de28a5d6a312b3d575692bf147ad7`. This was a focused architecture review, not a full repository audit. The distinction between scene intent, materialized assets, edit decisions and runtime validation informs our separation between a plan preview and an exported cut.

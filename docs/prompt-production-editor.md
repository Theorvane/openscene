# Prompt-led production editor

## Guided production

The current AI Creation entrance offers **Plan the whole film** and **Build scene by scene**. Both begin with a production brief and lead to explicit five-second shot planning. The first route reviews a complete screenplay and scene plan up front; the second decides the next scene after the current one. **Make a single clip instead** opens the shot workbench directly. See [workspace modes](workspace-modes.md) and the [current start screen](assets/screenshot-video.png).


The default desktop video entry starts with one production brief, target duration and dialogue language. One writing-model request proposes a complete screenplay, scene breakdown and shot-prompt package. The package is saved unapproved in the existing Writer contract. Users inspect the displayed documents, then explicitly approve the entire package to prepare production shots. A changed brief, incomplete package or duration mismatch blocks approval. Planning confirmation warns about writing-model charges; plan approval never authorizes media spend.

The production board then prices a sequential video batch. Completed videos are imported automatically with their exact prompts and remain unapproved. Import failure or a changed plan stops further submissions. Continuity review and assembly remain explicit; desktop arrangement saving and final export are separate actions. Individual settings, Writer stages, frame tools and voice tools remain available as advanced controls.

Mobile uses the same plan proposal/approval rules and adds a priced text-to-video batch over eligible approved shots, persisted candidate review and approved-cut assembly. It refuses incompatible durations or required image references instead of dropping constraints. Reference-driven batches remain on desktop; mobile displays the reason. Both surfaces retain existing images and videos when a planning draft is revised.

This is a guided shot-production workflow, not an unattended all-media renderer. Image generation/reference assignment, voice synthesis and final export are still separate explicit operations. Queues do not silently resume paid submissions after restart; existing queued/completed candidates prevent duplicate submissions. Actual provider output and native mobile execution require device/provider validation.

Desktop creation uses one Production studio: Story, Scenes, and Voice & captions are internal stages, with Video takes and Reference frames nested inside Scenes. The left pane changes tools while the right selected-source preview and lower Video / Voice / Subtitles navigator remain mounted. Drafts and jobs remain in their existing controllers. Loading a selected shot or saved prompt explicitly opens Video takes and confirms replacement of non-empty text.

Mobile has one Studio entrance alongside AI and Library. It uses the same stage grouping and evidence-based status labels, retaining visited tool screens and drafts. To fit the phone screen, source preview and the sequence navigator remain in Video takes rather than occupying every stage. Existing editing-project navigation is unchanged. Persisted tool ids, generation consent and review gates are unchanged; entering a stage never marks it complete or starts generation.

Approved Writer shots supply planned start times. Completed approved candidates are preferred, then unreviewed completed candidates; rejected takes are not selected for a shot. Stored recipe history provides unplaced takes and their original prompts. Audio without placement is labelled unplaced. Narration cue times appear as planned captions, not burned-in subtitles. Missing media retains prompt inspection.

This first slice is a plan navigator and single-source preview, not a synchronized multitrack playback engine, draggable timeline, automatic assembly, or natural-language edit executor. Audio inline preview on mobile is explicitly unavailable; use Voice. Desktop uses the existing protected playback bridge. No filesystem paths, network calls or paid providers are added to shared selection rules.

## Planned-time inspection

Timed Writer shots and narration cues use their start/duration rather than uniform card widths on desktop. Unplaced media remains outside that plan. A slider selects a planned instant; mobile offers one-second stepping and direct segment selection. Half-open intervals choose exactly one adjacent shot at a cut, and no shot at the total end. Source-relative seek pauses preview and clamps to available media duration. Captions are labelled as belonging to the inspected instant, not a running subtitle overlay. Native source controls still play one original asset, not the assembled plan. Readiness counts distinguish missing media, unreviewed takes and approved shots, without approving or generating anything.

## Voice placement

Saved audio can be explicitly appended to the first audio track using existing timeline placement rules. Desktop placement participates in editor undo/unsaved state; **Save arrangement** saves the current timeline, including other pending edits. Mobile appends and saves immediately using its existing project store. Both navigators read placed audio from the real timeline, preserving repeated clips, source trim, and speed-adjusted duration; unplaced audio stays separate. Selecting a placed voice previews its source from the trim start on desktop, not a processed/mixed render. Mobile inline audio remains unavailable. Plan scrubbing still inspects video/captions only. Arbitrary voice positioning, multitrack playback, and copying this arrangement during the generation-to-editing handoff are not implemented in this slice.

Voice & captions defaults to local Qwen3-TTS on desktop when no model has been saved; its [wrapper setup](local-qwen-tts.md) is separate from the optional VieNeu runtime. Choosing a voice model never generates audio. A narration plan must be approved before the Generate action, and a finished take is reviewed before import or placement.

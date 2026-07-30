---
name: video-from-scenario
description: >
  Turn a video request into a scenario, then into shots, stills, and clips.
  Establishes the target length, splits it into provider-legal shots, generates a
  still per shot with continuity held across them, animates each still with
  image-to-video, and assembles the result on the project timeline. Every step
  that spends money goes through the cost gate first.
  Use whenever the user asks the in-app agent for a video longer than a single
  clip, or for a video "with a story", scenario, script, or storyboard.
allowed-tools: planVideoScenario, estimateGenerationCost, createImageJob, createVideoJob, getJobStatus, importGeneratedResult, addClipToTimeline, getProjectTimeline
---

# Video from scenario

A one-clip request goes straight to `createVideoJob`. Anything longer needs a scenario, because video models render each clip blind: they share no memory of the other shots. Continuity is something you impose, not something they provide.

> **Where this is enforced.** Shot arithmetic is [`src/shared/videoStoryboardPlan.ts`](../../../src/shared/videoStoryboardPlan.ts) behind the `planVideoScenario` tool. Money is gated by [generation-cost-approval](../generation-cost-approval/SKILL.md). This file is the procedure; `tests/videoFromScenarioSkill.test.ts` keeps it honest about the tool names it claims.

## The pipeline

```
length → shots → stills → clips → timeline
         ↑                ↑
    planVideoScenario   createImageJob → createVideoJob(referenceImageJobId)
```

Stills come first on purpose. A still is roughly two cents and takes seconds; a clip is dollars and minutes. Getting the frame wrong is cheap to discover at the still stage and expensive at the clip stage.

## Step 1 — Length

Ask how long the finished video should be. Never assume. The difference between 8 seconds and 40 is one charge versus five.

## Step 2 — Shots

Call `planVideoScenario` with the total and the model. It returns legal per-shot durations and start times.

**Do not do this arithmetic yourself.** Providers accept only certain clip lengths — Sora 4/8/12s, Veo 4–8s — and an illegal duration is rejected *after* the user has approved the spend. If the plan reports `roundedFrom`, the requested length was not reachable; tell the user the length changed rather than letting them discover it in the export.

Then write the scenario: one line per shot, describing what is on screen.

## Step 3 — Continuity

Each shot is a separate provider call with no knowledge of the others. Anything that must stay the same has to be **restated in full in every shot prompt**:

| Field | Restate |
|---|---|
| `subject` | who or what is on screen, described the same way every time |
| `wardrobe` | clothing, colour, condition |
| `props` | objects that persist across shots |
| `location` | the place, and where in it |
| `lighting` | time of day, direction, quality |
| `lens` | focal length feel, depth of field |

Writing "the same woman as before" does nothing — there is no before. Repeat the description verbatim.

## Step 4 — Price and approve

Call `estimateGenerationCost` with the whole shot list, present the total, and wait for approval. See [generation-cost-approval](../generation-cost-approval/SKILL.md). Do not price the stills and the clips as separate decisions if they are part of one plan; the user wants to know what the video costs.

## Step 5 — Stills

For each shot, `createImageJob` with the shot description plus every continuity field. Show the stills. Let the user reject or redo any of them **before** any clip is generated — this is the cheap checkpoint and the reason the pipeline is ordered this way.

## Step 6 — Clips

For each approved still, `createVideoJob` with `referenceImageJobId` set to that image job. The still becomes the image-to-video seed, so the clip starts from a frame the user has already accepted.

The video prompt describes *motion*, not content — the content is in the still. "Slow push in, subject turns toward camera" rather than a second description of the scene.

## Stills are reference-only

A generated still cannot become a project asset: `MEDIA_KINDS` is `['video', 'audio']`, so `importGeneratedResult` has nothing to import it as. A still's two exits are the save dialog and the video reference. Do not offer to place one on the timeline.

## Step 7 — Assemble

Per clip: `getJobStatus` until completed, `importGeneratedResult` to make it a project asset, `addClipToTimeline` in shot order. Report progress per shot rather than going silent for several minutes.

## Failure modes worth naming

- **Silence during generation.** Clips take minutes. Say which shot is running.
- **A failed shot mid-plan.** Report which shot failed and what the provider said, then ask whether to retry that shot or stop. Do not generate the rest as if nothing happened, and do not silently skip it.
- **Drifting continuity.** If shot 4's still does not match shot 1's, the continuity fields were paraphrased rather than repeated. Regenerate the still, do not proceed to the clip.

## Reference

- [`references/prompt-recipes.md`](references/prompt-recipes.md) — still and motion prompt shapes per shot type, loaded only when writing prompts.

---
name: narration-to-timeline
description: >
  Write a voiceover script sized to the picture, synthesize it, and place it on
  the timeline. Checks the script against the seconds it has to fill before
  paying for speech, so an over-running read is caught while it is still free to
  fix. Use whenever the user asks the in-app agent for narration, voiceover, a
  script read aloud, or audio over an existing cut.
allowed-tools: getProjectTimeline, checkNarrationLength, estimateGenerationCost, createSpeechJob, getJobStatus, importGeneratedResult, addClipToTimeline
---

# Narration to timeline

Narration fails in one direction. Too short leaves silence an editor can absorb; too long pushes the voice past the picture, and the only fix is rewriting and paying for the read again. So the length check comes before the spend.

> **Where this is enforced.** Timing is [`src/shared/narrationTiming.ts`](../../../src/shared/narrationTiming.ts) behind `checkNarrationLength`. Money is gated by [generation-cost-approval](../generation-cost-approval/SKILL.md).

## Step 1 — Find the slot

Call `getProjectTimeline` and work out how many seconds the narration has to cover: the whole cut, or a specific span the user named. State the number you are writing to.

If there is no picture yet, ask what length to write for. Do not invent one.

## Step 2 — Write to size

Write the script. Then call `checkNarrationLength` with the script and the slot.

**Do not estimate the duration yourself.** Word count and speaking rate are exactly the kind of arithmetic that comes out plausible and wrong, and the mistake is only visible after the speech job has been billed and placed.

The tool counts Korean and Japanese by character and latin scripts by word, because Korean has no latin-style word spacing and is syllable-timed — counting its "words" under-reports the read by a wide margin.

Act on the verdict:

| Verdict | Do |
|---|---|
| `fits` | continue |
| `too-long` | cut to the returned budget, or raise the pace, then re-check |
| `too-short` | add a line, or tell the user the picture is longer than the script |

Re-check after every rewrite. The check is free.

## Step 3 — Price and approve

`estimateGenerationCost` for the speech model, then the usual approval. Speech comes back **unpriced** — ElevenLabs bills against a monthly credit allowance rather than per character, so there is no honest dollar figure. Say that plainly and ask the user to confirm they accept an unknown charge; do not offer a number to fill the gap.

## Step 4 — Synthesize and place

`createSpeechJob`, `getJobStatus` until completed, `importGeneratedResult`, then `addClipToTimeline`. The result is an audio asset, so it lands on an audio track — do not pass a video `trackId`.

## Step 5 — Report the real duration

The estimate was an estimate. Once the asset is imported, its actual duration is known: compare it against the slot and say if it drifted. A read that came back 3s long is the user's decision to make, not something to leave for them to notice in playback.

## Failure modes worth naming

- **Quoting a duration you did not measure.** Every number about length comes from `checkNarrationLength` or from the imported asset's metadata.
- **Silent over-run.** If the finished audio is longer than the picture, say so explicitly. It will not be obvious from the timeline alone.
- **Re-synthesizing on every small edit.** Each attempt costs. Get the script through the length check first, then generate once.

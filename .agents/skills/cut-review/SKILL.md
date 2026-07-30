---
name: cut-review
description: >
  Review an assembled timeline and fix what is wrong with it. Reads the timeline
  structure, watches the footage, reports concrete problems with clip ids and
  timestamps, and applies only the fixes the user approves. Use when the user
  asks the in-app agent to review, critique, tighten, or check a cut, or asks why
  an edit feels off.
allowed-tools: getProjectTimeline, watchProjectVideo, trimTimelineClip, removeTimelineClip, updateClipEffects, addClipToTimeline
---

# Cut review

A review is only useful if it is specific. "The pacing feels slow" is not actionable; "clip `c3` runs 9s on a static frame from 00:12" is.

## Step 1 — Read the structure

`getProjectTimeline` gives tracks, clips, ids, and durations. Most reviewable problems are visible here without watching anything:

- **Dead air** — a gap between clips on the only video track.
- **Slivers** — clips under about half a second, usually left behind by a bad split.
- **A clip much longer than its neighbours** — the most common cause of a cut that drags.
- **Overlaps** on a track that should be sequential.
- **Audio running past the last video clip,** or the reverse.

Report these with clip ids and times. This step costs nothing.

## Step 2 — Watch, only if needed

`watchProjectVideo` samples frames into the conversation with timestamps. Use it for what the structure cannot show: whether a long clip is actually static, whether two adjacent shots are near-identical, whether a subject is cut off.

A vision-capable model is required to see the frames. If the running model cannot, say so rather than describing frames you did not see.

Sample deliberately — frames cost context, and the timeline already told you where to look.

## Step 3 — Report before touching anything

List the findings, most disruptive first, each with the clip id and the fix you propose. Then stop and let the user choose. A review that silently rewrites the cut is not a review.

## Step 4 — Apply what was approved

`trimTimelineClip`, `removeTimelineClip`, `updateClipEffects` — one change at a time, in the order the user agreed. Say what you changed after each.

Every one of these is a project mutation and prompts for approval. That is a second gate on top of the user's decision in step 3; do not treat their "yes, fix those" as a reason to be surprised by the prompt.

## What not to do

- **Do not invent a house style.** Unless the user gave one, "shots should be 3–5 seconds" is your preference, not a finding. Report what is inconsistent, not what differs from a rule you made up.
- **Do not report the timeline back as a list.** The user can see their own timeline. Report problems.
- **Do not fix in the same breath as reporting.** The gap between finding and fixing is where the user gets to disagree.
- **Do not claim to have watched footage you did not sample.**

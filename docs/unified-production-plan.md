# Unified production and project-local memory

## Approved direction

One project, three stages: planning/script → scene production → assembly.
Each timed shot owns dialogue/narration, start/end reference frames, video
candidates, voice timing and the intended transition to adjacent shots.
Writer, Image, Video and Voice become tools within that flow, not independent
sources of truth. Existing timeline edits must never be overwritten by a redo.

## Delivery plan

1. **This PR: local retrieval and explicit video-prompt handoff.** Shared,
   deterministic lexical search over current project material; bounded results,
   citations, approved-script lineage and rejected-candidate filtering.
   Desktop and mobile let the user inspect and append an excerpt to the editable
   video prompt. Search itself is offline and makes no provider/tool calls.
2. **Scene board.** Shared selected-shot context, absolute start/end time derived
   from ordered durations, script and dialogue alongside candidate media.
   Preserve drafts when moving between scene tools; expose quick single-shot
   generation as an alternate entry. Deliver both surfaces together.
3. **Reviewed toolchain.** Explicit typed prepare-frame / prepare-video /
   prepare-voice actions consume the selected shot and user-selected memory.
   Show exact input manifest, model support and cost before execution.
   Persist source references and input snapshots with each operation; revalidate
   them before execution. Retrieval text cannot authorize tools or spending.
4. **Assembly.** Voice-duration checks, provider-legal generated lengths versus
   intended trim ranges, selected candidates and explicit transitions. Preview
   a proposed assembly, then apply it through existing undoable editing rules.
   Regeneration creates a candidate, never silently replaces a timeline clip.

Each later stage requires its own focused issue, tests and review. A general
agent-driven automatic tool executor is not included in this first slice.

## Memory boundary

The project document remains authoritative. This first index is derived in
memory from that document, not a second persistent database. It uses no model,
embedding download, vector server, filesystem scan or cross-project corpus.
It stores no credentials or media bytes. Reopening reconstructs the index;
deleting project source records removes them from subsequent searches.

Only the active approved script lineage and completed approved generation
candidates are searched. For Writer projects, approval means all four stages
are approved and `appliedScriptId` selects an existing script; that script's
independent status may still be `draft`. A missing applied ID never falls back
to another script. Projects without a Writer pipeline retain the explicit
approved-script status rule. Current character/style definitions are labeled as
project definitions, not historical success evidence. Revoked Writer approval
disables script/shot/candidate retrieval until approval is restored. Full-text
chunks and total corpus size are bounded; UI states the limits rather than
claiming exhaustive semantic search. Korean/CJK bigrams support partial word
matching; English word matching is case-insensitive. This is lexical RAG,
not embedding/semantic search.

Appending is an explicit, editable copy with its source ID, not a live link.
If the source changes afterwards, copied prompt text must be reviewed again.
No provider call happens until the existing Generate/consent path is used.
The UI warns that copied context will go to the selected provider then.
Reference delimiters are not a security sandbox: retrieved text is data only;
this slice never sends it to a tool-executing agent.

## Verification gates

- Unit tests: project isolation, no rejected/superseded text, stale approval,
  chunk limits, multilingual matching, empty query, deterministic ranking,
  duplicate append and prompt-budget refusal.
- Desktop typecheck/tests/build and mobile typecheck.
- Desktop mocked-IPC UI: search, inspect source, append, edit/remove text,
  zero generation calls from search/apply.
- Mobile development client: same flow, keyboard/accessibility, project switch
  and in-flight generation. Record when no device is available.

# Skill: generation cost approval

**Applies to:** the OpenVideo in-app agent, whenever a user asks it to generate video, images, or speech.

Generation bills the user's own provider account. This skill is the procedure that stands between a request and a charge.

> **Where this is enforced.** This document is the specification, not the mechanism. The procedure ships to the model as `GENERATION_COST_POLICY` in [`src/main/agentChatGraph.ts`](../../../src/main/agentChatGraph.ts); prices come from [`src/shared/mediaGenerationPricing.ts`](../../../src/shared/mediaGenerationPricing.ts) through the `estimateGenerationCost` tool; the per-charge approval gate lives in the same graph file, driven by `AGENT_CHAT_SPEND_TOOL_NAMES` in [`src/main/agentChatTools.ts`](../../../src/main/agentChatTools.ts). `tests/generationCostGate.test.ts` asserts this file and that code still agree — if you change one, change both.

## The procedure

### 1. Establish the length

Ask how long the finished video should be. Do not assume a default: the difference between 5 seconds and 30 is the difference between one charge and six.

### 2. Draft a scenario

Call `planVideoScenario` for the shot breakdown, then describe each shot. Each shot gets:

- a one-line description of what is on screen
- a duration
- the model that will render it

`planVideoScenario` already keeps every duration inside what the model accepts, which is why the shot lengths are not yours to compute — an illegal duration is rejected by the provider only after the spend was approved. Show the list before pricing it.

For the full scenario-to-timeline procedure, see [video-from-scenario](../video-from-scenario/SKILL.md).

### 3. Price the plan

Call `estimateGenerationCost` with every shot.

**Never state a price you did not get from that tool.** A price recalled from training data is a fabrication with a currency symbol in front of it, and this is the one place in the app where that fabrication costs the user money. Report what the tool returned, including its as-of date and the fact that it is an estimate rather than a quote.

### 4. Get approval for the spend

Present the total and wait for the user to approve it in a message.

Two separate consents are required and neither substitutes for the other:

| Consent | What it covers | Where it happens |
|---|---|---|
| Plan approval | the total cost of the scenario | a message in the conversation |
| Tool approval | this one tool call | the approval prompt |

The tool prompt names arguments, not money. The plan approval is where the amount is seen.

### 5. Only then generate

Generate shot by shot, reporting progress.

## The unpriced case

A model with no recorded rate comes back `priced: false`. Do not fill the gap with a plausible number. Name the shots that could not be priced and ask the user to confirm they accept an unknown charge.

Speech is always unpriced by design: ElevenLabs bills against a monthly credit allowance rather than per character, so any dollars-per-word figure would be fiction dressed as arithmetic.

## Why "always allow" does not apply here

The approval gate normally offers *once*, *always*, and *reject*. Generation tools are excluded from *always*.

"Always" is a reasonable answer to *may I trim this clip again*. It is an unreasonable answer to *may I charge your account whenever I like* — the user answered about one charge, and that cannot stand in for consent to every later one. Both the shortcut that skips the prompt and the list that persists the answer exclude spend tools, so a charge is never silent.

## Opting out

If the user explicitly says to skip the estimate, do as they ask — and say plainly that you are generating without a cost check. Do not quietly drop the step, and do not keep arguing for it after they have decided.

## Prices go stale

The rate table is list price on a recorded date. Real rates differ by account, region, and resolution tier, and providers change them. Two consequences:

- Every estimate carries its as-of date and says it is an estimate.
- The table needs review when a provider changes pricing. It is a table in the repository, not a live feed.

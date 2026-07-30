# Prompt recipes

Loaded only when actually writing shot prompts, so the shapes below cost nothing on turns that do not need them.

## Still prompt shape

```
[shot description]. [subject, described identically every shot].
[wardrobe]. [props]. [location]. [lighting]. [lens].
```

Order matters less than completeness: an omitted field is the field that drifts.

## Motion prompt shape

The still already carries the content. The video prompt carries only what changes:

```
[camera move]. [subject motion]. [duration-appropriate pace].
```

| Shot type | Camera | Pace note |
|---|---|---|
| Establishing | slow push in, or slow drift left | let it breathe; avoid a move that finishes early |
| Character beat | static, or very slow push | motion competes with the performance |
| Detail / insert | slow rack focus, or slight orbit | short shots read as jarring if the camera also cuts across |
| Transition out | pull back, or rise | gives the next shot somewhere to start from |

## Pacing against shot length

A 4s clip fits one idea. An 8s clip fits a move plus a beat. A 12s clip needs something to happen at its midpoint or it reads as dead air — if nothing does, use two shorter shots instead.

## What not to write

- **Negatives the model cannot act on.** "No blur" is weaker than describing the sharpness you want.
- **Cut instructions.** One clip is one continuous take. "Then it cuts to…" belongs in the next shot, not this prompt.
- **References to other shots.** "Same as shot 2" has no meaning to a model rendering shot 3 blind.
- **Text in frame,** unless the model is one that renders type reliably. Most do not, and misspelled on-screen text ruins an otherwise usable clip.

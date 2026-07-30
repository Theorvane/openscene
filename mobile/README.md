# OpenVideo mobile

A React Native app that consumes the desktop app's domain code rather than a copy of it.

## Why this exists

Choosing between React Native and Flutter came down to one question about this repository: does `src/shared` — 4,105 lines of timeline model, clip placement, shot planning, pricing, and narration timing, with most of the repo's subtler rules and tests — cross to mobile unchanged?

This app is the answer. It imports those modules directly and runs them.

## The seam

Nothing is copied or vendored:

- `metro.config.js` adds `../src/shared` as a watch folder and maps it to `@openvideo/shared`. Only that directory, not the repository root — watching the root would pull the Electron sources into the bundler's graph.
- `tsconfig.json` maps the same alias and includes `../src/shared/**/*.ts`, so the mobile typecheck covers the shared core as the app actually sees it.

That second part earned its keep immediately: it caught `models.ts` and `updater.ts` using `NodeJS.Platform`, a type that exists only inside a Node type environment. The shared core had a quiet dependency the desktop build could never reveal. `HostPlatform` replaced it, and `tests/sharedCorePortability.test.ts` now fails if any shared module reaches for a Node built-in, Electron, the DOM, or a `NodeJS.*` type.

## Running it

```bash
cd mobile
npm install
npm run ios      # or: npm run android
npm run typecheck
```

## What is not here

The video pipeline. `ffmpegTimelineCompiler` and its neighbours are built on spawning a system FFmpeg binary, which a phone does not have, and `ffmpeg-kit` — the obvious substitute — was archived by its maintainer in early 2025. Replacing it means `AVFoundation` on iOS and `Media3 Transformer` on Android, which is the real work and the real risk. It is framework-independent, and it does not belong in a scaffold.

The likely shape of this app is a companion rather than a replacement: shoot, generate in the cloud, approve the spend, edit on the desktop. That needs the generation studios and the approval surface, not a timeline editor.

# Documentation Notes

- Keep docs local-first. OpenScene stores recordings, projects, imported assets, voice profiles, TTS output, and MP4 exports locally.
- Be precise about boundaries. Program Monitor is best-effort preview, while FFmpeg MP4 export is the supported final output path for saved local timelines.
- Do not claim cloud upload, cloud export, multiple export formats, AI video generation, frame-perfect mastering, accounts, analytics, crash reporting, or auto-update are implemented.
- Keep local Qwen TTS framed as a user-provided local wrapper configured by `VIDEO_TOOL_TTS_CONFIG_PATH`.
- Use plain English. Avoid repeating generic Electron or React advice unless it affects this repository.

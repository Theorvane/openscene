# Local Qwen TTS

Qwen3-TTS is the default voice model for new desktop selections in **AI Creation → Advanced tools → Voice & captions**. It uses a wrapper, model and reference voice sample that you provide. OpenScene does not download or install them. Existing desktop model preferences are respected, so a previously selected VieNeu or cloud voice remains selected.

![Qwen selected in Voice and captions](assets/screenshot-voice.png)

## Configure the local wrapper

1. Install a Qwen3-TTS-compatible model and a wrapper that accepts a text-file path, reference-sample path and output path. Use only a voice sample you own or are authorized to use.
2. Create a JSON config on the desktop. Every path in it must be absolute:

```json
{
  "executablePath": "/absolute/path/to/python",
  "modelPath": "/absolute/path/to/Qwen3-TTS-12Hz-1.7B-Base",
  "voiceSamplePath": "/absolute/path/to/authorized-reference.wav",
  "workingDirectory": "/absolute/path/to/wrapper",
  "args": ["synthesize.py", "--model", "{modelPath}", "--reference", "{voiceSamplePath}", "--text-file", "{textPath}", "--output", "{outputPath}", "--language", "{language}"]
}
```

3. Set `VIDEO_TOOL_TTS_CONFIG_PATH` to the absolute path of that JSON file **before launching OpenScene**. For a development session, use `export VIDEO_TOOL_TTS_CONFIG_PATH=/absolute/path/to/qwen-tts.json` on macOS/Linux, or `$env:VIDEO_TOOL_TTS_CONFIG_PATH = 'C:\\absolute\\path\\to\\qwen-tts.json'` in PowerShell on Windows. An installed desktop app must inherit the variable from its launch environment.
4. Open Voice & captions, keep **Qwen3-TTS (local)** selected, write a script, prepare and approve the narration plan, then choose **Generate approved voice**. Listen to the WAV take before importing it into the project.

Adapt `args` to your own wrapper; the example is an argument contract, not a bundled `synthesize.py` script. The wrapper must read UTF-8 text from `{textPath}` and write a WAV file to `{outputPath}`. The arguments must include `{textPath}`, `{outputPath}` and `{voiceSamplePath}`; `{modelPath}` and `{language}` are optional tokens. Language defaults to `Auto` when no language is supplied. OpenScene runs the executable without a shell, checks that the result is a WAV file and removes the temporary script file. It cannot guarantee model compatibility, memory use or speed for a user-provided wrapper.

The **Configured voice sample** choice refers to `voiceSamplePath` in the JSON. Change the config to use a different sample; OpenScene reads it for each new job. A missing config or failed wrapper is shown as a failed speech job; OpenScene does not fall back to a cloud provider.

## Other voice options

**VieNeu-TTS v3 Turbo** remains in the model picker for Vietnamese voices. Its local server starts when you select VieNeu and voice presets come from that server. On Windows, `npm run setup:local-ai` prepares the optional managed VieNeu and whisper.cpp runtimes; this command does not install Qwen. OpenAI and ElevenLabs require a connected API key. Mobile can review narration and captions but cannot run the desktop-local Qwen or VieNeu processes.

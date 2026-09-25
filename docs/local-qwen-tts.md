# Local Qwen TTS

Qwen TTS is the default voice model on desktop. OpenScene does not install a model or wrapper. Install and configure your own compatible Qwen3-TTS wrapper, and use only a voice sample you own or are authorized to use.

Set `VIDEO_TOOL_TTS_CONFIG_PATH` to the absolute path of a JSON file before launching OpenScene. Example:

```json
{
  "executablePath": "/absolute/path/to/python",
  "modelPath": "/absolute/path/to/Qwen3-TTS-12Hz-1.7B-Base",
  "voiceSamplePath": "/absolute/path/to/authorized-reference.wav",
  "workingDirectory": "/absolute/path/to/wrapper",
  "args": ["synthesize.py", "--model", "{modelPath}", "--reference", "{voiceSamplePath}", "--text-file", "{textPath}", "--output", "{outputPath}", "--language", "{language}"]
}
```

Adapt the arguments to your wrapper. The wrapper must read UTF-8 text from `{textPath}`, synthesize audio using the selected reference, and write a WAV file to `{outputPath}`. All four paths in the JSON must be absolute. Optional `{language}` defaults to `Auto`. OpenScene launches the executable without a shell, checks for a WAV result, and deletes the temporary script file after the job. Model compatibility and performance depend on your local wrapper and hardware.

VieNeu-TTS remains a separate voice model in the picker. Its server starts when you select it. Existing saved model choices remain selected.

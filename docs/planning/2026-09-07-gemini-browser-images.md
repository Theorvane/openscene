# Google Flow browser-session images (#334)

Google's Gemini API quota and the signed-in Google Labs Flow allowance are separate. OpenScene keeps both routes explicit instead of treating browser cookies as an API key.

## Desktop flow

1. The user signs in once under Settings. Cookies remain in the existing encrypted vault and are restored only into an isolated in-memory Electron partition.
2. Image Generation defaults Google models to **Google Flow session**; **API key** remains selectable.
3. Generate starts a real Chromium renderer at `labs.google/fx/tools/flow`, opens the newest project or creates one, switches the prompt configuration to Image, chooses x1 and Landscape/Portrait, and maps the catalog selection to Nano Banana 2 or Nano Banana Pro. The window is visible by default during beta and can be hidden under Settings → Providers. If the account does not expose the requested model, the job fails instead of silently using another one.
4. Main intercepts that user-account download inside the isolated session, limits it to 50 MB, and verifies PNG, JPEG, or WebP magic bytes before handing it to the existing image job.
5. The ordinary result preview, save, and Use for video actions continue unchanged.

The worker never sends cookie values over IPC, does not copy another browser profile, does not call a reverse-engineered generation endpoint, and does not attempt to solve CAPTCHA, account verification, or provider limits. It waits for a new media element rendered by Flow and asks the same isolated browser session to download that URL. Page load, generation, and download each have finite deadlines, with progress written to the terminal under `[OpenScene][Google Flow Image]`.

This lane is intentionally marked experimental because a provider UI change can invalidate selectors. It is desktop-only; mobile continues to use the official API adapter and says so on its Image screen.

Closing a visible Flow worker before its image has downloaded cancels the job immediately. The visibility preference is a non-secret renderer setting; each request carries only that boolean to main, while authentication remains confined to the encrypted browser-session boundary.

## Reference implementations reviewed

- `Rabornkraken/browser2api` (MIT) demonstrates Flow's project editor, bottom prompt configuration, model selection, result detection, and bounded downloads.

OpenScene reuses its own Electron renderer and encrypted session boundary rather than adding Playwright or extracting Chrome cookies.

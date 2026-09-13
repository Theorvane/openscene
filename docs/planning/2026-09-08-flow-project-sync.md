# Google Flow project-name synchronization

The signed-in Google Flow worker now keeps the local OpenScene project label in
the same generation flow:

- The renderer passes the local folder name (or the project name for internal
  projects) through the image-generation request. Full filesystem paths never
  cross the renderer boundary.
- The main process normalizes the label, removes control characters, and caps
  it at 100 characters before sending it to the isolated Flow worker.
- The worker recognizes project cards rendered as thumbnails, links, buttons,
  role buttons, or tabindex elements. It recognizes both English and
  Vietnamese “New project” labels, including a tile rendered as a plain div.
- A visible matching card is opened when possible. If a requested project is
  not listed, the worker chooses New project instead of silently opening an
  unrelated recent project. A newly created project is renamed through a
  visible Flow title control when that control is exposed by the current UI.
- Progress logs include candidate count, requested label, match status, and
  rename status without logging cookies, prompts, or filesystem paths.

This remains DOM automation, so a Flow UI change must be handled by updating
selectors and rerunning the focused suite plus a real signed-in smoke test.

The worker now opens the canonical `flow.google.com` application directly.
`labs.google` remains exactly allowlisted for older sessions and provider-owned
redirects; wildcard Google navigation remains blocked. Electron's
`ERR_ABORTED (-3)` is accepted only when the replacement URL is still inside
that exact allowlist. Hidden reCAPTCHA bootstrap elements are ignored; only a
visible verification challenge stops the job for user action.

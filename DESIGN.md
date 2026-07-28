# OpenVideo Design System

OpenVideo is a compact local studio command desk for arranging recordings, imported media, generated local assets, and narration in one persistent desktop shell. The renderer follows a restrained desktop-tool design language: flat neutral surfaces, hairline borders, a strong/weak/weaker text hierarchy, one interactive accent, soft single-source elevation, and dense tactile controls. The warm command desk survives as the default light preset (`daylight-glass`); the neutral zinc foundation is the default dark preset (`dark-zinc`). It must not read as a cloud video generator, generic SaaS dashboard, provider console, or marketing page.

## Core Principles

- Navigation follows the stage flow Projects → Home (Menu) → workspace. Projects is the initial page; Home and the persistent local workspaces (Editing, Voice Generation, Video Generation) require an active project and are opened from Home.
- Keep every renderer claim local. Projects, recordings, imports, voice samples, generated results, and timeline edits stay on the user's machine unless a future reviewed provider operation explicitly says otherwise.
- Never expose raw local filesystem paths in renderer UI for imported timeline assets. Show names, durations, media kind, status, and secure playback URLs only when playback needs them.
- Use dense but readable panels with mono section kickers, strong desk labels, clear control copy, and compact metadata.
- Do not present cloud generation, provider integrations, unsupported formats, bundled model setup, or frame-perfect mastering guarantees as implemented until the code supports them.

## Layout Contract

- `product-chrome` is a compact top bar with the current page, a concise `Local` indicator, Projects, Home (Menu), and Settings buttons, and the theme switch. It reads as the desk toolbar, not the product billboard; the Edit workspace keeps its own branding visually hidden for accessibility only. The Menu button stays disabled with a short hint until a project is open; Projects and Settings stay reachable at all times.
- The persistent right `AgentChatPanel` is the only user-facing Edit Agent UI. It is always the rightmost flex child beside the mounted workspace stack and owns Edit Agent model/connection status, selected and attached project context, conversation and tool stream, approval queue, reset/status, and prompt controls.
- Do not render a global agent model selector in `product-chrome`, add a separate `EditAgentWorkspace`, or move Edit Agent controls into the left workspace navigation. Direct AI Video and AI Voice studios keep their own domain-specific controls, and Settings keeps provider credentials and primary model configuration separate from the Edit Agent chat surface.
- `app-page-stack` owns top-level page visibility for Home, mounted workspaces, and Settings. Active page state is separate from active workspace state.
- `local-edit-bay` owns the active workspace panel while a workspace page is active. The panel fills the space between product chrome and the persistent right AgentChatPanel; do not reintroduce a left workspace sidebar.
- Workspace panels for Editing, Voice Generation, and Video Generation stay mounted while inactive. Hide inactive panels with the platform `hidden` state rather than unmounting them, so video generation jobs, sample capture, local TTS job state, and timeline editor state survive navigation.
- Settings is a top-level page opened from product chrome, not a workspace navigation item. Home is a top-level page with entry cards for Editing, Voice Generation, and Video Generation in that order.
- Home is the direct workspace chooser and lists `Editing`, `Voice Generation`, and `Video Generation` as entry cards. MP4 export lives inside the Editing workspace because it acts on the saved local timeline.
- `editor-workspace--nle` uses a desktop NLE grid: tabbed project/media dock on the left, persistent program monitor in the center, tabbed inspector on the right, and persistent timeline across the bottom. Timeline commands are routed through the native application menu, not an in-workspace command bar.
- Project/media dock tabs and inspector tabs exist only inside the Edit workspace. Never use those tabs for switching to Screen Recording or Voice Generation, and never tab the monitor or timeline.
- On narrow screens, preserve the same order in a single column: program monitor, timeline, project/media dock tabs, inspector tabs.

## Workspace Entry

- Home entry cards are the workspace navigation. Each card uses a full native `Button`, original inline SVG icon, visible workspace label, static local status label, and `aria-controls` for its mounted panel.
- Status labels are fixed product labels, not live progress text. Live recording, sample, TTS, save, or error status stays inside the active workspace panel.
- When users activate a workspace card, focus moves to the newly active region. Product chrome Home returns focus to the Home page region when it is already active.

## Home And Settings Pages

- Projects is the first page after launch. Home is reachable only with an active project — creating or opening a project routes to Home on success — and uses semantic page structure with `home-page-title` labeling its region. Navigation to a project-required page without a project (including losing the active project mid-session) falls back to Projects.
- Home entry cards are native `Button` controls with `aria-controls` pointing to the mounted workspace region they open. Card order is Editing, Voice Generation, Video Generation.
- Home copy must stay truthful to the local-first product boundary: it can describe local editing, consent-based local narration, configured provider seams, and local result import, but must not imply account, analytics, cloud upload, or bundled model/runtime setup.
- Product chrome opens Home and Settings with native `Button` controls, visible labels, inline SVG icons, `aria-current="page"` when active, and `aria-controls` for each page region.
- Settings owns theme preferences, provider credentials, endpoints, primary model configuration, and local AI engine preferences. It is not part of `APP_WORKSPACES` and must not appear in `AppWorkspaceNavigation`.

## Program Header And Command Surface

- The Edit workspace keeps `Local studio`, `OpenVideo`, and the `Timeline editor` subtitle as visually hidden region labels for accessibility; no visible branding header renders inside the workspace, and app chrome must not duplicate it.
- Timeline commands such as Play, Rewind, Undo, Redo, Split at playhead, add track actions, layout changes, and Save timeline live in the native Timeline menu bridge.
- Keyboard shortcut customization lives in Settings → Shortcuts, which renders the `Shortcut map` disclosure (`TimelineShortcutMap`). It must support remap, disable, reset, validation, persistence, and `role="status"` feedback; the Editing workspace consumes the stored preferences without rendering the remap surface.
- Save state must remain explicit. Local timeline mutations are unsaved until `saveTimeline` succeeds.

## Project And Media Dock

- The left dock is labeled `Project and media` and contains two tabs: `Project` for `ProjectRail` and `Media` for `AssetBin`.
- Default to `Project` unless an asset is selected, then reveal `Media`. Keep both tabs compact and dock scoped.
- Project cards should prioritize project name, local status, save state, and selection.
- The media view offers grid and list presentations. Grid tiles use a 16:9 preview well with an uppercase kind label and a mono duration badge, with the asset name and size below; list rows use a small kind thumb, name, and right-aligned mono duration. Both must show media kind, asset name, duration or metadata status, and selection, and video/audio stay distinguished with text labels and subtle tint, not hue alone.
- An empty media library renders as a dashed import drop-zone CTA; a missing project keeps the existing empty slate.
- Assets must show `Reading metadata` until browser metadata has been persisted through `updateAssetMetadata`.
- `AssetMetadataProbeHost` is hidden infrastructure outside the dock panels. It may request secure playback URLs and probe browser metadata, but it must not become visible UI or imply analysis beyond local duration and video dimensions.

## Program Monitor

- The central program region is the largest panel. It contains the `ProgramMonitor` preview surface with a visually hidden heading; no visible header row sits above the monitor.
- The monitor is for local timeline review. It is a best-effort v3 evaluator surface for keyframes, transitions, and audio mix, not final mastering, frame-perfect export, cloud preview, or AI generation.
- MP4 export is a compact control in the monitor transport row: a primary Export trigger that opens a small popover with job state, progress, and Export/Cancel/Open/Reveal actions. It may show job state and result actions, but never local output paths, FFmpeg executable paths, or FFmpeg argv.
- Empty states may be expressive, but they must guide users toward creating a project, importing assets, or selecting timeline media.
- The monitor remains visible while users switch side dock tabs. It is the stable review surface for the current playhead and active timeline media.

## Inspector

- The right inspector is tabbed with `Selection`, `Asset`, and `Project` sections.
- Default to `Selection` when a timeline clip is selected, `Asset` when an asset is selected, and `Project` otherwise.
- Disable inspector tabs that cannot produce useful content. With no project, only `Project` stays available. Keep `Asset` unavailable while imported metadata is still pending.
- `Selection` owns selected clip controls. `Asset` owns imported media metadata. `Project` owns current project metadata and project deletion.
- Inspector content uses collapsible property groups separated by hairline borders: an xs medium group title with a −/+ toggle, and label/value property rows (caption muted label on the left, mono value or quiet compact input on the right). Selected-clip trim/nudge actions render as a compact two-column button grid above the groups.
- Clip controls belong here when they affect the selected clip. Timeline wide commands belong in the native Timeline menu bridge.
- Keep destructive actions visually distinct with the danger color and clear labels.
- Keep the inspector status card visible below the tab panels. Status messages use `role="status"` and must stay readable after any tab switch.

## Bottom Timeline

- The timeline is the bottom anchor of the editor. It spans the full workspace width on desktop.
- Track lanes are flat rounded inset wells separated by small gaps, under a slim mono ruler. The playhead is a neutral foreground hairline with a round scrub-dot handle in the ruler. Clip blocks encode media kind with text labels plus tinted fills and borders, and reveal primary-colored grip trim handles on hover/selection.
- Clip blocks show asset name and duration. Trim handles stay visible enough to discover, but should not dominate the clip label.
- Timeline interactions must read as local edits. Do not suggest non-existent cloud sync, unsupported render formats, or frame-perfect mastering guarantees.
- The timeline remains visible while users switch side dock tabs. It is not part of the left dock or inspector tab systems.

## Local UI Primitives

- Keep shared UI primitives lightweight and renderer local: `Button`, `Panel`, `PanelHeading`, `MetadataList`, `StatusCard`, `Tabs`, `TabPanel`, and `classNames`.
- Prefer composition over broad component APIs. Primitives should wrap semantics, class names, and small variants, not own editor business rules.
- `Button` variants are limited to default, primary, record, stop, and ghost. Add new variants only when a repeated local workflow needs a distinct semantic tone.
- `MetadataList` is for compact term and value facts. Use it for project, asset, clip, runtime, and result metadata rather than ad hoc grids.
- `StatusCard` is for user visible status with success, warning, danger, or default tone. Do not hide busy, warning, or error states in copy outside the visible card.
- `Tabs` and `TabPanel` are the only tab primitives. Use them for Edit workspace dock scoped navigation, not for major workspace regions. Application workspace switching belongs to Home entry cards.

## Theme System

- The renderer uses semantic theme tokens: `--background`, `--foreground`, `--card`, `--primary`, `--secondary`, `--muted`, `--accent`, `--destructive`, `--success`, `--warning`, `--info`, `--border`, `--input`, and `--ring`.
- The Issue #63 foundation is a neutral near-white/near-black surface stack: light `#f8f8f8` canvas with `#fcfcfc`/`#ffffff` panels, dark `#101010` canvas with `#161616`/`#1c1c1c` panels, hairline borders, and hex text tiers (`--text-strong` / `--text-weak` / `--text-weaker`, mirrored by `--color-faint`) that all hold WCAG AA against the surfaces they sit on.
- Presets only swap accent and surface temperature on top of that foundation. `daylight-glass` keeps the warm command desk light identity (ivory canvas, copper primary, cyan review accent); `dark-zinc` is the neutral dark identity; `midnight-neon` and `obsidian-pro` stay expressive alternates with light and dark variants.
- The typography scale is pixel-locked by role: 11px micro, 12px caption, 13px small, 14px body, 15px subhead, 17px title, and a clamped hero. Headings sit at weight 500–600 with tight (−0.01em to −0.02em) tracking; weight 700 is reserved for tiny uppercase labels. Uppercase mono metadata uses restrained letter-spacing (0.04–0.08em).
- Elevation is layered and low-alpha with a single top light source (`--shadow-control`, `--shadow-panel`, `--shadow-editorial`). Panels are flat cards — no glass blur, canvas grids, or decorative gradients.
- Light and dark themes must read as distinct operating environments at the root token level. `--background`, `--card`, `--muted`, `--border`, `--input`, `--shadow-panel`, and `--surface-control` should differ enough that Home, Settings, Program Monitor, timeline, inspector, tabs, and Agent Chat remain visually distinguishable without component-specific overrides.
- Theme-specific presentation belongs in renderer CSS. React theme controls should expose semantic state with class names, `aria-*`, `data-*`, and fixed preset identifiers; they should not carry layout, panel, or control styling inline. Fixed visual marks such as preset swatches may use CSS classes keyed by stable preset ids.
- The persisted preset id `daylight-glass` remains a compatibility identifier only. Do not rename it. User-facing copy may describe that light preset as Command Desk, but compatibility identifiers listed in `AGENTS.md` must remain stable.
- `dark-zinc` remains the dark fallback preset and `daylight-glass` remains the light fallback preset. Missing, invalid, or mode-incompatible presets must continue to resolve to those compatibility ids.
- Legacy `--editor-*` and `--color-*` names are aliases over the semantic tokens. Keep new styling on semantic tokens and only use aliases to match existing renderer classes.
- Atmosphere, panels, timeline grids, controls, tabs, and selected states use color for semantic hierarchy and interaction, not decoration. Pair hue with contrast, opacity, borders, shadows, labels, and subtle patterns so media kind is never signaled by color alone.

## Reference Design Refinement Contract

- Keep the product direction original, restrained, and local first. The refinement may borrow from generic public design principles such as hierarchy, rhythm, contrast, editorial spacing, and neutral surface systems common to modern desktop agent tools, but it must not borrow third party brand expression.
- Preserve OpenVideo as an expressive light and dark desktop NLE. Do not change the product into a cloud editor, provider console, marketing dashboard, or generative media suite.
- Strengthen hierarchy through scale, weight, placement, and concise labels. Program monitor, timeline, dock tabs, inspector tabs, Agent Chat, and Home workspace entry cards should each have one clear job and a visible reading order.
- Use measured whitespace, not empty decoration. Give the monitor and timeline enough breathing room to feel primary, keep command clusters tight, and separate dock, inspector, chat, and status content with consistent gaps.
- Build surface depth with semantic theme tokens only: flat card panels, hairline borders, inset wells, and the layered low-alpha shadow scale. Dark surfaces remain cool and readable without reducing NLE contrast.
- Keep navigation clarity accessible. Home workspace entry cards need visible labels, static local status, `aria-controls`, and focus movement to the active mounted region.
- Preserve mounted workspace state retention. Visual refinements must keep inactive Editing, Voice Generation, and Video Generation regions hidden rather than unmounted.
- Keep compact controls and focus treatment intact. Shortcut map controls stay dense, tabs stay compact, and the 2px focus outline with 2px offset and 4px halo remains visible in both themes. Default controls use the 36px minimum height; compact controls use 30px.
- Respect reduced motion. Any hover lift, reveal, or panel transition must stay short and must not override `prefers-reduced-motion`.
- Third party brand elements are excluded: no borrowed names, color values, logos, typography, copy, layouts, gradients, or token names.

## Theme Switching

- `bootstrapRendererTheme` applies the resolved mode before React mounts by setting `document.documentElement.dataset.theme` and `document.documentElement.style.colorScheme`.
- `bootstrapRendererTheme` also applies the resolved preset through `document.documentElement.dataset.preset`; visual CSS may branch from `data-theme` and `data-preset`, but JavaScript behavior must keep the same parser/resolver path.
- Missing, invalid, or unreadable stored preferences resolve to `system`. The system mode comes from `window.matchMedia('(prefers-color-scheme: dark)')`, with light as the non-browser fallback.
- The persisted key is `window-loom-theme`. Only explicit `light` or `dark` values are stored. Toggling from a system-resolved mode stores the opposite explicit mode.
- The persisted preset key is `window-loom-theme-preset`. Keep `dark-zinc`, `daylight-glass`, `midnight-neon`, and `obsidian-pro` as the complete stable preset id set until a separate migration is designed.
- `ThemeProvider` listens for system preference changes while the current preference is `system`, then reapplies the resolved mode through the same root `data-theme` path.
- The product chrome theme control is a compact ghost `Button` with `role="switch"`, `aria-checked={mode === 'dark'}`, visible `Theme` and current mode text, and an aria label that names the current mode and active preset. Clicking opens the preset dialog; pressing Space on the focused switch toggles the explicit light/dark mode.

## Type, Status, And Motion

- Titles use the display stack. Controls use the body stack. Metadata, section kickers, timers, command labels, media badges, tab labels, and theme switch text use monospace.
- Status semantics stay restrained: default is muted graphite, success is green, warning or busy is amber, and danger or destructive states are red. Use these only for state, not decoration.
- Home workspace entry icons are decorative inline SVGs with `aria-hidden="true"`; accessible names come from visible labels and existing button semantics, not from icon-only controls.
- Video and audio clips use flat tinted fills with solid semantic borders (primary tint for video, success tint for audio). Both must keep visible `Video` or `Audio` text labels, so media kind never depends on hue alone.
- Controls should feel tactile with subtle background and border changes on hover. Respect `prefers-reduced-motion` and keep transitions short.
- Compact controls use the 30px minimum. Default controls use the 36px minimum where space allows. Tabs are compact underline tabs; the selected tab carries the accent underline and an `Active` marker.

## Accessibility Rules

- Preserve semantic regions and labels: `product-chrome`, `Home`, `Settings`, `OpenVideo workspaces`, `Project and media`, `Timeline editor`, inspector, Voice Generation, and Video Generation. Timeline commands are available through the native menu bridge rather than as a renderer toolbar landmark.
- Keep keyboard focus visible with the semantic focus ring on Home workspace cards, workspace regions, buttons, timeline lanes, clips, inputs, and dock tabs. The implemented rule is a 2px `--focus-ring` outline, 2px offset, and 4px `--focus-shadow` halo.
- Maintain 36px default control height where space allows. Compact shortcut map buttons may be 30px because the customization grid is dense.
- Do not rely on color alone. Pair tones with labels such as video, audio, selected, saved, and metadata status, plus border or pattern changes where media kind differs.
- Dock and inspector tabs inside the Edit workspace must use the ARIA tab contract: `role="tablist"`, `role="tab"`, `role="tabpanel"`, `aria-selected`, `aria-controls`, and `aria-labelledby`.
- Use roving tab focus. The selected tab has `tabIndex=0`; inactive tabs have `tabIndex=-1`; disabled tabs are skipped.
- Tab keyboard support must include Left, Right, Up, Down, Home, and End. Arrow keys wrap through enabled tabs. Home and End jump to the first or last enabled tab.

## Local First Constraints

- No cloud upload, analytics, accounts, crash reporting, provider calls, or hidden network work may be implied by renderer copy.
- Voice Generation and Video Generation can import configured local results into the active project, but they remain local workspace regions with no cloud upload, account, analytics, or hidden provider implication.
- Local Qwen narration depends on user provided local runtime configuration. The renderer must not claim bundled models or automatic model setup.
- Local MP4 export depends on user provided FFmpeg availability through `VIDEO_TOOL_FFMPEG_PATH` or absolute `PATH` discovery. The renderer must not claim bundled FFmpeg, cloud export, multiple formats, or access to filesystem paths.
- Provider seams for future Gemini Veo, OpenAI Sora, and ElevenLabs support are interfaces only unless implementation changes prove otherwise.

## OpenCut Reference Boundary

OpenCut is high level inspiration for local asset and timeline UX only. OpenVideo must not copy or claim OpenCut code, assets, branding, exact visual identity, interaction details, or unsupported feature scope. Any future reference to OpenCut must state that no OpenCut source, dependency, artwork, logo, name treatment, or branded design system is used in this renderer.

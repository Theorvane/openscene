# OpenVideo Design System

OpenVideo is a compact local editing bay with a bright technical editor theme called Daylight Glass. The renderer should feel like a precise desktop NLE console for arranging local recordings, imported media, and narration, not like a cloud video generator or generic web dashboard.

## Core Principles

- Treat the timeline editor as the default workspace. Edit, Screen Recording, and Voice Generation are persistent top level local workspaces reached through the left sidebar navigation.
- Keep every renderer claim local. Projects, recordings, imports, voice samples, and timeline edits stay on the user's machine.
- Never expose raw local filesystem paths in renderer UI for imported timeline assets. Show names, durations, media kind, status, and secure playback URLs only when playback needs them.
- Use dense but readable panels with mono section kickers, serif titles, clear control labels, and compact metadata.
- Do not present cloud generation, provider integrations, unsupported formats, or frame-perfect mastering guarantees as implemented until the code supports them.

## Layout Contract

- `product-chrome` is a compact top bar with the current workspace, a concise `Local` indicator, and the theme switch. Do not duplicate the OpenVideo identity here; the active Edit program header owns product branding.
- `local-edit-bay` owns the application workspace grid: a left sidebar for workspace navigation and a single active workspace panel on the right.
- Workspace panels for Edit, Screen Recording, and Voice Generation stay mounted while inactive. Hide inactive panels with the platform `hidden` state rather than unmounting them, so recording sessions, sample capture, local TTS job state, and timeline editor state survive navigation.
- The left sidebar navigation is labeled `Application workspaces` and lists exactly `Edit`, `Screen Recording`, and `Voice Generation`. It is navigation, not dock tabs and not a collapsed disclosure group. MP4 export lives inside the Edit workspace because it acts on the saved local timeline.
- `editor-workspace--nle` uses a desktop NLE grid: tabbed project/media dock on the left, persistent program monitor in the center, tabbed inspector on the right, and persistent timeline across the bottom. Timeline commands are routed through the native application menu, not an in-workspace command bar.
- Project/media dock tabs and inspector tabs exist only inside the Edit workspace. Never use those tabs for switching to Screen Recording or Voice Generation, and never tab the monitor or timeline.
- On narrow screens, preserve the same order in a single column: program monitor, timeline, project/media dock tabs, inspector tabs.

## Workspace Navigation

- The left workspace navigation uses button items because each item switches mounted local application regions in place. Keep every item full width, left aligned, and labeled with a small original inline SVG icon, workspace name, and short static `Local` status label.
- Status labels are fixed product labels, not live progress text: `Local` is sufficient in the navigation and product chrome. Live recording, sample, TTS, save, or error status stays inside the active workspace panel.
- The active workspace item uses the primary button tone, `aria-current="page"`, `aria-controls` for its panel, and visible compact `Current` text. Do not rely on color or fill alone to show the active workspace.
- Keyboard support wraps vertically through enabled workspace items with Arrow Up and Arrow Down. Home moves to Edit, End moves to Voice Generation.
- When users activate a different workspace, focus moves to the newly active region. When they activate the already current workspace, focus returns to that region.

## Program Header And Command Surface

- The Program header owns `Local studio`, `OpenVideo`, and the visible `Timeline editor` subtitle. App chrome must not duplicate this branding.
- Timeline commands such as Play, Rewind, Undo, Redo, Split at playhead, add track actions, layout changes, and Save timeline live in the native Timeline menu bridge.
- The only visible command customization surface in the workspace is the Program header `Shortcut map` disclosure. It must support remap, disable, reset, validation, persistence, and `role="status"` feedback.
- Save state must remain explicit. Local timeline mutations are unsaved until `saveTimeline` succeeds.

## Project And Media Dock

- The left dock is labeled `Project and media` and contains two tabs: `Project` for `ProjectRail` and `Media` for `AssetBin`.
- Default to `Project` unless an asset is selected, then reveal `Media`. Keep both tabs compact and dock scoped.
- Project cards should prioritize project name, local status, save state, and selection.
- Asset cards should show media kind, asset name, duration or metadata status, and selection. Video and audio are distinguished with labels, border treatment, and pattern, not bright accent colors.
- Assets must show `Reading metadata` until browser metadata has been persisted through `updateAssetMetadata`.
- `AssetMetadataProbeHost` is hidden infrastructure outside the dock panels. It may request secure playback URLs and probe browser metadata, but it must not become visible UI or imply analysis beyond local duration and video dimensions.

## Program Monitor

- The central program region is the largest panel. It contains the `Timeline editor` heading and `ProgramMonitor` preview surface.
- The monitor is for local timeline review. It is a best-effort v3 evaluator surface for keyframes, transitions, and audio mix, not final mastering, frame-perfect export, cloud preview, or AI generation.
- The MP4 export panel is the local final-output surface for supported saved timelines. It may show job state, progress, cancel, open, and reveal controls, but never local output paths, FFmpeg executable paths, or FFmpeg argv.
- Empty states may be expressive, but they must guide users toward creating a project, importing assets, or selecting timeline media.
- The monitor remains visible while users switch side dock tabs. It is the stable review surface for the current playhead and active timeline media.

## Inspector

- The right inspector is tabbed with `Selection`, `Asset`, and `Project` sections.
- Default to `Selection` when a timeline clip is selected, `Asset` when an asset is selected, and `Project` otherwise.
- Disable inspector tabs that cannot produce useful content. With no project, only `Project` stays available. Keep `Asset` unavailable while imported metadata is still pending.
- `Selection` owns selected clip controls. `Asset` owns imported media metadata. `Project` owns current project metadata and project deletion.
- Clip controls belong here when they affect the selected clip. Timeline wide commands belong in the native Timeline menu bridge.
- Keep destructive actions visually distinct with the danger color and clear labels.
- Keep the inspector status card visible below the tab panels. Status messages use `role="status"` and must stay readable after any tab switch.

## Bottom Timeline

- The timeline is the bottom anchor of the editor. It spans the full workspace width on desktop.
- Track lanes use a time grid, sticky ruler, visible slate or parchment playhead, and clip blocks that encode media kind with text, border treatment, and pattern.
- Clip blocks show asset name and duration. Trim handles stay visible enough to discover, but should not dominate the clip label.
- Timeline interactions must read as local edits. Do not suggest non-existent cloud sync, unsupported render formats, or frame-perfect mastering guarantees.
- The timeline remains visible while users switch side dock tabs. It is not part of the left dock or inspector tab systems.

## Local UI Primitives

- Keep shared UI primitives lightweight and renderer local: `Button`, `Panel`, `PanelHeading`, `MetadataList`, `StatusCard`, `Tabs`, `TabPanel`, and `classNames`.
- Prefer composition over broad component APIs. Primitives should wrap semantics, class names, and small variants, not own editor business rules.
- `Button` variants are limited to default, primary, record, stop, and ghost. Add new variants only when a repeated local workflow needs a distinct semantic tone.
- `MetadataList` is for compact term and value facts. Use it for project, asset, clip, runtime, and result metadata rather than ad hoc grids.
- `StatusCard` is for user visible status with success, warning, danger, or default tone. Do not hide busy, warning, or error states in copy outside the visible card.
- `Tabs` and `TabPanel` are the only tab primitives. Use them for Edit workspace dock scoped navigation, not for major workspace regions. Application workspace switching belongs to `AppWorkspaceNavigation`.

## Theme System

- The renderer uses semantic theme tokens: `--background`, `--foreground`, `--card`, `--primary`, `--secondary`, `--muted`, `--accent`, `--destructive`, `--success`, `--warning`, `--info`, `--border`, `--input`, and `--ring`.
- Light mode is the Issue #5 visual contract: a white or off-white canvas, subtle lilac technical grid, navy typography, blue-purple-pink gradient accents, translucent glass panels, thin lavender borders, and restrained soft shadows.
- Dark mode uses a cool slate and green tinted canvas, deep teal primary actions, cool cyan interaction and focus accents, pale editorial foreground, and layered cards that remain visibly non monochrome without reducing NLE contrast.
- Legacy `--color-*` names are aliases over semantic tokens. Keep new styling on semantic tokens and only use aliases to match existing renderer classes.
- Atmosphere, panels, timeline grids, controls, tabs, and selected states use color for semantic hierarchy and interaction, not decoration. Pair hue with contrast, opacity, borders, shadows, labels, and subtle patterns so media kind is never signaled by color alone.

## Enterprise Editorial Refinement Contract

- Keep the product direction original, restrained, and local first. The refinement may borrow from generic public design principles such as hierarchy, rhythm, contrast, and editorial spacing, but it must not borrow third party brand expression.
- Preserve OpenVideo as an expressive light and dark desktop NLE with restrained enterprise editorial color. Do not change the product into a cloud editor, provider console, marketing dashboard, or generative media suite.
- Strengthen hierarchy through scale, weight, placement, and concise labels. Program monitor, timeline, dock tabs, inspector tabs, and workspace navigation should each have one clear job and a visible reading order.
- Use measured whitespace, not empty decoration. Give the monitor and timeline enough breathing room to feel primary, keep command clusters tight, and separate dock, inspector, and status content with consistent gaps.
- Build surface depth with semantic theme tokens only. Bright light surfaces may carry white glass, lilac grid texture, lavender hairline borders, soft shadows, opacity changes, and subtle hatch patterns, while dark surfaces remain cool and readable without reducing NLE contrast.
- Keep navigation clarity accessible. Workspace buttons need visible labels, static `Local` status, `Current` text, `aria-current`, `aria-controls`, keyboard wrapping, and focus movement to the active mounted region.
- Preserve mounted workspace state retention. Visual refinements must keep inactive Edit, Screen Recording, and Voice Generation regions hidden rather than unmounted.
- Keep compact controls and focus treatment intact. Shortcut map controls stay dense, tabs stay compact, and the 2px focus outline with 2px offset and 4px halo remains visible in both themes.
- Respect reduced motion. Any hover lift, reveal, or panel transition must stay short and must not override `prefers-reduced-motion`.
- Third party brand elements are excluded: no borrowed names, color values, logos, typography, copy, layouts, gradients, or token names.

## Theme Switching

- `bootstrapRendererTheme` applies the resolved mode before React mounts by setting `document.documentElement.dataset.theme` and `document.documentElement.style.colorScheme`.
- Missing, invalid, or unreadable stored preferences resolve to `system`. The system mode comes from `window.matchMedia('(prefers-color-scheme: dark)')`, with light as the non-browser fallback.
- The persisted key is `window-loom-theme`. Only explicit `light` or `dark` values are stored. Toggling from a system-resolved mode stores the opposite explicit mode.
- `ThemeProvider` listens for system preference changes while the current preference is `system`, then reapplies the resolved mode through the same root `data-theme` path.
- The product chrome theme control is a compact ghost `Button` with `role="switch"`, `aria-checked={mode === 'dark'}`, visible `Theme` and current mode text, and an aria label that names the current mode and next mode.

## Type, Status, And Motion

- Titles use the serif display stack. Controls use the body stack. Metadata, section kickers, timers, command labels, media badges, tab labels, and theme switch text use monospace.
- Status semantics stay restrained: default is muted slate, success is green, warning or busy is amber, and danger or destructive states are red. Use these only for state, not decoration.
- Application workspace navigation icons are decorative inline SVGs with `aria-hidden="true"`; accessible names come from visible labels and existing button semantics, not from icon-only controls.
- Video clips and media badges use solid semantic borders with angled hatch labels. Audio uses dashed borders and a different stripe direction. Both must keep visible `Video` or `Audio` text, and media kind must not depend on hue alone.
- Controls should feel tactile with small hover lift and border changes. Respect `prefers-reduced-motion` and keep transitions short.
- Compact controls use the 36px minimum. Default controls use the 42px minimum where space allows. Tabs are compact dashed pills until selected, then solid semantic selected pills with an `Active` marker.

## Accessibility Rules

- Preserve semantic regions and labels: `product-chrome`, `Application workspaces`, `Project and media`, `Timeline editor`, inspector, Screen Recording, and Voice Generation. Timeline commands are available through the native menu bridge rather than as a renderer toolbar landmark.
- Keep keyboard focus visible with the semantic focus ring on workspace navigation buttons, workspace regions, buttons, cards, timeline lanes, clips, inputs, and dock tabs. The implemented rule is a 2px `--focus-ring` outline, 2px offset, and 4px `--focus-shadow` halo.
- Maintain 42px default control height where space allows. Compact shortcut map buttons may be 36px because the customization grid is dense.
- Do not rely on color alone. Pair tones with labels such as video, audio, selected, saved, and metadata status, plus border or pattern changes where media kind differs.
- Dock and inspector tabs inside the Edit workspace must use the ARIA tab contract: `role="tablist"`, `role="tab"`, `role="tabpanel"`, `aria-selected`, `aria-controls`, and `aria-labelledby`.
- Use roving tab focus. The selected tab has `tabIndex=0`; inactive tabs have `tabIndex=-1`; disabled tabs are skipped.
- Tab keyboard support must include Left, Right, Up, Down, Home, and End. Arrow keys wrap through enabled tabs. Home and End jump to the first or last enabled tab.

## Local First Constraints

- No cloud upload, analytics, accounts, crash reporting, provider calls, or hidden network work may be implied by renderer copy.
- Screen Recording and Voice Generation can import local results into the active project, but they remain local workspace regions with no cloud, account, analytics, or provider implication.
- Local Qwen narration depends on user provided local runtime configuration. The renderer must not claim bundled models or automatic model setup.
- Local MP4 export depends on user provided FFmpeg availability through `VIDEO_TOOL_FFMPEG_PATH` or absolute `PATH` discovery. The renderer must not claim bundled FFmpeg, cloud export, multiple formats, or access to filesystem paths.
- Provider seams for future Gemini Veo, OpenAI Sora, and ElevenLabs support are interfaces only unless implementation changes prove otherwise.

## OpenCut Reference Boundary

OpenCut is high level inspiration for local asset and timeline UX only. OpenVideo must not copy or claim OpenCut code, assets, branding, exact visual identity, interaction details, or unsupported feature scope. Any future reference to OpenCut must state that no OpenCut source, dependency, artwork, logo, name treatment, or branded design system is used in this renderer.

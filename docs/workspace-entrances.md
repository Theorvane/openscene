# Editing and AI creation entrances

The project home offers two product-level entrances: Video Editing and AI Creation. Select one, then create or open a project. Desktop folder selection and mobile project creation honor the same selection as reopening an existing project. Merely choosing an entrance never opens a provider or starts a paid job.

Video Editing opens the timeline. AI Creation opens video generation, with Writer, image and voice tools in its own secondary navigation. Each space has its own identity header. The existing workspace switcher stays available, and retained panels preserve in-session drafts while switching. Returning to creation within a project restores the last creation tool; opening from home starts at that entrance's primary tool.

These are two views over the same project, not incompatible project formats or separate applications. Assets and timelines are not copied, filtered away or migrated. Generated media can still be handed to the editor explicitly. Existing persisted workspace identifiers are unchanged. Home entrance selection is session-local and initially editing; it is not a permanent project classification. Chat history retains its existing conversation-opening behavior.

The same entrance definitions and routing targets live in `src/shared/workspaceModes.ts` and are consumed by desktop and mobile. Native mobile screen exercise remains required before merge when a development client is available.

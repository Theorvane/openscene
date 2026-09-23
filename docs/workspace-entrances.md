# Editing and generation project types

New projects persist `projectType: editing | generation`. The home cards select the type for creation and filter existing projects. Opening an existing folder always honors its stored type; selecting a different card never rewrites it. Editor projects open the timeline; generation projects expose the numbered Script → Images → Video → Voice workflow and shared media library. Project type cannot be switched in the UI.

Legacy projects without this field remain mixed projects, visibly labelled in both lists with their existing workspace switcher. No type is inferred from assets or AI fields, so mixed projects do not silently lose access to either workflow. Their timelines, prompts and assets are preserved on read/save. Unknown explicit types fail validation. This additive field remains under schema 4; older strict desktop versions may reject typed projects, so keep backups before downgrading.

## Send to editing

The generation workspace offers **Create editing project**. After confirmation it copies all saved project media bytes into a new editing project. It never moves or deletes the source. The editing timeline starts empty: this is a media handoff, not an automatic assembly or timeline clone. Prompts and generation history stay in the source project. Desktop uses the private local project store; mobile uses app storage. Disk space is needed for the copies. Missing media fails visibly; partial new destinations are cleaned up when possible, with the source unchanged. There is no live synchronization between projects.

Navigation type is a product workflow boundary, not an IPC authorization boundary. Existing agent/storage timeline operations remain available; they are not reclassified as security permissions.

Desktop and mobile share type resolution rules. Existing persisted navigation keys are unchanged. No provider is called by creation, navigation or media handoff. Native mobile screen and file-copy exercise remains required before merge when a development client is connected.

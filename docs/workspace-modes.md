# Video Editing and AI Creation

OpenScene starts on **Projects**, where a new project is saved as either Video Editing or AI Creation. Opening an existing project uses its saved type. The two workspaces share project, asset and timeline rules in `src/shared/`, but they present different starting workflows.

![Projects page with both project types](assets/screenshot-projects.png)

## Video Editing

Import local footage, arrange it on the timeline, review it in the Program Monitor, and export through local FFmpeg. The Edit Agent is docked beside the editor. [See the editing workspace](../README.md#editing).

## AI Creation

AI Creation starts at **Plan your film**. Enter a production brief, choose a target length, and choose one of two routes:

1. **Plan the whole film** proposes a screenplay and scene plan for review before you generate takes.
2. **Build scene by scene** lets you finish one scene and then decide the next one.

The planned sequence uses five-second shot units. A provider may produce a longer supported clip; its output still needs review and placement. A writing request, a video generation request, candidate approval and final assembly are separate steps. None is triggered by entering a workspace or selecting a shot.

![AI Creation start screen](assets/screenshot-video.png)

**Make a single clip instead** opens the shot workbench without a full plan. **Advanced tools** contains Story, Scenes (Video takes and Reference frames), and Voice & captions. A saved video result enters the shared project media library; it does not silently replace a timeline clip. The project sequence distinguishes planned timing, unplaced takes, placed voice and captions. Saving an arrangement and exporting are explicit operations.

**Create editing project** makes an editing copy when the generation project is ready for timeline finishing. The source generation project and its prompts stay intact; the new editing timeline starts empty. Review its media placement before export.

## Voice and platform limits

Qwen3-TTS is the default local voice model on desktop and needs a [user-configured wrapper and authorized reference sample](local-qwen-tts.md). VieNeu-TTS is a separate selectable local choice and starts only when selected. Cloud voice models require their own connection. Mobile can prepare and approve narration and captions, but speech synthesis and desktop-local runtimes are unavailable there.

Switching views does not authorize provider spending. Provider consent and model capability checks happen at the generation action. Desktop and mobile read the same shared project rules; platform-bound operations stay visible with a reason when unavailable.

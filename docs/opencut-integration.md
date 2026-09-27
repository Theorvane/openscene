# OpenCut integration workspace

OpenScene tracks the MIT-licensed [Theorvane/OpenCut](https://github.com/Theorvane/OpenCut)
fork at `external/opencut` as a pinned Git submodule. Its upstream is
[OpenCut-app/OpenCut](https://github.com/OpenCut-app/OpenCut). The submodule
keeps OpenCut's history, license, and future changes separate from OpenScene.

After cloning OpenScene, initialize it only when working on this integration:

```bash
git submodule update --init external/opencut
```

Make OpenCut-specific changes on a branch of the fork, merge them there, then
update the submodule pointer in an OpenScene pull request. Review both changes
and cite the fork commit in the OpenScene PR. The OpenScene build does not
compile or package the submodule.

## Current boundary

At the pinned revision, OpenCut is a rewrite in progress: its web editor route
says “Coming soon” and its desktop timeline is a placeholder panel. OpenScene
continues to use its own timeline, preview, export pipeline, and agent tools.
The submodule does not add a user-facing feature, cloud call, or build
dependency.

Any runtime connection must first define a portable timeline and asset
contract in `src/shared/`. Desktop and mobile must call the same editing
rules, or the unsupported surface must show why the feature is disabled.
Keep local file paths and FFmpeg execution in Electron main; do not pass raw
paths or IPC into the renderer or a submodule web app. Preserve OpenScene's
approval and provider boundaries before wiring any OpenCut UI or engine code.

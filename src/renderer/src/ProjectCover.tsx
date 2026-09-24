import { useEffect, useState, type ReactElement } from 'react';

export function ProjectCover({ projectId, updatedAt }: { readonly projectId: string; readonly updatedAt: string }): ReactElement {
  const [cover, setCover] = useState<{ readonly url: string | null; readonly label: string }>({ url: null, label: 'LOADING LOCAL COVER' });
  useEffect(() => {
    let live = true;
    setCover({ url: null, label: 'LOADING LOCAL COVER' });
    // Project lookup only reads the local snapshot. It does not switch the editor's open project.
    void window.videoTool.openProject({ projectId }).then(async (result) => {
      if (!live) return;
      if (!result.ok) { setCover({ url: null, label: 'COVER UNAVAILABLE' }); return; }
      const image = result.value.assets.find((asset) => asset.kind === 'image');
      if (!image) { setCover({ url: null, label: 'NO IMAGE COVER' }); return; }
      const playback = await window.videoTool.getAssetPlaybackUrl({ projectId, assetId: image.id });
      if (live) setCover(playback.ok ? { url: playback.value.url, label: `${result.value.assets.length} LOCAL MEDIA ASSETS` } : { url: null, label: 'COVER UNAVAILABLE' });
    }).catch(() => { if (live) setCover({ url: null, label: 'COVER UNAVAILABLE' }); });
    return () => { live = false; };
  }, [projectId, updatedAt]);
  return <span className="project-card__cover">{cover.url && <img src={cover.url} alt="" onError={() => setCover({ url: null, label: 'COVER UNAVAILABLE' })} />}
    <span>{cover.label}</span>
  </span>;
}

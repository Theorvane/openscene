import type { AiProjectDocument } from '../../shared/aiProjectDomain';
import type { ProductionEditorAsset } from '../../shared/productionEditor';
import { productionCompanions } from '../../shared/productionCompanions';
import { useProjectResultImport } from './ProjectResultImportContext';

export function ProductionCompanions({ document, assets, disabled, onSelect }: {
  document: AiProjectDocument; assets: readonly ProductionEditorAsset[]; disabled: boolean;
  onSelect: (tool: 'image' | 'voice') => void;
}) {
  const { timeline } = useProjectResultImport();
  const status = productionCompanions(document, assets, timeline);
  return <section className="production-companions" aria-label="Frames, voice and captions">
    <h3>Build the rest of your film</h3>
    <div><h4>Reference frames</h4><p>{status.frames}/{status.shots} planned shots have a saved first frame. Generate and attach shot frames in the production board below, or open the image tool for custom references.</p>
      <button className="button" disabled={disabled} onClick={() => onSelect('image')}>Open reference image tool</button></div>
    <div><h4>Voice & captions</h4><p>{status.voiceMessage}</p>
      <p>{status.audioAssets} saved audio assets · {status.placedAudioAssets} placed in this arrangement. Placement alone does not confirm synchronization.</p>
      <button className="button" disabled={disabled} onClick={() => onSelect('voice')}>Prepare voice & captions</button></div>
    <p>Opening a tool never starts a paid operation. Review narration and approve synthesis separately.</p>
  </section>;
}

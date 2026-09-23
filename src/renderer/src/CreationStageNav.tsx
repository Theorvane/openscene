import { CREATION_STAGES, SCENE_TOOLS, creationStageForTool, creationStudioStatus } from '../../shared/creationStudio';
import type { CreationTool } from '../../shared/workspaceModes';
import type { AiProjectDocument } from '../../shared/aiProjectDomain';
import type { ProductionEditorAsset } from '../../shared/productionEditor';

export function CreationStageNav({ tool, onSelect, document, assets }: { tool: CreationTool; onSelect: (tool: CreationTool) => void; document: AiProjectDocument | null | undefined; assets: readonly ProductionEditorAsset[] }) {
  const stage = creationStageForTool(tool);
  const status = creationStudioStatus(document, assets);
  return <div className="creation-stage-nav">
    <div className="creation-stage-heading"><strong>Production studio</strong><span>One story · shared media · one sequence</span></div>
    <nav aria-label="Production stages" className="creation-stage-buttons">
      {CREATION_STAGES.map(entry => <button key={entry.id} type="button" aria-label={entry.label} aria-pressed={stage.id === entry.id}
        onClick={() => onSelect(stage.id === entry.id ? tool : entry.tool)}>{entry.label}<small>{status[entry.id]}</small></button>)}
    </nav>
    <div className="creation-stage-context">
      <span>{stage.description}</span>
      {stage.id === 'scenes' && <div role="group" aria-label="Scene tools">{SCENE_TOOLS.map(entry => <button key={entry.id} type="button" aria-pressed={tool === entry.id} onClick={() => onSelect(entry.id)}>{entry.label}</button>)}</div>}
    </div>
  </div>;
}

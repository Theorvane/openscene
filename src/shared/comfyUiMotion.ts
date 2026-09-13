export const MOTION_CONTROL_MODES = ['move', 'mix'] as const;
export type MotionControlMode = (typeof MOTION_CONTROL_MODES)[number];

export const COMFYUI_MOTION_NODE_TITLES = {
  characterImage: 'OpenScene Character Image',
  drivingVideo: 'OpenScene Driving Video',
  prompt: 'OpenScene Prompt',
  output: 'OpenScene Output'
} as const;

export type ComfyUiApiNode = {
  readonly class_type: string;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly _meta?: { readonly title?: string };
};

export type ComfyUiApiWorkflow = Readonly<Record<string, ComfyUiApiNode>>;

export type ComfyUiMotionWorkflowSummary = {
  readonly nodeCount: number;
  readonly requiredClassTypes: readonly string[];
  readonly outputNodeId?: string;
};

export type ComfyUiMotionModeStatus = {
  readonly configured: boolean;
  readonly ready: boolean;
  readonly reason?: string;
};

export type ComfyUiMotionWorkerStatus = {
  readonly state: 'ready' | 'unconfigured' | 'offline' | 'invalid';
  readonly endpoint: string;
  readonly version?: string;
  readonly deviceName?: string;
  readonly totalVramMb?: number;
  readonly freeVramMb?: number;
  readonly modes: Readonly<Record<MotionControlMode, ComfyUiMotionModeStatus>>;
  readonly reason?: string;
};

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nodeTitle(node: ComfyUiApiNode): string | undefined {
  return node._meta?.title?.trim();
}

/** Parse ComfyUI's API-format workflow, never its browser-only graph format. */
export function parseComfyUiApiWorkflow(value: unknown): ComfyUiApiWorkflow {
  const container = recordValue(value);
  const raw = recordValue(container?.prompt) ?? container;
  if (raw === null || Object.keys(raw).length === 0) {
    throw new Error('The ComfyUI workflow is empty. Export it with “Save (API Format)”.');
  }

  const workflow: Record<string, ComfyUiApiNode> = {};
  for (const [id, candidate] of Object.entries(raw)) {
    const node = recordValue(candidate);
    const inputs = recordValue(node?.inputs);
    if (node === null || typeof node.class_type !== 'string' || node.class_type.trim().length === 0 || inputs === null) {
      throw new Error(`ComfyUI node ${id} is not in API format.`);
    }
    const meta = recordValue(node._meta);
    workflow[id] = {
      class_type: node.class_type,
      inputs,
      ...(typeof meta?.title === 'string' ? { _meta: { title: meta.title } } : {})
    };
  }
  return workflow;
}

function findMarkedNode(
  workflow: ComfyUiApiWorkflow,
  title: string,
  required: boolean
): readonly [string, ComfyUiApiNode] | undefined {
  const matches = Object.entries(workflow).filter(([, node]) => nodeTitle(node) === title);
  if (matches.length > 1) throw new Error(`Workflow contains more than one “${title}” node.`);
  if (required && matches.length === 0) throw new Error(`Workflow is missing the “${title}” node title.`);
  return matches[0];
}

function patchFirstInput(
  node: ComfyUiApiNode,
  acceptedKeys: readonly string[],
  value: string,
  title: string
): ComfyUiApiNode {
  const key = acceptedKeys.find((candidate) => Object.hasOwn(node.inputs, candidate));
  if (key === undefined) {
    throw new Error(`The “${title}” node needs one of these inputs: ${acceptedKeys.join(', ')}.`);
  }
  return { ...node, inputs: { ...node.inputs, [key]: value } };
}

export function inspectComfyUiMotionWorkflow(workflow: ComfyUiApiWorkflow): ComfyUiMotionWorkflowSummary {
  findMarkedNode(workflow, COMFYUI_MOTION_NODE_TITLES.characterImage, true);
  findMarkedNode(workflow, COMFYUI_MOTION_NODE_TITLES.drivingVideo, true);
  findMarkedNode(workflow, COMFYUI_MOTION_NODE_TITLES.prompt, false);
  const output = findMarkedNode(workflow, COMFYUI_MOTION_NODE_TITLES.output, false);
  return {
    nodeCount: Object.keys(workflow).length,
    requiredClassTypes: [...new Set(Object.values(workflow).map((node) => node.class_type))].sort(),
    ...(output === undefined ? {} : { outputNodeId: output[0] })
  };
}

/** Patch only explicitly titled nodes so upstream workflow updates remain reviewable. */
export function compileComfyUiMotionWorkflow(input: {
  readonly workflow: ComfyUiApiWorkflow;
  readonly characterImageName: string;
  readonly drivingVideoName: string;
  readonly prompt?: string;
}): { readonly prompt: ComfyUiApiWorkflow; readonly summary: ComfyUiMotionWorkflowSummary } {
  const summary = inspectComfyUiMotionWorkflow(input.workflow);
  const character = findMarkedNode(input.workflow, COMFYUI_MOTION_NODE_TITLES.characterImage, true)!;
  const driving = findMarkedNode(input.workflow, COMFYUI_MOTION_NODE_TITLES.drivingVideo, true)!;
  const promptNode = findMarkedNode(input.workflow, COMFYUI_MOTION_NODE_TITLES.prompt, false);
  const patched: Record<string, ComfyUiApiNode> = { ...input.workflow };
  patched[character[0]] = patchFirstInput(character[1], ['image', 'filename'], input.characterImageName, COMFYUI_MOTION_NODE_TITLES.characterImage);
  patched[driving[0]] = patchFirstInput(driving[1], ['video', 'file', 'filename'], input.drivingVideoName, COMFYUI_MOTION_NODE_TITLES.drivingVideo);
  if (promptNode !== undefined && input.prompt !== undefined) {
    patched[promptNode[0]] = patchFirstInput(promptNode[1], ['text', 'prompt'], input.prompt, COMFYUI_MOTION_NODE_TITLES.prompt);
  }
  return { prompt: patched, summary };
}

export function isMotionControlMode(value: unknown): value is MotionControlMode {
  return typeof value === 'string' && (MOTION_CONTROL_MODES as readonly string[]).includes(value);
}

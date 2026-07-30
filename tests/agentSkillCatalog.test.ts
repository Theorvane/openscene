import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SKILLS_DIR = resolve(process.cwd(), '.agents/skills');
const mcpSource = readFileSync(resolve(process.cwd(), 'src/main/openVideoMcpServer.ts'), 'utf8');

/** Every tool the MCP server actually defines, from its decorated methods. */
const definedTools = new Set(
  [...mcpSource.matchAll(/@McpTool\(\{[\s\S]*?\n  (?:async )?([A-Za-z0-9_]+)\(params/g)].map((match) => match[1])
);

type Skill = { readonly name: string; readonly body: string; readonly allowedTools: readonly string[] };

function loadSkills(): readonly Skill[] {
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const path = resolve(SKILLS_DIR, entry.name, 'SKILL.md');
      const body = existsSync(path) ? readFileSync(path, 'utf8') : '';
      const match = body.match(/^allowed-tools:\s*(.+)$/m);
      return {
        name: entry.name,
        body,
        allowedTools: (match?.[1] ?? '')
          .split(',')
          .map((tool) => tool.trim())
          .filter((tool) => tool.length > 0)
      };
    });
}

const skills = loadSkills();

describe('agent skill catalog', () => {
  it('found the skills to check', () => {
    expect(definedTools.size).toBeGreaterThan(10);
    expect(skills.map((skill) => skill.name)).toContain('video-from-scenario');
    expect(skills.map((skill) => skill.name)).toContain('narration-to-timeline');
    expect(skills.map((skill) => skill.name)).toContain('cut-review');
  });

  it('gives every skill a SKILL.md', () => {
    for (const skill of skills) {
      expect(skill.body.length, `${skill.name} has an empty or missing SKILL.md`).toBeGreaterThan(200);
    }
  });

  it('never names a tool the MCP server does not define', () => {
    // A skill promising a tool that does not exist sends the agent hunting for
    // it mid-task, and the failure then reads as a model problem rather than a
    // documentation one.
    for (const skill of skills) {
      for (const tool of skill.allowedTools) {
        expect(definedTools.has(tool), `${skill.name} names unknown tool ${tool}`).toBe(true);
      }
    }
  });

  it('does not describe the export quality preset that no longer exists', () => {
    // exportProjectVideo used to accept a preset, drop it, and echo it back as
    // though it had applied. Nothing should teach the agent to pass one.
    for (const skill of skills) {
      expect(skill.body, `${skill.name} mentions an export preset`).not.toMatch(
        /exportProjectVideo[^\n]*preset|preset[^\n]*exportProjectVideo/
      );
    }
    expect(mcpSource).not.toMatch(/preset: params\.preset/);
  });

  it('states where each skill is enforced, or is purely procedural', () => {
    // A skill read as a spec while the code does something else is worse than
    // no skill; the ones backed by code say which file backs them.
    const codeBacked = skills.filter((skill) => skill.body.includes('Where this is enforced'));
    expect(codeBacked.length).toBeGreaterThanOrEqual(3);
    for (const skill of codeBacked) {
      expect(skill.body, `${skill.name} should cite a source file`).toMatch(/src\/(main|shared)\/[A-Za-z]+\.ts/);
    }
  });

  it('keeps every spend-incurring skill pointed at the cost gate', () => {
    // Any skill whose steps reach a create*Job tool has to route through the
    // approval procedure rather than describing its own.
    const spendTools = ['createVideoJob', 'createSpeechJob', 'createImageJob'];
    for (const skill of skills) {
      if (!skill.allowedTools.some((tool) => spendTools.includes(tool))) continue;
      expect(skill.body, `${skill.name} spends but does not reference the cost gate`).toMatch(
        /generation-cost-approval|estimateGenerationCost/
      );
    }
  });
});

import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const APP_SOURCE_URL = new URL('../src/renderer/src/App.tsx', import.meta.url);
const ONBOARDING_SOURCE_URL = new URL('../src/renderer/src/FirstRunOnboarding.tsx', import.meta.url);

async function readSource(url: URL): Promise<string> {
  return readFile(url, 'utf8');
}

describe('first-run onboarding source contract', () => {
  it('renders an accessible first-run dialog over Home with the requested controls and steps', async () => {
    const onboarding = await readSource(ONBOARDING_SOURCE_URL);

    expect(onboarding).toContain('role="dialog"');
    expect(onboarding).toContain('aria-modal="true"');
    expect(onboarding).toContain('Skip setup');
    expect(onboarding).toContain('Back');
    expect(onboarding).toContain('Next');
    expect(onboarding).toContain('Start using OpenScene');
    expect(onboarding).toContain('Welcome to OpenScene');
    expect(onboarding).toContain('Local readiness');
    expect(onboarding).toContain('Voice setup');
    expect(onboarding).toContain('Edit Agent');
    expect(onboarding).toContain('Privacy boundary');
    expect(onboarding).toContain('Start local editing');
  });

  it('mounts the first-run dialog from App without unmounting Home or the persistent shell', async () => {
    const app = await readSource(APP_SOURCE_URL);

    expect(app).toContain('FirstRunOnboarding');
    expect(app).toContain('readFirstRunOnboardingCompletion(window.localStorage)');
    expect(app).toContain('writeFirstRunOnboardingCompletion(window.localStorage)');
    expect(app).toContain('idBase="workspace"');
    expect(app).toContain('activePage={activePage}');
    expect(app).toContain('hasActiveProject={hasActiveProject}');
    expect(app).toContain('onPageChange={setActivePage}');
  });
});

import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';

import { Button } from './ui';

type FirstRunOnboardingProps = {
  readonly onComplete: () => void;
};

type OnboardingStep = {
  readonly kicker: string;
  readonly title: string;
  readonly body: string;
  readonly bullets: readonly string[];
};

const ONBOARDING_STEPS = [
  {
    kicker: 'Welcome',
    title: 'Welcome to OpenVideo',
    body: 'OpenVideo is a local-first desktop studio for recording, arranging, narrating, and exporting media on your machine.',
    bullets: ['No account is required.', 'Home stays available behind this setup guide.', 'The Edit Agent panel remains docked on the right.']
  },
  {
    kicker: 'Local readiness',
    title: 'Local readiness',
    body: 'Final MP4 export uses your local FFmpeg setup, and desktop capture depends on operating-system screen recording permission.',
    bullets: ['Configure FFmpeg through an absolute path or PATH discovery.', 'Grant Screen Recording permission when macOS asks.', 'OpenVideo never shows FFmpeg paths or arguments in the renderer.']
  },
  {
    kicker: 'Voice',
    title: 'Voice setup',
    body: 'Voice Generation uses consent-based samples and your configured local narration workflow.',
    bullets: ['Use only samples you own or have permission to use.', 'Samples and generated audio stay in local app storage.', 'Local Qwen is user-configured; OpenVideo does not download models.']
  },
  {
    kicker: 'Edit Agent',
    title: 'Edit Agent',
    body: 'The persistent right panel is the Edit Agent surface for project context, chat, tool activity, and approvals.',
    bullets: ['Attach project context intentionally.', 'Review mutating tool approvals before accepting them.', 'Configure model preferences in Settings.']
  },
  {
    kicker: 'Privacy',
    title: 'Privacy boundary',
    body: 'OpenVideo keeps recordings, imports, projects, voice profiles, TTS output, and exports local unless a future reviewed provider operation is explicitly authorized.',
    bullets: ['No analytics, crash reporting, or account system is implemented.', 'Provider seams are configuration surfaces, not hidden uploads.', 'Delete local samples and projects from inside the app.']
  },
  {
    kicker: 'Start',
    title: 'Start local editing',
    body: 'You can revisit setup details in Settings. Start on Home by choosing Editing, Voice Generation, or Video Generation.',
    bullets: ['Editing opens the local timeline workspace.', 'Voice Generation manages narration assets.', 'Video Generation manages configured result workflows.']
  }
] as const satisfies readonly OnboardingStep[];

export function FirstRunOnboarding({ onComplete }: FirstRunOnboardingProps): ReactElement {
  const [stepIndex, setStepIndex] = useState(0);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const step = ONBOARDING_STEPS[stepIndex] ?? ONBOARDING_STEPS[0];
  const isFirstStep = stepIndex === 0;
  const isFinalStep = stepIndex === ONBOARDING_STEPS.length - 1;
  const progressText = useMemo(() => `${stepIndex + 1} of ${ONBOARDING_STEPS.length}`, [stepIndex]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  return (
    <div className="first-run-onboarding" aria-labelledby="first-run-onboarding-title" role="dialog" aria-modal="true" ref={dialogRef} tabIndex={-1}>
      <div className="first-run-onboarding__scrim" aria-hidden="true" />
      <section className="first-run-onboarding__panel">
        <header className="first-run-onboarding__header">
          <p className="section-kicker">First-run setup</p>
          <p className="first-run-onboarding__progress">Step {progressText}</p>
          <h2 id="first-run-onboarding-title">{step.title}</h2>
          <p>{step.body}</p>
        </header>
        <ol className="first-run-onboarding__rail" aria-label="Onboarding progress">
          {ONBOARDING_STEPS.map((item, index) => (
            <li key={item.kicker} className={index === stepIndex ? 'first-run-onboarding__rail-step first-run-onboarding__rail-step--active' : 'first-run-onboarding__rail-step'}>
              {item.kicker}
            </li>
          ))}
        </ol>
        <ul className="first-run-onboarding__bullets">
          {step.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}
        </ul>
        <footer className="first-run-onboarding__actions">
          <Button onClick={onComplete} variant="ghost">Skip setup</Button>
          <div className="first-run-onboarding__step-actions">
            <Button disabled={isFirstStep} onClick={() => setStepIndex((current) => Math.max(0, current - 1))}>Back</Button>
            {isFinalStep ? (
              <Button onClick={onComplete} variant="primary">Start using OpenVideo</Button>
            ) : (
              <Button onClick={() => setStepIndex((current) => Math.min(ONBOARDING_STEPS.length - 1, current + 1))} variant="primary">Next</Button>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}

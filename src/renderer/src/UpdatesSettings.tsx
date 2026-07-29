import { useCallback, useEffect, useState, type ReactElement } from 'react';

import { describeUpdaterState, updaterActionFor, type UpdaterState } from '../../shared/updater';
import type { StatusTone } from './appTypes';
import { Button, MetadataList, StatusCard } from './ui';

type UpdaterSnapshot = {
  readonly state: UpdaterState;
  readonly currentVersion: string;
};

const INITIAL: UpdaterSnapshot = { state: { status: 'idle' }, currentVersion: '' };

function toneFor(state: UpdaterState): StatusTone {
  switch (state.status) {
    case 'error':
      return 'danger';
    case 'ready':
    case 'available':
      return 'warning';
    case 'up-to-date':
      return 'success';
    default:
      return 'neutral';
  }
}

export function UpdatesSettings(): ReactElement {
  const [snapshot, setSnapshot] = useState<UpdaterSnapshot>(INITIAL);
  const [failure, setFailure] = useState<string>('');

  useEffect(() => {
    let cancelled = false;

    void window.videoTool.getUpdaterState().then((response) => {
      if (!cancelled && response.ok) setSnapshot(response.value);
    });

    // A download finishing is the main process's news, not the result of
    // anything this component asked for.
    return window.videoTool.onUpdaterStateChanged((next) => {
      if (!cancelled) setSnapshot(next);
    }) as () => void;
  }, []);

  const action = updaterActionFor(snapshot.state);

  const run = useCallback(async () => {
    setFailure('');
    const response =
      action.kind === 'check'
        ? await window.videoTool.checkForUpdates()
        : action.kind === 'install' || action.kind === 'open-release'
          ? await window.videoTool.installUpdate()
          : null;

    if (response === null) return;
    if (response.ok) setSnapshot(response.value);
    else setFailure(response.error.message);
  }, [action.kind]);

  const version = snapshot.currentVersion.length > 0 ? snapshot.currentVersion : 'unknown';

  return (
    <>
      <MetadataList
        items={[
          { term: 'Installed version', description: version },
          { term: 'Update channel', description: 'Stable releases published on GitHub.' }
        ]}
      />
      <StatusCard tone={toneFor(snapshot.state)}>{describeUpdaterState(snapshot.state, version)}</StatusCard>
      {failure.length > 0 ? <StatusCard tone="danger">{failure}</StatusCard> : null}
      <Button variant="default" disabled={action.kind === 'none'} onClick={() => void run()}>
        {action.label}
      </Button>
    </>
  );
}

import { useRef } from 'react';
import type { ButtonHTMLAttributes, HTMLAttributes, KeyboardEvent, ReactElement, ReactNode } from 'react';

import { classNames } from './classNames';

export type TabsNavigationKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End';

export type TabDefinition<TabId extends string> = {
  readonly id: TabId;
  readonly label: ReactNode;
  readonly disabled?: boolean;
};

export type GetNextTabIdInput<TabId extends string> = {
  readonly currentTabId: TabId;
  readonly key: TabsNavigationKey;
  readonly tabs: readonly TabDefinition<TabId>[];
};

export type TabsProps<TabId extends string> = Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'onChange' | 'role'> & {
  readonly activeTabId: TabId;
  readonly idBase: string;
  readonly onActiveTabChange: (tabId: TabId) => void;
  readonly tabs: readonly TabDefinition<TabId>[];
  readonly tabButtonClassName?: string;
  readonly tabButtonProps?: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-controls' | 'aria-selected' | 'children' | 'className' | 'disabled' | 'id' | 'onClick' | 'onKeyDown' | 'role' | 'tabIndex' | 'type'>;
};

export type TabPanelProps<TabId extends string> = HTMLAttributes<HTMLDivElement> & {
  readonly activeTabId: TabId;
  readonly children: ReactNode;
  readonly idBase: string;
  readonly tabId: TabId;
};

function assertNever(value: never): never {
  throw new Error(`Unhandled tab navigation key: ${value}`);
}

function isTabsNavigationKey(key: string): key is TabsNavigationKey {
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowRight':
    case 'ArrowUp':
    case 'ArrowDown':
    case 'Home':
    case 'End':
      return true;
    default:
      return false;
  }
}

export function getTabId(idBase: string, tabId: string): string {
  return `${idBase}-${tabId}-tab`;
}

export function getTabPanelId(idBase: string, tabId: string): string {
  return `${idBase}-${tabId}-panel`;
}

export function getNextTabId<TabId extends string>({ currentTabId, key, tabs }: GetNextTabIdInput<TabId>): TabId | null {
  const enabledTabs = tabs.filter((tab) => tab.disabled !== true);
  if (enabledTabs.length === 0) return null;

  const currentIndex = enabledTabs.findIndex((tab) => tab.id === currentTabId);
  const normalizedIndex = currentIndex === -1 ? 0 : currentIndex;

  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return enabledTabs[(normalizedIndex + 1) % enabledTabs.length]?.id ?? null;
    case 'ArrowLeft':
    case 'ArrowUp':
      return enabledTabs[(normalizedIndex - 1 + enabledTabs.length) % enabledTabs.length]?.id ?? null;
    case 'Home':
      return enabledTabs[0]?.id ?? null;
    case 'End':
      return enabledTabs[enabledTabs.length - 1]?.id ?? null;
    default:
      return assertNever(key);
  }
}

export function Tabs<TabId extends string>({
  activeTabId,
  className,
  idBase,
  onActiveTabChange,
  onKeyDown,
  tabButtonClassName,
  tabButtonProps,
  tabs,
  ...tabListProps
}: TabsProps<TabId>): ReactElement {
  const tabRefs = useRef(new Map<TabId, HTMLButtonElement>());

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    onKeyDown?.(event);
    if (event.defaultPrevented || !isTabsNavigationKey(event.key)) return;

    const nextTabId = getNextTabId({ currentTabId: activeTabId, key: event.key, tabs });
    if (nextTabId === null) return;

    event.preventDefault();
    onActiveTabChange(nextTabId);
    tabRefs.current.get(nextTabId)?.focus();
  };

  return (
    <div className={className} role="tablist" onKeyDown={handleKeyDown} {...tabListProps}>
      {tabs.map((tab) => {
        const selected = tab.id === activeTabId;
        return (
          <button
            className={classNames('button', selected ? 'button--primary' : undefined, tabButtonClassName)}
            disabled={tab.disabled === true}
            id={getTabId(idBase, tab.id)}
            key={tab.id}
            ref={(element) => {
              if (element === null) {
                tabRefs.current.delete(tab.id);
                return;
              }
              tabRefs.current.set(tab.id, element);
            }}
            role="tab"
            tabIndex={selected ? 0 : -1}
            type="button"
            aria-controls={getTabPanelId(idBase, tab.id)}
            aria-selected={selected}
            {...tabButtonProps}
            onClick={() => onActiveTabChange(tab.id)}
          >
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel<TabId extends string>({ activeTabId, children, className, idBase, tabId, ...panelProps }: TabPanelProps<TabId>): ReactElement {
  const selected = tabId === activeTabId;

  return (
    <div
      className={className}
      hidden={!selected}
      id={getTabPanelId(idBase, tabId)}
      role="tabpanel"
      tabIndex={0}
      aria-labelledby={getTabId(idBase, tabId)}
      {...panelProps}
    >
      {children}
    </div>
  );
}

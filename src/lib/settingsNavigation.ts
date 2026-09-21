import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';

export const settingsGroups = [
  { id: 'editor', title: '편집기', description: '노트를 읽고 쓰는 방식을 설정합니다.' },
  { id: 'database', title: '데이터베이스', description: '데이터를 편안하게 읽을 수 있도록 설정합니다.' },
  { id: 'cursor', title: '커서', description: '커서의 모양과 움직임을 설정합니다.' },
  { id: 'keyboard', title: 'Vim 및 단축키', description: '익숙한 키로 나만의 작업 흐름을 만드세요.' },
  { id: 'theme', title: '테마', description: '오래 머물기 편안한 색을 선택하세요.' },
  { id: 'extensions', title: '확장', description: '작업 방식에 맞는 도구와 명령을 더하세요.' },
  { id: 'updates', title: '앱 업데이트', description: '새로운 Foltra 버전을 확인하고 설치합니다.' },
] as const;
export type SettingsGroup = (typeof settingsGroups)[number]['id'];

export function useSettingsNavigation(vaultPath: string) {
  const [opened, setOpened] = useState(false);
  const [group, setGroup] = useState<SettingsGroup>('editor');
  const returnFocus = useRef<HTMLElement | null>(null);
  const previousVault = useRef(vaultPath);
  const wasOpen = useRef(false);
  useLayoutEffect(() => {
    if (previousVault.current !== vaultPath) {
      previousVault.current = vaultPath;
      returnFocus.current = null;
      setOpened(false);
      setGroup('editor');
    }
    if (opened) {
      const frame = requestAnimationFrame(() => {
        document.querySelector<HTMLElement>('[data-settings-group].active')?.focus({ preventScroll: true });
      });
      wasOpen.current = true;
      return () => cancelAnimationFrame(frame);
    } else if (wasOpen.current && returnFocus.current) {
      const frame = requestAnimationFrame(() => {
        const target = returnFocus.current;
        if (target?.isConnected && !target.closest('[inert], [hidden]'))
          target.focus({ preventScroll: true });
        else
          document.querySelector<HTMLElement>('[data-focus-region="main"]')?.focus({ preventScroll: true });
      });
      wasOpen.current = false;
      return () => cancelAnimationFrame(frame);
    }
    wasOpen.current = opened;
  }, [opened, vaultPath, group]);
  const close = (restoreFocus = true) => {
    if (!restoreFocus) returnFocus.current = null;
    setOpened(false);
  };
  return {
    opened,
    group,
    setGroup,
    open: (target?: SettingsGroup) => {
      if (!opened) returnFocus.current = document.activeElement as HTMLElement | null;
      if (target) setGroup(target);
      setOpened(true);
    },
    close,
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (
        !opened ||
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        event.nativeEvent.isComposing ||
        event.nativeEvent.keyCode === 229 ||
        // Dialogs handle Escape on window after this scoped bubbling handler.
        document.querySelector('[role="dialog"]')
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      close();
    },
  };
}

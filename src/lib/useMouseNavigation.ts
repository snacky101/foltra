import { useEffect, useRef } from 'react';

export function useMouseNavigation(dispatch: (id: string) => void, blocked: boolean) {
  const current = useRef({ dispatch, blocked });
  current.current = { dispatch, blocked };
  useEffect(() => {
    const navigate = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return;
      // Consume browser Back/Forward too, including when a dialog blocks navigation.
      event.preventDefault();
      event.stopPropagation();
      if (event.type !== 'mouseup' || current.current.blocked) return;
      const protectedControl = '[role="dialog"], [role="menu"], [data-inline-rename], [data-key-recorder]';
      if (
        (event.target instanceof Element && event.target.closest(protectedControl)) ||
        document.activeElement?.closest(protectedControl)
      )
        return;
      current.current.dispatch(event.button === 3 ? 'note.back' : 'note.forward');
    };
    // Dispatch once on release; auxclick only suppresses the browser's default action.
    const events = ['mousedown', 'mouseup', 'auxclick'] as const;
    events.forEach((name) => window.addEventListener(name, navigate, true));
    return () => events.forEach((name) => window.removeEventListener(name, navigate, true));
  }, []);
}

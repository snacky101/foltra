import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Check, ChevronDown } from 'lucide-react';

// A single-select list keeps keyboard focus on the trigger, including inside modal forms.
export function Select({
  value,
  onValueChange,
  children,
  className = '',
  disabled = false,
  'aria-label': label,
}: {
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  'aria-label'?: string;
}) {
  const options = Children.toArray(children)
    .filter(isValidElement<{ value?: string; children: string }>)
    .map((child) => ({
      value: child.props.value ?? String(child.props.children),
      label: child.props.children,
    }));
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 160, maxHeight: 260 });
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const search = useRef({ text: '', time: 0 });
  const id = useId();
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  const show = () => {
    setActive(
      Math.max(
        0,
        options.findIndex((option) => option.value === value),
      ),
    );
    setOpen(true);
  };
  const choose = (index: number) => {
    if (options[index]) onValueChange(options[index].value);
    setOpen(false);
  };
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const width = Math.min(Math.max(160, rect.width), window.innerWidth - 24);
    const height = Math.min(260, options.length * 36 + 10);
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const flip = below < height && above > below;
    const maxHeight = Math.min(260, flip ? above : below);
    setPosition({
      left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      top: flip ? rect.top - Math.min(height, maxHeight) - 4 : rect.bottom + 4,
      width,
      maxHeight,
    });
  }, [open, options.length]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const reposition = (event: Event) => {
      if (!list.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open]);
  useEffect(() => {
    list.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);
  return (
    <div ref={root} className="select-root">
      <button
        ref={trigger}
        type="button"
        disabled={disabled}
        role="combobox"
        className={`select-control ${className}`}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? id : undefined}
        aria-activedescendant={open && options[active] ? `${id}-${active}` : undefined}
        onClick={() => (open ? setOpen(false) : show())}
        onBlur={(e) => {
          if (!root.current?.contains(e.relatedTarget)) setOpen(false);
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
            e.preventDefault();
            e.stopPropagation();
            if (!open) show();
            else
              setActive((index) =>
                e.key === 'Home'
                  ? 0
                  : e.key === 'End'
                    ? options.length - 1
                    : Math.max(0, Math.min(options.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1))),
              );
          } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            if (open) choose(active);
            else show();
          } else if (e.key === 'Escape' && open) {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          } else if (e.key === 'Tab') setOpen(false);
          else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
            e.preventDefault();
            const now = Date.now();
            search.current = {
              text: (now - search.current.time < 700 ? search.current.text : '') + e.key.toLowerCase(),
              time: now,
            };
            const index = options.findIndex((option) =>
              String(option.label).toLowerCase().startsWith(search.current.text),
            );
            if (!open) show();
            if (index >= 0) setActive(index);
          }
        }}
      >
        <span>{options.find((option) => option.value === value)?.label ?? '선택'}</span>
        <ChevronDown size={13} />
      </button>
      {open && (
        <div ref={list} id={id} role="listbox" aria-label={label} className="select-options" style={position}>
          {options.map((option, index) => (
            <div
              id={`${id}-${index}`}
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              className={active === index ? 'active' : ''}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.preventDefault();
                choose(index);
              }}
            >
              <span>{option.label}</span>
              {option.value === value && <Check size={13} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

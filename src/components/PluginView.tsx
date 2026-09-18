import { useEffect, useRef, useState } from 'react';
import { Puzzle, RefreshCw } from 'lucide-react';
import { Select } from './Select';
import { PluginCalendar } from './PluginCalendar';
import type { PluginNode } from '../lib/pluginTypes';
type Action = (id: string, value?: string | boolean, payload?: unknown) => Promise<void>;
function PluginInput({ node, action }: { node: PluginNode; action: Action }) {
  const [value, setValue] = useState(node.value ?? '');
  const committed = useRef(value);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (document.activeElement === input.current) return;
    setValue(node.value ?? '');
    committed.current = node.value ?? '';
  }, [node.value]);
  const commit = () => {
    if (node.action && committed.current !== value) {
      committed.current = value;
      action(node.action, value, node.payload);
    }
  };
  return (
    <label className="plugin-field">
      <span>{node.label}</span>
      <input
        ref={input}
        aria-label={node.label ?? node.action}
        type={node.inputType ?? 'text'}
        value={value}
        placeholder={node.placeholder}
        disabled={node.disabled}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) {
            e.preventDefault();
            commit();
          }
        }}
      />
    </label>
  );
}
function PluginButton({ node, action }: { node: PluginNode; action: Action }) {
  const [pending, setPending] = useState(false);
  const locked = useRef(false);
  return (
    <button
      className={`secondary-button plugin-button ${node.tone ?? ''}`}
      title={node.text ?? node.label}
      disabled={pending || node.disabled}
      onClick={async () => {
        if (!node.action || locked.current) return;
        locked.current = true;
        setPending(true);
        try {
          await action(node.action, undefined, node.payload);
        } finally {
          locked.current = false;
          setPending(false);
        }
      }}
    >
      {node.text ?? node.label}
    </button>
  );
}
function PluginChoice({ node, action }: { node: PluginNode; action: Action }) {
  const [pending, setPending] = useState(false);
  const locked = useRef(false);
  const activate = async (value: string | boolean) => {
    if (!node.action || locked.current) return;
    locked.current = true;
    setPending(true);
    try {
      await action(node.action, value, node.payload);
    } finally {
      locked.current = false;
      setPending(false);
    }
  };
  if (node.type === 'checkbox')
    return (
      <label className="plugin-checkbox">
        <input
          type="checkbox"
          checked={node.checked ?? false}
          disabled={pending || node.disabled}
          onChange={(e) => activate(e.target.checked)}
        />
        {node.label}
      </label>
    );
  return (
    <div className="plugin-field">
      <span>{node.label}</span>
      <Select
        aria-label={node.label ?? node.action}
        value={node.value ?? ''}
        disabled={pending || node.disabled}
        onValueChange={activate}
      >
        {node.options?.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </Select>
    </div>
  );
}
function Node({ node, action, disabled = false }: { node: PluginNode; action: Action; disabled?: boolean }) {
  if (disabled) node = { ...node, disabled: true };
  if (node.type === 'calendar') return <PluginCalendar node={node} action={action} />;
  if (node.type === 'text') return <p className={`plugin-text ${node.tone ?? ''}`}>{node.text}</p>;
  if (node.type === 'heading') return <h2 className="plugin-heading">{node.text}</h2>;
  if (node.type === 'button') return <PluginButton node={node} action={action} />;
  if (node.type === 'input') return <PluginInput node={node} action={action} />;
  if (node.type === 'select' || node.type === 'checkbox') return <PluginChoice node={node} action={action} />;
  return (
    <div
      className={`plugin-${node.type}`}
      style={
        node.type === 'grid'
          ? { gridTemplateColumns: `repeat(${node.columns ?? 1}, minmax(0, 1fr))` }
          : undefined
      }
    >
      {node.children?.map((child, index) => (
        <Node
          key={`${child.action ?? child.type}:${JSON.stringify(child.payload) ?? index}`}
          node={child}
          action={action}
          disabled={disabled}
        />
      ))}
    </div>
  );
}
export function PluginView({
  title,
  tree,
  busy,
  error,
  action,
  refresh,
  embedded = false,
  preserveOnError = false,
}: {
  title: string;
  tree: PluginNode | null;
  busy: boolean;
  error?: string;
  action: Action;
  refresh: () => void;
  embedded?: boolean;
  preserveOnError?: boolean;
}) {
  return (
    <section className={embedded ? 'plugin-view plugin-view-embedded' : 'plugin-view'}>
      {!embedded && (
        <header className="plugin-view-header">
          <div>
            <span className="eyebrow">PLUGIN VIEW</span>
            <h1>
              <Puzzle size={23} />
              {title}
            </h1>
          </div>
          <button
            className="icon-button"
            aria-label="플러그인 화면 새로고침"
            disabled={busy || !!error}
            onClick={refresh}
          >
            <RefreshCw size={16} />
          </button>
        </header>
      )}
      {error && !preserveOnError ? (
        <div className="plugin-error" role="alert">
          <strong>플러그인 실행을 중지했습니다.</strong>
          <p>{error}</p>
          <p>설정 → 확장에서 껐다 켜면 다시 실행할 수 있습니다.</p>
        </div>
      ) : tree ? (
        <div aria-busy={busy} aria-disabled={error ? true : undefined}>
          <Node node={tree} action={action} disabled={!!error} />
        </div>
      ) : error ? null : (
        <p className="muted">{busy ? '화면을 불러오는 중…' : '설정 → 확장에서 플러그인을 활성화하세요.'}</p>
      )}
    </section>
  );
}

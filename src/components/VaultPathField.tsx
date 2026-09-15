import { useId } from 'react';
import { FolderOpen } from 'lucide-react';

export function VaultPathField({
  label,
  value,
  onChange,
  browse,
  disabled,
  autoFocus,
  ariaLabel,
}: {
  label: string;
  value: string;
  onChange: (path: string) => void;
  browse?: () => void;
  disabled?: boolean;
  autoFocus?: boolean;
  ariaLabel: string;
}) {
  const id = useId();
  return (
    <div className="form-field vault-path-field">
      <label htmlFor={id}>{label}</label>
      <div className="vault-path-input">
        <input
          id={id}
          aria-label={ariaLabel}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoFocus={autoFocus}
          required
          disabled={disabled}
          spellCheck={false}
        />
        {browse && (
          <button type="button" disabled={disabled} onClick={browse} aria-label="폴더 선택">
            <FolderOpen size={16} />
            <span>폴더 선택</span>
          </button>
        )}
      </div>
    </div>
  );
}

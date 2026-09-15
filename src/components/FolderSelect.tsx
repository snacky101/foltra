import type { Folder } from '../lib/types';
import { Select } from './Select';

export function folderPath(folder: Folder, folders: Folder[]): string {
  const parts = [folder.name];
  const seen = new Set([folder.id]);
  let parent = folders.find((f) => f.id === folder.parentId);
  while (parent && !seen.has(parent.id)) {
    seen.add(parent.id);
    parts.unshift(parent.name);
    parent = folders.find((f) => f.id === parent!.parentId);
  }
  return parts.join(' / ');
}
export function FolderSelect({
  folders,
  value,
  onChange,
}: {
  folders: Folder[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <label className="form-field">
      위치
      <Select aria-label="폴더 위치" value={value} onValueChange={onChange}>
        <option value="">Vault 최상위</option>
        {folders
          .map((folder) => ({ id: folder.id, name: folderPath(folder, folders) }))
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.name}
            </option>
          ))}
      </Select>
    </label>
  );
}

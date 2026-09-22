import {
  FileText,
  Folder,
  Table2,
  BookOpen,
  Notebook,
  Bookmark,
  Star,
  Heart,
  Lightbulb,
  Code,
  Calendar,
  SquareCheck,
  Briefcase,
  GraduationCap,
  Music,
  Image,
  Globe,
  Coffee,
  Archive,
  Inbox,
} from 'lucide-react';
export type { TreeIcons } from '../../packages/plugin-sdk';
import type { TreeIcons } from '../../packages/plugin-sdk';
const icons = {
  'file-text': FileText,
  folder: Folder,
  table: Table2,
  'book-open': BookOpen,
  notebook: Notebook,
  bookmark: Bookmark,
  star: Star,
  heart: Heart,
  lightbulb: Lightbulb,
  code: Code,
  calendar: Calendar,
  'check-square': SquareCheck,
  briefcase: Briefcase,
  'graduation-cap': GraduationCap,
  music: Music,
  image: Image,
  globe: Globe,
  coffee: Coffee,
  archive: Archive,
  inbox: Inbox,
};
export function TreeIcon({
  kind,
  id,
  icons: choices,
}: {
  kind: 'note' | 'folder' | 'database';
  id: string;
  icons?: TreeIcons;
}) {
  const name = choices?.items?.[id] ?? choices?.[kind];
  const Icon = (name && icons[name]) || { note: FileText, folder: Folder, database: Table2 }[kind];
  return <Icon size={kind === 'database' ? 16 : 15} aria-hidden="true" />;
}

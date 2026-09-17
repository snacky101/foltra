import { useEffect, useRef, useState } from 'react';
import { call } from './api';
import type { Topic, TopicBlocks, TopicSort, Workspace } from './types';

export const defaultTopicOptions = {
  topicId: null as string | null,
  offset: 0,
  sort: null as TopicSort | null,
  showSources: false,
};
export type TopicOptions = typeof defaultTopicOptions;

export function useTopics(workspace: Workspace, options: TopicOptions) {
  const [retry, setRetry] = useState(0);
  const folders = workspace.settings.topicFolders ?? { include: [], exclude: [] };
  const scopeKey = JSON.stringify([
    workspace.path,
    folders,
    workspace.notes
      .map((note) => [note.id, note.folderId ?? ''] as const)
      .sort(([a], [b]) => a.localeCompare(b)),
    workspace.folders
      .map((folder) => [folder.id, folder.parentId] as const)
      .sort(([a], [b]) => a.localeCompare(b)),
  ]);
  const sourceKey = JSON.stringify([
    scopeKey,
    workspace.notes.map((note) => [note.id, note.revision]),
    workspace.topicOrderRevision,
    retry,
  ]);
  const [catalog, setCatalog] = useState<{ key: string; topics?: Topic[]; error?: string } | null>(null);
  useEffect(() => {
    let active = true;
    void call<Topic[]>(workspace.path, 'topics.list', { folders }).then(
      (topics) => {
        if (active) setCatalog({ key: sourceKey, topics });
      },
      (error) => {
        if (active) setCatalog({ key: sourceKey, error: error.message });
      },
    );
    return () => {
      active = false;
    };
  }, [sourceKey, workspace.path]);
  const topics = catalog?.key === sourceKey ? catalog.topics : undefined;
  const topic = topics?.find((topic) => topic.id === options.topicId) ?? topics?.[0];
  const offset = topic?.id === options.topicId ? options.offset : 0;
  const requestKey = JSON.stringify([sourceKey, topic?.id, offset, options.sort]);
  const context = JSON.stringify([scopeKey, topic?.id]);
  const currentContext = useRef(context);
  currentContext.current = context;
  const pending = useRef(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<{ context: string; message: string } | null>(null);
  const [page, setPage] = useState<{ key: string; data?: TopicBlocks; error?: string } | null>(null);
  useEffect(() => {
    if (!topic) return;
    let active = true;
    void call<TopicBlocks>(workspace.path, 'topics.blocks', {
      topic: topic.id,
      offset,
      limit: 50,
      folders,
      ...(options.sort ? { sort: options.sort } : {}),
    }).then(
      (data) => {
        if (active) setPage({ key: requestKey, data });
      },
      (error) => {
        if (active) setPage({ key: requestKey, error: error.message });
      },
    );
    return () => {
      active = false;
    };
  }, [requestKey, workspace.path, topic?.id, offset, options.sort]);
  useEffect(
    () => () => {
      currentContext.current = '';
    },
    [],
  );
  const reload = () => {
    setSaveError(null);
    setRetry((value) => value + 1);
  };
  const move = async (
    source: string,
    target: string,
    placement: 'before' | 'after',
    expectedRevision: string,
    sort: TopicSort,
  ) => {
    if (pending.current || !topic) return false;
    pending.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      await call(workspace.path, 'topics.reorder', {
        topic: topic.id,
        source,
        target,
        placement,
        expectedRevision,
        sort,
        folders,
      });
      if (currentContext.current !== context) return false;
      reload();
      return true;
    } catch (error) {
      if (currentContext.current === context) setSaveError({ context, message: (error as Error).message });
      return false;
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };
  return {
    topics,
    scopeKey,
    topic,
    data: page?.key === requestKey ? page.data : undefined,
    error:
      (saveError?.context === context && saveError.message) ||
      (catalog?.key === sourceKey && catalog.error) ||
      (page?.key === requestKey && page.error) ||
      '',
    reload,
    saving,
    move,
  };
}

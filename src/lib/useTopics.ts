import { useEffect, useState } from 'react';
import { call } from './api';
import type { Topic, TopicBlocks, Workspace } from './types';

export const defaultTopicOptions = { topicId: null as string | null, offset: 0, descending: true };
export type TopicOptions = typeof defaultTopicOptions;

export function useTopics(workspace: Workspace, options: TopicOptions) {
  const [retry, setRetry] = useState(0);
  const sourceKey = JSON.stringify([
    workspace.path,
    workspace.notes.map((note) => [note.id, note.revision]),
    retry,
  ]);
  const [catalog, setCatalog] = useState<{ key: string; topics?: Topic[]; error?: string } | null>(null);
  useEffect(() => {
    let active = true;
    void call<Topic[]>(workspace.path, 'topics.list').then(
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
  const requestKey = JSON.stringify([sourceKey, topic?.id, offset, options.descending]);
  const [page, setPage] = useState<{ key: string; data?: TopicBlocks; error?: string } | null>(null);
  useEffect(() => {
    if (!topic) return;
    let active = true;
    void call<TopicBlocks>(workspace.path, 'topics.blocks', {
      topic: topic.id,
      offset,
      limit: 50,
      descending: options.descending,
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
  }, [requestKey, workspace.path, topic?.id, offset, options.descending]);
  return {
    topics,
    topic,
    data: page?.key === requestKey ? page.data : undefined,
    error: (catalog?.key === sourceKey && catalog.error) || (page?.key === requestKey && page.error) || '',
    reload: () => setRetry((value) => value + 1),
  };
}

import { call } from './api';
import type { PluginEditorSnapshot, PluginEvent, PluginResponse, PluginStatus } from './pluginTypes';

// Each session owns its queue and JSON state; no work can update another vault/session.
export class PluginSession {
  private state: Record<string, unknown> = {};
  private queue: Promise<unknown> = Promise.resolve();
  private disposed = false;
  error = '';
  constructor(
    readonly path: string,
    readonly status: PluginStatus,
  ) {}
  invoke(event: PluginEvent, editor?: PluginEditorSnapshot | null): Promise<PluginResponse | null> {
    const next = this.queue.then(async () => {
      if (this.disposed) return null;
      if (this.error) throw new Error(this.error);
      try {
        const response = await call<PluginResponse>(this.path, 'extension.invoke', {
          id: this.status.id,
          digest: this.status.digest,
          event,
          state: this.state,
          ...(editor ? { editor } : {}),
        });
        if (this.disposed) return null;
        this.state = response.state;
        return response;
      } catch (error) {
        if (this.disposed) return null;
        this.error = error instanceof Error ? error.message : String(error);
        throw error;
      }
    });
    this.queue = next.catch(() => undefined);
    return next;
  }
  dispose(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.disposed = true;
    // Queued actions are cancelled. An already-running core write retains normal atomic semantics.
    return this.queue
      .then(() =>
        call(this.path, 'extension.invoke', {
          id: this.status.id,
          digest: this.status.digest,
          event: { type: 'unload' },
          state: this.state,
        }),
      )
      .then(
        () => undefined,
        () => undefined,
      );
  }
}

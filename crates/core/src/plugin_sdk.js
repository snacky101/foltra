(plugin, inputJSON) => {
  const input = JSON.parse(inputJSON);
  const bridge = (op, args = {}) => {
    const response = JSON.parse(__foltraBridge(JSON.stringify({ op, args })));
    if (response.error) throw Object.assign(new Error(response.error.message), { code: response.error.code });
    return response.value;
  };
  const api = Object.freeze({
    state: input.state || {},
    vaultId: bridge('vaultId'),
    createId: () => bridge('createId'),
    hash: (text) => bridge('hash', { text }),
    anki: (action, params = {}) => bridge('anki', { action, params }),
    git: (action, params = {}) => bridge('git', { action, params }),
    settings: bridge('settings'),
    call: (command, args = {}) => bridge('call', { command, args }),
    storage: Object.freeze({ read: () => bridge('storage.read'), write: (value, expectedRevision) => bridge('storage.write', { value, expectedRevision }) }),
    openView: (id) => bridge('openView', { id }),
    openNote: (id) => bridge('openNote', { id }),
    notify: (message) => bridge('notify', { message }),
    editor: Object.freeze({ read: () => bridge('editor.read'), replaceSelection: (text) => bridge('editor.replaceSelection', { text }) }),
  });
  const event = input.event;
  let result = null;
  let view = null;
  let handler;
  if (event.type === 'command') handler = plugin.commands?.[event.id];
  else if (event.type === 'completion') handler = plugin.completions?.[event.id];
  else if (event.type === 'load') handler = plugin.onLoad;
  else if (event.type === 'unload') handler = plugin.onUnload;
  else if (event.type === 'event') handler = plugin.onEvent;
  else if (event.type === 'action') handler = plugin.views?.[event.id]?.onAction;
  else if (event.type !== 'render') throw new Error('Unknown plugin event');
  if (event.type === 'command' && typeof handler !== 'function') throw new Error('Plugin command handler is missing');
  if (event.type === 'completion' && typeof handler !== 'function') throw new Error('Plugin completion handler is missing');
  if (handler) result = handler(api, event.type === 'command' || event.type === 'completion' ? (event.args || {}) : event.type === 'action' ? event.action : event);
  if (result && typeof result.then === 'function') throw new Error('SDK v1 handlers must be synchronous');
  if (event.type === 'render') {
    const render = plugin.views?.[event.id]?.render;
    if (typeof render !== 'function') throw new Error('Plugin view renderer is missing');
    view = render(api);
  }
  return JSON.stringify({ result: result ?? null, state: api.state, view });
}

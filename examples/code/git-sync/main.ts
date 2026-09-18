import type { Api, Action, Plugin, ViewNode } from '../../../packages/plugin-sdk';

interface Config {
  remote: string;
  branch: string;
  automatic: boolean;
  intervalMinutes: number;
}
interface Status {
  history?: {
    id: string;
    phase: string;
    message: string;
    updatedAt: string;
    localCommit: string | null;
    remoteCommit: string | null;
    remote: string;
  }[];
  config: Config | null;
  configRevision: string;
  jobId: string;
  phase: string;
  message: string;
  updatedAt: string;
  conflictCount: number;
  conflicts: { path: string; local: string | null; remote: string | null }[];
}
interface Draft extends Config {
  expectedRevision: string;
}
const phases: Record<string, string> = {
  running: '동기화 중',
  synced: '동기화 완료',
  conflicts: '충돌 확인 필요',
  error: '동기화 실패',
  'push-pending': '원격 전송 대기',
  interrupted: '작업 중단',
};
const text = (value: string, tone?: ViewNode['tone']): ViewNode => ({
  type: 'text',
  text: value,
  ...(tone ? { tone } : {}),
});
function draft(api: Api, status: Status): Draft {
  if (!api.state.draft) reset(api, status);
  const current = api.state.draft as Draft;
  if (
    status.config &&
    ['remote', 'branch', 'automatic', 'intervalMinutes'].every(
      (key) => current[key as keyof Config] === status.config![key as keyof Config],
    )
  ) {
    current.expectedRevision = status.configRevision;
  }
  return current;
}
function reset(api: Api, status: Status) {
  api.state.draft = {
    remote: '',
    branch: 'main',
    automatic: false,
    intervalMinutes: 5,
    ...status.config,
    expectedRevision: status.configRevision,
  };
}
function choices(api: Api, status: Status): Record<string, 'local' | 'remote'> {
  if (api.state.jobId !== status.jobId) {
    api.state.jobId = status.jobId;
    api.state.choices = {};
  }
  return (api.state.choices ??= {}) as Record<string, 'local' | 'remote'>;
}
function sync(api: Api, automatic = false) {
  const status = api.git<Status>('status');
  if (!automatic) api.openView('sync');
  if (!status.config) {
    if (!automatic) api.notify('먼저 Git 저장소를 연결해 주세요.');
    return;
  }
  if (status.phase === 'running') return;
  if (
    automatic &&
    (!status.config.automatic || ['conflicts', 'error', 'push-pending', 'interrupted'].includes(status.phase))
  )
    return;
  api.git('sync', { automatic });
}
function render(api: Api): ViewNode {
  const status = api.git<Status>('status');
  const current = draft(api, status);
  const selected = choices(api, status);
  const running = status.phase === 'running';
  const children: ViewNode[] = [
    {
      type: 'card',
      children: [
        { type: 'heading', text: status.config ? (phases[status.phase] ?? '동기화 준비') : '저장소 연결' },
        text(
          status.message || '개인 Git 저장소를 연결한 뒤 동기화를 시작하세요.',
          ['error', 'push-pending'].includes(status.phase) ? 'danger' : 'muted',
        ),
        ...(status.updatedAt
          ? [text(`최근 작업 · ${new Date(status.updatedAt).toLocaleString()}`, 'muted')]
          : []),
        {
          type: 'row',
          children: [
            { type: 'button', text: '지금 동기화', action: 'sync', disabled: running || !status.config },
            { type: 'button', text: '상태 새로고침', action: 'refresh' },
          ],
        },
      ],
    },
    {
      type: 'card',
      children: [
        { type: 'heading', text: '연결 설정' },
        {
          type: 'input',
          label: '저장소 주소',
          value: current.remote,
          placeholder: 'git@github.com:username/notes.git',
          action: 'remote',
          disabled: running,
        },
        { type: 'input', label: '브랜치', value: current.branch, action: 'branch', disabled: running },
        {
          type: 'checkbox',
          label: '자동 동기화',
          checked: current.automatic,
          action: 'automatic',
          disabled: running,
        },
        {
          type: 'input',
          label: '동기화 간격 (분)',
          inputType: 'number',
          value: String(current.intervalMinutes),
          action: 'interval',
          disabled: running || !current.automatic,
        },
        text(
          '시스템 Git이 필요합니다. SSH agent·등록된 호스트 키 또는 macOS Git Keychain 인증을 사용합니다. 사용자 Git 설정·다른 인증 helper는 읽지 않습니다.',
          'muted',
        ),
        {
          type: 'row',
          children: [
            {
              type: 'button',
              text: '연결 설정 저장',
              action: 'configure',
              disabled: running || !current.remote.trim() || !current.branch.trim(),
            },
            { type: 'button', text: '저장된 설정 다시 읽기', action: 'reset', disabled: running },
          ],
        },
      ],
    },
  ];
  if (status.phase === 'conflicts') {
    const shown = status.conflicts.slice(0, 40);
    children.push({ type: 'heading', text: `충돌 ${status.conflictCount}개` });
    children.push(
      text(
        '각 파일에서 유지할 쪽을 선택합니다. “삭제된 파일”을 선택하면 해당 파일이 삭제됩니다. 적용 전 원본은 기기의 Git 이력에 보관됩니다.',
        'muted',
      ),
    );
    for (const conflict of shown)
      children.push({
        type: 'card',
        children: [
          { type: 'heading', text: conflict.path },
          text(`내 변경\n${conflict.local ?? '삭제된 파일'}`),
          text(`원격 변경\n${conflict.remote ?? '삭제된 파일'}`),
          {
            type: 'select',
            label: `${conflict.path} 유지할 내용`,
            value:
              selected[conflict.path] === 'local'
                ? '내 변경'
                : selected[conflict.path] === 'remote'
                  ? '원격 변경'
                  : '선택 안 함',
            options: ['선택 안 함', '내 변경', '원격 변경'],
            action: 'choose',
            payload: { path: conflict.path, jobId: status.jobId },
          },
        ],
      });
    if (shown.length < status.conflictCount)
      children.push(
        text(
          `처음 ${shown.length}개 파일을 표시합니다. 전체 ${status.conflictCount}개에는 아래의 일괄 선택을 사용하세요.`,
          'muted',
        ),
      );
    children.push({
      type: 'row',
      children: [
        {
          type: 'button',
          text: '선택한 내용 적용',
          action: 'resolve',
          payload: { jobId: status.jobId },
          disabled: shown.length !== status.conflictCount || !shown.every((item) => selected[item.path]),
        },
        {
          type: 'button',
          text: `전체 ${status.conflictCount}개 내 변경 유지`,
          action: 'all-local',
          payload: { jobId: status.jobId },
        },
        {
          type: 'button',
          text: `전체 ${status.conflictCount}개 원격 변경 유지`,
          action: 'all-remote',
          payload: { jobId: status.jobId },
        },
      ],
    });
  }
  const history = (status.history ?? []).slice(0, 5);
  if (history.length)
    children.push({
      type: 'card',
      children: [
        { type: 'heading', text: '최근 동기화' },
        ...history.map((entry) =>
          text(
            `${new Date(entry.updatedAt).toLocaleString()} · ${phases[entry.phase] ?? entry.phase}\n${entry.message}${entry.localCommit ? ` · 내 기록 ${entry.localCommit.slice(0, 8)}` : ''}${entry.remoteCommit ? ` · 원격 ${entry.remoteCommit.slice(0, 8)}` : ''}`,
            'muted',
          ),
        ),
        text('기록과 원본 스냅샷은 이 Vault의 .foltra/local/git에 보관됩니다.', 'muted'),
      ],
    });
  return { type: 'stack', children };
}
function onAction(api: Api, action: Action) {
  const status = api.git<Status>('status');
  const current = draft(api, status);
  if (action.id === 'reset') reset(api, status);
  if (action.id === 'remote' || action.id === 'branch') current[action.id] = String(action.value ?? '');
  if (action.id === 'automatic') current.automatic = action.value === true;
  if (action.id === 'interval') current.intervalMinutes = Number(action.value);
  if (action.id === 'configure') {
    if (
      !Number.isInteger(current.intervalMinutes) ||
      current.intervalMinutes < 1 ||
      current.intervalMinutes > 1440
    ) {
      api.notify('동기화 간격은 1~1440분으로 입력해 주세요.');
      return;
    }
    api.git('configure', { ...current, remote: current.remote.trim(), branch: current.branch.trim() });
  }
  if (action.id === 'sync') sync(api);
  if (status.phase !== 'conflicts') return;
  const selected = choices(api, status);
  if (action.id === 'choose') {
    const payload = action.payload as { path?: string; jobId?: string } | undefined;
    if (payload?.jobId !== status.jobId || !status.conflicts.some((item) => item.path === payload.path))
      return;
    if (action.value === '내 변경' || action.value === '원격 변경')
      selected[payload.path!] = action.value === '내 변경' ? 'local' : 'remote';
    else delete selected[payload.path!];
  }
  if (
    ['resolve', 'all-local', 'all-remote'].includes(action.id) &&
    (action.payload as { jobId?: string } | undefined)?.jobId !== status.jobId
  ) {
    api.notify('충돌 작업이 변경되었습니다. 최신 내용을 확인한 뒤 다시 선택해 주세요.');
    return;
  }
  if (
    action.id === 'resolve' &&
    status.conflicts.length === status.conflictCount &&
    status.conflicts.every((item) => selected[item.path])
  )
    api.git('resolve', { jobId: status.jobId, choices: selected });
  if (action.id === 'all-local' || action.id === 'all-remote')
    api.git('resolve', { jobId: status.jobId, all: action.id === 'all-local' ? 'local' : 'remote' });
}
export default {
  commands: { open: (api) => api.openView('sync'), sync: (api, args) => sync(api, args.automatic === true) },
  views: { sync: { render, onAction } },
} satisfies Plugin;

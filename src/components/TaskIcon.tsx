import { taskMarkers, type TaskStatus } from '../lib/markdownTasks';

const box = 'M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Z';
const icons: Record<TaskStatus, string[]> = {
  todo: [box],
  doing: [box, 'M8 16 16 8'],
  done: [box, 'm6.5 12 4 4 7-8'],
  bookmark: ['M6 3h12v18l-6-4-6 4V3Z'],
  cancelled: [box, 'M7 12h10'],
  deferred: [box, 'M6 12h12m-5-5 5 5-5 5'],
  question: [box, 'M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 3h.01'],
  important: [box, 'M12 7v6m0 3h.01'],
  star: ['m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z'],
  info: ['M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18m0 7v6m0-9h.01'],
  pin: ['M9 3h6l-1 7 4 4H6l4-4-1-7M12 14v7'],
};

export function TaskIcon({ status }: { status: TaskStatus }) {
  return (
    <svg
      className="task-icon"
      data-task-status={status}
      viewBox="0 0 24 24"
      role="img"
      aria-label={taskMarkers.find((item) => item.status === status)!.label}
    >
      {icons[status].map((path, index) => (
        <path key={index} d={path} />
      ))}
    </svg>
  );
}

// CodeMirror widgets use the same paths without mounting a React root per bullet.
export function taskIconDOM(status: TaskStatus) {
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('class', 'task-icon');
  icon.setAttribute('data-task-status', status);
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('role', 'img');
  icon.setAttribute('aria-label', taskMarkers.find((item) => item.status === status)!.label);
  for (const d of icons[status]) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    icon.append(path);
  }
  return icon;
}

'use client';

const listeners = new Set();
const store = { tasks: [] };

function emit() {
    const snapshot = [...store.tasks];
    listeners.forEach((fn) => fn(snapshot));
}

export function subscribeTasks(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

export function getTasks() {
    return [...store.tasks];
}

export function createTask({ title, steps }) {
    const task = {
        id: 'task-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        title,
        steps: (steps || []).map((s) => ({ label: s, state: 'pending' })),
        createdAt: Date.now(),
        status: 'running',
        progress: 0,
    };
    store.tasks = [task, ...store.tasks].slice(0, 30);
    emit();
    return task.id;
}

export function updateTask(taskId, updates) {
    const task = store.tasks.find((t) => t.id === taskId);
    if (!task) return;
    Object.assign(task, updates);
    recomputeProgress(task);
    emit();
}

export function setStepState(taskId, label, state) {
    const task = store.tasks.find((t) => t.id === taskId);
    if (!task) return;
    const step = task.steps.find((s) => s.label === label);
    if (!step) return;
    step.state = state;
    recomputeProgress(task);
    emit();
}

function recomputeProgress(task) {
    const done = task.steps.filter((s) => s.state === 'done').length;
    const active = task.steps.some((s) => s.state === 'active');
    const failed = task.steps.some((s) => s.state === 'failed');
    const base = done / Math.max(1, task.steps.length);
    task.progress = Math.round(Math.min(99, (base + (active ? 0.5 / task.steps.length : 0)) * 100));
    if (failed) task.status = 'failed';
    else if (done === task.steps.length && !active) task.status = 'complete';
    else task.status = 'running';
}

export function completeTask(taskId) {
    const task = store.tasks.find((t) => t.id === taskId);
    if (!task) return;
    task.steps.forEach((s) => { if (s.state !== 'failed') s.state = 'done'; });
    task.progress = 100;
    task.status = 'complete';
    emit();
}

export function failTask(taskId, message) {
    updateTask(taskId, { status: 'failed', failureMessage: message });
}

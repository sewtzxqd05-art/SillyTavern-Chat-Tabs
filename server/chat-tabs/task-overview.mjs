export function summarizePendingTasks(tasks) {
    return tasks.filter(task => !task.applied && !task.dismissed).map(task => ({
        id: task.id,
        status: task.status,
        created: task.created,
        completed: task.completed || null,
        target: { name: task.target?.name || '', chat: task.target?.chat || '' },
        error: typeof task.error === 'string' ? task.error.slice(0, 500) : '',
    }));
}

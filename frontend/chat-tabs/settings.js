// Native saveSettings reports failure through a toast instead of rejecting.
// Creating a window and syncing both require a confirmed current snapshot.
export async function saveCurrentSettings() {
    const core = await import('/script.js');
    let saved = false;
    const onSaved = () => { saved = true; };
    core.eventSource.on(core.event_types.SETTINGS_UPDATED, onSaved);
    try { await core.saveSettings(); }
    finally { core.eventSource.removeListener(core.event_types.SETTINGS_UPDATED, onSaved); }
    if (!saved) throw new Error('本页设置尚未保存成功，请等保存完成后重试。');
}

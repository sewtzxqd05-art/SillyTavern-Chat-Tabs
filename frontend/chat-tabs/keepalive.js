function silentWav() {
    const samples = 8000;
    const buffer = new ArrayBuffer(44 + samples * 2);
    const view = new DataView(buffer);
    const ascii = (offset, value) => [...value].forEach((letter, i) => view.setUint8(offset + i, letter.charCodeAt(0)));
    ascii(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); ascii(8, 'WAVE');
    ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, 1, true); view.setUint32(24, 8000, true); view.setUint32(28, 16000, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); ascii(36, 'data'); view.setUint32(40, samples * 2, true);
    return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
}

export function createKeepaliveController(settings, save, notify) {
    let audio, audioUrl, granted = false, generating = false, audioError = '', wakeError = '', wake = null, requestingWake = false;
    function state() {
        return {
            audioEnabled: settings.audio === true,
            audioPlaying: Boolean(audio && !audio.paused),
            audioText: !settings.audio ? '未启用（可使用其他保活插件）' : audioError || (audio && !audio.paused ? '正在播放静音音频' : granted ? '已授权，等待生成' : '需要点击「授权 / 重试音频」'),
            wakeEnabled: settings.screen === true,
            wakeSupported: Boolean(navigator.wakeLock?.request),
            wakeText: !settings.screen ? '未启用' : !navigator.wakeLock?.request ? '此浏览器或当前地址不支持' : wakeError || (wake ? '屏幕常亮已生效' : document.hidden ? '页面在后台，常亮锁已释放' : '等待生成时申请'),
        };
    }
    function ensureAudio() {
        if (audio) return audio;
        audioUrl = silentWav();
        audio = new Audio(audioUrl);
        audio.loop = true;
        audio.muted = false;
        audio.volume = 1;
        audio.preload = 'auto';
        audio.setAttribute('playsinline', '');
        for (const type of ['playing', 'pause', 'error', 'ended']) audio.addEventListener(type, () => notify(state()));
        return audio;
    }
    async function play() {
        audioError = '';
        try { await ensureAudio().play(); granted = true; }
        catch { granted = false; audioError = '浏览器阻止播放，请点击「授权 / 重试音频」'; }
        if (!settings.audio || !generating) audio?.pause();
        notify(state());
    }
    async function releaseWake() {
        const previous = wake;
        wake = null;
        if (previous) await previous.release().catch(() => {});
    }
    async function updateWake() {
        if (!settings.screen || !generating || document.hidden) { await releaseWake(); notify(state()); return; }
        if (wake || requestingWake || !navigator.wakeLock?.request) return;
        requestingWake = true;
        wakeError = '';
        try {
            const lock = await navigator.wakeLock.request('screen');
            wake = lock;
            lock.addEventListener('release', () => { if (wake === lock) wake = null; notify(state()); });
            if (!settings.screen || !generating || document.hidden) await releaseWake();
        } catch { wakeError = '常亮申请失败，系统可能处于省电模式'; }
        finally { requestingWake = false; notify(state()); }
    }
    const context = SillyTavern.getContext();
    context.eventSource.on(context.eventTypes.GENERATION_STARTED, (_type, _options, dryRun) => {
        if (dryRun) return;
        generating = true;
        if (settings.audio) void play();
        void updateWake();
    });
    const stop = () => { generating = false; audio?.pause(); void releaseWake(); notify(state()); };
    context.eventSource.on(context.eventTypes.GENERATION_ENDED, stop);
    context.eventSource.on(context.eventTypes.GENERATION_STOPPED, stop);
    document.addEventListener('visibilitychange', () => { void updateWake(); if (!document.hidden && generating && settings.audio && granted) void play(); });
    window.addEventListener('pagehide', () => { stop(); if (audioUrl) { URL.revokeObjectURL(audioUrl); audioUrl = null; audio = null; granted = false; } });
    window.STChatTabsProtection = Object.freeze({ get audioPlaying() { return Boolean(audio && !audio.paused); } });
    return {
        state,
        async enableAudio(enabled) {
            settings.audio = enabled;
            save();
            if (enabled) await play(); // Called directly by the user's click to obtain playback permission.
            else { audio?.pause(); audioError = ''; notify(state()); }
        },
        async enableScreen(enabled) { settings.screen = enabled; save(); await updateWake(); },
    };
}

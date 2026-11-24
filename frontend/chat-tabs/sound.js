import { pageId } from './api.js';
import { claimNotification } from './notifications.js';
export function createSound({ settings, onStatus = () => {} }) {
    const id = pageId(); let audio, last = 0;
    const elect = () => { if (!document.hidden) { try { localStorage.setItem('chat-tabs-sound-owner', id); } catch {} } };
    window.addEventListener('focus', elect); document.addEventListener('visibilitychange', elect); elect();
    document.addEventListener('pointerdown', () => {
        try { audio ||= new (window.AudioContext || window.webkitAudioContext)(); void audio.resume().then(() => onStatus('')).catch(() => onStatus('浏览器暂时不允许播放提示音。')); } catch { onStatus('浏览器暂时不允许播放提示音。'); }
    }, { once: true });
    return { isOwner() { try { return localStorage.getItem('chat-tabs-sound-owner') === id; } catch { return false; } }, play(eventId, { self = false, handled = false } = {}) {
        if (handled || (self ? !settings.soundSelf : settings.soundOthers === false)) return;
        try { if (localStorage.getItem('chat-tabs-sound-owner') !== id) return; } catch { return; }
        if (!audio || audio.state !== 'running') { onStatus('点击一下页面后，浏览器才能播放提示音。'); return; }
        if (Date.now() - last < 1000 || !claimNotification('sound-' + eventId)) return;
        last = Date.now();
        const oscillator = audio.createOscillator(), gain = audio.createGain();
        oscillator.connect(gain); gain.connect(audio.destination); oscillator.frequency.value = 740;
        gain.gain.setValueAtTime(0.0001, audio.currentTime); gain.gain.exponentialRampToValueAtTime(0.12, audio.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.25); oscillator.start(); oscillator.stop(audio.currentTime + 0.27);
    } };
}

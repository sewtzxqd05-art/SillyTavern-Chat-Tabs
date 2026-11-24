(() => {
    const match = /^\/api\/plugins\/chat-tabs\/tab\/([a-f0-9-]+)$/.exec(location.pathname);
    const apiRoots = document.querySelector('meta[name="st-chat-tabs-apis"]')?.content.split(',');
    if (!match || !apiRoots?.length) throw new Error('Chat Tabs routing was not initialized.');

    // The native base href is '/', but this document lives below /api/plugins/.
    // jQuery UI must treat in-page hash tabs as local rather than loading another index.html.
    if (jQuery.ui?.tabs?.prototype?._isLocal) {
        const isLocalOriginal = jQuery.ui.tabs.prototype._isLocal;
        jQuery.ui.tabs.prototype._isLocal = function (anchor) {
            return anchor.getAttribute('href')?.startsWith('#') || isLocalOriginal.call(this, anchor);
        };
    }
    for (const anchor of document.querySelectorAll('a[href^="#"]')) {
        anchor.setAttribute('href', location.pathname + anchor.getAttribute('href'));
    }
    document.addEventListener('click', event => {
        const anchor = event.target instanceof Element ? event.target.closest('a[href^="#"]') : null;
        if (anchor) anchor.setAttribute('href', location.pathname + anchor.getAttribute('href'));
    }, true);

    const scope = location.pathname + '/scope';
    const fetchOriginal = window.fetch.bind(window);
    const xhrOpenOriginal = XMLHttpRequest.prototype.open;
    const client = crypto.randomUUID();
    let lastCsrf = '';
    let blocked = false;
    let characterForm = null;
    function formSignature(data) {
        return JSON.stringify([...data.entries()]
            .filter(([key, value]) => !['chat', 'fav', 'alternate_greetings'].includes(key) && !(value instanceof File && !value.size))
            .map(([key, value]) => [key, value instanceof File ? [value.name, value.size, value.type, value.lastModified] : value])
            .sort(([a], [b]) => a.localeCompare(b)));
    }
    function rememberCharacterForm() {
        const form = document.getElementById('form_create');
        characterForm = form ? formSignature(new FormData(form)) : null;
    }
    window.STChatTabs = Object.freeze({ id: match[1], clientId: client, get ownAudioKeepalive() { return window.STChatTabsProtection?.audioPlaying || false; }, compatibilityGuard: true, rememberCharacterForm });

    function showBlocked() {
        blocked = true;
        if (document.getElementById('chat-tabs-in-use')) return;
        const panel = document.createElement('div');
        panel.id = 'chat-tabs-in-use';
        panel.setAttribute('role', 'alert');
        panel.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#202026f5;color:#fff;display:grid;place-content:center;gap:20px;padding:24px;text-align:center;';
        const message = document.createElement('p');
        message.textContent = '这个已保存窗口正在另一页使用。要分开聊，请回主窗口 → 魔棒 → 多开助手，新建独立窗口。若旧页已关闭，最多等 90 秒后刷新此页。';
        const link = document.createElement('a');
        link.href = '/';
        link.textContent = '回到主窗口';
        link.style.color = '#a8d8ff';
        panel.append(message, link);
        (document.body || document.documentElement).append(panel);
    }

    function getScopedUrl(input) {
        const url = new URL(input, document.baseURI);
        if (url.origin !== location.origin) return null;
        if (url.pathname.startsWith(scope + '/api/')) return url.pathname + url.search;
        if (/^\/api\/plugins\/baibaoku(?:\/|$)/i.test(url.pathname)) return scope + url.pathname + url.search;
        const [, api, section] = url.pathname.toLowerCase().split('/');
        if (api === 'api' && apiRoots.includes(section)) return scope + url.pathname + url.search;
        return null;
    }

    window.fetch = async function (input, options) {
        const request = input instanceof Request;
        const scoped = getScopedUrl(request ? input.url : input);
        if (!scoped) return fetchOriginal(input, options);
        const headers = new Headers(options?.headers ?? (request ? input.headers : undefined));
        headers.set('X-Chat-Tabs-Client', client);
        // Native persona changes refresh an unused greeting through an unchanged character form.
        // Let that refresh succeed without writing the shared PNG. Actual edits stay blocked.
        if (scoped.split('?')[0].endsWith('/api/characters/edit') && options?.body instanceof FormData
            && characterForm !== null && formSignature(options.body) === characterForm) {
            headers.set('X-Chat-Tabs-Refresh', '1');
        }
        lastCsrf = headers.get('X-CSRF-Token') || lastCsrf;
        const template = request ? input.clone() : null;
        const target = request ? new Request(scoped, template.clone()) : scoped;
        let response = await fetchOriginal(target, { ...options, headers });
        // A normal refresh may reach the server just before the previous page releases its lease.
        const inUse = async result => result.status === 409 && (await result.clone().json().catch(() => null))?.code === 'WINDOW_IN_USE';
        let conflict = !blocked && await inUse(response);
        if (conflict) {
            for (let attempt = 0; attempt < 15; attempt++) {
                await new Promise(resolve => setTimeout(resolve, 100));
                response = await fetchOriginal(request ? new Request(scoped, template.clone()) : scoped, { ...options, headers });
                conflict = await inUse(response);
                if (!conflict) break;
            }
            if (conflict) showBlocked();
        }
        return response;
    };

    XMLHttpRequest.prototype.open = function (method, url, ...args) {
        const scoped = getScopedUrl(url);
        const result = xhrOpenOriginal.call(this, method, scoped || url, ...args);
        if (scoped) this.setRequestHeader('X-Chat-Tabs-Client', client);
        return result;
    };

    // A lease prevents duplicate pages from writing the same saved window. It is not Android keepalive.
    const heartbeat = async () => {
        if (blocked) return;
        try {
            const response = await fetchOriginal(location.pathname + '/lease', { headers: { 'X-Chat-Tabs-Client': client } });
            if (response.status === 409) showBlocked();
        } catch { /* Offline pages will be checked again on their next request. */ }
    };
    setInterval(heartbeat, 20_000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) heartbeat(); });
    window.addEventListener('pagehide', event => {
        if (event.persisted || !lastCsrf) return;
        fetchOriginal(location.pathname + '/lease/release', {
            method: 'POST', keepalive: true,
            headers: { 'X-CSRF-Token': lastCsrf, 'X-Chat-Tabs-Client': client },
        }).catch(() => {});
    });

    // Some native token counters use jQuery instead of fetch.
    jQuery.ajaxPrefilter((options, _original, xhr) => {
        if (!getScopedUrl(options.url)) return;
        const token = window.SillyTavern?.getContext().getRequestHeaders()['X-CSRF-Token'];
        if (token) xhr.setRequestHeader('X-CSRF-Token', token);
    });

    // Native OpenRouter OAuth returns to the main page. Use the key field for these tabs.
    document.addEventListener('click', event => {
        if (event.target instanceof Element && event.target.closest('.openrouter_authorize')) {
            event.preventDefault();
            event.stopImmediatePropagation();
            window.toastr.info('请在这个标签页的 API 密钥栏粘贴 OpenRouter 密钥。');
        }
    }, true);

})();

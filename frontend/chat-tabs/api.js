export const BASE = '/api/plugins/chat-tabs';
export const currentTab = /^\/api\/plugins\/chat-tabs\/tab\/([a-f0-9-]+)\/?$/.exec(location.pathname)?.[1];
export async function api(path, method = 'GET', data) {
    const response = await fetch(BASE + path, { method, headers: { ...SillyTavern.getContext().getRequestHeaders(), ...(window.STChatTabs ? { 'X-Chat-Tabs-Client': window.STChatTabs.clientId } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
    if (!response.ok) { const detail = await response.json().catch(() => null); throw new Error(detail?.error || '操作失败（' + response.status + '）'); }
    return response.status === 204 ? null : response.json();
}
export function element(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node; }
export function button(text, action, className = '') { const node = element('button', 'menu_button ' + className, text); node.type = 'button'; node.addEventListener('click', action); return node; }
export function labelField(text, field) { const label = element('label', 'chat-tabs-field'); field.setAttribute('aria-label', text); label.append(element('span', '', text), field); return label; }

export function pageId() { return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2); }

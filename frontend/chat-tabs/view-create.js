import { element, button, labelField } from './api.js';
export function createWindowForm({ getCharacters, getSourceName, create, ready = () => true }) {
    const node = element('form','chat-tabs-form'), character = element('select','text_pole'), history = element('div','chat-tabs-segments'), name = element('input','text_pole'), hint = element('p','chat-tabs-hint');
    character.dataset.tour = 'character'; history.dataset.tour = 'history'; hint.dataset.tour = 'copy';
    name.maxLength = 60; name.placeholder = '不填就用角色名'; history.value = 'new';
    history.setAttribute('role','group');
    const options = new Map();
    for (const [value,text] of [['new','全新聊天'],['branch','复制当前聊天']]) {
        const choice = button(text, () => { history.value = value; updateChoices(); history.dispatchEvent(new Event('change',{bubbles:true})); });
        choice.dataset.history = value; options.set(value,choice); history.append(choice);
    }
    function updateChoices() { for (const [value,choice] of options) choice.setAttribute('aria-pressed',String(history.value === value)); }
    updateChoices();
    const submit = button('创建并打开', () => {},'chat-tabs-primary'); submit.type = 'submit'; submit.dataset.tour = 'create';
    node.append(labelField('角色',character),labelField('从哪开始',history),labelField('窗口名称（选填）',name),hint,submit);
    character.onchange = () => { options.get('branch').disabled = !character.value; if (!character.value) history.value = 'new'; updateChoices(); };
    node.onsubmit = async event => { event.preventDefault(); if (submit.disabled || !ready()) return; submit.disabled = true;
        try { await create({ name:name.value, avatar:character.value, history:history.value }); name.value = ''; } finally { submit.disabled = !ready(); }
    };
    return { node, submit, populate(selected = '') { character.replaceChildren(new Option('进入后再选',''),...getCharacters().filter(c => c.avatar && c.avatar !== 'none').map(c => new Option(c.name,c.avatar))); character.value = selected; character.onchange(); hint.textContent = 'API、美化、预设和 user 人设会从「' + getSourceName() + '」整套复制，之后各改各的。'; } };
}

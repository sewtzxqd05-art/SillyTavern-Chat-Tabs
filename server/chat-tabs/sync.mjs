import fs from 'node:fs';
import path from 'node:path';
import { createHmac, randomBytes } from 'node:crypto';
import { sync as writeAtomic } from 'write-file-atomic';

const JOURNAL = 'sync-journal.json';
const CATEGORIES = ['appearance', 'presets', 'api', 'characters'];
const revisionKey = randomBytes(32);
const words = text => text.trim().split(/\s+/);
// Explicit SillyTavern 1.19 settings allowlists. Never copy power_user or
// extension_settings wholesale: both contain persona and unrelated plugin state.
const APPEARANCE = words(`
    theme main_text_color italics_text_color underline_text_color quote_text_color
    blur_tint_color chat_tint_color user_mes_blur_tint_color bot_mes_blur_tint_color
    shadow_color border_color blur_strength custom_css shadow_width font_scale
    fast_ui_mode waifuMode chat_display toastr_position avatar_style noShadows
    chat_width timer_enabled timestamps_enabled timestamp_model_icon
    message_token_count_enabled mesIDDisplay_enabled hideChatAvatars_enabled
    expand_message_actions enableZenSliders enableLabMode hotswap_enabled
    bogus_folders zoomed_avatar_magnification reduced_motion compact_input_area
    show_swipe_num_all_messages click_to_edit media_display movingUI movingUIState
    movingUIPreset pin_styles charListGrid never_resize_avatars
`);
const OAI_API = words(`
    chat_completion_source group_models sort_models openai_model claude_model
    openrouter_model openrouter_use_fallback openrouter_providers openrouter_quantizations
    openrouter_allow_fallbacks openrouter_middleout ai21_model mistralai_model cohere_model
    perplexity_model groq_model chutes_model siliconflow_model siliconflow_endpoint
    minimax_model minimax_endpoint electronhub_model nanogpt_model nanogpt_provider
    nanogpt_payg_override deepseek_model aimlapi_model xai_model pollinations_model
    pollinations_endpoint moonshot_model fireworks_model cometapi_model custom_model
    custom_url custom_include_body custom_exclude_body custom_include_headers
    custom_prompt_post_processing google_model vertexai_model zai_model zai_endpoint
    workers_ai_model workers_ai_account_id reverse_proxy show_external_models
    proxy_password vertexai_auth_mode vertexai_region vertexai_express_project_id
    bypass_status_check azure_base_url azure_deployment_name azure_api_version azure_openai_model
`);
const OAI_PRESETS = words(`
    preset_settings_openai temp_openai freq_pen_openai pres_pen_openai top_p_openai
    top_k_openai top_a_openai min_p_openai repetition_penalty_openai max_context_unlocked
    tool_reasoning_mode openai_max_context openai_max_tokens names_behavior send_if_empty
    impersonation_prompt new_chat_prompt new_group_chat_prompt new_example_chat_prompt
    continue_nudge_prompt bias_preset_selected bias_presets wi_format scenario_format
    personality_format group_nudge_prompt stream_openai prompts prompt_order assistant_prefill
    assistant_impersonation use_sysprompt squash_system_messages media_inlining
    inline_image_quality continue_prefill continue_postfix function_calling
    tool_call_recurse_limit show_thoughts reasoning_effort verbosity enable_web_search seed n
    request_images request_image_aspect_ratio request_image_resolution extensions
`);
const TEXTGEN_API = words(`
    type mancer_model togetherai_model infermaticai_model ollama_model openrouter_model
    openrouter_providers openrouter_quantizations vllm_model aphrodite_model dreamgen_model
    tabby_model llamacpp_model server_urls custom_model bypass_status_check
    openrouter_allow_fallbacks featherless_model generic_model
`);
const TEXTGEN_PRESETS = words(`
    temp temperature_last top_p top_k top_a tfs epsilon_cutoff eta_cutoff typical_p
    min_p rep_pen rep_pen_range rep_pen_decay rep_pen_slope no_repeat_ngram_size
    penalty_alpha num_beams length_penalty min_length encoder_rep_pen freq_pen presence_pen
    skew do_sample early_stopping dynatemp min_temp max_temp dynatemp_exponent
    smoothing_factor smoothing_curve dry_allowed_length dry_multiplier dry_base
    dry_sequence_breakers dry_penalty_last_n max_tokens_second seed preset add_bos_token
    stopping_strings ban_eos_token skip_special_tokens include_reasoning streaming
    mirostat_mode mirostat_tau mirostat_eta guidance_scale negative_prompt grammar_string
    json_schema json_schema_allow_empty banned_tokens global_banned_tokens send_banned_tokens
    sampler_priority samplers samplers_priorities ignore_eos_token spaces_between_special_tokens
    speculative_ngram sampler_order logit_bias n xtc_threshold xtc_probability nsigma min_keep
    extensions adaptive_target adaptive_decay
`);
const KAI_PRESETS = words(`
    temp rep_pen rep_pen_range top_p min_p top_a top_k typical tfs rep_pen_slope
    streaming_kobold sampler_order mirostat mirostat_tau mirostat_eta
    use_default_badwordsids grammar seed preset_settings extensions
`);
const NAI_PRESETS = words(`
    temperature repetition_penalty repetition_penalty_range repetition_penalty_slope
    repetition_penalty_frequency repetition_penalty_presence tail_free_sampling
    top_k top_p top_a typical_p min_p math1_temp math1_quad math1_quad_entropy_scale
    min_length preset_settings_novel streaming_novel preamble prefix banned_tokens order
    logit_bias extensions
`);
const PROMPT_SETTINGS = words(`
    instruct context sysprompt reasoning tokenizer token_padding collapse_newlines
    pin_examples strip_examples trim_sentences always_force_name2
    custom_stopping_strings custom_stopping_strings_macro prefer_character_prompt
    prefer_character_jailbreak disable_group_trimming single_line trim_spaces
    max_context_unlocked instruct_derived context_derived context_size_derived
    model_templates_mappings
`);
// Search, image, TTS and translation credentials stay private to the target.
const CONVERSATION_SECRETS = words(`
    api_key_horde api_key_mancer api_key_vllm api_key_aphrodite api_key_tabby
    api_key_openai api_key_novel api_key_claude api_key_openrouter api_key_ai21
    api_key_makersuite api_key_vertexai api_key_togetherai api_key_mistralai
    api_key_custom api_key_ooba api_key_infermaticai api_key_dreamgen api_key_koboldcpp
    api_key_llamacpp api_key_cohere api_key_perplexity api_key_groq api_key_featherless
    api_key_huggingface api_key_chutes api_key_electronhub api_key_nanogpt api_key_generic
    api_key_deepseek api_key_aimlapi api_key_xai api_key_fireworks vertexai_service_account_json
    api_key_minimax minimax_group_id api_key_moonshot api_key_cometapi api_key_azure_openai
    api_key_zai api_key_siliconflow api_key_pollinations api_key_workers_ai
`);
const PROFILE_PRESETS = words(`
    preset instruct context instruct-state tokenizer stop-strings start-reply-with
    reasoning-template sysprompt sysprompt-state regex-preset
`);
const PROFILE_API = words('id mode name api api-url model proxy prompt-post-processing secret-id');
const HUB_API = words('id name format endpoint apiKey secretId model availableModels excludeBody');
const HUB_PRESETS = words('preset regexPreset');

function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function jsonFile(file, optional = false) {
    const stat = fs.lstatSync(file, { throwIfNoEntry: false });
    if (!stat && optional) return { raw: null, value: {} };
    if (!stat?.isFile()) throw new Error('Invalid settings file');
    const raw = fs.readFileSync(file, 'utf8');
    const value = JSON.parse(raw);
    if (!object(value)) throw new Error('Invalid settings object');
    return { raw, value };
}
function copyKeys(target, source, keys) {
    for (const key of keys) {
        if (Object.hasOwn(source || {}, key)) target[key] = structuredClone(source[key]);
        else delete target[key];
    }
}
function section(target, source, key, keys) {
    if (!object(target[key])) target[key] = {};
    copyKeys(target[key], source[key], keys);
}
function profiles(source, target, includePresets) {
    if (!object(source)) return undefined;
    return {
        selectedProfile: source.selectedProfile ?? null,
        profiles: (Array.isArray(source.profiles) ? source.profiles : []).filter(object).map(profile => {
            const result = {};
            copyKeys(result, profile, PROFILE_API);
            const previous = target?.profiles?.find(item => item.id === profile.id);
            copyKeys(result, includePresets ? profile : previous, PROFILE_PRESETS);
            const exclusions = Array.isArray(profile.exclude) ? profile.exclude : [];
            result.exclude = exclusions.filter(key => PROFILE_API.includes(key) || key === 'api');
            const presetExclusions = (includePresets ? exclusions : previous?.exclude) || [];
            result.exclude.push(...presetExclusions.filter(key => PROFILE_PRESETS.includes(key)));
            return result;
        }),
    };
}
function apiHub(source, target, includePresets) {
    if (!object(source)) return undefined;
    return {
        activeConnectionId: source.activeConnectionId ?? null,
        // A newly imported API must not replay source preset/regex bindings on reload.
        linkPresetsOnConnectionSwitch: false,
        connections: (Array.isArray(source.connections) ? source.connections : []).filter(object).map(connection => {
            const result = {};
            copyKeys(result, connection, HUB_API);
            const previous = target?.connections?.find(item => item.id === connection.id);
            copyKeys(result, includePresets ? connection : previous, HUB_PRESETS);
            // ApiHub records prompt processing on the connection as well as in native settings.
            copyKeys(result, connection, ['promptPostProcessing']);
            result.status = 'idle';
            result.statusMessage = '';
            return result;
        }),
    };
}
export function mergeSettings(source, destination, categories) {
    const result = structuredClone(destination);
    if (categories.includes('appearance')) {
        section(result, source, 'power_user', APPEARANCE);
        copyKeys(result, source, ['background']);
    }
    if (categories.includes('presets')) {
        section(result, source, 'oai_settings', OAI_PRESETS);
        section(result, source, 'textgenerationwebui_settings', TEXTGEN_PRESETS);
        section(result, source, 'kai_settings', KAI_PRESETS);
        section(result, source, 'nai_settings', NAI_PRESETS);
        section(result, source, 'power_user', PROMPT_SETTINGS);
        copyKeys(result, source, ['amount_gen', 'max_context']);
        if (object(result.extension_settings?.apiHub)) result.extension_settings.apiHub.linkPresetsOnConnectionSwitch = false;
    }
    if (categories.includes('api')) {
        section(result, source, 'oai_settings', OAI_API);
        section(result, source, 'textgenerationwebui_settings', TEXTGEN_API);
        section(result, source, 'kai_settings', ['api_server']);
        section(result, source, 'nai_settings', ['model_novel']);
        copyKeys(result, source, ['main_api', 'proxies', 'selected_proxy', 'horde_settings']);
        result.extension_settings ||= {};
        const includePresets = categories.includes('presets');
        const hub = apiHub(source.extension_settings?.apiHub, result.extension_settings.apiHub, includePresets);
        const manager = profiles(source.extension_settings?.connectionManager, result.extension_settings.connectionManager, includePresets);
        if (hub) result.extension_settings.apiHub = hub;
        else delete result.extension_settings.apiHub;
        if (manager) result.extension_settings.connectionManager = manager;
        else delete result.extension_settings.connectionManager;
    }
    return result;
}

// Explicit selections use merge semantics; legacy callers retain their category contract.
export function selectedConnections(settings) {
    const ext = settings.extension_settings || {};
    return [...(ext.apiHub?.connections || []).map(c => ({ ...c, key: 'hub:' + c.id, kind: 'hub' })),
        ...(ext.connectionManager?.profiles || []).map(c => ({ ...c, key: 'profile:' + c.id, kind: 'profile' }))];
}
export function mergeSelection(source, target, secrets, targetSecrets, categories, options) {
    const result = mergeSettings(source, target, categories.filter(c => c !== 'api' && c !== 'presets'));
    const keys = structuredClone(targetSecrets);
    if (categories.includes('presets')) {
        result.oai_settings ||= {};
        if (options.preset === source.oai_settings?.preset_settings_openai) copyKeys(result.oai_settings, source.oai_settings, OAI_PRESETS);
        else result.oai_settings.preset_settings_openai = options.preset;
    }
    if (categories.includes('api')) {
        const chosen = selectedConnections(source).filter(c => options.connections.includes(c.key));
        result.extension_settings ||= {};
        for (const kind of ['hub', 'profile']) {
            const property = kind === 'hub' ? 'apiHub' : 'connectionManager', list = kind === 'hub' ? 'connections' : 'profiles';
            const items = chosen.filter(c => c.kind === kind);
            if (!items.length) continue;
            const dest = result.extension_settings[property] ||= {};
            dest[list] = Array.isArray(dest[list]) ? dest[list] : [];
            for (const c of items) {
                const old = dest[list].find(x => x.id === c.id), value = {};
                copyKeys(value, c, kind === 'hub' ? [...HUB_API, 'promptPostProcessing'] : PROFILE_API);
                if (old) copyKeys(value, old, kind === 'hub' ? HUB_PRESETS : PROFILE_PRESETS);
                const index = dest[list].findIndex(x => x.id === c.id);
                if (index < 0) dest[list].push(value); else dest[list][index] = value;
                const secretId = c.secretId || c['secret-id'];
                for (const type of CONVERSATION_SECRETS) {
                    const incoming = Array.isArray(secrets[type]) ? secrets[type].find(k => k.id === secretId) : null;
                    if (!incoming) continue;
                    keys[type] = Array.isArray(keys[type]) ? keys[type] : [];
                    const existing = keys[type].findIndex(k => k.id === incoming.id);
                    const secret = { ...incoming, active: existing >= 0 ? keys[type][existing].active : false };
                    if (existing < 0) keys[type].push(secret); else keys[type][existing] = secret;
                }
            }
        }
        if (result.extension_settings.apiHub) result.extension_settings.apiHub.linkPresetsOnConnectionSwitch = false;
        if (options.useActiveConnection) {
            section(result, source, 'oai_settings', OAI_API); copyKeys(result, source, ['main_api']);
            for (const [property, key] of [['apiHub', 'activeConnectionId'], ['connectionManager', 'selectedProfile']]) {
                const active = source.extension_settings?.[property]?.[key];
                if (active && result.extension_settings[property] && chosen.some(c => c.id === active && c.kind === (property === 'apiHub' ? 'hub' : 'profile'))) result.extension_settings[property][key] = active;
            }
            const activeIds = new Set(chosen.map(c => c.secretId || c['secret-id']).filter(Boolean));
            for (const type of CONVERSATION_SECRETS) {
                const active = secrets[type]?.find?.(k => k.active && activeIds.has(k.id));
                if (active && Array.isArray(keys[type])) keys[type] = keys[type].map(k => ({ ...k, active: k.id === active.id }));
            }
        }
    }
    return { settings: result, secrets: keys };
}

// A durable, private roll-forward journal makes settings + credentials one recoverable
// operation. A process exit between the two writes is completed before a window opens.
export function recoverSync(root) {
    const file = path.join(root, JOURNAL);
    if (!fs.existsSync(file)) return;
    const { value: transaction } = jsonFile(file);
    if (transaction.schema !== 1 || !object(transaction.files)
        || Object.keys(transaction.files).some(name => !['settings.json', 'secrets.json', 'tab.json'].includes(name))) {
        throw new Error('Invalid sync journal');
    }
    for (const [name, contents] of Object.entries(transaction.files)) {
        const destination = path.join(root, name);
        const stat = fs.lstatSync(destination, { throwIfNoEntry: false });
        if ((stat && !stat.isFile()) || typeof contents !== 'string' || !object(JSON.parse(contents))) throw new Error('Invalid sync file');
        writeAtomic(destination, contents, { encoding: 'utf8', mode: 0o600 });
    }
    fs.unlinkSync(file);
}

export function setupSync(router, { getTabRoot, busy, guardSettings }) {
    function snapshot(user, body) {
        const { source, target, categories } = body || {};
        if (typeof source !== 'string' || typeof target !== 'string' || source === target
            || !Array.isArray(categories) || !categories.length || new Set(categories).size !== categories.length
            || categories.some(category => !CATEGORIES.includes(category))) {
            return { status: 400, error: '请选择不同的来源和目标窗口，并至少勾选一个同步项目。' };
        }
        const sourceRoot = source === 'main' ? path.resolve(user.directories.root) : getTabRoot(user, source);
        const targetRoot = getTabRoot(user, target);
        if (!sourceRoot || !targetRoot) return { status: 404, error: '来源或目标窗口不存在、已删除或已归档，请刷新窗口列表。' };
        if (busy(targetRoot)) return { status: 409, error: '目标窗口仍在使用、保存尚未结束或有后台任务。请先结束生成并关闭目标窗口，稍等后再同步；异常关闭可能需要等待 90 秒。' };
        const from = { settings: jsonFile(path.join(sourceRoot, 'settings.json')), secrets: jsonFile(path.join(sourceRoot, 'secrets.json'), true), meta: source === 'main' ? null : jsonFile(path.join(sourceRoot, 'tab.json')) };
        const to = { settings: jsonFile(path.join(targetRoot, 'settings.json')), secrets: jsonFile(path.join(targetRoot, 'secrets.json'), true), meta: jsonFile(path.join(targetRoot, 'tab.json')) };
        // Cards are account-wide files. Verify their latest inventory; never replace
        // characterChats or copy the source's private chat pointers onto the target.
        let cards = [];
        if (categories.includes('characters')) {
            cards = fs.readdirSync(user.directories.characters).filter(name => name.endsWith('.png')).sort().flatMap(name => {
                const stat = fs.lstatSync(path.join(user.directories.characters, name));
                return stat.isFile() ? [[name, stat.size, stat.mtimeMs, stat.ctimeMs]] : [];
            });
        }
        const options = body.selectionVersion === 2 ? { preset: body.preset, connections: body.connections || [], useActiveConnection: !!body.useActiveConnection } : null;
        if (options) {
            if (!Array.isArray(options.connections) || options.connections.some(id => !selectedConnections(from.settings.value).some(c => c.key === id))) return { status: 400, error: '连接选择已经变化，请重新选择。' };
            if (categories.includes('presets') && (typeof options.preset !== 'string' || !options.preset || options.preset.includes('/') || options.preset.includes('\\') || options.preset === '..')) return { status: 400, error: '请选择预设。' };
            if (categories.includes('presets') && options.preset !== from.settings.value.oai_settings?.preset_settings_openai
                && !fs.lstatSync(path.join(user.directories.openAI_Settings, options.preset + '.json'), { throwIfNoEntry: false })?.isFile()) return { status: 400, error: '预设文件不存在。' };
            if (options.useActiveConnection) {
                const ext = from.settings.value.extension_settings || {};
                const required = [ext.apiHub?.activeConnectionId && 'hub:' + ext.apiHub.activeConnectionId, ext.connectionManager?.selectedProfile && 'profile:' + ext.connectionManager.selectedProfile].filter(Boolean);
                if (!required.length || required.some(id => !options.connections.includes(id))) return { status: 400, error: '请同时勾选来源正在使用的连接。' };
            }
        }
        const revision = createHmac('sha256', revisionKey).update(JSON.stringify({ source, target, categories, from, to, cards, options })).digest('hex');
        return { source, target, categories, from, to, cards, targetRoot, revision, options };
    }
    function check(req, res) {
        try {
            const state = snapshot(req.user, req.body);
            if (state.error) { res.status(state.status).json({ error: state.error }); return null; }
            return state;
        } catch {
            res.status(409).json({ error: '窗口存档格式或目录异常，未执行同步。请检查文件权限或完成待恢复的同步。' });
            return null;
        }
    }
    router.get('/tabs/sync/catalog', (req, res) => {
        try {
            const source = req.query.source || 'main';
            const root = source === 'main' ? req.user.directories.root : getTabRoot(req.user, source);
            if (!root) return res.sendStatus(404);
            const settings = jsonFile(path.join(root, 'settings.json')).value;
            const ext = settings.extension_settings || {};
            res.json({ preset: settings.oai_settings?.preset_settings_openai || '', theme: settings.power_user?.theme || '',
                presets: fs.readdirSync(req.user.directories.openAI_Settings).filter(n => n.endsWith('.json')).map(n => n.slice(0, -5)),
                connections: selectedConnections(settings).map(c => ({ key: c.key, name: c.name || c.id, model: c.model || '', endpoint: c.endpoint || c['api-url'] || '', format: c.format || c.api || '', hasSecret: !!(c.secretId || c['secret-id'] || c.apiKey),
                    active: c.kind === 'hub' ? c.id === ext.apiHub?.activeConnectionId : c.id === ext.connectionManager?.selectedProfile })) });
        } catch { res.status(409).json({ error: '无法读取同步资料。' }); }
    });
    router.post('/tabs/sync/plan', (req, res) => {
        const state = check(req, res);
        if (!state) return;
        res.json({ revision: state.revision, categories: state.categories, sharedCards: state.cards.length });
    });
    router.post('/tabs/sync', async (req, res) => {
        await new Promise(resolve => setTimeout(resolve, 0));
        const state = check(req, res);
        if (!state) return;
        if (req.body.revision !== state.revision) return res.status(409).json({ error: '来源或目标的已保存资料已经变化，未执行同步。请核对选择后重新点击同步。' });
        const { from, to, categories, source, targetRoot } = state;
        const files = {};
        const selected = state.options ? mergeSelection(from.settings.value, to.settings.value, from.secrets.value, to.secrets.value, categories, state.options) : null;
        if (categories.includes('api')) {
            const secrets = structuredClone(to.secrets.value);
            if (!selected) copyKeys(secrets, from.secrets.value, CONVERSATION_SECRETS);
            files['secrets.json'] = JSON.stringify(selected?.secrets || secrets, null, 2);
        }
        if (categories.some(category => category !== 'characters')) {
            files['settings.json'] = JSON.stringify(guardSettings(selected?.settings || mergeSettings(from.settings.value, to.settings.value, categories)), null, 2);
        }
        const meta = structuredClone(to.meta.value);
        if (state.options && categories.includes('presets')) {
            if (state.options.preset !== from.settings.value.oai_settings?.preset_settings_openai) meta.pendingPreset = state.options.preset;
            else delete meta.pendingPreset;
        }
        meta.lastSync = { at: Date.now(), source, categories };
        files['tab.json'] = JSON.stringify(meta, null, 2);
        try {
            writeAtomic(path.join(targetRoot, JOURNAL), JSON.stringify({ schema: 1, files }), { encoding: 'utf8', mode: 0o600 });
            recoverSync(targetRoot);
        } catch {
            return res.status(500).json({ error: '同步写入尚未完成。请检查磁盘空间与文件权限；窗口重新打开前会先恢复这次同步。' });
        }
        res.json({ synced: categories, sharedCards: state.cards.length, reopen: true });
    });
}

// Uses an existing local SillyTavern installation. Never copies its user data.
import fs from 'node:fs';
import path from 'node:path';

const source = process.env.ST_ROOT;
if (!source || JSON.parse(fs.readFileSync(path.join(source, 'package.json'))).name !== 'sillytavern') {
    throw new Error('Set ST_ROOT to an existing SillyTavern 1.19 installation.');
}
const root = path.resolve('work/st-review');
function copyDirectory(from, to, filter = () => true) {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        const sourceFile = path.join(from, entry.name);
        if (!filter(sourceFile)) continue;
        const targetFile = path.join(to, entry.name);
        if (entry.isDirectory()) copyDirectory(sourceFile, targetFile, filter);
        else if (entry.isFile()) fs.copyFileSync(sourceFile, targetFile);
    }
}
fs.mkdirSync(root, { recursive: true });
for (const name of ['src', 'default', 'public']) {
    if (fs.existsSync(path.join(root, name))) continue;
    copyDirectory(path.join(source, name), path.join(root, name), file => !file.split(path.sep).join('/').includes('/extensions/third-party/'));
}
for (const name of ['package.json', 'server.js', 'plugins.js', 'webpack.config.js']) {
    fs.copyFileSync(path.join(source, name), path.join(root, name));
}
const modules = path.join(root, 'node_modules');
if (!fs.existsSync(modules)) fs.symlinkSync(path.join(source, 'node_modules'), modules, 'junction');
fs.mkdirSync(path.join(root, 'plugins'), { recursive: true });
copyDirectory('server/chat-tabs', path.join(root, 'plugins/chat-tabs'));
copyDirectory('frontend/chat-tabs', path.join(root, 'public/scripts/extensions/third-party/chat-tabs'));
let config = fs.readFileSync(path.join(source, 'default/config.yaml'), 'utf8')
    .replace(/^port:.*$/m, 'port: 18122')
    .replace(/^enableServerPlugins:.*$/m, 'enableServerPlugins: true')
    .replace(/^enableServerPluginsAutoUpdate:.*$/m, 'enableServerPluginsAutoUpdate: false')
    .replace(/^enableDownloadableTokenizers:.*$/m, 'enableDownloadableTokenizers: false')
    .replace(/^skipContentCheck:.*$/m, 'skipContentCheck: true')
    .replace(/(browserLaunch:[^]*?enabled:) true/, '$1 false');
fs.writeFileSync(path.join(root, 'config.yaml'), config);
const user = path.join(root, 'data/default-user');
fs.mkdirSync(user, { recursive: true });
const folders = { character: 'characters', sprites: 'characters', background: 'backgrounds', world: 'worlds',
    avatar: 'User Avatars', theme: 'themes', workflow: 'user/workflows', kobold_preset: 'KoboldAI Settings',
    openai_preset: 'OpenAI Settings', novel_preset: 'NovelAI Settings', textgen_preset: 'TextGen Settings',
    instruct: 'instruct', context: 'context', moving_ui: 'movingUI', quick_replies: 'QuickReplies', sysprompt: 'sysprompt', reasoning: 'reasoning' };
for (const item of JSON.parse(fs.readFileSync(path.join(root, 'default/content/index.json')))) {
    if (!folders[item.type]) continue;
    const target = path.join(user, folders[item.type], path.basename(item.filename));
    if (fs.existsSync(target)) continue;
    const from = path.join(root, 'default/content', item.filename);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (fs.statSync(from).isDirectory()) copyDirectory(from, target);
    else fs.copyFileSync(from, target);
}
if (!fs.existsSync(path.join(user, 'settings.json'))) {
    const settings = JSON.parse(fs.readFileSync(path.join(root, 'default/content/settings.json')));
    settings.firstRun = false;
    settings.main_api = 'openai';
    settings.power_user.auto_load_chat = false;
    settings.oai_settings.chat_completion_source = 'custom';
    settings.oai_settings.custom_url = 'http://127.0.0.1:18121/v1';
    settings.oai_settings.custom_model = 'review-model';
    settings.oai_settings.stream_openai = true;
    fs.writeFileSync(path.join(user, 'settings.json'), JSON.stringify(settings, null, 2));
    fs.writeFileSync(path.join(user, 'secrets.json'), JSON.stringify({
        api_key_custom: [{ id: 'review-only', value: 'synthetic-review-key', label: 'Local fixture', active: true }],
    }));
}
console.log('Fixture prepared at ' + root + '. Start node server.js with that directory as the working directory.');

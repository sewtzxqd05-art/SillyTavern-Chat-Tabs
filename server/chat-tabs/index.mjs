import { VERSION } from './version.mjs';
export const info = { id: 'chat-tabs', name: '酒馆多开', description: 'Independent native SillyTavern windows.' };
export async function init(router) {
    let runtime;
    try { runtime = await import('./runtime.mjs'); }
    catch (error) {
        console.error('[Chat Tabs] 无法加载酒馆内部接口，请检查酒馆版本与插件安装：', error.message);
        router.get('/capabilities', (_req, res) => res.json({ version: VERSION, independentWindows: false, backgroundGeneration: false, compatibilityErrors: ['酒馆内部接口加载失败'] }));
        return;
    }
    return runtime.init(router);
}

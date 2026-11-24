import fs from 'node:fs';
import path from 'node:path';

// Prepare the same URLs the native loader will use, without executing extensions
// or changing their activation order. Global files are served before user files.
export function extensionPreloads(publicDirectory, userExtensions, settings) {
    const disabled = new Set(settings.extension_settings?.disabledExtensions || []);
    const extensions = new Map();
    const scan = (directory, prefix) => {
        if (!directory || !fs.existsSync(directory)) return;
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            if (!entry.isDirectory() || entry.name === 'third-party' || entry.name.startsWith('.')) continue;
            const name = prefix + entry.name;
            if (extensions.has(name)) continue;
            try {
                extensions.set(name, JSON.parse(fs.readFileSync(path.join(directory, entry.name, 'manifest.json'), 'utf8')));
            } catch { /* Native discovery also ignores folders without a usable manifest. */ }
        }
    };
    scan(publicDirectory, '');
    scan(path.join(publicDirectory, 'third-party'), 'third-party/');
    scan(userExtensions, 'third-party/');
    const links = new Set();
    for (const [name, manifest] of extensions) {
        if (disabled.has(name)) continue;
        for (const [key, rel] of [['js', 'modulepreload'], ['css', 'preload']]) {
            const file = manifest[key];
            if (typeof file !== 'string' || !file || file.split('/').some(part => !part || part === '.' || part === '..')
                || /[\\:?#]/.test(file)) continue;
            const url = '/scripts/extensions/' + [...name.split('/'), ...file.split('/')].map(encodeURIComponent).join('/');
            links.add('<link rel="' + rel + '"' + (key === 'css' ? ' as="style"' : '') + ' href="' + url + '">');
        }
    }
    return [...links].join('');
}

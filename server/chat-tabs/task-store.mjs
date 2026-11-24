import fs from 'node:fs';
import path from 'node:path';

// The metadata index never contains reply bodies. Retained tombstones prevent old
// request IDs from becoming a second paid generation after payload expiry.
export function createTaskStore({ readJson, writeJson, now = Date.now }) {
    const ready = new Set();
    const directory = root => path.join(root, 'tasks');
    const file = (root, id) => path.join(directory(root), id + '.json');
    const indexFile = root => path.join(directory(root), 'index.json');
    const summary = task => { const { result, baseline, ...meta } = task; return meta; };
    function index(root) {
        if (!fs.existsSync(directory(root))) return {};
        if (!ready.has(root)) {
            const items = {};
            for (const name of fs.readdirSync(directory(root))) {
                if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.json$/.test(name)) continue;
                const task = readJson(path.join(directory(root), name));
                if (task.applied || task.dismissed) {
                    task.handledAt ||= task.completed || task.created;
                    delete task.result; delete task.baseline;
                    writeJson(file(root, task.id), task);
                }
                items[task.id] = summary(task);
            }
            // Previously expired IDs must survive an index rebuild.
            if (fs.existsSync(indexFile(root))) {
                for (const [id, task] of Object.entries(readJson(indexFile(root)))) if (!items[id]) items[id] = task;
            }
            writeJson(indexFile(root), items); ready.add(root);
        }
        return readJson(indexFile(root));
    }
    function write(root, task) {
        fs.mkdirSync(directory(root), { recursive: true, mode: 0o700 });
        const items = index(root);
        if (task.applied || task.dismissed) {
            task.handledAt ||= now(); delete task.result; delete task.baseline;
        }
        writeJson(file(root, task.id), task);
        items[task.id] = summary(task); writeJson(indexFile(root), items);
    }
    function list(root) {
        const items = index(root);
        for (const task of Object.values(items)) {
            if ((task.applied || task.dismissed) && now() - (task.handledAt || task.completed || task.created) > 7 * 86400000
                && fs.existsSync(file(root, task.id))) fs.unlinkSync(file(root, task.id));
        }
        return Object.values(items).sort((a, b) => b.created - a.created);
    }
    function read(root, id) {
        const items = index(root);
        return fs.existsSync(file(root, id)) ? readJson(file(root, id)) : items[id] || null;
    }
    return { read, write, list };
}

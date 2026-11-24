import fs from 'node:fs';
import path from 'node:path';
// Walk only the caller-validated root. Links are unlinked, never traversed.
// Explicit unlink/rmdir also avoids Node's Windows rmSync silent no-op on
// some non-ASCII directory paths. Report success only after the root is gone.
export function removeWindowDirectory(root) {
    const stat = fs.lstatSync(root, { throwIfNoEntry: false });
    if (!stat) return;
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid window directory');
    function remove(directory) {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const target = path.join(directory, entry.name);
            const current = fs.lstatSync(target);
            if (current.isDirectory() && !current.isSymbolicLink()) remove(target);
            else fs.unlinkSync(target);
        }
        fs.rmdirSync(directory);
    }
    remove(root);
    if (fs.existsSync(root)) throw new Error('Window directory was not removed');
}

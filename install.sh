#!/usr/bin/env sh
set -eu
st_package_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
st_install_root=${1:-}
if [ -z "$st_install_root" ]; then
    printf '%s\n' 'Usage: sh ./install.sh /path/to/SillyTavern' >&2
    exit 1
fi
st_install_root=$(CDPATH= cd -- "$st_install_root" && pwd)
st_mode=full
if [ "$#" -ge 2 ]; then st_mode="$2"; fi
if [ "$st_mode" != 'full' ] && [ "$st_mode" != '--frontend-only' ] && [ "$st_mode" != '--backend-only' ]; then
    printf '%s\n' 'Second argument must be --frontend-only, --backend-only, or omitted for a full installation.' >&2
    exit 1
fi
node -e 'const fs=require("node:fs"),p=process.argv[1],mode=process.argv[2],j=JSON.parse(fs.readFileSync(p+"/package.json"));if(j.name!=="sillytavern"||!fs.existsSync(p+"/server.js"))process.exit(1);const v=j.version.split(".").map(Number);if(v[0]<1||(v[0]===1&&v[1]<19))throw Error("Requires SillyTavern 1.19.0 or newer");if(mode!=="--frontend-only"&&!/^enableServerPlugins:\s*true\s*(?:#.*)?$/m.test(fs.readFileSync(p+"/config.yaml","utf8")))throw Error("Set enableServerPlugins: true first");' "$st_install_root" "$st_mode"
if [ "$st_mode" != '--backend-only' ]; then
    for candidate in "$st_install_root/public/scripts/extensions/third-party/SillyTavern-Chat-Tabs" "$st_install_root"/data/*/extensions/chat-tabs "$st_install_root"/data/*/extensions/SillyTavern-Chat-Tabs "$st_install_root"/data/*/extensions/third-party/chat-tabs "$st_install_root"/data/*/extensions/third-party/SillyTavern-Chat-Tabs; do
        if [ -e "$candidate" ]; then printf 'Another Chat Tabs installation exists: %s\n' "$candidate" >&2; exit 1; fi
    done
fi
for st_part in server frontend; do
    case "$st_part:$st_mode" in server:--frontend-only|frontend:--backend-only) continue;; esac
    test -d "$st_package_root/$st_part/chat-tabs" || { printf 'Installation source missing: %s\n' "$st_part" >&2; exit 1; }
    if [ "$st_part" = server ]; then st_target="$st_install_root/plugins/chat-tabs"; else st_target="$st_install_root/public/scripts/extensions/third-party/chat-tabs"; fi
    case "$st_package_root/" in "$st_target/"*) printf '%s\n' 'Run the installer from a separate extracted package.' >&2; exit 1;; esac
done
st_backup_root="$st_install_root/.chat-tabs-backups/$(date +%Y%m%d-%H%M%S)-$$"
if [ "$st_mode" != '--frontend-only' ] && [ -L "$st_install_root/plugins/chat-tabs" ]; then
    printf '%s\n' 'Refusing to overwrite a server plugin symlink.' >&2
    exit 1
fi
if [ "$st_mode" != '--backend-only' ] && [ -L "$st_install_root/public/scripts/extensions/third-party/chat-tabs" ]; then
    printf '%s\n' 'Refusing to overwrite a frontend extension symlink.' >&2
    exit 1
fi
if [ "$st_mode" != '--frontend-only' ] && [ -d "$st_install_root/plugins/chat-tabs" ]; then
    mkdir -p "$st_backup_root"
    mv "$st_install_root/plugins/chat-tabs" "$st_backup_root/server"
fi
if [ "$st_mode" != '--backend-only' ] && [ -d "$st_install_root/public/scripts/extensions/third-party/chat-tabs" ]; then
    mkdir -p "$st_backup_root"
    mv "$st_install_root/public/scripts/extensions/third-party/chat-tabs" "$st_backup_root/frontend"
fi
if [ "$st_mode" != '--frontend-only' ]; then
    mkdir -p "$st_install_root/plugins/chat-tabs"
    cp -R "$st_package_root/server/chat-tabs/." "$st_install_root/plugins/chat-tabs/"
fi
if [ "$st_mode" != '--backend-only' ]; then
    mkdir -p "$st_install_root/public/scripts/extensions/third-party/chat-tabs"
    cp -R "$st_package_root/frontend/chat-tabs/." "$st_install_root/public/scripts/extensions/third-party/chat-tabs/"
fi
if [ "$st_mode" = '--frontend-only' ]; then
    printf '%s\n' 'Installed Chat Tabs 1.6.0-beta.1 frontend only. Refresh the page. Background tasks require the server plugin.'
elif [ "$st_mode" = '--backend-only' ]; then
    printf '%s\n' 'Installed Chat Tabs 1.6.0-beta.1 companion only. Restart SillyTavern and refresh all pages.'
else
    printf '%s\n' 'Installed Chat Tabs 1.6.0-beta.1 frontend and server. Restart SillyTavern and refresh all pages.'
fi

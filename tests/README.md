# 在已有酒馆旁验证，不使用真实对话

单元测试只依赖 Node.js 内置模块，在项目根目录执行：

```powershell
npm test
```

1.6 本地测试版覆盖任务正文清理与轻量索引、中文路径删除、按连接合并密钥、单预设同步、版本一致性、普通生成已读与通知、提示音选举，以及原有恢复和请求保护。

隔离服务启动后，执行 `npm run test:integration` 和 `node tests/redesign-integration.mjs`。新增集成覆盖空请求体、占用时拒绝归档、上次打开时间、连接与密钥合并、待应用预设及单个归档删除。

`browser-check.js` 是供 Playwright 调用的 async page 函数，覆盖桌面/手机布局与四段练习、练习不发生产写请求；`browser-create.js` 检查保存失败不创建；`browser-generation.js` 检查后台任务只有一次提交。实际运行记录见 REVIEW.md，不把脚本存在当成已执行证据。

## 隔离的原生酒馆与合成接口

需要本机已有 SillyTavern 1.19.0 及其 node_modules。准备脚本只复制代码和默认内容，不复制源安装的 data、config、密钥或第三方扩展。node_modules 使用本地目录链接；Windows 环境应允许创建 junction。

在项目根目录：

```powershell
$env:ST_ROOT = 'D:/SillyTavern'
npm run test:fixture
```

测试服务只监听本机。使用三个终端：

```powershell
# 终端一：项目根目录，合成回复服务
node tests/mock-api.mjs
```

```powershell
# 终端二：必须切换工作目录，避免读取真实酒馆配置
Set-Location ./work/st-review
node server.js --port 18122
```

```powershell
# 终端三：项目根目录；等待终端二显示 listening 后运行
npm run test:integration
```

合成接口固定在 127.0.0.1:18121；酒馆固定在 127.0.0.1:18122。前端首次编译可能需要十余秒。集成测试会新建「夜航 · 主线」「旧信 · 平行剧情」，注入聊天损坏和同步冲突，并记录到 `work/review-state.json`。重复运行会增加新的样例窗口；重跑前关闭上一轮测试浏览器，防止占用样例。

启动优化检查验证：占用查询连续读取仍不占用窗口；取得租约后返回打开状态；释放后立即返回关闭状态；独立页在 head 中提供原生插件 URL 的 modulepreload。此检查不代表日常插件环境的整体启动耗时测量。

集成脚本会写入 `work/st-review/data/default-user`，不能将脚本改指向真实酒馆或替换该目录为真实账户。样例 secrets.json 只有合成密钥。测试输出中“每次一条请求”指本机适配器请求数，不是真实供应商账单。

## 浏览器检查

使用已安装的 Playwright CLI 和一个隔离会话，先打开本机测试酒馆；不要让这些脚本访问日常酒馆。`$pwcli` 替换为本机已有的 playwright-cli.js 路径。

```powershell
node $pwcli -s=chat-tabs-review open http://127.0.0.1:18122/
node $pwcli -s=chat-tabs-review run-code --filename tests/browser-check.js
node $pwcli -s=chat-tabs-review run-code --filename tests/browser-generation.js
node $pwcli -s=chat-tabs-review run-code --filename tests/browser-create.js
node $pwcli -s=chat-tabs-review close
```

先运行后端集成准备角色和待处理回复。check 检查两种宽度、主窗口排序和四段练习的数据隔离；generation 检查一次后台提交与一次消息交付；create 注入保存失败再恢复。`browser-native-monitor.js` 使用真实本机 SSE 与跨页广播，只有页面可见性在自动化中模拟；需先进入可生成的独立样例。`browser-light.js` 使用隔离账户的原生浅色验收主题。实际执行及边界以 REVIEW.md 为准。

新版截图写入 `output/`，早期后台生成截图在 `outputs/`；均不含真实聊天。测试结束关闭本次 CLI 会话，只停止记录的隔离服务进程。

本轮为复用本机依赖而建立的 junction 会让原生头像缩略图 WASM 触发路径限制告警；文本任务、保存、同步链路已通过，图片相关能力不在此次验证结论内。

import http from 'node:http';
const requests = [];
const server = http.createServer(async (req, res) => {
    if (req.url === '/received') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(requests)); }
    if (req.url.endsWith('/models')) { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ data: [{ id: 'review-model' }] })); }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    requests.push({ model: body.model, stream: body.stream });
    if (body.stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        const content = Array.from('窗外的雨声渐渐轻了。「你回来了。」他把留着温度的茶推过来，等你慢慢接上刚才的话。这是本机合成流式回复，用于验证多窗口的时间、字速和完成状态。');
        let index = 0;
        const timer = setInterval(() => {
            if (res.destroyed) { clearInterval(timer); return; }
            if (index < content.length) {
                res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: content[index++] }, finish_reason: null }] }) + '\n\n');
            } else {
                clearInterval(timer);
                res.end('data: ' + JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
            }
        }, 450);
        res.on('close', () => clearInterval(timer));
        return;
    }
    const delay = body.model === 'cancel-model' ? 12000 : 1800;
    setTimeout(() => {
        if (res.destroyed) return;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ id: 'mock-completion', model: body.model, choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '窗外的雨声渐渐轻了。\n\n「你回来了。」他把留着温度的茶推过来，等你慢慢接上刚才的话。 · ' + body.model } }], usage: { prompt_tokens: 12, completion_tokens: 48, total_tokens: 60 } }));
    }, delay);
});
server.listen(18121, '127.0.0.1', () => console.log('Synthetic chat API listening on 18121; no external requests.'));

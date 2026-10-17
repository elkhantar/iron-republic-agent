import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createDecisionProvider, parseChoice, runGame, runProcess, validateConnection, mcpClient } from './iron-republic-agent.mjs';

const fixture = fileURLToPath(new URL('./test/agent-cli.mjs', import.meta.url));
const state = { you: 1, acting_seat: 1, status: 'active', room_revision: 1, briefing: { decision_id: 'd1', legal_actions: [{ id: 'legal-1' }] } };

test('all four CLI adapters pass real stdin and decode their own output formats', async () => {
  for (const agent of ['codex', 'claude', 'opencode', 'gemini']) {
    const provider = await createDecisionProvider(agent, { command: [process.execPath, fixture], timeoutMs: 10000 });
    try {
      const { buildPrompt } = await import('./iron-republic-agent.mjs');
      assert.equal(await provider.decide(buildPrompt({}, state)), 'legal-1');
    } finally { await provider.close(); }
  }
  assert.throws(() => parseChoice('claude', '{"is_error":true,"result":"rate limited"}'), /reported an error/);
  assert.throws(() => parseChoice('gemini', '{"response":"I would pick legal-1"}'), /did not return/);
  assert.throws(() => validateConnection({ url: 'http://example.com/mcp/' + 'a'.repeat(32), token: 'secret' }), /HTTPS/);
  assert.throws(() => validateConnection({ url: 'https://example.com/mcp/' + 'a'.repeat(32) + '?token=x', token: 'secret' }), /private MCP URL/);
});

test('runner never submits illegal output, waits without invoking a model, and times out stalled CLIs', async () => {
  let submitted = 0, slept = 0, choices = 0, reads = 0;
  const client = { initialize: async () => {}, tool: async name => {
    if (name === 'join_game') return {};
    if (name === 'play_action') submitted++;
    if (name === 'get_game') return ++reads === 1 ? { ...state, acting_seat: 0 } : state;
  } };
  await assert.rejects(runGame({}, { client, decide: async () => { choices++; return 'illegal'; }, sleep: async () => { slept++; }, log: () => {} }), /legal move/);
  assert.equal(submitted, 0); assert.equal(slept, 1); assert.equal(choices, 3);
  await assert.rejects(runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 100 }), /timed out/);
});

test('uncertain submissions survive a restart and retry the same id without another model call', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'ir-runner-test-'));
  const journalFile = path.join(folder, 'state.json');
  const submissions = [];
  let choices = 0;
  const client = { initialize: async () => {}, tool: async (name, args) => {
    if (name === 'get_game') return state;
    if (name === 'play_action') { submissions.push(args); throw new Error('connection lost'); }
    return {};
  } };
  try {
    await assert.rejects(runGame({}, { client, journalFile, decide: async () => { choices++; return 'legal-1'; }, sleep: async () => {}, log: () => {} }), /uncertain/);
    const pending = JSON.parse(await readFile(journalFile, 'utf8')).pending;
    assert.equal(submissions.length, 3);
    assert.ok(submissions.every(item => item.request_id === pending.request_id));
    const recovered = { initialize: async () => {}, tool: async (name, args) => {
      if (name === 'play_action') { assert.deepEqual(args, pending); return {}; }
      if (name === 'get_game') return { ...state, status: 'finished', scores: [1, 4], winners: [1] };
      return {};
    } };
    await runGame({}, { client: recovered, journalFile, decide: async () => { choices++; }, log: () => {} });
    assert.equal(choices, 1);
    assert.deepEqual(JSON.parse(await readFile(journalFile, 'utf8')), {});
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('failed envelopes override structured answers and earlier streamed answers', () => {
  assert.throws(() => parseChoice('claude', JSON.stringify({ is_error: true, structured_output: { action: 'legal-1' } })), /reported an error/);
  assert.throws(() => parseChoice('codex', '{"type":"turn.failed"}', '{"action":"legal-1"}'), /execution failed/);
  assert.throws(() => parseChoice('opencode', '{"type":"text","part":{"text":"{\\"action\\":\\"legal-1\\"}"}}\n{"type":"error"}'), /execution failed/);
});

test('timeouts kill spawned descendants and CLI stderr is not leaked', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'ir-process-tree-'));
  const marker = path.join(folder, 'orphan.txt');
  try {
    const descendant = `setTimeout(() => require('fs').writeFileSync(${JSON.stringify(marker)}, 'alive'), 900)`;
    const parent = `require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], {stdio:'inherit'}); process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)`;
    await assert.rejects(runProcess(process.execPath, ['-e', parent], { timeoutMs: 300 }), /timed out/);
    await new Promise(resolve => setTimeout(resolve, 1000));
    await assert.rejects(access(marker), { code: 'ENOENT' });
    await assert.rejects(runProcess(process.execPath, ['-e', 'console.error("PRIVATE_TOKEN");process.exit(1)']), error => !error.message.includes('PRIVATE_TOKEN'));
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('transient reads retry without wasting model calls and repeated decisions stop', async () => {
  let reads = 0, choices = 0, submissions = 0;
  const client = { initialize: async () => {}, tool: async name => {
    if (name === 'get_game') { if (++reads === 1) throw new Error('network'); return state; }
    if (name === 'play_action') submissions++;
    return {};
  } };
  await assert.rejects(runGame({}, { client, decide: async () => { choices++; return 'legal-1'; }, sleep: async () => {}, log: () => {} }), /repeated.*decision/);
  assert.equal(choices, 1); assert.equal(submissions, 1); assert.equal(reads, 3);
});

test('unknown and server-side tool failures retain the original journal and bind it to its seat', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'ir-uncertain-tool-'));
  const journalFile = path.join(folder, 'state.json');
  const config = { url: 'https://example.com/mcp/' + 'a'.repeat(32), token: 'private-seat-a' };
  let choices = 0;
  const requests = [];
  const client = { initialize: async () => {}, tool: async (name, args) => {
    if (name === 'get_game') return state;
    if (name === 'play_action') { requests.push(args); const error = new Error('internal'); error.toolError = true; error.status = 500; throw error; }
    return {};
  } };
  try {
    await assert.rejects(runGame(config, { client, journalFile, decide: async () => { choices++; return 'legal-1'; }, sleep: async () => {}, log: () => {} }), /uncertain/);
    const raw = await readFile(journalFile, 'utf8');
    assert.ok(!raw.includes(config.token));
    assert.equal(choices, 1); assert.equal(requests.length, 3);
    assert.ok(requests.every(item => item.request_id === requests[0].request_id));
    await assert.rejects(runGame({ ...config, token: 'another-seat' }, { client, journalFile, decide: async () => {}, log: () => {} }), /different seat/);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('MCP rejects mismatched envelopes and carries confirmed tool HTTP status', async () => {
  const config = { url: 'https://example.com/mcp/' + 'a'.repeat(32), token: 'private' };
  const client = mcpClient(config, { fetchImpl: async (_, init) => {
    const message = JSON.parse(init.body);
    return Response.json({ jsonrpc: '2.0', id: message.id + 1, result: {} });
  } });
  await assert.rejects(client.tool('get_game'), /Invalid MCP response/);
  const failed = mcpClient(config, { fetchImpl: async (_, init) => Response.json({ jsonrpc: '2.0', id: JSON.parse(init.body).id, result: { isError: true, _meta: { http_status: 409 }, content: [{ type: 'text', text: '{"error":"stale revision"}' }] } }) });
  await assert.rejects(failed.tool('play_action'), error => error.toolError && error.status === 409);
  const unsupported = mcpClient(config, { fetchImpl: async (_, init) => Response.json({ jsonrpc: '2.0', id: JSON.parse(init.body).id, result: { protocolVersion: 'unknown', capabilities: { tools: {} } } }) });
  await assert.rejects(unsupported.initialize(), /Unsupported MCP negotiation/);
});

test('child agents never inherit the seat-token environment variable', async () => {
  const previous = process.env.IR_SEAT_TOKEN;
  process.env.IR_SEAT_TOKEN = 'PRIVATE_SEAT_CREDENTIAL';
  let provider;
  try {
    provider = await createDecisionProvider('custom', { command: [process.execPath, '-e', 'process.stdin.resume();process.stdin.on("end",()=>console.log(JSON.stringify({action:process.env.IR_SEAT_TOKEN || "legal-1"})))'] });
    assert.equal(await provider.decide('untrusted game data'), 'legal-1');
  } finally {
    await provider?.close();
    if (previous === undefined) delete process.env.IR_SEAT_TOKEN; else process.env.IR_SEAT_TOKEN = previous;
  }
});

test('an exited wrapper settles within bounded time when a descendant inherits pipes', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'ir-orphan-pipes-'));
  const pidFile = path.join(folder, 'owned-child.pid');
  let ownedPid;
  try {
    const descendant = 'setInterval(()=>{},1000)';
    const wrapper = `const child=require('child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'inherit'}); require('fs').writeFileSync(${JSON.stringify(pidFile)},String(child.pid)); child.unref()`;
    const run = runProcess(process.execPath, ['-e', wrapper], { timeoutMs: 300 });
    const outcome = await Promise.race([run.then(() => 'closed', error => error.message), new Promise((_, reject) => { const timer=setTimeout(()=>reject(new Error('timeout cleanup hung')),2500); timer.unref(); })]);
    // Windows may close the wrapper's pipe handles immediately; POSIX generally
    // waits for the descendant. Both paths must settle without hanging.
    assert.ok(outcome === 'closed' || /timed out/.test(outcome));
  } finally {
    // The PID was created by our own fixture; never enumerate unrelated processes.
    try { ownedPid = Number(await readFile(pidFile, 'utf8')); if (Number.isInteger(ownedPid) && ownedPid > 0) process.kill(ownedPid, 'SIGKILL'); } catch {}
    await rm(folder, { recursive: true, force: true });
  }
});

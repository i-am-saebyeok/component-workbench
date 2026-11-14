#!/usr/bin/env node
// component-workbench <init|serve|mcp|recipe|validate>
// serve/mcp/recipe/validate는 --config 또는 현재 디렉토리에서 부모로 찾은 서비스 config를 쓴다.
import { parseArgs } from 'node:util';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { loadConfig, mcpServerName } from './config.js';
import { messageOf, systemCode, toWorkbenchError } from './errors.js';
import { startHttpServer } from './http.js';
import { InitError, MCP_COMMAND, runInit } from './init.js';
import { createMcpServer } from './mcp.js';
import { createWorkbenchService } from './service.js';

const USAGE = `usage:
  component-workbench init [--target DIR] [--name SLUG] [--title TEXT]
  component-workbench serve [--config FILE] [--port N]
  component-workbench mcp [--config FILE]
  component-workbench recipe [--config FILE]
  component-workbench validate [--config FILE]`;

type Command = 'init' | 'serve' | 'mcp' | 'recipe' | 'validate';
/** 명령마다 OPTIONS에 있는 문자열 옵션만 들어온다. */
type Values = { target?: string | undefined; name?: string | undefined; title?: string | undefined; config?: string | undefined; port?: string | undefined };

const OPTIONS: Record<Command, Record<string, { type: 'string' }>> = {
  init: { target: { type: 'string' }, name: { type: 'string' }, title: { type: 'string' } },
  serve: { config: { type: 'string' }, port: { type: 'string' } },
  mcp: { config: { type: 'string' } },
  recipe: { config: { type: 'string' } },
  validate: { config: { type: 'string' } },
};

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const errorText = (error: unknown) => JSON.stringify({ error: toWorkbenchError(error).toJSON() }, null, 2);

async function service(values: Values) {
  try {
    return createWorkbenchService(await loadConfig({ configFile: values.config }));
  } catch (error) {
    return fail(errorText(error));
  }
}

async function init(values: Values) {
  try {
    const plan = await runInit({ target: values.target, name: values.name, title: values.title });
    const key = mcpServerName(plan.config.name);
    const lines = [`component-workbench init: ${plan.root}`];
    for (const change of plan.changes) lines.push(`  ${change.summary}  ${change.relative}`);
    if (plan.changes.length === 0) lines.push('  변경 없음: 이미 초기화되어 있다.');
    lines.push(
      '',
      `컴포넌트 정의: ${plan.config.catalog} (컴포넌트 0개에서 시작)`,
      `웹: npm run workbench  → http://127.0.0.1:${plan.config.server.port}/`,
      `MCP(stdio): ${key} = ${MCP_COMMAND.command} ${MCP_COMMAND.args.join(' ')}  (.mcp.json, .codex/config.toml)`,
    );
    process.stdout.write(`${lines.join('\n')}\n`);
  } catch (error) {
    if (!(error instanceof InitError)) throw error;
    fail([error.message, ...error.problems.map((item) => `  ${item.path ? `${item.path}: ` : ''}${item.message_ko}`)].join('\n'));
  }
}

async function serve(values: Values) {
  const workbench = await service(values);
  const port = values.port === undefined ? workbench.config.server.port : Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) fail(`잘못된 포트: ${values.port}`);
  let running;
  try {
    running = await startHttpServer({ service: workbench, port });
  } catch (error) {
    if (systemCode(error) === 'EADDRINUSE') fail(`포트 ${port}를 이미 다른 프로세스가 쓰고 있다. 그 프로세스는 건드리지 않는다. config의 server.port를 바꾸거나 --port로 지정한다.`);
    throw error;
  }
  const catalog = await workbench.listComponents().then(
    (list) => `컴포넌트 ${list.components.length}개`,
    (error: unknown) => `정의 오류 — ${toWorkbenchError(error).message} (웹에서 문제 목록을 볼 수 있다)`,
  );
  process.stderr.write(`${workbench.config.title} workbench: ${running.url}\nMCP (HTTP): ${running.mcpUrl}\nconfig: ${workbench.config.file}\ncatalog: ${catalog}\n`);
  const stop = async () => {
    await running.close();
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

async function mcp(values: Values) {
  const workbench = await service(values);
  // 정의 오류는 연결을 막지 않고 각 도구 결과(catalog_invalid)로 보고한다.
  serveStdio(() => createMcpServer(workbench), { onerror: (error) => process.stderr.write(`${error.stack ?? error}\n`) });
}

async function recipe(values: Values) {
  const workbench = await service(values);
  try {
    process.stdout.write(`${JSON.stringify(await workbench.getRecipe(), null, 2)}\n`);
  } catch (error) {
    fail(errorText(error));
  }
}

async function validate(values: Values) {
  const workbench = await service(values);
  try {
    const list = await workbench.listComponents();
    const report = {
      valid: true,
      source: list.source,
      components: list.components.length,
      documents: list.documents.map(({ path, scenario_ids }) => ({ path, scenario_ids })),
      scenarios_executed: false,
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ valid: false, error: toWorkbenchError(error).toJSON(), scenarios_executed: false }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

const commands = { init, serve, mcp, recipe, validate };
const isCommand = (value: string | undefined): value is Command => value !== undefined && Object.hasOwn(commands, value);

const [command, ...rest] = process.argv.slice(2);
if (!isCommand(command)) fail(USAGE);
let values: Values;
try {
  ({ values } = parseArgs({ args: rest, options: OPTIONS[command], strict: true, allowPositionals: false }));
} catch (error) {
  fail(`${messageOf(error)}\n${USAGE}`);
}
await commands[command](values);

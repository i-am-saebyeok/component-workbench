// src/schemas.ts의 zod 정의로 schema/*.schema.json을 다시 만든다. 배포물에는 포함하지 않는다.
import fs from 'node:fs/promises';
import path from 'node:path';
import { PACKAGE_ROOT } from '../src/package.js';
import { jsonSchemas } from '../src/schemas.js';

for (const [file, text] of Object.entries(jsonSchemas())) {
  await fs.writeFile(path.join(PACKAGE_ROOT, file), text);
  process.stdout.write(`${file}\n`);
}

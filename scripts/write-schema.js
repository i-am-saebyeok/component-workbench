// src/schemas.js의 zod 정의로 schema/*.schema.json을 다시 만든다. 배포물에는 포함하지 않는다.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jsonSchemas } from '../src/schemas.js';

const root = fileURLToPath(new URL('..', import.meta.url));
for (const [file, text] of Object.entries(jsonSchemas())) {
  await fs.writeFile(path.join(root, file), text);
  process.stdout.write(`${file}\n`);
}

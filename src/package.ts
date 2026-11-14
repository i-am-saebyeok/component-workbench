// 실행 중인 도구 패키지의 루트와 manifest. 빌드 결과는 <패키지 루트>/dist/src/에 있다.
// 서비스 데이터 경로가 아니라 도구 자신의 템플릿·웹 자산·설치 확인에만 쓴다.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from './schemas.js';

export const PACKAGE_ROOT = fileURLToPath(new URL('../../', import.meta.url));

export const PACKAGE = z
  .object({ name: z.string(), version: z.string() })
  .parse(JSON.parse(readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8')));

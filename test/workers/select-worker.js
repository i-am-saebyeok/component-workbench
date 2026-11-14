// selection-lock.test.js가 띄우는 독립 writer 프로세스. 같은 서비스 selection 파일에 쓴다.
// 사용법: node select-worker.js <serviceRoot> <mode> <startAtMs> <index> [rounds]
//   once — expected revision 0으로 한 번 저장(경쟁자 중 하나만 이긴다)
//   loop — rounds번 저장, 충돌하면 다시 읽는다(정상 클라이언트의 동작)
import { loadConfig } from '../../dist/src/config.js';
import { createWorkbenchService } from '../../dist/src/service.js';

const [root, mode, startAt, index, rounds = '0'] = process.argv.slice(2);
const service = createWorkbenchService(await loadConfig({ cwd: root }), { lockWaitMs: 20_000 });
const pairs = [['button', 'primary'], ['button', 'secondary'], ['divider', null]];

await new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(startAt) - Date.now())));

if (mode === 'once') {
  const [component_id, variant_id] = pairs[Number(index) % pairs.length];
  const { source } = await service.getSelection();
  try {
    await service.selectComponent({ component_id, variant_id, expected_selection_revision: 0, expected_source_sha256: source.source_sha256 });
    process.stdout.write(JSON.stringify({ won: true }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ won: false, code: error.code }));
  }
} else {
  let changed = 0;
  let conflicts = 0;
  for (let round = 0; round < Number(rounds); ) {
    const current = await service.getSelection();
    // 현재 조합과 다른 조합을 고르므로 성공은 항상 실제 변경이다.
    const offset = pairs.findIndex(([c, v]) => c === current.selection?.component_id && v === current.selection?.variant_id);
    const [component_id, variant_id] = pairs[(offset + 1 + (Number(index) % 2)) % pairs.length];
    try {
      const result = await service.selectComponent({ component_id, variant_id, expected_selection_revision: current.revision, expected_source_sha256: current.source.source_sha256 });
      if (result.changed) changed += 1;
      round += 1;
    } catch (error) {
      if (error.code !== 'selection_conflict') throw error;
      conflicts += 1;
    }
  }
  process.stdout.write(JSON.stringify({ changed, conflicts }));
}

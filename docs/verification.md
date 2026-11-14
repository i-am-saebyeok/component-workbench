# 검증 기록

2026-11-14, `@i-am-saebyeok/component-workbench` 0.1.0. 구현·검사 코드는 Claude Opus xhigh, 문서·화면·결과 검수는 Sol xhigh가 담당했습니다.

| 검사 | 실제 결과 |
| --- | --- |
| `npm ci` | 잠금파일로 설치 성공 |
| `npm test` | 48개 통과, 실패 0개 |
| `npm run qa:browser` | 15개 통과, 화면 21장 검수. Node 24.19.0·Chromium 151·SwiftShader |
| `npm pack --dry-run --json` | 25개 파일. runtime·웹·schema·빈 템플릿·문서 포함, 테스트/fixture/캐시 제외 |
| OpenSpec strict | 전체·변경 검증 통과 |

같은 tarball을 저장소 밖 새 A/B 서비스에 설치했습니다. 둘 다 컴포넌트 0개·선택 없음에서 시작하고 생성된 npm scripts와 두 프로젝트 MCP 설정으로 실행했습니다. 반복 init의 바이트 보존, 기존 scripts/MCP/settings 보존, 늦은 충돌의 무변경, 적용 실패의 롤백을 확인했습니다.

테스트에서만 A에 box, B에 상호작용하는 static HTML과 두 variant를 등록했습니다. 실제 HTTP/stdio MCP 클라이언트로 6도구·BDD resource 본문·독립 선택·recipe를 확인했습니다. 문서/preview 변경 fingerprint, 오래된 revision 거부, 다중 프로세스 저장과 잠금 소유권도 검사했습니다.

브라우저에서 빈 상태·box 치수/재질·회전/확대/reset·HTML 클릭과 variant 전환·저장/재조회·용도/BDD 읽기·정의 오류 후 복구·390px 선택 동작을 확인했습니다. 100m와 0.1m 크기의 box도 초기/reset 시 본체와 치수선이 잘리지 않았습니다. 메인에는 목록·preview·variant·선택만 표시됩니다.

브라우저 보고서와 화면은 실행 시 `.cache/browser-qa/`에 생성됩니다. CI는 Node 22.12.0/24에서 설치·48개 검사·OpenSpec 검증을 실행하도록 구성했습니다. 브라우저 QA는 로컬 Chromium으로 별도 실행합니다.

BDD 문서의 연결·Gherkin 구조·고유 시나리오 태그를 검사하며 서비스 기능을 자동 실행하지 않습니다. 테스트 fixture는 배포물과 init 기본 데이터에 포함하지 않습니다. 초기 preview 범위는 box와 서비스 소유 static HTML/로컬 번들입니다.

GitHub private 태그 설치와 원격 CI 결과는 배포 확인 뒤 아래에 기록합니다.

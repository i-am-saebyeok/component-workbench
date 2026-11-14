# 검증 기록

## 0.1.2 TypeScript 7.1 Beta

2026-11-14, compiler를 정확히 7.1.0-beta로 고정하고 src·web·제품 스크립트를 실제 strict 검사되는 TS로 전환했습니다. CLI와 브라우저는 compiled JS를 실행합니다. compiler와 타입 패키지는 도구 개발 의존성이며 소비 서비스 runtime에는 설치하지 않습니다.

| 검사 | 실제 결과 |
| --- | --- |
| typecheck·build | Node/브라우저 오류 0, JS 16개 생성. strict·noUncheckedIndexedAccess·noEmitOnError 유지, 검사 우회 없음 |
| 타입 오류 주입 | 임시 사본의 src/scripts/web 오류가 각각 typecheck·build·pack을 실패시키며 dist 미생성 |
| Node 24.19.0 | 52/52 통과. 기존 48개와 빌드 3개·runtime 설치 1개 |
| 깨끗한 Node 22.12.0 사본 | npm ci의 prepare 빌드·typecheck·52/52·브라우저 15/15 통과, lockfile 불변 |
| 빌드 재현성 | Node 22/24와 작업 저장소의 dist 16개 파일 해시 일치 |
| 설치본 브라우저 | 15/15 통과·화면 21장. 빈 상태·box/HTML·BDD·선택·오류 복구·390px 확인 |
| 실제 npm pack | 27개 파일, version=0.1.2·bin=dist/src/cli.js. compiled JS·정적 자산·빈 템플릿·schema·MIT LICENSE 포함, TS 소스/테스트/compiler 제외 |
| compiler 없는 소비 서비스 | tarball과 로컬 Git prepare를 --omit=dev로 설치해 8/8 통과. compiler 0개·빈 init·validate·웹·두 프로젝트 stdio/HTTP MCP·BDD·선택 유지 확인 |
| schema | 생성 결과와 기존 schema가 바이트 단위로 동일 |
| 공개 Git SHA·태그 설치 | 자격증명 없이 0b6a541과 v0.1.2를 각각 --omit=dev로 설치해 8/8 통과. prepare 산출물·version=0.1.2·compiler 0개·웹/MCP/선택 유지 확인 |
| [Hosted CI](https://github.com/i-am-saebyeok/component-workbench/actions/runs/43566037220) | Node 22.12.0/24 두 job 모두 성공. npm ci prepare·typecheck·52개 검사·OpenSpec 검증 통과 |
| OpenSpec strict·whitespace | 8/8 완료·변경 보관, 최종 spec 2/2·whitespace 통과 |

정상 화면 구성과 서비스 소유 init/BDD/선택 계약을 유지했습니다. 타입 경계를 정리하면서 오류 알림 끝에 잘못 붙던 null 문자열을 제거했습니다.

## 0.1.1 공개 배포 검증

2026-11-14에 [GitHub 공식 MIT 템플릿](https://choosealicense.com/licenses/mit/)으로 LICENSE를 추가했습니다. 저작권 표기는 2026 i-am-saebyeok이며 package/lock 버전은 0.1.1, license는 MIT입니다. private=true는 npm registry 발행 방지용으로 유지합니다.

| 검사 | 실제 결과 |
| --- | --- |
| `npm ci --ignore-scripts` | 잠금파일 설치 성공 |
| 실제 `npm pack` | LICENSE 포함 26개 파일. 패키지의 LICENSE 원문과 version=0.1.1·license=MIT·private=true 확인 |
| `npm test` | Node 24.19.0에서 48/48 통과, 실패·건너뜀 0개 |
| OpenSpec strict·whitespace | 5/5 완료·변경 보관, 최종 spec 1/1·whitespace 통과 |
| GitHub 공개·라이선스 | 비인증 API에서 visibility=public·private=false·SPDX MIT 확인 |
| 공개 Git 태그 설치 | 자격증명 없이 `v0.1.1` 설치·init·validate 성공. version=0.1.1·license=MIT·LICENSE 존재·components=0·선택 파일 미생성 확인 |
| [Hosted CI](https://github.com/i-am-saebyeok/component-workbench/actions/runs/43561615722) | Node 22.12.0/24 두 job 모두 성공. 설치·48개 테스트·OpenSpec 검증 통과 |

runtime은 변경하지 않았습니다. Opus xhigh가 기존 테스트의 LICENSE 파일 목록과 설치 안내 버전 기대값만 갱신했습니다. 저장소를 공개하고 v0.1.1을 배포했습니다. 기존 v0.1.0 태그는 유지했습니다.

## 0.1.0 검증

2026-11-14, `@i-am-saebyeok/component-workbench` 0.1.0. 구현·검사 코드는 Claude Opus xhigh, 문서·화면·결과 검수는 Sol xhigh가 담당했습니다.

| 검사 | 실제 결과 |
| --- | --- |
| `npm ci` | 잠금파일로 설치 성공 |
| `npm test` | Node 24.19.0에서 48개 통과, 실패 0개 |
| Node 22.12.0 전체 검사 | `npm exec --yes --package=node@22.12.0 -- node --test --test-concurrency=1 test/*.test.js`로 48개 통과, 실패·건너뜀 0개 |
| `npm run qa:browser` | 15개 통과, 화면 21장 검수. Node 24.19.0·Chromium 151·SwiftShader |
| `npm pack --dry-run --json` | 25개 파일. runtime·웹·schema·빈 템플릿·문서 포함, 테스트/fixture/캐시 제외 |
| OpenSpec strict | 11/11 완료·변경 보관, 최종 spec 1/1 통과 |
| private Git 설치 | 원격 SHA와 `v0.1.0` 태그 설치·init·validate 성공. 태그 설치본에서 반복 init 무변경, 웹 HTTP 200·선택 없음/revision0 확인. runtime·웹·schema·템플릿이 검증한 소스와 일치 |

같은 tarball을 저장소 밖 새 A/B 서비스에 설치했습니다. 둘 다 컴포넌트 0개·선택 없음에서 시작하고 생성된 npm scripts와 두 프로젝트 MCP 설정으로 실행했습니다. 반복 init의 바이트 보존, 기존 scripts/MCP/settings 보존, 늦은 충돌의 무변경, 적용 실패의 롤백을 확인했습니다.

테스트에서만 A에 box, B에 상호작용하는 static HTML과 두 variant를 등록했습니다. 실제 HTTP/stdio MCP 클라이언트로 6도구·BDD resource 본문·독립 선택·recipe를 확인했습니다. 문서/preview 변경 fingerprint, 오래된 revision 거부, 다중 프로세스 저장과 잠금 소유권도 검사했습니다.

브라우저에서 빈 상태·box 치수/재질·회전/확대/reset·HTML 클릭과 variant 전환·저장/재조회·용도/BDD 읽기·정의 오류 후 복구·390px 선택 동작을 확인했습니다. 100m와 0.1m 크기의 box도 초기/reset 시 본체와 치수선이 잘리지 않았습니다. 메인에는 목록·preview·variant·선택만 표시됩니다.

브라우저 보고서와 화면은 실행 시 `.cache/browser-qa/`에 생성됩니다. CI는 Node 22.12.0/24에서 설치·48개 검사·OpenSpec 검증을 실행하도록 구성했습니다. [원격 실행](https://github.com/i-am-saebyeok/component-workbench/actions/runs/43560038278)은 GitHub 계정 결제/지출 한도 사유로 job 시작 전에 차단됐습니다. 로컬 통과와 hosted CI 미실행을 구분하며 결제 설정은 변경하지 않았습니다. 브라우저 QA는 로컬 Chromium으로 별도 실행합니다.

BDD 문서의 연결·Gherkin 구조·고유 시나리오 태그를 검사하며 서비스 기능을 자동 실행하지 않습니다. 테스트 fixture는 배포물과 init 기본 데이터에 포함하지 않습니다. 초기 preview 범위는 box와 서비스 소유 static HTML/로컬 번들입니다.

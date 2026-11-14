# Component Workbench

서비스에서 설치·초기화해 사용하는 컴포넌트 탐색 도구입니다. 웹 미리보기·variant 선택·MCP·용도/BDD 읽기를 제공합니다. 컴포넌트 라이브러리를 배포하는 도구가 아닙니다. 정의·variant·에셋·문서는 각 서비스가 소유하며 `init` 기본 카탈로그는 **컴포넌트 0개**입니다.

도구는 [MIT 라이선스](LICENSE)로 공개합니다. 실제 배포 태그·명령 검증·남은 항목은 [검증 기록](docs/verification.md)에 구분합니다.

## 설치하고 시작하기

Node.js 22.12.0 이상이 필요합니다. 소비 서비스 디렉토리에서 배포 태그를 로컬 개발 의존성으로 설치합니다. `package.json`이 없는 서비스는 먼저 `npm init -y`를 실행합니다.

```sh
npm install -D git+https://github.com/i-am-saebyeok/component-workbench.git#v0.1.2
npx component-workbench init
npm run workbench
```

GitHub 공개 저장소의 태그로 배포합니다. npm registry에는 publish하지 않으며 `package.json`의 `private: true`는 registry 발행 방지용입니다. 저장소 공개 여부와는 별개입니다. 패키지를 먼저 설치해야 생성한 npm scripts와 MCP가 해당 서비스의 로컬 도구를 실행할 수 있습니다.

Git 설치의 `prepare`가 도구를 빌드하고, 설치된 CLI·브라우저는 `dist`의 JavaScript를 실행합니다. 소비 서비스 runtime에는 TypeScript compiler가 필요하지 않습니다.

## init 결과와 기존 파일 보존

| 위치 | 역할 |
| --- | --- |
| `component-workbench.config.json` | 서비스 이름·제목·데이터/문서/preview 경로·포트 |
| `workbench/catalog.json` | 빈 컴포넌트 정의. 서비스가 직접 관리 |
| `workbench/README.md` | 정의와 선택의 작성 안내 |
| `workbench/behaviors/README.md` | 서비스 용도/BDD 작성 안내 |
| `workbench/previews/README.md` | 지원 preview와 서비스 소유 자산 안내 |
| `package.json`의 `workbench`·`workbench:mcp` | 웹과 stdio MCP 실행 |
| `.mcp.json`·`.codex/config.toml` | 프로젝트 MCP 연결. 기존 서버 보존 |

빈 catalog는 schema_version=1, revision=1, components=[]입니다. init은 selection 파일을 만들지 않습니다. 선택 없음은 revision 0이며 첫 유효 선택 때 `workbench/selection.json`을 생성합니다. variant가 없는 컴포넌트는 variant_id=null을 사용할 수 있습니다.

반복 init은 기존 서비스의 컴포넌트·선택·설정과 무관한 npm scripts/MCP 항목을 유지합니다. 대상 파일이나 추가할 키가 다른 내용과 충돌하면 경로·항목을 알리고 어떤 대상 파일도 덮어쓰거나 일부만 생성하지 않습니다. 기존 파일을 지우거나 강제로 덮어쓰는 절차로 우회하지 않습니다. 소비 서비스에 도구 저장소의 OpenSpec을 자동 설치하지 않습니다.

## 서비스 설정과 정의

설정의 `name`은 서비스 slug, `title`은 화면 제목입니다. 기본 경로는 catalog=`workbench/catalog.json`, selection=`workbench/selection.json`, docs_root=`workbench`, preview_root=`workbench/previews`이고 server.port=4317입니다. 두 서비스를 동시에 실행하면 각 설정의 포트를 구분합니다. CLI는 현재 디렉토리에서 부모로 config를 찾고 경로를 그 서비스 config 기준으로 해석합니다.

컴포넌트는 id·name·description·intended_uses·avoid_uses·BDD 상대 경로·선택적 preview·variants를 정의합니다. 컴포넌트/variant를 도구 UI에서 생성·편집하지 않습니다. 서비스가 정의와 실제 용도·금지 사용·BDD를 함께 작성합니다. 게임 규칙·엔진 경로·특정 크기·재질 목록은 도구의 기본 정의가 아닙니다.

전체 필드는 [config schema](schema/config.schema.json)와 [catalog schema](schema/catalog.schema.json)를 따릅니다. `init --name <slug> --title <제목>`으로 서비스 이름을 지정할 수 있고, `serve --port <번호>`로 실행 포트를 지정할 수 있습니다.

```sh
npx component-workbench validate
npx component-workbench recipe
```

`validate`는 정의·문서·preview 참조를 검사합니다. `recipe`는 현재 원본에 맞는 저장 선택이 있을 때 JSON을 출력합니다.

## 처음 지원하는 preview

| 종류 | 서비스가 제공할 입력 | 범위 |
| --- | --- | --- |
| `box` | 양수 3개인 dimensions_m, 선택적 variant material | 임의 치수의 3D box. material은 sRGB 색·roughness·metallic |
| `html` | preview_root 안의 src와 로컬 번들 | 서비스가 작성한 신뢰된 static HTML을 frame으로 표시. variant별 preview override 가능 |
| preview 없음 | preview 생략 | 이름·용도·선택을 제공하고 미리보기 없음 상태로 표시 |

HTML 자산은 서비스가 관리하는 개발 코드입니다. 임의 프레임워크 dev server나 모든 UI 프레임워크의 소스 실행/편집을 지원하는 범위가 아닙니다. 미지원 type·누락 파일·허용 경로 밖 참조는 명확히 거부합니다. HTML 예제 컴포넌트를 init에 기본 설치하지 않습니다.

메인은 목록·preview·variant·한 선택 동작·간결한 현재 조합에 집중합니다. 용도/BDD는 기본 닫힌 문서 패널에서 읽으며 해시·revision·경로 등 전체 metadata는 API/MCP로 확인합니다.

## MCP와 선택 recipe

프로젝트 MCP 이름은 `<name>-components`로 파생하고 `npx --no-install component-workbench mcp`로 설치된 패키지의 stdio 서버를 시작합니다. 전역 MCP 설정을 바꾸지 않습니다. 서비스 하위 디렉토리에서도 부모 config를 찾아 같은 데이터를 사용합니다.

| 도구 | 역할 |
| --- | --- |
| `list_components` | 서비스 컴포넌트·variant와 원본 식별값 조회 |
| `get_component` | 정의·사용 의도·피해야 할 사용·실제 BDD 본문 조회 |
| `validate_component` | 서비스 schema·ID·variant·문서/preview 참조 검증 |
| `select_component` | source fingerprint와 선택 revision을 확인해 조합 저장 |
| `get_selection` | 현재 저장 선택 또는 선택 없음 조회 |
| `export_selection_recipe` | component/variant·fingerprint·revision·참조를 추적하는 recipe 반환 |

BDD 원문은 MCP resources로도 읽습니다. 웹과 MCP는 같은 서비스 정의와 선택을 사용합니다. AI는 ID만 보지 않고 사용 의도·관련 BDD를 읽고 조합을 고릅니다. BDD가 있다는 사실은 서비스 게임/제품 기능이 구현됐다는 뜻이 아닙니다.

원본 fingerprint와 선택 revision이 오래됐으면 저장을 거부하고 이전 선택을 보존합니다. 정의·용도/BDD·preview 변경도 원본 식별에 반영합니다. recipe 내보내기와 선택 저장은 소비 서비스의 코드/에셋/월드를 자동 빌드·재생성하지 않습니다.

## 재사용성 검증

배포 검사는 npm pack 산출물을 저장소 밖 새 A/B 서비스에 설치하여 수행합니다. 둘 다 빈 init에서 시작하고 테스트에서만 서로 다른 box·HTML 정의를 추가하여 UI·MCP·BDD·선택이 독립적인지 확인합니다. init 반복·기존 scripts/MCP 보존·충돌 무변경·빈 UI·좁은 화면·원본/revision 충돌도 확인합니다. fixture를 기본 컴포넌트로 배포하지 않습니다.

pack 설치와 GitHub 태그 설치의 실제 수행 결과는 [검증 기록](docs/verification.md)을 확인합니다.

## 도구 개발

생산 소스 `src`·`web`·제품 스크립트는 TypeScript이며 compiler는 **7.1.0-beta**로 고정합니다. Node와 브라우저를 각각 strict 검사하고 빌드 결과는 `dist`에 생성합니다.

```sh
npm ci
npm run typecheck
npm run build
npm test
```

`npm test`는 현재 소스를 빌드한 뒤 검사합니다. 설치본 브라우저 검증은 `npm run qa:browser`로 실행합니다.
개발 설치에서 lifecycle scripts를 건너뛰었다면 `npm run build`를 먼저 실행합니다.

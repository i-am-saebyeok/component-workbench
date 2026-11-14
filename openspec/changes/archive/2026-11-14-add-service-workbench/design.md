# Design

## Context

[Proposal](proposal.md)와 [명세](specs/service-component-workbench/spec.md)는 도구 재사용과 서비스 데이터 소유권을 구분한다. 이 저장소는 Node ≥22.12.0·OpenSpec 2.0.0 골격에서 시작했다. origin은 GitHub private 저장소이며 코드·배포·서비스 A/B 검증은 별도 실제 결과가 필요하다. 기존 게임 저장소의 데이터 읽기·migration은 이 변경의 의존성이나 필수 작업이 아니다.

## Goals / Non-Goals

**Goals:**

- 패키지를 소비 서비스에 설치하고 빈 init으로 독립된 구성을 만든다.
- 서비스가 소유한 정의·variant·BDD·preview와 선택을 웹/MCP에 일관되게 제공한다.
- 실제 pack 설치·보존/충돌·두 preview·독립 서비스 시나리오로 재사용성을 확인한다.

**Non-Goals:**

- 서비스 컴포넌트 라이브러리·게임 에셋·게임 규칙을 배포하지 않는다.
- 임의 프레임워크 dev server를 띄우거나 소스 편집·component/variant 편집기를 제공하지 않는다.
- 소비 서비스에 이 저장소의 OpenSpec·개발 프레임워크 설정을 자동 설치하지 않는다.

## Decisions

### 1. 설정과 서비스 소유 파일의 경계를 고정한다

서비스 루트 `component-workbench.config.json`의 계약은 schema_version=1, 서비스 slug인 `name`, 화면 `title`, `catalog`, `selection`, `docs_root`, `preview_root`, `server.port`다. 기본 경로는 각각 `workbench/catalog.json`, `workbench/selection.json`, `workbench`, `workbench/previews`이며 기본 포트는 4317이다. MCP 이름은 `<name>-components`로 파생한다. 서로 다른 서비스를 동시에 실행할 때 포트는 서비스 설정에서 구분한다.

기본 catalog는 schema_version=1·revision=1·`components: []`다. 컴포넌트는 id/name/description, intended_uses/avoid_uses, BDD 상대 경로, preview와 variants를 서비스가 정의한다. 내장 box의 dimensions_m은 양수 세 개이며 서비스의 임의 치수를 허용한다. variant는 id/name과 선택적 material·preview override를 가진다. 특정 크기·축 방향·재질 ID·절반 규칙·엔진 경로를 core에 넣지 않는다. variant 배열이 비어 있으면 variant 선택은 null을 허용한다.

이전 서비스 데이터를 복사해 초기 예제를 만드는 대안을 제외한다. 도구는 빈 원본과 작성 안내만 제공하며 테스트용 컴포넌트는 별도 fixture에서만 만든다.

### 2. init은 사전 검사 뒤 한 번에 적용한다

CLI는 소비 서비스에 로컬 devDependency로 설치된 실행 환경을 기준으로 동작한다. 설치되지 않은 상태에서 init만 실행해 동작하지 않는 scripts를 만드는 대신 설치 필요를 알리거나 설치 상태를 해결하는 명시적 안내를 제공한다.

기본 생성물은 config·빈 catalog·`workbench/README.md`·`workbench/behaviors/README.md`·`workbench/previews/README.md`, package의 `workbench`/`workbench:mcp` scripts와 `.mcp.json`·`.codex/config.toml` 프로젝트 연결이다. 두 MCP 파일 모두 기존 항목을 보존해 병합한다. selection 파일은 init에서 만들지 않으며 빈 상태는 선택 없음·revision 0이다. 첫 유효 선택 저장 때 생성한다.

대상 경로·기존 JSON/TOML·추가할 script/MCP 키·설치 상태를 먼저 검사하고 모든 변경 계획이 유효할 때만 적용한다. 기존 package와 MCP의 무관한 항목을 보존해 필요한 항목만 추가한다. 충돌·잘못된 기존 파일·적용 전 파일 변경을 발견하면 실패하고 부분 생성물을 남기지 않는다. 반복 init은 생성한 파일의 존재만으로 catalog·선택·사용자 설정을 기본값으로 되돌리지 않는다. force overwrite나 자동 충돌 우회는 요구하지 않는다.

### 3. 하나의 서비스가 일반 데이터와 선택을 제공한다

웹·MCP는 같은 config·catalog·문서 로더·검증·선택 저장을 호출한다. 컴포넌트 ID·variant·preview schema·문서 참조를 검증하고 파일은 설정한 서비스 root 아래에서 해석한다. tool 패키지 안에 소비 서비스의 정의를 쓰거나 다른 서비스의 상태를 조회하지 않는다.

MCP 도구는 list_components/get_component/validate_component/select_component/get_selection/export_selection_recipe다. get_component와 resources는 문서·관련 BDD의 실제 본문을 제공한다. 웹 문서 패널도 같은 본문을 읽는다. 도구별 구조·실패 의미는 README와 실제 응답으로 확인한다. 서비스별 MCP 이름·포트가 같은 tool core를 여러 인스턴스로 구분한다.

BDD 연결 원본은 component.bdd의 파일 참조다. core는 참조 존재·일반 Gherkin 구조·시나리오의 고유 안정 태그를 확인하며 태그 namespace를 정하거나 본문에서 component/variant 의미를 자동 추론하지 않는다. 서비스가 실제 유스케이스를 작성하고 테스트는 실제 도구 동작을 검사한다. 본문이 있다는 이유로 해당 제품 기능이나 AI 의미 추론이 검증됐다고 보고하지 않는다.

프로젝트 MCP는 `npx --no-install component-workbench mcp`로 설치된 패키지의 stdio 서버를 시작한다. 설정 탐색은 CWD에서 부모로 올라가며 찾은 서비스 config를 기준으로 상대 경로를 해석한다. 서비스 하위 디렉토리나 공백이 있는 경로에서도 같은 서비스에 연결해야 한다. 웹의 HTTP `/mcp`도 같은 서비스 동작을 제공할 수 있다. 전역 MCP 설정은 수정하지 않는다.

### 4. 빈 상태와 최소 UI를 정상 경로로 취급한다

컴포넌트가 없으면 빈 목록·작성 위치 안내를 보여 주고 선택/recipe는 저장 대상이 없음을 알린다. 예제·임의 첫 항목·숨은 기본 선택을 만들지 않는다. variant가 없는 컴포넌트는 불필요한 variant picker를 요구하지 않는다.

메인은 목록·preview·variant·한 선택 CTA·간결한 현재 저장 조합으로 구성한다. 연결 상태와 기본 닫힌 용도/BDD 패널 진입을 제공하고 해시·revision·포트·경로·복사/recipe 상세·재질 수치·중복 표·긴 설명은 메인에 상시 나열하지 않는다. export와 전체 metadata는 API/MCP에서 유지한다. 좁은 화면에서도 목록·variant·선택에 접근할 수 있어야 한다.

### 5. 두 preview adapter까지만 처음 지원한다

box adapter는 `preview.type=box`와 서비스 dimensions_m, 선택 variant의 material을 읽어 3D 본체를 표시한다. 치수나 재질이 다른 서비스도 같은 renderer를 사용한다. material이 없을 때의 중립 표시와 지원하는 필드를 안내한다. 특정 블록 규칙이나 엔진 방향은 주입하지 않는다.

HTML adapter는 `preview.type=html`과 서비스 preview_root 기준 src를 읽는다. 서비스가 작성한 신뢰된 static HTML/로컬 번들을 별도 frame에 표시하고 variant의 preview override를 반영한다. 다른 서버의 임의 URL·서비스 root 밖 경로·임의 프레임워크 dev server를 자동 실행하는 adapter가 아니다. 파일 누락·지원하지 않는 type은 명확히 실패한다. 동작 예시는 서비스 B의 테스트 fixture에만 둔다.

preview 자체가 없는 정의는 읽을 수 있는 미리보기 없음 상태로 제공하며 임의 모델을 만들지 않는다. 서비스 소유 HTML은 서비스 개발 코드이며 보안 sandbox를 완성했다고 주장하지 않는다. 경로/심볼릭 링크 검사는 설정한 service/docs/preview root의 경계를 지켜 임의 파일 제공을 방지하는 데 사용한다.

### 6. source fingerprint와 선택 revision을 나누어 고정한다

정의·관련 용도/BDD·preview 등 선택 해석에 영향을 주는 원본을 fingerprint로 식별한다. 운영 로그·검증 보고서는 원본 묶음에 넣지 않는다. 기존 fingerprint와 selection revision이 모두 맞을 때 같은 잠금 구간에서 원자적으로 저장하고, 원본 변경·동시 선택·잘못된 ID/variant는 이전 선택을 보존한 채 거부한다.

선택이 없으면 revision 0·선택 없음이고 첫 선택 때 파일을 쓴다. export_selection_recipe는 선택 component/variant·source fingerprint·revision·서비스 참조를 반환한다. recipe를 얻는 행위가 파일/에셋 빌드·기존 월드 재생성이나 선택 변경을 일으키지 않는다.

### 7. package 밖의 두 소비 서비스로 배포를 검증한다

기본 전달 방식은 GitHub private 저장소의 v0.1.0 태그를 devDependency로 설치하는 것이다. 태그는 실제 검사 뒤 생성하며 문서에 배포 완료를 앞서 주장하지 않는다. [npm Git 의존성 안내](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#git-urls-as-dependencies)를 설치 구문의 근거로 삼고 [npm pack](https://docs.npmjs.com/cli/v11/commands/npm-pack/)으로 만든 tarball을 로컬 배포 검증에 사용한다. npm registry publish는 하지 않는다.

검증은 저장소 밖 새 서비스 A/B에 같은 tarball을 설치해 수행한다. 처음에는 둘 다 빈 카탈로그다. 그 뒤 테스트에서만 A에 3×1×1.5m storage-panel box와 파란 metal variant, B에 두 variant의 HTML button을 추가한다. 웹/MCP·BDD·선택·recipe·원본 변경이 각 서비스에만 반영되는지 확인한다. 이 예시를 배포 기본 템플릿이나 서비스 초기 데이터로 복사하지 않는다.

pack 파일 목록은 runtime/웹 자산·빈 템플릿·안내를 포함해야 하며 다른 서비스의 파일·테스트 fixture·엔진 에셋에 의존하지 않아야 한다. pack 설치 통과와 GitHub 인증/태그 설치 확인은 구분해 보고한다.

## Risks / Trade-offs

- [기존 설정과 합치다 일부 파일만 바뀔 수 있음] → 전체 변경 계획 사전 검사와 실패 전후 파일/내용 비교로 검증한다.
- [tool core에 서비스 규칙이 남을 수 있음] → 다른 크기·재질의 box와 HTML의 두 서비스를 사용하고 pack 파일 목록도 대조한다.
- [HTML adapter가 모든 프레임워크 지원으로 오해될 수 있음] → static HTML/로컬 번들만 지원 범위로 안내하고 미지원 type을 거부한다.
- [원본 문서 변경이 선택 의미를 바꿀 수 있음] → BDD/preview를 fingerprint에 포함하고 오래된 선택/recipe의 식별값을 보존한다.
- [같은 기본 포트가 충돌할 수 있음] → 서비스 구성의 포트를 사용하고 A/B 검증에서 서로 다른 포트와 MCP 이름을 확인한다.

## Migration Plan

1. CLI·서비스 schema·빈 템플릿·프로젝트 연결을 구현하고 init 보존/충돌을 먼저 검증한다.
2. 일반 로더·공유 선택·MCP/BDD와 두 preview를 구현하고 서비스 소유 데이터로 검증한다.
3. pack을 새 A/B에 설치해 전체 계약을 확인하고 README 명령·한계·실제 결과를 대조한다.
4. 검사 후 배포 태그와 GitHub 설치를 확인한다. 기존 게임 migration이나 데이터 복사는 이 변경에 포함하지 않는다.

## Open Questions

- 내부 라이브러리와 검증 보고서 포맷은 위 계약을 유지하는 구현 선택이다. 코드 담당자와 맞춰 실제 결과에 기록한다.

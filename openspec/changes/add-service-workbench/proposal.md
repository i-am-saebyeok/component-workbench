# Proposal

## Why

컴포넌트 카탈로그를 만드는 도구를 여러 서비스에서 설치·초기화해 사용할 수 있어야 한다. 도구와 소비 서비스의 정의·variant·에셋·용도/BDD를 분리하여 서비스마다 자신의 컴포넌트를 독립적으로 관리하게 한다.

## What Changes

- **도구만 재사용:** 이 저장소는 일반 컴포넌트 탐색·미리보기·선택·MCP 도구를 배포한다. 특정 게임의 컴포넌트·재질·절반 규칙·Unreal 경로·에셋을 기본 데이터나 배포물에 포함하지 않는다.
- **빈 초기화:** 설치 후 `init`으로 서비스 소유 설정·컴포넌트 0개의 카탈로그·용도/BDD 폴더·로컬 실행/MCP 연결을 마련한다. 예제 컴포넌트를 자동 등록하지 않는다.
- **기존 서비스 보존:** 반복 init은 동일 항목을 중복 생성하지 않는다. 기존 파일·npm scripts·MCP 서버는 보존하며 충돌을 먼저 검사해 충돌 시 어떤 대상 파일도 덮어쓰거나 부분 초기화하지 않는다.
- **서비스별 구성:** tool core는 서비스 설정에서 제목·catalog·selection·문서 root·MCP 이름·포트를 읽는다. 서비스 A/B는 정의·선택·문서·연결을 공유하지 않는다.
- **최소 웹 UI:** 컴포넌트 목록·미리보기·variant 선택·한 선택 동작·간결한 현재 저장 조합을 중심으로 제공한다. 용도/BDD는 기본 닫힌 문서 패널에서 실제 본문을 읽는다. 기술 메타데이터를 메인에 나열하지 않는다.
- **초기 preview 지원:** 서비스 치수/재질을 읽는 내장 3D box와 서비스가 제공한 static HTML preview adapter를 지원한다. 도구에 블록 전용 규칙을 하드코딩하지 않으며 모든 프레임워크의 실행/편집 환경을 제공한다고 주장하지 않는다.
- **공유 MCP:** `list_components`, `get_component`, `validate_component`, `select_component`, `get_selection`, `export_selection_recipe`와 실제 용도/BDD resources를 제공한다. 웹·MCP가 같은 서비스 데이터·source fingerprint·revision 잠금·저장 선택을 사용한다.
- **배포·검증:** GitHub private 저장소의 npm 패키지로 설치하고 npm registry에는 publish하지 않는다. `npm pack` 산출물을 새 서비스 A/B에 설치하여 init/반복/충돌/빈 UI·독립 데이터·두 preview·MCP/BDD·선택/recipe를 검증한다. 서로 다른 컴포넌트 예시는 테스트 fixture에만 둔다.

형상/속성/variant 편집기, 서비스 컴포넌트 자동 생성, 게임 로직·물성, runtime 월드 편집·즉시 자동 재생성, 임의 프레임워크 dev server 호스팅은 이번 범위 밖이다. 코드·패키지·UI·CLI는 Claude Opus xhigh, 명세·설정·템플릿 문서·검수는 Sol xhigh가 담당한다. 현재 계획과 실제 구현/검증은 구분한다.

## Capabilities

### New Capabilities

- `service-component-workbench`: 서비스가 빈 상태로 초기화해 자신의 컴포넌트·variant·용도/BDD를 소유하며 웹·MCP·독립 선택을 사용하는 재사용 개발 도구.

### Modified Capabilities

없음. 이 저장소에는 기존 제품 명세가 없다. 다른 서비스나 게임 저장소의 명세·데이터는 이 change에서 수정하지 않는다.

## Impact

- 패키지 CLI·서비스 설정/빈 템플릿·로컬 웹/MCP 서비스·두 preview adapter·테스트/설치 안내가 필요하다.
- init은 소비 서비스의 package/MCP 설정에 충돌 없는 항목만 추가하고 기존 내용을 보존한다. 실제 기본 경로·명령·schema는 코드 담당자와 맞춰 문서에 고정한다.
- 배포 파일 목록을 검증해 서비스 데이터나 테스트 fixture가 기본 컴포넌트로 섞이지 않게 한다. 실제 GitHub 설치와 pack 기반 설치의 검증 범위를 따로 기록한다.

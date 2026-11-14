# service-component-workbench Specification

## Purpose
여러 소비 서비스가 같은 개발 도구를 설치·초기화하되 자신의 컴포넌트·variant·미리보기·용도/BDD·선택을 독립적으로 소유하는 기준을 정의한다. 도구 배포와 서비스 데이터 배포를 분리하고 웹·MCP·제작 입력의 일관성을 검증한다.

## Requirements

### Requirement: 서비스 데이터 없는 도구 패키지

배포 패키지는 도구 코드·필요 자산·빈 초기화 템플릿·사용 안내만 제공하고 특정 소비 서비스의 컴포넌트·재질·게임 규칙·엔진 경로·에셋을 기본 데이터로 포함하지 않아야 한다(SHALL). GitHub private 저장소 패키지 설치와 pack 산출물 설치를 지원하고 npm registry publish를 요구하지 않아야 한다(SHALL).

#### Scenario: 새 서비스에 패키지 설치

- **WHEN** 사용자가 pack 산출물을 기존 도구 저장소 밖의 새 서비스에 설치한다
- **THEN** 그 서비스에서 도구 CLI와 필요한 웹/MCP 자산을 사용할 수 있다
- **AND** 다른 서비스의 컴포넌트나 에셋 경로에 의존하지 않는다

### Requirement: 컴포넌트가 없는 초기화

`init`은 소비 서비스에 설정·컴포넌트 0개의 카탈로그·용도/BDD 위치·실행/MCP 연결을 마련해야 한다(SHALL). 서비스 소유 파일을 생성하며 예제 컴포넌트·variant·미리보기 자산을 기본 등록하지 않아야 한다(SHALL).

#### Scenario: 빈 서비스 초기화

- **WHEN** 사용자가 설치된 CLI의 init을 실행한다
- **THEN** 카탈로그의 컴포넌트 수는 0이고 기본 저장 선택도 없다
- **AND** 서비스를 위한 설정·문서 작성 위치·로컬 실행/MCP 연결을 확인할 수 있다

### Requirement: 반복 초기화와 기존 파일 보존

반복 init은 같은 서비스 항목을 중복 생성하지 않고 기존 사용자 데이터·설정·선택을 보존해야 한다(SHALL). 기존 npm scripts와 MCP 서버는 유지하며 충돌 없는 도구 항목만 추가해야 한다(SHALL). 대상 파일·키 충돌 또는 잘못된 기존 설정을 발견하면 어떤 대상 파일도 덮어쓰거나 부분 초기화하지 않고 충돌을 보고해야 한다(SHALL).

#### Scenario: 수정한 서비스에서 init 반복

- **WHEN** 사용자가 초기화 뒤 컴포넌트·선택과 서비스 설정을 추가하고 같은 init을 다시 실행한다
- **THEN** 기존 값과 파일이 유지되며 scripts·MCP 항목이 중복되지 않는다

#### Scenario: 기존 항목과 충돌

- **WHEN** 초기화 대상 경로에 다른 파일이 있거나 추가할 script/MCP 이름이 다른 설정으로 이미 존재한다
- **THEN** 충돌 경로·항목을 알려 주고 실패한다
- **AND** 초기화 전 파일 목록·기존 파일 내용이 유지되며 앞서 생성된 일부 파일도 남지 않는다

### Requirement: 서비스별 구성과 소유권

도구는 서비스 설정에서 제목·catalog·selection·문서 root·MCP 이름·포트를 읽어야 한다(SHALL). 컴포넌트·variant·BDD는 각 소비 서비스가 소유하며 도구가 특정 서비스의 이름·ID·치수·재질·규칙을 하드코딩하지 않아야 한다(SHALL).

#### Scenario: 두 서비스의 독립 운영

- **WHEN** A/B 서비스가 서로 다른 구성·카탈로그·포트로 같은 도구를 실행하고 A의 정의와 선택을 변경한다
- **THEN** A에만 해당 변경이 나타나며 B의 정의·선택·BDD·MCP 설정은 유지된다

### Requirement: 빈 카탈로그의 정상 동작

컴포넌트 0개인 상태에서도 웹과 MCP가 정상 동작해야 한다(SHALL). 웹은 빈 상태를 안내하고 존재하지 않는 선택을 만들지 않아야 하며, 목록·현재 선택·검증·선택/recipe의 빈 상태와 오류 의미를 구분해야 한다(SHALL).

#### Scenario: init 직후 웹과 MCP 열기

- **WHEN** 사용자가 컴포넌트를 등록하기 전에 도구를 실행한다
- **THEN** 웹은 빈 목록을 안내하고 MCP 목록은 비어 있으며 현재 저장 선택은 없다
- **AND** 잘못된 선택/recipe 요청은 명확히 실패하고 임의 예제로 대체하지 않는다

### Requirement: 초기 미리보기 adapter

도구는 서비스가 정의한 치수·재질의 내장 3D box와 서비스 소유 static HTML preview를 지원해야 한다(SHALL). 지원 adapter와 필요한 입력을 안내하고 지원하지 않는 형식·누락 파일을 명확히 보고해야 한다(SHALL). 임의 프레임워크의 실행·편집 환경을 제공한다고 설명하지 않아야 한다(SHALL).

#### Scenario: box와 HTML 컴포넌트 검토

- **WHEN** A 서비스의 box 컴포넌트와 B 서비스의 static HTML 컴포넌트를 차례로 연다
- **THEN** A는 서비스가 정한 치수·재질로 3D를 보여 주고 B는 서비스가 제공한 HTML과 variant를 보여 준다
- **AND** 두 표시가 특정 게임의 기본 형상·재질로 대체되지 않는다

#### Scenario: 미리보기를 정의하지 않은 컴포넌트

- **WHEN** 사용자가 preview가 없는 유효한 서비스 컴포넌트를 연다
- **THEN** 이름·용도·선택을 확인할 수 있으며 미리보기 없음 상태를 표시한다
- **AND** 임의 예제 모델로 대체하거나 미지원 preview type과 혼동하지 않는다

### Requirement: 선택에 집중한 웹 UI

메인은 컴포넌트 목록·preview·variant·한 선택 동작·간결한 현재 저장 조합을 중심으로 제공해야 한다(SHALL). 용도/BDD는 기본 닫힌 문서 패널에서 실제 본문을 읽을 수 있어야 한다(SHALL). 내부 해시·revision·포트·경로·긴 설명을 메인에 상시 나열하지 않고 좁은 화면에서도 선택할 수 있어야 한다(SHALL).

#### Scenario: 컴포넌트와 용도 확인

- **WHEN** 사용자가 컴포넌트와 variant를 고르고 필요할 때 문서 패널을 연다
- **THEN** 미리보기와 간결한 현재 조합을 확인해 선택할 수 있고 패널에서 실제 용도/BDD 본문을 읽을 수 있다
- **AND** 보기 조작·문서 열기만으로 저장 선택이 바뀌지 않는다

### Requirement: 일반화된 공유 MCP

MCP는 `list_components`, `get_component`, `validate_component`, `select_component`, `get_selection`, `export_selection_recipe`와 문서 resources를 제공해야 한다(SHALL). 웹·MCP는 같은 서비스 데이터·검증·선택을 사용하고 `get_component`와 resources는 용도/BDD 실제 본문을 반환해야 한다(SHALL).

#### Scenario: MCP 선택을 웹에서 확인

- **WHEN** MCP 클라이언트가 일반 도구 목록을 조회하고 컴포넌트/variant를 선택한 뒤 웹에서 새로 읽는다
- **THEN** 웹과 MCP는 같은 저장 조합·원본 식별값·revision을 사용한다
- **AND** 컴포넌트 용도와 BDD를 경로 문자열뿐 아니라 실제 본문으로 읽을 수 있다

#### Scenario: 생성한 프로젝트 MCP 설정 사용

- **WHEN** 사용자가 init으로 만든 두 프로젝트 MCP 설정 중 하나로 서비스 하위 디렉토리에서 stdio 서버를 시작한다
- **THEN** 설치한 패키지와 부모 서비스 config를 찾아 같은 서비스의 일반 도구와 BDD resources를 제공한다
- **AND** 기존의 다른 MCP 서버와 전역 설정은 변경되지 않는다

### Requirement: 원본 fingerprint와 revision 잠금

선택 저장은 서비스 원본 fingerprint와 선택 revision을 확인하고 원자적으로 수행해야 한다(SHALL). 오래된 원본/선택·알 수 없는 컴포넌트/variant·유효하지 않은 정의를 거부하고 기존 선택을 유지해야 한다(SHALL). 의미에 영향을 주는 BDD·preview 변경도 원본 식별에 반영해야 한다(SHALL).

#### Scenario: 동시 선택과 원본 변경

- **WHEN** 먼저 저장된 선택 뒤 다른 클라이언트가 이전 revision 또는 이전 원본 fingerprint로 저장한다
- **THEN** 충돌을 보고하고 먼저 저장한 선택을 덮어쓰지 않는다
- **AND** 현재 원본과 선택을 다시 조회해 명시적으로 재시도할 수 있다

### Requirement: 선택 recipe 내보내기

recipe는 서비스의 선택 component/variant와 source fingerprint·revision·필요 참조를 추적할 수 있는 구조로 반환해야 한다(SHALL). 내보내기는 정의·선택을 변경하거나 소비 서비스를 자동 빌드/재생성하지 않아야 한다(SHALL).

#### Scenario: 저장 선택의 recipe 조회

- **WHEN** 사용자가 유효한 저장 선택을 export_selection_recipe로 내보낸다
- **THEN** 같은 서비스의 선택과 고정 원본을 식별하는 recipe를 얻는다
- **AND** 다른 서비스의 정의를 포함하거나 기존 파일/맵을 자동 재생성하지 않는다

### Requirement: 서비스 BDD와 실제 검증 연결

서비스 component의 bdd 파일 참조를 연결 원본으로 사용하고 일반 Gherkin 구조·고유한 안정 시나리오 태그를 조회·검증해야 한다(SHALL). 태그 namespace를 강제하거나 본문에서 component/variant 의미를 추론하지 않아야 한다(SHALL). 일반 도구 동작은 실제 검사로 확인하고 문서 존재를 실행 통과로 대신하지 않아야 한다(SHALL).

#### Scenario: 서비스 문서와 정의 불일치

- **WHEN** component.bdd가 가리키는 파일이 없거나 일반 Gherkin 구조가 잘못됐거나 시나리오의 안정 태그가 누락·중복된다
- **THEN** 검증이 참조·구조·태그 문제를 식별하며 정상 정의로 조용히 처리하지 않는다
- **AND** 실제 통과한 검사와 작성만 된 BDD가 결과에서 구분된다

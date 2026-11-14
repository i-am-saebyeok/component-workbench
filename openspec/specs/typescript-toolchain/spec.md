# typescript-toolchain Specification

## Purpose
도구의 생산 TS를 고정 컴파일러로 검사하고, Node·브라우저와 compiler 없는 소비 서비스에서 실행되는 JS 배포 계약을 정의한다.

## Requirements

### Requirement: 고정된 TypeScript로 생산 소스 검사

도구의 src·web·제품 스크립트는 TS 생산 소스이며 정확히 7.1.0-beta로 고정한 TypeScript로 strict 검사와 빌드를 수행해야 한다(SHALL). nocheck·소스 제외·전역 any로 검사를 우회하지 않아야 하며 타입 오류는 검증/배포 빌드를 실패시켜야 한다(SHALL).

#### Scenario: 생산 코드의 타입 오류

- **WHEN** 생산 소스에 타입과 맞지 않는 변경이 들어간다
- **THEN** typecheck와 배포 빌드가 오류를 보고하고 실패한다
- **AND** src·web·제품 스크립트를 검사 대상에서 제외해 성공으로 표시하지 않는다

### Requirement: 컴파일러 없는 소비 서비스 실행

pack과 공개 Git 설치는 실행 가능한 compiled JS와 필요한 정적 자산·템플릿·schema·LICENSE를 제공해야 한다(SHALL). 소비 서비스 runtime은 TS compiler나 도구의 devDependencies를 요구하지 않아야 하며 Node 22.12.0 이상 ESM CLI/MCP와 브라우저가 해당 JS 산출물을 실행해야 한다(SHALL).

#### Scenario: 개발 의존성 없는 새 서비스 설치

- **WHEN** 새 서비스가 pack 또는 Git 의존성을 설치하고 도구의 개발 의존성을 설치하지 않는다
- **THEN** compiler 없이 init·validate·웹·MCP가 동작한다
- **AND** Git prepare 빌드는 설치 전 임시 빌드 환경에서 필요한 의존성을 확보한다

### Requirement: 기존 서비스 계약과 검증 유지

TS 전환은 서비스 소유 init/BDD/선택·schema·MCP·UI 계약을 유지해야 한다(SHALL). 기존 Node/브라우저 검증은 실제 dist와 설치 산출물을 대상으로 실행하고 최소 지원 Node의 CI에서 typecheck·build·동작 검증을 수행해야 한다(SHALL).

#### Scenario: compiled 도구로 서비스 검토

- **WHEN** 기존 검증을 compiled 도구의 새 A/B 서비스에서 실행한다
- **THEN** 빈 init·독립 정의/BDD/선택·box/HTML·웹/MCP 동작이 유지된다
- **AND** 타입/빌드/배포 검증 외의 기능이나 UI를 추가하지 않는다

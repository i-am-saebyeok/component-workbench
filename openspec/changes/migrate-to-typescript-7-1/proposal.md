# TypeScript 7.1 Beta 전환

## Why

사용자가 도구를 TypeScript 7.1 Beta로 전환하도록 요청했다. 실제 생산 소스와 배포 빌드를 타입 검사 대상으로 만들고 현재 서비스 계약을 유지한다.

## What Changes

- typescript를 정확히 7.1.0-beta로 고정하고 src·web·제품 스크립트를 TS로 전환한다.
- strict 검사와 JS 빌드를 추가하고 npm prepare에서 배포 산출물을 생성한다.
- 테스트·CLI·브라우저·CI를 실제 dist/설치 산출물에 연결하고 0.1.2로 배포한다.

## Capabilities

### New Capabilities

- `typescript-toolchain`: 고정 컴파일러·실제 생산 소스 검사·독립 실행되는 JS 배포·빌드 검증.

## Impact

생산 소스 확장자·빌드/검사 설정·패키지/잠금파일·기존 테스트 경로·CI·문서에 영향을 준다. 컴포넌트/BDD/선택 schema·서비스 소유권·UI·Node 최소 버전은 유지한다. npm registry 발행과 기존 태그 이동은 포함하지 않는다.

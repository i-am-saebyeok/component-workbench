# Design

## Decisions

- typescript 7.1.0-beta를 정확히 고정한다. src·web·제품 스크립트는 실제 strict 검사되는 TS이며 nocheck·검사 제외·전역 any로 전환을 대신하지 않는다.
- 실행은 Node 22.12.0 이상 ESM과 브라우저 JS다. TS는 dist의 실행 가능한 JS로 빌드하고 정적 HTML/CSS·템플릿·schema·LICENSE를 필요한 경로에 포함한다.
- dist는 Git에 중복 저장하지 않는다. npm prepare에서 빌드해 pack/Git 설치가 같은 산출물을 제공하도록 한다. Git prepare의 빌드용 devDependencies와 소비 서비스 runtime 의존성을 구분한다.
- 기존 JS 테스트와 서비스 HTML fixture는 유지할 수 있다. 검사 대상은 compiled runtime/브라우저이며 서비스 컴포넌트 초기값은 계속 0개다.
- 버전은 0.1.2로 올리고 실제 검증 뒤 새 태그를 만든다. 기능과 UI를 확장하지 않는다.

## Verification

typecheck/build·실제 검사 실패 증거·기존 Node 48개/브라우저 15개를 새 산출물에 적용한다. compiler 없는 새 tarball/Git 소비 서비스에서 init·validate·웹·MCP를 확인하고 Node 22.12.0/24 CI를 실행한다. 공개 Git SHA 설치 후 태그를 만들고 태그 설치를 확인한다.

## Sources

- [TypeScript 7.1 Beta 발표](https://devblogs.microsoft.com/typescript/announcing-typescript-7-1-beta/)
- [npm prepare: Git 설치 전 dependencies/devDependencies 설치와 빌드](https://docs.npmjs.com/cli/v11/using-npm/scripts/#life-cycle-scripts)

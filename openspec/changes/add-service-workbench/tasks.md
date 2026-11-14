# Tasks

재사용 대상은 도구이며 init 기본 컴포넌트는 0개다. 실제 구현·검증 결과로만 체크하고 계획 문서 작성·fixture 존재를 기능 통과로 표시하지 않는다. 다른 서비스/게임 저장소의 migration이나 데이터 복사는 포함하지 않는다.

## 1. 패키지와 빈 서비스 계약

- [x] 1.1 [Sol xhigh] README·빈 catalog·서비스/BDD/preview 안내를 config/schema·설치/init/실행과 대조했다. 기본 컴포넌트 0개이며 특정 서비스 정의·재질·에셋이 없다.
- [x] 1.2 [Claude Opus xhigh] CLI·잠금파일·배포 목록을 구현했다. pack 25개 파일의 runtime/웹/schema/빈 템플릿/문서와 checkout 밖 설치 실행, 테스트 fixture 제외를 확인했다.

## 2. 보존 가능한 init

- [x] 2.1 [Claude Opus xhigh] 설치 확인·config·빈 데이터·안내·npm scripts·두 프로젝트 MCP를 구현했다. 실제 A/B init의 0개·선택 없음/revision0·selection 미생성·생성된 명령 실행을 확인했다.
- [x] 2.2 [Claude Opus xhigh] init 사전 검사·반복 보존·롤백을 구현했다. 8개 init 검사와 설치본 검사에서 수정 데이터/설정·기존 scripts/MCP 보존, 바이트 안정, 늦은 충돌/잘못된 JSON·TOML/동명 설정/쓰기 실패의 무변경을 확인했다.

## 3. 일반 데이터·선택·MCP

- [x] 3.1 [Claude Opus xhigh] 일반 로더·부모 config 탐색·fingerprint를 구현했다. 9개 source 검사에서 임의 치수·빈 variants/null·preview 없음·잘못된 schema/ID/문서/형식/경로/링크·BDD 본문을 확인했다.
- [x] 3.2 [Claude Opus xhigh] 빈 상태·첫 선택·지속 저장·revision/source 잠금·recipe를 구현했다. 선택 9개/잠금 7개 검사에서 문서·preview만 바뀐 hash, 오래된 요청, 프로세스 경쟁/소유권, 재시작, recipe 경로/해시/무변경을 확인했다.
- [x] 3.3 [Claude Opus xhigh] MCP 6도구와 실제 문서 resources를 연결했다. 공식 HTTP/stdio 클라이언트와 생성된 두 MCP 명령으로 하위/공백 경로·두 프로토콜 협상·본문·공유 선택을 확인했다.

## 4. 최소 웹과 두 preview

- [x] 4.1 [Claude Opus xhigh: 코드 / Sol xhigh: 화면 검수] 빈 UI·목록·variant·한 선택 CTA·현재 선택·닫힌 문서 패널을 구현했다. 설치본 브라우저 15개 검사/21장 화면에서 선택/재조회·본문·오류 복구·390px 접근성과 최소 메인을 확인했다.
- [x] 4.2 [Claude Opus xhigh: 코드 / Sol xhigh: 미리보기 검수] box 치수/재질·서비스 로컬 HTML/번들·variant override를 구현했다. A/B의 실제 비율/색·클릭·두 variant와 100m/0.1m 초기/reset 범위를 확인하고 지원 범위를 안내했다.

## 5. 배포와 독립 서비스 통합

- [x] 5.1 [Claude Opus xhigh: 검사 코드 / Sol xhigh: 결과 검수] 같은 tarball을 새 A/B에 설치했다. 6개 package 검사에서 빈 init부터 서로 다른 box/HTML 정의·BDD·선택·MCP·recipe와 설치 파일의 독립성을 확인했다.
- [ ] 5.2 [Sol xhigh] 실제 결과/화면과 README를 대조하고 Node 22.12.0/24.19.0 각 48개·브라우저 15개·strict/whitespace를 확인했다. 원격 SHA 설치는 통과했다. v0.1.0 태그 설치를 확인하고 hosted CI 미실행 사유와 함께 기록한다.

## Workflow follow-up

- root가 실제 검수 후 v0.1.0 태그·GitHub private 전달을 진행한다. npm registry에는 publish하지 않는다.
- 서비스 컴포넌트/variant/BDD는 서비스가 소유하며 예제 fixture를 기본 초기화 데이터로 배포하지 않는다.
- 모든 구현·검증이 끝난 뒤 검토·보관하고 기존 서비스 migration은 별도 요청 범위로 다룬다.

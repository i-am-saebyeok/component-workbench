# Tasks

재사용 대상은 도구이며 init 기본 컴포넌트는 0개다. 실제 구현·검증 결과로만 체크하고 계획 문서 작성·fixture 존재를 기능 통과로 표시하지 않는다. 다른 서비스/게임 저장소의 migration이나 데이터 복사는 포함하지 않는다.

## 1. 패키지와 빈 서비스 계약

- [ ] 1.1 [Sol xhigh] 루트 README·빈 catalog·서비스/BDD/preview 작성 안내 템플릿을 작성하고 확정 config/schema·컴포넌트 0개·지원 범위·설치/init/실행 계약과 대조한다. 특정 서비스 ID·재질·에셋이 기본 템플릿에 없는지 확인한다.
- [ ] 1.2 [Claude Opus xhigh] 설치 가능한 CLI/package·빌드·잠금/배포 파일 목록을 구현하고 npm pack으로 필요한 runtime/web/vendor/schema/templates를 포함하는지 검사한다. 다른 서비스 데이터·엔진 경로·테스트 fixture 없이 checkout 밖 설치에서 bin이 실행되는지 확인한다.

## 2. 보존 가능한 init

- [ ] 2.1 [Claude Opus xhigh] 로컬 설치 확인·서비스 config·빈 catalog·안내 파일·npm scripts·두 프로젝트 MCP 병합을 구현한다. 실제 새 서비스 init 직후 components=0·선택 없음/revision0·selection 파일 미생성·실행 가능한 scripts를 검증하고 생성 목록/연결 명령을 안내와 대조한다.
- [ ] 2.2 [Claude Opus xhigh] 전체 init 사전 검사·반복 보존·충돌 무변경을 구현한다. 사용자 수정 catalog/선택/설정·기존 npm/MCP 항목 유지와 바이트 수준 반복 안정성을 검사하고 늦은 충돌·잘못된 JSON/TOML·동명 다른 설정에서 모든 기존 파일/목록과 미생성 상태가 보존되는지 확인한다.

## 3. 일반 데이터·선택·MCP

- [ ] 3.1 [Claude Opus xhigh] 서비스 config 부모 탐색·일반 component/variant/preview·문서 로더와 source fingerprint 검증을 구현한다. 임의 양수 치수·빈 variants/null·preview 없음·누락 BDD/파일·미지원 type·경로/심볼릭 링크 이탈을 검사하고 실제 BDD 본문을 조회한다.
- [ ] 3.2 [Claude Opus xhigh] revision0의 빈 상태·첫 선택 생성·지속 저장·원본/revision 잠금·recipe 내보내기를 구현한다. 문서/preview만 바꾼 fingerprint, 오래된 입력·다중 프로세스 writer·잘못된 ID/variant·재시작에서 원자적 보존과 원본/선택 식별값을 검사한다. export가 선택/서비스 파일을 변경하지 않는지 확인한다.
- [ ] 3.3 [Claude Opus xhigh] 일반 MCP 6도구와 실제 BDD resources를 같은 서비스에 연결한다. 생성한 .mcp.json/.codex 설정과 stdio 클라이언트로 초기화·목록·호출·본문 읽기를 검사하고 서비스 하위/공백 경로에서도 같은 config·독립 선택을 쓰는지 확인한다. 제공하는 HTTP MCP도 실제 클라이언트로 대조한다.

## 4. 최소 웹과 두 preview

- [ ] 4.1 [Claude Opus xhigh: 코드 / Sol xhigh: 화면 검수] 빈 UI·동적 목록·variant·한 선택 CTA·간결한 현재 저장 상태·닫힌 용도/BDD 패널을 구현한다. 실제 브라우저의 빈 상태와 일반 컴포넌트 선택/재조회·본문 읽기·390px 접근성을 검사하고 기술 metadata가 메인에 나열되지 않는 화면을 남긴다.
- [ ] 4.2 [Claude Opus xhigh: 코드 / Sol xhigh: 모델링/미리보기 검수] 서비스 치수/재질을 따르는 box와 서비스 로컬 HTML/번들·variant preview override를 구현한다. 서로 다른 A/B fixture의 실제 3D 비율/색과 HTML 표시·상호작용·두 variant 전환을 검수하고 preview 없음/미지원 범위를 안내한다.

## 5. 배포와 독립 서비스 통합

- [ ] 5.1 [Claude Opus xhigh: 검사 코드 / Sol xhigh: 실행/결과 검수] 같은 npm pack 산출물을 checkout 밖의 새 A/B 서비스에 설치해 빈 init부터 실행한다. 테스트에서만 A의 3×1×1.5m box/파란 metal과 B의 두 HTML button variant를 추가하고 정의·BDD·선택·MCP·recipe·원본 변경이 서로와 도구 설치 파일을 침범하지 않는지 검증한다.
- [ ] 5.2 [Sol xhigh: 문서/결과 대조 / Claude Opus xhigh: 필요한 검사 코드] 설치·init/반복/충돌·두 preview·MCP·독립 선택의 실제 보고서/화면과 README를 명세 시나리오에 매핑한다. pack 설치와 GitHub 태그 설치의 수행 여부를 구분하고 OpenSpec 전체/변경 strict·whitespace를 검사하며 미수행 항목을 남긴다.

## Workflow follow-up

- root가 실제 검수 후 v0.1.0 태그·GitHub private 전달을 진행한다. npm registry에는 publish하지 않는다.
- 서비스 컴포넌트/variant/BDD는 서비스가 소유하며 예제 fixture를 기본 초기화 데이터로 배포하지 않는다.
- 모든 구현·검증이 끝난 뒤 검토·보관하고 기존 서비스 migration은 별도 요청 범위로 다룬다.

# 서비스 컴포넌트 정의

이 디렉토리의 컴포넌트·variant·자산·용도/BDD·선택은 이 서비스가 소유합니다. 도구는 탐색·미리보기·검증·선택을 제공하며 서비스의 컴포넌트 라이브러리를 기본 설치하지 않습니다. 카탈로그는 컴포넌트 0개에서 시작합니다.

## 컴포넌트 작성

서비스 config가 지정한 catalog에 정의를 추가합니다. 정의와 용도/BDD·preview를 함께 관리하고 의미가 바뀌면 catalog revision도 검토합니다.

| 필드 | 작성할 내용 |
| --- | --- |
| id·name·description | 서비스 안에서 구별하는 안정 ID와 이름·간단한 설명 |
| intended_uses·avoid_uses | 실제 사용 목적·선택 조건과 피해야 할 사용 |
| bdd | docs_root 기준 관련 `.feature` 상대 경로 목록 |
| preview | 선택적인 box 또는 서비스 소유 static HTML 표시 설정 |
| variants | 서비스가 제공하는 variant 정의. 없으면 빈 배열 |

variant는 id·name과 선택적인 material·preview override를 가집니다. material 필드는 base_color_srgb_hex·roughness·metallic입니다. variant가 없는 정의는 null variant로 선택할 수 있습니다. 외형 이름에서 구현되지 않은 기능·물성·업무 규칙을 추론하지 않도록 용도와 BDD에 경계를 적습니다.

[BDD 안내](behaviors/README.md)와 [preview 안내](previews/README.md)를 따라 서비스가 필요한 내용을 직접 작성합니다. 도구에 다른 서비스의 데이터나 게임 규칙이 있는 것으로 가정하지 않습니다.

## 웹·MCP 선택

서비스 루트의 `npm run workbench`로 웹을 엽니다. 문서 패널에서 용도/BDD를 읽고 컴포넌트와 가능한 variant를 고릅니다. MCP도 같은 정의와 선택을 사용하며 get_component와 resources로 실제 BDD 본문을 읽습니다.

selection은 서비스 config가 정한 경로에 저장합니다. init 직후에는 파일이 없고 선택 없음·revision 0입니다. 첫 유효 선택 때 서비스가 생성합니다. 정의와 선택을 직접 혼동해 덮어쓰지 않습니다. 오래된 source fingerprint나 selection revision으로 저장하면 최신 상태를 다시 읽고 명시적으로 재시도합니다.

recipe는 선택과 원본 식별을 전달하는 자료입니다. 선택 저장이나 recipe 조회만으로 이 서비스의 코드·자산·제품 기능을 자동 생성하지 않습니다. 실제 실행 결과·검증 보고서는 별도의 운영 기록에 남기며 문서 작성과 동작 검증 완료를 구분합니다.

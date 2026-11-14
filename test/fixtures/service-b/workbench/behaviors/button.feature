Feature: HTML 버튼 variant의 외형과 클릭 반응을 검토한다

@html-button-click-counter
Scenario: 서비스 preview 안에서 클릭 반응 확인
  Given HTML button의 primary preview에 클릭 횟수가 표시된다
  And workbench에서 저장한 선택이 없다
  When 사용자가 preview 내부 버튼을 한 번 클릭한다
  Then preview의 클릭 횟수가 직전 값보다 1 증가한다
  And workbench의 저장 선택은 바뀌지 않는다

@html-button-variant-preview
Scenario: 다른 variant의 로컬 preview 확인
  Given 사용자가 primary 버튼을 보고 있다
  When variant를 secondary로 바꾼다
  Then secondary에 연결된 서비스 소유 HTML이 표시되어 외형이나 문구로 구별된다
  And 그 preview 내부 버튼도 클릭 횟수를 증가시킨다
  And variant 보기 변경만으로 저장 선택이 바뀌지 않는다

@html-button-selection-persists
Scenario: 확인한 보조 버튼 조합 저장
  Given 사용자가 HTML button의 secondary preview를 확인했다
  When 선택 동작으로 저장하고 현재 선택을 다시 조회한다
  Then 해당 서비스의 button component와 secondary variant가 기록된다
  And 서비스 A의 catalog·selection과 도구 설치 파일은 변경되지 않는다

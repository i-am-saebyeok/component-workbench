Feature: 보관 설비 패널을 보고 선택 기록을 남긴다

@storage-panel-view-does-not-select
Scenario: 공간 검토를 위한 보기 조작
  Given storage-panel의 본체 치수는 3×1×1.5m이고 metal-blue 외형을 제공한다
  And 아직 저장한 선택이 없다
  When 사용자가 미리보기를 열고 회전하거나 확대한다
  Then 길이·깊이·높이의 비율과 파란 금속 외형을 확인할 수 있다
  And 보기 조작만으로 selection 파일이나 저장 선택을 만들지 않는다

@storage-panel-selection-persists
Scenario: 패널 선택을 저장하고 다시 확인
  Given 사용자가 storage-panel과 metal-blue를 검토했다
  When 선택 동작으로 저장하고 웹을 다시 읽거나 MCP로 현재 선택을 조회한다
  Then 저장된 component_id는 storage-panel이고 variant_id는 metal-blue다
  And 두 인터페이스의 원본 fingerprint와 selection revision이 같다

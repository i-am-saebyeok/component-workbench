# 공개 배포와 MIT 라이선스

## Why

같은 도구를 저장소 접근 권한 없이 설치·재사용할 수 있도록 공개하고 배포물의 이용 조건을 명시한다.

## What Changes

- 공식 GitHub MIT 템플릿의 LICENSE와 package license 메타데이터를 추가한다.
- 0.1.1과 공개 Git 설치 안내를 준비하고 v0.1.0은 유지한다.
- 기존 테스트의 pack 파일 목록과 설치 안내 버전 기대값을 LICENSE·0.1.1에 맞춘다. runtime과 서비스 데이터 계약은 유지한다.

## Capabilities

### Modified Capabilities

- `service-component-workbench`: 공개 Git 설치와 MIT 라이선스가 포함된 배포.

## Impact

LICENSE·package/lock 메타데이터·README·검증 기록·기존 테스트의 파일/버전 기대값·OpenSpec에만 영향을 준다. npm registry 발행은 포함하지 않는다.

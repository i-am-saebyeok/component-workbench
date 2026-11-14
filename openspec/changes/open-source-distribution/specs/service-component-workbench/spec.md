# Spec Delta

## MODIFIED Requirements

### Requirement: 서비스 데이터 없는 도구 패키지

배포 패키지는 도구 코드·필요 자산·빈 초기화 템플릿·사용 안내·MIT LICENSE를 제공하고 특정 소비 서비스의 컴포넌트·재질·게임 규칙·엔진 경로·에셋을 기본 데이터로 포함하지 않아야 한다(SHALL). 공개 GitHub 저장소와 pack 산출물 설치를 지원하고 package의 license는 MIT여야 하며 npm registry publish를 요구하지 않아야 한다(SHALL).

#### Scenario: 새 서비스에 패키지 설치

- **WHEN** 사용자가 pack 산출물을 기존 도구 저장소 밖의 새 서비스에 설치한다
- **THEN** 그 서비스에서 도구 CLI와 필요한 웹/MCP 자산을 사용할 수 있다
- **AND** 다른 서비스의 컴포넌트나 에셋 경로에 의존하지 않는다

#### Scenario: 공개 버전의 라이선스 확인

- **WHEN** 사용자가 공개 배포 버전을 설치한다
- **THEN** 설치 패키지에 MIT LICENSE와 일치하는 license 메타데이터가 있다
- **AND** 저장소 접근 권한이나 npm registry 발행을 요구하지 않는다

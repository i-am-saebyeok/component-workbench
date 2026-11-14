# Design

## Decisions

- GitHub 공식 MIT 템플릿을 사용하고 저작권자는 2026 i-am-saebyeok으로 명시한다.
- LICENSE를 포함하는 새 버전은 0.1.1이다. v0.1.0 태그를 이동하지 않는다.
- 저장소는 공개하되 package의 private=true는 npm registry 발행 방지용으로 유지한다.
- runtime은 수정하지 않는다. 기존 테스트의 pack 파일 목록에 LICENSE를 추가하고 설치 안내 기대 태그를 0.1.1로 바꾸는 메타데이터만 Opus xhigh가 갱신한다.

## Verification

실제 npm pack의 LICENSE/메타데이터·기존 npm test·OpenSpec strict·whitespace를 확인한다. 공개 전환·push·v0.1.1 태그·공개 Git 설치와 hosted CI 결과는 루트가 수행한 뒤 별도로 기록한다.

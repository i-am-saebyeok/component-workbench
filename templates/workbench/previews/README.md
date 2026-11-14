# 서비스 preview 작성

preview와 자산은 이 서비스가 소유합니다. 초기 지원은 내장 box와 서비스가 제공한 static HTML/로컬 번들입니다. 예제 컴포넌트나 HTML 화면을 기본 설치하지 않습니다. preview를 생략한 정의는 읽을 수 있는 미리보기 없음 상태로 표시합니다.

## box

컴포넌트 preview의 type을 box로 지정하고 dimensions_m에 양수인 x·y·z 길이 세 개를 적습니다. 도구는 특정 크기·축의 지리 방향·게임 규칙을 강제하지 않습니다. variant의 material에는 선택적으로 sRGB 색·roughness·metallic을 지정할 수 있으며 본체 치수와 재질을 구분합니다.

## static HTML

컴포넌트 preview의 type을 html로 지정하고 src에는 서비스 config의 preview_root 안에 있는 HTML 상대 경로를 적습니다. 필요한 CSS·이미지·로컬 번들도 이 서비스에서 관리합니다. variant가 다른 표시를 사용하면 해당 variant의 preview override로 정의합니다.

HTML은 서비스가 작성한 신뢰된 개발 코드이며 도구가 보안 sandbox를 완성한 것으로 해석하지 않습니다. 임의 원격 URL을 proxy하거나 프레임워크 dev server를 자동 실행하는 adapter가 아닙니다. 미지원 type·누락 파일·설정 root 밖 경로는 거부됩니다.

## 검수

실제 서비스 화면에서 box 비율·재질 또는 HTML 표시·상호작용·variant 전환을 확인합니다. 좁은 화면에서도 목록과 variant·선택 동작에 접근할 수 있어야 합니다. preview가 보인다는 사실과 해당 컴포넌트의 제품 기능이 구현됐다는 사실을 구분합니다. preview 변경도 source fingerprint에 반영되므로 선택/recipe가 어떤 원본을 사용했는지 기록합니다.

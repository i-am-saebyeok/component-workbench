// 웹 UI가 같은 origin JSON API에서 읽는 응답 형식. 서버(src/http.ts)의 route 반환형도
// 이 형식으로 선언해 두 쪽이 같은 계약을 쓰는지 컴파일러가 검사한다. 선언 파일이라 JS를 만들지 않는다.

export type Material = { base_color_srgb_hex: string; roughness: number; metallic: number };

export type Preview = { type: 'box'; dimensions_m: [number, number, number] } | { type: 'html'; src: string };

export type Variant = { id: string; name: string; material?: Material | undefined; preview?: Preview | undefined };

export type Component = {
  id: string;
  name: string;
  description: string;
  intended_uses: string[];
  avoid_uses: string[];
  bdd: string[];
  preview?: Preview | undefined;
  variants: Variant[];
};

type Source = { source_sha256: string };

/** `/api/selection` 응답. 저장 선택이 없으면 status는 none이다. */
export type SelectionState =
  | { status: 'none'; revision: number; selection: null; source: Source }
  | { status: 'current' | 'stale_source' | 'unresolvable'; revision: number; selection: { component_id: string; variant_id: string | null }; source: Source };

/** `/api/catalog` 응답. 문서는 원문을 포함한다. */
export type CatalogResponse = {
  workbench: { title: string; catalog: string };
  source: Source;
  components: Component[];
  documents: { path: string; text: string }[];
  selection: SelectionState;
};

/** 실패 응답 본문. 서버 오류 형식이 아닐 수 있어 모든 필드를 확인하며 읽는다. */
export type ErrorBody = {
  error?: {
    code?: string;
    message_ko?: string;
    details?: { problems?: { at?: string; message_ko: string }[]; current?: SelectionState };
  };
};

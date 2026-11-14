// 서비스가 preview_root에 둔 static HTML을 같은 origin iframe으로 표시한다. 서비스가 작성한
// 신뢰된 개발 코드이며 sandbox가 아니다. 도구는 HTML이나 UI 컴포넌트를 만들지 않는다.
export function createHtmlPreview(frame: HTMLIFrameElement) {
  let shown: { src: string; version: string } | null = null;
  frame.addEventListener('load', () => {
    if (shown) frame.dataset.loadedSrc = shown.src;
  });
  return {
    /** version이 바뀌면(서비스 원본 변경) 같은 src라도 다시 읽는다. */
    show({ src, title, componentId, variantId, version }: { src: string; title: string; componentId: string; variantId: string | null; version: string }) {
      frame.title = `${title} 미리보기`;
      Object.assign(frame.dataset, { renderedComponent: componentId, renderedVariant: variantId ?? '' });
      if (shown?.src === src && shown.version === version) return;
      shown = { src, version };
      delete frame.dataset.loadedSrc;
      frame.src = `/preview/${src.split('/').map(encodeURIComponent).join('/')}`;
    },
  };
}

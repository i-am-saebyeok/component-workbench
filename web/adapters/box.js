// 서비스가 정의한 dimensions_m [X, Y, Z]를 그대로 그리는 3D box. 오른손 좌표이고 Z가 위다.
// 바닥면 중앙이 원점이고, 직교 카메라라 모서리 길이 비율이 왜곡되지 않는다. 치수·재질 외의
// 규칙(격자 배수, 축의 지리 방향 등)은 두지 않는다.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';

/** material이 없는 variant·컴포넌트의 표시 전용 중립 재질. */
export const NEUTRAL_MATERIAL = { base_color_srgb_hex: '#b9bdc2', roughness: 0.8, metallic: 0 };
const AXIS_COLORS = { x: '#b4483c', y: '#3f7d4e', z: '#3b5f9a' };
const VIEW_DIRECTION = new THREE.Vector3(1, -1.2, 0.9).normalize();

/** 1·2·5×10^k 중 length를 약 세 칸으로 나누는 격자 간격. */
function niceStep(length) {
  const raw = length / 3;
  const power = 10 ** Math.floor(Math.log10(raw));
  const n = raw / power;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * power;
}

const meters = (value) => `${Number(value.toPrecision(6))} m`;

function label(text, className) {
  const element = document.createElement('div');
  element.className = className;
  element.textContent = text;
  return new CSS2DObject(element);
}

const lineMaterial = (color, opacity = 1) => new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity });

/** 한 모서리를 따라 바깥으로 띄운 치수선(양 끝 눈금, 가운데 라벨). */
function dimension(from, to, tickDirection, tickLength, text) {
  const group = new THREE.Group();
  const tick = tickDirection.clone().multiplyScalar(tickLength);
  const points = [from, to, from.clone().sub(tick), from.clone().add(tick), to.clone().sub(tick), to.clone().add(tick)];
  group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), lineMaterial('#3b403c')));
  const tag = label(text, 'dim-label');
  tag.position.copy(from).add(to).multiplyScalar(0.5);
  group.add(tag);
  return group;
}

export function createBoxPreview(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor('#ebe9e4');
  container.appendChild(renderer.domElement);

  const labels = new CSS2DRenderer();
  Object.assign(labels.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
  container.appendChild(labels.domElement);

  const scene = new THREE.Scene();
  // 금속 재질이 검게 보이지 않도록 중립 실내 환경광을 쓴다(RoomEnvironment는 Y가 위라 Z 위로 돌린다).
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentRotation.set(Math.PI / 2, 0, 0);
  scene.environmentIntensity = 0.6;
  scene.add(new THREE.HemisphereLight('#ffffff', '#b8b0a2', 0.9));
  const sun = new THREE.DirectionalLight('#ffffff', 1.7);
  sun.position.set(4, -2.5, 7);
  scene.add(sun);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 1000);
  camera.up.set(0, 0, 1);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.minZoom = 0.5;
  controls.maxZoom = 6;
  controls.maxPolarAngle = Math.PI / 2 - 0.04;

  const material = new THREE.MeshStandardMaterial();
  let content = null; // 현재 치수의 body·edges·grid·치수선·축 표시
  let body = null;
  let shownDimensions = null;
  let current = null;
  const view = { center: new THREE.Vector3(), distance: 10, halfWidth: 1, halfHeight: 1 };

  function disposeContent() {
    if (!content) return;
    scene.remove(content);
    content.traverse((child) => {
      child.geometry?.dispose();
      if (child.material && child.material !== material) child.material.dispose();
      if (child.element) child.element.remove();
    });
  }

  function build([dx, dy, dz]) {
    disposeContent();
    content = new THREE.Group();
    const span = Math.max(dx, dy, dz);
    const step = niceStep(span);
    const offset = span * 0.14;

    const geometry = new THREE.BoxGeometry(dx, dy, dz);
    geometry.translate(0, 0, dz / 2);
    geometry.computeBoundingBox();
    body = new THREE.Mesh(geometry, material);
    content.add(body, new THREE.LineSegments(new THREE.EdgesGeometry(geometry), lineMaterial('#1f2421', 0.55)));

    const tick = offset * 0.3;
    const front = -dy / 2 - offset;
    const right = dx / 2 + offset;
    content.add(dimension(new THREE.Vector3(-dx / 2, front, 0), new THREE.Vector3(dx / 2, front, 0), new THREE.Vector3(0, 1, 0), tick, `X ${meters(dx)}`));
    content.add(dimension(new THREE.Vector3(right, -dy / 2, 0), new THREE.Vector3(right, dy / 2, 0), new THREE.Vector3(1, 0, 0), tick, `Y ${meters(dy)}`));
    const corner = new THREE.Vector3(-dx / 2 - offset * 0.7, -dy / 2 - offset * 0.7, 0);
    content.add(dimension(corner, corner.clone().setZ(dz), new THREE.Vector3(-1, -1, 0).normalize(), tick, `Z ${meters(dz)}`));

    // 축 표시: 기본 시점에서 본체에 가리지 않는 오른쪽 뒤 바닥, 격자 한 칸 길이.
    const origin = new THREE.Vector3(dx / 2 + offset + step * 0.4, dy / 2 + offset + step * 0.4, 0);
    for (const [axis, direction] of [
      ['x', new THREE.Vector3(1, 0, 0)],
      ['y', new THREE.Vector3(0, 1, 0)],
      ['z', new THREE.Vector3(0, 0, 1)],
    ]) {
      content.add(new THREE.ArrowHelper(direction, origin, step, AXIS_COLORS[axis], step * 0.22, step * 0.12));
      const tag = label(`+${axis.toUpperCase()}`, 'axis-label');
      tag.element.style.color = AXIS_COLORS[axis];
      tag.position.copy(origin).addScaledVector(direction, step * 1.3);
      content.add(tag);
    }
    // 기본 시점에서 body·치수선·축 표시가 모두 들어오는 직교 화면 범위(바닥 격자는 범위에서 뺀다).
    const extents = new THREE.Box3().setFromObject(content).expandByScalar(span * 0.06);
    const cells = 2 * Math.ceil((Math.max(dx, dy) / 2 + step) / step);
    const grid = new THREE.GridHelper(cells * step, cells, '#a59d8f', '#c9c2b5');
    grid.rotation.x = Math.PI / 2;
    content.add(grid);
    scene.add(content);

    extents.getCenter(view.center);
    view.distance = span * 20 + 10;
    camera.position.copy(view.center).addScaledVector(VIEW_DIRECTION, view.distance);
    camera.lookAt(view.center);
    camera.updateMatrixWorld();
    let halfWidth = 0;
    let halfHeight = 0;
    for (const x of [extents.min.x, extents.max.x]) {
      for (const y of [extents.min.y, extents.max.y]) {
        for (const z of [extents.min.z, extents.max.z]) {
          const point = new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse);
          halfWidth = Math.max(halfWidth, Math.abs(point.x));
          halfHeight = Math.max(halfHeight, Math.abs(point.y));
        }
      }
    }
    view.halfWidth = halfWidth * 1.08;
    view.halfHeight = halfHeight * 1.08;
    camera.far = view.distance * 2 + span * 10;
    resetView();
  }

  function fitCamera() {
    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;
    const aspect = width / height;
    let { halfWidth, halfHeight } = view;
    if (halfWidth / halfHeight < aspect) halfWidth = halfHeight * aspect;
    else halfHeight = halfWidth / aspect;
    Object.assign(camera, { left: -halfWidth, right: halfWidth, top: halfHeight, bottom: -halfHeight });
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    renderer.domElement.style.width = `${width}px`;
    renderer.domElement.style.height = `${height}px`;
    labels.setSize(width, height);
  }

  function resetView() {
    camera.position.copy(view.center).addScaledVector(VIEW_DIRECTION, view.distance);
    camera.zoom = 1;
    controls.target.copy(view.center);
    fitCamera();
    controls.update();
    requestRender();
  }

  let pending = false;
  function requestRender() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      const moving = controls.update();
      renderer.render(scene, camera);
      labels.render(scene, camera);
      if (moving) requestRender();
      if (current) publishRenderedState();
    });
  }

  /** 실제로 그린 본체 크기·재질을 노출한다(검사·QA용). */
  function publishRenderedState() {
    const size = body.geometry.boundingBox.getSize(new THREE.Vector3());
    Object.assign(container.dataset, {
      rendered: 'true',
      renderedComponent: current.componentId,
      renderedVariant: current.variantId ?? '',
      renderedDimensions: [size.x, size.y, size.z].map((value) => Number(value.toFixed(6))).join(','),
      renderedColor: `#${material.color.getHexString(THREE.SRGBColorSpace)}`,
      renderedRoughness: String(material.roughness),
      renderedMetallic: String(material.metalness),
    });
  }

  function show({ componentId, variantId, dimensions, material: definition }) {
    const key = dimensions.join(',');
    if (shownDimensions !== key) {
      build(dimensions);
      shownDimensions = key;
    }
    const look = definition ?? NEUTRAL_MATERIAL;
    material.color.set(look.base_color_srgb_hex);
    material.roughness = look.roughness;
    material.metalness = look.metallic;
    material.needsUpdate = true;
    current = { componentId, variantId };
    requestRender();
  }

  new ResizeObserver(() => {
    fitCamera();
    requestRender();
  }).observe(container);
  controls.addEventListener('change', requestRender);

  return { show, resetView };
}

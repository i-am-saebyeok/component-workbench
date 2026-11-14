// 서비스 B fixture: preview 안의 클릭 반응. workbench 선택과 관계없다.
let clicks = 0;
const count = document.getElementById('count');
document.getElementById('action').addEventListener('click', () => {
  clicks += 1;
  count.textContent = `클릭 ${clicks}회`;
});

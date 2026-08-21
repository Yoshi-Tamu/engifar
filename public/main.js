const startBtn = document.getElementById('startBtn');
const joinBtn = document.getElementById('joinBtn');
const createPanel = document.getElementById('createPanel');
const joinPanel = document.getElementById('joinPanel');

function setMode(mode) {
  const isStart = mode === 'start';
  const isJoin = mode === 'join';

  createPanel.hidden = !isStart;
  joinPanel.hidden = !isJoin;
  startBtn.setAttribute('aria-expanded', String(isStart));
  joinBtn.setAttribute('aria-expanded', String(isJoin));

  if (isStart) {
    createPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } else if (isJoin) {
    joinPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

let currentMode = null;

startBtn.addEventListener('click', () => {
  currentMode = currentMode === 'start' ? null : 'start';
  setMode(currentMode);
});

joinBtn.addEventListener('click', () => {
  currentMode = currentMode === 'join' ? null : 'join';
  setMode(currentMode);
});

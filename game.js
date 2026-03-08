import { sdk } from 'https://esm.sh/@farcaster/miniapp-sdk';
import { initWallet, getAddress, isConnected, shortAddr, getBalance, getChain } from './wallet.js';
import { submitScore as txSubmitScore, submitScoreAndTip, getPlayerStats, isConfigured } from './contract.js';
import { buildLeaderboard, isApiConfigured, weiToEth, getBalance as ethBalance } from './etherscan.js';

// ===== Constants =====
const ROWS = 8;
const COLS = 8;
const EMPTY = 0;
const PLAYER = 1;
const PLAYER_KING = 3;
const AI = 2;
const AI_KING = 4;

// ===== DOM =====
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const turnIndicator = document.getElementById('turn-indicator');
const playerScoreEl = document.getElementById('player-score');
const aiScoreEl = document.getElementById('ai-score');
const restartBtn = document.getElementById('restart-btn');
const resultOverlay = document.getElementById('result-overlay');
const resultTitle = document.getElementById('result-title');
const resultMsg = document.getElementById('result-msg');
const resultRestartBtn = document.getElementById('result-restart-btn');
const shareBtn = document.getElementById('share-btn');
const submitScoreBtn = document.getElementById('submit-score-btn');
const submitTipBtn = document.getElementById('submit-tip-btn');
const txStatus = document.getElementById('tx-status');
const leaderboardBtn = document.getElementById('leaderboard-btn');
const leaderboardOverlay = document.getElementById('leaderboard-overlay');
const lbClose = document.getElementById('lb-close');
const lbContent = document.getElementById('lb-content');
const walletDot = document.getElementById('wallet-dot');
const walletAddr = document.getElementById('wallet-addr');
const walletChain = document.getElementById('wallet-chain');
const walletBal = document.getElementById('wallet-bal');
const onchainStats = document.getElementById('onchain-stats');
const statHigh = document.getElementById('stat-high');
const statGames = document.getElementById('stat-games');
const timerDisplay = document.getElementById('timer-display');
const diffBtns = document.querySelectorAll('.diff-btn');
const colorBtns = document.querySelectorAll('.color-btn');
const confettiCanvas = document.getElementById('confetti-canvas');
const scoreCardCanvas = document.getElementById('score-card-canvas');

// ===== State =====
let cellSize, board, selected, validMoves, turn, playerScore, aiScore, animating;
let isMiniApp = false;
let fcUser = null;
let aiDifficulty = 'easy';
let playerColor = 'red';
const MOVE_TIME_LIMIT = 30;
let timeLeft = 0;
let timerId = null;
let timerEnabled = true;
let soundEnabled = true;
let audioContext = null;
let currentTheme = 'dark';

const THEME_BOARDS = {
  dark: { dark: '#16213e', light: '#0f3460' },
  light: { dark: '#b8c4d0', light: '#d4dce4' },
  classic: { dark: '#2d5016', light: '#4a7c23' },
};

const STORAGE_KEYS = {
  sound: 'checkers_sound',
  timer: 'checkers_timer',
  theme: 'checkers_theme',
  tutorialDone: 'checkers_tutorial_done',
  stats: 'checkers_stats',
};

// ===== Helpers =====
function isPlayer(p) { return p === PLAYER || p === PLAYER_KING; }
function isAI(p) { return p === AI || p === AI_KING; }
function isKing(p) { return p === PLAYER_KING || p === AI_KING; }
function owner(p) { return isPlayer(p) ? 'player' : isAI(p) ? 'ai' : null; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function haptic(type) {
  if (!isMiniApp) return;
  try { sdk.actions.triggerHaptic(type); } catch (_) {}
}

// ===== Sound =====
function initAudio() {
  if (audioContext) return;
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
}

function playSound(type) {
  if (!soundEnabled) return;
  try {
    if (!audioContext) initAudio();
    if (audioContext.state === 'suspended') audioContext.resume();
    const now = audioContext.currentTime;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.connect(gain);
    gain.connect(audioContext.destination);
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
    if (type === 'move') {
      osc.frequency.setValueAtTime(180, now);
      osc.type = 'sine';
    } else if (type === 'capture') {
      osc.frequency.setValueAtTime(120, now);
      osc.type = 'square';
      gain.gain.setValueAtTime(0.15, now);
    } else if (type === 'king') {
      osc.frequency.setValueAtTime(520, now);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(660, now + 0.05);
    } else if (type === 'win') {
      osc.frequency.setValueAtTime(523, now);
      osc.frequency.setValueAtTime(659, now + 0.08);
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
    } else if (type === 'lose') {
      osc.frequency.setValueAtTime(150, now);
      osc.type = 'sawtooth';
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
    }
    osc.start(now);
    osc.stop(now + (type === 'king' ? 0.12 : type === 'win' ? 0.2 : type === 'lose' ? 0.15 : 0.08));
  } catch (_) {}
}

// ===== SDK + Wallet Init =====
async function initSDK() {
  try {
    await sdk.actions.ready();
    const context = await sdk.context;
    if (context) {
      isMiniApp = true;

      if (context.user) {
        fcUser = {
          fid: context.user.fid,
          username: context.user.username,
          displayName: context.user.displayName,
          pfpUrl: context.user.pfpUrl,
        };
        applyUserInfo(fcUser);
      }

      if (context.client && context.client.safeAreaInsets) {
        const ins = context.client.safeAreaInsets;
        const app = document.getElementById('app');
        if (ins.top) app.style.paddingTop = ins.top + 'px';
        if (ins.bottom) app.style.paddingBottom = ins.bottom + 'px';
      }
    }
  } catch (_) {
    isMiniApp = false;
  }
}

function applyUserInfo(user) {
  const pfp = document.getElementById('user-pfp');
  if (user.pfpUrl) {
    pfp.src = user.pfpUrl;
    pfp.classList.remove('hidden');
  }
  const name = user.displayName || user.username || '';
  if (name) {
    walletAddr.textContent = name;
    walletAddr.classList.add('username');
  }
}

async function initBlockchain() {
  const { address, connected } = await initWallet();

  if (connected && address) {
    walletDot.classList.add('connected');
    if (!fcUser) {
      walletAddr.textContent = shortAddr(address);
    }
    walletChain.textContent = getChain().name;

    try {
      const bal = await getBalance();
      const short = parseFloat(bal).toFixed(4);
      walletBal.textContent = short + ' ETH';
    } catch (_) {}

    if (isConfigured()) {
      loadOnchainStats(address);
    }
  } else if (!fcUser) {
    walletAddr.textContent = 'Not connected';
  }
}

async function loadOnchainStats(address) {
  const stats = await getPlayerStats(address);
  if (stats) {
    onchainStats.classList.remove('hidden');
    statHigh.textContent = `Best: ${stats.highScore}`;
    statGames.textContent = `Games: ${stats.games}`;
  }
}

// ===== Board =====
function initBoard() {
  const b = Array.from({ length: ROWS }, () => Array(COLS).fill(EMPTY));
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < COLS; c++)
      if ((r + c) % 2 === 1) b[r][c] = AI;
  for (let r = 5; r < 8; r++)
    for (let c = 0; c < COLS; c++)
      if ((r + c) % 2 === 1) b[r][c] = PLAYER;
  return b;
}

function init() {
  board = initBoard();
  selected = null;
  validMoves = [];
  turn = 'player';
  animating = false;
  playerScore = 0;
  aiScore = 0;
  clearTimer();
  playerScoreEl.textContent = '0';
  aiScoreEl.textContent = '0';
  resultOverlay.classList.add('hidden');
  shareBtn.classList.add('hidden');
  submitScoreBtn.classList.add('hidden');
  submitTipBtn.classList.add('hidden');
  const scoreCardBtn = document.getElementById('score-card-btn');
  if (scoreCardBtn) scoreCardBtn.classList.add('hidden');
  txStatus.classList.add('hidden');
  updateTurnUI();
  resize();
  if (timerEnabled && turn === 'player') startTimer();
}

function resize() {
  const container = document.getElementById('board-container');
  const maxW = container.clientWidth - 12;
  const maxH = container.clientHeight - 12;
  const size = Math.min(maxW, maxH);
  cellSize = Math.floor(size / ROWS);
  const total = cellSize * ROWS;
  canvas.width = total;
  canvas.height = total;
  canvas.style.width = total + 'px';
  canvas.style.height = total + 'px';
  draw();
}

// ===== Drawing =====
function draw() {
  const s = cellSize;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const colors = THEME_BOARDS[currentTheme] || THEME_BOARDS.dark;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      ctx.fillStyle = (r + c) % 2 === 1 ? colors.dark : colors.light;
      ctx.fillRect(c * s, r * s, s, s);
    }
  }

  if (selected) {
    ctx.fillStyle = 'rgba(233, 69, 96, 0.35)';
    ctx.fillRect(selected.c * s, selected.r * s, s, s);
  }

  for (const m of validMoves) {
    ctx.beginPath();
    ctx.arc(m.c * s + s / 2, m.r * s + s / 2, s * 0.15, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(245, 200, 66, 0.55)';
    ctx.fill();
  }

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = board[r][c];
      if (p === EMPTY) continue;
      drawPiece(c * s + s / 2, r * s + s / 2, s * 0.38, p);
    }
  }
}

function drawPiece(cx, cy, radius, piece) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  const grad = ctx.createRadialGradient(cx - radius * 0.25, cy - radius * 0.25, radius * 0.1, cx, cy, radius);
  const isRed = playerColor === 'red' ? isPlayer(piece) : isAI(piece);
  if (isRed) {
    grad.addColorStop(0, '#ff6b81');
    grad.addColorStop(1, '#c0392b');
  } else {
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(1, '#b0b0b0');
  }
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = isRed ? '#8e1a2a' : '#888';
  ctx.stroke();
  if (isKing(piece)) {
    ctx.fillStyle = '#f5c842';
    ctx.font = `bold ${radius * 0.9}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('K', cx, cy + 1);
  }
  ctx.restore();
}

// ===== Move Logic =====
function getDirs(piece) {
  if (piece === PLAYER) return [[-1, -1], [-1, 1]];
  if (piece === AI) return [[1, -1], [1, 1]];
  return [[-1, -1], [-1, 1], [1, -1], [1, 1]];
}

function getJumps(r, c, piece) {
  const moves = [];
  for (const [dr, dc] of getDirs(piece)) {
    const mr = r + dr, mc = c + dc;
    const lr = r + dr * 2, lc = c + dc * 2;
    if (lr < 0 || lr >= ROWS || lc < 0 || lc >= COLS) continue;
    if (board[mr][mc] === EMPTY || owner(board[mr][mc]) === owner(piece)) continue;
    if (board[lr][lc] !== EMPTY) continue;
    moves.push({ r: lr, c: lc, captured: [{ r: mr, c: mc }] });
  }
  return moves;
}

function getSimpleMoves(r, c, piece) {
  const moves = [];
  for (const [dr, dc] of getDirs(piece)) {
    const nr = r + dr, nc = c + dc;
    if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
    if (board[nr][nc] !== EMPTY) continue;
    moves.push({ r: nr, c: nc, captured: [] });
  }
  return moves;
}

function getMovesFor(r, c) {
  const piece = board[r][c];
  if (piece === EMPTY) return [];
  const jumps = getJumps(r, c, piece);
  return jumps.length > 0 ? jumps : getSimpleMoves(r, c, piece);
}

function getAllMoves(side) {
  const check = side === 'player' ? isPlayer : isAI;
  let allJumps = [], allSimple = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!check(board[r][c])) continue;
      const jumps = getJumps(r, c, board[r][c]);
      if (jumps.length > 0) {
        for (const j of jumps) allJumps.push({ from: { r, c }, ...j });
      } else {
        const simple = getSimpleMoves(r, c, board[r][c]);
        for (const s of simple) allSimple.push({ from: { r, c }, ...s });
      }
    }
  }
  return allJumps.length > 0 ? allJumps : allSimple;
}

function copyBoard(b) {
  return b.map(row => [...row]);
}

function getJumpsOnBoard(b, r, c, piece) {
  const moves = [];
  for (const [dr, dc] of getDirs(piece)) {
    const mr = r + dr, mc = c + dc;
    const lr = r + dr * 2, lc = c + dc * 2;
    if (lr < 0 || lr >= ROWS || lc < 0 || lc >= COLS) continue;
    if (b[mr][mc] === EMPTY || owner(b[mr][mc]) === owner(piece)) continue;
    if (b[lr][lc] !== EMPTY) continue;
    moves.push({ r: lr, c: lc, captured: [{ r: mr, c: mc }] });
  }
  return moves;
}

function getSimpleMovesOnBoard(b, r, c, piece) {
  const moves = [];
  for (const [dr, dc] of getDirs(piece)) {
    const nr = r + dr, nc = c + dc;
    if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
    if (b[nr][nc] !== EMPTY) continue;
    moves.push({ r: nr, c: nc, captured: [] });
  }
  return moves;
}

function getAllMovesOnBoard(b, side) {
  const check = side === 'player' ? isPlayer : isAI;
  let allJumps = [], allSimple = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!check(b[r][c])) continue;
      const jumps = getJumpsOnBoard(b, r, c, b[r][c]);
      if (jumps.length > 0) {
        for (const j of jumps) allJumps.push({ from: { r, c }, ...j });
      } else {
        const simple = getSimpleMovesOnBoard(b, r, c, b[r][c]);
        for (const s of simple) allSimple.push({ from: { r, c }, ...s });
      }
    }
  }
  return allJumps.length > 0 ? allJumps : allSimple;
}

function applyMoveToBoard(b, move) {
  const { from, r: toR, c: toC, captured } = move;
  const piece = b[from.r][from.c];
  b[from.r][from.c] = EMPTY;
  captured.forEach(cap => { b[cap.r][cap.c] = EMPTY; });
  let finalPiece = piece;
  if (isPlayer(piece) && toR === 0) finalPiece = PLAYER_KING;
  if (isAI(piece) && toR === 7) finalPiece = AI_KING;
  b[toR][toC] = finalPiece;
  return { piece: finalPiece, capturedCount: captured.length };
}

function evaluateBoard(b) {
  let score = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = b[r][c];
      if (isAI(p)) score += isKing(p) ? 3 : 1;
      if (isPlayer(p)) score -= isKing(p) ? 3 : 1;
    }
  }
  return score;
}

function getBestMove1Ply(moves) {
  let bestScore = -Infinity;
  let bestMove = moves[0];
  for (const move of moves) {
    const b = copyBoard(board);
    applyMoveToBoard(b, move);
    const score = evaluateBoard(b);
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }
  return bestMove;
}

function minimax(b, depth, maximizing) {
  if (depth === 0) return evaluateBoard(b);
  const side = maximizing ? 'ai' : 'player';
  const moves = getAllMovesOnBoard(b, side);
  if (moves.length === 0) return evaluateBoard(b);
  let best = maximizing ? -Infinity : Infinity;
  for (const move of moves) {
    const clone = copyBoard(b);
    applyMoveToBoard(clone, move);
    const score = minimax(clone, depth - 1, !maximizing);
    best = maximizing ? Math.max(best, score) : Math.min(best, score);
  }
  return best;
}

function getBestMoveMinimax(moves) {
  const depth = 4;
  let bestScore = -Infinity;
  let bestMove = moves[0];
  for (const move of moves) {
    const b = copyBoard(board);
    applyMoveToBoard(b, move);
    const score = minimax(b, depth - 1, false);
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }
  return bestMove;
}

function getAIMove(moves) {
  if (aiDifficulty === 'easy') {
    const jumps = moves.filter(m => m.captured.length > 0);
    const safe = moves.filter(m => m.captured.length === 0);
    if (jumps.length > 0 && safe.length > 0) {
      if (Math.random() < 0.65) return safe[Math.floor(Math.random() * safe.length)];
      return jumps[Math.floor(Math.random() * jumps.length)];
    }
    if (jumps.length > 0) return jumps[Math.floor(Math.random() * jumps.length)];
    if (safe.length > 0) return safe[Math.floor(Math.random() * safe.length)];
    return moves[Math.floor(Math.random() * moves.length)];
  }
  if (aiDifficulty === 'medium') {
    if (Math.random() < 0.35) {
      return moves[Math.floor(Math.random() * moves.length)];
    }
    return getBestMove1Ply(moves);
  }
  return getBestMoveMinimax(moves);
}

// ===== Timer =====
function startTimer() {
  clearTimer();
  if (turn !== 'player' || !timerEnabled) return;
  timeLeft = MOVE_TIME_LIMIT;
  timerDisplay.classList.remove('hidden');
  timerDisplay.classList.remove('low');
  if (timeLeft <= 10) timerDisplay.classList.add('low');
  timerDisplay.textContent = `0:${String(timeLeft).padStart(2, '0')}`;
  timerId = setInterval(() => {
    timeLeft--;
    timerDisplay.textContent = `0:${String(timeLeft).padStart(2, '0')}`;
    if (timeLeft <= 10) timerDisplay.classList.add('low');
    if (timeLeft <= 0) {
      clearTimer();
      timeUp();
    }
  }, 1000);
}

function clearTimer() {
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
  }
  timerDisplay.classList.add('hidden');
}

function timeUp() {
  if (turn !== 'player' || animating) return;
  haptic('warning');
  turn = 'ai';
  updateTurnUI();
  timerDisplay.classList.add('hidden');
  draw();
  if (!checkWin()) aiTurn();
}

// ===== Confetti =====
function runConfetti() {
  const c = confettiCanvas;
  if (!c) return;
  c.width = window.innerWidth;
  c.height = window.innerHeight;
  const cx = c.getContext('2d');
  const colors = ['#e94560', '#f5c842', '#2ecc71', '#0f3460', '#ff6b81'];
  const particles = [];
  for (let i = 0; i < 45; i++) {
    particles.push({
      x: Math.random() * c.width,
      y: Math.random() * c.height * 0.5,
      vx: (Math.random() - 0.5) * 4,
      vy: Math.random() * 2 + 2,
      color: colors[Math.floor(Math.random() * colors.length)],
      size: Math.random() * 6 + 4,
    });
  }
  let start = null;
  function step(ts) {
    if (!start) start = ts;
    const dt = (ts - start) / 1000;
    if (dt > 2) {
      c.width = c.width;
      return;
    }
    cx.clearRect(0, 0, c.width, c.height);
    const g = 14;
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += g * 0.016;
      if (p.y > c.height + 20) continue;
      cx.fillStyle = p.color;
      cx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ===== Animation =====
async function animateMove(fromR, fromC, toR, toC, captured) {
  animating = true;
  const piece = board[fromR][fromC];
  const s = cellSize;
  const frames = 8;
  const sx = fromC * s + s / 2, sy = fromR * s + s / 2;
  const ex = toC * s + s / 2, ey = toR * s + s / 2;

  if (captured.length > 0) {
    for (const cap of captured) {
      const capX = cap.c * s + s / 2, capY = cap.r * s + s / 2;
      for (let f = 0; f < 6; f++) {
        draw();
        const r = (f / 6) * s * 0.8;
        ctx.strokeStyle = `rgba(233, 69, 96, ${1 - f / 6})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(capX, capY, r, 0, Math.PI * 2);
        ctx.stroke();
        await sleep(25);
      }
    }
  }

  board[fromR][fromC] = EMPTY;
  captured.forEach(cap => { board[cap.r][cap.c] = EMPTY; });

  for (let i = 1; i <= frames; i++) {
    const t = i / frames;
    draw();
    drawPiece(sx + (ex - sx) * t, sy + (ey - sy) * t, s * 0.38, piece);
    await sleep(18);
  }

  let finalPiece = piece;
  if (isPlayer(piece) && toR === 0) finalPiece = PLAYER_KING;
  if (isAI(piece) && toR === 7) finalPiece = AI_KING;
  board[toR][toC] = finalPiece;

  if (finalPiece !== piece) {
    const kx = toC * s + s / 2, ky = toR * s + s / 2;
    for (let pulse = 0; pulse < 10; pulse++) {
      draw();
      const alpha = 0.4 * (1 - pulse / 10);
      ctx.save();
      ctx.beginPath();
      ctx.arc(kx, ky, s * 0.5 + pulse * 4, 0, Math.PI * 2);
      const grad = ctx.createRadialGradient(kx, ky, 0, kx, ky, s * 0.5 + pulse * 4);
      grad.addColorStop(0, `rgba(245, 200, 66, ${alpha})`);
      grad.addColorStop(1, 'rgba(245, 200, 66, 0)');
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.restore();
      await sleep(22);
    }
    playSound('king');
  }

  if (captured.length > 0) {
    haptic('impact');
    playSound('capture');
  } else if (finalPiece === piece) {
    playSound('move');
  }

  draw();
  animating = false;
  return { piece: finalPiece, capturedCount: captured.length };
}

// ===== Turn & Score =====
function updateTurnUI() {
  if (turn === 'player') {
    turnIndicator.textContent = 'Your Turn';
    turnIndicator.classList.remove('ai-turn');
  } else {
    turnIndicator.textContent = 'AI Thinking...';
    turnIndicator.classList.add('ai-turn');
  }
}

function updateScores(side, count) {
  if (count === 0) return;
  if (side === 'player') {
    playerScore += count;
    playerScoreEl.textContent = playerScore;
  } else {
    aiScore += count;
    aiScoreEl.textContent = aiScore;
  }
}

// ===== Win Check =====
function checkWin() {
  const pp = board.flat().filter(isPlayer).length;
  const ap = board.flat().filter(isAI).length;

  if (ap === 0) { endGame('You Win!', `${playerScore} - ${aiScore}`, true); return true; }
  if (pp === 0) { endGame('AI Wins', `${playerScore} - ${aiScore}`, false); return true; }
  if (turn === 'player' && getAllMoves('player').length === 0) { endGame('AI Wins', 'No moves left.', false); return true; }
  if (turn === 'ai' && getAllMoves('ai').length === 0) { endGame('You Win!', 'AI has no moves.', true); return true; }
  return false;
}

function endGame(title, msg, playerWon) {
  clearTimer();
  recordGameResult(playerWon, playerScore);
  playSound(playerWon ? 'win' : 'lose');
  resultTitle.textContent = title;
  resultMsg.textContent = msg;
  if (playerWon) runConfetti();
  resultOverlay.classList.remove('hidden');

  haptic(playerWon ? 'success' : 'error');

  if (isConnected() && isConfigured()) {
    submitScoreBtn.classList.remove('hidden');
    submitTipBtn.classList.remove('hidden');
  } else {
    submitScoreBtn.classList.add('hidden');
    submitTipBtn.classList.add('hidden');
  }

  const scoreCardBtn = document.getElementById('score-card-btn');
  if (playerWon) {
    if (scoreCardBtn) scoreCardBtn.classList.remove('hidden');
    if (isMiniApp) shareBtn.classList.remove('hidden');
  } else {
    if (scoreCardBtn) scoreCardBtn.classList.add('hidden');
  }
}

// ===== On-chain Score Submission =====
async function handleSubmitScore() {
  txStatus.classList.remove('hidden', 'success', 'error');
  txStatus.textContent = 'Sending transaction...';

  try {
    const hash = await txSubmitScore(playerScore);
    txStatus.classList.add('success');
    txStatus.textContent = `Tx sent! ${hash.slice(0, 10)}...`;
    submitScoreBtn.classList.add('hidden');
    submitTipBtn.classList.add('hidden');
    haptic('success');
    loadOnchainStats(getAddress());
  } catch (e) {
    txStatus.classList.add('error');
    txStatus.textContent = `Error: ${e.message.slice(0, 60)}`;
    haptic('error');
  }
}

// Batch Transaction (EIP-5792): Submit Score + Tip
async function handleSubmitAndTip() {
  txStatus.classList.remove('hidden', 'success', 'error');
  txStatus.textContent = 'Sending batch transaction...';

  try {
    const res = await submitScoreAndTip(playerScore, '0.0001');
    txStatus.classList.add('success');
    txStatus.textContent = res.type === 'batch'
      ? 'Batch tx sent! Score + tip submitted.'
      : `Tx sent! ${String(res.result).slice(0, 10)}...`;
    submitScoreBtn.classList.add('hidden');
    submitTipBtn.classList.add('hidden');
    haptic('success');
    loadOnchainStats(getAddress());
  } catch (e) {
    txStatus.classList.add('error');
    txStatus.textContent = `Error: ${e.message.slice(0, 60)}`;
    haptic('error');
  }
}

// ===== Share =====
async function shareScore() {
  if (!isMiniApp) return;
  try {
    const name = fcUser ? (fcUser.displayName || fcUser.username) : 'I';
    const text = `${name} scored ${playerScore}-${aiScore} in Checkers! Can you beat the AI?`;
    await sdk.actions.openUrl(
      `https://warpcast.com/~/compose?text=${encodeURIComponent(text)}&embeds[]=${encodeURIComponent(window.location.href)}`
    );
  } catch (_) {}
}

// ===== Leaderboard =====
async function showLeaderboard() {
  leaderboardOverlay.classList.remove('hidden');
  lbContent.innerHTML = '<p class="lb-loading">Loading...</p>';
  haptic('selection');

  let html = '';
  const myAddr = getAddress();

  // On-chain leaderboard from Etherscan events
  if (isApiConfigured() && isConfigured()) {
    const leaders = await buildLeaderboard();
    if (leaders && leaders.length > 0) {
      html += '<div class="lb-section-title">On-chain Top Scores</div>';
      leaders.forEach((entry, i) => {
        const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
        const isMe = myAddr && entry.player.toLowerCase() === myAddr.toLowerCase();
        const addr = shortAddr(entry.player);
        html += `<div class="lb-row ${isMe ? 'me' : ''}">
          <span class="lb-rank ${rankClass}">${i + 1}</span>
          <span class="lb-player">${isMe ? 'You' : addr}</span>
          <span class="lb-score">${entry.captured}</span>
        </div>`;
      });
    } else {
      html += '<div class="lb-section-title">On-chain Top Scores</div>';
      html += '<p class="lb-empty">No scores yet. Be the first!</p>';
    }
  } else {
    html += '<p class="lb-empty">Deploy contract & configure Etherscan API to see leaderboard.</p>';
  }

  // Player stats
  if (myAddr && isConfigured()) {
    const stats = await getPlayerStats(myAddr);
    if (stats) {
      html += '<div class="lb-section-title">Your Stats</div>';
      html += `<div class="lb-stat-row"><span class="lb-stat-label">High Score</span><span class="lb-stat-value">${stats.highScore}</span></div>`;
      html += `<div class="lb-stat-row"><span class="lb-stat-label">Games Played</span><span class="lb-stat-value">${stats.games}</span></div>`;
      html += `<div class="lb-stat-row"><span class="lb-stat-label">Total Captures</span><span class="lb-stat-value">${stats.captures}</span></div>`;
    }
  }

  // Wallet balance
  if (myAddr && isApiConfigured()) {
    const balWei = await ethBalance(myAddr);
    if (balWei) {
      html += '<div class="lb-section-title">Wallet</div>';
      html += `<div class="lb-stat-row"><span class="lb-stat-label">Balance</span><span class="lb-stat-value">${weiToEth(balWei)} ETH</span></div>`;
    }
  }

  lbContent.innerHTML = html || '<p class="lb-empty">Nothing to show yet.</p>';
}

// ===== Player Input =====
function cellFromPos(x, y) {
  const rect = canvas.getBoundingClientRect();
  const c = Math.floor((x - rect.left) / cellSize);
  const r = Math.floor((y - rect.top) / cellSize);
  if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return null;
  return { r, c };
}

async function handlePlayerClick(cell) {
  if (animating || turn !== 'player') return;
  initAudio();
  const piece = board[cell.r][cell.c];

  if (selected) {
    const move = validMoves.find(m => m.r === cell.r && m.c === cell.c);
    if (move) {
      haptic('selection');
      const result = await animateMove(selected.r, selected.c, cell.r, cell.c, move.captured);
      updateScores('player', result.capturedCount);

      if (result.capturedCount > 0) {
        const chain = getJumps(cell.r, cell.c, result.piece);
        if (chain.length > 0) {
          selected = { r: cell.r, c: cell.c };
          validMoves = chain;
          draw();
          return;
        }
      }

      selected = null;
      validMoves = [];
      turn = 'ai';
      clearTimer();
      updateTurnUI();
      draw();
      if (!checkWin()) { await sleep(350); await aiTurn(); }
      return;
    }
  }

  if (isPlayer(piece)) {
    const allMoves = getAllMoves('player');
    const hasJumps = allMoves.some(m => m.captured.length > 0);
    let myMoves = getMovesFor(cell.r, cell.c);
    if (hasJumps) {
      myMoves = myMoves.filter(m => m.captured.length > 0);
      if (myMoves.length === 0) { haptic('warning'); selected = null; validMoves = []; draw(); return; }
    }
    if (myMoves.length > 0) {
      haptic('selection');
      selected = { r: cell.r, c: cell.c };
      validMoves = myMoves;
    } else {
      selected = null;
      validMoves = [];
    }
  } else {
    selected = null;
    validMoves = [];
  }
  draw();
}

// ===== AI =====
async function aiTurn() {
  if (turn !== 'ai') return;
  clearTimer();
  let allMoves = getAllMoves('ai');
  if (allMoves.length === 0) { checkWin(); return; }

  let move = getAIMove(allMoves);
  let result = await animateMove(move.from.r, move.from.c, move.r, move.c, move.captured);
  updateScores('ai', result.capturedCount);

  while (result.capturedCount > 0) {
    const chain = getJumps(move.r, move.c, result.piece);
    if (chain.length === 0) break;
    await sleep(200);
    const next = chain[Math.floor(Math.random() * chain.length)];
    result = await animateMove(move.r, move.c, next.r, next.c, next.captured);
    updateScores('ai', result.capturedCount);
    move = { ...next, from: { r: move.r, c: move.c } };
  }

  turn = 'player';
  updateTurnUI();
  draw();
  checkWin();
  if (timerEnabled) startTimer();
}

// ===== Event Listeners =====
canvas.addEventListener('click', (e) => {
  const cell = cellFromPos(e.clientX, e.clientY);
  if (cell) handlePlayerClick(cell);
});

canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  const touch = e.touches[0];
  const cell = cellFromPos(touch.clientX, touch.clientY);
  if (cell) handlePlayerClick(cell);
}, { passive: false });

restartBtn.addEventListener('click', () => { haptic('selection'); init(); });
resultRestartBtn.addEventListener('click', () => { haptic('selection'); init(); });
shareBtn.addEventListener('click', shareScore);
submitScoreBtn.addEventListener('click', handleSubmitScore);
submitTipBtn.addEventListener('click', handleSubmitAndTip);
leaderboardBtn.addEventListener('click', showLeaderboard);
lbClose.addEventListener('click', () => { leaderboardOverlay.classList.add('hidden'); });
leaderboardOverlay.addEventListener('click', (e) => {
  if (e.target === leaderboardOverlay) leaderboardOverlay.classList.add('hidden');
});

const soundToggle = document.getElementById('sound-toggle');
const timerToggle = document.getElementById('timer-toggle');
if (soundToggle) {
  soundToggle.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    saveSetting(STORAGE_KEYS.sound, soundEnabled ? '1' : '0');
    soundToggle.textContent = soundEnabled ? '🔊' : '🔇';
    soundToggle.classList.toggle('muted', !soundEnabled);
    haptic('selection');
  });
  soundToggle.textContent = soundEnabled ? '🔊' : '🔇';
  soundToggle.classList.toggle('muted', !soundEnabled);
}
if (timerToggle) {
  timerToggle.addEventListener('click', () => {
    timerEnabled = !timerEnabled;
    saveSetting(STORAGE_KEYS.timer, timerEnabled ? '1' : '0');
    timerToggle.classList.toggle('active', timerEnabled);
    if (!timerEnabled) clearTimer();
    else if (turn === 'player') startTimer();
    haptic('selection');
  });
  timerToggle.classList.toggle('active', timerEnabled);
}

const themeBtns = document.querySelectorAll('.theme-btn');
themeBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const theme = btn.dataset.theme;
    if (!theme || !THEME_BOARDS[theme]) return;
    themeBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentTheme = theme;
    document.body.dataset.theme = theme;
    saveSetting(STORAGE_KEYS.theme, theme);
    draw();
    haptic('selection');
  });
});
themeBtns.forEach(b => {
  if (b.dataset.theme === currentTheme) b.classList.add('active');
});

function showStatsOverlay() {
  const s = getLocalStats();
  const total = s.wins + s.losses;
  const winRate = total > 0 ? Math.round((s.wins / total) * 100) : 0;
  const avgCaptures = total > 0 ? (s.totalCaptures / total).toFixed(1) : '0';
  const content = document.getElementById('stats-content');
  if (!content) return;
  content.innerHTML = `
    <div class="lb-section-title">Games</div>
    <div class="lb-stat-row"><span class="lb-stat-label">Wins</span><span class="lb-stat-value">${s.wins}</span></div>
    <div class="lb-stat-row"><span class="lb-stat-label">Losses</span><span class="lb-stat-value">${s.losses}</span></div>
    <div class="lb-stat-row"><span class="lb-stat-label">Win rate</span><span class="lb-stat-value">${winRate}%</span></div>
    <div class="lb-section-title">Captures</div>
    <div class="lb-stat-row"><span class="lb-stat-label">Total</span><span class="lb-stat-value">${s.totalCaptures}</span></div>
    <div class="lb-stat-row"><span class="lb-stat-label">Avg per game</span><span class="lb-stat-value">${avgCaptures}</span></div>
    <div class="lb-section-title">Streak</div>
    <div class="lb-stat-row"><span class="lb-stat-label">Current</span><span class="lb-stat-value">${s.currentStreak}</span></div>
    <div class="lb-stat-row"><span class="lb-stat-label">Best</span><span class="lb-stat-value">${s.bestStreak}</span></div>
  `;
  document.getElementById('stats-overlay').classList.remove('hidden');
}

document.getElementById('stats-btn')?.addEventListener('click', () => { haptic('selection'); showStatsOverlay(); });
document.getElementById('stats-close')?.addEventListener('click', () => { document.getElementById('stats-overlay').classList.add('hidden'); });
document.getElementById('stats-overlay')?.addEventListener('click', (e) => {
  if (e.target.id === 'stats-overlay') document.getElementById('stats-overlay').classList.add('hidden');
});

document.getElementById('score-card-btn')?.addEventListener('click', () => shareScoreCard());

diffBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const diff = btn.dataset.diff;
    if (!diff) return;
    diffBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    aiDifficulty = diff;
    haptic('selection');
  });
});

colorBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const color = btn.dataset.color;
    if (!color) return;
    colorBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    playerColor = color;
    haptic('selection');
    init();
  });
});

window.addEventListener('resize', resize);

// ===== Local Storage =====
function loadSettings() {
  try {
    if (localStorage.getItem(STORAGE_KEYS.sound) === '0') soundEnabled = false;
    if (localStorage.getItem(STORAGE_KEYS.timer) === '0') timerEnabled = false;
    const t = localStorage.getItem(STORAGE_KEYS.theme);
    if (t && THEME_BOARDS[t]) {
      currentTheme = t;
      document.body.dataset.theme = t;
    }
  } catch (_) {}
}

function saveSetting(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (_) {}
}

// ===== Local Stats =====
function getLocalStats() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.stats);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return { wins: 0, losses: 0, totalCaptures: 0, currentStreak: 0, bestStreak: 0 };
}

function saveLocalStats(stats) {
  try {
    localStorage.setItem(STORAGE_KEYS.stats, JSON.stringify(stats));
  } catch (_) {}
}

function recordGameResult(playerWon, captures) {
  const s = getLocalStats();
  if (playerWon) {
    s.wins++;
    s.currentStreak++;
    if (s.currentStreak > s.bestStreak) s.bestStreak = s.currentStreak;
  } else {
    s.losses++;
    s.currentStreak = 0;
  }
  s.totalCaptures += captures;
  saveLocalStats(s);
}

// ===== Tutorial =====
const TUTORIAL_SLIDES = [
  { title: 'Welcome to Checkers', text: 'Tap a piece to select it, then tap a highlighted square to move.' },
  { title: 'Captures', text: 'Jump over an enemy piece to capture it. You must capture when possible.' },
  { title: 'Kings', text: 'When a piece reaches the opposite end, it becomes a King and can move both directions.' },
  { title: 'Win', text: 'Capture all enemy pieces or block them so they have no moves. Good luck!' },
];

function showTutorialIfNeeded() {
  try {
    if (localStorage.getItem(STORAGE_KEYS.tutorialDone) === '1') return;
  } catch (_) {}
  const overlay = document.getElementById('tutorial-overlay');
  const titleEl = document.getElementById('tutorial-title');
  const textEl = document.getElementById('tutorial-text');
  const nextBtn = document.getElementById('tutorial-next');
  const startBtn = document.getElementById('tutorial-start');
  const dontShow = document.getElementById('tutorial-dont-show');
  let step = 0;
  function show() {
    if (step >= TUTORIAL_SLIDES.length) {
      overlay.classList.add('hidden');
      if (dontShow?.checked) saveSetting(STORAGE_KEYS.tutorialDone, '1');
      return;
    }
    titleEl.textContent = TUTORIAL_SLIDES[step].title;
    textEl.textContent = TUTORIAL_SLIDES[step].text;
    nextBtn.classList.toggle('hidden', step === TUTORIAL_SLIDES.length - 1);
    startBtn.classList.toggle('hidden', step !== TUTORIAL_SLIDES.length - 1);
  }
  nextBtn.onclick = () => { step++; show(); haptic('selection'); };
  startBtn.onclick = () => { step++; show(); haptic('selection'); };
  overlay.classList.remove('hidden');
  show();
}

// ===== Score Card (Share) =====
function drawScoreCardOnCanvas() {
  if (!scoreCardCanvas) return false;
  const c = scoreCardCanvas;
  const cx = c.getContext('2d');
  const w = c.width, h = c.height;
  cx.fillStyle = '#1a1a2e';
  cx.fillRect(0, 0, w, h);
  cx.strokeStyle = '#f5c842';
  cx.lineWidth = 4;
  cx.strokeRect(8, 8, w - 16, h - 16);
  cx.fillStyle = '#eaeaea';
  cx.font = 'bold 28px sans-serif';
  cx.textAlign = 'center';
  cx.fillText('Checkers', w / 2, 52);
  cx.font = '20px sans-serif';
  cx.fillText('You won ' + playerScore + ' - ' + aiScore, w / 2, 100);
  const name = fcUser ? (fcUser.displayName || fcUser.username) : 'Player';
  cx.font = '16px sans-serif';
  cx.fillStyle = '#8888aa';
  cx.fillText(name, w / 2, 140);
  cx.fillText(new Date().toLocaleDateString(), w / 2, 168);
  cx.fillStyle = '#f5c842';
  cx.font = '14px sans-serif';
  cx.fillText('checkers-ebon.vercel.app', w / 2, 218);
  return true;
}

async function shareScoreCard() {
  if (!scoreCardCanvas) return;
  drawScoreCardOnCanvas();
  const name = fcUser ? (fcUser.displayName || fcUser.username) : 'I';
  const text = name + ' won ' + playerScore + '-' + aiScore + ' in Checkers! Can you beat the AI?';

  try {
    const blob = await new Promise(resolve => scoreCardCanvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('No blob');
    const file = new File([blob], 'checkers-score.png', { type: 'image/png' });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        title: 'Checkers',
        text,
        files: [file],
      });
      haptic('success');
      return;
    }
  } catch (_) {}

  if (isMiniApp) {
    try {
      await sdk.actions.openUrl(
        'https://warpcast.com/~/compose?text=' + encodeURIComponent(text) + '&embeds[]=' + encodeURIComponent(window.location.href)
      );
      haptic('success');
    } catch (_) {}
  }
}

// ===== Boot =====
(async () => {
  loadSettings();
  await initSDK();
  initBlockchain();
  init();
  showTutorialIfNeeded();
})();

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

// ===== State =====
let cellSize, board, selected, validMoves, turn, playerScore, aiScore, animating;
let isMiniApp = false;
let fcUser = null;

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
  playerScoreEl.textContent = '0';
  aiScoreEl.textContent = '0';
  resultOverlay.classList.add('hidden');
  shareBtn.classList.add('hidden');
  submitScoreBtn.classList.add('hidden');
  submitTipBtn.classList.add('hidden');
  txStatus.classList.add('hidden');
  updateTurnUI();
  resize();
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

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      ctx.fillStyle = (r + c) % 2 === 1 ? '#16213e' : '#0f3460';
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
  if (isPlayer(piece)) {
    grad.addColorStop(0, '#ff6b81');
    grad.addColorStop(1, '#c0392b');
  } else {
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(1, '#b0b0b0');
  }
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = isPlayer(piece) ? '#8e1a2a' : '#888';
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

// ===== Animation =====
async function animateMove(fromR, fromC, toR, toC, captured) {
  animating = true;
  const piece = board[fromR][fromC];
  const s = cellSize;
  const frames = 8;
  const sx = fromC * s + s / 2, sy = fromR * s + s / 2;
  const ex = toC * s + s / 2, ey = toR * s + s / 2;

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

  if (captured.length > 0) haptic('impact');

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
  resultTitle.textContent = title;
  resultMsg.textContent = msg;
  resultOverlay.classList.remove('hidden');

  haptic(playerWon ? 'success' : 'error');

  // Show blockchain buttons if wallet connected and contract configured
  if (isConnected() && isConfigured()) {
    submitScoreBtn.classList.remove('hidden');
    submitTipBtn.classList.remove('hidden');
  }

  if (playerWon && isMiniApp) {
    shareBtn.classList.remove('hidden');
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
    const text = `${name} scored ${playerScore}-${aiScore} in Base Dama! Can you beat the AI?`;
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
  let allMoves = getAllMoves('ai');
  if (allMoves.length === 0) { checkWin(); return; }

  let move = pickAIMove(allMoves);
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
}

function pickAIMove(moves) {
  const jumps = moves.filter(m => m.captured.length > 0);
  if (jumps.length > 0) return jumps[Math.floor(Math.random() * jumps.length)];
  const forward = moves.filter(m => m.r > m.from.r);
  if (forward.length > 0 && Math.random() > 0.3) return forward[Math.floor(Math.random() * forward.length)];
  return moves[Math.floor(Math.random() * moves.length)];
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
window.addEventListener('resize', resize);

// ===== Boot =====
(async () => {
  await initSDK();
  initBlockchain();
  init();
})();

import {
  encodeFunctionData,
  parseAbi,
  parseEther,
  decodeEventLog,
} from 'https://esm.sh/viem@2';
import {
  getPublicClient,
  getWalletClient,
  getAddress,
  getChain,
} from './wallet.js';

// ========== CONFIG ==========
// Deploy ettikten sonra contract adresini buraya yaz
export const CONTRACT_ADDRESS = '0x87ea2144fbb25759a23d489e5655e73bd7899d0a';
// Tip almak istersen kendi adresini yaz
const DEV_ADDRESS = '0xBFbD06913A61235B47393AB4e668dC3E1b2a03aA';
// ============================

export const CONTRACT_ABI = parseAbi([
  'function submitScore(uint256 captured) external',
  'function highScores(address) external view returns (uint256)',
  'function gamesPlayed(address) external view returns (uint256)',
  'function totalCaptures(address) external view returns (uint256)',
  'function getPlayerStats(address player) external view returns (uint256 highScore, uint256 games, uint256 captures)',
  'event ScoreSubmitted(address indexed player, uint256 captured, uint256 timestamp)',
  'event NewHighScore(address indexed player, uint256 captured)',
]);

function isConfigured() {
  return CONTRACT_ADDRESS !== '0x0000000000000000000000000000000000000000';
}

// --- Single Transaction: Submit Score ---
export async function submitScore(captured) {
  if (!isConfigured()) throw new Error('Contract not configured');
  const wc = getWalletClient();
  const addr = getAddress();
  if (!wc || !addr) throw new Error('Wallet not connected');

  const hash = await wc.sendTransaction({
    to: CONTRACT_ADDRESS,
    data: encodeFunctionData({
      abi: CONTRACT_ABI,
      functionName: 'submitScore',
      args: [BigInt(captured)],
    }),
    account: addr,
  });

  return hash;
}

// --- Batch Transaction (EIP-5792): Submit Score + Tip Dev ---
export async function submitScoreAndTip(captured, tipEth = '0.0001') {
  if (!isConfigured()) throw new Error('Contract not configured');
  const wc = getWalletClient();
  const addr = getAddress();
  const chain = getChain();
  if (!wc || !addr) throw new Error('Wallet not connected');

  const scoreData = encodeFunctionData({
    abi: CONTRACT_ABI,
    functionName: 'submitScore',
    args: [BigInt(captured)],
  });

  try {
    const result = await wc.request({
      method: 'wallet_sendCalls',
      params: [{
        version: '1.0',
        chainId: `0x${chain.id.toString(16)}`,
        from: addr,
        calls: [
          {
            to: CONTRACT_ADDRESS,
            data: scoreData,
          },
          {
            to: DEV_ADDRESS,
            value: `0x${parseEther(tipEth).toString(16)}`,
          },
        ],
      }],
    });
    return { type: 'batch', result };
  } catch (e) {
    console.warn('Batch tx failed, falling back to single tx:', e.message);
    const hash = await submitScore(captured);
    return { type: 'single', result: hash };
  }
}

// --- Read: Player Stats ---
export async function getPlayerStats(playerAddress) {
  if (!isConfigured()) return null;
  const pc = getPublicClient();
  if (!pc) return null;

  try {
    const data = await pc.readContract({
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI,
      functionName: 'getPlayerStats',
      args: [playerAddress],
    });
    return {
      highScore: Number(data[0]),
      games: Number(data[1]),
      captures: Number(data[2]),
    };
  } catch (e) {
    console.warn('getPlayerStats failed:', e.message);
    return null;
  }
}

// --- Read: Single High Score ---
export async function getHighScore(playerAddress) {
  if (!isConfigured()) return 0;
  const pc = getPublicClient();
  if (!pc) return 0;

  try {
    const score = await pc.readContract({
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI,
      functionName: 'highScores',
      args: [playerAddress],
    });
    return Number(score);
  } catch {
    return 0;
  }
}

// --- Decode ScoreSubmitted event log ---
export function decodeScoreEvent(log) {
  try {
    return decodeEventLog({
      abi: CONTRACT_ABI,
      data: log.data,
      topics: log.topics,
    });
  } catch {
    return null;
  }
}

export { isConfigured };

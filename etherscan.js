import { keccak256, toBytes, formatEther } from 'https://esm.sh/viem@2';
import { CONTRACT_ADDRESS, decodeScoreEvent } from './contract.js';

// ========== CONFIG ==========
// Etherscan API V2 - tek API key tüm chainlerde çalışır
const API_KEY = '8HIB9IQ9ZUIJJBE452V2G4P6J92988X3M8';
const USE_TESTNET = true;
// ============================

const ETHERSCAN_V2 = 'https://api.etherscan.io/v2/api';

const CHAIN_IDS = {
  base: 8453,
  baseSepolia: 84532,
};

const CHAIN_ID = USE_TESTNET ? CHAIN_IDS.baseSepolia : CHAIN_IDS.base;

// ScoreSubmitted(address,uint256,uint256) event topic
const SCORE_EVENT_TOPIC = keccak256(
  toBytes('ScoreSubmitted(address,uint256,uint256)')
);

async function ethRequest(params) {
  if (API_KEY === '[YOUR_ETHERSCAN_API_KEY]') return null;

  const url = new URL(ETHERSCAN_V2);
  url.searchParams.append('chainid', String(CHAIN_ID));
  url.searchParams.append('apikey', API_KEY);

  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.append(key, String(value));
  });

  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.status === '0' && data.message === 'NOTOK') {
      throw new Error(data.result);
    }
    return data.result;
  } catch (e) {
    console.warn('Etherscan API error:', e.message);
    return null;
  }
}

// --- Account Balance ---
export async function getBalance(address) {
  return ethRequest({
    module: 'account',
    action: 'balance',
    address,
    tag: 'latest',
  });
}

// --- Token Portfolio ---
export async function getTokenPortfolio(address) {
  return ethRequest({
    module: 'account',
    action: 'addresstokenbalance',
    address,
    page: 1,
    offset: 10,
  });
}

// --- Player Transaction History ---
export async function getPlayerTxHistory(address) {
  return ethRequest({
    module: 'account',
    action: 'txlist',
    address,
    sort: 'desc',
    page: 1,
    offset: 20,
  });
}

// --- Contract Event Logs (ScoreSubmitted) ---
export async function getScoreEvents() {
  if (CONTRACT_ADDRESS === '0x0000000000000000000000000000000000000000') {
    return null;
  }

  return ethRequest({
    module: 'logs',
    action: 'getLogs',
    address: CONTRACT_ADDRESS,
    topic0: SCORE_EVENT_TOPIC,
    fromBlock: '0',
    toBlock: 'latest',
  });
}

// --- Build Leaderboard from On-chain Events ---
export async function buildLeaderboard() {
  const logs = await getScoreEvents();
  if (!logs || !Array.isArray(logs) || logs.length === 0) return [];

  const best = {};

  for (const log of logs) {
    const decoded = decodeScoreEvent(log);
    if (!decoded) continue;

    const player = decoded.args.player.toLowerCase();
    const captured = Number(decoded.args.captured);
    const ts = Number(decoded.args.timestamp);

    if (!best[player] || captured > best[player].captured) {
      best[player] = { player: decoded.args.player, captured, timestamp: ts };
    }
  }

  return Object.values(best)
    .sort((a, b) => b.captured - a.captured)
    .slice(0, 10);
}

// --- Verify Contract Source on Etherscan ---
export async function getContractInfo() {
  if (CONTRACT_ADDRESS === '0x0000000000000000000000000000000000000000') {
    return null;
  }
  return ethRequest({
    module: 'contract',
    action: 'getsourcecode',
    address: CONTRACT_ADDRESS,
  });
}

// --- Format Wei to ETH ---
export function weiToEth(wei) {
  try {
    return parseFloat(formatEther(BigInt(wei))).toFixed(4);
  } catch {
    return '0';
  }
}

export function isApiConfigured() {
  return API_KEY !== '[YOUR_ETHERSCAN_API_KEY]';
}

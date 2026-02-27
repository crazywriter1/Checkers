import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  formatEther,
} from 'https://esm.sh/viem@2';
import { baseSepolia, base } from 'https://esm.sh/viem@2/chains';
import { sdk } from 'https://esm.sh/@farcaster/miniapp-sdk';

// true = Base Sepolia (testnet), false = Base (mainnet)
const USE_TESTNET = false;
const CHAIN = USE_TESTNET ? baseSepolia : base;

let publicClient = null;
let walletClient = null;
let userAddress = null;
let walletConnected = false;

export async function initWallet() {
  publicClient = createPublicClient({
    chain: CHAIN,
    transport: http(),
  });

  try {
    const provider = sdk.wallet.ethProvider;
    if (!provider) throw new Error('No Farcaster wallet provider');

    walletClient = createWalletClient({
      chain: CHAIN,
      transport: custom(provider),
    });

    const addresses = await walletClient.requestAddresses();
    if (addresses && addresses.length > 0) {
      userAddress = addresses[0];
      walletConnected = true;
    }
  } catch (e) {
    console.warn('Wallet init:', e.message);
    walletConnected = false;
  }

  return { address: userAddress, connected: walletConnected };
}

export function getPublicClient() { return publicClient; }
export function getWalletClient() { return walletClient; }
export function getAddress() { return userAddress; }
export function isConnected() { return walletConnected; }
export function getChain() { return CHAIN; }

export function shortAddr(addr) {
  if (!addr) return '';
  return addr.slice(0, 6) + '\u2026' + addr.slice(-4);
}

export async function getBalance() {
  if (!publicClient || !userAddress) return '0';
  try {
    const bal = await publicClient.getBalance({ address: userAddress });
    return formatEther(bal);
  } catch {
    return '0';
  }
}

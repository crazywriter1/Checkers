import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  formatEther,
} from 'https://esm.sh/viem@2';
import { baseSepolia, base } from 'https://esm.sh/viem@2/chains';
import { sdk } from 'https://esm.sh/@farcaster/miniapp-sdk@0.3.0';

// true = Base Sepolia (testnet), false = Base (mainnet)
const USE_TESTNET = false;
const CHAIN = USE_TESTNET ? baseSepolia : base;

let publicClient = null;
let walletClient = null;
let ethProvider = null;
let userAddress = null;
let walletConnected = false;

function getInjectedProvider() {
  if (typeof window === 'undefined') return null;
  if (window.ethereum) return window.ethereum;
  if (window.coinbaseWalletExtension) return window.coinbaseWalletExtension;
  return null;
}

async function resolveEthereumProvider() {
  try {
    await sdk.actions.ready();
  } catch (_) {}

  try {
    const fcProvider = await sdk.wallet.getEthereumProvider();
    if (fcProvider) return fcProvider;
  } catch (_) {}

  try {
    if (sdk.wallet?.ethProvider) return sdk.wallet.ethProvider;
  } catch (_) {}

  return getInjectedProvider();
}

async function ensureBaseChain(provider) {
  const targetChainId = `0x${CHAIN.id.toString(16)}`;

  let currentChainId;
  try {
    currentChainId = await provider.request({ method: 'eth_chainId' });
  } catch (_) {
    return;
  }

  if (currentChainId?.toLowerCase() === targetChainId.toLowerCase()) return;

  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: targetChainId }],
    });
    return;
  } catch (e) {
    const needsAdd =
      e?.code === 4902 ||
      String(e?.message || '').toLowerCase().includes('unrecognized');
    if (!needsAdd) throw e;
  }

  const rpcUrl = CHAIN.rpcUrls?.default?.http?.[0];
  const explorer = CHAIN.blockExplorers?.default?.url;

  await provider.request({
    method: 'wallet_addEthereumChain',
    params: [{
      chainId: targetChainId,
      chainName: CHAIN.name,
      nativeCurrency: CHAIN.nativeCurrency,
      rpcUrls: rpcUrl ? [rpcUrl] : [],
      blockExplorerUrls: explorer ? [explorer] : [],
    }],
  });
}

async function connectWithProvider(provider) {
  ethProvider = provider;

  walletClient = createWalletClient({
    chain: CHAIN,
    transport: custom(provider),
  });

  await ensureBaseChain(provider);

  const addresses = await walletClient.requestAddresses();
  if (addresses?.length > 0) {
    userAddress = addresses[0];
    walletConnected = true;
    return true;
  }

  userAddress = null;
  walletConnected = false;
  return false;
}

export async function initWallet() {
  publicClient = createPublicClient({
    chain: CHAIN,
    transport: http(),
  });

  walletClient = null;
  ethProvider = null;
  userAddress = null;
  walletConnected = false;

  try {
    const provider = await resolveEthereumProvider();
    if (!provider) throw new Error('No Ethereum provider');

    await connectWithProvider(provider);
  } catch (e) {
    console.warn('Wallet init:', e.message);
    walletConnected = false;
  }

  return { address: userAddress, connected: walletConnected };
}

export function getPublicClient() { return publicClient; }
export function getWalletClient() { return walletClient; }
export function getEthereumProvider() { return ethProvider; }
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

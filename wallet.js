import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  formatEther,
} from 'https://esm.sh/viem@2';
import { baseSepolia, base } from 'https://esm.sh/viem@2/chains';
import { sdk } from 'https://esm.sh/@farcaster/miniapp-sdk@0.3.0';

const APP_NAME = 'Checkers';
const APP_LOGO = 'https://checkers-ebon.vercel.app/icon.png';
const BASE_ACCOUNT_SCRIPT =
  'https://unpkg.com/@base-org/account/dist/base-account.min.js';

// true = Base Sepolia (testnet), false = Base (mainnet)
const USE_TESTNET = false;
const CHAIN = USE_TESTNET ? baseSepolia : base;

let publicClient = null;
let walletClient = null;
let ethProvider = null;
let userAddress = null;
let walletConnected = false;

function isBaseAppBrowser() {
  if (typeof navigator === 'undefined') return false;
  const ua = (navigator.userAgent || '').toLowerCase();
  if (/baseapp|base\/|basewallet|coinbasewallet|coinbase.*mobile/.test(ua)) return true;
  try {
    const ref = document.referrer || '';
    if (/base\.app|base\.org/i.test(ref)) return true;
  } catch (_) {}
  return false;
}

function getInjectedProvider() {
  if (typeof window === 'undefined') return null;
  if (window.ethereum) return window.ethereum;
  if (window.coinbaseWalletExtension) return window.coinbaseWalletExtension;
  return null;
}

function loadBaseAccountScript() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.createBaseAccountSDK) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${BASE_ACCOUNT_SCRIPT}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Base SDK load failed')), {
        once: true,
      });
      if (window.createBaseAccountSDK) resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = BASE_ACCOUNT_SCRIPT;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Base SDK load failed'));
    document.head.appendChild(script);
  });
}

async function getBaseAccountProvider() {
  try {
    await loadBaseAccountScript();
  } catch (e) {
    console.warn('Base Account SDK:', e.message);
    return null;
  }

  if (!window.createBaseAccountSDK) return null;

  try {
    const baseSdk = window.createBaseAccountSDK({
      appName: APP_NAME,
      appLogoUrl: APP_LOGO,
      appChainIds: [CHAIN.id],
    });
    return baseSdk.getProvider();
  } catch (e) {
    console.warn('Base Account init:', e.message);
    return null;
  }
}

async function getFarcasterProvider() {
  try {
    await Promise.race([
      sdk.actions.ready(),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
  } catch (_) {}

  try {
    const provider = await sdk.wallet.getEthereumProvider();
    if (provider) return provider;
  } catch (_) {}

  try {
    if (sdk.wallet?.ethProvider) return sdk.wallet.ethProvider;
  } catch (_) {}

  return null;
}

async function resolveEthereumProvider() {
  const inBaseApp = isBaseAppBrowser();

  if (inBaseApp) {
    const baseProvider = await getBaseAccountProvider();
    if (baseProvider) return baseProvider;
  }

  const fcProvider = await getFarcasterProvider();
  if (fcProvider) return fcProvider;

  if (!inBaseApp) {
    const baseProvider = await getBaseAccountProvider();
    if (baseProvider) return baseProvider;
  }

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

async function requestAccountsFromProvider(provider, walletClient) {
  try {
    const addresses = await walletClient.requestAddresses();
    if (addresses?.length) return addresses;
  } catch (_) {}

  try {
    const accounts = await provider.request({ method: 'eth_requestAccounts' });
    if (accounts?.length) return accounts;
  } catch (_) {}

  try {
    const nonce = crypto.randomUUID().replace(/-/g, '');
    const res = await provider.request({
      method: 'wallet_connect',
      params: [{
        version: '1',
        capabilities: {
          signInWithEthereum: {
            nonce,
            chainId: `0x${CHAIN.id.toString(16)}`,
          },
        },
      }],
    });

    const list = res?.accounts ?? res;
    if (!Array.isArray(list) || !list.length) return [];

    const first = list[0];
    if (typeof first === 'string') return [first];
    if (first?.address) return [first.address];
  } catch (e) {
    console.warn('wallet_connect:', e.message);
  }

  return [];
}

async function connectWithProvider(provider) {
  ethProvider = provider;

  walletClient = createWalletClient({
    chain: CHAIN,
    transport: custom(provider),
  });

  await ensureBaseChain(provider);

  const addresses = await requestAccountsFromProvider(provider, walletClient);
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

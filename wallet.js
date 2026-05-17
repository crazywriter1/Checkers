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
  'https://cdn.jsdelivr.net/npm/@base-org/account/dist/base-account.min.js';

const USE_TESTNET = false;
const CHAIN = USE_TESTNET ? baseSepolia : base;
const CHAIN_ID_HEX = `0x${CHAIN.id.toString(16)}`;

let publicClient = null;
let walletClient = null;
let ethProvider = null;
let userAddress = null;
let walletConnected = false;
let lastConnectError = '';

function getInjectedProvider() {
  if (typeof window === 'undefined') return null;
  if (window.ethereum) return window.ethereum;
  if (window.coinbaseWalletExtension) return window.coinbaseWalletExtension;
  return null;
}

function discoverEip6963Providers(timeoutMs = 400) {
  if (typeof window === 'undefined') return Promise.resolve([]);

  return new Promise((resolve) => {
    const found = [];
    const seen = new Set();

    const onAnnounce = (event) => {
      const { provider, info } = event.detail || {};
      if (!provider || seen.has(provider)) return;
      seen.add(provider);
      found.push({
        provider,
        label: info?.name || info?.rdns || 'injected',
        rdns: info?.rdns || '',
      });
    };

    window.addEventListener('eip6963:announceProvider', onAnnounce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));

    setTimeout(() => {
      window.removeEventListener('eip6963:announceProvider', onAnnounce);
      resolve(found);
    }, timeoutMs);
  });
}

function loadBaseAccountScript() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.createBaseAccountSDK) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-base-account-sdk]`);
    if (existing) {
      if (window.createBaseAccountSDK) return resolve();
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Base SDK load failed')), {
        once: true,
      });
      return;
    }

    const script = document.createElement('script');
    script.src = BASE_ACCOUNT_SCRIPT;
    script.async = true;
    script.dataset.baseAccountSdk = '1';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Base SDK load failed'));
    document.head.appendChild(script);
  });
}

async function createBaseAccountProvider() {
  let createFn = typeof window !== 'undefined' ? window.createBaseAccountSDK : null;

  if (!createFn) {
    try {
      await loadBaseAccountScript();
      createFn = window.createBaseAccountSDK;
    } catch (_) {}
  }

  if (!createFn) {
    try {
      const mod = await import('https://esm.sh/@base-org/account@2.5.1');
      createFn = mod.createBaseAccountSDK;
    } catch (_) {}
  }

  if (!createFn) return null;

  try {
    const baseSdk = createFn({
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
    const quick = await sdk.wallet.getEthereumProvider();
    if (quick) return quick;
  } catch (_) {}

  try {
    if (sdk.wallet?.ethProvider) return sdk.wallet.ethProvider;
  } catch (_) {}

  try {
    await Promise.race([
      sdk.actions.ready(),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
    const provider = await sdk.wallet.getEthereumProvider();
    if (provider) return provider;
  } catch (_) {}

  return null;
}

async function collectProviders() {
  const list = [];
  const seen = new Set();

  const add = (provider, label) => {
    if (!provider || seen.has(provider)) return;
    seen.add(provider);
    list.push({ provider, label });
  };

  const eip6963 = await discoverEip6963Providers();
  for (const entry of eip6963) {
    add(entry.provider, entry.label);
  }

  add(await getFarcasterProvider(), 'farcaster');
  add(await createBaseAccountProvider(), 'base-account');
  add(getInjectedProvider(), 'injected');

  return list;
}

async function ensureBaseChain(provider) {
  const targetChainId = CHAIN_ID_HEX;

  let currentChainId;
  try {
    currentChainId = await provider.request({ method: 'eth_chainId' });
  } catch {
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
    if (!needsAdd) return;
  }

  const rpcUrl = CHAIN.rpcUrls?.default?.http?.[0];
  const explorer = CHAIN.blockExplorers?.default?.url;

  try {
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
  } catch (_) {}
}

function parseAccountsResult(res) {
  const list = res?.accounts ?? res;
  if (!Array.isArray(list) || !list.length) return [];

  const first = list[0];
  if (typeof first === 'string') return [first];
  if (first?.address) return [first.address];
  return [];
}

async function requestAccountsFromProvider(provider) {
  try {
    const cached = await provider.request({ method: 'eth_accounts' });
    if (cached?.length) return cached;
  } catch (_) {}

  try {
    const accounts = await provider.request({ method: 'eth_requestAccounts' });
    if (accounts?.length) return accounts;
  } catch (e) {
    lastConnectError = e?.message || String(e);
  }

  try {
    const nonce = crypto.randomUUID().replace(/-/g, '');
    const res = await provider.request({
      method: 'wallet_connect',
      params: [{
        version: '1',
        capabilities: {
          signInWithEthereum: {
            nonce,
            chainId: CHAIN_ID_HEX,
          },
        },
      }],
    });
    const parsed = parseAccountsResult(res);
    if (parsed.length) return parsed;
  } catch (e) {
    lastConnectError = e?.message || String(e);
  }

  try {
    const wc = createWalletClient({ chain: CHAIN, transport: custom(provider) });
    const addresses = await wc.requestAddresses();
    if (addresses?.length) return addresses;
  } catch (e) {
    lastConnectError = e?.message || String(e);
  }

  return [];
}

async function connectWithProvider(provider) {
  const addresses = await requestAccountsFromProvider(provider);
  if (!addresses?.length) return false;

  ethProvider = provider;
  userAddress = addresses[0];
  walletConnected = true;

  walletClient = createWalletClient({
    chain: CHAIN,
    account: userAddress,
    transport: custom(provider),
  });

  try {
    await ensureBaseChain(provider);
  } catch (_) {}

  return true;
}

async function tryAllProviders() {
  lastConnectError = '';
  const providers = await collectProviders();

  if (!providers.length) {
    lastConnectError = 'No wallet provider found';
    return false;
  }

  for (const { provider, label } of providers) {
    try {
      const ok = await connectWithProvider(provider);
      if (ok) {
        console.info('Wallet connected via', label);
        return true;
      }
    } catch (e) {
      lastConnectError = e?.message || String(e);
      console.warn(`Wallet (${label}):`, lastConnectError);
    }
  }

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

  const ok = await tryAllProviders();
  if (!ok) {
    console.warn('Wallet init failed:', lastConnectError || 'unknown');
  }

  return { address: userAddress, connected: walletConnected, error: lastConnectError };
}

/** User gesture (tap) — required in Base app webview */
export async function connectWallet() {
  walletClient = null;
  ethProvider = null;
  userAddress = null;
  walletConnected = false;

  const ok = await tryAllProviders();
  return { address: userAddress, connected: ok, error: lastConnectError };
}

export function getPublicClient() { return publicClient; }
export function getWalletClient() { return walletClient; }
export function getEthereumProvider() { return ethProvider; }
export function getAddress() { return userAddress; }
export function isConnected() { return walletConnected; }
export function getChain() { return CHAIN; }
export function getConnectError() { return lastConnectError; }

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

import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  formatEther,
  getAddress as toChecksumAddress,
} from 'https://esm.sh/viem@2';
import { baseSepolia, base } from 'https://esm.sh/viem@2/chains';
import { sdk } from 'https://esm.sh/@farcaster/miniapp-sdk@0.3.0';

const BASE_RPC_URLS = [
  'https://mainnet.base.org',
  'https://base.llamarpc.com',
];

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
let connectInFlight = false;

function withTimeout(promise, ms, message = 'Timed out') {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

function getInjectedProvider() {
  if (typeof window === 'undefined') return null;
  if (window.ethereum) return window.ethereum;
  if (window.coinbaseWalletExtension) return window.coinbaseWalletExtension;
  return null;
}

function discoverEip6963Providers(timeoutMs = 300) {
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

  return withTimeout(
    new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-base-account-sdk]');
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
    }),
    5000,
    'Base SDK load timeout',
  );
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
      const mod = await withTimeout(
        import('https://esm.sh/@base-org/account@2.5.1'),
        5000,
        'Base SDK import timeout',
      );
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
    const quick = await withTimeout(
      sdk.wallet.getEthereumProvider(),
      2000,
      'fc provider timeout',
    );
    if (quick) return quick;
  } catch (_) {}

  try {
    if (sdk.wallet?.ethProvider) return sdk.wallet.ethProvider;
  } catch (_) {}

  return null;
}

function providerPriority(label, rdns = '') {
  const key = `${label} ${rdns}`.toLowerCase();
  if (label === 'base-account') return 0;
  if (label === 'injected') return 1;
  if (/coinbase|base/.test(key)) return 2;
  if (label === 'farcaster') return 8;
  return 4;
}

async function collectProviders(userInitiated = false) {
  const list = [];
  const seen = new Set();

  const add = (provider, label, rdns = '') => {
    if (!provider || seen.has(provider)) return;
    seen.add(provider);
    list.push({ provider, label, rdns });
  };

  const baseProvider = await createBaseAccountProvider();
  add(baseProvider, 'base-account');
  add(getInjectedProvider(), 'injected');

  const eip6963 = await discoverEip6963Providers();
  for (const entry of eip6963) {
    add(entry.provider, entry.label, entry.rdns);
  }

  if (!userInitiated) {
    add(await getFarcasterProvider(), 'farcaster');
  } else {
  // User tap: Farcaster last — often hangs in Base app
    const fc = await getFarcasterProvider();
    add(fc, 'farcaster');
  }

  list.sort((a, b) => providerPriority(a.label, a.rdns) - providerPriority(b.label, b.rdns));

  return userInitiated ? list.slice(0, 5) : list;
}

async function providerRequest(provider, request, timeoutMs) {
  return withTimeout(provider.request(request), timeoutMs, `${request.method} timed out`);
}

async function ensureBaseChain(provider) {
  const targetChainId = CHAIN_ID_HEX;

  let currentChainId;
  try {
    currentChainId = await providerRequest(
      provider,
      { method: 'eth_chainId' },
      3000,
    );
  } catch {
    return;
  }

  if (currentChainId?.toLowerCase() === targetChainId.toLowerCase()) return;

  try {
    await providerRequest(
      provider,
      { method: 'wallet_switchEthereumChain', params: [{ chainId: targetChainId }] },
      5000,
    );
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
    await providerRequest(
      provider,
      {
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: targetChainId,
          chainName: CHAIN.name,
          nativeCurrency: CHAIN.nativeCurrency,
          rpcUrls: rpcUrl ? [rpcUrl] : [],
          blockExplorerUrls: explorer ? [explorer] : [],
        }],
      },
      5000,
    );
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

async function requestAccountsFromProvider(provider, userInitiated) {
  const quickMs = userInitiated ? 4000 : 2000;
  const slowMs = userInitiated ? 12000 : 3000;

  try {
    const cached = await providerRequest(
      provider,
      { method: 'eth_accounts' },
      quickMs,
    );
    if (cached?.length) return cached;
  } catch (e) {
    lastConnectError = e?.message || String(e);
  }

  if (!userInitiated) return [];

  try {
    const accounts = await providerRequest(
      provider,
      { method: 'eth_requestAccounts' },
      slowMs,
    );
    if (accounts?.length) return accounts;
  } catch (e) {
    lastConnectError = e?.message || String(e);
  }

  if (provider.request) {
    try {
      const nonce = crypto.randomUUID().replace(/-/g, '');
      const res = await providerRequest(
        provider,
        {
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
        },
        slowMs,
      );
      const parsed = parseAccountsResult(res);
      if (parsed.length) return parsed;
    } catch (e) {
      lastConnectError = e?.message || String(e);
    }
  }

  return [];
}

async function connectWithProvider(provider, userInitiated) {
  const addresses = await requestAccountsFromProvider(provider, userInitiated);
  if (!addresses?.length) return false;

  ethProvider = provider;
  try {
    userAddress = toChecksumAddress(addresses[0]);
  } catch {
    userAddress = addresses[0];
  }
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

async function tryAllProviders(userInitiated = false) {
  if (connectInFlight) {
    return walletConnected;
  }
  connectInFlight = true;
  lastConnectError = '';

  try {
    const providers = await collectProviders(userInitiated);

    if (!providers.length) {
      lastConnectError = 'No wallet provider found';
      return false;
    }

    const perProviderMs = userInitiated ? 14000 : 4000;

    for (const { provider, label } of providers) {
      try {
        const ok = await withTimeout(
          connectWithProvider(provider, userInitiated),
          perProviderMs,
          `${label} timed out`,
        );
        if (ok) {
          console.info('Wallet connected via', label);
          return true;
        }
      } catch (e) {
        lastConnectError = e?.message || String(e);
        console.warn(`Wallet (${label}):`, lastConnectError);
      }
    }

    if (!lastConnectError) {
      lastConnectError = userInitiated
        ? 'Wallet did not respond — approve in Base if prompted'
        : 'Not connected';
    }
    return false;
  } finally {
    connectInFlight = false;
  }
}

export async function initWallet() {
  publicClient = createPublicClient({
    chain: CHAIN,
    transport: http(BASE_RPC_URLS[0]),
  });

  if (walletConnected && userAddress) {
    return { address: userAddress, connected: true, error: '' };
  }

  walletClient = null;
  ethProvider = null;
  userAddress = null;
  walletConnected = false;

  const ok = await tryAllProviders(false);
  if (!ok) {
    console.warn('Wallet init failed:', lastConnectError || 'unknown');
  }

  return { address: userAddress, connected: walletConnected, error: lastConnectError };
}

export async function connectWallet() {
  if (connectInFlight) {
    return { address: userAddress, connected: walletConnected, error: lastConnectError };
  }

  walletClient = null;
  ethProvider = null;
  userAddress = null;
  walletConnected = false;

  try {
    const ok = await withTimeout(
      tryAllProviders(true),
      28000,
      'Connection timed out — try again',
    );
    return { address: userAddress, connected: ok, error: lastConnectError };
  } catch (e) {
    lastConnectError = e?.message || String(e);
    return { address: null, connected: false, error: lastConnectError };
  }
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

export function formatBalanceDisplay(ethStr) {
  const n = Number(ethStr);
  if (!Number.isFinite(n) || n === 0) return '0 ETH';
  if (n < 0.0001) return '<0.0001 ETH';
  return `${n.toFixed(4)} ETH`;
}

export async function getBalance() {
  if (!userAddress) return '0';

  let addr;
  try {
    addr = toChecksumAddress(userAddress);
  } catch {
    return '0';
  }

  if (ethProvider?.request) {
    try {
      const hex = await withTimeout(
        ethProvider.request({ method: 'eth_getBalance', params: [addr, 'latest'] }),
        8000,
        'provider balance timeout',
      );
      return formatEther(BigInt(hex));
    } catch (e) {
      console.warn('Provider balance:', e.message);
    }
  }

  if (publicClient) {
    try {
      const bal = await withTimeout(
        publicClient.getBalance({ address: addr }),
        8000,
        'viem balance timeout',
      );
      return formatEther(bal);
    } catch (e) {
      console.warn('Public client balance:', e.message);
    }
  }

  for (const rpcUrl of BASE_RPC_URLS) {
    try {
      const client = createPublicClient({ chain: CHAIN, transport: http(rpcUrl) });
      const bal = await withTimeout(
        client.getBalance({ address: addr }),
        8000,
        'rpc balance timeout',
      );
      return formatEther(bal);
    } catch (_) {}
  }

  try {
    const { getBalance: fetchBalanceFromApi } = await import('./etherscan.js');
    const wei = await fetchBalanceFromApi(addr);
    if (wei != null && wei !== '') {
      return formatEther(BigInt(wei));
    }
  } catch (e) {
    console.warn('API balance:', e.message);
  }

  return '0';
}

import solc from 'solc';
import { createPublicClient, createWalletClient, http, defineChain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { readFileSync } from 'fs';

// ========== CONFIG ==========
const PRIVATE_KEY = process.env.PRIVATE_KEY || '0x_PRIVATE_KEY_BURAYA';
// ============================

if (PRIVATE_KEY === '0x_PRIVATE_KEY_BURAYA') {
  console.log('\n=== DEPLOY ADIMLARI ===\n');
  console.log('1. Base mainnet cuzdaninda ETH oldugundan emin ol\n');
  console.log('2. Deploy et:');
  console.log('   $env:PRIVATE_KEY="0xSENIN_PRIVATE_KEY"');
  console.log('   node deploy.js\n');
  process.exit(0);
}

console.log('Compiling CheckersScore.sol...');

const source = readFileSync('./contracts/src/CheckersScore.sol', 'utf8');

const input = JSON.stringify({
  language: 'Solidity',
  sources: { 'CheckersScore.sol': { content: source } },
  settings: {
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    optimizer: { enabled: true, runs: 200 },
  },
});

const output = JSON.parse(solc.compile(input));

if (output.errors) {
  const errors = output.errors.filter(e => e.severity === 'error');
  if (errors.length > 0) {
    console.error('Compilation errors:');
    errors.forEach(e => console.error(e.formattedMessage));
    process.exit(1);
  }
}

const contract = output.contracts['CheckersScore.sol']['CheckersScore'];
const abi = contract.abi;
const bytecode = '0x' + contract.evm.bytecode.object;

console.log('Compiled successfully!');
console.log(`Bytecode size: ${bytecode.length / 2} bytes`);

const account = privateKeyToAccount(PRIVATE_KEY);
console.log(`Deploying from: ${account.address}`);

const publicClient = createPublicClient({
  chain: base,
  transport: http('https://mainnet.base.org'),
});

const walletClient = createWalletClient({
  account,
  chain: base,
  transport: http('https://mainnet.base.org'),
});

async function deploy() {
  const balance = await publicClient.getBalance({ address: account.address });
  const ethBal = Number(balance) / 1e18;
  console.log(`Balance: ${ethBal.toFixed(6)} ETH`);

  if (ethBal < 0.001) {
    console.error('\nYetersiz bakiye! Base mainnet ETH gerekli.');
    console.error(`Adresin: ${account.address}`);
    process.exit(1);
  }

  console.log('Deploying to Base mainnet...');

  const hash = await walletClient.deployContract({
    abi,
    bytecode,
    account,
  });

  console.log(`Tx hash: ${hash}`);
  console.log('Waiting for confirmation...');

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  console.log('\n=== DEPLOY BASARILI ===');
  console.log(`Contract Address: ${receipt.contractAddress}`);
  console.log(`Block: ${receipt.blockNumber}`);
  console.log(`Gas Used: ${receipt.gasUsed}`);
  console.log(`\nBasescan: https://basescan.org/address/${receipt.contractAddress}`);
  console.log('\n=== SONRAKI ADIM ===');
  console.log(`contract.js dosyasinda CONTRACT_ADDRESS degerini guncelle:`);
  console.log(`export const CONTRACT_ADDRESS = '${receipt.contractAddress}';`);
}

deploy().catch(err => {
  console.error('Deploy failed:', err.message);
  process.exit(1);
});

# Checkers vs AI

A Farcaster Mini App — play classic checkers against AI on Base.

**Play now:** [checkers-ebon.vercel.app](https://checkers-ebon.vercel.app)

## Features

- 8x8 board with diagonal movement, jumping captures, and king promotion
- Aggressive AI that prioritizes captures
- On-chain score submission on Base mainnet
- Batch transactions (EIP-5792) for score + tip
- Etherscan API V2 leaderboard
- Mobile-first responsive design
- Farcaster SDK integration (wallet, haptics, context auth)

## Smart Contract

- **Network:** Base mainnet
- **Contract:** [`0x87ea2144fbb25759a23d489e5655e73bd7899d0a`](https://basescan.org/address/0x87ea2144fbb25759a23d489e5655e73bd7899d0a)

## Tech Stack

- Vanilla JS (no framework)
- Viem for wallet and contract interactions
- Farcaster Mini App SDK
- Solidity (CheckersScore.sol)
- Vercel for hosting

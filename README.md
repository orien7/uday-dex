# Project 3 — SimpleDEX
## System Design & Architecture Document

**Version:** 1.0 | **Author:** Uday Kumar BS | **Network:** BSC Testnet → Mainnet

---

## 1. Overview

SimpleDEX is a constant-product automated market maker (AMM) implementing the Uniswap v2 `x*y=k` formula for a single ETH/UDAY token pair. It enables:

- Trustless token swaps between ETH and UDAY with 0.3% fee
- Non-custodial liquidity provision with proportional LP token receipts
- Price discovery via on-chain reserve ratios (no oracle dependency)
- Emergency pause mechanism for security incidents

---

## 2. AMM Formula — x * y = k

The constant product invariant means the product of both reserves must remain equal (or increase from fees) after every trade.

```
x = ETH reserve in pool
y = UDAY token reserve in pool
k = x * y  (constant — never decreases)
```

### Swap output formula (with 0.3% fee)

```
amountOut = (amountIn × 9970 × reserveOut)
            ÷ (reserveIn × 10000 + amountIn × 9970)
```

The `9970 / 10000` factor removes 0.3% from the input before applying the invariant. The 0.3% stays in the pool, slowly increasing `k` — this is how LP holders earn fees.

### Price impact

Large trades relative to pool size move the price significantly:

```
priceImpact ≈ amountIn / (reserveIn + amountIn) × 100%
```

A 1 ETH swap into a 10 ETH pool causes ~9% price impact — displayed clearly in the UI to warn traders.

---

## 3. System Architecture

### Layer stack

```
┌─────────────────────────────────────────────────────────┐
│               User Layer                                 │
│  MetaMask · WalletConnect v2 · Ledger hardware          │
└──────────────────────┬──────────────────────────────────┘
                       │ signs txs locally
┌──────────────────────▼──────────────────────────────────┐
│               Frontend Layer                             │
│  React 18 · Wagmi v2 · Viem · TanStack Query            │
│  Tabs: Swap | Liquidity | Analytics                     │
└──────┬──────────────────────────────────────────────────┘
       │ contract reads (eth_call) + writes (eth_sendRawTransaction)
┌──────▼──────────────────────────────────────────────────┐
│               Contract Layer (BSC / Ethereum)            │
│                                                         │
│  UDAYToken.sol          SimpleDEX.sol (ERC-20 LP)       │
│  ERC-20 · approve  →→→  swap · addLiquidity · remove    │
│                         quoteETHForToken                 │
│                         getPoolInfo · getK              │
└──────┬──────────────────────────────────────────────────┘
       │ deployed on-chain
┌──────▼──────────────────────────────────────────────────┐
│               Infrastructure Layer                       │
│  Infura / Alchemy RPC  ·  Cloudflare CDN  ·  BscScan   │
└──────┬──────────────────────────────────────────────────┘
       │ events + metrics
┌──────▼──────────────────────────────────────────────────┐
│               Monitoring Layer                           │
│  OZ Defender (alerts) · Tenderly (simulate) · Dune     │
└─────────────────────────────────────────────────────────┘
```

---

## 4. Smart Contract Design

### 4.1 SimpleDEX.sol

Inherits: `ERC20` (LP token), `ReentrancyGuard`, `Ownable2Step`

#### State variables

| Variable | Type | Description |
|---|---|---|
| `token` | `IERC20 immutable` | The ERC-20 token in the ETH/TOKEN pair |
| `reserveETH` | `uint256` | ETH currently held in pool |
| `reserveToken` | `uint256` | Tokens currently held in pool |
| `totalFeesETH` | `uint256` | Cumulative ETH fees collected |
| `totalFeesToken` | `uint256` | Cumulative token fees collected |
| `paused` | `bool` | Emergency circuit breaker |
| `MINIMUM_LIQUIDITY` | `uint256 constant` | 1000 — burned on first mint (anti-dust) |
| `FEE_NUMERATOR` | `uint256 constant` | 9970 (0.3% fee) |

#### Core functions

```solidity
// Add ETH + token liquidity, receive LP tokens
function addLiquidity(uint256 tokenAmount, uint256 minLP, uint256 deadline)
    external payable returns (uint256 lpAmount)

// Burn LP tokens, receive proportional ETH + tokens
function removeLiquidity(uint256 lpAmount, uint256 minETH, uint256 minToken, uint256 deadline)
    external returns (uint256 ethAmount, uint256 tokenAmount)

// Swap ETH → tokens with slippage protection
function swapETHForToken(uint256 minTokenOut, uint256 deadline)
    external payable

// Swap tokens → ETH with slippage protection
function swapTokenForETH(uint256 tokenIn, uint256 minETHOut, uint256 deadline)
    external

// Read-only quotes (no gas cost, called from frontend)
function quoteETHForToken(uint256 ethIn) external view returns (uint256)
function quoteTokenForETH(uint256 tokenIn) external view returns (uint256)
function getPoolInfo() external view returns (...)
function getLPShare(address provider) external view returns (uint256 bps)
```

#### LP token minting formula

```
First deposit:  LP = sqrt(ETH × TOKEN) - MINIMUM_LIQUIDITY
                (MINIMUM_LIQUIDITY burned to 0xdead — prevents share manipulation)

Subsequent:     LP = min(
                  depositETH × totalLP / reserveETH,
                  depositToken × totalLP / reserveToken
                )
                (uses smaller ratio to prevent over-minting)
```

---

## 5. Security Model

### 5.1 Protections implemented

| Attack | Protection |
|---|---|
| Reentrancy | `nonReentrant` on all state-changing functions |
| Slippage / sandwich | `minTokenOut` / `minETHOut` parameters |
| Deadline expiry | `checkDeadline` modifier rejects stale txs |
| Flash loan manipulation | No oracle — price derived from reserves only |
| Integer overflow | Solidity 0.8.20 built-in protection |
| Ownership theft | `Ownable2Step` two-step transfer |
| Dust attacks | `MINIMUM_LIQUIDITY` burned on first deposit |
| Token approval exploit | `SafeERC20.safeTransferFrom` throughout |
| Pool drain via removeLiquidity | Balance check — can only remove own LP share |
| Paused pool | Emergency `setPaused()` stops all swaps |

### 5.2 Slippage protection explained

Every swap includes a `minTokenOut` / `minETHOut` parameter. The contract reverts with `SlippageExceeded` if the actual output falls below this minimum. The frontend calculates this as:

```
minOut = quotedOutput × (1 - slippageTolerance / 100)
```

Default slippage: 0.5%. User-selectable: 0.1% / 0.5% / 1.0%.

### 5.3 Sandwich attack resistance

While `minTokenOut` doesn't fully prevent sandwich attacks, it limits the maximum loss a bot can extract. For mainnet, consider additionally:

- Implementing a per-block trade limit
- Integrating with Flashbots for private mempool submission

### 5.4 Pre-mainnet requirements

- [ ] Slither — zero high/medium findings
- [ ] Mythril — zero vulnerabilities
- [ ] Foundry fuzz testing — 1M+ random inputs
- [ ] Independent audit (Trail of Bits / Sherlock)
- [ ] Gnosis Safe multisig as owner
- [ ] Immunefi bug bounty active

---

## 6. Frontend Architecture

### 6.1 Stack

| Package | Version | Purpose |
|---|---|---|
| React | 18 | UI framework |
| Wagmi | v2 | Contract reads/writes, wallet state |
| Viem | v2 | Low-level Ethereum client (replaces ethers.js) |
| TanStack Query | v5 | Async state, caching, refetch intervals |
| Vite | v5 | Build tool |

### 6.2 Key Wagmi hooks used

```javascript
// Read pool state every 15 seconds
const { data: poolInfo } = useReadContract({
  address: DEX_ADDRESS,
  abi: DEX_ABI,
  functionName: 'getPoolInfo',
  query: { refetchInterval: 15000 }
});

// Quote swap output (no gas)
const { data: quote } = useReadContract({
  address: DEX_ADDRESS,
  abi: DEX_ABI,
  functionName: 'quoteETHForToken',
  args: [parseEther(ethInput)],
});

// Execute swap
const { writeContract, isPending } = useWriteContract();
writeContract({
  address: DEX_ADDRESS,
  abi: DEX_ABI,
  functionName: 'swapETHForToken',
  args: [minTokenOut, deadline],
  value: parseEther(ethInput),
});
```

### 6.3 Three UI tabs

**Swap tab** — Token pair input/output with live quote, slippage selector, price impact warning (amber >3%, red >5%), transaction status feedback.

**Liquidity tab** — Add liquidity (auto-calculates paired token amount from spot price), remove liquidity with percentage presets (25/50/75/100%), live pool share display.

**Analytics tab** — 7-day price chart (SVG), pool composition bar, TVL/volume/fee stats, recent transactions feed.

---

## 7. Deployment

### 7.1 Environment variables

```bash
# .env (never commit)
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY
BSC_TESTNET_RPC_URL=https://data-seed-prebsc-1-s1.binance.org:8545
PRIVATE_KEY=0xYOUR_DEPLOYER_KEY
ETHERSCAN_API_KEY=YOUR_KEY
BSCSCAN_API_KEY=YOUR_KEY

# frontend/.env (safe to expose — public addresses only)
VITE_TOKEN_ADDRESS=0x...
VITE_DEX_ADDRESS=0x...
VITE_RPC_URL=https://bsc-testnet.infura.io/v3/YOUR_KEY
```

### 7.2 Deploy sequence

```bash
# 1. Test locally
npx hardhat test  # all tests must pass

# 2. Deploy to BSC testnet
npx hardhat run scripts/deploy.js --network bscTestnet

# 3. Verify contracts
npx hardhat verify --network bscTestnet <TOKEN_ADDR> <DEPLOYER_ADDR>
npx hardhat verify --network bscTestnet <DEX_ADDR> <TOKEN_ADDR> <DEPLOYER_ADDR>

# 4. Update frontend .env with deployed addresses

# 5. Start frontend
cd frontend && npm run dev
```

### 7.3 Initial liquidity seeding

The deploy script seeds `1 ETH : 1000 UDAY` as the initial price. To change the initial price, adjust the ratio:

```javascript
// 1 ETH = 2000 UDAY initial price:
const ethSeed   = ethers.parseEther("1");
const tokenSeed = ethers.parseEther("2000");
```

---

## 8. Monitoring

### 8.1 Events to monitor (OpenZeppelin Defender)

| Event | Alert threshold | Action |
|---|---|---|
| `SwapETHForToken` | >5 ETH single swap | Log + notify |
| `LiquidityRemoved` | >50% TVL in one tx | Critical alert |
| `PoolPaused` | Any | Critical — investigate |
| `OwnershipTransferStarted` | Any | Block until verified |
| Reserve imbalance | k drops unexpectedly | Critical — possible exploit |

### 8.2 Dune Analytics queries

Key dashboards to build post-deployment:
- Daily volume (ETH and token side)
- TVL over time
- Unique traders per day
- Fee income accumulated by LPs
- Price (spot rate) over time

---

## 9. Gas Estimates

| Function | Estimated Gas |
|---|---|
| `addLiquidity` (first) | ~180,000 |
| `addLiquidity` (subsequent) | ~120,000 |
| `removeLiquidity` | ~90,000 |
| `swapETHForToken` | ~75,000 |
| `swapTokenForETH` | ~85,000 |
| `quoteETHForToken` (view) | 0 |

---

## 10. Known Limitations (by design)

- Single pair only (ETH/UDAY) — multi-pair requires factory pattern (Uniswap v2 architecture)
- No concentrated liquidity — full range only (Uniswap v3 improvement)
- No on-chain TWAP oracle — can be added as extension
- Flash loans not supported — can be added as extension for arbitrageurs

---

## Author

**Uday Kumar BS** — Angel Investor & Full-Stack/Blockchain Architect  
25+ years · Ex-LSEG · Deutsche Bank Blockchain Lab · LCH  
[linkedin.com/in/udaykumarbs](https://linkedin.com/in/udaykumarbs) · [portfolioanalysis.in](https://portfolioanalysis.in)

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title SimpleDEX — Constant Product AMM (ETH / ERC-20 pair)
/// @author Uday Kumar BS
/// @notice Uniswap v2-style AMM demonstrating x*y=k invariant with LP tokens
/// @dev Deployed on BSC Testnet / Sepolia. Non-upgradeable. Fee = 0.3%.
contract SimpleDEX is ERC20, ReentrancyGuard, Ownable2Step {
    using SafeERC20 for IERC20;

    // ── State ──────────────────────────────────────────────────────────────
    IERC20 public immutable token;      // ERC-20 token (UDAY)
    uint256 public reserveETH;          // ETH held in pool
    uint256 public reserveToken;        // Token held in pool
    uint256 public totalFeesETH;        // Accumulated fees (ETH side)
    uint256 public totalFeesToken;      // Accumulated fees (token side)

    uint256 public constant FEE_NUMERATOR   = 9970;  // 0.3% fee → 99.7% passes through
    uint256 public constant FEE_DENOMINATOR = 10000;
    uint256 public constant MINIMUM_LIQUIDITY = 1000; // Burned on first mint (Uniswap pattern)

    bool public paused; // Emergency pause by owner

    // ── Events ─────────────────────────────────────────────────────────────
    event LiquidityAdded(
        address indexed provider,
        uint256 ethAmount,
        uint256 tokenAmount,
        uint256 lpMinted
    );
    event LiquidityRemoved(
        address indexed provider,
        uint256 ethAmount,
        uint256 tokenAmount,
        uint256 lpBurned
    );
    event SwapETHForToken(
        address indexed trader,
        uint256 ethIn,
        uint256 tokenOut,
        uint256 fee
    );
    event SwapTokenForETH(
        address indexed trader,
        uint256 tokenIn,
        uint256 ethOut,
        uint256 fee
    );
    event PoolPaused(bool paused);

    // ── Errors ─────────────────────────────────────────────────────────────
    error ZeroAmount();
    error InsufficientLiquidity();
    error SlippageExceeded(uint256 expected, uint256 actual);
    error DeadlineExpired(uint256 deadline, uint256 current);
    error InsufficientLPBalance();
    error PoolPausedError();
    error InvalidToken();

    // ── Modifiers ──────────────────────────────────────────────────────────
    modifier notPaused() {
        if (paused) revert PoolPausedError();
        _;
    }

    modifier checkDeadline(uint256 deadline) {
        if (block.timestamp > deadline) revert DeadlineExpired(deadline, block.timestamp);
        _;
    }

    // ── Constructor ────────────────────────────────────────────────────────
    /// @param _token Address of the ERC-20 token for this pair
    /// @param initialOwner Owner address (should become multisig on mainnet)
    constructor(address _token, address initialOwner)
        ERC20("UDAY-ETH LP Token", "ULP")
        Ownable(initialOwner)
    {
        if (_token == address(0)) revert InvalidToken();
        token = IERC20(_token);
    }

    // ── Add Liquidity ──────────────────────────────────────────────────────

    /// @notice Add ETH + token liquidity to the pool
    /// @param tokenAmount Amount of tokens to deposit alongside ETH
    /// @param minLP Minimum LP tokens to receive (slippage protection)
    /// @param deadline Unix timestamp after which tx reverts
    /// @return lpAmount LP tokens minted to caller
    function addLiquidity(
        uint256 tokenAmount,
        uint256 minLP,
        uint256 deadline
    )
        external
        payable
        nonReentrant
        notPaused
        checkDeadline(deadline)
        returns (uint256 lpAmount)
    {
        if (msg.value == 0 || tokenAmount == 0) revert ZeroAmount();

        uint256 _totalSupply = totalSupply();

        if (_totalSupply == 0) {
            // First deposit: LP = sqrt(eth * token) - MINIMUM_LIQUIDITY
            lpAmount = _sqrt(msg.value * tokenAmount);
            if (lpAmount <= MINIMUM_LIQUIDITY) revert InsufficientLiquidity();
            lpAmount -= MINIMUM_LIQUIDITY;
            // Burn minimum liquidity to dead address (Uniswap pattern)
            _mint(address(0xdead), MINIMUM_LIQUIDITY);
        } else {
            // Subsequent deposits: proportional to existing reserves
            uint256 lpFromETH   = (msg.value   * _totalSupply) / reserveETH;
            uint256 lpFromToken = (tokenAmount  * _totalSupply) / reserveToken;
            // Use smaller to prevent over-minting
            lpAmount = lpFromETH < lpFromToken ? lpFromETH : lpFromToken;
        }

        if (lpAmount < minLP) revert SlippageExceeded(minLP, lpAmount);
        if (lpAmount == 0) revert InsufficientLiquidity();

        token.safeTransferFrom(msg.sender, address(this), tokenAmount);

        reserveETH   += msg.value;
        reserveToken += tokenAmount;

        _mint(msg.sender, lpAmount);

        emit LiquidityAdded(msg.sender, msg.value, tokenAmount, lpAmount);
    }

    // ── Remove Liquidity ───────────────────────────────────────────────────

    /// @notice Burn LP tokens to withdraw proportional ETH + tokens
    /// @param lpAmount LP tokens to burn
    /// @param minETH Minimum ETH to receive
    /// @param minToken Minimum tokens to receive
    /// @param deadline Unix timestamp after which tx reverts
    function removeLiquidity(
        uint256 lpAmount,
        uint256 minETH,
        uint256 minToken,
        uint256 deadline
    )
        external
        nonReentrant
        notPaused
        checkDeadline(deadline)
        returns (uint256 ethAmount, uint256 tokenAmount)
    {
        if (lpAmount == 0) revert ZeroAmount();
        if (balanceOf(msg.sender) < lpAmount) revert InsufficientLPBalance();

        uint256 _totalSupply = totalSupply();
        ethAmount   = (lpAmount * reserveETH)   / _totalSupply;
        tokenAmount = (lpAmount * reserveToken) / _totalSupply;

        if (ethAmount   < minETH)   revert SlippageExceeded(minETH,   ethAmount);
        if (tokenAmount < minToken) revert SlippageExceeded(minToken, tokenAmount);

        _burn(msg.sender, lpAmount);

        reserveETH   -= ethAmount;
        reserveToken -= tokenAmount;

        payable(msg.sender).transfer(ethAmount);
        token.safeTransfer(msg.sender, tokenAmount);

        emit LiquidityRemoved(msg.sender, ethAmount, tokenAmount, lpAmount);
    }

    // ── Swaps ──────────────────────────────────────────────────────────────

    /// @notice Swap ETH for tokens
    /// @param minTokenOut Minimum tokens out (slippage tolerance)
    /// @param deadline Unix timestamp after which tx reverts
    function swapETHForToken(uint256 minTokenOut, uint256 deadline)
        external
        payable
        nonReentrant
        notPaused
        checkDeadline(deadline)
    {
        if (msg.value == 0) revert ZeroAmount();
        if (reserveETH == 0 || reserveToken == 0) revert InsufficientLiquidity();

        // Fee stays in pool, increasing k slightly — how LPs earn
        uint256 amountInWithFee = msg.value * FEE_NUMERATOR;
        uint256 tokenOut = (amountInWithFee * reserveToken) /
                           (reserveETH * FEE_DENOMINATOR + amountInWithFee);

        if (tokenOut < minTokenOut) revert SlippageExceeded(minTokenOut, tokenOut);
        if (tokenOut >= reserveToken) revert InsufficientLiquidity();

        uint256 fee = msg.value - (msg.value * FEE_NUMERATOR / FEE_DENOMINATOR);
        totalFeesETH += fee;

        reserveETH   += msg.value;
        reserveToken -= tokenOut;

        token.safeTransfer(msg.sender, tokenOut);

        emit SwapETHForToken(msg.sender, msg.value, tokenOut, fee);
    }

    /// @notice Swap tokens for ETH
    /// @param tokenIn Amount of tokens to sell
    /// @param minETHOut Minimum ETH out (slippage tolerance)
    /// @param deadline Unix timestamp after which tx reverts
    function swapTokenForETH(
        uint256 tokenIn,
        uint256 minETHOut,
        uint256 deadline
    )
        external
        nonReentrant
        notPaused
        checkDeadline(deadline)
    {
        if (tokenIn == 0) revert ZeroAmount();
        if (reserveETH == 0 || reserveToken == 0) revert InsufficientLiquidity();

        uint256 amountInWithFee = tokenIn * FEE_NUMERATOR;
        uint256 ethOut = (amountInWithFee * reserveETH) /
                         (reserveToken * FEE_DENOMINATOR + amountInWithFee);

        if (ethOut < minETHOut) revert SlippageExceeded(minETHOut, ethOut);
        if (ethOut >= reserveETH) revert InsufficientLiquidity();

        uint256 fee = tokenIn - (tokenIn * FEE_NUMERATOR / FEE_DENOMINATOR);
        totalFeesToken += fee;

        token.safeTransferFrom(msg.sender, address(this), tokenIn);
        reserveToken += tokenIn;
        reserveETH   -= ethOut;

        payable(msg.sender).transfer(ethOut);

        emit SwapTokenForETH(msg.sender, tokenIn, ethOut, fee);
    }

    // ── View / Quote Functions ─────────────────────────────────────────────

    /// @notice Quote: tokens received for given ETH input
    function quoteETHForToken(uint256 ethIn)
        external view returns (uint256 tokenOut)
    {
        if (reserveETH == 0 || ethIn == 0) return 0;
        uint256 amountInWithFee = ethIn * FEE_NUMERATOR;
        tokenOut = (amountInWithFee * reserveToken) /
                   (reserveETH * FEE_DENOMINATOR + amountInWithFee);
    }

    /// @notice Quote: ETH received for given token input
    function quoteTokenForETH(uint256 tokenIn)
        external view returns (uint256 ethOut)
    {
        if (reserveToken == 0 || tokenIn == 0) return 0;
        uint256 amountInWithFee = tokenIn * FEE_NUMERATOR;
        ethOut = (amountInWithFee * reserveETH) /
                 (reserveToken * FEE_DENOMINATOR + amountInWithFee);
    }

    /// @notice Current spot price: tokens per 1 ETH (18 decimal precision)
    function getSpotPrice() external view returns (uint256) {
        if (reserveETH == 0) return 0;
        return (reserveToken * 1e18) / reserveETH;
    }

    /// @notice Pool invariant k = x * y
    function getK() external view returns (uint256) {
        return reserveETH * reserveToken;
    }

    /// @notice Full pool state snapshot
    function getPoolInfo() external view returns (
        uint256 ethReserve,
        uint256 tokenReserve,
        uint256 lpSupply,
        uint256 spotPrice,
        uint256 k
    ) {
        ethReserve   = reserveETH;
        tokenReserve = reserveToken;
        lpSupply     = totalSupply();
        spotPrice    = reserveETH > 0 ? (reserveToken * 1e18) / reserveETH : 0;
        k            = reserveETH * reserveToken;
    }

    /// @notice LP share percentage (basis points, 10000 = 100%)
    function getLPShare(address provider)
        external view returns (uint256 bps)
    {
        uint256 supply = totalSupply();
        if (supply == 0) return 0;
        bps = (balanceOf(provider) * 10000) / supply;
    }

    // ── Admin ──────────────────────────────────────────────────────────────

    /// @notice Emergency pause — stops all swaps and liquidity ops
    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit PoolPaused(_paused);
    }

    /// @notice Rescue ETH accidentally sent to contract (not pool ETH)
    function rescueETH(uint256 amount) external onlyOwner {
        require(address(this).balance - reserveETH >= amount, "Cannot withdraw pool ETH");
        payable(owner()).transfer(amount);
    }

    // ── Internal ───────────────────────────────────────────────────────────

    /// @dev Babylonian square root (Uniswap v2 pattern)
    function _sqrt(uint256 x) internal pure returns (uint256 z) {
        if (x == 0) return 0;
        z = (x + 1) / 2;
        uint256 y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    receive() external payable {}
}

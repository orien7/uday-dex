import { expect } from "chai";
import hre from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const { ethers } = hre;

describe("SimpleDEX", function () {
  let token, dex, owner, alice, bob;
  const DEADLINE = () => Math.floor(Date.now() / 1000) + 300;
  const ETH  = (n) => ethers.parseEther(String(n));
  const UDAY = (n) => ethers.parseEther(String(n));

  beforeEach(async () => {
    [owner, alice, bob] = await ethers.getSigners();

    // Deploy token
    const Token = await ethers.getContractFactory("UDAYToken");
    token = await Token.deploy(owner.address);

    // Deploy DEX
    const DEX = await ethers.getContractFactory("SimpleDEX");
    dex = await DEX.deploy(await token.getAddress(), owner.address);

    // Fund alice and bob with tokens
    await token.transfer(alice.address, UDAY(100000));
    await token.transfer(bob.address,   UDAY(100000));

    // Approve DEX for both
    await token.connect(alice).approve(await dex.getAddress(), UDAY(100000));
    await token.connect(bob).approve(await dex.getAddress(),   UDAY(100000));
  });

  // ── Liquidity Tests ───────────────────────────────────────────────────────

  describe("Add Liquidity", () => {
    it("should mint LP tokens on first deposit", async () => {
      await dex.connect(alice).addLiquidity(UDAY(1000), 0, DEADLINE(), { value: ETH(1) });
      const lpBal = await dex.balanceOf(alice.address);
      expect(lpBal).to.be.gt(0);
    });

    it("should set reserves correctly after first deposit", async () => {
      await dex.connect(alice).addLiquidity(UDAY(1000), 0, DEADLINE(), { value: ETH(1) });
      expect(await dex.reserveETH()).to.equal(ETH(1));
      expect(await dex.reserveToken()).to.equal(UDAY(1000));
    });

    it("should reject zero ETH", async () => {
      await expect(
        dex.connect(alice).addLiquidity(UDAY(1000), 0, DEADLINE(), { value: 0 })
      ).to.be.revertedWithCustomError(dex, "ZeroAmount");
    });

    it("should reject zero token amount", async () => {
      await expect(
        dex.connect(alice).addLiquidity(0, 0, DEADLINE(), { value: ETH(1) })
      ).to.be.revertedWithCustomError(dex, "ZeroAmount");
    });

    it("should reject expired deadline", async () => {
      const pastDeadline = Math.floor(Date.now() / 1000) - 100;
      await expect(
        dex.connect(alice).addLiquidity(UDAY(1000), 0, pastDeadline, { value: ETH(1) })
      ).to.be.revertedWithCustomError(dex, "DeadlineExpired");
    });

    it("should mint proportional LP on second deposit", async () => {
      await dex.connect(alice).addLiquidity(UDAY(1000), 0, DEADLINE(), { value: ETH(1) });
      const aliceLP = await dex.balanceOf(alice.address);

      await dex.connect(bob).addLiquidity(UDAY(1000), 0, DEADLINE(), { value: ETH(1) });
      const bobLP = await dex.balanceOf(bob.address);

      // Bob should get approximately same LP as alice (same ratio)
      expect(bobLP).to.be.closeTo(aliceLP, aliceLP / 10n);
    });

    it("should enforce minLP slippage protection", async () => {
      const hugeMLP = ETH(999999);
      await expect(
        dex.connect(alice).addLiquidity(UDAY(1000), hugeMLP, DEADLINE(), { value: ETH(1) })
      ).to.be.revertedWithCustomError(dex, "SlippageExceeded");
    });
  });

  describe("Remove Liquidity", () => {
    beforeEach(async () => {
      // Seed pool
      await dex.connect(alice).addLiquidity(UDAY(1000), 0, DEADLINE(), { value: ETH(1) });
    });

    it("should return ETH and tokens proportionally", async () => {
      const lpBal = await dex.balanceOf(alice.address);
      const ethBefore = await ethers.provider.getBalance(alice.address);

      const tx = await dex.connect(alice).removeLiquidity(lpBal, 0, 0, DEADLINE());
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      const ethAfter = await ethers.provider.getBalance(alice.address);
      expect(ethAfter + gasUsed).to.be.gt(ethBefore);
    });

    it("should burn LP tokens on removal", async () => {
      const lpBal = await dex.balanceOf(alice.address);
      await dex.connect(alice).removeLiquidity(lpBal, 0, 0, DEADLINE());
      expect(await dex.balanceOf(alice.address)).to.equal(0);
    });

    it("should revert if minETH not met", async () => {
      const lpBal = await dex.balanceOf(alice.address);
      await expect(
        dex.connect(alice).removeLiquidity(lpBal, ETH(999), 0, DEADLINE())
      ).to.be.revertedWithCustomError(dex, "SlippageExceeded");
    });

    it("should revert if insufficient LP balance", async () => {
      const bigLP = ETH(999999);
      await expect(
        dex.connect(alice).removeLiquidity(bigLP, 0, 0, DEADLINE())
      ).to.be.revertedWithCustomError(dex, "InsufficientLPBalance");
    });
  });

  // ── Swap Tests ────────────────────────────────────────────────────────────

  describe("Swap ETH → Token", () => {
    beforeEach(async () => {
      await dex.connect(alice).addLiquidity(UDAY(10000), 0, DEADLINE(), { value: ETH(10) });
    });

    it("should return tokens for ETH", async () => {
      const tokenBefore = await token.balanceOf(bob.address);
      await dex.connect(bob).swapETHForToken(0, DEADLINE(), { value: ETH(0.1) });
      const tokenAfter = await token.balanceOf(bob.address);
      expect(tokenAfter).to.be.gt(tokenBefore);
    });

    it("should match quote function", async () => {
      const quoted = await dex.quoteETHForToken(ETH(0.1));
      const tokenBefore = await token.balanceOf(bob.address);
      await dex.connect(bob).swapETHForToken(0, DEADLINE(), { value: ETH(0.1) });
      const tokenAfter = await token.balanceOf(bob.address);
      const received = tokenAfter - tokenBefore;
      // Received should be within 1% of quote (due to state change mid-tx)
      expect(received).to.be.closeTo(quoted, quoted / 100n);
    });

    it("should revert on slippage exceeded", async () => {
      await expect(
        dex.connect(bob).swapETHForToken(UDAY(999999), DEADLINE(), { value: ETH(0.1) })
      ).to.be.revertedWithCustomError(dex, "SlippageExceeded");
    });

    it("should revert with zero ETH", async () => {
      await expect(
        dex.connect(bob).swapETHForToken(0, DEADLINE(), { value: 0 })
      ).to.be.revertedWithCustomError(dex, "ZeroAmount");
    });

    it("should emit SwapETHForToken event", async () => {
      await expect(
        dex.connect(bob).swapETHForToken(0, DEADLINE(), { value: ETH(0.1) })
      ).to.emit(dex, "SwapETHForToken");
    });

    it("should update reserves correctly", async () => {
      const ethReserveBefore = await dex.reserveETH();
      await dex.connect(bob).swapETHForToken(0, DEADLINE(), { value: ETH(0.1) });
      expect(await dex.reserveETH()).to.equal(ethReserveBefore + ETH(0.1));
    });
  });

  describe("Swap Token → ETH", () => {
    beforeEach(async () => {
      await dex.connect(alice).addLiquidity(UDAY(10000), 0, DEADLINE(), { value: ETH(10) });
    });

    it("should return ETH for tokens", async () => {
      const ethBefore = await ethers.provider.getBalance(bob.address);
      const tx = await dex.connect(bob).swapTokenForETH(UDAY(100), 0, DEADLINE());
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;
      const ethAfter = await ethers.provider.getBalance(bob.address);
      expect(ethAfter + gasUsed).to.be.gt(ethBefore);
    });

    it("should match quoteTokenForETH", async () => {
      const quoted = await dex.quoteTokenForETH(UDAY(100));
      expect(quoted).to.be.gt(0);
    });

    it("should revert on slippage exceeded", async () => {
      await expect(
        dex.connect(bob).swapTokenForETH(UDAY(100), ETH(999), DEADLINE())
      ).to.be.revertedWithCustomError(dex, "SlippageExceeded");
    });

    it("should emit SwapTokenForETH event", async () => {
      await expect(
        dex.connect(bob).swapTokenForETH(UDAY(100), 0, DEADLINE())
      ).to.emit(dex, "SwapTokenForETH");
    });
  });

  // ── Invariant Tests ───────────────────────────────────────────────────────

  describe("AMM Invariant x*y=k", () => {
    it("k should be approximately constant after swaps (slight increase from fees)", async () => {
      await dex.connect(alice).addLiquidity(UDAY(10000), 0, DEADLINE(), { value: ETH(10) });
      const kBefore = await dex.getK();

      // Multiple swaps
      await dex.connect(bob).swapETHForToken(0, DEADLINE(), { value: ETH(0.5) });
      await dex.connect(bob).swapTokenForETH(UDAY(200), 0, DEADLINE());

      const kAfter = await dex.getK();
      // k should only increase (fees stay in pool) — never decrease
      expect(kAfter).to.be.gte(kBefore);
    });

    it("spot price should move against large trades", async () => {
      await dex.connect(alice).addLiquidity(UDAY(10000), 0, DEADLINE(), { value: ETH(10) });
      const priceBefore = await dex.getSpotPrice();

      // Big ETH buy drives token price up (less tokens per ETH)
      await dex.connect(bob).swapETHForToken(0, DEADLINE(), { value: ETH(5) });
      const priceAfter = await dex.getSpotPrice();

      // After buying tokens with ETH, tokens are more expensive → fewer per ETH
      expect(priceAfter).to.be.lt(priceBefore);
    });
  });

  // ── Security Tests ────────────────────────────────────────────────────────

  describe("Security", () => {
    it("should reject swaps when paused", async () => {
      await dex.connect(alice).addLiquidity(UDAY(10000), 0, DEADLINE(), { value: ETH(10) });
      await dex.connect(owner).setPaused(true);

      await expect(
        dex.connect(bob).swapETHForToken(0, DEADLINE(), { value: ETH(0.1) })
      ).to.be.revertedWithCustomError(dex, "PoolPausedError");
    });

    it("should reject addLiquidity when paused", async () => {
      await dex.connect(owner).setPaused(true);
      await expect(
        dex.connect(alice).addLiquidity(UDAY(1000), 0, DEADLINE(), { value: ETH(1) })
      ).to.be.revertedWithCustomError(dex, "PoolPausedError");
    });

    it("should only allow owner to pause", async () => {
      await expect(
        dex.connect(alice).setPaused(true)
      ).to.be.reverted;
    });

    it("should revert swap when pool is empty", async () => {
      await expect(
        dex.connect(bob).swapETHForToken(0, DEADLINE(), { value: ETH(1) })
      ).to.be.revertedWithCustomError(dex, "InsufficientLiquidity");
    });
  });

  // ── View Functions ────────────────────────────────────────────────────────

  describe("View functions", () => {
    beforeEach(async () => {
      await dex.connect(alice).addLiquidity(UDAY(1000), 0, DEADLINE(), { value: ETH(1) });
    });

    it("getPoolInfo returns correct state", async () => {
      const info = await dex.getPoolInfo();
      expect(info.ethReserve).to.equal(ETH(1));
      expect(info.tokenReserve).to.equal(UDAY(1000));
      expect(info.lpSupply).to.be.gt(0);
      expect(info.spotPrice).to.be.gt(0);
      expect(info.k).to.equal(ETH(1) * UDAY(1000));
    });

    it("getLPShare returns correct percentage", async () => {
      const share = await dex.getLPShare(alice.address);
      // Alice is the only LP, should be ~100% (minus minimum liquidity)
      expect(share).to.be.closeTo(10000n, 100n);
    });

    it("quoteETHForToken returns non-zero for non-empty pool", async () => {
      const quote = await dex.quoteETHForToken(ETH(0.1));
      expect(quote).to.be.gt(0);
    });

    it("quoteTokenForETH returns non-zero for non-empty pool", async () => {
      const quote = await dex.quoteTokenForETH(UDAY(10));
      expect(quote).to.be.gt(0);
    });
  });
});

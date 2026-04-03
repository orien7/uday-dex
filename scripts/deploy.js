import hre from "hardhat";
const { ethers } = hre;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH\n");

  // 1. Deploy UDAY Token
  console.log("1/3 Deploying UDAYToken...");
  const Token = await ethers.getContractFactory("UDAYToken");
  const token = await Token.deploy(deployer.address);
  await token.waitForDeployment();
  const tokenAddr = await token.getAddress();
  console.log("   UDAYToken:", tokenAddr);

  // 2. Deploy SimpleDEX
  console.log("2/3 Deploying SimpleDEX...");
  const DEX = await ethers.getContractFactory("SimpleDEX");
  const dex = await DEX.deploy(tokenAddr, deployer.address);
  await dex.waitForDeployment();
  const dexAddr = await dex.getAddress();
  console.log("   SimpleDEX:", dexAddr);

  // 3. Seed initial liquidity (1 ETH : 1000 UDAY = 1 ETH per 1000 UDAY)
  console.log("3/3 Seeding initial liquidity...");
  const tokenAmount = ethers.parseEther("1000");
  const ethAmount   = ethers.parseEther("1");
  const deadline    = Math.floor(Date.now() / 1000) + 300;

  await token.approve(dexAddr, tokenAmount);
  await dex.addLiquidity(tokenAmount, 0, deadline, { value: ethAmount });
  console.log("   Seeded: 1 ETH + 1,000 UDAY");

  const info = await dex.getPoolInfo();
  console.log("\n=== Pool State ===");
  console.log("ETH reserve:", ethers.formatEther(info.ethReserve));
  console.log("Token reserve:", ethers.formatEther(info.tokenReserve));
  console.log("Spot price:", ethers.formatEther(info.spotPrice), "UDAY per ETH");

  console.log("\n=== Verify Commands ===");
  console.log(`npx hardhat verify --network bscTestnet ${tokenAddr} ${deployer.address}`);
  console.log(`npx hardhat verify --network bscTestnet ${dexAddr} ${tokenAddr} ${deployer.address}`);

  console.log("\n=== Frontend .env ===");
  console.log(`VITE_TOKEN_ADDRESS=${tokenAddr}`);
  console.log(`VITE_DEX_ADDRESS=${dexAddr}`);
}

main().catch((err) => { console.error(err); process.exit(1); });

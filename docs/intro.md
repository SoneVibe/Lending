# VIBE Protocol: Technical Whitepaper & Master Roadmap

**Version:** 2.0 (Pro)
**Date:** December 9, 2025
**Status:** 🟢 Live on Soneium Mainnet & Astar Network EVM Mainnet
**Governance Token:** VIBE (Soneium Supply: 1,000,000)

---

## 1. Executive Summary

**VIBE Finance** is the sovereign, modular DeFi lending layer designed for the high-throughput era of EVM-compatible networks. Currently deployed on **Soneium** and **Astar Network**, VIBE combines the battle-tested security of Compound V2 architecture with advanced risk management features, hybrid oracle infrastructure, and a native governance vault.

Our philosophy, **"Liquidity is Life,"** drives us to create a nervous system for finance where collateral, credit, and governance flow freely between ecosystems with absolute transparency.

---

## 2. Core Architecture: The Lending Layer

The core of VIBE is built upon the `V_MasterEnhanced` and `V_cERC20_ExtendedInterest` contracts. This architecture introduces significant improvements over standard forks:

### 2.1 Enhanced Market Contracts (`V_cERC20_ExtendedInterest`)
Unlike standard cTokens, VIBE markets include embedded security logic to prevent inflation attacks and accounting desynchronization.

*   **Internal Cash Accounting:** The contract tracks `internalCash` separately from `balanceOf(address(this))`. This explicitly prevents the "first depositor" inflation attack (donation attack) by ensuring that donated underlying tokens do not warp the exchange rate.
*   **Supply & Borrow Caps:** Hard limits on supply and borrowing are enforced at the contract level to manage protocol exposure to specific assets.
*   **Dynamic Rate Models:** Utilization-based interest rates (`InterestRateModel`) that adjust dynamically to market demand.

### 2.2 The Comptroller (`V_MasterEnhanced`)
The brain of the protocol, managing risk parameters and cross-market interactions.

*   **Granular Pausing:** The `PauseGuardian` can freeze specific actions (Mint, Borrow, Redeem, Liquidate) on a per-market basis without halting the entire protocol.
*   **Reward Distribution:** Integrated hooks (`updateMarketRewards`) distribute VIBE tokens to suppliers and borrowers every block.
*   **Global Borrow Caps:** A global USD-denominated borrow cap (`userBorrowCapGlobalUSD`) adds an extra layer of solvency protection.

---

## 3. Hybrid Oracle Infrastructure

VIBE utilizes a modular Oracle architecture tailored to the specific availability and security needs of each deployed chain.

### 3.1 Soneium Oracle (`ViveOracleHybridV3`)
*   **Primary Source:** Chainlink Price Feeds.
*   **L2 Security:** Integrates the **L2 Sequencer Uptime Feed**. If the Soneium sequencer goes down, the Oracle reverts transactions to prevent pricing manipulation during outages.
*   **Grace Period:** Enforces a delay after Sequencer uptime restoration before accepting new prices.

### 3.2 Astar Oracle (`ViveOracleDIA`)
*   **Primary Source:** DIA Oracle V2.
*   **Fallback Mechanism:** Includes a "Manual Price" fallback and a "Forced Manual" circuit breaker.
*   **Deviation Checks:** If the live feed deviates from the manual sanity check by more than a set threshold (e.g., 500bps), the system protects users by reverting or switching to the safe fallback.

---

## 4. Governance & VIBE Tokenomics

The VIBE token acts as the governance and utility standard for the protocol.

*   **Symbol:** VIBE
*   **Max Supply (Soneium):** 1,000,000 VIBE
*   **Contract:** `VIBE.sol` (ERC-20)

### 4.1 The Governance Vault
The **VIBE Vault** allows users to accrue rewards based on their participation in the protocol. Rewards are calculated per block based on `vibeSupplySpeed` and `vibeBorrowSpeed` set by the Comptroller.

### 4.2 Distribution Vector
*   **60% Community:** Lenders, Borrowers, and Liquidity Mining.
*   **20% Treasury:** Protocol security fund and insurance.
*   **10% Core Contributors:** Vesting over 2 years.
*   **10% Ecosystem:** Cross-chain liquidity provision.

---

## 5. Security & Risk Management

Security is not an afterthought; it is the foundation.

1.  **Re-entrancy Protection:** All state-changing functions (`mint`, `redeem`, `borrow`, `repay`, `liquidate`) are protected by `nonReentrant` modifiers.
2.  **Anti-Donation Logic:** `sweepDonations()` allows the protocol to sequester funds sent directly to contracts, preventing exchange rate manipulation.
3.  **Emergency Rescue:** The `emergencyRescueUnderlying` function (governance-only) prevents funds from being permanently locked in edge-case scenarios.
4.  **Health Factor (HF):** Defined as `Liquidation Threshold USD / Total Borrow USD`.
    *   **Liquidator Console:** A pro-grade interface is provided for community liquidators to monitor HF < 1.0 positions and execute liquidations efficiently, maintaining protocol solvency.

---

## 6. Roadmap: 2025 - 2026

We are currently executing **Phase C** of our Master Blueprint.

### ✅ Completed (2024 - Q3 2025)
*   **Phase A (Core):** Deployment of `SoneVibe_cERC20` and `ComptrollerV3`.
*   **Phase B (Governance):** VIBE Token generation (1M Supply) and Vault deployment.
*   **Deployment:** Live launch on Soneium Mainnet and Astar EVM.

### 🚧 Current Quarter (Q4 2025)
*   **Pro Dashboard Release:** Launch of the "Pro" Analytics Dashboard with Simulation Mode and Liquidator Console.
*   **Oracle Hardening:** Integration of redundant feeds for Astar.
*   **Treasury Integration:** Automating the collection of reserve factors (`reserveFactorMantissa`).

### 🔮 Future Outlook (2026)

#### Q1 2026: Phase C - VIBEUSD Stablecoin
*   **Concept:** A native, over-collateralized stablecoin mintable via the Borrow module.
*   **Mechanism:** Inspired by GHO/HOLLAR, maintaining peg via a Stability Module (VSM) and Floor/Ceiling bands.

#### Q2 2026: Phase D - Omnipool Liquidity Router
*   **SoneVibeLiquidityRouter:** An internal router to optimize swaps between liquidity pools during liquidations.
*   **Goal:** Reduce slippage and fragmentation by allowing the liquidation engine to convert collateral directly into debt assets efficiently.

#### Q3 2026: Phase E - AI Risk Manager
*   **SoneVibeRiskManager:** An autonomous contract monitoring global LTV.
*   **Function:** Triggers "Stress Mode" (pausing borrowing or increasing reserve factors) automatically if on-chain volatility metrics exceed safety parameters.

#### Q4 2026: Phase F - Cross-Chain Singularity
*   **XBridge Layer:** Native integration with Wormhole/Axelar/XCM to allow collateral supplied on Soneium to fund borrowing on Astar seamlessly.

---

## 7. Developer Resources

*   **Soneium Mainnet Master:** `0x2F38ecB638DC4fB636A85167C203d791f2809E60`
*   **Astar Mainnet Master:** `0x366472468fe831D57b625d2fBbC90bd5a6184042`
*   **Documentation:** [docs.vibeprotocol.io](https://docs.vibeprotocol.io)
*   **GitHub:** [github.com/vibefinance](https://github.com/vibefinance)

> *Disclaimer: DeFi involves risk. While VIBE Protocol has undergone rigorous testing, users should do their own research and understand the risks of smart contract interaction.*

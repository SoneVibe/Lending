// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../core/V_MasterTypes.sol";

interface IV_MasterEnhanced {
    // ---- Básico ----
    function isComptroller() external view returns (bool);
    function oracle() external view returns (address);

    // ---- Parámetros Globales ----
    function closeFactorMantissa() external view returns (uint256);
    function liquidationIncentiveMantissa() external view returns (uint256);

    // ---- Caps ----
    function marketSupplyCaps(address cToken) external view returns (uint256);
    function marketBorrowCaps(address cToken) external view returns (uint256);

    // ---- Pausas Globales ----
    function borrowPaused() external view returns (bool);
    function redeemPaused() external view returns (bool);
    function liquidatePaused() external view returns (bool);

    // ---- Pausas / Estado por mercado ----
    function mintPaused(address cToken) external view returns (bool);
    function borrowPausedMarket(address cToken) external view returns (bool);
    function redeemPausedMarket(address cToken) external view returns (bool);
    function liquidatePausedMarket(address cToken) external view returns (bool);
    function marketFrozen(address cToken) external view returns (bool);

    // ---- Liquidez / Cuenta ----
    function getAccountLiquidity(address account) external view returns (LiquidityData memory ld);
    function healthFactor(address account) external view returns (uint256 hfMantissa);
    function getHypotheticalAccountLiquidity(
        address account,
        address cTokenModify,
        uint256 redeemCTokens,
        uint256 borrowUnderlying
    ) external view returns (LiquidityData memory ldNew, uint256 hfMantissa, bool allowed);

    // ---- Validaciones cTokens ----
    function canMint(address account, address cToken, uint256 underlyingAmount) external view returns (bool);
    function canBorrow(address account, address cToken, uint256 amount) external view returns (bool);
    function canRedeem(address account, address cToken, uint256 cTokenAmount) external view returns (bool);
    function seizeAllowed(
        address borrower,
        address liquidator,
        address cTokenCollateral,
        address cTokenBorrowed,
        uint256 seizeTokens
    ) external view returns (bool);

    // ---- User borrow cap global ----
    function userBorrowCapGlobalUSD() external view returns (uint256);

    // ---- Rewards (VIBE) datos ----
    function vibeSupplySpeed(address cToken) external view returns (uint256);
    function vibeBorrowSpeed(address cToken) external view returns (uint256);
    function vibeSupplyIndex(address cToken) external view returns (uint256);
    function vibeBorrowIndex(address cToken) external view returns (uint256);
    function vibeAccrued(address user) external view returns (uint256);

    // ---- Rewards (VIBE) acciones (añadidas) ----
    function updateMarketRewards(address cToken) external;
    function distributeSupplier(address supplier, address cToken, uint256 supplierCTokenBalance) external;
    function distributeBorrower(address borrower, address cToken, uint256 borrowerUnderlyingBorrow) external;
    function claimVIBE(address user) external;

    // (Opcional si otros contratos administran velocidades)
    function setVibeRewardSpeeds(address cToken, uint256 supplySpeed, uint256 borrowSpeed) external;

    // ---- Market Data Aggregator ----
    function getMarketData(address cToken) external view returns (MarketData memory md);
    function getAllMarketsData() external view returns (MarketData[] memory arr);
}
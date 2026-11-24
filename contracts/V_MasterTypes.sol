// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Tipos compartidos entre la interfaz y el master.
struct LiquidityData {
    uint256 collateralUSD;
    uint256 liquidationUSD;
    uint256 borrowUSD;
}

struct MarketData {
    bool listed;
    bool frozen;
    bool mintPause;
    bool borrowPause;
    bool redeemPause;
    bool liquidatePause;
    uint256 collateralFactor;
    uint256 liquidationThreshold;
    uint256 supplyCap;
    uint256 borrowCap;
    uint256 supplySpeed;
    uint256 borrowSpeed;
    uint256 supplyIndex;
    uint256 borrowIndex;
}
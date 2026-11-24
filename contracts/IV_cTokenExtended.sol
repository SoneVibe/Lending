// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Interfaz extendida de cToken usada por el Master para índices de recompensas.
interface IV_cTokenExtended {
    // Identidad y metadatos
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);

    // Totales
    function totalSupply() external view returns (uint256);      // cTokens emitidos
    function totalBorrows() external view returns (uint256);     // deuda total underlying (raw)
    function totalReserves() external view returns (uint256);    // reservas underlying (raw)
    function borrowIndex() external view returns (uint256);      // índice global (1e18)

    // Usuario
    function balanceOf(address account) external view returns (uint256);
    function borrowBalance(address account) external view returns (uint256); // deuda con intereses

    // Underlying / Decimales / Exchange rate
    function underlyingAddress() external view returns (address);
    function underlyingDecimals() external view returns (uint8);
    function exchangeRateStored() external view returns (uint256);

    // Funciones principales (no todas necesarias para el Master pero útiles para integraciones)
    function mint(uint256 amount) external;
    function redeem(uint256 cTokenAmount) external;
    function borrow(uint256 amount) external;
    function repay(uint256 amount) external;
    function liquidateBorrow(address borrower, uint256 repayAmount, address cTokenCollateral) external;

    // Preview auxiliar existente
    function previewSeizeTokens(address cTokenCollateral, uint256 repayAmount) external view returns (uint256);
    function peekRates() external view returns (uint borrowRatePerBlock, uint supplyRatePerBlock, uint utilization);
}
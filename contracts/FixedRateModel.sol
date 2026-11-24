// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/**
 * @title FixedRateModel
 * @notice Modelo de interés para mercados Mintable (SVUSD) donde la utilización siempre es 100%.
 * @dev Ignora la liquidez disponible y cobra una tasa fija constante.
 */
contract FixedRateModel {
    /// @notice Indicador para el Comptroller de que esto es un modelo válido
    bool public constant isInterestRateModel = true;

    /// @notice La tasa de interés fija por bloque (escalada 1e18)
    uint256 public immutable borrowRatePerBlock;

    /**
     * @param _borrowRateAnual Tasa anual deseada con 18 decimales (ej. 5% = 50000000000000000)
     * @param _blocksPerYear Bloques aproximados por año (ej. 15768000 para tiempos de 2s)
     */
    constructor(uint256 _borrowRateAnual, uint256 _blocksPerYear) {
        require(_blocksPerYear > 0, "Blocks per year must be > 0");
        // Calculamos la tasa por bloque una sola vez al desplegar (Ahorro de gas en runtime)
        borrowRatePerBlock = _borrowRateAnual / _blocksPerYear;
    }

    /**
     * @notice Calcula la tasa de préstamo actual.
     * @dev Los parámetros cash, borrows y reserves se ignoran intencionalmente.
     * @return La tasa de préstamo por bloque (mantisa 1e18).
     */
    function getBorrowRate(
        uint256, /* cash */
        uint256, /* borrows */
        uint256  /* reserves */
    ) external view returns (uint256) {
        return borrowRatePerBlock;
    }

    /**
     * @notice Calcula la tasa de suministro actual.
     * @dev Para SVUSD Mintable, no hay proveedores de liquidez, por lo que la tasa de suministro es 0.
     * @return Siempre devuelve 0.
     */
    function getSupplyRate(
        uint256, /* cash */
        uint256, /* borrows */
        uint256, /* reserves */
        uint256  /* reserveFactorMantissa */
    ) external pure returns (uint256) {
        return 0;
    }
}
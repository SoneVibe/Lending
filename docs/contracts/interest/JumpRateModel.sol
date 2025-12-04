// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IInterestRateModel.sol";

/**
 * @notice Modelo Jump con opción de pasar tasas anuales y blocksPerYear.
 * Si blocksPerYear > 0: convierte base, slope1, slope2 de anual a por bloque.
 * Si blocksPerYear = 0: asume que ya se pasó todo per-block.
 * Incluye chequeo de máximo borrowRate.
 */
contract JumpRateModel is IInterestRateModel {
    uint256 public immutable baseRatePerBlock;
    uint256 public immutable slope1PerBlock;
    uint256 public immutable slope2PerBlock;
    uint256 public immutable kink; // 1e18
    uint256 public immutable blocksPerYear; // 0 => ya per-block

    constructor(
        uint256 _base,       // anual mantissa si blocksPerYear>0; per-block si blocksPerYear=0
        uint256 _slope1,     // igual
        uint256 _slope2,     // igual
        uint256 _kink,       // 1e18
        uint256 _blocksPerYear
    ) {
        require(_kink <= 1e18, "kink>1");
        kink = _kink;
        blocksPerYear = _blocksPerYear;

        if (_blocksPerYear > 0) {
            require(_blocksPerYear < 100_000_000, "blocksPerYear large");
            baseRatePerBlock  = _base  / _blocksPerYear;
            slope1PerBlock    = _slope1 / _blocksPerYear;
            slope2PerBlock    = _slope2 / _blocksPerYear;
        } else {
            baseRatePerBlock  = _base;
            slope1PerBlock    = _slope1;
            slope2PerBlock    = _slope2;
        }

        uint maxBorrowRate = baseRatePerBlock
            + (kink * slope1PerBlock / 1e18)
            + ((1e18 - kink) * slope2PerBlock / 1e18);
        // Ajusta el límite si tu cToken exige otro:
        require(maxBorrowRate <= 5e13, "max rate too high");
    }

    function isInterestRateModel() external pure returns (bool) {
        return true;
    }

    function _utilization(uint cash, uint borrows, uint reserves) internal pure returns (uint) {
        if (borrows == 0) return 0;
        uint denom = cash + borrows - reserves;
        if (denom == 0) return 0;
        return borrows * 1e18 / denom;
    }

    function getBorrowRate(uint cash, uint borrows, uint reserves) public view override returns (uint) {
        uint u = _utilization(cash, borrows, reserves);
        if (u <= kink) {
            return baseRatePerBlock + (u * slope1PerBlock / 1e18);
        } else {
            uint excess = u - kink;
            return baseRatePerBlock
                + (kink * slope1PerBlock / 1e18)
                + (excess * slope2PerBlock / 1e18);
        }
    }

    function getSupplyRate(
        uint cash,
        uint borrows,
        uint reserves,
        uint reserveFactorMantissa
    ) external view override returns (uint) {
        if (borrows == 0) return 0;
        uint borrowRate = getBorrowRate(cash, borrows, reserves);
        uint u = _utilization(cash, borrows, reserves);
        uint oneMinusReserve = 1e18 - reserveFactorMantissa;
        return borrowRate * u / 1e18 * oneMinusReserve / 1e18;
    }

    // Helpers anuales (solo si blocksPerYear>0)
    function borrowRateAnnual(uint cash, uint borrows, uint reserves) external view returns (uint) {
        if (blocksPerYear == 0) return 0;
        return getBorrowRate(cash, borrows, reserves) * blocksPerYear;
    }

    function supplyRateAnnual(uint cash, uint borrows, uint reserves, uint reserveFactorMantissa) external view returns (uint) {
        if (blocksPerYear == 0) return 0;
        uint sRate = this.getSupplyRate(cash, borrows, reserves, reserveFactorMantissa);
        return sRate * blocksPerYear;
    }
}
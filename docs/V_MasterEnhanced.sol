// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../interfaces/IV_MasterEnhanced.sol";
import "../interfaces/IVibePriceOracle.sol";
import "../interfaces/IV_cTokenMinimal.sol";
import "../interfaces/IV_cTokenExtended.sol";
import "../proxy/V_UnitAdminStorage.sol";
import "./V_MasterEnhancedUnitSupport.sol";
import "./V_MasterTypes.sol";

/*
 * Externo: token VIBE (emisiones y burn controlado)
 */
interface IVibeExternalToken {
    function mintEmission(address to, uint256 amount) external;
    function burn(uint256 amount) external;
    function burnFrom(address from, uint256 amount) external;
    function totalSupply() external view returns (uint256);
    function maxSupply() external view returns (uint256);
}

contract V_MasterEnhanced is V_UnitAdminStorage, V_MasterEnhancedUnitSupport, IV_MasterEnhanced {
    // ======================================================
    // STORAGE (Primer bloque original, mantener orden si hay upgrade nexus)
    // ======================================================
    address public override oracle;
    mapping(address => bool) public markets;
    address[] public allMarkets;
    mapping(address => uint256) public marketCollateralFactorMantissa;
    mapping(address => uint256) public marketLiquidationThresholdMantissa;
    mapping(address => mapping(address => bool)) public accountMembership;
    mapping(address => uint256) public override marketSupplyCaps;
    mapping(address => uint256) public override marketBorrowCaps;
    uint256 public override closeFactorMantissa;
    uint256 public override liquidationIncentiveMantissa;
    address public pauseGuardian;
    bool public borrowPaused;
    bool public redeemPaused;
    bool public liquidatePaused;

    // ======================================================
    // EVENTOS
    // ======================================================
    event MarketListed(address indexed cToken);
    event CollateralFactorUpdated(address indexed cToken, uint256 oldCF, uint256 newCF);
    event LiquidationThresholdUpdated(address indexed cToken, uint256 oldLT, uint256 newLT);
    event MarketEntered(address indexed account, address indexed cToken);
    event MarketExited(address indexed account, address indexed cToken);
    event CapsUpdated(address indexed cToken, uint256 supplyCap, uint256 borrowCap);
    event Initialized(address oracle, address admin);
    event CloseFactorUpdated(uint256 oldCloseFactor, uint256 newCloseFactor);
    event LiquidationIncentiveUpdated(uint256 oldIncentive, uint256 newIncentive);
    event RiskParamsInitialized(uint256 closeFactor, uint256 liquidationIncentive);
    event PauseGuardianUpdated(address indexed oldGuardian, address indexed newGuardian);
    event BorrowPaused(bool paused);
    event RedeemPaused(bool paused);
    event LiquidatePaused(bool paused);

    // Nuevos / extendidos
    event OracleUpdated(address indexed oldOracle, address indexed newOracle);
    event MarketDelisted(address indexed cToken);
    event MarketFrozen(address indexed cToken, bool frozen);
    event MarketPauseUpdated(address indexed cToken, bool mintPaused, bool borrowPaused, bool redeemPaused, bool liquidatePaused);
    event UserBorrowCapGlobalUSDSet(uint256 oldCap, uint256 newCap);
    event VibeRewardSpeedsUpdated(address indexed cToken, uint256 supplySpeed, uint256 borrowSpeed);
    event VibeAccrued(address indexed user, uint256 amount);
    event VibeClaimed(address indexed user, uint256 amount);
    event GovernanceTokenSet(address indexed oldToken, address indexed newToken);
    event TimelockSet(address indexed oldTimelock, address indexed newTimelock);
    event MarketRewardIndexInitialized(address indexed cToken);
    event VibeTokenSet(address indexed oldToken, address indexed newToken);
    event VibeAccruedBurned(address indexed user, uint256 amount);

    // ======================================================
    // ERRORES
    // ======================================================
    error NotAdmin();
    error MarketExists();
    error MarketNotListed();
    error InvalidFactors();
    error AlreadyInitialized();
    error OracleZero();
    error PriceZero();
    error NotMember();
    error ExitUnhealthy();
    error BadAddress();
    error IncentiveOutOfRange();
    error CloseFactorOutOfRange();
    error UnauthorizedDistributor();
    error ExternalTokenNotSet();
    error ZeroAmount();

    // ======================================================
    // MODIFICADORES
    // ======================================================
    modifier onlyAdmin() { if (msg.sender != admin) revert NotAdmin(); _; }

    // ======================================================
    // COMPATIBILIDAD
    // ======================================================
    function isComptroller() external pure override returns (bool) { return true; }

    // ======================================================
    // INICIALIZACIÓN / PARAMETROS DE RIESGO
    // ======================================================
    function initialize(address _oracle) external {
        if (oracle != address(0)) revert AlreadyInitialized();
        if (msg.sender != admin) revert NotAdmin();
        if (_oracle == address(0)) revert OracleZero();
        oracle = _oracle;
        emit Initialized(_oracle, admin);
    }

    function initializeRiskParams(uint256 _closeFactor, uint256 _incentive) external onlyAdmin {
        if (closeFactorMantissa != 0 || liquidationIncentiveMantissa != 0) revert AlreadyInitialized();
        if (_closeFactor == 0 || _closeFactor > 1e18) revert CloseFactorOutOfRange();
        if (_incentive < 1e18 || _incentive > 1.2e18) revert IncentiveOutOfRange();
        emit CloseFactorUpdated(closeFactorMantissa, _closeFactor);
        emit LiquidationIncentiveUpdated(liquidationIncentiveMantissa, _incentive);
        closeFactorMantissa = _closeFactor;
        liquidationIncentiveMantissa = _incentive;
        emit RiskParamsInitialized(_closeFactor, _incentive);
    }

    function setCloseFactor(uint256 newCloseFactor) external onlyAdmin {
        if (newCloseFactor == 0 || newCloseFactor > 1e18) revert CloseFactorOutOfRange();
        emit CloseFactorUpdated(closeFactorMantissa, newCloseFactor);
        closeFactorMantissa = newCloseFactor;
    }

    function setLiquidationIncentive(uint256 newIncentive) external onlyAdmin {
        if (newIncentive < 1e18 || newIncentive > 1.2e18) revert IncentiveOutOfRange();
        emit LiquidationIncentiveUpdated(liquidationIncentiveMantissa, newIncentive);
        liquidationIncentiveMantissa = newIncentive;
    }

    function setOracle(address newOracle) external onlyAdmin {
        if (newOracle == address(0)) revert OracleZero();
        emit OracleUpdated(oracle, newOracle);
        oracle = newOracle;
    }

    // ======================================================
    // GUARDIAN / PAUSAS GLOBALES
    // ======================================================
    function setPauseGuardian(address g) external onlyAdmin {
        if (g == address(0)) revert BadAddress();
        emit PauseGuardianUpdated(pauseGuardian, g);
        pauseGuardian = g;
    }
    function setBorrowPaused(bool paused) external {
        if (msg.sender != admin && !(msg.sender == pauseGuardian && paused)) revert NotAdmin();
        borrowPaused = paused;
        emit BorrowPaused(paused);
    }
    function setRedeemPaused(bool paused) external {
        if (msg.sender != admin && !(msg.sender == pauseGuardian && paused)) revert NotAdmin();
        redeemPaused = paused;
        emit RedeemPaused(paused);
    }
    function setLiquidatePaused(bool paused) external {
        if (msg.sender != admin && !(msg.sender == pauseGuardian && paused)) revert NotAdmin();
        liquidatePaused = paused;
        emit LiquidatePaused(paused);
    }

    // ======================================================
    // MERCADOS
    // ======================================================
    function supportMarket(address cToken) external onlyAdmin {
        if (markets[cToken]) revert MarketExists();
        markets[cToken] = true;
        allMarkets.push(cToken);
        emit MarketListed(cToken);
        _initRewardIndices(cToken);
    }

    function setFactors(address cToken, uint256 cf, uint256 lt) external onlyAdmin {
        if (!markets[cToken]) revert MarketNotListed();
        if (cf > 0.9e18 || lt > 0.95e18 || lt < cf) revert InvalidFactors();
        emit CollateralFactorUpdated(cToken, marketCollateralFactorMantissa[cToken], cf);
        emit LiquidationThresholdUpdated(cToken, marketLiquidationThresholdMantissa[cToken], lt);
        marketCollateralFactorMantissa[cToken] = cf;
        marketLiquidationThresholdMantissa[cToken] = lt;
    }

    function setCaps(address cToken, uint256 supplyCapUnderlying, uint256 borrowCapUnderlying) external onlyAdmin {
        marketSupplyCaps[cToken] = supplyCapUnderlying;
        marketBorrowCaps[cToken] = borrowCapUnderlying;
        emit CapsUpdated(cToken, supplyCapUnderlying, borrowCapUnderlying);
    }

    function delistMarket(address cToken) external onlyAdmin {
        if (!markets[cToken]) revert MarketNotListed();
        markets[cToken] = false;
        emit MarketDelisted(cToken);
    }

    function setMarketFrozen(address cToken, bool frozen) external onlyAdmin {
        if (!markets[cToken]) revert MarketNotListed();
        marketFrozen[cToken] = frozen;
        emit MarketFrozen(cToken, frozen);
    }

    function setMarketPauses(
        address cToken,
        bool mintP,
        bool borrowP,
        bool redeemP,
        bool liquidateP
    ) external onlyAdmin {
        if (!markets[cToken]) revert MarketNotListed();
        mintPaused[cToken] = mintP;
        borrowPausedMarket[cToken] = borrowP;
        redeemPausedMarket[cToken] = redeemP;
        liquidatePausedMarket[cToken] = liquidateP;
        emit MarketPauseUpdated(cToken, mintP, borrowP, redeemP, liquidateP);
    }

    // ======================================================
    // MEMBERSHIP
    // ======================================================
    function enterMarkets(address[] calldata cTokens) external {
        for (uint i; i < cTokens.length; i++) {
            if (!markets[cTokens[i]]) revert MarketNotListed();
            accountMembership[msg.sender][cTokens[i]] = true;
            emit MarketEntered(msg.sender, cTokens[i]);
        }
    }

    function exitMarket(address cToken) external {
        if (!accountMembership[msg.sender][cToken]) revert NotMember();
        accountMembership[msg.sender][cToken] = false;
        if (!_isAccountHealthy(msg.sender)) revert ExitUnhealthy();
        emit MarketExited(msg.sender, cToken);
    }

    function getAssetsIn(address account) public view returns (address[] memory list) {
        uint count;
        for (uint i; i < allMarkets.length; i++)
            if (accountMembership[account][allMarkets[i]]) count++;
        list = new address[](count);
        uint idx;
        for (uint i; i < allMarkets.length; i++)
            if (accountMembership[account][allMarkets[i]]) list[idx++] = allMarkets[i];
    }

    // ======================================================
    // LIQUIDEZ
    // ======================================================
    function getAccountLiquidity(address account) public view override returns (LiquidityData memory ld) {
        for (uint i; i < allMarkets.length; i++) {
            address m = allMarkets[i];
            if (!markets[m]) continue;
            IV_cTokenMinimal ct = IV_cTokenMinimal(m);
            uint256 price = IVibePriceOracle(oracle).getUnderlyingPrice(m);
             // >>> FIX START (only change): handle price==0 safely when there is debt
            if (price == 0) {
                if (ct.borrowBalance(account) > 0) revert PriceZero();
                continue;
            }
            // >>> FIX END
            uint256 bal = ct.balanceOf(account);
            uint256 bor = ct.borrowBalance(account);
            uint8 dec = ct.underlyingDecimals();
            uint256 exRate = ct.exchangeRateStored();

            if (bal > 0 && accountMembership[account][m]) {
                uint256 underlyingSupplied = (bal * exRate) / 1e18;
                uint256 valueUSD = (underlyingSupplied * price) / 1e18;
                ld.collateralUSD += (valueUSD * marketCollateralFactorMantissa[m]) / 1e18;
                ld.liquidationUSD += (valueUSD * marketLiquidationThresholdMantissa[m]) / 1e18;
            }
            if (bor > 0) {
                uint256 borrowVal = (bor * price) / (10 ** uint256(dec));
                ld.borrowUSD += borrowVal;
            }
        }
    }

    function _isAccountHealthy(address account) internal view returns (bool) {
        LiquidityData memory ld = getAccountLiquidity(account);
        return ld.borrowUSD <= ld.liquidationUSD;
    }

    // ======================================================
    // VALIDACIONES
    // ======================================================
    function canMint(address /*account*/, address cToken, uint256 underlyingAmount) external view override returns (bool) {
        if (mintPaused[cToken]) return false;
        if (marketFrozen[cToken]) return false;
        if (!markets[cToken]) return false;
        uint256 cap = marketSupplyCaps[cToken];
        if (cap != 0 && underlyingAmount > cap) return false;
        return true;
    }

    function canBorrow(address account, address cToken, uint256 amount) external view override returns (bool) {
        if (borrowPaused) return false;
        if (borrowPausedMarket[cToken]) return false;
        if (marketFrozen[cToken]) return false;
        if (!accountMembership[account][cToken]) return false;
        if (!markets[cToken]) return false;

        LiquidityData memory ld = getAccountLiquidity(account);
        IV_cTokenMinimal ct = IV_cTokenMinimal(cToken);
        uint8 dec = ct.underlyingDecimals();
        uint256 price = IVibePriceOracle(oracle).getUnderlyingPrice(cToken);
        if (price == 0) return false;

        uint256 amountUSD = (amount * price) / (10 ** uint256(dec));
        if (userBorrowCapGlobalUSD != 0 && ld.borrowUSD + amountUSD > userBorrowCapGlobalUSD) return false;
        return ld.collateralUSD >= ld.borrowUSD + amountUSD;
    }

    function canRedeem(address account, address cToken, uint256 cTokenAmount) external view override returns (bool) {
        if (redeemPaused) return false;
        if (redeemPausedMarket[cToken]) return false;
        if (!markets[cToken]) return false;

        IV_cTokenMinimal ct = IV_cTokenMinimal(cToken);
        if (!accountMembership[account][cToken]) {
            return cTokenAmount <= ct.balanceOf(account);
        }

        LiquidityData memory ldBefore = getAccountLiquidity(account);
        uint256 price = IVibePriceOracle(oracle).getUnderlyingPrice(cToken);
        if (price == 0) return false;

        uint256 exRate = ct.exchangeRateStored();
        uint256 underlyingRedeem = (cTokenAmount * exRate) / 1e18;
        uint256 valueUSDFull = (underlyingRedeem * price) / 1e18;

        uint256 cf = marketCollateralFactorMantissa[cToken];
        uint256 lt = marketLiquidationThresholdMantissa[cToken];

        uint256 cfDelta = (valueUSDFull * cf) / 1e18;
        if (cfDelta > ldBefore.collateralUSD) return false;
        uint256 ltDelta = (valueUSDFull * lt) / 1e18;
        if (ltDelta > ldBefore.liquidationUSD) return false;

        uint256 newLiqUSD = ldBefore.liquidationUSD - ltDelta;
        uint256 newColUSD = ldBefore.collateralUSD - cfDelta;

        return ldBefore.borrowUSD <= newLiqUSD && newColUSD >= ldBefore.borrowUSD;
    }

    function seizeAllowed(
        address borrower,
        address /*liquidator*/,
        address cTokenCollateral,
        address cTokenBorrowed,
        uint256
    ) external view override returns (bool) {
        if (liquidatePaused) return false;
        if (liquidatePausedMarket[cTokenBorrowed] || liquidatePausedMarket[cTokenCollateral]) return false;
        if (!markets[cTokenBorrowed] || !markets[cTokenCollateral]) return false;
        LiquidityData memory ld = getAccountLiquidity(borrower);
        return ld.borrowUSD > ld.liquidationUSD;
    }

    // ======================================================
    // PREVIEWS
    // ======================================================
    function previewCloseFactorMaxRepay(address cTokenBorrowed, address borrower) external view returns (uint256) {
        IV_cTokenMinimal ct = IV_cTokenMinimal(cTokenBorrowed);
        uint256 debt = ct.borrowBalance(borrower);
        if (debt == 0) return 0;
        return (debt * closeFactorMantissa) / 1e18;
    }

    function previewSeizeTokens(address cTokenBorrowed, address cTokenCollateral, uint256 repayAmount)
        external
        view
        returns (uint256 seizeCTokens, uint256 seizeUnderlyingRaw, uint256 seizeUSD)
    {
        IVibePriceOracle o = IVibePriceOracle(oracle);
        uint256 priceBorrowed = o.getUnderlyingPrice(cTokenBorrowed);
        if (priceBorrowed == 0) revert PriceZero();
        uint256 priceCollateral = o.getUnderlyingPrice(cTokenCollateral);
        if (priceCollateral == 0) revert PriceZero();

        uint8 decBorrow = IV_cTokenMinimal(cTokenBorrowed).underlyingDecimals();
        uint256 repayUSD = (repayAmount * priceBorrowed) / (10 ** uint256(decBorrow));
        if (liquidationIncentiveMantissa < 1e18) revert IncentiveOutOfRange();
        seizeUSD = (repayUSD * liquidationIncentiveMantissa) / 1e18;

        uint8 decCol = IV_cTokenMinimal(cTokenCollateral).underlyingDecimals();
        seizeUnderlyingRaw = (seizeUSD * (10 ** uint256(decCol))) / priceCollateral;

        uint256 normalized = decCol < 18
            ? seizeUnderlyingRaw * (10 ** (18 - decCol))
            : (decCol > 18 ? seizeUnderlyingRaw / (10 ** (decCol - 18)) : seizeUnderlyingRaw);

        uint256 exRateCol = IV_cTokenMinimal(cTokenCollateral).exchangeRateStored();
        seizeCTokens = (normalized * 1e18) / exRateCol;
    }

    // ======================================================
    // HEALTH FACTOR
    // ======================================================
    function healthFactor(address account) external view override returns (uint256 hfMantissa) {
        LiquidityData memory ld = getAccountLiquidity(account);
        if (ld.borrowUSD == 0) return type(uint256).max;
        return (ld.liquidationUSD * 1e18) / ld.borrowUSD;
    }

    // ======================================================
    // HIPOTÉTICA
    // ======================================================
    function _applyRedeemHypothetical(
        LiquidityData memory ld,
        address account,
        address cToken,
        uint256 redeemCTokens
    ) internal view returns (LiquidityData memory) {
        if (redeemCTokens == 0) return ld;
        if (!accountMembership[account][cToken]) return ld;
        IV_cTokenMinimal ct = IV_cTokenMinimal(cToken);
        uint256 price = IVibePriceOracle(oracle).getUnderlyingPrice(cToken);
        if (price == 0) return ld;
        uint256 exRate = ct.exchangeRateStored();
        uint256 underlyingRedeem = (redeemCTokens * exRate) / 1e18;
        uint256 valueUSDFull = (underlyingRedeem * price) / 1e18;
        uint256 cf = marketCollateralFactorMantissa[cToken];
        uint256 lt = marketLiquidationThresholdMantissa[cToken];
        uint256 cfDelta = (valueUSDFull * cf) / 1e18;
        uint256 ltDelta = (valueUSDFull * lt) / 1e18;
        if (cfDelta > ld.collateralUSD || ltDelta > ld.liquidationUSD) {
            ld.collateralUSD = 0;
            ld.liquidationUSD = 0;
        } else {
            ld.collateralUSD -= cfDelta;
            ld.liquidationUSD -= ltDelta;
        }
        return ld;
    }

    function _applyBorrowHypothetical(
        LiquidityData memory ld,
        address cToken,
        uint256 borrowUnderlying
    ) internal view returns (LiquidityData memory) {
        if (borrowUnderlying == 0) return ld;
        IV_cTokenMinimal ct = IV_cTokenMinimal(cToken);
        uint256 price = IVibePriceOracle(oracle).getUnderlyingPrice(cToken);
        if (price == 0) return ld;
        uint8 dec = ct.underlyingDecimals();
        uint256 borrowUSDDelta = (borrowUnderlying * price) / (10 ** uint256(dec));
        ld.borrowUSD += borrowUSDDelta;
        return ld;
    }

    function getHypotheticalAccountLiquidity(
        address account,
        address cTokenModify,
        uint256 redeemCTokens,
        uint256 borrowUnderlying
    ) external view override returns (LiquidityData memory ldNew, uint256 hfMantissa, bool allowed) {
        LiquidityData memory ldBefore = getAccountLiquidity(account);
        ldNew = ldBefore;
        if (redeemCTokens > 0 || borrowUnderlying > 0) {
            if (!markets[cTokenModify]) revert MarketNotListed();
            ldNew = _applyRedeemHypothetical(ldNew, account, cTokenModify, redeemCTokens);
            ldNew = _applyBorrowHypothetical(ldNew, cTokenModify, borrowUnderlying);
        }
        hfMantissa = (ldNew.borrowUSD == 0) ? type(uint256).max : (ldNew.liquidationUSD * 1e18) / ldNew.borrowUSD;
        allowed = ldNew.borrowUSD <= ldNew.liquidationUSD;
    }

    // ======================================================
    // GLOBAL USER BORROW CAP
    // ======================================================
    uint256 public userBorrowCapGlobalUSD;
    function setUserBorrowCapGlobalUSD(uint256 cap) external onlyAdmin {
        emit UserBorrowCapGlobalUSDSet(userBorrowCapGlobalUSD, cap);
        userBorrowCapGlobalUSD = cap;
    }

    // ======================================================
    // PAUSAS / FREEZE POR MERCADO
    // ======================================================
    mapping(address => bool) public mintPaused;
    mapping(address => bool) public borrowPausedMarket;
    mapping(address => bool) public redeemPausedMarket;
    mapping(address => bool) public liquidatePausedMarket;
    mapping(address => bool) public marketFrozen;

    // ======================================================
    // RECOMPENSAS (Índices + speeds)
    // ======================================================
    mapping(address => uint256) public vibeSupplySpeed;
    mapping(address => uint256) public vibeBorrowSpeed;
    mapping(address => uint256) public vibeSupplyIndex;
    mapping(address => uint256) public vibeBorrowIndex;
    uint256 public constant VIBE_INITIAL_INDEX = 1e36;
    mapping(address => uint256) public lastRewardBlock;
    mapping(address => mapping(address => uint256)) public userSupplyIndex;
    mapping(address => mapping(address => uint256)) public userBorrowIndex;
    mapping(address => uint256) public vibeAccrued;

    // Gobernanza / control
    address public governanceToken;
    address public timelock;
    address public vibeTokenExternal;

    function setGovernanceToken(address token) external onlyAdmin {
        emit GovernanceTokenSet(governanceToken, token);
        governanceToken = token;
    }
    function setTimelock(address _timelock) external onlyAdmin {
        emit TimelockSet(timelock, _timelock);
        timelock = _timelock;
    }
    function setVibeToken(address token) external onlyAdmin {
        emit VibeTokenSet(vibeTokenExternal, token);
        vibeTokenExternal = token;
    }

    function _initRewardIndices(address cToken) internal {
        if (vibeSupplyIndex[cToken] == 0) {
            vibeSupplyIndex[cToken] = VIBE_INITIAL_INDEX;
            vibeBorrowIndex[cToken] = VIBE_INITIAL_INDEX;
            lastRewardBlock[cToken] = block.number;
            emit MarketRewardIndexInitialized(cToken);
        }
    }

    function setVibeRewardSpeeds(address cToken, uint256 supplySpeed, uint256 borrowSpeed) external onlyAdmin {
        if (!markets[cToken]) revert MarketNotListed();
        _initRewardIndices(cToken);
        _updateMarketRewardIndices(cToken);
        vibeSupplySpeed[cToken] = supplySpeed;
        vibeBorrowSpeed[cToken] = borrowSpeed;
        emit VibeRewardSpeedsUpdated(cToken, supplySpeed, borrowSpeed);
    }

    function updateMarketRewards(address cToken) external {
        if (!markets[cToken]) revert MarketNotListed();
        _updateMarketRewardIndices(cToken);
    }

    function _updateMarketRewardIndices(address cToken) internal {
        uint256 blockDelta = block.number - lastRewardBlock[cToken];
        if (blockDelta == 0) return;
        if (vibeSupplyIndex[cToken] == 0) { _initRewardIndices(cToken); return; }

        uint256 totalSupplyCTokens = IV_cTokenExtended(cToken).totalSupply();
        uint256 totalBorrowsUnderlying = IV_cTokenExtended(cToken).totalBorrows();

        if (totalSupplyCTokens > 0 && vibeSupplySpeed[cToken] > 0) {
            uint256 supplyAccrued = vibeSupplySpeed[cToken] * blockDelta;
            uint256 ratio = (supplyAccrued * 1e36) / totalSupplyCTokens;
            vibeSupplyIndex[cToken] += ratio;
        }
        if (totalBorrowsUnderlying > 0 && vibeBorrowSpeed[cToken] > 0) {
            uint256 borrowAccrued = vibeBorrowSpeed[cToken] * blockDelta;
            uint256 ratioB = (borrowAccrued * 1e36) / totalBorrowsUnderlying;
            vibeBorrowIndex[cToken] += ratioB;
        }
        lastRewardBlock[cToken] = block.number;
    }

    function distributeSupplier(address supplier, address cToken, uint256 supplierCTokenBalance) external {
        if (msg.sender != cToken) revert UnauthorizedDistributor();
        _distributeUserSupply(supplier, cToken, supplierCTokenBalance);
    }

    function distributeBorrower(address borrower, address cToken, uint256 borrowerUnderlyingBorrow) external {
        if (msg.sender != cToken) revert UnauthorizedDistributor();
        _distributeUserBorrow(borrower, cToken, borrowerUnderlyingBorrow);
    }

    function _distributeUserSupply(address user, address cToken, uint256 userBalanceCTokens) internal {
        uint256 index = vibeSupplyIndex[cToken];
        uint256 stored = userSupplyIndex[user][cToken];
        if (stored == 0) { userSupplyIndex[user][cToken] = index; return; }
        if (index > stored) {
            uint256 delta = index - stored;
            uint256 accrued = (userBalanceCTokens * delta) / 1e36;
            if (accrued > 0) {
                vibeAccrued[user] += accrued;
                emit VibeAccrued(user, accrued);
            }
            userSupplyIndex[user][cToken] = index;
        }
    }

    function _distributeUserBorrow(address user, address cToken, uint256 userBorrowUnderlying) internal {
        uint256 index = vibeBorrowIndex[cToken];
        uint256 stored = userBorrowIndex[user][cToken];
        if (stored == 0) { userBorrowIndex[user][cToken] = index; return; }
        if (index > stored) {
            uint256 delta = index - stored;
            uint256 accrued = (userBorrowUnderlying * delta) / 1e36;
            if (accrued > 0) {
                vibeAccrued[user] += accrued;
                emit VibeAccrued(user, accrued);
            }
            userBorrowIndex[user][cToken] = index;
        }
    }

    function claimVIBE(address user) external {
        uint256 accrued = vibeAccrued[user];
        if (accrued == 0) return;
        vibeAccrued[user] = 0;
        if (vibeTokenExternal == address(0)) revert ExternalTokenNotSet();
        IVibeExternalToken(vibeTokenExternal).mintEmission(user, accrued);
        emit VibeClaimed(user, accrued);
    }

    function burnAccrued(address user, uint256 amount) external onlyAdmin {
        uint256 accrued = vibeAccrued[user];
        if (amount == 0) revert ZeroAmount();
        if (amount > accrued) amount = accrued;
        vibeAccrued[user] = accrued - amount;
        if (vibeTokenExternal == address(0)) revert ExternalTokenNotSet();
        IVibeExternalToken(vibeTokenExternal).mintEmission(address(this), amount);
        IVibeExternalToken(vibeTokenExternal).burn(amount);
        emit VibeAccruedBurned(user, amount);
    }

    // ======================================================
    // APR (sin precio dinámico; ajustar cuando integres oráculo de VIBE)
    // ======================================================
    function getRewardAPR(address cToken) external view returns (uint256 supplyAPRMantissa, uint256 borrowAPRMantissa) {
        uint256 supplySpeed = vibeSupplySpeed[cToken];
        uint256 borrowSpeed = vibeBorrowSpeed[cToken];
        if (supplySpeed == 0 && borrowSpeed == 0) return (0, 0);

        uint256 blocksPerYear = 15_768_000; // Ajustar según red real.
        uint256 totalSupplyCTokens = IV_cTokenExtended(cToken).totalSupply();
        if (totalSupplyCTokens > 0 && supplySpeed > 0) {
            supplyAPRMantissa = (supplySpeed * blocksPerYear * 1e18) / totalSupplyCTokens;
        }
        uint256 totalBorrowsUnderlying = IV_cTokenExtended(cToken).totalBorrows();
        if (totalBorrowsUnderlying > 0 && borrowSpeed > 0) {
            borrowAPRMantissa = (borrowSpeed * blocksPerYear * 1e18) / totalBorrowsUnderlying;
        }
    }

    // ======================================================
    // MARKET DATA
    // ======================================================
    function getMarketData(address cToken) external view override returns (MarketData memory md) {
        md.listed = markets[cToken];
        md.frozen = marketFrozen[cToken];
        md.mintPause = mintPaused[cToken];
        md.borrowPause = borrowPausedMarket[cToken];
        md.redeemPause = redeemPausedMarket[cToken];
        md.liquidatePause = liquidatePausedMarket[cToken];
        md.collateralFactor = marketCollateralFactorMantissa[cToken];
        md.liquidationThreshold = marketLiquidationThresholdMantissa[cToken];
        md.supplyCap = marketSupplyCaps[cToken];
        md.borrowCap = marketBorrowCaps[cToken];
        md.supplySpeed = vibeSupplySpeed[cToken];
        md.borrowSpeed = vibeBorrowSpeed[cToken];
        md.supplyIndex = vibeSupplyIndex[cToken];
        md.borrowIndex = vibeBorrowIndex[cToken];
    }

    function getAllMarketsData() external view override returns (MarketData[] memory arr) {
        arr = new MarketData[](allMarkets.length);
        for (uint i; i < allMarkets.length; i++) {
            arr[i] = MarketData({
                listed: markets[allMarkets[i]],
                frozen: marketFrozen[allMarkets[i]],
                mintPause: mintPaused[allMarkets[i]],
                borrowPause: borrowPausedMarket[allMarkets[i]],
                redeemPause: redeemPausedMarket[allMarkets[i]],
                liquidatePause: liquidatePausedMarket[allMarkets[i]],
                collateralFactor: marketCollateralFactorMantissa[allMarkets[i]],
                liquidationThreshold: marketLiquidationThresholdMantissa[allMarkets[i]],
                supplyCap: marketSupplyCaps[allMarkets[i]],
                borrowCap: marketBorrowCaps[allMarkets[i]],
                supplySpeed: vibeSupplySpeed[allMarkets[i]],
                borrowSpeed: vibeBorrowSpeed[allMarkets[i]],
                supplyIndex: vibeSupplyIndex[allMarkets[i]],
                borrowIndex: vibeBorrowIndex[allMarkets[i]]
            });
        }
    }

    // ======================================================
    // MAX OPERATIONS
    // ======================================================
    function getMaxBorrow(address account, address cToken) external view returns (uint256 maxUnderlying) {
        if (!markets[cToken]) return 0;
        if (borrowPaused || borrowPausedMarket[cToken] || marketFrozen[cToken]) return 0;
        if (!accountMembership[account][cToken]) return 0;

        LiquidityData memory ld = getAccountLiquidity(account);
        IV_cTokenMinimal ct = IV_cTokenMinimal(cToken);
        uint256 price = IVibePriceOracle(oracle).getUnderlyingPrice(cToken);
        if (price == 0) return 0;
        uint8 dec = ct.underlyingDecimals();

        if (ld.collateralUSD <= ld.borrowUSD) return 0;
        uint256 availableCollateralUSD = ld.collateralUSD - ld.borrowUSD;
        uint256 maxFromCollateral = (availableCollateralUSD * (10 ** uint256(dec))) / price;

        uint256 cap = marketBorrowCaps[cToken];
        if (cap != 0) {
            uint256 currentBorrows = IV_cTokenExtended(cToken).totalBorrows();
            if (currentBorrows >= cap) return 0;
            uint256 remainingCap = cap - currentBorrows;
            if (remainingCap < maxFromCollateral) maxFromCollateral = remainingCap;
        }

        if (userBorrowCapGlobalUSD != 0 && ld.borrowUSD < userBorrowCapGlobalUSD) {
            uint256 remainingGlobalUSD = userBorrowCapGlobalUSD - ld.borrowUSD;
            uint256 globalLimitUnderlying = (remainingGlobalUSD * (10 ** uint256(dec))) / price;
            if (globalLimitUnderlying < maxFromCollateral) maxFromCollateral = globalLimitUnderlying;
        } else if (userBorrowCapGlobalUSD != 0) {
            return 0;
        }

        return maxFromCollateral;
    }

    function getMaxRedeem(address account, address cToken) external view returns (uint256 maxCTokens) {
        if (!markets[cToken]) return 0;
        if (redeemPaused || redeemPausedMarket[cToken]) return 0;

        IV_cTokenMinimal ct = IV_cTokenMinimal(cToken);
        uint256 balanceCTokens = ct.balanceOf(account);
        if (balanceCTokens == 0) return 0;

        if (!accountMembership[account][cToken]) return balanceCTokens;

        LiquidityData memory ld = getAccountLiquidity(account);
        uint256 price = IVibePriceOracle(oracle).getUnderlyingPrice(cToken);
        if (price == 0) return 0;
        uint256 exRate = ct.exchangeRateStored();
        uint256 cf = marketCollateralFactorMantissa[cToken];
        uint256 lt = marketLiquidationThresholdMantissa[cToken];

        if (ld.borrowUSD == 0) return balanceCTokens;

        uint256 maxByLT = (ld.liquidationUSD > ld.borrowUSD && lt > 0)
            ? ((ld.liquidationUSD - ld.borrowUSD) * 1e18) / lt
            : 0;
        uint256 maxByCF = (ld.collateralUSD > ld.borrowUSD && cf > 0)
            ? ((ld.collateralUSD - ld.borrowUSD) * 1e18) / cf
            : 0;

        uint256 valueUSDAllowed = maxByLT < maxByCF ? maxByLT : maxByCF;
        if (valueUSDAllowed == 0) return 0;

        uint256 underlyingAllowed = (valueUSDAllowed * 1e18) / price;
        uint256 cTokensAllowed = (underlyingAllowed * 1e18) / exRate;
        if (cTokensAllowed > balanceCTokens) cTokensAllowed = balanceCTokens;
        return cTokensAllowed;
    }
}
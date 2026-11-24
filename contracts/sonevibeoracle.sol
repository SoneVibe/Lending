// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

// Interfaz para interactuar con los Feeds de Chainlink
interface AggregatorV3Interface {
    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    );
    function decimals() external view returns (uint8);
}

// Interfaz específica para el Uptime Feed del Secuenciador en L2
interface AggregatorV2V3Interface {
    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    );
}

interface IV_cTokenMinimalUnderlyingResolver {
    function underlying() external view returns (address);
}

interface IV_cTokenUnderlyingAddress {
    function underlyingAddress() external view returns (address);
}

contract ViveOracleHybridV3 {
    // Sources: CHAINLINK (primario), MANUAL (fallback/emergencia)
    enum PriceSource { NONE, CHAINLINK, MANUAL, FORCED_MANUAL }

    address public admin;
    
    // ======================================================
    // Configuración L2 (Soneium / OP Stack)
    // ======================================================
    // Dirección del Feed de Uptime del Secuenciador (Chainlink L2 Sequencer Uptime Feed)
    AggregatorV2V3Interface public sequencerUptimeFeed;
    
    // Periodo de gracia tras el reinicio del secuenciador antes de aceptar precios (ej. 3600 segundos)
    uint256 public sequencerGracePeriod;

    // ======================================================
    // Parámetros Generales
    // ======================================================
    uint256 public maxStalenessDefault;    // Tiempo máximo sin actualizar antes de considerar el precio obsoleto
    uint256 public maxDeviationBpsDefault; // Desviación máxima permitida entre Chainlink y Manual (base 10_000)

    // Overrides por activo
    mapping(address => uint256) public maxStalenessAsset;    // 0 => usa default
    mapping(address => uint256) public maxDeviationBpsAsset; // 0 => usa default
    
    // Si true, y hay una desviación excesiva, se usa el precio Manual en lugar de revertir.
    mapping(address => bool)    public preferManualOnDeviation; 

    // Mapeos de Feeds y Precios
    mapping(address => address) public feeds;        // underlying -> chainlink feed
    mapping(address => uint256) public manualPrices; // precio 1e18 (fijo)

    // Eventos
    event FeedSet(address indexed token, address indexed feed);
    event ManualPriceSet(address indexed token, uint256 price);
    event AdminTransferred(address indexed oldAdmin, address indexed newAdmin);
    event ParamsUpdated(uint256 maxStalenessDefault, uint256 maxDeviationBpsDefault);
    event AssetParamsUpdated(address indexed token, uint256 staleness, uint256 deviationBps, bool preferManual);
    event SequencerConfigUpdated(address indexed newFeed, uint256 newGracePeriod);

    // Errores Custom
    error NotAdmin();
    error SequencerDown();
    error GracePeriodNotOver();
    error InvalidPrice();
    error StalePrice();
    error BadDeviation();

    modifier onlyAdmin() { 
        if(msg.sender != admin) revert NotAdmin(); 
        _; 
    }

    constructor(
        uint256 _staleness, 
        uint256 _devBps, 
        address _sequencerFeed, 
        uint256 _gracePeriod
    ) {
        admin = msg.sender;
        maxStalenessDefault = _staleness;
        maxDeviationBpsDefault = _devBps;
        sequencerUptimeFeed = AggregatorV2V3Interface(_sequencerFeed);
        sequencerGracePeriod = _gracePeriod;
    }

    // ======================================================
    // Administración
    // ======================================================

    function transferAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "oracle: zero");
        emit AdminTransferred(admin, newAdmin);
        admin = newAdmin;
    }

    function setSequencerConfig(address _feed, uint256 _gracePeriod) external onlyAdmin {
        sequencerUptimeFeed = AggregatorV2V3Interface(_feed);
        sequencerGracePeriod = _gracePeriod;
        emit SequencerConfigUpdated(_feed, _gracePeriod);
    }

    function setFeed(address token, address feed) external onlyAdmin {
        feeds[token] = feed;
        emit FeedSet(token, feed);
    }

    function setManualPrice(address token, uint256 price) external onlyAdmin {
        manualPrices[token] = price;
        emit ManualPriceSet(token, price);
    }

    function setParams(uint256 _staleness, uint256 _devBps) external onlyAdmin {
        maxStalenessDefault = _staleness;
        maxDeviationBpsDefault = _devBps;
        emit ParamsUpdated(_staleness, _devBps);
    }

    function setAssetParams(address token, uint256 staleness, uint256 deviationBps, bool preferManual) external onlyAdmin {
        maxStalenessAsset[token] = staleness;
        maxDeviationBpsAsset[token] = deviationBps;
        preferManualOnDeviation[token] = preferManual;
        emit AssetParamsUpdated(token, staleness, deviationBps, preferManual);
    }

    // ======================================================
    // Lógica de Precios (Core)
    // ======================================================

    /// @notice Verifica el estado del secuenciador L2. Revierta si está caído.
    function _checkSequencer() internal view {
        if (address(sequencerUptimeFeed) != address(0)) {
            (
                /*uint80 roundId*/,
                int256 answer,
                uint256 startedAt,
                /*uint256 updatedAt*/,
                /*uint80 answeredInRound*/
            ) = sequencerUptimeFeed.latestRoundData();

            // Answer == 0: Sequencer UP
            // Answer == 1: Sequencer DOWN
            if (answer == 1) revert SequencerDown();
            
            // Asegurarse de que haya pasado el tiempo de gracia desde que volvió a estar UP
            if (block.timestamp - startedAt <= sequencerGracePeriod) revert GracePeriodNotOver();
        }
    }

    function getRawFeedPrice(address asset) public view returns (uint256 feedPrice) {
        // Verificar Secuenciador antes de llamar a Chainlink
        _checkSequencer();

        address token = _resolveUnderlying(asset);
        address feed = feeds[token];
        
        // Si no hay feed, retornamos 0 (fallo suave para que getUnderlyingPrice decida)
        if (feed == address(0)) return 0;

        try AggregatorV3Interface(feed).latestRoundData() returns (
            uint80 roundId,
            int256 answer,
            uint256 /*startedAt*/,
            uint256 updatedAt,
            uint80 answeredInRound
        ) {
            // Validaciones de Robustez de Chainlink
            if (answer <= 0) revert InvalidPrice();
            if (updatedAt == 0 || answeredInRound < roundId) revert StalePrice();
            
            // Chequeo de Staleness (tiempo)
            if (!_notStale(token, updatedAt)) revert StalePrice();

            uint8 dec = AggregatorV3Interface(feed).decimals();
            feedPrice = _scale(uint256(answer), dec);

        } catch {
            // Si la llamada falla, retornamos 0 para intentar fallback
            return 0;
        }
    }

    // Principal: retorna precio 1e18
    function getUnderlyingPrice(address asset) public view returns (uint256) {
        address token = _resolveUnderlying(asset);
        uint256 manual = manualPrices[token];

        // 1. Intentar obtener precio de Chainlink (incluye chequeo de secuenciador)
        // Usamos try/catch interno o confiamos en que getRawFeedPrice revierta si el secuenciador está mal
        // NOTA: Para seguridad máxima, si el secuenciador está mal, getRawFeedPrice revierte y detiene todo.
        // Esto es deseado: no queremos operar con precios viejos ni manuales si la red está inestable, 
        // A MENOS que sea una emergencia manual explicita.
        
        uint256 chainlinkPrice;
        try this.getRawFeedPrice(asset) returns (uint256 cp) {
            chainlinkPrice = cp;
        } catch {
            // Si falla Chainlink (o secuenciador), y tenemos manual, ¿qué hacemos?
            // Si el secuenciador está caído, es peligroso liquidar. 
            // Pero si el usuario quiere salir, quizás manual sea útil.
            // Por seguridad en L2 DeFi: Mejor fallar si el secuenciador cae.
            // Sin embargo, si es solo un error de Chainlink Feed individual, usamos Manual.
            chainlinkPrice = 0; 
        }

        // Caso 1: Chainlink OK
        if (chainlinkPrice > 0) {
            // Validar desviación si hay un precio manual de referencia (Safety Check)
            if (manual > 0) {
                uint256 deviation = _computeDeviation(chainlinkPrice, manual);
                uint256 maxDev = _maxDeviation(token);
                
                if (deviation > maxDev) {
                    // Desviación EXCESIVA detectada (posible hack de oráculo o flash crash)
                    if (preferManualOnDeviation[token]) {
                        return manual; // Circuit breaker activado: usar manual
                    } else {
                        revert BadDeviation(); // Pausar mercado por seguridad
                    }
                }
            }
            return chainlinkPrice;
        }

        // Caso 2: Chainlink Falló (o no existe), usar Manual si existe
        if (manual > 0) {
            return manual;
        }

        // Caso 3: Nada funciona
        return 0; 
    }

    // Diagnóstico para el frontend
    function diagnosePrice(address asset) external view returns (
        uint256 effectivePrice,
        PriceSource source,
        uint256 chainlinkPrice,
        uint256 manualPrice,
        uint256 deviationBps
    ) {
        address token = _resolveUnderlying(asset);
        manualPrice = manualPrices[token];
        
        // Intentar leer Chainlink sin revertir
        try this.getRawFeedPrice(asset) returns (uint256 cp) {
            chainlinkPrice = cp;
        } catch {
            chainlinkPrice = 0;
        }

        if (chainlinkPrice > 0) {
            if (manualPrice > 0) {
                deviationBps = _computeDeviation(chainlinkPrice, manualPrice);
                uint256 maxDev = _maxDeviation(token);
                if (deviationBps > maxDev) {
                    if (preferManualOnDeviation[token]) {
                        return (manualPrice, PriceSource.FORCED_MANUAL, chainlinkPrice, manualPrice, deviationBps);
                    } else {
                        // Simular fallo
                        return (0, PriceSource.NONE, chainlinkPrice, manualPrice, deviationBps);
                    }
                }
            }
            return (chainlinkPrice, PriceSource.CHAINLINK, chainlinkPrice, manualPrice, deviationBps);
        }

        if (manualPrice > 0) {
            return (manualPrice, PriceSource.MANUAL, 0, manualPrice, 0);
        }

        return (0, PriceSource.NONE, 0, 0, 0);
    }

    // ======================================================
    // Funciones Internas de Utilidad
    // ======================================================

    function _notStale(address token, uint256 updatedAt) internal view returns (bool) {
        uint256 limit = maxStalenessAsset[token];
        if (limit == 0) limit = maxStalenessDefault;
        if (limit == 0) return true; // Si es 0, confiamos ciegamente (no recomendado)
        
        if (updatedAt > block.timestamp) return false; // Fecha futura inválida
        return block.timestamp - updatedAt <= limit;
    }

    function _maxDeviation(address token) internal view returns (uint256) {
        uint256 dev = maxDeviationBpsAsset[token];
        if (dev == 0) dev = maxDeviationBpsDefault;
        return dev;
    }

    function _computeDeviation(uint256 a, uint256 b) internal pure returns (uint256) {
        uint256 diff = a > b ? a - b : b - a;
        if (b == 0) return type(uint256).max;
        return diff * 10_000 / b;
    }

    function _scale(uint256 price, uint8 decimals_) internal pure returns (uint256) {
        if (decimals_ == 18) return price;
        if (decimals_ < 18) return price * (10 ** (18 - decimals_));
        return price / (10 ** (decimals_ - 18));
    }

    function _resolveUnderlying(address asset) internal view returns (address) {
        (bool ok1, bytes memory data1) = asset.staticcall(
            abi.encodeWithSelector(IV_cTokenMinimalUnderlyingResolver.underlying.selector)
        );
        if (ok1 && data1.length >= 32) return abi.decode(data1, (address));

        (bool ok2, bytes memory data2) = asset.staticcall(
            abi.encodeWithSelector(IV_cTokenUnderlyingAddress.underlyingAddress.selector)
        );
        if (ok2 && data2.length >= 32) return abi.decode(data2, (address));

        return asset;
    }
}

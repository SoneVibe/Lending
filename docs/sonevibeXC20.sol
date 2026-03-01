// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

// Interfaz para el Precompile de Revive (Solo las funciones que SI existen)
interface IERC20Subset {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title SoneVibe Wrapped XC20 Asset
 * @author Dennis (SoneVibe Founder)
 * @notice Wrapper estandarizado para convertir Precompiles de Revive (Assets Pallet)
 * en tokens ERC20 completos compatibles con DeFi (Lending/Swap).
 */
contract SoneVibeWrappedXC20 is ERC20, ERC20Permit, ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20; // Seguridad extra aunque el precompile sea simple

    // El activo subyacente (El precompile de Parity)
    IERC20Subset public immutable underlying;
    
    // Decimales del token (Hardcoded para consistencia con el subyacente)
    uint8 private immutable _decimals;

    event Deposit(address indexed from, address indexed to, uint256 amount);
    event Withdrawal(address indexed from, address indexed to, uint256 amount);

    /**
     * @param _underlying La dirección del Precompile (ej: 0x000...01200000 para USDT)
     * @param _name Nombre oficial (ej: "SoneVibe Wrapped USDT")
     * @param _symbol Símbolo oficial (ej: "svUSDT" o "wUSDT")
     * @param _decimalsArg Decimales exactos del asset original (ej: 6 para USDT)
     */
    constructor(
        address _underlying,
        string memory _name,
        string memory _symbol,
        uint8 _decimalsArg
    ) ERC20(_name, _symbol) ERC20Permit(_name) Ownable(msg.sender) {
        require(_underlying != address(0), "SoneVibe: INVALID_UNDERLYING");
        underlying = IERC20Subset(_underlying);
        _decimals = _decimalsArg;
    }

    // Override para devolver los decimales correctos (CRÍTICO PARA LENDING)
    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }

    /**
     * @notice Envuelve el asset nativo a SoneVibe Wrapped Asset.
     * @dev El usuario debe haber hecho 'approve' en el Precompile primero.
     * @param amount Cantidad a envolver.
     */
    function depositFor(address to, uint256 amount) public nonReentrant {
        require(amount > 0, "SoneVibe: ZERO_AMOUNT");
        
        // 1. Transferir del usuario al contrato (usando el precompile)
        // Nota: Usamos call directo o interfaz segura porque SafeERC20 espera returndata estándar
        // y algunos precompiles antiguos no devuelven nada, pero Revive dice devolver bool.
        bool success = underlying.transferFrom(msg.sender, address(this), amount);
        require(success, "SoneVibe: TRANSFER_FROM_FAILED");

        // 2. Mint 1:1 del Wrapper
        _mint(to, amount);

        emit Deposit(msg.sender, to, amount);
    }

    /**
     * @notice Helper para depositar al msg.sender
     */
    function deposit(uint256 amount) external {
        depositFor(msg.sender, amount);
    }

    /**
     * @notice Desenvuelve y recibe el asset nativo del Precompile.
     * @param amount Cantidad a quemar/retirar.
     */
    function withdrawTo(address to, uint256 amount) public nonReentrant {
        require(amount > 0, "SoneVibe: ZERO_AMOUNT");
        
        // 1. Quemar el wrapper del usuario
        _burn(msg.sender, amount);

        // 2. Transferir el subyacente (Precompile) al usuario
        bool success = underlying.transfer(to, amount);
        require(success, "SoneVibe: TRANSFER_FAILED");

        emit Withdrawal(msg.sender, to, amount);
    }

    /**
     * @notice Helper para retirar al msg.sender
     */
    function withdraw(uint256 amount) external {
        withdrawTo(msg.sender, amount);
    }

    /**
     * @notice Recuperación de tokens perdidos (NO el underlyng).
     * @dev Solo Owner (SoneVibe Gov). Evita que se bloqueen airdrops erróneos.
     */
    function recoverERC20(address tokenAddress, uint256 tokenAmount) external onlyOwner {
        require(tokenAddress != address(underlying), "SoneVibe: CANNOT_STEAL_UNDERLYING");
        IERC20(tokenAddress).transfer(msg.sender, tokenAmount);
    }
}

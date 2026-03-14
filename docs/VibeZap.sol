// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

// Interfaces Mínimas
interface IVibeRouter {
    function factory() external view returns (address);
    function WETH() external view returns (address);
    function addLiquidityETH(
        address token,
        uint amountTokenDesired,
        uint amountTokenMin,
        uint amountETHMin,
        address to,
        uint deadline
    ) external payable returns (uint amountToken, uint amountETH, uint liquidity);
    
    function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline)
        external
        payable
        returns (uint[] memory amounts);
}

/**
 * @title VibeZap
 * @dev Permite entrar a una posición de Liquidez (LP) desde un solo activo (ETH).
 *      Optimizada para evitar "Stack too deep".
 */
contract VibeZap is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IVibeRouter public immutable router;
    address public immutable WETH;

    event ZapETH(address indexed user, address indexed token, uint256 lpAmount);

    constructor(address _router) Ownable(msg.sender) {
        router = IVibeRouter(_router);
        WETH = router.WETH();
    }

    receive() external payable {}

    /**
     * @notice Convierte ETH en LP Tokens de (ETH-Token) en un solo paso.
     * @param _token Token del par.
     * @param _minLp Mínimo de LP a recibir.
     * @param _tokenAmountOutMin Mínimo de tokens a recibir del swap (Anti-Sandwich).
     */
    function zapInETH(address _token, uint256 _minLp, uint256 _tokenAmountOutMin) external payable nonReentrant {
        require(msg.value > 0, "Zap: Need ETH");
        require(_token != address(0) && _token != WETH, "Zap: Invalid Token");

        uint256 ethToSwap = msg.value / 2;
        
        uint256 tokenAmount;
        
        // Bloque 1: Swap
        {
            address[] memory path = new address[](2);
            path[0] = WETH;
            path[1] = _token;

            uint256 balBefore = IERC20(_token).balanceOf(address(this));
            router.swapExactETHForTokens{value: ethToSwap}(_tokenAmountOutMin, path, address(this), block.timestamp + 600);
            tokenAmount = IERC20(_token).balanceOf(address(this)) - balBefore;
        }

        // Bloque 2: Add Liquidity
        // [CORREGIDO] Usamos forceApprove para OpenZeppelin 5.4.0 (USDT safe)
        IERC20(_token).forceApprove(address(router), tokenAmount);

        uint256 liquidity;
        {
            (,, liquidity) = router.addLiquidityETH{value: address(this).balance}(
                _token,
                tokenAmount,
                0, 
                0,
                msg.sender, // Los LP van al usuario
                block.timestamp + 600
            );
        }

        require(liquidity >= _minLp, "Zap: Low LP");

        // Bloque 3: Devolución de sobras (Dust)
        uint256 dustToken = IERC20(_token).balanceOf(address(this));
        if (dustToken > 0) {
            IERC20(_token).safeTransfer(msg.sender, dustToken);
        }
        
        uint256 dustETH = address(this).balance;
        if (dustETH > 0) {
            (bool success, ) = msg.sender.call{value: dustETH}("");
            require(success, "Zap: ETH return failed");
        }

        emit ZapETH(msg.sender, _token, liquidity);
    }

    function rescueTokens(address _token) external onlyOwner {
        if (_token == address(0)) {
            // [CORREGIDO] Reemplazo de .transfer() por .call() para evitar el warning
            (bool success, ) = msg.sender.call{value: address(this).balance}("");
            require(success, "ETH rescue failed");
        } else {
            IERC20(_token).safeTransfer(msg.sender, IERC20(_token).balanceOf(address(this)));
        }
    }
}
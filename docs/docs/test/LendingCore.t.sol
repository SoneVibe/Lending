// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/V_cERC20_ExtendedInterest.sol";
import "../contracts/interest/JumpRateModelSimple.sol";
import "../interfaces/IV_MasterEnhanced.sol";
import "../interfaces/IVibePriceOracle.sol";

// Simples stubs (crea tus propios mocks).
contract ERC20Mock {
    string public name;
    string public symbol;
    uint8 public immutable decimals;
    uint256 public totalSupply;
    mapping(address=>uint256) public balanceOf;

    constructor(string memory n, string memory s, uint8 d) {
        name=n; symbol=s; decimals=d;
    }
    function mint(address to, uint256 amt) external {
        balanceOf[to]+=amt; totalSupply+=amt;
    }
    function transfer(address to, uint256 amt) external returns(bool){
        require(balanceOf[msg.sender]>=amt,"bal");
        balanceOf[msg.sender]-=amt; balanceOf[to]+=amt; return true;
    }
    function transferFrom(address from,address to,uint256 amt) external returns(bool){
        require(balanceOf[from]>=amt,"bal");
        balanceOf[from]-=amt; balanceOf[to]+=amt; return true;
    }
}

contract LendingCoreTest is Test {
    ERC20Mock usdc;
    ERC20Mock astr;
    V_cERC20_ExtendedInterest cUSDC;
    V_cERC20_ExtendedInterest cASTR;
    JumpRateModelSimple irmStable;
    JumpRateModelSimple irmVolatile;
    IV_MasterEnhanced comptroller; // reemplazar con mock real
    IVibePriceOracle oracle;       // reemplazar con mock real
    address guardian = address(this);
    address user = address(0xBEEF);
    address liquidator = address(0xCAFE);

    function setUp() external {
        // Crear underlyings
        usdc = new ERC20Mock("USD Coin","USDC",6);
        astr = new ERC20Mock("Astra","ASTR",18);

        // Mock precios (asumir oracle mock ya configurado = 1e18)
        // Deploy IRMs per-block (valores ejemplo)
        irmStable = new JumpRateModelSimple(
            1268870000,
            11419830000,
            38066100000,
            800000000000000000
        );
        irmVolatile = new JumpRateModelSimple(
            1903300000,
            19033000000,
            76132000000,
            700000000000000000
        );

        // Comptroller y oracle deben ser mocks con:
        // - isComptroller() = true
        // - canRedeem, canBorrow, seizeAllowed, closeFactorMantissa(), liquidationIncentiveMantissa(), oracle()

        // Deploy cTokens (coloca direcciones mocks correctas)
        cUSDC = new V_cERC20_ExtendedInterest(
            "Vibe cUSDC","cUSDC",
            address(usdc),
            address(comptroller),
            guardian,
            address(irmStable),
            0.10e18
        );

        cASTR = new V_cERC20_ExtendedInterest(
            "Vibe cASTR","cASTR",
            address(astr),
            address(comptroller),
            guardian,
            address(irmVolatile),
            0.20e18
        );

        // Mint underlying a usuario
        usdc.mint(user, 1_000_000 * 1e6);
        astr.mint(user, 1_000_000 ether);
    }

    function testMintAndBorrowFlow() external {
        vm.startPrank(user);
        uint256 deposit = 10_000 * 1e6;
        usdc.transfer(address(cUSDC), deposit);
        // Simular mint (adaptar a tu interfaz con safeTransferFrom si fuera necesario)
        cUSDC.mint(deposit);
        assertGt(cUSDC.balanceOf(user), 0, "cUSDC minted");

        // Simular borrow (requiere mocks de canBorrow)
        // cUSDC.borrow(...)
        vm.stopPrank();
    }

    // Agrega tests para liquidación, HF, etc. usando mocks apropiados.
}
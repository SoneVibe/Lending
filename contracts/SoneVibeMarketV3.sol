// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

// IMPORTS: Rutas limpias para OpenZeppelin 5.0
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {ERC1155HolderUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC1155/utils/ERC1155HolderUpgradeable.sol";

// Tokens Interfaces
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

// Interfaz para Hooks (Lending/DEX)
interface ISoneVibeHooks {
    function reportActivity(address user, uint256 volume) external;
}

contract SoneVibeMarketV3 is 
    Initializable, 
    UUPSUpgradeable, 
    OwnableUpgradeable, 
    PausableUpgradeable, 
    ReentrancyGuardUpgradeable,
    ERC1155HolderUpgradeable 
{
    using SafeERC20 for IERC20;

    // --- State Variables ---
    IERC20 public paymentToken; // ASTR
    address public treasury;
    uint256 public feeBasisPoints; // 500 = 5%
    
    // IDs de Interfaces (ERC-165)
    bytes4 constant _INTERFACE_ID_ERC721 = 0x80ac58cd;
    bytes4 constant _INTERFACE_ID_ERC1155 = 0xd9b67a26;

    enum TokenType { ERC721, ERC1155 }

    struct Listing {
        address seller;
        address nftContract;
        uint256 tokenId;
        uint256 pricePerUnit; // Precio POR UNIDAD en Wei
        uint256 amount;       // Cantidad disponible (1 para ERC721)
        TokenType tokenType;
        bool active;
    }

    // Mapping: NFT Contract -> Token ID -> Listing
    // Nota: Un mismo ID solo puede tener un listing activo por contrato a la vez para simplificar indexación
    mapping(address => mapping(uint256 => Listing)) public listings;
    
    address public ecosystemHook; 

    // Events
    event ItemListed(address indexed seller, address indexed nftContract, uint256 indexed tokenId, uint256 amount, uint256 pricePerUnit, string standard);
    event ItemSold(address indexed buyer, address indexed nftContract, uint256 indexed tokenId, uint256 amount, uint256 totalPrice);
    event ListingUpdated(address indexed seller, address indexed nftContract, uint256 indexed tokenId, uint256 newAmount);
    event ItemCanceled(address indexed seller, address indexed nftContract, uint256 indexed tokenId);
    event FeesUpdated(uint256 newFee);
    event FundsWithdrawn(address token, uint256 amount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _paymentToken, address _treasury) public initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __Pausable_init();
        __ReentrancyGuard_init();
        __ERC1155Holder_init();

        require(_paymentToken != address(0), "Invalid token");
        paymentToken = IERC20(_paymentToken);
        treasury = _treasury;
        feeBasisPoints = 500; // 5%
    }

    // --- Core Logic ---

    /**
     * @dev Lista un NFT (721 o 1155).
     * @param _amount Cantidad a listar. Para ERC-721 DEBE ser 1. Para ERC-1155 puede ser > 1.
     * @param _pricePerUnit Precio por cada unidad (no el total del lote).
     */
    function listItem(address _nftContract, uint256 _tokenId, uint256 _amount, uint256 _pricePerUnit) external nonReentrant whenNotPaused {
        require(_pricePerUnit > 0, "Price must be > 0");
        require(_amount > 0, "Amount must be > 0");
        
        // Verificar si ya existe un listing activo para este ID y sobrescribirlo o fallar
        // Para este MVP, requerimos cancelar antes de relistar para evitar contabilidad compleja
        require(!listings[_nftContract][_tokenId].active, "Item already listed. Cancel first.");

        TokenType typeDetected;
        string memory typeStr;

        if (IERC165(_nftContract).supportsInterface(_INTERFACE_ID_ERC721)) {
            require(_amount == 1, "ERC721 amount must be 1");
            // ERC-721: Transferir al Market (Escrow)
            IERC721(_nftContract).transferFrom(msg.sender, address(this), _tokenId);
            typeDetected = TokenType.ERC721;
            typeStr = "ERC721";
        } 
        else if (IERC165(_nftContract).supportsInterface(_INTERFACE_ID_ERC1155)) {
            // ERC-1155: SafeTransfer (Amount = _amount)
            IERC1155(_nftContract).safeTransferFrom(msg.sender, address(this), _tokenId, _amount, "");
            typeDetected = TokenType.ERC1155;
            typeStr = "ERC1155";
        } 
        else {
            revert("Unsupported contract standard");
        }

        listings[_nftContract][_tokenId] = Listing({
            seller: msg.sender,
            nftContract: _nftContract,
            tokenId: _tokenId,
            pricePerUnit: _pricePerUnit,
            amount: _amount,
            tokenType: typeDetected,
            active: true
        });

        emit ItemListed(msg.sender, _nftContract, _tokenId, _amount, _pricePerUnit, typeStr);
    }

    /**
     * @dev Compra una cantidad específica de un item listado.
     * Soporta compras parciales para ERC-1155.
     */
    function buyItem(address _nftContract, uint256 _tokenId, uint256 _amountToBuy) external nonReentrant whenNotPaused {
        Listing storage listing = listings[_nftContract][_tokenId]; // Usamos storage para actualizar amount
        require(listing.active, "Item not active");
        require(_amountToBuy > 0, "Amount must be > 0");
        require(_amountToBuy <= listing.amount, "Not enough stock");

        uint256 totalPrice = listing.pricePerUnit * _amountToBuy;
        
        // Calcular Fees
        uint256 feeAmount = (totalPrice * feeBasisPoints) / 10000;
        uint256 sellerAmount = totalPrice - feeAmount;

        // Actualizar Stock
        listing.amount -= _amountToBuy;
        if (listing.amount == 0) {
            listing.active = false; // Sold out
        }

        // 1. Cobrar ASTR (Buyer -> Treasury & Seller)
        paymentToken.safeTransferFrom(msg.sender, treasury, feeAmount);
        paymentToken.safeTransferFrom(msg.sender, listing.seller, sellerAmount);

        // 2. Entregar NFT (Escrow -> Buyer)
        if (listing.tokenType == TokenType.ERC721) {
            IERC721(_nftContract).transferFrom(address(this), msg.sender, _tokenId);
        } else {
            IERC1155(_nftContract).safeTransferFrom(address(this), msg.sender, _tokenId, _amountToBuy, "");
        }

        // 3. Hook (Opcional)
        if (ecosystemHook != address(0)) {
            try ISoneVibeHooks(ecosystemHook).reportActivity(msg.sender, totalPrice) {} catch {}
        }

        emit ItemSold(msg.sender, _nftContract, _tokenId, _amountToBuy, totalPrice);
    }

    /**
     * @dev Cancela un listing y devuelve el stock restante al vendedor.
     */
    function cancelListing(address _nftContract, uint256 _tokenId) external nonReentrant {
        Listing memory listing = listings[_nftContract][_tokenId];
        require(listing.active, "Not listed");
        require(listing.seller == msg.sender || msg.sender == owner(), "Not authorized");

        delete listings[_nftContract][_tokenId];

        // Devolver NFT al vendedor (la cantidad restante)
        if (listing.tokenType == TokenType.ERC721) {
            IERC721(_nftContract).transferFrom(address(this), listing.seller, _tokenId);
        } else {
            IERC1155(_nftContract).safeTransferFrom(address(this), listing.seller, _tokenId, listing.amount, "");
        }

        emit ItemCanceled(msg.sender, _nftContract, _tokenId);
    }

    // --- Admin & UUPS Protection ---

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    function setFees(uint256 _newBasisPoints) external onlyOwner {
        require(_newBasisPoints <= 1000, "Max fee 10%");
        feeBasisPoints = _newBasisPoints;
        emit FeesUpdated(_newBasisPoints);
    }

    function setEcosystemHook(address _hook) external onlyOwner {
        ecosystemHook = _hook;
    }

    function togglePause() external onlyOwner {
        paused() ? _unpause() : _pause();
    }
    
    function emergencyWithdraw(address _token, uint256 _amount) external onlyOwner {
        IERC20(_token).safeTransfer(msg.sender, _amount);
        emit FundsWithdrawn(_token, _amount);
    }
}
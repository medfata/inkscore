// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title InkScoreNFT
 * @dev Dynamic NFT contract for InkScore achievements
 * @notice Users can mint NFTs representing their wallet score and rank
 */
contract InkScoreNFT is ERC721, Ownable {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    uint256 private _nextTokenId;
    string private _baseTokenURI;
    address public authorizedSigner;
    uint256 public mintPrice;
    
    // tokenId => wallet address that owns the score
    mapping(uint256 => address) public tokenWallet;
    // wallet => tokenId (for checking if wallet already minted)
    mapping(address => uint256) public walletToken;
    // Used signatures to prevent replay attacks
    mapping(bytes32 => bool) public usedSignatures;

    event ScoreNFTMinted(
        address indexed wallet, 
        uint256 indexed tokenId, 
        uint256 score, 
        string rank
    );

    event SignerUpdated(address indexed oldSigner, address indexed newSigner);
    event BaseURIUpdated(string newBaseURI);
    event MintPriceUpdated(uint256 oldPrice, uint256 newPrice);

    error SignatureExpired();
    error SignatureAlreadyUsed();
    error InvalidSignature();
    error InsufficientPayment();

    /**
     * @dev Constructor sets the base URI and authorized signer
     * @param baseURI The base URI for token metadata (e.g., https://inkscore.xyz)
     * @param _authorizedSigner Address authorized to sign mint requests
     */
    constructor(
        string memory baseURI,
        address _authorizedSigner
    ) ERC721("InkScore Achievement", "INKSCORE") Ownable(msg.sender) {
        _baseTokenURI = baseURI;
        authorizedSigner = _authorizedSigner;
        _nextTokenId = 1;
        mintPrice = 0; // Start with free minting
    }

    /**
     * @dev Mint a new Score NFT with backend authorization
     * @param score The wallet's current score
     * @param rank The wallet's current rank tier
     * @param expiry Timestamp when the signature expires
     * @param signature Backend-signed authorization
     * @return tokenId The ID of the minted NFT
     */
    function mint(
        uint256 score,
        string calldata rank,
        uint256 expiry,
        bytes calldata signature
    ) external payable returns (uint256) {
        if (msg.value < mintPrice) revert InsufficientPayment();
        if (block.timestamp > expiry) revert SignatureExpired();
        
        bytes32 messageHash = keccak256(abi.encodePacked(
            msg.sender,
            score,
            rank,
            expiry
        ));
        
        if (usedSignatures[messageHash]) revert SignatureAlreadyUsed();
        
        bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();
        address signer = ethSignedHash.recover(signature);
        if (signer != authorizedSigner) revert InvalidSignature();
        
        usedSignatures[messageHash] = true;
        
        // If wallet already has an NFT, burn it first
        if (walletToken[msg.sender] != 0) {
            uint256 oldTokenId = walletToken[msg.sender];
            _burn(oldTokenId);
            delete tokenWallet[oldTokenId];
        }
        
        uint256 tokenId = _nextTokenId++;
        _safeMint(msg.sender, tokenId);
        tokenWallet[tokenId] = msg.sender;
        walletToken[msg.sender] = tokenId;
        
        emit ScoreNFTMinted(msg.sender, tokenId, score, rank);
        
        return tokenId;
    }

    /**
     * @dev Returns the token URI for metadata
     * @param tokenId The token ID to query
     * @return The full metadata URI
     */
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return string(abi.encodePacked(_baseTokenURI, "/api/nft/metadata/", _toString(tokenId)));
    }

    /**
     * @dev Update the base URI for metadata
     * @param baseURI New base URI
     */
    function setBaseURI(string calldata baseURI) external onlyOwner {
        _baseTokenURI = baseURI;
        emit BaseURIUpdated(baseURI);
    }

    /**
     * @dev Update the authorized signer address
     * @param _signer New signer address
     */
    function setAuthorizedSigner(address _signer) external onlyOwner {
        address oldSigner = authorizedSigner;
        authorizedSigner = _signer;
        emit SignerUpdated(oldSigner, _signer);
    }

    /**
     * @dev Update the mint price
     * @param _price New mint price in wei
     */
    function setMintPrice(uint256 _price) external onlyOwner {
        uint256 oldPrice = mintPrice;
        mintPrice = _price;
        emit MintPriceUpdated(oldPrice, _price);
    }

    /**
     * @dev Withdraw contract balance to owner
     * @notice Only owner can withdraw accumulated mint fees
     */
    function withdraw() external onlyOwner {
        uint256 balance = address(this).balance;
        (bool success, ) = payable(owner()).call{value: balance}("");
        require(success, "Withdrawal failed");
    }

    /**
     * @dev Get the current token count
     * @return The next token ID (total minted + 1)
     */
    function totalMinted() external view returns (uint256) {
        return _nextTokenId - 1;
    }

    /**
     * @dev Check if a wallet has minted an NFT
     * @param wallet The wallet address to check
     * @return hasNFT Whether the wallet has an NFT
     * @return tokenId The token ID if exists, 0 otherwise
     */
    function hasNFT(address wallet) external view returns (bool hasNFT, uint256 tokenId) {
        tokenId = walletToken[wallet];
        hasNFT = tokenId != 0;
    }

    /**
     * @dev Convert uint256 to string
     */
    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
}

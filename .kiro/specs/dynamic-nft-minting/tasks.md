# Implementation Plan

- [x] 1. Set up smart contract development environment












  - Create `contracts/` directory structure for Solidity development
  - Initialize Hardhat or Foundry configuration for Ink Chain deployment
  - Add OpenZeppelin contracts dependency for ERC-721 and cryptography utilities
  - Configure environment variables for deployment (RPC URL, deployer private key)
  - _Requirements: 4.1, 4.2_



- [x] 2. Implement InkScoreNFT smart contract



  - [x] 2.1 Create base ERC-721 contract with constructor
    - Implement `InkScoreNFT.sol` extending OpenZeppelin ERC721 and Ownable
    - Add constructor accepting baseURI and authorizedSigner parameters
    - Initialize token counter starting at 1

    - _Requirements: 4.1, 4.4_
  - [x] 2.2 Implement signature verification and mint function
    - Add ECDSA signature verification using OpenZeppelin utilities
    - Implement `mint(score, rank, expiry, signature)` function
    - Add `usedSignatures` mapping to prevent replay attacks

    - Emit `ScoreNFTMinted` event on successful mint
    - _Requirements: 4.3, 2.4_
  - [x] 2.3 Implement tokenId-wallet mapping and re-mint logic
    - Add `tokenWallet` mapping (tokenId → wallet) for metadata lookup

    - Add `walletToken` mapping (wallet → tokenId) for existing NFT check
    - Implement burn-and-remint logic when wallet already has NFT
    - _Requirements: 4.2, 2.5_
  - [x] 2.4 Implement dynamic tokenURI function
    - Override `tokenURI()` to return metadata API URL with tokenId
    - Add `setBaseURI()` owner function for updating base URL
    - Add `setAuthorizedSigner()` owner function for key rotation
    - _Requirements: 4.5_
  - [ ]* 2.5 Write contract unit tests
    - Test successful mint with valid signature
    - Test rejection of expired/invalid signatures




    - Test re-minting flow (burn old, mint new)
    - Test access control for owner functions
    - _Requirements: 4.1, 4.3_


- [x] 3. Implement NFT authorization API endpoint
  - [x] 3.1 Create authorization route handler
    - Create `app/api/nft/authorize/route.ts` POST endpoint
    - Validate wallet address format from request body

    - Fetch current score and rank using `pointsService.calculateWalletScore()`
    - _Requirements: 2.1, 2.2_
  - [x] 3.2 Implement signature generation


    - Create message hash: `keccak256(wallet, score, rank, expiry)`
    - Sign message using `NFT_SIGNER_PRIVATE_KEY` environment variable
    - Set expiry to current timestamp + 5 minutes
    - Return signature, score, rank, expiry, and wallet address
    - _Requirements: 2.1, 2.2, 2.3_
  - [x] 3.3 Add rate limiting and error handling
    - Implement rate limiting (e.g., 5 requests per minute per wallet)
    - Add comprehensive error responses for invalid inputs
    - _Requirements: 2.3_

- [x] 4. Implement NFT metadata API endpoint
  - [x] 4.1 Create metadata route handler

    - Create `app/api/nft/metadata/[tokenId]/route.ts` GET endpoint
    - Query contract to get wallet address from tokenId
    - Fetch current score and rank for the wallet
    - _Requirements: 3.1, 3.3_

  - [x] 4.2 Implement metadata response structure
    - Return ERC-721 compliant JSON metadata
    - Include name, description, image, external_url, and attributes
    - Add score, rank, and wallet as NFT attributes
    - _Requirements: 3.4_
  - [x] 4.3 Handle error cases

    - Return 404 for non-existent tokenIds
    - Return placeholder metadata for invalid wallet lookups
    - _Requirements: 3.5_

- [x] 5. Implement SVG image generator service



  - [x] 5.1 Create NFT image service

    - Create `lib/services/nft-image-service.ts`
    - Implement `generateScoreNFTSvg(score, rank, rankColor, walletAddress)` function
    - Design SVG with InkScore branding, gradient background
    - _Requirements: 3.2_
  - [x] 5.2 Add dynamic content rendering

    - Display large score number prominently
    - Show rank badge with tier-specific color
    - Include abbreviated wallet address (0x1234...abcd format)
    - Add "InkScore" branding and timestamp
    - _Requirements: 3.2_
  - [x] 5.3 Integrate SVG generator with metadata API

    - Generate SVG in metadata endpoint
    - Return as base64 data URI in image field
    - _Requirements: 3.2_

- [x] 6. Implement frontend mint component

  - [x] 6.1 Create MintScoreNFT component


    - Create `app/components/MintScoreNFT.tsx`
    - Accept walletAddress, currentScore, currentRank, rankColor props
    - Implement state machine: idle → authorizing → confirming → minting → success/error
    - _Requirements: 1.1, 1.4, 5.2_

  - [x] 6.2 Implement authorization and minting flow
    - Call `/api/nft/authorize` to get signature
    - Use wagmi hooks to call contract mint function
    - Handle transaction confirmation and events
    - _Requirements: 1.1, 1.4, 1.5_

  - [x] 6.3 Add UI states and feedback
    - Show loading spinner during authorization and minting
    - Display success message with link to view NFT
    - Show error messages with retry option
    - Add tooltip explaining the feature on hover
    - _Requirements: 1.4, 1.5, 5.3_

- [x] 7. Integrate mint button into Dashboard score card

  - [x] 7.1 Add mint button to score card section


    - Locate score display section in `app/components/Dashboard.tsx`
    - Add MintScoreNFT component below score display
    - Style button consistent with existing design system (ink-purple theme)
    - _Requirements: 5.1_

  - [x] 7.2 Implement conditional rendering
    - Hide mint button when wallet not connected
    - Show "Update NFT" text if wallet has existing NFT
    - Disable button during pending transactions
    - _Requirements: 1.2, 1.3, 5.4_
  - [ ]* 7.3 Add gas estimation display
    - Estimate gas cost before user confirms
    - Display estimated cost in ETH/USD
    - _Requirements: 5.5_

- [x] 8. Deploy and configure smart contract

  - [x] 8.1 Create deployment script

    - Write deployment script for Ink Chain
    - Configure constructor parameters (baseURI, signer address)
    - _Requirements: 4.1_
  - [x] 8.2 Deploy contract and update configuration

    - Deploy to Ink Chain mainnet/testnet
    - Add contract address to environment variables
    - Update frontend with contract ABI and address
    - _Requirements: 4.1_

- [x] 9. Add contract interaction configuration
  - [x] 9.1 Create contract ABI and address config

    - Export contract ABI from compilation artifacts
    - Create `lib/contracts/ink-score-nft.ts` with ABI and address
    - _Requirements: 4.1_

  - [x] 9.2 Add wagmi contract hooks
    - Configure wagmi useContractRead for checking existing NFTs
    - Configure wagmi useContractWrite for mint function
    - Add transaction status tracking
    - _Requirements: 1.4, 5.4_

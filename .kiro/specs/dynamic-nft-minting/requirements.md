# Requirements Document

## Introduction

This document defines the requirements for implementing a Dynamic NFT Minting feature for the InkScore application. The feature allows users to mint an NFT that visually represents their wallet's score and rank from the existing ranking system. The NFT will display the user's current score, rank badge, and wallet address, creating a verifiable on-chain achievement record.

Based on research, the recommended approach is **Dynamic Metadata** where the NFT's tokenURI points to an API endpoint that returns current score/rank data, ensuring the NFT always reflects the latest wallet performance.

## Glossary

- **InkScore_System**: The existing wallet scoring and ranking system that calculates points based on wallet activity, DeFi usage, NFT holdings, and ecosystem participation
- **Dynamic_NFT**: An NFT whose metadata and visual representation can change over time based on external data (wallet score/rank)
- **Score_Card**: The UI component displaying a wallet's total points and rank tier
- **Rank**: A tier classification (e.g., "Ink Legend", "OG Member", "Power User") determined by total points
- **Token_URI**: The metadata endpoint URL stored on-chain that returns NFT metadata in JSON format
- **Mint_Authorization**: A cryptographic signature from the backend that authorizes a specific wallet to mint an NFT with verified score data
- **NFT_Metadata_API**: The backend API endpoint that generates dynamic metadata and images for minted NFTs
- **Ink_Chain**: The blockchain network where the NFT smart contract will be deployed

## Requirements

### Requirement 1: NFT Minting from Score Card

**User Story:** As a connected wallet user, I want to mint an NFT from my score card, so that I can have an on-chain representation of my InkScore achievement.

#### Acceptance Criteria

1. WHEN the user clicks the mint button on the score card, THE InkScore_System SHALL display a minting confirmation modal with the current score and rank preview.
2. WHILE the user's wallet is connected, THE InkScore_System SHALL display a "Mint Score NFT" button on the score card component.
3. IF the user's wallet is not connected, THEN THE InkScore_System SHALL hide the mint button and display a prompt to connect wallet.
4. WHEN the minting transaction is submitted, THE InkScore_System SHALL display a loading state with transaction status updates.
5. WHEN the minting transaction is confirmed, THE InkScore_System SHALL display a success message with a link to view the NFT.

### Requirement 2: Backend Mint Authorization

**User Story:** As a system administrator, I want the minting process to be secured with backend signatures, so that users cannot mint NFTs with falsified score data.

#### Acceptance Criteria

1. WHEN a user requests to mint an NFT, THE InkScore_System SHALL generate a cryptographic signature containing the wallet address, current score, rank, and expiration timestamp.
2. THE InkScore_System SHALL use a server-side private key to sign mint authorization requests.
3. IF the signature has expired (older than 5 minutes), THEN THE InkScore_System SHALL reject the mint request and prompt the user to retry.
4. WHEN the smart contract receives a mint request, THE InkScore_System SHALL verify the signature matches the authorized signer address before minting.
5. IF a wallet has already minted a Score NFT, THEN THE InkScore_System SHALL allow minting a new NFT to update the on-chain record.

### Requirement 3: Dynamic NFT Metadata API

**User Story:** As an NFT holder, I want my Score NFT to always display my current score and rank, so that the NFT reflects my latest achievements.

#### Acceptance Criteria

1. WHEN an NFT marketplace or wallet requests the tokenURI, THE NFT_Metadata_API SHALL return JSON metadata containing the current score, rank name, rank color, and wallet address.
2. THE NFT_Metadata_API SHALL generate an SVG image dynamically displaying the score value, rank badge, and abbreviated wallet address.
3. WHEN the wallet's score changes, THE NFT_Metadata_API SHALL return updated metadata reflecting the new score and rank on subsequent requests.
4. THE NFT_Metadata_API SHALL include standard ERC-721 metadata fields: name, description, image, and attributes array.
5. IF the wallet address from tokenId lookup is invalid, THEN THE NFT_Metadata_API SHALL return a default placeholder metadata response.

### Requirement 4: Smart Contract Implementation

**User Story:** As a developer, I want a secure and gas-efficient smart contract, so that users can mint Score NFTs reliably on Ink Chain.

#### Acceptance Criteria

1. THE InkScore_System SHALL deploy an ERC-721 compliant smart contract on Ink Chain.
2. WHEN a user mints an NFT, THE smart contract SHALL store the mapping between tokenId and wallet address on-chain.
3. THE smart contract SHALL implement signature verification using ECDSA to validate mint authorizations.
4. THE smart contract SHALL set the tokenURI to the NFT_Metadata_API endpoint with the tokenId parameter.
5. WHEN queried for tokenURI, THE smart contract SHALL return the dynamic metadata API URL in the format: `{baseURI}/api/nft/metadata/{tokenId}`.

### Requirement 5: Score Card UI Integration

**User Story:** As a user viewing my dashboard, I want the mint button to be seamlessly integrated into the existing score card, so that the minting experience feels native to the application.

#### Acceptance Criteria

1. THE InkScore_System SHALL display the mint button in the score card component with styling consistent with the existing design system.
2. WHILE a minting transaction is pending, THE InkScore_System SHALL disable the mint button and show a spinner indicator.
3. WHEN the user hovers over the mint button, THE InkScore_System SHALL display a tooltip explaining the NFT minting feature.
4. IF the user has previously minted a Score NFT, THEN THE InkScore_System SHALL display "Update NFT" instead of "Mint NFT" on the button.
5. THE InkScore_System SHALL display the estimated gas cost before the user confirms the mint transaction.

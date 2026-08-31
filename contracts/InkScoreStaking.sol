// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title InkScoreStaking
 * @dev NFT staking vault for the InkScore Zenith collection
 * @notice Holders stake their NFTs for a fixed lock period — 1 day, 1 week
 *         or 1 month — chosen at stake time. While the lock is active the
 *         NFT cannot be unstaked; the lock releases automatically the moment
 *         the period ends, after which the depositor can unstake at any time.
 *         Every stake and unstake action charges a configurable fee (payable
 *         in native ETH) owned and adjustable by the contract owner. In an
 *         emergency, the owner can force-return staked NFTs to their original
 *         depositors — bypassing any lock and without charging any fee.
 */
contract InkScoreStaking is Ownable, ReentrancyGuard {
    using EnumerableSet for EnumerableSet.UintSet;

    /// @notice Lock periods offered at stake time.
    enum LockPeriod {
        Day,   // 0 — 1 day
        Week,  // 1 — 1 week
        Month  // 2 — 30 days
    }

    /// @notice The NFT collection accepted by this staking contract.
    IERC721 public immutable nft;

    /// @notice Fee charged when staking an NFT (in wei).
    uint256 public stakeFee;

    /// @notice Fee charged when unstaking an NFT (in wei).
    uint256 public unstakeFee;

    /// @notice Global number of NFTs currently staked.
    uint256 private _totalStaked;

    // tokenId => address that deposited the NFT (zero address = not staked)
    mapping(uint256 => address) private _depositor;
    // tokenId => timestamp when the NFT was staked
    mapping(uint256 => uint256) private _stakedAt;
    // tokenId => timestamp when the lock releases (unstake allowed from here)
    mapping(uint256 => uint256) private _unlockAt;
    // user => set of their staked token IDs
    mapping(address => EnumerableSet.UintSet) private _userStakes;

    event Staked(
        address indexed user,
        uint256 indexed tokenId,
        LockPeriod period,
        uint256 stakedAt,
        uint256 unlockAt
    );
    event Unstaked(address indexed user, uint256 indexed tokenId, uint256 unstakedAt);
    event EmergencyUnstaked(uint256 indexed tokenId, address indexed returnedTo);
    event FeesUpdated(uint256 oldStakeFee, uint256 newStakeFee, uint256 oldUnstakeFee, uint256 newUnstakeFee);
    event FeesWithdrawn(address indexed to, uint256 amount);

    error ZeroAddress();
    error NotTokenOwner(address caller, uint256 tokenId);
    error NotDepositor(address caller, uint256 tokenId);
    error TokenNotStaked(uint256 tokenId);
    error InvalidPeriod(uint8 period);
    error StakeLocked(uint256 tokenId, uint256 unlockAt);
    error InsufficientFee(uint256 requiredFee, uint256 provided);
    error EthTransferFailed();

    /**
     * @dev Deploys the staking contract for a given NFT collection.
     * @param nftAddress Address of the ERC-721 collection (InkScore Zenith).
     * @param initialStakeFee Initial fee charged on stake (wei).
     * @param initialUnstakeFee Initial fee charged on unstake (wei).
     */
    constructor(
        address nftAddress,
        uint256 initialStakeFee,
        uint256 initialUnstakeFee
    ) Ownable(msg.sender) {
        if (nftAddress == address(0)) revert ZeroAddress();
        // Defensive check: refuse deployments against non-ERC721 addresses.
        try IERC721(nftAddress).supportsInterface(0x80ac58cd) returns (bool supported) {
            if (!supported) revert ZeroAddress(); // caller supplied a non-ERC721 target
        } catch {
            revert ZeroAddress(); // address has no code / rejects staticcall
        }
        nft = IERC721(nftAddress);
        stakeFee = initialStakeFee;
        unstakeFee = initialUnstakeFee;
    }

    /*//////////////////////////////////////////////////////////////
                            USER ACTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Stake your NFT for a chosen lock period. Charges {stakeFee} in
     *         native ETH and refunds any overpayment back to the caller.
     *         The NFT is locked until `block.timestamp + period seconds`;
     *         the lock releases automatically when the period ends.
     * @param tokenId ID of the NFT owned by the caller.
     * @param period Lock duration — {LockPeriod.Day}, {LockPeriod.Week} or
     *               {LockPeriod.Month}.
     */
    function stake(uint256 tokenId, LockPeriod period) external payable nonReentrant {
        if (uint256(period) > uint256(LockPeriod.Month)) revert InvalidPeriod(uint8(period));
        if (nft.ownerOf(tokenId) != msg.sender) revert NotTokenOwner(msg.sender, tokenId);

        // Effects first (checks-effects-interactions).
        uint256 unlockTimestamp = block.timestamp + _periodSeconds(period);
        _userStakes[msg.sender].add(tokenId);
        _depositor[tokenId] = msg.sender;
        _stakedAt[tokenId] = block.timestamp;
        _unlockAt[tokenId] = unlockTimestamp;
        _totalStaked += 1;

        emit Staked(msg.sender, tokenId, period, block.timestamp, unlockTimestamp);

        // Interactions: custody of the NFT moves to this contract...
        nft.transferFrom(msg.sender, address(this), tokenId);
        // ...then settle the fee, pushing back any overpayment.
        _collectAndRefund(stakeFee);
    }

    /**
     * @notice Unstake an NFT you previously staked — only possible once its
     *         lock period has fully elapsed. Charges {unstakeFee} in native
     *         ETH, refunds any overpayment, and returns the NFT to you via a
     *         checked ERC-721 receive.
     * @param tokenId ID of the staked NFT.
     */
    function unstake(uint256 tokenId) external payable nonReentrant {
        if (_depositor[tokenId] != msg.sender) revert NotDepositor(msg.sender, tokenId);
        uint256 unlockTimestamp = _unlockAt[tokenId];
        if (block.timestamp < unlockTimestamp) revert StakeLocked(tokenId, unlockTimestamp);

        // Effects
        _removeStakeRecords(msg.sender, tokenId);
        _totalStaked -= 1;

        // Interactions: return custody, then settle the fee.
        nft.safeTransferFrom(address(this), msg.sender, tokenId);
        _collectAndRefund(unstakeFee);
    }

    /*//////////////////////////////////////////////////////////////
                          OWNER / EMERGENCY
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice EMERGENCY ONLY — the owner forces an unstake at ANY time (even
     *         while the NFT is locked), without any fee, returning the NFT to
     *         its original depositor — never to the contract owner. Intended
     *         for incident recovery when the normal path is unavailable.
     * @param tokenId ID of the staked NFT to rescue.
     */
    function emergencyUnstake(uint256 tokenId) external onlyOwner nonReentrant {
        address depositor = _depositor[tokenId];
        if (depositor == address(0)) revert TokenNotStaked(tokenId);

        _removeStakeRecords(depositor, tokenId);
        _totalStaked -= 1;

        nft.safeTransferFrom(address(this), depositor, tokenId);
        emit EmergencyUnstaked(tokenId, depositor);
    }

    /**
     * @notice Batch variant of {emergencyUnstake}. Stops at the first
     *         failing token (call again starting past it) so one bad entry
     *         cannot brick the whole rescue.
     * @param tokenIds IDs of the staked NFTs to rescue.
     */
    function emergencyUnstakeMany(uint256[] calldata tokenIds) external onlyOwner nonReentrant {
        for (uint256 i = 0; i < tokenIds.length; ++i) {
            uint256 tokenId = tokenIds[i];
            address depositor = _depositor[tokenId];
            if (depositor == address(0)) continue; // skip unknown tokens instead of reverting

            _removeStakeRecords(depositor, tokenId);
            _totalStaked -= 1;

            nft.safeTransferFrom(address(this), depositor, tokenId);
            emit EmergencyUnstaked(tokenId, depositor);
        }
    }

    /**
     * @notice Update both operational fees in a single transaction.
     * @param newStakeFee New fee charged on stake (wei).
     * @param newUnstakeFee New fee charged on unstake (wei).
     */
    function setFees(uint256 newStakeFee, uint256 newUnstakeFee) external onlyOwner {
        emit FeesUpdated(stakeFee, newStakeFee, unstakeFee, newUnstakeFee);
        stakeFee = newStakeFee;
        unstakeFee = newUnstakeFee;
    }

    /**
     * @notice Withdraw every collected fee (full contract ETH balance) to
     *         the owner's address.
     */
    function withdrawFees() external onlyOwner nonReentrant {
        uint256 amount = address(this).balance;
        (bool sent, ) = owner().call{value: amount}("");
        if (!sent) revert EthTransferFailed();
        emit FeesWithdrawn(owner(), amount);
    }

    /*//////////////////////////////////////////////////////////////
                                VIEWS
    //////////////////////////////////////////////////////////////*/

    /// @notice Total number of NFTs currently staked in the contract.
    function totalStaked() external view returns (uint256) {
        return _totalStaked;
    }

    /// @notice Number of NFTs the given user has staked.
    function stakedCount(address user) external view returns (uint256) {
        return _userStakes[user].length();
    }

    /// @notice Whether a specific token is currently staked.
    function isStaked(uint256 tokenId) external view returns (bool) {
        return _depositor[tokenId] != address(0);
    }

    /// @notice All token IDs currently staked by the given user (unordered).
    function stakedTokensOf(address user) external view returns (uint256[] memory) {
        return _userStakes[user].values();
    }

    /// @notice Who staked the token, when, and when its lock releases.
    function stakeInfo(uint256 tokenId)
        external
        view
        returns (address depositor, uint256 stakedAt, uint256 unlockTimestamp)
    {
        depositor = _depositor[tokenId];
        stakedAt = _stakedAt[tokenId];
        unlockTimestamp = _unlockAt[tokenId];
    }

    /// @notice Lock-end timestamp for a staked token (0 when not staked).
    function unlockAt(uint256 tokenId) external view returns (uint256) {
        return _unlockAt[tokenId];
    }

    /// @notice Seconds for a given lock period (1 day / 7 days / 30 days).
    function periodSeconds(LockPeriod period) external pure returns (uint256) {
        return _periodSeconds(period);
    }

    /// @notice True when a staked token's lock has fully elapsed.
    function isUnlocked(uint256 tokenId) external view returns (bool) {
        return block.timestamp >= _unlockAt[tokenId] && _depositor[tokenId] != address(0);
    }

    /*//////////////////////////////////////////////////////////////
                              INTERNALS
    //////////////////////////////////////////////////////////////*/

    /// @dev Seconds for a lock period (1 day / 7 days / 30 days).
    function _periodSeconds(LockPeriod period) private pure returns (uint256) {
        if (period == LockPeriod.Day) return 1 days;
        if (period == LockPeriod.Week) return 7 days;
        return 30 days;
    }

    /// @dev Shared bookkeeping teardown shared by unstake paths.
    function _removeStakeRecords(address depositor, uint256 tokenId) private {
        _userStakes[depositor].remove(tokenId);
        delete _depositor[tokenId];
        delete _stakedAt[tokenId];
        delete _unlockAt[tokenId];
    }

    /**
     * @dev Requires payment covering `fee`, forwards the fee out of
     *      msg.value and pushes any surplus back to the caller.
     */
    function _collectAndRefund(uint256 fee) private {
        if (msg.value < fee) revert InsufficientFee(fee, msg.value);
        uint256 refund = msg.value - fee;
        if (refund > 0) {
            (bool refunded, ) = msg.sender.call{value: refund}("");
            if (!refunded) revert EthTransferFailed();
        }
    }

    /// @dev Reject stray ETH sent directly to the contract; fees must come
    ///      through stake()/unstake() so accounting stays exact.
    receive() external payable {
        revert EthTransferFailed();
    }
}

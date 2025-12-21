# Velodrome Logo Updated

## Change Made

Updated the Velodrome logo URL in the DEX_PLATFORMS configuration to use the correct path.

### Before
```typescript
'0x01d40099fcd87c018969b0e8d4ab1633fb34763c': {
  name: 'Velodrome',
  logo: 'https://velodrome.finance/favicon.ico',
}
```

### After
```typescript
'0x01d40099fcd87c018969b0e8d4ab1633fb34763c': {
  name: 'Velodrome',
  logo: 'https://velodrome.finance/images/VELO/favicon.ico',
}
```

## Impact

The Velodrome platform will now display with its correct logo in the "By Platform" section of the Swap Volume card when users have swap transactions on the Velodrome DEX.

## Display Example

When a user has swapped on Velodrome, it will appear in the list like:

```
By Platform
─────────────────────────
🦉 DyorSwap
   $5,230.00  (98)
🎨 InkySwap
   $2,520.00  (42)
🏎️ Velodrome
   $1,000.00  (16)
```

## Contract Information

- **Contract Address:** `0x01D40099fCD87C018969B0e8D4aB1633Fb34763C`
- **Platform Name:** Velodrome
- **Logo URL:** `https://velodrome.finance/images/VELO/favicon.ico`
- **Type:** Universal Router (DEX)

## How It Works

1. Analytics API returns swap volume data with contract addresses
2. Dashboard maps contract address to platform info using `DEX_PLATFORMS`
3. Platform name and logo are displayed in the "By Platform" list
4. Logo is fetched from the updated URL
5. If logo fails to load, it's hidden gracefully

## Testing

To verify Velodrome appears correctly:

1. Check a wallet with Velodrome swap transactions
2. Look at the Swap Volume card
3. Verify "Velodrome" appears in the "By Platform" list
4. Confirm the logo loads from the new URL
5. Check that USD value and transaction count display correctly

## Notes

- The logo is displayed at 14x14px (w-3.5 h-3.5)
- Logo has rounded corners
- If the logo fails to load, only the platform name shows
- The platform will automatically appear when the metric includes Velodrome contract data

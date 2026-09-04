-- Migration: 028_add_beast_meme_coin.sql
-- Description: Add BEAST (Kraken Mascot) meme coin to tracked assets.
--
-- Contract verified against:
--   - beastmeme.ink (official site CA: 0xD95B9A5Fa7C2708fD4FE0E07E59bDE1Ef35b194a)
--   - InkyPump trending list (InkySwap V1 launch)
--   - Ink explorer: 2,100+ holders, symbol BEAST
--   - DexScreener: active BEAST/WETH pair on InkySwap (used for price fetching)

INSERT INTO tracked_assets (asset_type, token_type, name, symbol, address, logo_url, decimals, display_order) VALUES
  ('meme_coin', 'meme', 'Kraken Mascot', 'BEAST', '0xd95b9a5fa7c2708fd4fe0e07e59bde1ef35b194a', 'https://storage.inkypump.com/storage/v1/object/public/images/0c4477c934e8d0297026b3f6ce4395c2ee3539b936ed84238f6d40c02abcdd97.jpg', 18, 7)
ON CONFLICT (address) DO NOTHING;

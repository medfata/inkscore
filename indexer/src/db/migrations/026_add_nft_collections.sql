-- Migration: 026_add_nft_collections.sql
-- Description: Add new tracked NFT collections (Ink Brokers, ANITA, KRAK HEADS, Nobodies Secret Society)
--              and fix the Rekt Ink logo to use its official OpenSea icon.
--
-- Contract addresses verified against OpenSea collection slugs:
--   opensea.io/collection/inkbrokers-nft       -> 0x0e4aa738d2cbe8c1f3d4e46a1f1af33611365a5f (ERC-721)
--   opensea.io/collection/anitaonink           -> 0x1dc9a006785c7c280da676d3916aa29307b9d9f5 (ERC-721)
--   opensea.io/collection/krak-heads-285086705 -> 0x96d2640b91dfd42b118ae6b181133b81526907e9 (ERC-721)
--   opensea.io/collection/nobodiesnft          -> 0x401eb692882a193aa78e830d8762939b1897c835 (ERC-721)

-- New NFT Collections
INSERT INTO tracked_assets (asset_type, token_type, name, symbol, address, logo_url, twitter_handle, website_url, display_order) VALUES
  ('nft_collection', NULL, 'Ink Brokers', NULL, '0x0e4aa738d2cbe8c1f3d4e46a1f1af33611365a5f', 'https://i2c.seadn.io/collection/ink-brokers-94135623/image_type_logo/3b302842784f41c8de5048893c3a2e/423b302842784f41c8de5048893c3a2e.gif', 'Brokers_on_Ink', 'https://inkbrokers.com', 6),
  ('nft_collection', NULL, 'ANITA', NULL, '0x1dc9a006785c7c280da676d3916aa29307b9d9f5', 'https://i2c.seadn.io/collection/anitaonink/image_type_logo/c39e22d1a0a1913c3e95d6e4f5d75f/95c39e22d1a0a1913c3e95d6e4f5d75f.png', 'ANITAONINKCTO', NULL, 7),
  ('nft_collection', NULL, 'KRAK HEADS', NULL, '0x96d2640b91dfd42b118ae6b181133b81526907e9', 'https://i2c.seadn.io/collection/krak-heads-285086705/image_type_logo/b40a00b716a20e83cac99d91c06d47/a3b40a00b716a20e83cac99d91c06d47.png', 'KrakMask', 'https://boi.market/collections', 8),
  ('nft_collection', NULL, 'Nobodies Secret Society', NULL, '0x401eb692882a193aa78e830d8762939b1897c835', 'https://i2c.seadn.io/collection/nobodies-secret-society/image_type_logo/ce6088c24dc6b5958171cde4074865/dece6088c24dc6b5958171cde4074865.png', 'No1s_NFT', NULL, 9)
ON CONFLICT (address) DO NOTHING;

-- Fix Rekt Ink logo to the official OpenSea collection icon
UPDATE tracked_assets
SET logo_url = 'https://i2c.seadn.io/collection/rekt-ink/image_type_logo/89da470a747b09bd0618de67806af3/4289da470a747b09bd0618de67806af3.jpeg?h=250&w=250',
    updated_at = NOW()
WHERE address = '0x25aa78ab6785a4b0aeff5c170998992fd958d43d';

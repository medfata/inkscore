-- Migration: 027_opensea_slug.sql
-- Description: Add opensea_slug column to tracked_assets so NFT collection icons
--              in the dashboard link to their OpenSea collection pages.
--
-- Slugs verified against OpenSea (contract address confirmed on each collection page):
--   opensea.io/collection/shellies-ink        -> 0x1c9838cdc00fa39d953a54c755b95605ed5ea49c
--   opensea.io/collection/inkysquad           -> 0xe4e5d5170ba5cae36d1876893d4b218e8ed19c91
--   opensea.io/collection/rekt-ink            -> 0x25aa78ab6785a4b0aeff5c170998992fd958d43d
--   opensea.io/collection/inkbrokers-nft      -> 0x0e4aa738d2cbe8c1f3d4e46a1f1af33611365a5f
--   opensea.io/collection/anitaonink          -> 0x1dc9a006785c7c280da676d3916aa29307b9d9f5
--   opensea.io/collection/krak-heads-285086705 -> 0x96d2640b91dfd42b118ae6b181133b81526907e9
--   opensea.io/collection/nobodiesnft         -> 0x401eb692882a193aa78e830d8762939b1897c835

ALTER TABLE tracked_assets ADD COLUMN IF NOT EXISTS opensea_slug VARCHAR(100);

-- Populate slugs (never overwrite a slug set via the admin panel)
UPDATE tracked_assets SET opensea_slug = 'shellies-ink' WHERE address = '0x1c9838cdc00fa39d953a54c755b95605ed5ea49c' AND opensea_slug IS NULL;
UPDATE tracked_assets SET opensea_slug = 'inkysquad' WHERE address = '0xe4e5d5170ba5cae36d1876893d4b218e8ed19c91' AND opensea_slug IS NULL;
UPDATE tracked_assets SET opensea_slug = 'rekt-ink' WHERE address = '0x25aa78ab6785a4b0aeff5c170998992fd958d43d' AND opensea_slug IS NULL;
UPDATE tracked_assets SET opensea_slug = 'inkbrokers-nft' WHERE address = '0x0e4aa738d2cbe8c1f3d4e46a1f1af33611365a5f' AND opensea_slug IS NULL;
UPDATE tracked_assets SET opensea_slug = 'anitaonink' WHERE address = '0x1dc9a006785c7c280da676d3916aa29307b9d9f5' AND opensea_slug IS NULL;
UPDATE tracked_assets SET opensea_slug = 'krak-heads-285086705' WHERE address = '0x96d2640b91dfd42b118ae6b181133b81526907e9' AND opensea_slug IS NULL;
UPDATE tracked_assets SET opensea_slug = 'nobodiesnft' WHERE address = '0x401eb692882a193aa78e830d8762939b1897c835' AND opensea_slug IS NULL;

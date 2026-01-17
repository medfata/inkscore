-- Migration: 008_tracked_assets.sql
-- Description: Create tracked_assets table for admin-managed ERC20 tokens, meme coins, and NFT collections

-- Asset types enum-like constraint
-- asset_type: 'erc20_token' | 'meme_coin' | 'nft_collection'
-- token_type: 'stablecoin' | 'native' | 'defi' | 'governance' | 'utility' | 'meme' (for tokens only)

CREATE TABLE IF NOT EXISTS tracked_assets (
  id SERIAL PRIMARY KEY,
  
  -- Asset classification
  asset_type VARCHAR(20) NOT NULL CHECK (asset_type IN ('erc20_token', 'meme_coin', 'nft_collection')),
  token_type VARCHAR(20) CHECK (token_type IN ('stablecoin', 'native', 'defi', 'governance', 'utility', 'meme')),
  
  -- Basic info
  name VARCHAR(100) NOT NULL,
  symbol VARCHAR(20),                           -- NULL for NFT collections
  address VARCHAR(42) UNIQUE NOT NULL,          -- Contract address (lowercase)
  logo_url TEXT,
  decimals INT DEFAULT 18,                      -- Token decimals (18 for most, 6 for USDC/USDT)
  
  -- Optional metadata
  description TEXT,
  website_url TEXT,
  twitter_handle VARCHAR(50),                   -- For NFT collections social links
  
  -- Price tracking (for tokens)
  coingecko_id VARCHAR(100),                    -- For price fetching
  dexscreener_pair_address VARCHAR(42),         -- For meme coin price fetching
  
  -- Display settings
  display_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_tracked_assets_type ON tracked_assets(asset_type);
CREATE INDEX IF NOT EXISTS idx_tracked_assets_active ON tracked_assets(is_active);
CREATE INDEX IF NOT EXISTS idx_tracked_assets_address ON tracked_assets(address);

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_tracked_assets_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tracked_assets_updated_at ON tracked_assets;
CREATE TRIGGER tracked_assets_updated_at
  BEFORE UPDATE ON tracked_assets
  FOR EACH ROW
  EXECUTE FUNCTION update_tracked_assets_timestamp();

-- Seed with existing hardcoded assets

-- ERC20 Tokens (stablecoins + native)
INSERT INTO tracked_assets (asset_type, token_type, name, symbol, address, logo_url, decimals, display_order) VALUES
  ('erc20_token', 'native', 'ETH', 'ETH', '0x4200000000000000000000000000000000000006', 'https://pbs.twimg.com/profile_images/1878738447067652096/tXQbWfpf_400x400.jpg', 18, 1),
  ('erc20_token', 'stablecoin', 'USDT0', 'USDT0', '0x0200c29006150606b650577bbe7b6248f58470c1', 'https://pbs.twimg.com/profile_images/1879546764971188224/SQISVYwX_400x400.jpg', 6, 2),
  ('erc20_token', 'stablecoin', 'USDC0', 'USDC0', '0x2d270e6886d130d724215a266106e6832161eaed', 'https://pbs.twimg.com/profile_images/1916937910928211968/CKblfanr_400x400.png', 6, 3),
  ('erc20_token', 'stablecoin', 'Global Dollar', 'USDGLO', '0xe343167631d89b6ffc58b88d6b7fb0228795491d', 'https://pbs.twimg.com/profile_images/1853549476360638464/IlD_0g8Y_400x400.png', 18, 4)
ON CONFLICT (address) DO NOTHING;

-- Meme Coins
INSERT INTO tracked_assets (asset_type, token_type, name, symbol, address, logo_url, decimals, display_order) VALUES
  ('meme_coin', 'meme', 'ANITA', 'ANITA', '0x0606fc632ee812ba970af72f8489baaa443c4b98', 'https://pbs.twimg.com/profile_images/1948708709263089665/sCal-1rw_400x400.jpg', 18, 1),
  ('meme_coin', 'meme', 'Cat on Ink', 'CAT', '0x20c69c12abf2b6f8d8ca33604dd25c700c7e70a5', 'https://pbs.twimg.com/profile_images/1880778671398809601/DV_dS5E9_400x400.png', 18, 2),
  ('meme_coin', 'meme', 'Purple', 'PURPLE', '0xd642b49d10cc6e1bc1c6945725667c35e0875f22', 'https://pbs.twimg.com/profile_images/1887019906102853632/lbS2Mm4V_400x400.jpg', 18, 3),
  ('meme_coin', 'meme', 'Andru Kollor', 'ANDRU', '0x2a1bce657f919ac3f9ab50b2584cfc77563a02ec', 'https://imgproxy-mainnet.routescan.io/VyKaHtkZE4Qn95WJpAAeTGD9dzwQYfQV3UO5VUK78K8/pr:thumb_256/aHR0cHM6Ly9jbXMtY2RuLmF2YXNjYW4uY29tL2NtczIvNTcwNzNfMHgyYTFiY2U2NTdmOTE5YWMzZjlhYjUwYjI1ODRjZmM3NzU2M2EwMmVjLjEwNmY1YjI5N2I1NC53ZWJw', 18, 4),
  ('meme_coin', 'meme', 'Krak Mask', 'KRAK', '0x32bcb803f696c99eb263d60a05cafd8689026575', 'https://imgproxy-mainnet.routescan.io/nqT_RCc56W7qQ-VU88ot02PjqHx3nTNkhTtvDycOa5Y/pr:thumb_256/aHR0cHM6Ly9jbXMtY2RuLmF2YXNjYW4uY29tL2NtczIva3Jha21hc2suNTA1YjIwYmEwZDhiLmpwZwso', 18, 5),
  ('meme_coin', 'meme', 'BERT', 'BERT', '0x62c99fac20b33b5423fdf9226179e973a8353e36', 'https://imgproxy-mainnet.routescan.io/fda7etOaA_l03ksBESskb4juCAYl793B8fRXEM9Cpt8/pr:thumb_256/aHR0cHM6Ly9jbXMtY2RuLmF2YXNjYW4uY29tL2NtczIvYmVydC42NGM2M2ZiNWZlMmQ', 18, 6)
ON CONFLICT (address) DO NOTHING;

-- NFT Collections
INSERT INTO tracked_assets (asset_type, token_type, name, symbol, address, logo_url, twitter_handle, display_order) VALUES
  ('nft_collection', NULL, 'Shellies', NULL, '0x1c9838cdc00fa39d953a54c755b95605ed5ea49c', 'https://pbs.twimg.com/profile_images/1948768160733175808/aNFNH1IH_400x400.jpg', 'ShelliesNFT', 1),
  ('nft_collection', NULL, 'InkySquad', NULL, '0xe4e5d5170ba5cae36d1876893d4b218e8ed19c91', 'https://pbs.twimg.com/profile_images/1953536918282444801/usC4AlFP_400x400.jpg', 'InkySquad', 2),
  ('nft_collection', NULL, 'BOI', NULL, '0x63febfa0a5474803f4261a1628763b1b2cc3ab83', 'https://pbs.twimg.com/profile_images/1952287497477664768/B8jJLN33_400x400.jpg', 'Boi_Ink', 3),
  ('nft_collection', NULL, 'INK Bunnies', NULL, '0x4443970b315d3c08c2f962fe00770c52396afdb7', 'https://pbs.twimg.com/profile_images/1996167791347408896/ds6khpeY_400x400.jpg', 'InkBunnies', 4),
  ('nft_collection', NULL, 'Rekt Ink', NULL, '0x25aa78ab6785a4b0aeff5c170998992fd958d43d', 'https://pbs.twimg.com/profile_images/1957753909713203200/jGEz5WCQ_400x400.jpg', NULL, 5)
ON CONFLICT (address) DO NOTHING;

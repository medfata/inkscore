-- Add Tydro Pool contract to contracts_metadata

INSERT INTO contracts_metadata (address, name, category, website_url, is_active)
VALUES (
  '0x2816cf15f6d2a220e789aa011d5ee4eb6c47feba',
  'Tydro Pool',
  'defi',
  'https://app.tydro.com',
  true
)
ON CONFLICT (address) DO UPDATE SET
  name = 'Tydro Pool',
  category = 'defi',
  website_url = 'https://app.tydro.com',
  is_active = true;

-- Verify the contract was added
SELECT * FROM contracts_metadata WHERE address = '0x2816cf15f6d2a220e789aa011d5ee4eb6c47feba';

-- Migration: Update Cat on Ink token logo URL
-- Description: Update the Cat meme coin logo to the new InkyPump storage URL

UPDATE tracked_assets 
SET logo_url = 'https://storage.inkypump.com/storage/v1/object/public/images/61acee2f19d4d3e90a3e967dc7e7df43cb14c2ef2a7e7c9328f02c98d66376ab.jpeg'
WHERE address = '0x20c69c12abf2b6f8d8ca33604dd25c700c7e70a5'
  AND symbol = 'CAT';

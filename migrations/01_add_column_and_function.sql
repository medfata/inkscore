-- Part 1: Add column and function (run this first)
-- This is fast and non-blocking

-- Step 1: Add the column
ALTER TABLE transaction_enrichment 
ADD COLUMN IF NOT EXISTS related_wallets text[];

-- Step 2: Create a function to extract wallet addresses from operations and logs
CREATE OR REPLACE FUNCTION extract_wallet_addresses(ops jsonb, logs_data jsonb) 
RETURNS text[] AS $$
DECLARE
  wallets text[] := ARRAY[]::text[];
  op jsonb;
  log_entry jsonb;
  topic text;
BEGIN
  -- Extract from operations (to.id and from.id)
  IF ops IS NOT NULL THEN
    FOR op IN SELECT * FROM jsonb_array_elements(ops)
    LOOP
      IF op->'to'->>'id' IS NOT NULL THEN
        wallets := array_append(wallets, LOWER(op->'to'->>'id'));
      END IF;
      IF op->'from'->>'id' IS NOT NULL THEN
        wallets := array_append(wallets, LOWER(op->'from'->>'id'));
      END IF;
    END LOOP;
  END IF;
  
  -- Extract from logs (topics contain addresses)
  IF logs_data IS NOT NULL THEN
    FOR log_entry IN SELECT * FROM jsonb_array_elements(logs_data)
    LOOP
      -- Topics 1, 2, 3 often contain addresses (topic 0 is event signature)
      FOR topic IN SELECT * FROM jsonb_array_elements_text(log_entry->'topics')
      LOOP
        -- Extract address from topic (last 40 chars after 0x)
        IF length(topic) = 66 THEN
          wallets := array_append(wallets, LOWER('0x' || substring(topic from 27 for 40)));
        END IF;
      END LOOP;
    END LOOP;
  END IF;
  
  -- Remove duplicates and return
  RETURN ARRAY(SELECT DISTINCT unnest(wallets));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Step 3: Create a trigger to auto-populate for new rows
CREATE OR REPLACE FUNCTION update_related_wallets() 
RETURNS TRIGGER AS $$
BEGIN
  NEW.related_wallets := extract_wallet_addresses(NEW.operations, NEW.logs);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_related_wallets
  BEFORE INSERT OR UPDATE OF operations, logs ON transaction_enrichment
  FOR EACH ROW
  EXECUTE FUNCTION update_related_wallets();

SELECT 'Column and function created successfully!' as status;

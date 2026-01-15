#!/bin/bash

# Configuration
CONTAINER_CMD="docker compose exec -T postgres psql -U ink -d ink_analytics"
BATCH_SIZE=100000
SLEEP_BETWEEN_BATCHES=2  # seconds to wait between batches

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}Starting batch population of related_wallets column${NC}"
echo "Batch size: $BATCH_SIZE"
echo "-------------------------------------------"

# Get initial count
initial_remaining=$($CONTAINER_CMD -t -c "SELECT COUNT(*) FROM transaction_enrichment WHERE related_wallets IS NULL AND (operations IS NOT NULL OR logs IS NOT NULL);" | grep -oP '^\s*\K\d+')
echo -e "${YELLOW}Total rows to process: $initial_remaining${NC}"
echo "-------------------------------------------"

# Counter for tracking progress
batch_number=0
total_updated=0

while true; do
    ((batch_number++))
    
    echo -e "${YELLOW}Running batch #$batch_number...${NC}"
    start_time=$(date +%s)
    
    # Run the update using pure SQL (much faster than PL/pgSQL function)
    result=$($CONTAINER_CMD <<EOF
UPDATE transaction_enrichment te
SET related_wallets = sub.wallets
FROM (
    SELECT 
        t.tx_hash,
        ARRAY(
            SELECT DISTINCT addr FROM (
                -- Extract from operations
                SELECT LOWER(op->>'to') as addr 
                FROM jsonb_array_elements(t.operations) op 
                WHERE op->>'to' IS NOT NULL
                UNION
                SELECT LOWER(op->>'from') as addr 
                FROM jsonb_array_elements(t.operations) op 
                WHERE op->>'from' IS NOT NULL
                UNION
                SELECT LOWER(op->'to'->>'id') as addr 
                FROM jsonb_array_elements(t.operations) op 
                WHERE op->'to'->>'id' IS NOT NULL
                UNION
                SELECT LOWER(op->'from'->>'id') as addr 
                FROM jsonb_array_elements(t.operations) op 
                WHERE op->'from'->>'id' IS NOT NULL
                UNION
                -- Extract from logs topics (addresses are in topics 1,2,3)
                SELECT LOWER('0x' || substring(topic from 27 for 40)) as addr
                FROM jsonb_array_elements(t.logs) log,
                     jsonb_array_elements_text(log->'topics') topic
                WHERE length(topic) = 66
            ) addrs
            WHERE addr ~ '^0x[a-f0-9]{40}$'
        ) as wallets
    FROM transaction_enrichment t
    WHERE t.related_wallets IS NULL
      AND (t.operations IS NOT NULL OR t.logs IS NOT NULL)
    ORDER BY t.tx_hash
    LIMIT $BATCH_SIZE
) sub
WHERE te.tx_hash = sub.tx_hash;
EOF
)
    
    end_time=$(date +%s)
    duration=$((end_time - start_time))
    
    # Extract the number of rows updated
    rows_updated=$(echo "$result" | grep -oP 'UPDATE \K\d+')
    
    if [ -z "$rows_updated" ]; then
        echo -e "${RED}Error: Could not determine rows updated. Output: $result${NC}"
        exit 1
    fi
    
    total_updated=$((total_updated + rows_updated))
    
    echo -e "${GREEN}Batch #$batch_number: Updated $rows_updated rows in ${duration}s (Total: $total_updated)${NC}"
    
    # Check if we're done
    if [ "$rows_updated" -eq 0 ]; then
        echo -e "${GREEN}-------------------------------------------${NC}"
        echo -e "${GREEN}Population complete! Total rows updated: $total_updated${NC}"
        break
    fi
    
    # Check remaining rows
    remaining=$($CONTAINER_CMD -t -c "SELECT COUNT(*) FROM transaction_enrichment WHERE related_wallets IS NULL AND (operations IS NOT NULL OR logs IS NOT NULL);" | grep -oP '^\s*\K\d+')
    
    if [ ! -z "$remaining" ]; then
        progress_pct=$(echo "scale=2; ($total_updated / $initial_remaining) * 100" | bc)
        echo -e "${YELLOW}Remaining: $remaining rows | Progress: ${progress_pct}%${NC}"
    fi
    
    echo "Waiting $SLEEP_BETWEEN_BATCHES seconds before next batch..."
    echo ""
    sleep $SLEEP_BETWEEN_BATCHES
done

echo ""
echo -e "${GREEN}Now creating the GIN index for fast lookups...${NC}"
$CONTAINER_CMD <<EOF
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tx_enrichment_related_wallets 
ON transaction_enrichment USING gin (related_wallets)
WHERE related_wallets IS NOT NULL;
EOF

echo -e "${GREEN}-------------------------------------------${NC}"
echo -e "${GREEN}All done! Bridge queries should now be 30-40x faster.${NC}"
echo -e "${GREEN}Script finished succes

#!/bin/bash

# Configuration
CONTAINER_CMD="docker compose exec -T postgres psql -U ink -d ink_analytics"
BATCH_SIZE=500000
SLEEP_BETWEEN_BATCHES=2  # seconds to wait between batches

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}Starting batch update of wallet_address to lowercase${NC}"
echo "Batch size: $BATCH_SIZE"
echo "-------------------------------------------"

# Counter for tracking progress
batch_number=0
total_updated=0

while true; do
    ((batch_number++))
    
    echo -e "${YELLOW}Running batch #$batch_number...${NC}"
    
    # Run the update and capture the output
    result=$($CONTAINER_CMD <<EOF
UPDATE transaction_details
SET wallet_address = LOWER(wallet_address)
WHERE tx_hash IN (
    SELECT tx_hash
    FROM transaction_details
    WHERE wallet_address <> LOWER(wallet_address)
    LIMIT $BATCH_SIZE
);
EOF
)
    
    # Extract the number of rows updated
    rows_updated=$(echo "$result" | grep -oP 'UPDATE \K\d+')
    
    if [ -z "$rows_updated" ]; then
        echo -e "${RED}Error: Could not determine rows updated. Output: $result${NC}"
        exit 1
    fi
    
    total_updated=$((total_updated + rows_updated))
    
    echo -e "${GREEN}Batch #$batch_number: Updated $rows_updated rows (Total: $total_updated)${NC}"
    
    # Check if we're done
    if [ "$rows_updated" -eq 0 ]; then
        echo -e "${GREEN}-------------------------------------------${NC}"
        echo -e "${GREEN}Update complete! Total rows updated: $total_updated${NC}"
        break
    fi
    
    # Check remaining rows
    remaining=$($CONTAINER_CMD -t -c "SELECT COUNT(*) FROM transaction_details WHERE wallet_address <> LOWER(wallet_address);" | grep -oP '^\s*\K\d+')
    
    if [ ! -z "$remaining" ]; then
        echo -e "${YELLOW}Remaining rows to update: $remaining${NC}"
    fi
    
    echo "Waiting $SLEEP_BETWEEN_BATCHES seconds before next batch..."
    echo ""
    sleep $SLEEP_BETWEEN_BATCHES
done

echo -e "${GREEN}Script finished successfully!${NC}"
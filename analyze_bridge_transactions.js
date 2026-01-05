const { Pool } = require('pg');

// Database connection using DATABASE_URL environment variable
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function analyzeBridgeTransactions() {
    try {
        console.log('🔍 Analyzing Bridge Transactions...\n');

        // Contract addresses
        const SOCKET_GATEWAY = '0x3a23f943181408eac424116af7b7790c94cb97a5';
        const ACROSS_V3_BRIDGE = '0xef684c38f94f48775959ecf2012d7e864ffb9dd4';

        // Fetch sample transactions from Socket Gateway (Bungee)
        console.log('📊 Socket Gateway (Bungee) Transactions:');
        console.log('='.repeat(80));

        const socketQuery = `
      SELECT 
        tx_hash,
        wallet_address,
        value,
        method_id,
        method_full,
        eth_value_decimal,
        eth_usd_value,
        tokens_in_count,
        tokens_in_usd_total,
        tokens_out_count,
        tokens_out_usd_total,
        internal_eth_in,
        internal_eth_in_usd,
        internal_eth_out,
        internal_eth_out_usd,
        total_usd_volume,
        created_at
      FROM transaction_enrichment 
      WHERE contract_address = $1
      ORDER BY created_at DESC 
      LIMIT 5
    `;

        const socketResults = await pool.query(socketQuery, [SOCKET_GATEWAY.toLowerCase()]);

        socketResults.rows.forEach((tx, index) => {
            console.log(`\n--- Transaction ${index + 1} ---`);
            console.log(`TX Hash: ${tx.tx_hash}`);
            console.log(`Wallet: ${tx.wallet_address}`);
            console.log(`Method ID: ${tx.method_id}`);
            console.log(`Method: ${tx.method_full || 'N/A'}`);
            console.log(`ETH Value: ${tx.eth_value_decimal || 0}`);
            console.log(`ETH USD: $${tx.eth_usd_value || 0}`);
            console.log(`Tokens In Count: ${tx.tokens_in_count || 0}`);
            console.log(`Tokens In USD: $${tx.tokens_in_usd_total || 0}`);
            console.log(`Tokens Out Count: ${tx.tokens_out_count || 0}`);
            console.log(`Tokens Out USD: $${tx.tokens_out_usd_total || 0}`);
            console.log(`Internal ETH In: ${tx.internal_eth_in || 0}`);
            console.log(`Internal ETH In USD: $${tx.internal_eth_in_usd || 0}`);
            console.log(`Internal ETH Out: ${tx.internal_eth_out || 0}`);
            console.log(`Internal ETH Out USD: $${tx.internal_eth_out_usd || 0}`);
            console.log(`Total USD Volume: $${tx.total_usd_volume || 0}`);
            console.log(`Created: ${tx.created_at}`);
        });

        // Fetch sample transactions from Across V3 Bridge
        console.log('\n\n📊 Across V3 Bridge Transactions:');
        console.log('='.repeat(80));

        const acrossResults = await pool.query(socketQuery, [ACROSS_V3_BRIDGE.toLowerCase()]);

        acrossResults.rows.forEach((tx, index) => {
            console.log(`\n--- Transaction ${index + 1} ---`);
            console.log(`TX Hash: ${tx.tx_hash}`);
            console.log(`Wallet: ${tx.wallet_address}`);
            console.log(`Method ID: ${tx.method_id}`);
            console.log(`Method: ${tx.method_full || 'N/A'}`);
            console.log(`ETH Value: ${tx.eth_value_decimal || 0}`);
            console.log(`ETH USD: $${tx.eth_usd_value || 0}`);
            console.log(`Tokens In Count: ${tx.tokens_in_count || 0}`);
            console.log(`Tokens In USD: $${tx.tokens_in_usd_total || 0}`);
            console.log(`Tokens Out Count: ${tx.tokens_out_count || 0}`);
            console.log(`Tokens Out USD: $${tx.tokens_out_usd_total || 0}`);
            console.log(`Internal ETH In: ${tx.internal_eth_in || 0}`);
            console.log(`Internal ETH In USD: $${tx.internal_eth_in_usd || 0}`);
            console.log(`Internal ETH Out: ${tx.internal_eth_out || 0}`);
            console.log(`Internal ETH Out USD: $${tx.internal_eth_out_usd || 0}`);
            console.log(`Total USD Volume: $${tx.total_usd_volume || 0}`);
            console.log(`Created: ${tx.created_at}`);
        });

        // Analyze patterns
        console.log('\n\n🔍 Analysis Summary:');
        console.log('='.repeat(80));

        // Method ID analysis
        const methodAnalysisQuery = `
      SELECT 
        contract_address,
        method_id,
        method_full,
        COUNT(*) as transaction_count,
        AVG(COALESCE(eth_usd_value, 0) + COALESCE(tokens_in_usd_total, 0) + COALESCE(tokens_out_usd_total, 0) + COALESCE(internal_eth_in_usd, 0) + COALESCE(internal_eth_out_usd, 0)) as avg_usd_volume
      FROM transaction_enrichment 
      WHERE contract_address IN ($1, $2)
      GROUP BY contract_address, method_id, method_full
      ORDER BY contract_address, transaction_count DESC
    `;

        const methodResults = await pool.query(methodAnalysisQuery, [
            SOCKET_GATEWAY.toLowerCase(),
            ACROSS_V3_BRIDGE.toLowerCase()
        ]);

        console.log('\nMethod ID Patterns:');
        methodResults.rows.forEach(row => {
            const contractName = row.contract_address === SOCKET_GATEWAY.toLowerCase() ? 'Socket Gateway' : 'Across V3';
            console.log(`${contractName}: ${row.method_id} (${row.method_full || 'Unknown'}) - ${row.transaction_count} txs, Avg: $${parseFloat(row.avg_usd_volume).toFixed(2)}`);
        });

        // Bridge direction analysis
        console.log('\n🔄 Suggested Bridge Direction Logic:');
        console.log('BRIDGE OUT (from Ink chain):');
        console.log('- Socket Gateway transactions (users depositing)');
        console.log('- Calculate: eth_usd_value + tokens_in_usd_total + internal_eth_in_usd');
        console.log('\nBRIDGE IN (to Ink chain):');
        console.log('- Across V3 fillRelay/fillV3Relay transactions (relayers fulfilling)');
        console.log('- Calculate: eth_usd_value + tokens_out_usd_total + internal_eth_out_usd');

    } catch (error) {
        console.error('Error analyzing transactions:', error);
    } finally {
        await pool.end();
    }
}

// Run the analysis
analyzeBridgeTransactions();
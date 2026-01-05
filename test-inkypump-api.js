// Test InkyPump API endpoints with real wallet addresses that have transactions
const { default: fetch } = require('node-fetch');

// Real wallet addresses from the database that have transactions
const buyWallet = '0xb435b19b0a96cc4cb315cca3b2a65916efa25ce6';  // Has buy transactions (0x7ff36ab5)
const sellWallet = '0x8f26b287aa4e0a4cab7a5cc0003ab16116c878ef'; // Has sell transactions (0x18cbafe5)

async function testInkyPumpEndpoints() {
    const baseUrl = 'http://localhost:3000';

    console.log('🚀 Testing InkyPump API endpoints with real data...\n');

    // Test buy volume with wallet that has buy transactions
    console.log('📈 Testing Buy Volume API:');
    console.log(`Wallet: ${buyWallet}`);
    try {
        const response = await fetch(`${baseUrl}/api/analytics/${buyWallet}/inkypump_buy_volume`);
        const data = await response.json();
        console.log('Buy Volume Response:', JSON.stringify(data, null, 2));

        if (parseFloat(data.total_value) > 0) {
            console.log('✅ Buy volume data found!');
        } else {
            console.log('⚠️  Buy volume is 0 - might need to check enrichment data');
        }
    } catch (error) {
        console.error('❌ Error fetching buy volume:', error.message);
    }

    console.log('\n' + '='.repeat(50) + '\n');

    // Test sell volume with wallet that has sell transactions
    console.log('📉 Testing Sell Volume API:');
    console.log(`Wallet: ${sellWallet}`);
    try {
        const response = await fetch(`${baseUrl}/api/analytics/${sellWallet}/inkypump_sell_volume`);
        const data = await response.json();
        console.log('Sell Volume Response:', JSON.stringify(data, null, 2));

        if (parseFloat(data.total_value) > 0) {
            console.log('✅ Sell volume data found!');
        } else {
            console.log('⚠️  Sell volume is 0 - might need to check enrichment data');
        }
    } catch (error) {
        console.error('❌ Error fetching sell volume:', error.message);
    }

    console.log('\n' + '='.repeat(50) + '\n');

    // Test created tokens with buy wallet
    console.log('🎯 Testing Created Tokens API:');
    console.log(`Wallet: ${buyWallet}`);
    try {
        const response = await fetch(`${baseUrl}/api/analytics/${buyWallet}/inkypump_created_tokens`);
        const data = await response.json();
        console.log('Created Tokens Response:', JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('❌ Error fetching created tokens:', error.message);
    }

    console.log('\n🏁 Test completed!');
}

testInkyPumpEndpoints();
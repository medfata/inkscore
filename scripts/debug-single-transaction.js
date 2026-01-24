const https = require('https');

// Test a single transaction to debug the API issue
const testTransaction = '0x2c2e35e74ac733c1689bd1b3531148ba92fb47d343441768a30c9e758e8c5fe8';
const url = `https://cdn.routescan.io/api/evm/57073/transactions/${testTransaction}`;

console.log('🔍 Testing single transaction API call');
console.log('URL:', url);
console.log('');

https.get(url, (res) => {
  let data = '';
  
  console.log('Status Code:', res.statusCode);
  console.log('Headers:', JSON.stringify(res.headers, null, 2));
  console.log('');
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log('Response Body:');
    try {
      const jsonData = JSON.parse(data);
      console.log(JSON.stringify(jsonData, null, 2));
    } catch (error) {
      console.log('Raw response (not JSON):');
      console.log(data);
    }
  });
}).on('error', (error) => {
  console.error('Request Error:', error.message);
});
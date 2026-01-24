# Transaction Export Scripts

Scripts to export transaction data from Routescan API for contract `0x1D74317d760f2c72A94386f50E8D10f2C902b899`.

## Available Scripts

### Node.js Version
- **File**: `export-transactions.js`
- **Usage**: `node export-transactions.js`
- **Requirements**: Node.js (built-in modules only)

### Python Version
- **File**: `export-transactions.py`
- **Usage**: `python export-transactions.py`
- **Requirements**: Python 3.6+ with `requests` library

## What the Scripts Do

1. **Initiate Export**: Makes a POST request to start the transaction export
2. **Poll Status**: Continuously checks export status until completion
3. **Download File**: Downloads the resulting ZIP file when ready

## Configuration

The scripts are pre-configured with:
- Contract Address: `0x1D74317d760f2c72A94386f50E8D10f2C902b899`
- Chain ID: `57073`
- Start Date: `2024-12-28T13:51:06.000Z` (contract creation)
- End Date: Current date/time
- Transaction Limit: `63,956`

## Output

The script will create a ZIP file named `transactions_{exportId}.zip` in the current directory containing the CSV data.

## Installation

### For Python version:
```bash
pip install requests
```

### For Node.js version:
No additional dependencies required (uses built-in modules).
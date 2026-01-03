#!/usr/bin/env python3
"""
Transaction Export Script for Routescan API
Downloads transaction data for a specific contract address
"""

import requests
import time
import json
from datetime import datetime
import sys
import os

class TransactionExporter:
    def __init__(self):
        self.base_url = "https://cdn.routescan.io/api/evm/all/exports"
        self.address = "0x1D74317d760f2c72A94386f50E8D10f2C902b899"
        self.chain_id = "57073"
        self.contract_created_date = "2024-12-28T13:51:06.000Z"
        self.current_date = datetime.now().isoformat() + "Z"
        self.transaction_limit = 63956

    def initiate_export(self):
        """Initiate the export request"""
        export_url = f"{self.base_url}/transactions"
        
        params = {
            "includedChainIds": self.chain_id,
            "address": self.address,
            "limit": str(self.transaction_limit),
            "dateFrom": self.contract_created_date,
            "dateTo": self.current_date,
            "csvSeparator": ","
        }
        
        print("Initiating export request...")
        print(f"URL: {export_url}")
        print(f"Params: {params}")
        
        try:
            response = requests.post(export_url, params=params, timeout=30)
            response.raise_for_status()
            
            data = response.json()
            if "exportId" in data:
                print("Export initiated successfully!")
                print(f"Export ID: {data['exportId']}")
                return data["exportId"]
            else:
                raise Exception(f"Failed to initiate export: {data}")
                
        except requests.exceptions.RequestException as e:
            print(f"Error initiating export: {e}")
            raise

    def check_export_status(self, export_id):
        """Check the status of an export"""
        status_url = f"{self.base_url}/{export_id}"
        
        try:
            response = requests.get(status_url, timeout=30)
            response.raise_for_status()
            return response.json()
            
        except requests.exceptions.RequestException as e:
            print(f"Error checking export status: {e}")
            raise

    def poll_for_completion(self, export_id, max_attempts=60, interval_seconds=5):
        """Poll the API until export is complete"""
        print("Polling for export completion...")
        
        for attempt in range(1, max_attempts + 1):
            try:
                status = self.check_export_status(export_id)
                
                print(f"Attempt {attempt}: Status = {status.get('status', 'unknown')}")
                
                if status.get("status") == "succeeded":
                    print("Export completed successfully!")
                    return status.get("url")
                elif status.get("status") == "failed":
                    raise Exception("Export failed")
                elif status.get("status") == "running":
                    print(f"Export still running... waiting {interval_seconds} seconds")
                    time.sleep(interval_seconds)
                else:
                    print(f"Unknown status: {status.get('status')}")
                    time.sleep(interval_seconds)
                    
            except Exception as e:
                print(f"Error on attempt {attempt}: {e}")
                if attempt == max_attempts:
                    raise
                time.sleep(interval_seconds)
        
        raise Exception(f"Export did not complete within {max_attempts} attempts")

    def download_file(self, url, filename):
        """Download the ZIP file"""
        print("Downloading file...")
        print(f"URL: {url}")
        
        try:
            response = requests.get(url, stream=True, timeout=300)
            response.raise_for_status()
            
            with open(filename, 'wb') as file:
                for chunk in response.iter_content(chunk_size=8192):
                    if chunk:
                        file.write(chunk)
            
            print(f"File downloaded successfully: {filename}")
            return filename
            
        except requests.exceptions.RequestException as e:
            print(f"Error downloading file: {e}")
            # Clean up partial file
            if os.path.exists(filename):
                os.remove(filename)
            raise

    def run(self):
        """Main execution method"""
        try:
            print("=== Transaction Export Script ===")
            print(f"Contract Address: {self.address}")
            print(f"Chain ID: {self.chain_id}")
            print(f"Date Range: {self.contract_created_date} to {self.current_date}")
            print(f"Transaction Limit: {self.transaction_limit}")
            print("")
            
            # Step 1: Initiate export
            export_id = self.initiate_export()
            
            # Step 2: Poll for completion
            download_url = self.poll_for_completion(export_id)
            
            # Step 3: Download the file
            filename = f"transactions_{export_id}.zip"
            self.download_file(download_url, filename)
            
            print("")
            print("=== Export Complete ===")
            print(f"File saved as: {filename}")
            
        except Exception as e:
            print(f"Export failed: {e}")
            sys.exit(1)

if __name__ == "__main__":
    exporter = TransactionExporter()
    exporter.run()
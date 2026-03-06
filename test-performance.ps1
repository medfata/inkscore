#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Dashboard Streaming Performance Test Suite

.DESCRIPTION
    Runs comprehensive performance tests for the dashboard streaming implementation.
    Tests include:
    - Time to first metric
    - Time to 80% of metrics
    - Streaming vs non-streaming comparison
    - Memory leak detection
    - Slow network conditions
    - Buffering verification

.PARAMETER TestType
    Type of test to run: all, unit, benchmark, memory, network

.PARAMETER Wallet
    Wallet address to test (default: test wallet)

.EXAMPLE
    .\test-performance.ps1
    .\test-performance.ps1 -TestType benchmark
    .\test-performance.ps1 -TestType all -Wallet 0xYourWallet

.NOTES
    Requires Next.js dev server and Express API server to be running
#>

param(
    [Parameter(Mandatory=$false)]
    [ValidateSet('all', 'unit', 'benchmark', 'memory', 'network')]
    [string]$TestType = 'all',
    
    [Parameter(Mandatory=$false)]
    [string]$Wallet = '0x1234567890123456789012345678901234567890'
)

# Colors
$ColorReset = "`e[0m"
$ColorGreen = "`e[32m"
$ColorYellow = "`e[33m"
$ColorBlue = "`e[34m"
$ColorRed = "`e[31m"

function Write-Header {
    param([string]$Message)
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Blue
    Write-Host $Message -ForegroundColor Blue
    Write-Host "============================================================" -ForegroundColor Blue
    Write-Host ""
}

function Write-Success {
    param([string]$Message)
    Write-Host "✓ $Message" -ForegroundColor Green
}

function Write-Error {
    param([string]$Message)
    Write-Host "✗ $Message" -ForegroundColor Red
}

function Write-Info {
    param([string]$Message)
    Write-Host "ℹ $Message" -ForegroundColor Blue
}

function Write-Warning {
    param([string]$Message)
    Write-Host "⚠ $Message" -ForegroundColor Yellow
}

function Test-ServerRunning {
    param([string]$Url, [string]$Name)
    
    try {
        $response = Invoke-WebRequest -Uri $Url -Method Head -TimeoutSec 2 -ErrorAction Stop
        Write-Success "$Name is running"
        return $true
    } catch {
        Write-Error "$Name is not running at $Url"
        return $false
    }
}

function Run-UnitTests {
    Write-Header "Running Unit Performance Tests"
    
    Write-Info "Running Vitest performance tests..."
    npm run test:performance
    
    if ($LASTEXITCODE -eq 0) {
        Write-Success "Unit tests passed"
        return $true
    } else {
        Write-Error "Unit tests failed"
        return $false
    }
}

function Run-Benchmark {
    Write-Header "Running Performance Benchmark"
    
    Write-Info "Comparing streaming vs non-streaming performance..."
    
    if ($Wallet -ne '0x1234567890123456789012345678901234567890') {
        npm run benchmark:streaming $Wallet
    } else {
        npm run benchmark:streaming
    }
    
    if ($LASTEXITCODE -eq 0) {
        Write-Success "Benchmark completed successfully"
        return $true
    } else {
        Write-Error "Benchmark failed"
        return $false
    }
}

function Run-MemoryTest {
    Write-Header "Running Memory Leak Detection"
    
    Write-Info "Testing for memory leaks over multiple connections..."
    Write-Warning "This test may take 1-2 minutes..."
    
    if ($Wallet -ne '0x1234567890123456789012345678901234567890') {
        npm run test:memory-leaks $Wallet
    } else {
        npm run test:memory-leaks
    }
    
    if ($LASTEXITCODE -eq 0) {
        Write-Success "No memory leaks detected"
        return $true
    } else {
        Write-Warning "Potential memory leak detected"
        return $false
    }
}

function Run-NetworkTest {
    Write-Header "Running Slow Network Test"
    
    Write-Info "Testing streaming under slow network conditions..."
    
    if ($Wallet -ne '0x1234567890123456789012345678901234567890') {
        npm run test:slow-network $Wallet
    } else {
        npm run test:slow-network
    }
    
    if ($LASTEXITCODE -eq 0) {
        Write-Success "Slow network test passed"
        return $true
    } else {
        Write-Error "Slow network test failed"
        return $false
    }
}

# Main execution
Write-Header "Dashboard Streaming Performance Test Suite"

Write-Info "Test Type: $TestType"
Write-Info "Wallet: $Wallet"
Write-Host ""

# Check if servers are running
Write-Info "Checking if servers are running..."
$nextRunning = Test-ServerRunning -Url "http://localhost:3000" -Name "Next.js"
$expressRunning = Test-ServerRunning -Url "http://localhost:4000/health" -Name "Express API"

if (-not $nextRunning -or -not $expressRunning) {
    Write-Host ""
    Write-Error "Required servers are not running!"
    Write-Info "Please start the servers:"
    Write-Info "  1. Next.js: npm run dev"
    Write-Info "  2. Express API: cd express-api && npm start"
    exit 1
}

Write-Host ""

# Run tests based on type
$results = @{
    unit = $null
    benchmark = $null
    memory = $null
    network = $null
}

switch ($TestType) {
    'all' {
        $results.unit = Run-UnitTests
        $results.benchmark = Run-Benchmark
        $results.memory = Run-MemoryTest
        $results.network = Run-NetworkTest
    }
    'unit' {
        $results.unit = Run-UnitTests
    }
    'benchmark' {
        $results.benchmark = Run-Benchmark
    }
    'memory' {
        $results.memory = Run-MemoryTest
    }
    'network' {
        $results.network = Run-NetworkTest
    }
}

# Summary
Write-Header "Test Summary"

$allPassed = $true

foreach ($key in $results.Keys) {
    if ($null -ne $results[$key]) {
        $status = if ($results[$key]) { "PASSED" } else { "FAILED" }
        $color = if ($results[$key]) { "Green" } else { "Red" }
        
        Write-Host "$($key.ToUpper().PadRight(15)) : " -NoNewline
        Write-Host $status -ForegroundColor $color
        
        if (-not $results[$key]) {
            $allPassed = $false
        }
    }
}

Write-Host ""

if ($allPassed) {
    Write-Success "All tests passed!"
    exit 0
} else {
    Write-Error "Some tests failed"
    exit 1
}

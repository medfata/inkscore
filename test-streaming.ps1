# Test script for SSE streaming endpoint
$testWallet = "0x1234567890123456789012345678901234567890"
$streamUrl = "http://localhost:3000/api/$testWallet/dashboard?stream=true"

Write-Host "Testing SSE streaming endpoint..." -ForegroundColor Cyan
Write-Host "URL: $streamUrl" -ForegroundColor Cyan
Write-Host "---"
Write-Host ""

$startTime = Get-Date
$metricCount = 0
$errorCount = 0
$isDone = $false
$metrics = @()

try {
    # Create web request
    $request = [System.Net.HttpWebRequest]::Create($streamUrl)
    $request.Method = "GET"
    $request.Accept = "text/event-stream"
    $request.KeepAlive = $true
    
    # Get response stream
    $response = $request.GetResponse()
    $stream = $response.GetResponseStream()
    $reader = New-Object System.IO.StreamReader($stream)
    
    Write-Host "[CONNECTED] Stream opened successfully" -ForegroundColor Green
    
    # Read stream line by line
    $timeout = 35
    $endTime = (Get-Date).AddSeconds($timeout)
    
    while (-not $reader.EndOfStream -and (Get-Date) -lt $endTime) {
        $line = $reader.ReadLine()
        
        if ($line -match "^data: (.+)$") {
            $jsonData = $matches[1]
            try {
                $data = $jsonData | ConvertFrom-Json
                
                if ($data.type -eq "metric") {
                    $metricCount++
                    $metrics += $data.id
                    $msg = "[METRIC $metricCount] $($data.id) - $($data.duration)ms"
                    Write-Host $msg -ForegroundColor Yellow
                    if ($data.error) {
                        $errMsg = "  Error: $($data.error)"
                        Write-Host $errMsg -ForegroundColor Red
                        $errorCount++
                    }
                }
                elseif ($data.type -eq "error") {
                    $errorCount++
                    $errMsg = "[ERROR] $($data.id): $($data.error)"
                    Write-Host $errMsg -ForegroundColor Red
                }
                elseif ($data.type -eq "done") {
                    $isDone = $true
                    $totalTime = ((Get-Date) - $startTime).TotalMilliseconds
                    Write-Host ""
                    Write-Host "[DONE] Stream completed" -ForegroundColor Green
                    Write-Host "  Total metrics: $metricCount"
                    Write-Host "  Errors: $errorCount"
                    Write-Host "  Total time: $([math]::Round($totalTime))ms"
                    Write-Host "  Server reported: $($data.totalDuration)ms"
                    Write-Host "  Timed out: $($data.timedOut)"
                    break
                }
            }
            catch {
                $parseErr = "[PARSE ERROR] $($_.Exception.Message)"
                Write-Host $parseErr -ForegroundColor Red
            }
        }
    }
    
    # Cleanup
    $reader.Close()
    $stream.Close()
    $response.Close()
    
    # Verification
    Write-Host ""
    Write-Host "--- VERIFICATION ---" -ForegroundColor Cyan
    if ($metricCount -gt 0) {
        Write-Host "SSE format correct: YES"
    } else {
        Write-Host "SSE format correct: NO"
    }
    
    if ($metricCount -eq 27) {
        Write-Host "All 27 metrics streamed: YES"
    } else {
        Write-Host "All 27 metrics streamed: NO (got $metricCount)"
    }
    
    if ($isDone) {
        Write-Host "Completion event sent: YES"
    } else {
        Write-Host "Completion event sent: NO"
    }
    
    Write-Host ""
    Write-Host "--- METRICS RECEIVED ---" -ForegroundColor Cyan
    $metrics | ForEach-Object { Write-Host "  - $_" }
    
    if (-not $isDone) {
        Write-Host ""
        Write-Host "[TIMEOUT] Test timed out after $timeout seconds" -ForegroundColor Red
        exit 1
    }
}
catch {
    $connErr = "[CONNECTION ERROR] $($_.Exception.Message)"
    Write-Host $connErr -ForegroundColor Red
    exit 1
}

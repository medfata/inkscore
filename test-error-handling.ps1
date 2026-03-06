# Test error handling - verify errors are streamed per-metric without breaking the stream
$testWallet = "0x0000000000000000000000000000000000000000"
$streamUrl = "http://localhost:3000/api/$testWallet/dashboard?stream=true"

Write-Host "Testing error handling with wallet: $testWallet" -ForegroundColor Cyan
Write-Host "URL: $streamUrl" -ForegroundColor Cyan
Write-Host "---"
Write-Host ""

$startTime = Get-Date
$metricCount = 0
$errorCount = 0
$isDone = $false

try {
    $request = [System.Net.HttpWebRequest]::Create($streamUrl)
    $request.Method = "GET"
    $request.Accept = "text/event-stream"
    $request.KeepAlive = $true
    
    $response = $request.GetResponse()
    $stream = $response.GetResponseStream()
    $reader = New-Object System.IO.StreamReader($stream)
    
    Write-Host "[CONNECTED] Stream opened successfully" -ForegroundColor Green
    
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
                    if ($data.error) {
                        $errorCount++
                        $msg = "[METRIC $metricCount] $($data.id) - ERROR: $($data.error)"
                        Write-Host $msg -ForegroundColor Red
                    } else {
                        $msg = "[METRIC $metricCount] $($data.id) - OK"
                        Write-Host $msg -ForegroundColor Green
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
                    break
                }
            }
            catch {
                $parseErr = "[PARSE ERROR] $($_.Exception.Message)"
                Write-Host $parseErr -ForegroundColor Red
            }
        }
    }
    
    $reader.Close()
    $stream.Close()
    $response.Close()
    
    Write-Host ""
    Write-Host "--- ERROR HANDLING VERIFICATION ---" -ForegroundColor Cyan
    if ($errorCount -gt 0) {
        Write-Host "Errors were reported: YES ($errorCount errors)" -ForegroundColor Green
    } else {
        Write-Host "Errors were reported: NO" -ForegroundColor Yellow
    }
    
    if ($isDone) {
        Write-Host "Stream completed despite errors: YES" -ForegroundColor Green
    } else {
        Write-Host "Stream completed despite errors: NO" -ForegroundColor Red
    }
    
    if ($metricCount -eq 27) {
        Write-Host "All metrics attempted: YES" -ForegroundColor Green
    } else {
        Write-Host "All metrics attempted: NO (got $metricCount)" -ForegroundColor Yellow
    }
}
catch {
    $connErr = "[CONNECTION ERROR] $($_.Exception.Message)"
    Write-Host $connErr -ForegroundColor Red
    exit 1
}

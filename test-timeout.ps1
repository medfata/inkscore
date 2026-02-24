# Test timeout scenario - this would require modifying the backend to simulate slow metrics
# For now, we'll verify the timeout logic exists in the code

Write-Host "Testing timeout scenario..." -ForegroundColor Cyan
Write-Host ""

# Check if timeout is implemented in the code
$routeFile = "app\api\[wallet]\dashboard\route.ts"
$content = Get-Content $routeFile | Out-String

if ($content -match "TIMEOUT_MS\s*=\s*30000") {
    Write-Host "✓ 30s timeout is configured" -ForegroundColor Green
} else {
    Write-Host "✗ 30s timeout not found" -ForegroundColor Red
}

if ($content -match "timeoutPromise") {
    Write-Host "✓ Timeout promise implementation found" -ForegroundColor Green
} else {
    Write-Host "✗ Timeout promise not found" -ForegroundColor Red
}

if ($content -match "Promise\.race") {
    Write-Host "✓ Promise.race for timeout handling found" -ForegroundColor Green
} else {
    Write-Host "✗ Promise.race not found" -ForegroundColor Red
}

if ($content -match "timedOut") {
    Write-Host "✓ Timeout flag in completion event found" -ForegroundColor Green
} else {
    Write-Host "✗ Timeout flag not found" -ForegroundColor Red
}

Write-Host ""
Write-Host "Note: To fully test timeout, you would need to:" -ForegroundColor Yellow
Write-Host "  1. Temporarily modify a metric endpoint to delay 31+ seconds"
Write-Host "  2. Verify the stream closes after 30s"
Write-Host "  3. Verify timedOut flag is true in completion event"

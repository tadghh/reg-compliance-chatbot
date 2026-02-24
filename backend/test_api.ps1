param(
    [string]$BaseUrl = "http://localhost:8000"
)

Write-Host "=========================================="
Write-Host "Testing Reg Compliance Chatbot API"
Write-Host "Base URL: $BaseUrl"
Write-Host "=========================================="

$passed = 0
$failed = 0

function Add-Pass {
    param(
        [string]$Name,
        [int]$Status
    )
    Write-Host "PASS: $Name (status: $Status)" -ForegroundColor Green
    $script:passed++
}

function Add-Fail {
    param(
        [string]$Name,
        [int]$Status
    )
    Write-Host "FAIL: $Name (status: $Status)" -ForegroundColor Red
    $script:failed++
}

Write-Host ""
Write-Host "=== Test 1: Root Endpoint ==="
try {
    $resp = Invoke-WebRequest -Uri "$BaseUrl/" -Method Get -ErrorAction Stop
    Write-Host $resp.Content
    Add-Pass -Name "Root endpoint" -Status $resp.StatusCode
}
catch {
    $status = if ($_.Exception.Response) { $_.Exception.Response.StatusCode.value__ } else { 0 }
    Write-Host $_.Exception.Message
    Add-Fail -Name "Root endpoint" -Status $status
}

Write-Host ""
Write-Host "=== Test 2: Health Check ==="
try {
    $resp = Invoke-WebRequest -Uri "$BaseUrl/health" -Method Get -ErrorAction Stop
    Write-Host $resp.Content
    Add-Pass -Name "Health check" -Status $resp.StatusCode
}
catch {
    $status = if ($_.Exception.Response) { $_.Exception.Response.StatusCode.value__ } else { 0 }
    Write-Host $_.Exception.Message
    Add-Fail -Name "Health check" -Status $status
}

Write-Host ""
Write-Host "=== Test 3: Upload Document ==="
$tempFile = Join-Path $env:TEMP "test_compliance_doc.txt"

@'
REGULATORY COMPLIANCE TEST DOCUMENT
====================================

Section 1: Introduction
This document contains compliance guidelines for financial institutions.
All regulated entities must adhere to the requirements outlined herein.

Section 2: Reporting Requirements
Quarterly reports must be submitted within 30 days of quarter end.
Annual reports require independent audit verification.

Section 3: Data Retention
All records must be retained for a minimum of 7 years.
Electronic records must be backed up regularly.

Section 4: Compliance Officers
Each organization must designate a qualified compliance officer.
The compliance officer reports directly to the board of directors.
'@ | Set-Content -Path $tempFile -Encoding UTF8

try {
    # Use WebClient to send a multipart/form-data request to the /upload endpoint
    $webClient = New-Object System.Net.WebClient
    $uri = "$BaseUrl/upload"

    $responseBytes = $webClient.UploadFile($uri, "POST", $tempFile)
    $responseBody = [System.Text.Encoding]::UTF8.GetString($responseBytes)

    Write-Host $responseBody

    # WebClient.UploadFile throws on non-success HTTP codes, so reaching here means success
    Add-Pass -Name "Upload document" -Status 200

    $webClient.Dispose()
}
catch {
    $status = 0
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
        $status = [int]$_.Exception.Response.StatusCode.value__
    }
    Write-Host $_.Exception.Message
    Add-Fail -Name "Upload document" -Status $status
}

Remove-Item -Path $tempFile -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "=== Test 4: Query RAG System ==="
$body = @{
    query = "What are the reporting requirements for compliance?"
    top_k = 3
} | ConvertTo-Json

try {
    $resp = Invoke-WebRequest -Uri "$BaseUrl/query" -Method Post -ContentType "application/json" -Body $body -ErrorAction Stop
    Write-Host $resp.Content
    Add-Pass -Name "Query RAG system" -Status $resp.StatusCode
}
catch {
    $status = if ($_.Exception.Response) { $_.Exception.Response.StatusCode.value__ } else { 0 }
    Write-Host $_.Exception.Message
    Add-Fail -Name "Query RAG system" -Status $status
}

Write-Host ""
Write-Host "=== Test 5: Query with Empty Body (Should Fail) ==="
try {
    $resp = Invoke-WebRequest -Uri "$BaseUrl/query" -Method Post -ContentType "application/json" -Body "{}" -ErrorAction Stop
    if ($resp.StatusCode -eq 422) {
        Write-Host "Empty query returns 422 (status: $($resp.StatusCode))"
        Add-Pass -Name "Empty query returns 422" -Status $resp.StatusCode
    }
    else {
        Write-Host "Expected 422, got $($resp.StatusCode)"
        Add-Fail -Name "Empty query returns 422" -Status $resp.StatusCode
    }
}
catch {
    $status = if ($_.Exception.Response) { $_.Exception.Response.StatusCode.value__ } else { 0 }
    if ($status -eq 422) {
        Write-Host "Empty query returns 422 (status: $status)"
        Add-Pass -Name "Empty query returns 422" -Status $status
    }
    else {
        Write-Host $_.Exception.Message
        Add-Fail -Name "Empty query returns 422" -Status $status
    }
}

Write-Host ""
Write-Host "=== Test 6: Query without Documents (Should Fail) ==="
try {
    $body = @{ query = "test query" } | ConvertTo-Json
    $resp = Invoke-WebRequest -Uri "$BaseUrl/query" -Method Post -ContentType "application/json" -Body $body -ErrorAction Stop
    $status = [int]$resp.StatusCode
}
catch {
    $status = if ($_.Exception.Response) { $_.Exception.Response.StatusCode.value__ } else { 0 }
}

if ($status -eq 400 -or $status -eq 500) {
    Write-Host "EXPECTED: Query without documents fails (status: $status)" -ForegroundColor Yellow
    Write-Host "  (This is expected if no documents were uploaded in Test 3)"
}
else {
    Write-Host "Status: $status"
}

Write-Host ""
Write-Host "=========================================="
Write-Host "Test Summary"
Write-Host "=========================================="
Write-Host "Passed: $passed" -ForegroundColor Green
Write-Host "Failed: $failed" -ForegroundColor Red
Write-Host ""

if ($failed -eq 0) {
    Write-Host "All tests passed!" -ForegroundColor Green
    exit 0
}
else {
    Write-Host "Some tests failed." -ForegroundColor Red
    exit 1
}


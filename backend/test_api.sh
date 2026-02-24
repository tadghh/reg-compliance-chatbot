#!/bin/bash

# Test script for Reg Compliance Chatbot API
# Usage: ./test_api.sh [base_url]
# Default base_url: http://localhost:8000

BASE_URL="${1:-http://localhost:8000}"

echo "=========================================="
echo "Testing Reg Compliance Chatbot API"
echo "Base URL: $BASE_URL"
echo "=========================================="

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counter
PASSED=0
FAILED=0

# Helper function to check response
check_response() {
    local name="$1"
    local status="$2"
    if [ "$status" -eq 200 ] || [ "$status" -eq 201 ]; then
        echo -e "${GREEN}✓ PASSED${NC}: $name (status: $status)"
        ((PASSED++))
    else
        echo -e "${RED}✗ FAILED${NC}: $name (status: $status)"
        ((FAILED++))
    fi
}

echo ""
echo "=== Test 1: Root Endpoint ==="
RESPONSE=$(curl -s -w "\n%{http_code}" "$BASE_URL/")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n -1)
echo "$BODY"
check_response "Root endpoint" "$HTTP_CODE"

echo ""
echo "=== Test 2: Health Check ==="
RESPONSE=$(curl -s -w "\n%{http_code}" "$BASE_URL/health")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n -1)
echo "$BODY"
check_response "Health check" "$HTTP_CODE"

echo ""
echo "=== Test 3: Upload Document ==="
# Create a temporary test file
TEST_FILE="/tmp/test_compliance_doc.txt"
cat > "$TEST_FILE" << 'EOF'
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
EOF

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/upload" \
    -F "file=@$TEST_FILE")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n -1)
echo "$BODY"
check_response "Upload document" "$HTTP_CODE"

# Cleanup
rm -f "$TEST_FILE"

echo ""
echo "=== Test 4: Query RAG System ==="
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/query" \
    -H "Content-Type: application/json" \
    -d '{"query": "What are the reporting requirements for compliance?", "top_k": 3}')
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n -1)
echo "$BODY"
check_response "Query RAG system" "$HTTP_CODE"

echo ""
echo "=== Test 5: Query with Empty Body (Should Fail) ==="
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/query" \
    -H "Content-Type: application/json" \
    -d '{}')
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
if [ "$HTTP_CODE" -eq 422 ]; then
    echo -e "${GREEN}✓ PASSED${NC}: Empty query returns 422 (status: $HTTP_CODE)"
    ((PASSED++))
else
    echo -e "${RED}✗ FAILED${NC}: Expected 422, got $HTTP_CODE"
    ((FAILED++))
fi

echo ""
echo "=== Test 6: Query without Documents (Should Fail) ==="
# First, let's create a fresh instance by not uploading
# This tests the error handling
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/query" \
    -H "Content-Type: application/json" \
    -d '{"query": "test query"}')
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
if [ "$HTTP_CODE" -eq 400 ] || [ "$HTTP_CODE" -eq 500 ]; then
    echo -e "${YELLOW}⚠ EXPECTED${NC}: Query without documents fails (status: $HTTP_CODE)"
    echo "  (This is expected if no documents were uploaded in test 3)"
else
    echo "Status: $HTTP_CODE"
fi

echo ""
echo "=========================================="
echo "Test Summary"
echo "=========================================="
echo -e "${GREEN}Passed: $PASSED${NC}"
echo -e "${RED}Failed: $FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}Some tests failed.${NC}"
    exit 1
fi
